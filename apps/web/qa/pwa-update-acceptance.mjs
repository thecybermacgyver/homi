// PWA install and update acceptance. Run only against an isolated localhost
// acceptance stack (project name homipwa) that starts with Calendar 0.6.14 and
// Chequebook 0.1.15 installed, enabled and set up, and a production-identical
// web image (shell cache v19). A single persistent browser profile plays one
// installed device and is never cleared. The stack is upgraded over ssh:
//   HOMI_PWA_UPGRADE_CMD   installs the newer module packages and restarts Core
//   HOMI_PWA_SHELL_CMD     swaps the web container to a candidate shell image
// All data is invented. HOMI_TEST_CREDENTIALS is a file with
// HOMI_BOOTSTRAP_EMAIL and HOMI_BOOTSTRAP_PASSWORD.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
const ROOT=new URL('./',import.meta.url).pathname;
const env=Object.fromEntries(readFileSync(process.env.HOMI_TEST_CREDENTIALS,'utf8').trim().split('\n').map(s=>{const i=s.indexOf('=');return [s.slice(0,i),s.slice(i+1).replace(/^"|"$/g,'')];}));
const base=process.env.HOMI_TEST_URL??'http://localhost:3400',host=process.env.HOMI_TEST_SSH??'server';
const profile=process.env.HOMI_TEST_PROFILES??'/tmp/homi-pwa-profile';
if(new URL(base).hostname!=='localhost')throw new Error('Acceptance fixtures require the isolated localhost test stack');
const remote=cmd=>execFileSync('ssh',['-n','-o','BatchMode=yes',host,cmd],{encoding:'utf8',timeout:600000});
const run=Date.now().toString().slice(-7),errors=[],results=[],timings={};
const pass=s=>{results.push(s);console.log('PASS',s);};
const opts=offline=>({headless:true,viewport:{width:390,height:844},offline,executablePath:process.env.HOMI_TEST_CHROME??undefined});
let ctx,p;
async function launch(offline=false){ctx=await chromium.launchPersistentContext(profile,opts(offline));p=ctx.pages()[0]??await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));}
async function poll(fn,message,tries=90){let last;for(let i=0;i<tries;i++){try{last=await fn();if(last)return;}catch(e){last=e.message;}await new Promise(r=>setTimeout(r,1000));}throw new Error(message+': '+JSON.stringify(last));}
async function signedIn(){await p.getByRole('link',{name:/Current balance/}).waitFor({timeout:30000});}
async function login(){await p.goto(base);if(await p.getByLabel('Email',{exact:true}).count()){await p.getByLabel('Email',{exact:true}).fill(env.HOMI_BOOTSTRAP_EMAIL);await p.getByLabel('Password',{exact:true}).fill(env.HOMI_BOOTSTRAP_PASSWORD);await p.getByRole('button',{name:'Sign in',exact:true}).click();}await signedIn();}
async function open(name){await p.goto(base);await signedIn();await p.getByRole('link',{name}).click();}
const openCalendar=()=>open(/Coming week/).then(()=>p.getByRole('heading',{name:'Calendar',exact:true}).waitFor());
const openChequebook=()=>open(/Current balance/).then(()=>p.getByRole('heading',{name:'Chequebook',exact:true}).waitFor());
const loaded=()=>p.evaluate(()=>performance.getEntriesByType('resource').map(r=>new URL(r.name).pathname).filter(x=>/module-assets\/.+\/web\.js$/.test(x)).map(x=>x.replace('/api/v1/core/module-assets/','').replace('/dist/web.js','')).sort());
const shellInfo=()=>p.evaluate(async()=>{const reg=await navigator.serviceWorker.getRegistration();return {script:reg?.active?.scriptURL?.replace(location.origin,''),controlled:!!navigator.serviceWorker.controller,caches:(await caches.keys()).sort(),entry:[...document.scripts].map(s=>s.src).find(s=>/\/assets\/index-/.test(s))?.replace(location.origin,'')};});
const cachedModuleUrls=()=>p.evaluate(async()=>{const out=[];for(const k of await caches.keys()){const c=await caches.open(k);for(const r of await c.keys()){const u=new URL(r.url).pathname;if(/module-assets\/.+\/web\.js$/.test(u))out.push(k+' '+u.replace('/api/v1/core/module-assets/','').replace('/dist/web.js',''));}}return out.sort();});
const row=title=>p.getByRole('button',{name:new RegExp(title)});
async function addTransaction(title,amount){
  // Chequebook before 0.1.22 opens the form with no account if it loads before the accounts do: reopen until one is selected.
  for(let i=0;i<8;i++){await p.getByRole('button',{name:'Add transaction',exact:true}).first().click();await p.locator('#cheq-account').waitFor();if(await p.locator('#cheq-account').inputValue())break;await p.getByRole('button',{name:'Cancel',exact:true}).click();await p.waitForTimeout(1000);}
  await p.locator('#cheq-amount').fill(amount);await p.locator('#cheq-description').fill(title);
  // Chequebook 0.1.15 re-renders continuously, so a click can be lost: retry while the form is still open.
  for(let attempt=0;attempt<4;attempt++){const save=p.getByRole('button',{name:'Save transaction',exact:true});if(await save.count())await save.click({timeout:10000}).catch(()=>undefined);if(await row(title).first().waitFor({timeout:10000}).then(()=>true,()=>false))return;}
  await row(title).first().waitFor({timeout:5000});}
