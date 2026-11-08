// Phone scrolling acceptance (regression for Homi 1.9.3). On a phone-sized touch
// device the Dashboard is longer than the screen and must scroll: a scroll stays
// where it was put, and the cards do not keep re-fitting themselves while the page
// is idle. Run only against an isolated localhost stack whose fixture household has
// enough cards (for example Calendar, Chequebook and Weather installed, enabled and
// set up) for the Dashboard to be taller than the screen.
//   HOMI_TEST_CREDENTIALS=<file with HOMI_BOOTSTRAP_EMAIL / HOMI_BOOTSTRAP_PASSWORD>
//   HOMI_TEST_PROFILES=<scratch dir> [HOMI_TEST_URL=http://localhost:3400] [HOMI_TEST_CHROME=...]
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chromium} from 'playwright';
const env = Object.fromEntries(readFileSync(process.env.HOMI_TEST_CREDENTIALS, 'utf8').trim().split('\n').map(s => {const i = s.indexOf('='); return [s.slice(0, i), s.slice(i + 1)];}));
const base = process.env.HOMI_TEST_URL ?? 'http://localhost:3400';
if (new URL(base).hostname !== 'localhost') throw new Error('Acceptance requires the isolated localhost test stack');
const profiles = process.env.HOMI_TEST_PROFILES ?? '/tmp/homi-phone-scroll';
const ctx = await chromium.launchPersistentContext(`${profiles}/phone-${Date.now()}`, {headless: true, executablePath: process.env.HOMI_TEST_CHROME, viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, deviceScaleFactor: 2});
try {
  const p = ctx.pages()[0] ?? await ctx.newPage();
  await p.goto(base);
  await p.getByLabel('Email', {exact: true}).fill(env.HOMI_BOOTSTRAP_EMAIL);
  await p.getByLabel('Password', {exact: true}).fill(env.HOMI_BOOTSTRAP_PASSWORD);
  await p.getByRole('button', {name: 'Sign in', exact: true}).click();
  await p.getByRole('button', {name: 'Settings', exact: true}).first().waitFor({timeout: 30000});
  await p.waitForTimeout(5000);
  const docHeight = await p.evaluate(() => document.scrollingElement.scrollHeight);
  assert.ok(docHeight > 844 * 1.5, `the Dashboard must be taller than the screen to test scrolling (was ${docHeight}px)`);
  console.log('PASS the Dashboard is taller than the phone screen', JSON.stringify({docHeight}));

  // Real touch events (a finger dragging up the screen), not mouse-wheel shortcuts.
  const cdp = await ctx.newCDPSession(p);
  const swipe = async (x, fromY, toY, steps = 12) => {
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x, y: fromY}]});
    for (let i = 1; i <= steps; i += 1) {
      await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x, y: fromY + ((toY - fromY) * i) / steps}]});
      await p.waitForTimeout(16);
    }
    await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
  };
  for (const [name, x, y] of [['on a card', 195, 700], ['on the page margin', 4, 700]]) {
    await p.evaluate(() => scrollTo(0, 0));
    await p.waitForTimeout(300);
    await swipe(x, y, y - 500);
    await p.waitForTimeout(1200);
    const y1 = await p.evaluate(() => scrollY);
    assert.ok(y1 > 300, `a touch scroll ${name} moves the page (scrollY ${y1})`);
    console.log('PASS a touch scroll ' + name + ' moves the page and it stays there', JSON.stringify({scrollY: Math.round(y1)}));
  }

  await p.evaluate(() => scrollTo(0, 600));
  await p.waitForTimeout(1500);
  assert.equal(await p.evaluate(() => scrollY), 600, 'a scroll position is kept');
  console.log('PASS a scroll position is kept');

  // Idle page: nothing may keep rewriting the cards (the old bug re-fitted every frame).
  const mutations = await p.evaluate(() => new Promise(resolve => {
    let count = 0;
    const observer = new MutationObserver(records => {count += records.length;});
    observer.observe(document.body, {subtree: true, attributes: true, childList: true, characterData: true});
    setTimeout(() => {observer.disconnect(); resolve(count);}, 2000);
  }));
  assert.ok(mutations < 40, `an idle Dashboard is quiet (${mutations} DOM changes in 2 s)`);
  console.log('PASS an idle Dashboard is quiet', JSON.stringify({domChangesIn2s: mutations}));

  await p.evaluate(() => scrollTo(0, 0));
  for (let i = 0; i < 8; i += 1) {
    await swipe(195, 760, 120, 8);
    await p.waitForTimeout(250);
  }
  await p.waitForTimeout(1200);
  const bottom = await p.evaluate(() => ({y: scrollY, max: document.scrollingElement.scrollHeight - innerHeight}));
  assert.ok(bottom.y >= bottom.max - 4, `repeated swipes reach the last card (${bottom.y} of ${bottom.max})`);
  console.log('PASS repeated swipes reach the bottom of the Dashboard', JSON.stringify(bottom));
  console.log('PASS_PHONE_SCROLL_ACCEPTANCE');
} finally {
  await ctx.close();
}
