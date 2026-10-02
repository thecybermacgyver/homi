// Multi-device Chequebook acceptance. Run only against the isolated localhost
// acceptance stack: Chequebook installed, enabled for the fixture household and
// set up with an opening balance of 1000.00, plus the fixture owner and one
// second member (chq-second@example.invalid, same password). All data is
// invented.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
const ROOT=new URL('./',import.meta.url).pathname;
const env=Object.fromEntries(readFileSync(process.env.HOMI_TEST_CREDENTIALS,'utf8').trim().split('\n').map(s=>{const i=s.indexOf('=');return [s.slice(0,i),s.slice(i+1).replace(/^"|"$/g,'')];}));
const run=Date.now().toString().slice(-7),base=process.env.HOMI_TEST_URL??'http://localhost:3400';
const profiles=process.env.HOMI_TEST_PROFILES??'/tmp/homi-chequebook-profiles';
if(new URL(base).hostname!=='localhost')throw new Error('Acceptance fixtures require the isolated localhost test stack');
const contexts=[],errors=[],results=[];
const pass=s=>{results.push(s);console.log('PASS',s);};
const opts=offline=>({headless:true,viewport:{width:390,height:844},offline,executablePath:process.env.HOMI_TEST_CHROME??undefined});
async function launch(label){const dir=profiles+'/profile-'+label+'-'+run;const ctx=await chromium.launchPersistentContext(dir,opts(false));contexts.push(ctx);const p=ctx.pages()[0]??await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));return {ctx,p,dir};}
const entry=d=>d.p.getByRole('link',{name:/Current balance/});
async function login(d,email=env.HOMI_BOOTSTRAP_EMAIL){await d.p.goto(base);await d.p.getByLabel('Email',{exact:true}).fill(email);await d.p.getByLabel('Password',{exact:true}).fill(env.HOMI_BOOTSTRAP_PASSWORD);await d.p.getByRole('button',{name:'Sign in',exact:true}).click();await entry(d).waitFor({timeout:20000});}
async function open(d){await entry(d).click();await d.p.getByRole('heading',{name:'Chequebook',exact:true}).waitFor();await d.p.waitForTimeout(800);}
async function rows(d,store){return d.p.evaluate(async store=>{const db=await new Promise((res,rej)=>{const r=indexedDB.open('homi-client');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});return await new Promise((res,rej)=>{const r=db.transaction(store).objectStore(store).getAll();r.onsuccess=()=>{db.close();res(r.result)};r.onerror=()=>rej(r.error);});},store);}
async function identity(d){return JSON.parse((await rows(d,'meta')).find(r=>r.key==='activeOfflineContext').value);}
async function poll(fn,message,tries=45){let last;for(let i=0;i<tries;i++){try{last=await fn();if(last)return;}catch(e){last=e.message;}await new Promise(r=>setTimeout(r,1000));}throw new Error(message+': '+JSON.stringify(last));}
const row=(d,title)=>d.p.getByRole('button',{name:new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'))});
const money=t=>{const v=String(t);const n=Math.round(parseFloat(v.replace(/[^0-9.]/g,''))*100);return /^[−-]/.test(v.trim())?-n:n;};
const balance=async d=>(await d.p.locator('text=/^[−-]?\\$[\\d,]+\\.\\d\\d$/').first().innerText());
async function create(d,title,amount,kind='Expense',date){await d.p.getByRole('button',{name:'Add transaction',exact:true}).first().click();await d.p.locator('#cheq-kind').selectOption({label:kind});await d.p.locator('#cheq-amount').fill(amount);await d.p.locator('#cheq-description').fill(title);if(date)await d.p.locator('#cheq-date').fill(date);await d.p.getByRole('button',{name:'Save transaction',exact:true}).click();if(!date)await row(d,title).first().waitFor();else await d.p.waitForTimeout(1500);}
async function edit(d,from,to,amount){await row(d,from).first().click();await d.p.locator('#cheq-description').fill(to);if(amount)await d.p.locator('#cheq-amount').fill(amount);await d.p.getByRole('button',{name:'Save transaction',exact:true}).click();await row(d,to).first().waitFor();}
async function remove(d,title){await row(d,title).first().click();await d.p.getByRole('button',{name:'Delete',exact:true}).click();await row(d,title).first().waitFor({state:'detached'});}
async function restart(d,offline){await d.ctx.close();const ctx=await chromium.launchPersistentContext(d.dir,opts(offline));contexts.push(ctx);d.ctx=ctx;d.p=ctx.pages()[0]??await ctx.newPage();d.p.on('pageerror',e=>errors.push(e.message));await d.p.goto(base);await entry(d).waitFor({timeout:20000});await open(d);}
const serverBalance=async d=>{const id=await identity(d);const month=new Date().toISOString().slice(0,7)+'-01';const today=new Date().toISOString().slice(0,10);return money(await d.p.evaluate(async({id,month,today})=>{const r=await fetch('/api/v1/modules/chequebook/summary?month='+month+'&asOf='+today,{headers:{'X-Homi-Household-ID':id.householdId,'X-Homi-Client-ID':id.clientId}});return (await r.json()).data.currentBalance;},{id,month,today}));};
const queued=async d=>(await rows(d,'mutations')).filter(m=>m.moduleKey==='chequebook'&&['queued','sending'].includes(m.status));
const stuck=async d=>(await rows(d,'mutations')).filter(m=>m.moduleKey==='chequebook'&&['conflict','rejected'].includes(m.status));
try{
const a=await launch('a'),b=await launch('b'),c=await launch('c');
await login(a);await login(b);await login(c,'chq-second@example.invalid');await open(a);await open(b);await open(c);
const ia=await identity(a),ib=await identity(b),ic=await identity(c);
assert.equal(ia.authSubject,ib.authSubject);assert.notEqual(ia.clientId,ib.clientId);assert.notEqual(ia.authSubject,ic.authSubject);assert.equal(ia.householdId,ic.householdId);
pass('two registered devices for one member and a distinct authorized household member');
const base0=await serverBalance(a);
const t1='Groceries '+run;await create(a,t1,'25.00');
await poll(async()=>await row(b,t1).count(),'second device',90);await poll(async()=>await row(c,t1).count(),'second member',90);
pass('online transaction propagates automatically to the second device and the second member');
await a.p.evaluate(()=>navigator.serviceWorker.ready);await a.ctx.setOffline(true);await restart(a,true);await row(a,t1).first().waitFor();
pass('full browser/PWA restart while offline loads Chequebook assets and the cached register');
const t2='Swim '+run,t3='Paycheque '+run,t4='Cancelled '+run;
await create(a,t2,'40.00');await create(a,t4,'10.00');await edit(a,t2,t2+' lessons','50.00');await edit(a,t1,t1+' weekly');await create(a,t3,'100.00','Income');await remove(a,t4);
assert.equal(await row(a,t4).count(),0);
await restart(a,true);await row(a,t2+' lessons').first().waitFor();await row(a,t1+' weekly').first().waitFor();await row(a,t3).first().waitFor();assert.equal(await row(a,t4).count(),0);
assert.ok((await queued(a)).length>0);
pass('offline create, edit and delete survive another full restart and stay queued');
await a.ctx.setOffline(false);await poll(async()=>(await queued(a)).length===0,'automatic reconnect drain',60);assert.deepEqual(await stuck(a),[]);
for(const [who,d] of [['second device',b],['second member',c]]){await poll(async()=>await row(d,t2+' lessons').count()&&await row(d,t1+' weekly').count()&&await row(d,t3).count()&&!(await row(d,t4).count()),who+' reconnect propagation',90);}
pass('reconnect applies every queued change automatically, without self-conflicts, to the second device and member');
assert.equal(await serverBalance(a),base0+2500);
for(const [who,d] of [['first device',a],['second device',b],['second member',c]]){await poll(async()=>money(await balance(d))===base0+2500,who+' balance',90);}
pass('server balance equals the starting balance - 25.00 - 50.00 + 100.00, and every device and member displays exactly it');
const t5='Concert '+run;await create(b,t5,'5.00');await poll(async()=>await row(a,t5).count(),'reverse propagation',90);await poll(async()=>await row(c,t5).count(),'member reverse propagation',90);
await remove(c,t5);await poll(async()=>!(await row(a,t5).count())&&!(await row(b,t5).count()),'delete propagation',90);
pass('creates and deletes made on any device or member propagate to the others');
await a.ctx.setOffline(true);await edit(a,t3,t3+' A');await edit(b,t3,t3+' B');await poll(async()=>await row(c,t3+' B').count(),'remote edit',90);await a.ctx.setOffline(false);
await poll(async()=>(await queued(a)).length===0,'conflict settle',60);
const settled=await stuck(a);assert.equal(settled.length,1);assert.equal(settled[0].status,'conflict');
await a.p.getByText('Chequebook change needs review',{exact:true}).waitFor({timeout:20000});await row(a,t3+' B').first().waitFor();assert.equal(await row(a,t3+' A').count(),0);
pass('stale offline edit is surfaced for review and the shared (other device) version stays on screen');
await a.p.getByRole('button',{name:'Dismiss reviewed change',exact:true}).click();await a.p.getByText('Chequebook change needs review',{exact:true}).waitFor({state:'detached'});
await poll(async()=>(await stuck(a)).length===0,'conflict dismissed');for(const d of [a,b,c])await row(d,t3+' B').first().waitFor();
pass('dismissing the reviewed change keeps the shared version on every device');
for(const width of [390,768,1440]){await a.p.setViewportSize({width,height:900});assert.equal(await a.p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await a.p.screenshot({path:ROOT+'/chequebook-register-'+width+'.png',fullPage:true});}
pass('phone/tablet/desktop register layout has no horizontal overflow');
assert.deepEqual(errors,[]);pass('no JavaScript page errors');
writeFileSync(ROOT+'/browser-acceptance.json',JSON.stringify({date:new Date().toISOString(),run,results},null,2));
}catch(e){console.error(e);for(const [i,ctx]of contexts.entries()){try{const p=ctx.pages()[0];if(p){console.log('PAGE',i,JSON.stringify((await p.locator('.cheq-row').allInnerTexts()).map(x=>x.replace(/\n/g,' ').slice(0,60))));console.log('BAL',await balance({p}).catch(()=>'?'),'SERVER',await serverBalance({p}).catch(e=>'?'+e.message));console.log('DIAG',i,JSON.stringify((await rows({p},'mutations')).filter(m=>m.moduleKey==='chequebook').map(m=>m.status+':'+m.operation)),(await p.locator('body').innerText()).split('\n').filter(l=>/Synced|Offline|queued|review|reject|Syncing|retry/i.test(l)).join('|'));await p.screenshot({path:(process.env.HOMI_TEST_PROFILES??'/tmp')+'/failure-'+i+'.png'});}}catch{}}process.exitCode=1;}finally{for(const ctx of contexts)await ctx.close().catch(()=>{});}
