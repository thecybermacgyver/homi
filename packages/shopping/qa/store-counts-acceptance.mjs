// Shopping 0.3.0 store counts via Core Family Board card styles.
// PHASE=seed runs on the current production build with Shopping 0.2.2;
// PHASE=verify runs after the Core/web upgrade and the Shopping 0.3.0 update.
// Run only against an isolated localhost stack with fixture accounts.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const ROOT=new URL('./',import.meta.url).pathname;
const env=Object.fromEntries(readFileSync(process.env.HOMI_TEST_CREDENTIALS,'utf8').trim().split('\n').filter(s=>s.includes('=')).map(s=>{const i=s.indexOf('=');return [s.slice(0,i),s.slice(i+1)];}));
const base=process.env.HOMI_TEST_URL ?? 'http://localhost:3400',phase=process.env.PHASE;
if(new URL(base).hostname!=='localhost')throw new Error('Acceptance fixtures require the isolated localhost test stack');
const PROFILES=process.env.HOMI_TEST_PROFILES,MEMBER='shopping-second@example.invalid';
const contexts=[],errors=[],results=[];
const pass=s=>{results.push(s);console.log('PASS',s);};
async function launch(label,width=390){mkdirSync(PROFILES,{recursive:true});const dir=PROFILES+'/'+label;const ctx=await chromium.launchPersistentContext(dir,{headless:true,viewport:{width,height:900}});contexts.push(ctx);const p=ctx.pages()[0]??await ctx.newPage();p.on('pageerror',e=>errors.push(label+': '+e.message));return {ctx,p,dir,label};}
async function login(d,email=env.HOMI_BOOTSTRAP_EMAIL){await d.p.goto(base);await d.p.waitForLoadState('networkidle');if(await d.p.getByLabel('Password',{exact:true}).count()){await d.p.getByLabel('Email',{exact:true}).fill(email);await d.p.getByLabel('Password',{exact:true}).fill(env.HOMI_BOOTSTRAP_PASSWORD);await d.p.getByRole('button',{name:'Sign in',exact:true}).click();}await d.p.getByRole('button',{name:'Settings',exact:true}).first().waitFor({timeout:30000});}
async function rows(d,store){return d.p.evaluate(async store=>{const db=await new Promise((res,rej)=>{const r=indexedDB.open('homi-client');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});return await new Promise((res,rej)=>{const r=db.transaction(store).objectStore(store).getAll();r.onsuccess=()=>{db.close();res(r.result)};r.onerror=()=>rej(r.error);});},store);}
async function identity(d){return JSON.parse((await rows(d,'meta')).find(r=>r.key==='activeOfflineContext').value);}
async function api(d,path,method='GET',body){const id=await identity(d);return d.p.evaluate(async({path,method,body,id})=>{const r=await fetch('/api/v1/'+path,{method,headers:{'Content-Type':'application/json','X-Homi-Household-ID':id.householdId,'X-Homi-Client-ID':id.clientId},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};},{path,method,body,id});}
async function poll(fn,message,seconds=45){let last;for(let i=0;i<seconds;i++){try{last=await fn();if(last)return last;}catch(e){last=e.message;}await new Promise(r=>setTimeout(r,1000));}throw new Error(message+': '+JSON.stringify(last));}
async function nav(d,name){await d.p.getByRole('button',{name,exact:true}).first().click();}
async function home(d){await nav(d,'Dashboard');await d.p.getByRole('button',{name:/Open list$/}).waitFor({timeout:30000});}
function card(d){return d.p.locator('.shopping-board');}
async function counts(d){const list=card(d).getByRole('list',{name:'Items to buy by store'});if(await list.count()===0)return null;return list.locator('li').evaluateAll(items=>items.map(li=>[...li.querySelectorAll('span')].map(s=>s.textContent.trim())));}
async function listShown(d){return await card(d).getByRole('checkbox',{name:'Bread',exact:true}).count()>0&&await counts(d)===null;}
const EXPECTED=[['All stores','4'],['Browns','1'],['Dollarama','1'],['Drug store','2']];
function tile(d,name){return d.p.locator('.homi-platform-module-card').filter({has:d.p.getByRole('heading',{name,exact:true})});}
async function styleGroup(d){await nav(d,'Modules');const group=tile(d,'Shopping List').getByRole('group',{name:'Shopping List card style'});await group.waitFor({timeout:30000});return group;}
async function pressed(group){return group.locator('button[aria-pressed="true"]').innerText();}
async function chooseStyle(d,label){const group=await styleGroup(d);await group.getByRole('button',{name:label,exact:true}).click();await poll(async()=>await pressed(group)===label,'style '+label+' pressed');}
async function addItem(d,name,qty,store){await d.p.getByRole('button',{name:'Add shopping item'}).first().click();await d.p.getByLabel('Item',{exact:true}).fill(name);await d.p.getByLabel('Quantity',{exact:true}).fill(qty);await d.p.locator('#shopping-store').fill(store);await d.p.getByRole('button',{name:'Save item',exact:true}).click();await d.p.getByRole('checkbox',{name:qty==='1'?name:name+' · '+qty,exact:true}).waitFor();}
async function drained(d){return !(await rows(d,'mutations')).some(m=>['queued','sending'].includes(m.status));}
async function failures(d){return (await rows(d,'mutations')).filter(m=>['conflict','rejected'].includes(m.status));}
async function shoppingPreference(d){return (await api(d,'core/module-preferences')).body.data.preferences.find(p=>p.moduleKey==='shopping');}
try{
if(phase==='seed'){
  const a=await launch('owner-a');await login(a);
  const {modules}=(await api(a,'core/modules')).body.data;
  assert.equal(modules.find(m=>m.moduleKey==='shopping').version,'0.2.2');
  for(const m of modules){if(!m.enabled){const r=await api(a,'core/modules/'+m.moduleKey,'PATCH',{enabled:true,baseRevision:m.revision});assert.equal(r.status,200,JSON.stringify(r.body));}}
  await a.p.reload();await home(a);await a.p.getByRole('button',{name:/Open list$/}).click();await a.p.getByRole('heading',{name:'Shopping List',exact:true}).waitFor();
  // A rerun keeps the items an interrupted seed already saved.
  const seeded=(await api(a,'modules/shopping/items')).body.data.map(i=>i.name);
  for(const [name,qty,store] of [['Bread','1','Browns'],['Soap','1','Dollarama'],['Aspirin','1','Drug store'],['Shampoo','3','Drug store'],['Eggs','1','Browns']])if(!seeded.includes(name))await addItem(a,name,qty,store);
  // Tick immediately after adding. The production build this seed runs on
  // could lose such a tick (Core add-then-tick race); the verify phase checks
  // the fixed build handles it.
  if(await a.p.getByRole('checkbox',{name:'Eggs',exact:true}).count()){await a.p.getByRole('checkbox',{name:'Eggs',exact:true}).click();await a.p.getByRole('checkbox',{name:'Eggs',exact:true}).waitFor({state:'detached'});}
  await poll(()=>drained(a),'seed delivered');
  const seededItems=(await api(a,'modules/shopping/items')).body.data;
  if(!seededItems.find(i=>i.name==='Eggs').checked){
    // The known production race lost the tick; record it and tick again so the
    // verify phase starts from the intended state.
    console.log('NOTE production build lost the immediate Eggs tick (known race)');
    for(const m of await failures(a))await a.p.evaluate(async id=>{const db=await new Promise(r=>{const q=indexedDB.open('homi-client');q.onsuccess=()=>r(q.result);});await new Promise(r=>{const q=db.transaction('mutations','readwrite').objectStore('mutations').delete(id);q.onsuccess=()=>r();});},m.clientMutationId);
    await a.p.reload();await home(a);await a.p.getByRole('button',{name:/Open list$/}).click();
    await a.p.getByRole('checkbox',{name:'Eggs',exact:true}).click();await poll(()=>drained(a),'retick delivered');
  }
  await poll(async()=>{const r=await api(a,'modules/shopping/items');return r.body.data.length===5&&r.body.data.filter(i=>i.checked).length===1;},'seed items on server');
  await nav(a,'Modules');const cheque=tile(a,'Chequebook');await cheque.getByRole('button',{name:'Hide',exact:true}).first().click();await cheque.getByText('Hidden from My Homi').first().waitFor();
  await poll(()=>drained(a),'hide delivered');
  pass('production build: Calendar, Chequebook and Shopping 0.2.2 enabled; 4 unchecked + 1 checked item; owner hid one Chequebook card');
  const b=await launch('owner-b',1440);await login(b);const c=await launch('member-c',768);await login(c,MEMBER);
  assert.equal((await identity(a)).authSubject,(await identity(b)).authSubject);assert.notEqual((await identity(a)).authSubject,(await identity(c)).authSubject);
  pass('owner has two registered devices; second member signed in');
}else if(phase==='verify'){
  const a=await launch('owner-a'),b=await launch('owner-b',1440),c=await launch('member-c',768);
  await login(a);await login(b);await login(c,MEMBER);
  const {modules}=(await api(a,'core/modules')).body.data;const version=k=>modules.find(m=>m.moduleKey===k)?.version;
  assert.equal(version('shopping'),'0.3.0');assert.ok(version('calendar'));assert.ok(version('chequebook'));
  const prefs=(await api(a,'core/module-preferences')).body.data.preferences;
  const hidden=prefs.filter(p=>!p.visible);assert.equal(hidden.length,1);assert.equal(hidden[0].moduleKey,'chequebook');
  for(const p of prefs.filter(p=>p.moduleKey!=='shopping')){assert.equal(p.cardStyle,null);assert.deepEqual(p.cardStyles,[]);}
  const own=prefs.find(p=>p.moduleKey==='shopping');
  assert.deepEqual(own.cardStyles,[{id:'items',label:'List'},{id:'store-counts',label:'Counts by store'}]);
  pass("upgrade keeps the owner's hidden Chequebook card; unstyled cards report no styles; Shopping declares List and Counts by store");
  if(own.cardStyle!=='items'){await chooseStyle(a,'List');await poll(()=>drained(a),'reset delivered');}
  for(const d of [a,b,c]){await d.p.reload();await home(d);await poll(()=>listShown(d),d.label+' list',60);}
  assert.equal(await a.p.locator('.homi-family-card h2',{hasText:new RegExp('^'+hidden[0].label+'$')}).count(),0);
  pass('after the update every dashboard shows the Shopping list by default and the hidden card stays hidden');
  const group=await styleGroup(a);assert.equal(await pressed(group),'List');
  for(const name of ['Calendar','Chequebook'])assert.equal(await tile(a,name).getByRole('group',{name:/card style$/}).count(),0);
  await a.p.screenshot({path:ROOT+'/card-style-modules-390.png',fullPage:true});
  await chooseStyle(a,'Counts by store');
  await home(a);assert.deepEqual(await poll(()=>counts(a),'owner-a counts'),EXPECTED);
  pass('Modules page Shopping card offers List / Counts by store; choosing counts shows All stores 4, Browns 1, Dollarama 1, Drug store 2');
  await poll(()=>drained(a),'style delivered');
  await home(b);assert.deepEqual(await poll(()=>counts(b),'owner-b counts via sync',60),EXPECTED);
  pass("owner's second device switches to counts automatically");
  const aPref=await shoppingPreference(a);assert.equal(aPref.cardStyle,'store-counts');
  const forged=await api(c,'core/sync/mutations','POST',{clientMutationId:crypto.randomUUID(),moduleKey:'core',entityType:'member-module-preference',entityId:aPref.id,operation:'update',baseRevision:aPref.revision,payload:{cardStyle:'items'}});
  assert.equal(forged.body.data?.status,'rejected',JSON.stringify(forged.body));assert.equal((await shoppingPreference(a)).cardStyle,'store-counts');
  const cPref=await shoppingPreference(c);
  const undeclared=await api(c,'core/sync/mutations','POST',{clientMutationId:crypto.randomUUID(),moduleKey:'core',entityType:'member-module-preference',entityId:cPref.id,operation:'update',baseRevision:cPref.revision,payload:{cardStyle:'grid'}});
  assert.equal(undeclared.body.data?.errorCode,'MODULE_PREFERENCE_CARD_STYLE_UNDECLARED',JSON.stringify(undeclared.body));
  pass("another member cannot change the owner's style; undeclared styles are rejected");
  await c.p.waitForTimeout(8000);await home(c);assert.equal(await listShown(c),true);
  assert.equal((await rows(c,'cache')).some(r=>r.entityId===aPref.id),false);
  assert.deepEqual(await failures(c),[]);assert.equal(await c.p.getByText('Sync issue').count(),0);
  assert.equal(await pressed(await styleGroup(c)),'List');
  pass("second member keeps the list, sees List selected, holds none of the owner's preferences, and syncs cleanly");
  await a.ctx.setOffline(true);await chooseStyle(a,'List');await home(a);await poll(()=>listShown(a),'offline list');
  await a.p.reload();await home(a);await poll(()=>listShown(a),'offline list after reload');
  pass('switching back offline takes effect immediately and survives a reload');
  await a.ctx.setOffline(false);await poll(()=>drained(a),'offline change delivered');
  await poll(()=>listShown(b),'owner-b returns to list',60);
  assert.deepEqual(await failures(a),[]);assert.deepEqual(await failures(b),[]);
  pass('reconnect delivers the offline style change to the second device without conflicts');
  await chooseStyle(a,'Counts by store');await home(a);await poll(()=>counts(a),'counts again');
  await a.p.getByRole('button',{name:'Open list',exact:true}).click();await a.p.getByRole('heading',{name:'Shopping List',exact:true}).waitFor();await a.p.getByRole('checkbox',{name:'Soap',exact:true}).click();await a.p.getByRole('checkbox',{name:'Soap',exact:true}).waitFor({state:'detached'});
  await home(a);assert.deepEqual(await poll(async()=>{const v=await counts(a);return v&&v[0][1]==='3'?v:null;},'counts follow list'),[['All stores','3'],['Browns','1'],['Drug store','2']]);
  pass('counts update when an item is checked off and empty stores disappear');
  await poll(()=>counts(b),'owner-b counts again',60);

  // Core queue fix: an immediate tick after an add must reach the server.
  await a.p.getByRole('button',{name:'Open list',exact:true}).click();await a.p.getByRole('heading',{name:'Shopping List',exact:true}).waitFor();
  await a.p.getByRole('textbox',{name:'Add an item',exact:true}).fill('Quick tick');await a.p.getByRole('button',{name:'Add',exact:true}).click();
  await a.p.getByRole('checkbox',{name:'Quick tick',exact:true}).waitFor();await a.p.getByRole('checkbox',{name:'Quick tick',exact:true}).click();
  await poll(()=>drained(a),'quick tick delivered');
  assert.equal((await api(a,'modules/shopping/items')).body.data.find(i=>i.name==='Quick tick')?.checked,true);
  assert.deepEqual(await failures(a),[]);
  pass('ticking an item immediately after adding it reaches the server without a conflict');

  // Core queue fix: a real conflict stays reviewable across sync cycles.
  await a.ctx.setOffline(true);
  await a.p.getByRole('button',{name:'Edit Bread',exact:true}).click();await a.p.getByLabel('Quantity',{exact:true}).fill('4');await a.p.getByRole('button',{name:'Save item',exact:true}).click();
  await home(b);await b.p.getByRole('button',{name:'Open list',exact:true}).click();await b.p.getByRole('heading',{name:'Shopping List',exact:true}).waitFor();
  await b.p.getByRole('button',{name:'Edit Bread',exact:true}).click();await b.p.getByLabel('Quantity',{exact:true}).fill('5');await b.p.getByRole('button',{name:'Save item',exact:true}).click();
  await poll(async()=>(await api(b,'modules/shopping/items')).body.data.find(i=>i.name==='Bread')?.quantity==='5','remote edit');
  await a.ctx.setOffline(false);
  const prompt=a.p.getByText('Someone changed this item before your change arrived.',{exact:false});
  await prompt.waitFor({timeout:30000});
  await a.p.waitForTimeout(35000);await a.p.getByRole('button',{name:'Sync now',exact:true}).count();
  assert.equal(await prompt.count(),1);assert.equal((await failures(a)).length,1);
  await a.p.reload();await home(a);await a.p.getByRole('button',{name:'Open list',exact:true}).click();await prompt.waitFor({timeout:30000});
  pass('a conflicting edit stays available for review across sync cycles and a reload');
  await a.p.getByRole('button',{name:'Keep shared version',exact:true}).click();await prompt.waitFor({state:'detached'});
  await poll(async()=>(await failures(a)).length===0,'conflict dismissed');
  await a.p.getByRole('checkbox',{name:'Bread · 5',exact:true}).waitFor();
  pass('keeping the shared version clears the review and shows the other device\'s edit');
  for(const [d,width] of [[a,390],[b,768],[b,1440]]){await d.p.setViewportSize({width,height:900});await home(d);assert.equal(await d.p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await d.p.evaluate(()=>scrollTo(0,0));await d.p.screenshot({path:ROOT+'/store-counts-'+width+'.png',fullPage:true});
    await nav(d,'Modules');await tile(d,'Shopping List').waitFor();assert.equal(await d.p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
  pass('dashboard and Modules page at 390/768/1440 have no horizontal overflow');
  assert.deepEqual(errors,[]);pass('no JavaScript page errors');
  writeFileSync(ROOT+'/store-counts-acceptance.json',JSON.stringify({date:new Date().toISOString(),version:'0.3.0',results},null,2));
}else throw new Error('PHASE must be seed or verify');
}catch(e){console.error(e);writeFileSync(ROOT+'/browser-failure.txt',String(e.stack));for(const [i,ctx]of contexts.entries()){try{const p=ctx.pages()[0];if(p){console.log('PAGE',i,(await p.locator('body').innerText()).slice(0,2000));await p.screenshot({path:ROOT+'/failure-'+i+'.png'});}}catch{}}process.exitCode=1;}finally{for(const ctx of contexts)await ctx.close().catch(()=>{});}
