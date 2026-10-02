// Universal search acceptance. Run only against an isolated localhost stack with
// Calendar, Chequebook and Shopping List installed, enabled and set up for the
// fixture household. All data is invented. HOMI_TEST_CREDENTIALS is a file with
// HOMI_BOOTSTRAP_EMAIL and HOMI_BOOTSTRAP_PASSWORD.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
const ROOT=new URL('./',import.meta.url).pathname;
const env=Object.fromEntries(readFileSync(process.env.HOMI_TEST_CREDENTIALS,'utf8').trim().split('\n').map(s=>{const i=s.indexOf('=');return [s.slice(0,i),s.slice(i+1).replace(/^"|"$/g,'')];}));
const base=process.env.HOMI_TEST_URL??'http://localhost:3400',profile=process.env.HOMI_TEST_PROFILES??'/tmp/homi-search-profile';
if(new URL(base).hostname!=='localhost')throw new Error('Acceptance fixtures require the isolated localhost test stack');
const run=Date.now().toString().slice(-7),token='Orchard'+run,errors=[],results=[],contexts=[];
const pass=s=>{results.push(s);console.log('PASS',s);};
const opts=offline=>({headless:true,viewport:{width:390,height:844},offline,executablePath:process.env.HOMI_TEST_CHROME??undefined});
let ctx,p;
async function launch(offline=false){ctx=await chromium.launchPersistentContext(profile,opts(offline));contexts.push(ctx);p=ctx.pages()[0]??await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));}
async function poll(fn,message,tries=45){let last;for(let i=0;i<tries;i++){try{last=await fn();if(last)return;}catch(e){last=e.message;}await new Promise(r=>setTimeout(r,1000));}throw new Error(message+': '+JSON.stringify(last));}
const dashboard=()=>p.getByRole('link',{name:/Current balance/});
async function login(){await p.goto(base);if(await p.getByLabel('Email',{exact:true}).count()){await p.getByLabel('Email',{exact:true}).fill(env.HOMI_BOOTSTRAP_EMAIL);await p.getByLabel('Password',{exact:true}).fill(env.HOMI_BOOTSTRAP_PASSWORD);await p.getByRole('button',{name:'Sign in',exact:true}).click();}await dashboard().waitFor({timeout:30000});}
async function home(){await p.goto(base);await dashboard().waitFor({timeout:30000});}
async function search(q){await p.getByRole('button',{name:'Search Homi',exact:true}).click();const box=p.getByRole('searchbox');await box.fill(q);return box;}
const group=name=>p.getByRole('region',{name});
const status=()=>p.locator('.homi-global-search__status');
try{
await launch();await login();
// Invented data in all three modules
await p.getByRole('link',{name:/Coming week/}).click();await p.getByRole('heading',{name:'Calendar',exact:true}).waitFor();await p.waitForTimeout(1000);
const evDate=new Date(Date.now()+40*864e5).toISOString().slice(0,10);
await p.getByRole('button',{name:'Add event',exact:true}).click();await p.locator('#calendar-editor-title').fill(token+' picnic');await p.locator('#calendar-editor-start').fill(evDate+'T09:00');await p.locator('#calendar-editor-end').fill(evDate+'T10:00');await p.getByRole('button',{name:'Save event',exact:true}).click();await p.waitForTimeout(1500);
await home();await p.getByRole('link',{name:/Current balance/}).click();await p.getByRole('heading',{name:'Chequebook',exact:true}).waitFor();
for(let i=0;i<8;i++){await p.getByRole('button',{name:'Add transaction',exact:true}).first().click();await p.locator('#cheq-account').waitFor();if(await p.locator('#cheq-account').inputValue())break;await p.getByRole('button',{name:'Cancel',exact:true}).click();await p.waitForTimeout(1000);}
await p.locator('#cheq-amount').fill('18.00');await p.locator('#cheq-description').fill(token+' cider');await p.getByRole('button',{name:'Save transaction',exact:true}).click();await p.getByRole('button',{name:new RegExp(token+' cider')}).first().waitFor();
await home();await p.getByRole('button',{name:/Open list$/}).click();await p.getByRole('heading',{name:'Shopping List',exact:true}).waitFor();
await p.getByRole('textbox',{name:'Add an item',exact:true}).fill(token+' apples');await p.getByRole('button',{name:'Add',exact:true}).click();await p.getByRole('checkbox',{name:token+' apples',exact:true}).waitFor();
await p.waitForTimeout(1500);
// 1. One control on the Dashboard finds results in every module, grouped
await home();assert.equal(await p.getByRole('button',{name:/Search/}).count(),1);
await search(token);
await group('Calendar events').getByRole('listitem').filter({hasText:token+' picnic'}).waitFor();
await group('Chequebook transactions').getByRole('listitem').filter({hasText:token+' cider'}).waitFor();
await group('Shopping list items').getByRole('listitem').filter({hasText:token+' apples'}).waitFor();
await poll(async()=>/^3 matches\./.test(await status().innerText()),'three matches');
pass('one Search control on the Dashboard finds the same word in Calendar, Chequebook and Shopping, grouped by module');
await p.screenshot({path:ROOT+'/universal-search-390.png'});
await p.getByRole('searchbox').fill('zz-no-such-thing-'+run);await poll(async()=>/No matches in any module/.test(await status().innerText()),'no matches message');
pass('a word that matches nothing says so');
// 2. Choosing a result opens that item in its module
await p.getByRole('searchbox').fill(token);await group('Calendar events').getByRole('listitem').filter({hasText:token+' picnic'}).click();
await p.getByRole('heading',{name:'Calendar',exact:true}).waitFor();
await poll(async()=>(await p.getByRole('tab',{name:'Day',exact:true}).getAttribute('aria-selected'))==='true'&&await p.getByText(token+' picnic').count(),'calendar day view of the event',20);
pass('choosing a Calendar result opens that day with the event');
await search(token);await group('Chequebook transactions').getByRole('listitem').filter({hasText:token+' cider'}).click();
await p.locator('#cheq-description').waitFor();assert.equal(await p.locator('#cheq-description').inputValue(),token+' cider');
pass('choosing a Chequebook result, searched from inside Calendar, opens that transaction for editing');
await p.getByRole('button',{name:'Cancel',exact:true}).click();
await search(token);await group('Shopping list items').getByRole('listitem').filter({hasText:token+' apples'}).click();
await p.getByRole('button',{name:'Save item',exact:true}).waitFor();assert.equal(await p.getByLabel('Item',{exact:true}).inputValue(),token+' apples');
pass('choosing a Shopping result opens that item for editing');
// 3. Search works from this device alone, fully offline after a restart
await ctx.close();await launch(true);await p.goto(base);await dashboard().waitFor({timeout:30000});await p.waitForTimeout(1500);
await search(token);await poll(async()=>/^3 matches\./.test(await status().innerText()),'offline matches');
pass('after a full browser restart while offline, Search still finds results in all three modules');
await p.getByRole('searchbox').fill(token);await group('Chequebook transactions').getByRole('listitem').first().click();await p.locator('#cheq-description').waitFor();
pass('and choosing an offline result still opens it');
// 4. Layout
for(const width of [390,768,1440]){await p.setViewportSize({width,height:900});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
pass('layout has no horizontal overflow at phone, tablet and desktop widths');
assert.deepEqual(errors,[]);pass('no JavaScript page errors');
writeFileSync(ROOT+'/universal-search-acceptance.json',JSON.stringify({date:new Date().toISOString(),run,results},null,2));
}catch(e){console.error(e);try{console.log('PAGE',(await p.locator('body').innerText()).replace(/\s+/g,' ').slice(0,500));}catch{}process.exitCode=1;}finally{for(const c of contexts)await c.close().catch(()=>{});}
