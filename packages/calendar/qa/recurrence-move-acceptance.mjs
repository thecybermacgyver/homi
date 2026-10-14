// Recurring-occurrence move acceptance. Verifies in the running app that
// moving one occurrence of a repeating event places it on its new date and
// clears its original date. Run only against an isolated localhost stack with
// Calendar installed, enabled and set up; all data is invented.
//
//   HOMI_TEST_CREDENTIALS=... HOMI_TEST_PROFILES=... \
//     node packages/calendar/qa/recurrence-move-acceptance.mjs
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
const env=Object.fromEntries(readFileSync(process.env.HOMI_TEST_CREDENTIALS,'utf8').trim().split('\n').map(s=>{const i=s.indexOf('=');return [s.slice(0,i),s.slice(i+1).replace(/^"|"$/g,'')];}));
const base='http://localhost:3400';
const ctx=await chromium.launchPersistentContext(process.env.HOMI_TEST_PROFILES+'/recur-'+Date.now(),{headless:true,viewport:{width:1440,height:900}});
const p=ctx.pages()[0]??await ctx.newPage();
const errors=[];p.on('pageerror',e=>errors.push(e.message));
const day=n=>new Date(Date.now()+n*864e5).toISOString().slice(0,10);
try{
await p.goto(base);
await p.getByLabel('Email',{exact:true}).fill(env.HOMI_BOOTSTRAP_EMAIL);
await p.getByLabel('Password',{exact:true}).fill(env.HOMI_BOOTSTRAP_PASSWORD);
await p.getByRole('button',{name:'Sign in',exact:true}).click();
await p.getByRole('link',{name:/Coming week/}).click();
await p.getByRole('heading',{name:'Calendar',exact:true}).waitFor();
await p.getByRole('tab',{name:'Upcoming',exact:true}).click();
const title='Swim club '+Date.now().toString().slice(-6);
const first=day(1), moved=day(3);
await p.getByRole('button',{name:'Add event',exact:true}).click();
await p.locator('#calendar-editor-title').fill(title);
await p.locator('#calendar-editor-start').fill(first+'T17:00');
await p.locator('#calendar-editor-end').fill(first+'T18:00');
await p.locator('#calendar-editor-repeat').selectOption('weekly');
await p.getByRole('button',{name:'Save event',exact:true}).click();
await p.getByText(title,{exact:false}).first().waitFor();
const rowDates=async()=>p.locator('.homi-calendar-upcoming-date').evaluateAll((els,t)=>els.filter(e=>e.parentElement.textContent.includes(t)).map(e=>e.textContent.trim()),title);
let before=await rowDates();
assert.ok(before.includes(first),'series starts on '+first+' got '+JSON.stringify(before));
console.log('PASS recurring series created, first occurrence on '+first);
// open the first occurrence and move it, scope = this occurrence
await p.getByText(title,{exact:false}).first().click();
await p.getByRole('tab',{name:'This occurrence',exact:true}).click();
await p.locator('#calendar-editor-start').fill(moved+'T17:00');
await p.locator('#calendar-editor-end').fill(moved+'T18:00');
await p.getByRole('button',{name:'Save event',exact:true}).click();
await p.waitForTimeout(2500);
const after=await rowDates();
assert.ok(after.includes(moved),'moved occurrence must appear on '+moved+' got '+JSON.stringify(after));
assert.ok(!after.includes(first),'original date '+first+' must no longer hold the occurrence; got '+JSON.stringify(after));
console.log('PASS one occurrence moved from '+first+' to '+moved+' and left its original day');
assert.deepEqual(errors,[]);
console.log('PASS no JavaScript page errors');
writeFileSync(new URL('./recurrence-move-acceptance.json',import.meta.url),JSON.stringify({date:new Date().toISOString(),firstOccurrence:first,movedTo:moved,results:[
 'recurring series created with its first occurrence on the chosen day',
 'one occurrence moved to another day appears there and leaves its original day',
 'no JavaScript page errors',
]},null,2)+'\n');
}finally{await ctx.close();}
