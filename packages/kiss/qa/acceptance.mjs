// Two-account K.I.S.S. acceptance. Run only against the isolated localhost
// acceptance stack with K.I.S.S. installed and enabled for the fixture
// household, the fixture owner (administrator, not a partner) and two further
// members (calendar-second@ and noticeboard-second@example.invalid, same
// password) who become the partners. All data is invented.
//   HOMI_TEST_CREDENTIALS=... HOMI_TEST_PROFILES=<fresh dir> HOMI_TEST_CHROME=/usr/bin/google-chrome \
//     HOMI_TEST_STACK_DIR=<stack compose dir> [HOMI_TEST_SSH=<host>] \
//     HOMI_TEST_URL=http://localhost:3200 node packages/kiss/qa/acceptance.mjs
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const ROOT=new URL('./',import.meta.url).pathname;
const env=Object.fromEntries(readFileSync(process.env.HOMI_TEST_CREDENTIALS,'utf8').trim().split('\n').map(s=>{const i=s.indexOf('=');return [s.slice(0,i),s.slice(i+1).replace(/^"|"$/g,'')];}));
const base=process.env.HOMI_TEST_URL??'http://localhost:3200';
if(new URL(base).hostname!=='localhost')throw new Error('Acceptance fixtures require the isolated localhost test stack');
const profiles=process.env.HOMI_TEST_PROFILES??'/tmp/homi-kiss-profiles';
const run=Date.now().toString().slice(-7);
const PW=env.HOMI_BOOTSTRAP_PASSWORD,errors=[],results=[],contexts=[];
const pass=s=>{results.push(s);console.log('PASS',s);};
const SECRET='Secret answer '+run, NOTE='Love note '+run;
const ago=n=>new Date(Date.now()-n*86400000).toISOString().slice(0,10);
// Past-week fixtures are written straight to the isolated stack's database. HOMI_TEST_SSH is the ssh host that runs the stack
// and HOMI_TEST_STACK_DIR its compose directory; with no HOMI_TEST_SSH the stack is local.
const sql=q=>{const cmd='cd '+process.env.HOMI_TEST_STACK_DIR+' && docker compose exec -T db psql -U homi_bootstrap -d homi -At -v ON_ERROR_STOP=1';
  return (process.env.HOMI_TEST_SSH?execFileSync('ssh',[process.env.HOMI_TEST_SSH,cmd],{input:q}):execFileSync('sh',['-c',cmd],{input:q})).toString();};
if(!process.env.HOMI_TEST_STACK_DIR)throw new Error('Set HOMI_TEST_STACK_DIR to the isolated stack compose directory');
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
await admin.p.getByLabel('Together since').fill(ago(5));
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
// past week
const seed=(day,who,body)=>`insert into mod_kiss.answers (id,household_id,day,question_id,body,resonance,author_person_id) select gen_random_uuid(),p.household_id,current_date-${day},'l-1','${body}',3,p.id from core.household_people p where p.display_name='${who}';`;
const PAST3A='Three days ago A '+run,PAST3B='Three days ago B '+run,PAST2B='Hidden past B '+run,PAST2A='Catching up A '+run;
sql(seed(3,'calendar-second',PAST3A)+seed(3,'noticeboard-second',PAST3B)+seed(2,'noticeboard-second',PAST2B));
await openKiss(a);
const week=a.p.locator('section[aria-label="The past week"]'),rows=week.locator('button.kiss-chip');
await week.waitFor({timeout:20000});
assert.equal(await rows.count(),5,'five days since the pairing began, today excluded');
assert.match(await rows.nth(2).innerText(),/Both answered/);assert.match(await rows.nth(1).innerText(),/Not answered yet/);
pass('the past week lists each day since the pairing began, newest first, with its status');
await rows.nth(2).click();await week.getByText(PAST3A).waitFor();await week.getByText(PAST3B).waitFor();
pass('a day both answered shows both answers');
const hidden=await api(a,'/answers');assert(!hidden.text.includes(PAST2B),'A must not receive B\'s past answer before answering that day');
assert(!(await a.p.content()).includes(PAST2B));
pass('a partner\'s answer for a day you missed stays withheld by the server');
await rows.nth(1).click();await a.p.locator('#kiss-past-'+ago(2)).fill(PAST2A);
await week.getByRole('button',{name:'Lock in my answer'}).click();
await week.getByText(PAST2B).waitFor({timeout:20000});
assert.match(await rows.nth(1).innerText(),/Both answered/);
pass('catching up on a missed day opens the partner\'s answer for that day');
await rows.nth(0).click();await a.p.locator('#kiss-past-'+ago(1)).fill('Yesterday '+run);
await week.getByRole('button',{name:'Lock in my answer'}).click();
await week.getByText('has not answered this one',{exact:false}).waitFor({timeout:20000});
const adPast=await api(admin,'/answers');assert(!adPast.text.includes(PAST2A)&&!adPast.text.includes(PAST2B)&&!adPast.text.includes(PAST3A));
pass('a caught-up day with no reply waits for the partner, and the administrator receives none of the past answers');
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
