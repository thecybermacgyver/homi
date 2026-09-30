// A fresh device replaying Chequebook history that contains since-deleted
// transactions. PHASE=seed creates and deletes transactions and replays them on
// the current build; PHASE=verify replays them on a fresh device after the
// release. Run only against an isolated localhost stack with fixture accounts.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const ROOT=new URL('./',import.meta.url).pathname;
const env=Object.fromEntries(readFileSync(process.env.HOMI_TEST_CREDENTIALS,'utf8').trim().split('\n').filter(s=>s.includes('=')).map(s=>{const i=s.indexOf('=');return [s.slice(0,i),s.slice(i+1)];}));
const base=process.env.HOMI_TEST_URL ?? 'http://localhost:3400',phase=process.env.PHASE,PROFILES=process.env.HOMI_TEST_PROFILES;
if(new URL(base).hostname!=='localhost')throw new Error('Acceptance fixtures require the isolated localhost test stack');
const contexts=[],errors=[],results=[];
const pass=s=>{results.push(s);console.log('PASS',s);};
async function launch(label){mkdirSync(PROFILES,{recursive:true});const ctx=await chromium.launchPersistentContext(PROFILES+'/'+label,{headless:true,viewport:{width:390,height:900}});contexts.push(ctx);const p=ctx.pages()[0]??await ctx.newPage();p.on('pageerror',e=>errors.push(label+': '+e.message));return {ctx,p,label};}
async function login(d){await d.p.goto(base);await d.p.waitForLoadState('networkidle');if(await d.p.getByLabel('Password',{exact:true}).count()){await d.p.getByLabel('Email',{exact:true}).fill(env.HOMI_BOOTSTRAP_EMAIL);await d.p.getByLabel('Password',{exact:true}).fill(env.HOMI_BOOTSTRAP_PASSWORD);await d.p.getByRole('button',{name:'Sign in',exact:true}).click();}await d.p.getByRole('button',{name:'Settings',exact:true}).first().waitFor({timeout:30000});}
async function store(d,name){return d.p.evaluate(async name=>{const db=await new Promise((res,rej)=>{const r=indexedDB.open('homi-client');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});return await new Promise((res,rej)=>{const r=db.transaction(name).objectStore(name).getAll();r.onsuccess=()=>{db.close();res(r.result)};r.onerror=()=>rej(r.error);});},name);}
async function identity(d){return JSON.parse((await store(d,'meta')).find(r=>r.key==='activeOfflineContext').value);}
async function api(d,path,method='GET',body){const id=await identity(d);return d.p.evaluate(async({path,method,body,id})=>{const r=await fetch('/api/v1/'+path,{method,headers:{'Content-Type':'application/json','X-Homi-Household-ID':id.householdId,'X-Homi-Client-ID':id.clientId},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};},{path,method,body,id});}
async function poll(fn,message,seconds=60){let last;for(let i=0;i<seconds;i++){try{last=await fn();if(last)return last;}catch(e){last=e.message;}await new Promise(r=>setTimeout(r,1000));}throw new Error(message+': '+JSON.stringify(last));}
async function replay(d){
  // A fresh device pulls the full history; wait until its cursor reaches the server's.
  await poll(async()=>{const m=await store(d,'meta');return m.some(r=>String(r.key).startsWith('lastAppliedSequence'))&&!(await store(d,'mutations')).some(x=>['queued','sending'].includes(x.status));},'fresh device synchronised');
  await d.p.waitForTimeout(20000);
  const deferred=(await store(d,'meta')).filter(r=>String(r.key).startsWith('deferredChange:')).map(r=>JSON.parse(r.value)).filter(c=>c.moduleKey==='chequebook');
  const cached=(await store(d,'cache')).filter(r=>r.moduleKey==='chequebook'&&r.entityType==='transaction').map(r=>r.entityId);
  return {deferred,cached};
}
try{
  const seedFile=PROFILES+'/seeded-transactions.json';
  if(phase==='seed'){
    const a=await launch('owner');await login(a);
    const {modules}=(await api(a,'core/modules')).body.data;
    for(const m of modules){if(!m.enabled){const r=await api(a,'core/modules/'+m.moduleKey,'PATCH',{enabled:true,baseRevision:m.revision});assert.equal(r.status,200,JSON.stringify(r.body));}}
    const setup=await api(a,'modules/chequebook/setup','PUT',{currency:'CAD',accountName:'Household chequing',openingBalance:'1000.00',openingDate:'2026-09-01'});
    assert.equal(setup.status,200,JSON.stringify(setup.body));
    const accountId=setup.body.data.accounts[0].id,category=setup.body.data.categories.find(c=>c.kind==='expense').id;
    const ids=[crypto.randomUUID(),crypto.randomUUID()];
    for(const [i,id] of ids.entries()){
      const created=await api(a,'core/sync/mutations','POST',{clientMutationId:crypto.randomUUID(),moduleKey:'chequebook',entityType:'transaction',entityId:id,operation:'create',baseRevision:'0',
        payload:{kind:'expense',accountId,transferAccountId:null,categoryId:category,personId:null,amount:(10+i)+'.00',description:'Replay proof '+i,payee:'Store',date:'2026-09-20',cleared:false,reconciledAt:null,notes:null,recurringRuleId:null,recurringOccurrenceDate:null,calendarLinkEnabled:false}});
      assert.equal(created.body.data?.status,'applied',JSON.stringify(created.body));
      const removed=await api(a,'core/sync/mutations','POST',{clientMutationId:crypto.randomUUID(),moduleKey:'chequebook',entityType:'transaction',entityId:id,operation:'delete',baseRevision:created.body.data.serverRevision,payload:{}});
      assert.equal(removed.body.data?.status,'applied',JSON.stringify(removed.body));
    }
    writeFileSync(seedFile,JSON.stringify(ids));
    pass('Chequebook set up; two transactions created and deleted');
    const fresh=await launch('fresh-before');await login(fresh);const before=await replay(fresh);
    console.log('BEFORE deferred='+before.deferred.length+' cachedDeleted='+before.cached.filter(id=>ids.includes(id)).length);
    pass('fresh device replayed the history on the current build');
  }else if(phase==='verify'){
    const ids=JSON.parse(readFileSync(seedFile,'utf8'));
    const fresh=await launch('fresh-after');await login(fresh);const after=await replay(fresh);
    assert.deepEqual(after.deferred,[]);
    assert.equal(after.cached.filter(id=>ids.includes(id)).length,0);
    pass('fresh device replays created-then-deleted transactions with nothing set aside and none left cached');
    for(const name of ['Modules','Settings','Dashboard'])await fresh.p.getByRole('button',{name,exact:true}).first().click();
    await fresh.p.getByRole('button',{name:/Open list$/}).first().click();await fresh.p.getByRole('heading',{name:'Shopping List',exact:true}).waitFor();
    assert.deepEqual(errors,[]);
    pass('Modules, Settings, Dashboard and Shopping load with no JavaScript errors');
    writeFileSync(ROOT+'/replay-deleted-acceptance.json',JSON.stringify({date:new Date().toISOString(),version:'0.1.14',results},null,2));
  }else throw new Error('PHASE must be seed or verify');
}catch(e){console.error(e);process.exitCode=1;}finally{for(const ctx of contexts)await ctx.close().catch(()=>{});}