async function rows(store){return p.evaluate(async store=>{const db=await new Promise((res,rej)=>{const r=indexedDB.open('homi-client');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});return await new Promise((res,rej)=>{const r=db.transaction(store).objectStore(store).getAll();r.onsuccess=()=>{db.close();res(r.result)};r.onerror=()=>rej(r.error);});},store);}
try{
// 1. Installability and a controlling service worker
await launch();await login();await p.evaluate(()=>navigator.serviceWorker.ready);await p.reload();await signedIn();
const s1=await shellInfo();assert.equal(s1.controlled,true);assert.match(s1.script,/^\/sw\.js\?v=\d+$/);assert.ok(s1.caches.some(k=>/^homi-shell-v\d+$/.test(k)));
const mf=await p.evaluate(async()=>{const r=await fetch('/manifest.webmanifest');return {type:r.headers.get('content-type'),body:await r.json()};});
assert.match(mf.type,/application\/manifest\+json/);assert.ok(mf.body.name&&mf.body.short_name&&mf.body.start_url&&mf.body.scope);assert.match(mf.body.display,/standalone|minimal-ui|fullscreen/);
assert.ok(mf.body.icons.some(i=>/192/.test(i.sizes))&&mf.body.icons.some(i=>/512/.test(i.sizes)));
const cdp=await ctx.newCDPSession(p);const inst=await cdp.send('Page.getInstallabilityErrors').catch(()=>({installabilityErrors:null}));
assert.deepEqual(inst.installabilityErrors??[],[]);
pass('manifest is valid and Chrome reports no installability errors; a service worker controls the page ('+s1.script+', cache '+s1.caches.join(',')+')');
// 2. Baseline at the old module versions, with data and an offline restart
await openCalendar();await openChequebook();const t0='Before update '+run;await addTransaction(t0,'12.00');
const v0=await loaded();assert.ok(v0.some(x=>/^calendar\/0\.6\.14$/.test(x))&&v0.some(x=>/^chequebook\/0\.1\.15$/.test(x)),JSON.stringify(v0));
await p.evaluate(()=>navigator.serviceWorker.ready);await ctx.close();await launch(true);await p.goto(base);await signedIn();await openChequebook();await row(t0).first().waitFor();
pass('baseline: installed app runs Calendar 0.6.14 and Chequebook 0.1.15 and restarts fully offline with its data');
// 3. Work queued offline, then the server upgrades the modules while the device is offline
const t1='Edited during update '+run;await row(t0).first().click();await p.locator('#cheq-description').fill(t1);await p.getByRole('button',{name:'Save transaction',exact:true}).click();await row(t1).first().waitFor();
assert.ok((await rows('mutations')).some(m=>m.moduleKey==='chequebook'&&['queued','sending'].includes(m.status)));
console.log('upgrading modules on the server...');remote(process.env.HOMI_PWA_UPGRADE_CMD);
await p.waitForTimeout(3000);assert.ok((await loaded()).some(x=>/^chequebook\/0\.1\.15$/.test(x)));await row(t1).first().waitFor();
pass('a device offline during a module upgrade keeps working on the old version and keeps its queued change');
// 4. Reconnect: the open app switches to the new versions without a reload or cache clearing
await ctx.setOffline(false);const t=Date.now();
let auto=true;try{await poll(async()=>{const l=await p.evaluate(()=>performance.getEntriesByType('resource').map(r=>r.name).filter(n=>/module-assets\/chequebook\/0\.1\.21\/dist\/web\.js/.test(n)).length);return l>0;},'new chequebook version requested without reload',90);}catch{auto=false;}
timings.reconnectToNewVersionSeconds=auto?Math.round((Date.now()-t)/1000):null;
if(!auto){await openChequebook();}
await openCalendar();await openChequebook();
const v1=await loaded();assert.ok(v1.some(x=>/^calendar\/0\.6\.16$/.test(x))&&v1.some(x=>/^chequebook\/0\.1\.21$/.test(x)),JSON.stringify(v1));
await row(t1).first().waitFor();
await poll(async()=>!(await rows('mutations')).some(m=>m.moduleKey==='chequebook'&&['queued','sending'].includes(m.status)),'queued change delivered',60);
assert.deepEqual((await rows('mutations')).filter(m=>['conflict','rejected'].includes(m.status)),[]);
pass('after reconnect the app runs Calendar 0.6.16 and Chequebook 0.1.21 ('+(auto?'automatically within '+timings.reconnectToNewVersionSeconds+' s, no reload':'after the next open, no manual cache clearing')+'), still signed in, with its queued change delivered');
const cm=await cachedModuleUrls();assert.ok(cm.some(x=>/chequebook\/0\.1\.21/.test(x))&&cm.some(x=>/calendar\/0\.6\.16/.test(x)),JSON.stringify(cm));
await ctx.close();await launch(true);await p.goto(base);await signedIn();await openChequebook();await row(t1).first().waitFor();await openCalendar();
const v2=await loaded();assert.ok(v2.some(x=>/^calendar\/0\.6\.16$/.test(x)),JSON.stringify(v2));await ctx.close();await launch();
pass('the updated modules were cached automatically and the next fully offline start runs them');
// 5. Shell update: a candidate shell with a new service-worker cache replaces the installed one
await p.goto(base);await signedIn();const before=await shellInfo();console.log('swapping the web shell...');remote(process.env.HOMI_PWA_SHELL_CMD);
await p.goto(base);await signedIn();
await poll(async()=>{const s=await shellInfo();return s.script!==before.script&&!s.caches.includes(before.caches.find(k=>/^homi-shell-v\d+$/.test(k)));},'new service worker active and old shell cache removed',60);
const after=await shellInfo();assert.equal(after.controlled,true);assert.notEqual(after.entry,before.entry);assert.equal(after.caches.filter(k=>/^homi-shell-/.test(k)).length,1);
await signedIn();await openChequebook();await row(t1).first().waitFor();
pass('a new shell installs automatically on the next open ('+before.script+' -> '+after.script+', '+before.caches.filter(k=>/^homi-shell-/.test(k))+' replaced by '+after.caches.filter(k=>/^homi-shell-/.test(k))+', new app bundle), reloads itself, stays signed in, keeps data');
await ctx.close();await launch(true);await p.goto(base);await signedIn();await openChequebook();await row(t1).first().waitFor();await openCalendar();
const fin=await shellInfo();assert.equal(fin.script,after.script);
pass('the new shell and updated modules start fully offline');
assert.deepEqual(errors,[]);pass('no JavaScript page errors');
writeFileSync(ROOT+'/pwa-update-acceptance.json',JSON.stringify({date:new Date().toISOString(),run,timings,results},null,2));
}catch(e){console.error(e);try{console.log('PAGE',(await p.locator('body').innerText()).split('\n').filter(l=>/saved|queued|Synced|Offline|offline|error|could not|review|reject/i.test(l)).join(' | ').slice(0,400));console.log('SHELL',JSON.stringify(await shellInfo()));}catch{}process.exitCode=1;}finally{await ctx?.close().catch(()=>{});}
