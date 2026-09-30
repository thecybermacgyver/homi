import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
const ROOT=new URL('./',import.meta.url).pathname;
const env=Object.fromEntries(readFileSync(process.env.HOMI_TEST_CREDENTIALS ?? '/tmp/homi-shopping-browser/bootstrap.env','utf8').trim().split('\n').map(s=>{const i=s.indexOf('=');return [s.slice(0,i),s.slice(i+1)];}));
const run=Date.now().toString().slice(-7),base=process.env.HOMI_TEST_URL ?? 'http://localhost:3300';
if(new URL(base).hostname!=='localhost')throw new Error('Acceptance fixtures require the isolated localhost test stack');
const contexts=[],errors=[],results=[];
const pass=s=>{results.push(s);console.log('PASS',s);};
async function launch(label,offline=false){const dir='/tmp/homi-shopping-browser/profile-'+label+'-'+run;const ctx=await chromium.launchPersistentContext(dir,{headless:true,viewport:{width:390,height:844},offline});contexts.push(ctx);const p=ctx.pages()[0]??await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));return {ctx,p,dir};}
async function login(d,email=env.HOMI_BOOTSTRAP_EMAIL){await d.p.goto(base);await d.p.getByLabel('Email',{exact:true}).fill(email);await d.p.getByLabel('Password',{exact:true}).fill(env.HOMI_BOOTSTRAP_PASSWORD);await d.p.getByRole('button',{name:'Sign in',exact:true}).click();await d.p.getByRole('button',{name:/Open list$/}).waitFor({timeout:20000});}
async function open(d){await d.p.getByRole('button',{name:/Open list$/}).click();await d.p.getByRole('heading',{name:'Shopping List',exact:true}).waitFor();}
async function rows(d,store){return d.p.evaluate(async store=>{const db=await new Promise((res,rej)=>{const r=indexedDB.open('homi-client');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});return await new Promise((res,rej)=>{const r=db.transaction(store).objectStore(store).getAll();r.onsuccess=()=>{db.close();res(r.result)};r.onerror=()=>rej(r.error);});},store);}
async function identity(d){return JSON.parse((await rows(d,'meta')).find(r=>r.key==='activeOfflineContext').value);}
async function api(d,path,body){const id=await identity(d);return d.p.evaluate(async({path,body,id})=>{const r=await fetch('/api/v1/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-Homi-Household-ID':id.householdId,'X-Homi-Client-ID':id.clientId},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};},{path,body,id});}
async function poll(fn,message){let last;for(let i=0;i<45;i++){try{last=await fn();if(last)return;}catch(e){last=e.message;}await new Promise(r=>setTimeout(r,1000));}throw new Error(message+': '+JSON.stringify(last));}
async function add(d,name){await d.p.getByRole('textbox',{name:'Add an item',exact:true}).fill(name);await d.p.getByRole('button',{name:'Add',exact:true}).click();await d.p.getByRole('checkbox',{name,exact:true}).waitFor();}
async function edit(d,name,qty){await d.p.getByRole('button',{name:'Edit '+name,exact:true}).click();await d.p.getByLabel('Quantity',{exact:true}).fill(qty);await d.p.getByRole('button',{name:'Save item',exact:true}).click();}
async function restart(d){await d.ctx.close();const ctx=await chromium.launchPersistentContext(d.dir,{headless:true,viewport:{width:390,height:844},offline:true});contexts.push(ctx);d.ctx=ctx;d.p=ctx.pages()[0]??await ctx.newPage();d.p.on('pageerror',e=>errors.push(e.message));await d.p.goto(base);await d.p.getByRole('button',{name:/Open list$/}).waitFor({timeout:20000});await open(d);}
try {
const a=await launch('api-a'),b=await launch('api-b'),c=await launch('api-c');await login(a);await login(b);await login(c,'shopping-second@example.invalid');
const mutation={clientMutationId:crypto.randomUUID(),moduleKey:'shopping',entityType:'item',entityId:crypto.randomUUID(),operation:'create',baseRevision:'0',payload:{name:'API '+run,quantity:'1',store:'Any store',aisle:'Other',assignedTo:null,checked:false}};
const first=await api(a,'core/sync/mutations',mutation);assert.equal(first.body.data.status,'applied');
const replay=await api(a,'core/sync/mutations',mutation);assert.equal(replay.body.data.replayed,true);assert.deepEqual(replay.body.data.serverState,first.body.data.serverState);pass('duplicate delivery returns same authoritative result');
const reuse=await api(a,'core/sync/mutations',{...mutation,payload:{...mutation.payload,quantity:'2'}});assert.equal(reuse.status,409);assert.equal(reuse.body.error.code,'MUTATION_ID_REUSED');pass('changed request cannot reuse mutation ID');
const conflict=await api(a,'core/sync/mutations',{...mutation,clientMutationId:crypto.randomUUID(),operation:'update',baseRevision:'0'});assert.equal(conflict.body.data.status,'conflict');assert.deepEqual(conflict.body.data.serverState,first.body.data.serverState);pass('stale revision returns authoritative conflict state');
const deletion=await api(a,'core/sync/mutations',{...mutation,clientMutationId:crypto.randomUUID(),operation:'delete',baseRevision:'1',payload:{}});assert.equal(deletion.body.data.status,'applied');
const tombstone=await api(a,'modules/shopping/items/'+mutation.entityId);assert.equal(tombstone.body.data.deleted,true);pass('historical changes materialize a tombstone after deletion');
const prefs=(await api(a,'core/module-preferences')).body.data.preferences;const pref=prefs.find(p=>p.moduleKey==='shopping');assert.ok(pref);
const targeted={clientMutationId:crypto.randomUUID(),moduleKey:'core',entityType:'member-module-preference',entityId:pref.id,operation:'update',baseRevision:pref.revision,payload:{displayOrder:pref.displayOrder+1}};
const changed=await api(a,'core/sync/mutations',targeted);assert.equal(changed.body.data.status,'applied');const seq=changed.body.data.changeSequence;
for(const [who,shouldSee]of [[b,true],[c,false]]){const feed=await api(who,'core/sync/changes?after='+String(BigInt(seq)-1n)+'&limit=500');assert.equal(feed.body.data.changes.some(x=>x.entityId===pref.id),shouldSee);}
const otherPrefs=(await api(c,'core/module-preferences')).body.data.preferences;assert.equal(otherPrefs.some(p=>p.id===pref.id),false);
const intrusion=await api(c,'core/sync/mutations',{...targeted,clientMutationId:crypto.randomUUID(),baseRevision:changed.body.data.serverRevision});assert.notEqual(intrusion.body.data?.status,'applied');assert.equal(intrusion.body.data?.serverState??null,null);pass('recipient-scoped preference reaches own second device but is absent and unwritable for other user');
const id=await identity(c);const forbidden=await c.p.evaluate(async id=>{const r=await fetch('/api/v1/modules/shopping/items',{headers:{'X-Homi-Household-ID':crypto.randomUUID(),'X-Homi-Client-ID':id.clientId}});return r.status;},id);assert.equal(forbidden,403);pass('unauthorized household access rejected');
writeFileSync(ROOT+'/api-acceptance.json',JSON.stringify({date:new Date().toISOString(),results},null,2));
}catch(e){console.error(e);process.exitCode=1;}finally{for(const ctx of contexts)await ctx.close().catch(()=>{});}
