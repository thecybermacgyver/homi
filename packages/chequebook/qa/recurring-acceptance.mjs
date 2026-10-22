// Chequebook "Coming up" acceptance: late items turn red and stay postable,
// a hand-entered register transaction is detected and can be marked Posted,
// items can be skipped and restored, and the state is shared by every device.
// Run only against the isolated localhost acceptance stack (see README.md).
// All data is invented.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
const ROOT=new URL('./',import.meta.url).pathname;
const env=Object.fromEntries(readFileSync(process.env.HOMI_TEST_CREDENTIALS,'utf8').trim().split('\n').map(s=>{const i=s.indexOf('=');return [s.slice(0,i),s.slice(i+1).replace(/^"|"$/g,'')];}));
const run=Date.now().toString().slice(-7),base=process.env.HOMI_TEST_URL??'http://localhost:3400';
const profiles=process.env.HOMI_TEST_PROFILES??'/tmp/homi-chequebook-recurring-profiles';
if(new URL(base).hostname!=='localhost')throw new Error('Acceptance fixtures require the isolated localhost test stack');
const contexts=[],errors=[],results=[];
const pass=s=>{results.push(s);console.log('PASS',s);};
const opts={headless:true,viewport:{width:390,height:844},executablePath:process.env.HOMI_TEST_CHROME??undefined};
const ago=n=>{const d=new Date();d.setUTCDate(d.getUTCDate()-n);return d.toISOString().slice(0,10);};
async function launch(label){const ctx=await chromium.launchPersistentContext(profiles+'/profile-'+label+'-'+run,opts);contexts.push(ctx);const p=ctx.pages()[0]??await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));return {ctx,p};}
const entry=d=>d.p.getByRole('link',{name:/Current balance/});
async function login(d){await d.p.goto(base);await d.p.getByLabel('Email',{exact:true}).fill(env.HOMI_BOOTSTRAP_EMAIL);await d.p.getByLabel('Password',{exact:true}).fill(env.HOMI_BOOTSTRAP_PASSWORD);await d.p.getByRole('button',{name:'Sign in',exact:true}).click();await entry(d).waitFor({timeout:20000});}
async function open(d){await entry(d).click();await d.p.getByRole('heading',{name:'Chequebook',exact:true}).waitFor();await d.p.waitForTimeout(800);}
async function tab(d,name){await d.p.getByRole('tab',{name,exact:true}).or(d.p.getByRole('button',{name,exact:true})).first().click();await d.p.waitForTimeout(500);}
async function poll(fn,message,tries=45){let last;for(let i=0;i<tries;i++){try{last=await fn();if(last)return;}catch(e){last=e.message;}await new Promise(r=>setTimeout(r,1000));}throw new Error(message+': '+JSON.stringify(last));}
const coming=d=>d.p.locator('.cheq-row').filter({has:d.p.getByRole('button',{name:'Skip',exact:true})});
const item=(d,label,date)=>coming(d).filter({hasText:label}).filter(date?{hasText:date}:{});
async function addRule(d,label,amount,start,frequency){await tab(d,'Recurring');await d.p.getByRole('button',{name:'+ Recurring',exact:true}).click();await d.p.locator('#cheq-rec-label').fill(label);await d.p.locator('#cheq-rec-amount').fill(amount);await d.p.locator('#cheq-rec-start').fill(start);await d.p.locator('#cheq-rec-frequency').selectOption(frequency);await d.p.getByRole('button',{name:'Save recurring transaction',exact:true}).click();await d.p.getByRole('button',{name:'Save recurring transaction',exact:true}).waitFor({state:'detached'});await d.p.waitForTimeout(1200);}
async function addTx(d,title,amount,date){await tab(d,'Register');await d.p.getByRole('button',{name:'Add transaction',exact:true}).first().click();await d.p.locator('#cheq-amount').fill(amount);await d.p.locator('#cheq-description').fill(title);await d.p.locator('#cheq-date').fill(date);await d.p.getByRole('button',{name:'Save transaction',exact:true}).click();await d.p.getByRole('button',{name:'Save transaction',exact:true}).waitFor({state:'detached'});await d.p.waitForTimeout(1500);}
const api=(d,path)=>d.p.evaluate(async path=>{const db=await new Promise((res,rej)=>{const r=indexedDB.open('homi-client');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});const meta=await new Promise((res,rej)=>{const r=db.transaction('meta').objectStore('meta').getAll();r.onsuccess=()=>{db.close();res(r.result)};r.onerror=()=>rej(r.error);});const id=JSON.parse(meta.find(r=>r.key==='activeOfflineContext').value);const r=await fetch(path,{headers:{'X-Homi-Household-ID':id.householdId,'X-Homi-Client-ID':id.clientId}});return (await r.json()).data;},path);
const balance=async d=>Math.round(Number((await api(d,'/api/v1/modules/chequebook/summary?month='+new Date().toISOString().slice(0,7)+'-01&asOf='+ago(0))).currentBalance)*100);
try{
const a=await launch('a'),b=await launch('b');
await login(a);await login(b);await open(a);await open(b);
const gymAmt=(10+Number(run)%80)+'.37',gymCents=Number(gymAmt.replace('.',''));
const rent='Rent '+run,gym='Gym '+run,phone='Phone '+run,ins='Insurance '+run;
await addRule(a,rent,'30.00',ago(10),'weekly');
await addRule(a,gym,gymAmt,ago(20),'monthly');
await addRule(a,phone,'45.00',ago(15),'monthly');
await addRule(a,ins,'22.00',ago(12),'monthly');
await poll(async()=>await item(a,rent).count()>=2,'recurring items listed');

// 1. late items stay listed, red, labelled, with Post
const lateGym=item(a,gym,ago(20));
await lateGym.first().waitFor();
assert.match(await lateGym.first().innerText(),/LATE/);
assert.ok(await lateGym.first().evaluate(el=>el.classList.contains('is-late')));
const border=await lateGym.first().evaluate(el=>getComputedStyle(el).borderTopColor);
assert.notEqual(border,'rgba(0, 0, 0, 0)');
assert.ok(await lateGym.first().getByRole('button',{name:'Post',exact:true}).isVisible());
const rentRows=item(a,rent);const n=await rentRows.count();
let late=0;for(let i=0;i<n;i++)if(/LATE/.test(await rentRows.nth(i).innerText()))late++;
assert.equal(late,2);assert.ok(n>late,'a future occurrence is not marked late');
pass('overdue recurring items stay in Coming up, turn red, say LATE and keep a Post button; future ones are not late');

// 2. hand-entered register transaction is detected and can be marked Posted
const bal0=await balance(a);
const manual='Gym fee manual '+run;await addTx(a,manual,gymAmt,ago(19));
const bal1=await balance(a);assert.equal(bal1,bal0-gymCents);
await tab(a,'Recurring');
await poll(async()=>/Register has/.test(await item(a,gym,ago(20)).first().innerText()),'register match suggested');
assert.match(await item(a,gym,ago(20)).first().innerText(),new RegExp(manual));
assert.equal(await item(a,phone,ago(15)).first().innerText().then(t=>/Register has/.test(t)),false);
pass('a hand-entered register transaction with the same amount and account is offered as a match; unrelated items are not');
await item(a,gym,ago(20)).first().getByRole('button',{name:'Posted',exact:true}).click();
await poll(async()=>await item(a,gym,ago(20)).count()===0,'linked item leaves Coming up');
assert.equal(await balance(a),bal1);
pass('Posted links the register entry, removes the item and changes no balance');

// 3. skip, persistence on another device, restore
await item(a,phone,ago(15)).first().getByRole('button',{name:'Skip',exact:true}).click();
await poll(async()=>await item(a,phone,ago(15)).count()===0,'skipped item leaves Coming up');
await a.p.getByText(/^Skipped \(1\)/).waitFor();
await b.p.reload();await entry(b).waitFor({timeout:20000});await open(b);await tab(b,'Recurring');
await poll(async()=>await item(b,gym,ago(20)).count()===0&&await item(b,phone,ago(15)).count()===0,'second device sees the same state');
await b.p.getByText(/Skipped \(\d+\)/).waitFor();
pass('Skip removes the item, lists it under Skipped, and a second device sees the linked and skipped state');
await a.p.getByText(/^Skipped \(1\)/).click();
await a.p.locator('details .cheq-row').filter({hasText:phone}).getByRole('button',{name:'Restore',exact:true}).click();
await poll(async()=>await item(a,phone,ago(15)).count()===1,'restored item returns');
assert.match(await item(a,phone,ago(15)).first().innerText(),/LATE/);
pass('Restore returns a skipped item to Coming up, still marked late');

// 4. Post still works from the row and removes the item
await item(a,ins,ago(12)).first().getByRole('button',{name:'Post',exact:true}).click();
await a.p.getByRole('button',{name:'Post transaction',exact:true}).click();
await a.p.getByRole('button',{name:'Post transaction',exact:true}).waitFor({state:'detached'});
await poll(async()=>await item(a,ins,ago(12)).count()===0,'posted item leaves Coming up');
assert.equal(await balance(a),bal1-2200);
pass('Post from a late row creates the transaction, updates the balance and removes the item');

// 5. deleting the linked register entry reopens the item
await tab(a,'Register');await a.p.getByRole('button',{name:new RegExp(manual)}).first().click();
await a.p.getByRole('button',{name:'Delete',exact:true}).click();
await a.p.getByRole('button',{name:new RegExp(manual)}).first().waitFor({state:'detached'});
await tab(a,'Recurring');
await poll(async()=>await item(a,gym,ago(20)).count()===1,'deleting the linked entry reopens the item',60);
pass('deleting the linked register entry reopens the item in Coming up');

// 6. layout and errors
for(const w of [390,768,1440]){await a.p.setViewportSize({width:w,height:900});await a.p.waitForTimeout(400);assert.ok(await a.p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'horizontal overflow at '+w);}
await a.p.setViewportSize({width:390,height:844});await a.p.screenshot({path:ROOT+'chequebook-coming-up-390.png',fullPage:true});
pass('Coming up has no horizontal overflow at phone, tablet and desktop widths');
assert.deepEqual(errors,[]);pass('no JavaScript page errors');
writeFileSync(ROOT+'recurring-acceptance.json',JSON.stringify({suite:'chequebook-coming-up-1.0.0',version:'0.1.30',date:new Date().toISOString(),passed:results.length,results},null,2)+'\n');
console.log('PASSED',results.length);
}catch(e){console.error('FAIL',e);for(const d of contexts){for(const p of d.pages()){try{console.log('URL',p.url());console.log((await p.locator('body').innerText()).slice(0,1200));}catch{}}}process.exitCode=1;}
finally{for(const c of contexts)await c.close().catch(()=>{});}
