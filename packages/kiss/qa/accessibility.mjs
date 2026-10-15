// K.I.S.S. accessibility pass: axe (WCAG 2.0/2.1 A and AA) on every tab at phone
// and desktop widths in light and dark schemes, as a partner, after
// acceptance.mjs has paired the fixture partners. Isolated localhost stack only.
import {chromium} from 'playwright';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
const require=createRequire(new URL('../../../apps/web/package.json',import.meta.url));
const AXE=readFileSync(require.resolve('axe-core/axe.min.js'),'utf8');
const ROOT=new URL('./',import.meta.url).pathname;
const env=Object.fromEntries(readFileSync(process.env.HOMI_TEST_CREDENTIALS,'utf8').trim().split('\n').map(s=>{const i=s.indexOf('=');return [s.slice(0,i),s.slice(i+1).replace(/^"|"$/g,'')];}));
const base=process.env.HOMI_TEST_URL??'http://localhost:3200';
if(new URL(base).hostname!=='localhost')throw new Error('Isolated localhost test stack only');
const ctx=await chromium.launchPersistentContext(process.env.HOMI_TEST_PROFILES,{headless:true,viewport:{width:390,height:844},executablePath:process.env.HOMI_TEST_CHROME??undefined});
const p=ctx.pages()[0]??await ctx.newPage();
await p.goto(base);await p.getByLabel('Email',{exact:true}).fill('calendar-second@example.invalid');await p.getByLabel('Password',{exact:true}).fill(env.HOMI_BOOTSTRAP_PASSWORD);await p.getByRole('button',{name:'Sign in',exact:true}).click();await p.getByLabel('Email',{exact:true}).waitFor({state:'detached'});
await p.getByRole('button',{name:/Modules/}).first().click();await p.getByRole('dialog').getByRole('button',{name:'K.I.S.S.'}).click();await p.getByRole('heading',{name:'K.I.S.S.',exact:true}).waitFor();
const tabs=['Today','Check-in','Notes','Dates','Quizzes','Passion','Settings'],out=[];let violations=0;
for(const scheme of ['light','dark'])for(const width of [390,1440]){
  await p.emulateMedia({colorScheme:scheme});await p.setViewportSize({width,height:900});
  for(const t of tabs){await p.getByRole('tab',{name:t,exact:true}).click();await p.waitForTimeout(400);
    const r=await p.evaluate(async src=>{if(!window.axe)(0,eval)(src);return await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']},resultTypes:['violations']});},AXE);
    for(const v of r.violations){violations++;out.push({scheme,width,tab:t,id:v.id,impact:v.impact,nodes:v.nodes.slice(0,3).map(n=>n.target.join(' '))});}
  }}
writeFileSync(ROOT+'accessibility-acceptance.json',JSON.stringify({suite:'kiss-axe',date:new Date().toISOString(),screens:tabs.length*4,violations:out},null,2)+'\n');
console.log('SCREENS',tabs.length*4,'VIOLATIONS',violations);if(violations)console.log(JSON.stringify(out,null,1).slice(0,3000));
await ctx.close();process.exitCode=violations?1:0;
