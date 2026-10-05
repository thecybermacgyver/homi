// Authenticated accessibility pass. Run only against an isolated localhost stack
// with Calendar, Chequebook, Shopping List, Noticeboard and Meal Planner installed, enabled and set up for
// the fixture household. All data is invented. It runs the axe engine (WCAG 2.0
// and 2.1 A/AA rules) on every signed-in screen at phone, tablet and desktop
// widths in light and dark colour schemes, then checks keyboard behaviour.
import {chromium} from 'playwright';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
const require=createRequire(import.meta.url);
const AXE=readFileSync(require.resolve('axe-core/axe.min.js'),'utf8');
const ROOT=new URL('./',import.meta.url).pathname;
const env=Object.fromEntries(readFileSync(process.env.HOMI_TEST_CREDENTIALS,'utf8').trim().split('\n').map(s=>{const i=s.indexOf('=');return [s.slice(0,i),s.slice(i+1).replace(/^"|"$/g,'')];}));
const base=process.env.HOMI_TEST_URL??'http://localhost:3400',profile=process.env.HOMI_TEST_PROFILES??'/tmp/homi-a11y-profile';
if(new URL(base).hostname!=='localhost')throw new Error('Acceptance fixtures require the isolated localhost test stack');
const run=Date.now().toString().slice(-6),violations=new Map(),checked=[],keyboard=[];
const WIDTHS=[390,768,1440],SCHEMES=['light','dark'];
let ctx,p;
async function launch(){ctx=await chromium.launchPersistentContext(profile,{headless:true,viewport:{width:390,height:844},executablePath:process.env.HOMI_TEST_CHROME??undefined});p=ctx.pages()[0]??await ctx.newPage();}
async function login(){await p.goto(base);if(await p.getByLabel('Email',{exact:true}).count()){await p.getByLabel('Email',{exact:true}).fill(env.HOMI_BOOTSTRAP_EMAIL);await p.getByLabel('Password',{exact:true}).fill(env.HOMI_BOOTSTRAP_PASSWORD);await p.getByRole('button',{name:'Sign in',exact:true}).click();}await p.getByRole('link',{name:/Current balance/}).waitFor({timeout:30000});}
async function scan(name){
  await p.waitForTimeout(700);
  const r=await p.evaluate(async src=>{if(!window.axe)(0,eval)(src);return await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']},resultTypes:['violations']});},AXE);
  for(const v of r.violations){const key=v.id;const entry=violations.get(key)??{id:v.id,impact:v.impact,help:v.help,url:v.helpUrl,nodes:new Map()};for(const n of v.nodes){const k=n.target.join(' ');const list=entry.nodes.get(k)??{html:n.html.slice(0,160),summary:(n.any[0]?.message||n.all[0]?.message||n.none[0]?.message||'').slice(0,160),screens:[]};list.screens.push(name);entry.nodes.set(k,list);}violations.set(key,entry);}
  checked.push(name);
}
async function screens(scheme,width){
  await p.emulateMedia({colorScheme:scheme,reducedMotion:'no-preference'});await p.setViewportSize({width,height:900});
  const tag=`${scheme} ${width}px`;
  await p.goto(base);await p.getByRole('link',{name:/Current balance/}).waitFor();await scan(`Dashboard (${tag})`);
  await p.getByRole('button',{name:'Modules'}).click();await p.waitForTimeout(800);await scan(`Modules (${tag})`);
  await p.getByRole('button',{name:'Settings'}).click();await p.waitForTimeout(800);await scan(`Settings (${tag})`);
  await p.goto(base);await p.getByRole('link',{name:/Coming week/}).click();await p.getByRole('heading',{name:'Calendar',exact:true}).waitFor();
  for(const view of ['Day','Week','Month','Upcoming']){await p.getByRole('tab',{name:view,exact:true}).click();await scan(`Calendar ${view} (${tag})`);}
  await p.getByRole('button',{name:'Add event',exact:true}).click();await p.locator('#calendar-editor-title').waitFor();await scan(`Calendar event form (${tag})`);await p.getByRole('button',{name:'Cancel',exact:true}).click();
  await p.goto(base);await p.getByRole('link',{name:/Current balance/}).click();await p.getByRole('heading',{name:'Chequebook',exact:true}).waitFor();await p.waitForTimeout(1200);
  await scan(`Chequebook register (${tag})`);
  for(const tab of ['Recurring','Budget','Analytics']){await p.getByRole('tab',{name:tab,exact:true}).click();await scan(`Chequebook ${tab} (${tag})`);}
  await p.getByRole('tab',{name:'Register',exact:true}).click();await p.getByRole('button',{name:'Add transaction',exact:true}).first().click();await p.locator('#cheq-amount').waitFor();await scan(`Chequebook transaction form (${tag})`);await p.getByRole('button',{name:'Cancel',exact:true}).click();
  await p.goto(base);await p.getByRole('button',{name:/Open list$/}).click();await p.getByRole('heading',{name:'Shopping List',exact:true}).waitFor();await scan(`Shopping List (${tag})`);
  await p.goto(base);await p.getByRole('button',{name:'Add a notice',exact:true}).waitFor();await scan(`Dashboard with Noticeboard card (${tag})`);
  await p.getByRole('button',{name:'Add a notice',exact:true}).click();await p.getByLabel('Title',{exact:true}).waitFor();await scan(`Noticeboard add sheet on the card (${tag})`);await p.keyboard.press('Escape');
  await p.getByRole('button',{name:'Open all notices',exact:true}).click();await p.getByRole('heading',{name:'Noticeboard',exact:true}).waitFor();await p.waitForTimeout(800);await scan(`Noticeboard (${tag})`);
  await p.locator('.nb-row').first().click();await p.getByRole('dialog').waitFor();await scan(`Noticeboard notice sheet (${tag})`);await p.getByRole('button',{name:'Done',exact:true}).click();
  await p.goto(base);await p.locator('.mp-row').first().waitFor({timeout:30000});await scan(`Dashboard with Meal Planner card (${tag})`);
  await p.locator('.mp-row').first().click();await p.getByRole('dialog').waitFor();await scan(`Meal Planner day sheet (${tag})`);await p.getByRole('button',{name:'Done',exact:true}).click();
  await p.getByRole('button',{name:'Open planner',exact:true}).click();await p.getByRole('heading',{name:'Meal Planner',exact:true}).waitFor();await p.waitForTimeout(800);await scan(`Meal Planner (${tag})`);
  await p.getByRole('button',{name:'Plan a meal',exact:true}).click();await p.locator('#mp-title').waitFor();await scan(`Meal Planner meal sheet (${tag})`);await p.keyboard.press('Escape');
  await p.locator('.mp-toolbar').getByRole('button',{name:'Settings',exact:true}).click();await p.getByRole('dialog').waitFor();await scan(`Meal Planner settings (${tag})`);await p.keyboard.press('Escape');
  await p.getByRole('tab',{name:'Meal ideas',exact:true}).click();await p.waitForTimeout(500);await scan(`Meal Planner ideas (${tag})`);
  // Empty states: a Calendar week and a Chequebook month with nothing in them, and Shopping's empty Checked tab
  await p.goto(base);await p.getByRole('link',{name:/Coming week/}).click();await p.getByRole('heading',{name:'Calendar',exact:true}).waitFor();await p.getByRole('tab',{name:'Week',exact:true}).click();for(let i=0;i<30;i++)await p.getByRole('button',{name:'Next',exact:true}).click();await scan(`Calendar empty week (${tag})`);
  await p.goto(base);await p.getByRole('link',{name:/Current balance/}).click();await p.getByRole('heading',{name:'Chequebook',exact:true}).waitFor();await p.waitForTimeout(1000);for(let i=0;i<8;i++)await p.getByRole('button',{name:'‹',exact:true}).click();await p.getByText('No transactions this month').waitFor();await scan(`Chequebook empty month (${tag})`);
  await p.goto(base);await p.getByRole('button',{name:/Open list$/}).click();await p.getByRole('heading',{name:'Shopping List',exact:true}).waitFor();await p.getByRole('button',{name:/^Checked \(/}).click();await scan(`Shopping empty Checked tab (${tag})`);
  await p.goto(base);await p.getByRole('link',{name:/Current balance/}).waitFor();
  await p.getByRole('button',{name:'Search Homi',exact:true}).click();await p.getByRole('searchbox').fill('a');await p.waitForTimeout(800);await scan(`Search sheet (${tag})`);await p.keyboard.press('Escape');
}
async function keyboardChecks(){
  await p.emulateMedia({colorScheme:'light',reducedMotion:'reduce'});await p.setViewportSize({width:390,height:844});
  const focusName=()=>p.evaluate(()=>{const e=document.activeElement;if(!e||e===document.body)return null;return (e.getAttribute('aria-label')||e.textContent||e.id||e.tagName).trim().slice(0,40);});
  const focusVisible=()=>p.evaluate(()=>{const e=document.activeElement;if(!e||e===document.body)return false;const s=getComputedStyle(e);return (s.outlineStyle!=='none'&&parseFloat(s.outlineWidth)>0)||s.boxShadow!=='none';});
  await p.goto(base);await p.getByRole('link',{name:/Current balance/}).waitFor();
  // 1. Tab reaches every control with a visible focus indicator and never gets stuck
  const seen=[];let bad=[];for(let i=0;i<40;i++){await p.keyboard.press('Tab');const n=await focusName();if(n===null)break;seen.push(n);if(!(await focusVisible()))bad.push(n);}
  keyboard.push({check:'Tab order on the Dashboard reaches controls and each shows a visible focus indicator',ok:seen.length>=5&&bad.length===0,detail:`${seen.length} stops${bad.length?'; no visible focus on: '+bad.join(', '):''}`});
  // 2. Icon-only controls have accessible names
  const unnamed=await p.evaluate(()=>[...document.querySelectorAll('button,a,[role=button],input,select')].filter(e=>{const n=(e.getAttribute('aria-label')||e.getAttribute('aria-labelledby')||e.textContent||e.getAttribute('title')||'').trim();const labelled=e.labels&&e.labels.length>0;return !n&&!labelled&&e.type!=='hidden'&&getComputedStyle(e).display!=='none';}).map(e=>e.outerHTML.slice(0,100)));
  keyboard.push({check:'every button, link and field on the Dashboard has an accessible name',ok:unnamed.length===0,detail:unnamed.join(' | ')});
  // 3. Search sheet: focus moves in, Tab is trapped, Escape closes and returns focus
  await p.getByRole('button',{name:'Search Homi',exact:true}).focus();await p.keyboard.press('Enter');await p.getByRole('searchbox').waitFor();
  const inside=await p.evaluate(()=>!!document.activeElement.closest('[role=dialog],dialog,[aria-modal=true]'));
  let trapped=true;for(let i=0;i<12;i++){await p.keyboard.press('Tab');if(!(await p.evaluate(()=>!!document.activeElement.closest('[role=dialog],dialog,[aria-modal=true]')))){trapped=false;break;}}
  await p.keyboard.press('Escape');await p.getByRole('searchbox').waitFor({state:'detached'}).catch(()=>{});
  const returned=await p.evaluate(()=>document.activeElement?.getAttribute('aria-label')==='Search Homi');
  keyboard.push({check:'Search sheet takes focus on open, keeps Tab inside, closes on Escape and returns focus to the Search button',ok:inside&&trapped&&returned,detail:`focusInside=${inside} trapped=${trapped} returned=${returned}`});
  // 4. Calendar and Chequebook forms behave the same way
  for(const [label,open,close] of [['Calendar event form',async()=>{await p.getByRole('link',{name:/Coming week/}).click();await p.getByRole('heading',{name:'Calendar',exact:true}).waitFor();await p.waitForFunction(()=>{const b=document.querySelector('button[aria-label="Add event"]');return b&&!b.disabled;});await p.getByRole('button',{name:'Add event',exact:true}).focus();await p.keyboard.press('Enter');await p.locator('#calendar-editor-title').waitFor();},'#calendar-editor-title'],['Chequebook transaction form',async()=>{await p.getByRole('link',{name:/Current balance/}).click();await p.getByRole('heading',{name:'Chequebook',exact:true}).waitFor();await p.waitForTimeout(1200);await p.waitForFunction(()=>{const b=document.querySelector('button[aria-label="Add transaction"]');return b&&!b.disabled;});await p.getByRole('button',{name:'Add transaction',exact:true}).first().focus();await p.keyboard.press('Enter');await p.locator('#cheq-amount').waitFor();},'#cheq-amount']]){
    await p.goto(base);await p.getByRole('link',{name:/Current balance/}).waitFor();await open();
    const ins=await p.evaluate(()=>!!document.activeElement.closest('[role=dialog],dialog,[aria-modal=true]'));
    let tr=true;for(let i=0;i<30;i++){await p.keyboard.press('Tab');if(!(await p.evaluate(()=>!!document.activeElement.closest('[role=dialog],dialog,[aria-modal=true]')))){tr=false;break;}}
    await p.keyboard.press('Escape');await p.waitForTimeout(500);const closed=await p.locator(close).count()===0;
    keyboard.push({check:label+' takes focus on open, keeps Tab inside and closes on Escape',ok:ins&&tr&&closed,detail:`focusInside=${ins} trapped=${tr} closed=${closed}`});
  }
  // 5. Reduced motion removes meaningful animation
  const motion=await p.evaluate(()=>{const s=document.createElement('div');s.style.transition='transform 1s';document.body.appendChild(s);const d=getComputedStyle(s).transitionDuration;s.remove();return {transition:d,scroll:getComputedStyle(document.documentElement).scrollBehavior};});
  keyboard.push({check:'reduced-motion preference removes animation and smooth scrolling',ok:parseFloat(motion.transition)<0.1&&motion.scroll!=='smooth',detail:JSON.stringify(motion)});
  // Noticeboard sheet: focus moves in, Tab stays inside, Escape closes, focus returns to the tack
  await p.setViewportSize({width:1440,height:900});await p.goto(base);await p.getByRole('button',{name:'Add a notice',exact:true}).waitFor();
  await p.getByRole('button',{name:'Add a notice',exact:true}).focus();await p.keyboard.press('Enter');await p.getByLabel('Title',{exact:true}).waitFor();
  const nbInside=await p.evaluate(()=>!!document.activeElement?.closest('[role=dialog]'));
  let nbTrapped=true;for(let i=0;i<40;i++){await p.keyboard.press('Tab');if(!await p.evaluate(()=>!!document.activeElement?.closest('[role=dialog]'))){nbTrapped=false;break;}}
  await p.keyboard.press('Escape');await p.waitForTimeout(300);
  const nbReturned=await p.evaluate(()=>document.activeElement?.getAttribute('aria-label')==='Add a notice');
  keyboard.push({check:'Noticeboard add sheet (opened from the card) takes focus, keeps Tab inside, closes on Escape and returns focus to the tack',ok:nbInside&&nbTrapped&&nbReturned,detail:`focusInside=${nbInside} trapped=${nbTrapped} returned=${nbReturned}`});
  // Meal Planner sheet: focus moves in, Tab stays inside, Escape closes
  await p.setViewportSize({width:1440,height:900});await p.goto(base);await p.locator('.mp-row').first().waitFor({timeout:30000});
  await p.locator('.mp-row').first().focus();await p.keyboard.press('Enter');await p.getByRole('dialog').waitFor();
  const mpInside=await p.evaluate(()=>!!document.activeElement?.closest('[role=dialog]'));
  let mpTrapped=true;for(let i=0;i<30;i++){await p.keyboard.press('Tab');if(!await p.evaluate(()=>!!document.activeElement?.closest('[role=dialog]'))){mpTrapped=false;break;}}
  await p.keyboard.press('Escape');await p.waitForTimeout(300);
  const mpClosed=await p.getByRole('dialog').count()===0;
  keyboard.push({check:'Meal Planner day sheet (opened from the card) takes focus, keeps Tab inside and closes on Escape',ok:mpInside&&mpTrapped&&mpClosed,detail:`focusInside=${mpInside} trapped=${mpTrapped} closed=${mpClosed}`});
  // 6. Zoom: no horizontal scroll at 320 px
  await p.setViewportSize({width:320,height:700});await p.goto(base);await p.getByRole('link',{name:/Current balance/}).waitFor();
  const overflow=await p.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
  keyboard.push({check:'no horizontal scrolling at 320 px wide',ok:overflow<=0,detail:`overflow ${overflow}px`});
}
try{
  await launch();await login();
  // Representative invented data so lists, rows and badges are scanned, not just empty states
  const d=n=>new Date(Date.now()+n*864e5).toISOString().slice(0,10);
  await p.getByRole('link',{name:/Coming week/}).click();await p.getByRole('heading',{name:'Calendar',exact:true}).waitFor();await p.waitForTimeout(800);
  await p.getByRole('button',{name:'Add event',exact:true}).click();await p.locator('#calendar-editor-title').fill('Dentist '+run);await p.locator('#calendar-editor-start').fill(d(1)+'T09:00');await p.locator('#calendar-editor-end').fill(d(1)+'T10:00');await p.getByRole('button',{name:'Save event',exact:true}).click();await p.waitForTimeout(1200);
  await p.goto(base);await p.getByRole('link',{name:/Current balance/}).click();await p.getByRole('heading',{name:'Chequebook',exact:true}).waitFor();
  for(let i=0;i<8;i++){await p.getByRole('button',{name:'Add transaction',exact:true}).first().click();await p.locator('#cheq-account').waitFor();if(await p.locator('#cheq-account').inputValue())break;await p.getByRole('button',{name:'Cancel',exact:true}).click();await p.waitForTimeout(1000);}
  await p.locator('#cheq-amount').fill('42.50');await p.locator('#cheq-description').fill('Groceries '+run);await p.getByRole('button',{name:'Save transaction',exact:true}).click();await p.getByRole('button',{name:new RegExp('Groceries '+run)}).first().waitFor();
  await p.goto(base);await p.getByRole('button',{name:/Open list$/}).click();await p.getByRole('heading',{name:'Shopping List',exact:true}).waitFor();await p.getByRole('textbox',{name:'Add an item',exact:true}).fill('Apples '+run);await p.getByRole('button',{name:'Add',exact:true}).click();await p.getByRole('checkbox',{name:'Apples '+run,exact:true}).waitFor();
  // Noticeboard: a notice with text and a short list, pinned to the board
  await p.goto(base);await p.getByRole('button',{name:'Add a notice',exact:true}).click();await p.getByLabel('Title',{exact:true}).fill('Pickup '+run);await p.getByLabel('Notice',{exact:true}).fill('Hockey at 5.');await p.getByRole('button',{name:'Add list item',exact:true}).click();await p.getByLabel('List item 1',{exact:true}).fill('Bring water');await p.getByRole('button',{name:'Save notice',exact:true}).click();await p.getByRole('button',{name:'Open notice: Pickup '+run,exact:true}).waitFor();
  // Meal Planner: a meal on the first card row and a saved idea
  await p.goto(base);await p.locator('.mp-row').first().waitFor({timeout:30000});await p.locator('.mp-row').first().click();await p.getByRole('button',{name:'Add a meal',exact:true}).click();await p.locator('#mp-title').fill('Soup '+run);await p.getByRole('button',{name:'Save meal',exact:true}).click();await p.getByRole('dialog').getByText('Soup '+run).waitFor();await p.getByRole('button',{name:'Done',exact:true}).click();
  for(const scheme of SCHEMES)for(const width of WIDTHS)await screens(scheme,width);
  await keyboardChecks();
}catch(e){console.error(e);process.exitCode=1;}
finally{await ctx?.close().catch(()=>{});}
const out={date:new Date().toISOString(),screensChecked:checked.length,violations:[...violations.values()].map(v=>({id:v.id,impact:v.impact,help:v.help,nodes:[...v.nodes.entries()].map(([target,n])=>({target,html:n.html,summary:n.summary,screens:[...new Set(n.screens)].slice(0,6),screenCount:new Set(n.screens).size}))})),keyboard};
writeFileSync(ROOT+'/accessibility-acceptance.json',JSON.stringify(out,null,2));
console.log(`SCREENS ${checked.length}`);
for(const v of out.violations){console.log(`VIOLATION ${v.id} (${v.impact}): ${v.help}`);for(const n of v.nodes.slice(0,6))console.log(`   ${n.target} [${n.screenCount} screens] ${n.summary}`);}
for(const k of keyboard)console.log(k.ok?'PASS':'FAIL',k.check,k.ok?'':'-- '+k.detail);
if(out.violations.length===0&&keyboard.every(k=>k.ok)&&checked.length>0&&!process.exitCode)console.log('ALL ACCESSIBILITY CHECKS PASSED');else process.exitCode=1;
