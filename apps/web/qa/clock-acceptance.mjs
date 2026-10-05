// Browser acceptance for the Family Board header clock. Run only against an
// isolated localhost stack whose owner is a fixture account (HOMI_TEST_CREDENTIALS
// with HOMI_BOOTSTRAP_EMAIL and HOMI_OWNER_PASSWORD). All data is invented.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
const env=Object.fromEntries(readFileSync(process.env.HOMI_TEST_CREDENTIALS,'utf8').trim().split('\n').map(s=>{const i=s.indexOf('=');return [s.slice(0,i),s.slice(i+1)];}));
const base=process.env.HOMI_TEST_URL??'http://localhost:3400';
if(new URL(base).hostname!=='localhost')throw new Error('Clock acceptance requires the isolated localhost test stack');
const OUT=process.env.HOMI_QA_OUT??new URL('./',import.meta.url).pathname;
const TZ='America/Toronto';
const results=[],errors=[];
const pass=(name,detail={})=>{results.push({name,...detail});console.log('PASS',name,JSON.stringify(detail));};
const browser=await chromium.launch({headless:true,executablePath:process.env.HOMI_TEST_CHROME});
try{
  // A fixed instant: 5 October 2026, 15:15 in Toronto (19:15 UTC).
  const ctx=await browser.newContext({viewport:{width:1440,height:900},timezoneId:'Asia/Tokyo'});
  const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));
  await p.clock.install({time:new Date('2026-10-05T19:15:00Z')});
  await p.goto(base);await p.getByLabel('Email',{exact:true}).fill(env.HOMI_BOOTSTRAP_EMAIL);await p.getByLabel('Password',{exact:true}).fill(env.HOMI_OWNER_PASSWORD);
  await p.getByRole('button',{name:'Sign in',exact:true}).click();
  const date=p.locator('.homi-family-board__clock-date'),time=p.locator('.homi-family-board__clock-time');
  await time.waitFor({timeout:30000});
  assert.equal((await date.innerText()).trim(),'5th October 2026');
  assert.equal((await time.innerText()).trim(),'03:15 P.M.');
  pass('the header shows the date and time in the household time zone (not the browser\'s)',{date:await date.innerText(),time:await time.innerText()});

  await p.clock.runFor(60_000);
  assert.equal((await time.innerText()).trim(),'03:16 P.M.');
  await p.clock.runFor(8*3600_000+45*60_000);   // to 00:01 the next day, Toronto
  assert.equal((await date.innerText()).trim(),'6th October 2026');
  assert.equal((await time.innerText()).trim(),'12:01 A.M.');
  pass('the clock advances each minute and rolls the date over at midnight');

  const place=async()=>p.evaluate(()=>{const r=s=>document.querySelector(s)?.getBoundingClientRect();return {brand:r('.homi-family-board__brand'),clock:r('.homi-family-board__clock'),arrange:r('.homi-family-board__arrange'),board:r('.homi-family-board')};});
  for(const width of [1440,768,412,390,360,320]){
    await p.setViewportSize({width,height:900});await p.waitForTimeout(300);
    const l=await place();
    assert.ok(l.clock.left>=l.brand.right+4,`clock clear of the logo by at least 4 px at ${width}: gap ${Math.round(l.clock.left-l.brand.right)}`);
    assert.ok(l.clock.right<=l.arrange.left+1,`clock left of the Arrange button at ${width}`);
    assert.ok(l.clock.right<=l.board.right,`clock inside the board at ${width}`);
    assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`no horizontal overflow at ${width}`);
    if(width<=640){const size=await p.evaluate(()=>[...document.querySelectorAll('.homi-family-board__clock-date,.homi-family-board__clock-time')].map(el=>getComputedStyle(el).fontSize));assert.equal(size[0],size[1],`time and date are the same size on a phone at ${width}`);}
    await p.screenshot({path:OUT+`dashboard-clock-${width}.png`});
  }
  pass('the clock sits between the logo and the Arrange button without overflow from 1440 down to 320 px');
  assert.deepEqual(errors,[]);pass('no JavaScript page errors');
  writeFileSync(OUT+'clock-acceptance.json',JSON.stringify({date:new Date().toISOString(),results},null,2)+'\n');
  console.log('PASS_CLOCK_ACCEPTANCE',results.length);
}catch(e){console.error(e);process.exitCode=1;}
finally{await browser.close();}
