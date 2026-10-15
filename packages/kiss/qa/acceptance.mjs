// Two-account K.I.S.S. acceptance. Run only against the isolated localhost
// acceptance stack with K.I.S.S. installed and enabled for the fixture
// household, the fixture owner (administrator, not a partner) and two further
// members (calendar-second@ and noticeboard-second@example.invalid, same
// password) who become the partners. All data is invented.
//   HOMI_TEST_CREDENTIALS=... HOMI_TEST_PROFILES=<fresh dir> HOMI_TEST_CHROME=/usr/bin/google-chrome \
//     HOMI_TEST_URL=http://localhost:3200 node packages/kiss/qa/acceptance.mjs
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
const ROOT=new URL('./',import.meta.url).pathname;
const env=Object.fromEntries(readFileSync(process.env.HOMI_TEST_CREDENTIALS,'utf8').trim().split('\n').map(s=>{const i=s.indexOf('=');return [s.slice(0,i),s.slice(i+1).replace(/^"|"$/g,'')];}));
const base=process.env.HOMI_TEST_URL??'http://localhost:3200';
if(new URL(base).hostname!=='localhost')throw new Error('Acceptance fixtures require the isolated localhost test stack');
const profiles=process.env.HOMI_TEST_PROFILES??'/tmp/homi-kiss-profiles';
const run=Date.now().toString().slice(-7);
const PW=env.HOMI_BOOTSTRAP_PASSWORD,errors=[],results=[],contexts=[];
const pass=s=>{results.push(s);console.log('PASS',s);};
const SECRET='Secret answer '+run, NOTE='Love note '+run;
async function launch(label,width=390){const ctx=await chromium.launchPersistentContext(profiles+'/p-'+label+'-'+run,{headless:true,viewport:{width,height:844},executablePath:process.env.HOMI_TEST_CHROME??undefined});contexts.push(ctx);const p=ctx.pages()[0]??await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));return {ctx,p};}
async function login(d,email){await d.p.goto(base);await d.p.getByLabel('Email',{exact:true}).fill(email);await d.p.getByLabel('Password',{exact:true}).fill(PW);await d.p.getByRole('button',{name:'Sign in',exact:true}).click();await d.p.getByLabel('Email',{exact:true}).waitFor({state:'detached',timeout:20000}).catch(async e=>{throw new Error('sign-in failed for '+email+': '+(await d.p.locator('body').innerText()).slice(0,300));});await d.p.waitForTimeout(800);}
async function openKiss(d){await d.p.goto(base);await d.p.getByRole('button',{name:/Modules/}).first().click();await d.p.getByRole('dialog').getByRole('button',{name:'K.I.S.S.'}).first().click();await d.p.getByRole('heading',{name:'K.I.S.S.',exact:true}).waitFor({timeout:20000});await d.p.waitForTimeout(800);}
async function api(d,path){return d.p.evaluate(async path=>{const hh=(await (await fetch('/api/v1/core/households',{credentials:'include'})).json()).data.households[0].householdId;const r=await fetch('/api/v1/modules/kiss'+path,{credentials:'include',headers:{'X-Homi-Household-ID':hh}});return {status:r.status,text:await r.text()};},path);}
async function poll(fn,message,tries=30){let last;for(let i=0;i<tries;i++){try{last=await fn();if(last)return;}catch(e){last=e.message;}await new Promise(r=>setTimeout(r,1000));}throw new Error(message+': '+JSON.stringify(last));}
const tab=(d,name)=>d.p.getByRole('tab',{name,exact:true});
try{
const admin=await launch('admin'),a=await launch('a'),b=await launch('b');
await login(admin,env.HOMI_BOOTSTRAP_EMAIL);await login(a,'calendar-second@example.invalid');await login(b,'noticeboard-second@example.invalid');
await openKiss(admin);
assert.equal(await tab(admin,'Today').count(),0);
pass('before pairing the administrator sees only Settings, with no private tabs');
await tab(admin,'Settings').click().catch(()=>{});
await admin.p.getByLabel('First partner').selectOption({label:'calendar-second'});
await admin.p.getByLabel('Second partner').selectOption({label:'noticeboard-second'});
await admin.p.getByRole('button',{name:'Start K.I.S.S.'}).click();
await openKiss(a);await openKiss(b);
await poll(async()=>await tab(a,'Today').count(),'partner A sees the tabs');await poll(async()=>await tab(b,'Today').count(),'partner B sees the tabs');
pass('the administrator pairs two members and both partners get the full space');
await openKiss(admin);assert.equal(await tab(admin,'Today').count(),0);
pass('the administrator, who is not a partner, still sees no private tabs');
// answer reveal
await a.p.getByLabel(/Your answer/).fill(SECRET);await a.p.getByRole('button',{name:'Lock in my answer'}).click();
await a.p.getByText('Your answer is locked in.').waitFor();
await a.p.getByRole('status').filter({hasText:/Waiting for/}).waitFor();
pass('partner A locks in an answer and sees the waiting state');
await openKiss(b);
const bAnswers=await api(b,'/answers'),adAnswers=await api(admin,'/answers');
assert.equal(bAnswers.status,200);assert(!bAnswers.text.includes(SECRET),'B must not receive A\'s answer before answering');
assert(!adAnswers.text.includes(SECRET),'administrator must not receive the answer');
assert(!(await b.p.content()).includes(SECRET));
pass('the partner\'s answer is withheld by the server until the other has answered (partner and administrator)');
await b.p.getByLabel(/Your answer/).fill('Reply '+run);await b.p.getByRole('button',{name:'Lock in my answer'}).click();
await b.p.getByText('Both answered',{exact:true}).waitFor({timeout:20000});
await b.p.getByText(SECRET).waitFor();
await openKiss(a);await a.p.getByText('Both answered',{exact:true}).waitFor({timeout:20000});await a.p.getByText('Reply '+run).waitFor();
pass('once both answered each sees both answers with a Vibe Match');
await a.p.getByRole('img',{name:/Streak: 1 day/}).waitFor();
pass('the streak heart shows a 1 day streak after both answered');
const adAfter=await api(admin,'/answers');assert(!adAfter.text.includes(SECRET)&&!adAfter.text.includes('Reply '+run));
pass('the administrator still receives neither answer');
// check-in
await tab(a,'Check-in').click();await a.p.getByRole('button',{name:'Share check-in'}).click();
await poll(async()=>(await api(b,'/checkins')).text.includes('battery'),'partner sees the check-in');
const adCheck=await api(admin,'/checkins');assert(!adCheck.text.includes('battery'));
pass('a check-in reaches the partner and not the administrator');
// love note
await tab(a,'Notes').click();await a.p.getByLabel(/A note for/).fill(NOTE);await a.p.getByRole('button',{name:'Drop in the jar'}).click();
await openKiss(b);await tab(b,'Notes').click();await b.p.getByText(NOTE).waitFor({timeout:20000});
assert(!(await api(admin,'/notes')).text.includes(NOTE));
pass('a love note reaches the partner and not the administrator');
// other tabs render
for(const t of ['Dates','Quizzes','Passion']){await tab(b,t).click();await b.p.waitForTimeout(500);}
pass('Dates, Quizzes and Passion tabs open without errors');
// PIN
await tab(a,'Settings').click();await a.p.getByLabel('Set a PIN').fill('4321');await a.p.getByRole('button',{name:'Save PIN'}).click();
await a.p.getByText('PIN set for this device.').waitFor();
await a.p.getByRole('button',{name:'Hide screen now'}).click();await a.p.getByRole('heading',{name:'Private'}).waitFor();
assert(!(await a.p.content()).includes('Reply '+run));
await a.p.locator('#kiss-pin').fill('0000');await a.p.getByRole('button',{name:'Unlock'}).click();await a.p.getByText('That PIN is not right.').waitFor();
await a.p.locator('#kiss-pin').fill('4321');await a.p.getByRole('button',{name:'Unlock'}).click();await tab(a,'Today').waitFor();
pass('the PIN hides the screen, rejects a wrong PIN and unlocks with the right one');
// layout
for(const w of [390,768,1440]){await a.p.setViewportSize({width:w,height:900});await a.p.waitForTimeout(300);
  const over=await a.p.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);assert(over<=1,`horizontal overflow ${over}px at ${w}`);}
await a.p.setViewportSize({width:390,height:900});
await a.p.screenshot({path:ROOT+'kiss-today-390.png'});
assert.equal(errors.length,0,errors.join('; '));
pass('no horizontal overflow at 390, 768 and 1440 px and no page errors');
writeFileSync(ROOT+'browser-acceptance.json',JSON.stringify({suite:'kiss-two-account',date:new Date().toISOString(),passed:results},null,2)+'\n');
console.log('PASS_KISS_ACCEPTANCE',results.length);
}catch(e){console.error('FAIL',e.message);for(const c of contexts){const p=c.pages()[0];if(p)console.error((await p.evaluate(()=>document.body.innerText).catch(()=>'')).slice(0,600));}process.exitCode=1;}
finally{for(const c of contexts)await c.close().catch(()=>{});}
