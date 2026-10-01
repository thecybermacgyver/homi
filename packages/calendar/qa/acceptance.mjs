// Multi-device Calendar acceptance (Master Step 7). Run only against the
// isolated localhost acceptance stack: Calendar installed, enabled for the
// fixture household and set up, with the fixture owner and one second member
// (HOMI_TEST_CREDENTIALS gives HOMI_BOOTSTRAP_EMAIL / HOMI_BOOTSTRAP_PASSWORD;
// the second member uses calendar-second@example.invalid with the same
// password). All data is invented.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
const ROOT=new URL('./',import.meta.url).pathname;
const env=Object.fromEntries(readFileSync(process.env.HOMI_TEST_CREDENTIALS,'utf8').trim().split('\n').map(s=>{const i=s.indexOf('=');return [s.slice(0,i),s.slice(i+1).replace(/^"|"$/g,'')];}));
const run=Date.now().toString().slice(-7),base=process.env.HOMI_TEST_URL??'http://localhost:3400';
const profiles=process.env.HOMI_TEST_PROFILES??'/tmp/homi-calendar-profiles';
if(new URL(base).hostname!=='localhost')throw new Error('Acceptance fixtures require the isolated localhost test stack');
const contexts=[],errors=[],results=[];
const pass=s=>{results.push(s);console.log('PASS',s);};
const day=n=>{const d=new Date(Date.now()+n*864e5);return d.toISOString().slice(0,10);};
const opts=(offline)=>({headless:true,viewport:{width:390,height:844},offline,executablePath:process.env.HOMI_TEST_CHROME??undefined});
async function launch(label){const dir=profiles+'/profile-'+label+'-'+run;const ctx=await chromium.launchPersistentContext(dir,opts(false));contexts.push(ctx);const p=ctx.pages()[0]??await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));return {ctx,p,dir};}
async function login(d,email=env.HOMI_BOOTSTRAP_EMAIL){await d.p.goto(base);await d.p.getByLabel('Email',{exact:true}).fill(email);await d.p.getByLabel('Password',{exact:true}).fill(env.HOMI_BOOTSTRAP_PASSWORD);await d.p.getByRole('button',{name:'Sign in',exact:true}).click();await d.p.getByRole('link',{name:/Coming week/}).waitFor({timeout:20000});}
async function open(d){await d.p.getByRole('link',{name:/Coming week/}).click();await d.p.getByRole('heading',{name:'Calendar',exact:true}).waitFor();await d.p.waitForTimeout(800);await upcoming(d);}
async function rows(d,store){return d.p.evaluate(async store=>{const db=await new Promise((res,rej)=>{const r=indexedDB.open('homi-client');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});return await new Promise((res,rej)=>{const r=db.transaction(store).objectStore(store).getAll();r.onsuccess=()=>{db.close();res(r.result)};r.onerror=()=>rej(r.error);});},store);}
async function identity(d){return JSON.parse((await rows(d,'meta')).find(r=>r.key==='activeOfflineContext').value);}
async function poll(fn,message,tries=45){let last;for(let i=0;i<tries;i++){try{last=await fn();if(last)return;}catch(e){last=e.message;}await new Promise(r=>setTimeout(r,1000));}throw new Error(message+': '+JSON.stringify(last));}
async function upcoming(d){await d.p.getByRole('tab',{name:'Upcoming',exact:true}).click();await poll(async()=>(await d.p.getByRole('tab',{name:'Upcoming',exact:true}).getAttribute('aria-selected'))==='true','upcoming view selected',10);}
const eventRow=(d,title)=>d.p.getByText(title,{exact:false});
async function create(d,title,date){await upcoming(d);await d.p.getByRole('button',{name:'Add event',exact:true}).click();await d.p.locator('#calendar-editor-title').fill(title);await d.p.locator('#calendar-editor-start').fill(date+'T09:00');await d.p.locator('#calendar-editor-end').fill(date+'T10:00');await d.p.getByRole('button',{name:'Save event',exact:true}).click();await eventRow(d,title).first().waitFor();}
async function rename(d,from,to){await upcoming(d);await eventRow(d,from).first().click();await d.p.locator('#calendar-editor-title').fill(to);await d.p.getByRole('button',{name:'Save event',exact:true}).click();await eventRow(d,to).first().waitFor();}
async function remove(d,title){await upcoming(d);await eventRow(d,title).first().click();await d.p.getByRole('button',{name:'Delete event',exact:true}).click();await eventRow(d,title).first().waitFor({state:'detached'});}
async function restart(d,offline){await d.ctx.close();const ctx=await chromium.launchPersistentContext(d.dir,opts(offline));contexts.push(ctx);d.ctx=ctx;d.p=ctx.pages()[0]??await ctx.newPage();d.p.on('pageerror',e=>errors.push(e.message));await d.p.goto(base);await d.p.getByRole('link',{name:/Coming week/}).waitFor({timeout:20000});await open(d);}
const queued=async d=>(await rows(d,'mutations')).filter(m=>m.moduleKey==='calendar'&&['queued','sending'].includes(m.status));
const stuck=async d=>(await rows(d,'mutations')).filter(m=>m.moduleKey==='calendar'&&['conflict','rejected'].includes(m.status));
try{
const a=await launch('a'),b=await launch('b'),c=await launch('c');
await login(a);await login(b);await login(c,'calendar-second@example.invalid');await open(a);await open(b);await open(c);
const ia=await identity(a),ib=await identity(b),ic=await identity(c);
assert.equal(ia.authSubject,ib.authSubject);assert.notEqual(ia.clientId,ib.clientId);assert.notEqual(ia.authSubject,ic.authSubject);assert.equal(ia.householdId,ic.householdId);
pass('two registered devices for one member and a distinct authorized household member');
const t1='Dentist '+run;await create(a,t1,day(1));
await poll(async()=>await eventRow(b,t1).count(),'second device');await poll(async()=>await eventRow(c,t1).count(),'second member');
pass('online create propagates automatically to the second device and the second member');
await a.p.evaluate(()=>navigator.serviceWorker.ready);await a.ctx.setOffline(true);await restart(a,true);await eventRow(a,t1).first().waitFor();
pass('full browser/PWA restart while offline loads Calendar assets and the cached events');
const t2='Swim '+run,t3='Recital '+run,t4='Cancelled '+run;
await create(a,t2,day(2));await create(a,t4,day(3));await rename(a,t2,t2+' moved');await rename(a,t1,t1+' updated');await create(a,t3,day(4));await remove(a,t4);
assert.equal(await eventRow(a,t4).count(),0);
await restart(a,true);await eventRow(a,t2+' moved').first().waitFor();await eventRow(a,t1+' updated').first().waitFor();await eventRow(a,t3).first().waitFor();assert.equal(await eventRow(a,t4).count(),0);
assert.ok((await queued(a)).length>0);
pass('offline create, edit and delete survive another full restart and stay queued');
await a.ctx.setOffline(false);await poll(async()=>(await queued(a)).length===0,'automatic reconnect drain',60);assert.deepEqual(await stuck(a),[]);
for(const [who,d] of [['second device',b],['second member',c]]){await poll(async()=>await eventRow(d,t2+' moved').count()&&await eventRow(d,t1+' updated').count()&&await eventRow(d,t3).count()&&!(await eventRow(d,t4).count()),who+' reconnect propagation');}
pass('reconnect applies every queued change automatically, without self-conflicts, to the second device and member');
const t5='Concert '+run;await create(b,t5,day(5));await poll(async()=>await eventRow(a,t5).count(),'reverse propagation');await poll(async()=>await eventRow(c,t5).count(),'member reverse propagation');
await remove(c,t5);await poll(async()=>!(await eventRow(a,t5).count())&&!(await eventRow(b,t5).count()),'delete propagation');
pass('creates and deletes made on any device or member propagate to the others');
await a.ctx.setOffline(true);await rename(a,t3,t3+' A');await rename(b,t3,t3+' B');await poll(async()=>await eventRow(c,t3+' B').count(),'remote edit');await a.ctx.setOffline(false);
await poll(async()=>(await queued(a)).length===0,'conflict settle',60);
const settled=await stuck(a);assert.equal(settled.length,1);assert.equal(settled[0].status,'conflict');
await a.p.getByText('Calendar change needs review',{exact:true}).waitFor({timeout:20000});
await upcoming(a);await eventRow(a,t3+' B').first().waitFor();assert.equal(await eventRow(a,t3+' A').count(),0);
pass('stale offline edit is surfaced for review and the shared (other device) version stays on screen');
await a.p.getByRole('button',{name:'Dismiss reviewed change',exact:true}).click();await a.p.getByText('Calendar change needs review',{exact:true}).waitFor({state:'detached'});
await poll(async()=>(await stuck(a)).length===0,'conflict dismissed');await eventRow(a,t3+' B').first().waitFor();
for(const d of [b,c])await eventRow(d,t3+' B').first().waitFor();
pass('dismissing the reviewed change keeps the shared version on every device');
await a.p.setViewportSize({width:390,height:900});await a.p.getByRole('tab',{name:'Month',exact:true}).click();
await a.p.locator('.homi-calendar-month-dots').first().waitFor();assert.ok(await a.p.locator('.homi-calendar-month-dots[aria-label$="event"],.homi-calendar-month-dots[aria-label$="events"]').count()>0);pass('narrow month cells show coloured event dots with a count');
for(const width of [390,768,1440]){await a.p.setViewportSize({width,height:900});assert.equal(await a.p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await a.p.screenshot({path:ROOT+'/calendar-month-'+width+'.png',fullPage:true});}
pass('phone/tablet/desktop month layout has no horizontal overflow');
assert.deepEqual(errors,[]);pass('no JavaScript page errors');
writeFileSync(ROOT+'/browser-acceptance.json',JSON.stringify({date:new Date().toISOString(),run,results},null,2));
}catch(e){console.error(e);writeFileSync(ROOT+'/browser-failure.txt',String(e.stack));for(const [i,ctx]of contexts.entries()){try{const p=ctx.pages()[0];if(p){console.log('PAGE',i,(await p.locator('body').innerText()).slice(0,1500));await p.screenshot({path:ROOT+'/failure-'+i+'.png'});}}catch{}}process.exitCode=1;}finally{for(const ctx of contexts)await ctx.close().catch(()=>{});}
