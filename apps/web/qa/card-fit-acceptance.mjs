// Card fit acceptance. Self-contained: needs only a built web app (for Homi's own
// Dashboard CSS) and Chrome. It puts the same list-style content in Dashboard cards
// from one cell to a full screen and checks that the contents always fit inside the
// card, grow steadily as the card grows, shrink as it shrinks, re-fit when the
// content changes, and settle (no endless re-layout).
//   pnpm --filter @homi/web build && node apps/web/qa/card-fit-acceptance.mjs
//   HOMI_TEST_CHROME=/usr/bin/google-chrome  (optional)
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const here = (p) => new URL(p, import.meta.url).pathname;
const dist = here('../dist/assets/');
const css = readdirSync(dist).filter((f) => f.endsWith('.css')).map((f) => `<link rel="stylesheet" href="file://${dist}${f}">`).join('');
const work = mkdtempSync(join(tmpdir(), 'homi-fit-'));
writeFileSync(join(work, 'entry.tsx'), `
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { FitToCard } from ${JSON.stringify(here('../src/FitToCard.tsx'))};
const items = ['Milk', 'Free-range eggs, a dozen', 'Wholegrain bread', 'Apples', 'Chicken thighs', 'Basmati rice', 'Olive oil', 'Dish soap'];
function List({ count }: { count: number }) {
  return <div className="sample"><h3 style={{ margin: 0 }}>Shopping list</h3><ul style={{ margin: '.4rem 0 0', paddingLeft: '1.1rem' }}>{items.slice(0, count).map((i) => <li key={i}>{i}</li>)}</ul></div>;
}
function Cell({ id, w, h }: { id: string; w: number; h: number }) {
  const [count, setCount] = useState(5);
  (window as any)['grow_' + id] = () => setCount(8);
  return <div id={id} className="homi-family-board__cell" style={{ width: w, height: h, margin: 12, float: 'left' }}>
    <article className="homi-family-card--bare"><div className="homi-family-module-surface homi-family-module-surface--fit"><FitToCard><List count={count} /></FitToCard></div></article>
  </div>;
}
const sizes: [string, number, number][] = [['c1', 56, 52], ['c2', 124, 118], ['c3', 268, 186], ['c4', 420, 330], ['c5', 700, 520], ['c6', 1100, 800], ['wide', 640, 120], ['tall', 140, 560]];
createRoot(document.getElementById('root')!).render(<div style={{ background: '#e9dfc7', padding: 10 }}>{sizes.map(([id, w, h]) => <Cell key={id} id={id} w={w} h={h} />)}</div>);
`);
execFileSync('pnpm', ['exec', 'esbuild', join(work, 'entry.tsx'), '--bundle', '--format=iife', '--jsx=automatic', `--outfile=${join(work, 'out.js')}`, '--log-level=error'], { cwd: here('../'), stdio: 'inherit' });
writeFileSync(join(work, 'index.html'), `<!doctype html><meta charset=utf-8>${css}<div id=root></div><script src="out.js"></script>`);

const browser = await chromium.launch({ headless: true, executablePath: process.env.HOMI_TEST_CHROME ?? undefined });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + join(work, 'index.html'));
  await page.waitForTimeout(600);
  const measure = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.homi-family-board__cell')].map((cell) => {
    const host = cell.querySelector('.homi-fit').getBoundingClientRect();
    const inner = cell.querySelector('.homi-fit__content');
    const box = inner.getBoundingClientRect();
    const li = cell.querySelector('li');
    return [cell.id, { wordsFit: inner.scrollWidth <= inner.clientWidth + 1, hostW: host.width, hostH: host.height, boxW: box.width, boxH: box.height, scale: Number(inner.dataset.scale), fontPx: parseFloat(getComputedStyle(li).fontSize) * Number(inner.dataset.scale) }];
  })));
  const m = await measure();
  const pass = (s) => console.log('PASS', s);

  for (const [id, r] of Object.entries(m)) {
    assert.ok(r.boxW <= r.hostW + 1.5, `${id}: contents are ${r.boxW.toFixed(0)}px wide in a ${r.hostW.toFixed(0)}px card`);
    assert.ok(r.boxH <= r.hostH + 1.5 || r.scale <= 0.11, `${id}: contents are ${r.boxH.toFixed(0)}px tall in a ${r.hostH.toFixed(0)}px card`);
  }
  for (const [id, r] of Object.entries(m)) assert.ok(r.wordsFit, `${id}: a word is wider than the card and is cut off`);
  pass('in every card size, from one cell to a full screen, the contents fit inside the card, with no word cut off');

  const order = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'];
  for (let i = 1; i < order.length; i += 1) assert.ok(m[order[i]].fontPx > m[order[i - 1]].fontPx, `text must grow from ${order[i - 1]} to ${order[i]}`);
  pass(`text grows steadily with the card: ${order.map((id) => m[id].fontPx.toFixed(1) + 'px').join(' < ')}`);
  assert.ok(m.c1.fontPx < 8 && m.c6.fontPx > 24, 'a one-cell card shrinks the text and a full-screen card enlarges it');
  pass('a one-cell card shrinks the text and a full-screen card enlarges it');

  for (const id of ['c3', 'c4', 'c5']) assert.ok(m[id].boxH >= m[id].hostH * 0.55 || m[id].scale >= 2.99, `${id}: contents should fill the card, not sit small in a corner (${m[id].boxH.toFixed(0)} of ${m[id].hostH.toFixed(0)}px)`);
  pass('contents fill the card instead of sitting small in a corner');
  for (const [id, r] of Object.entries(m)) assert.ok(Math.abs(r.boxH - r.hostH) <= 1.5, `${id}: the scaled surface should stretch to the full card so its own background fills it (${r.boxH.toFixed(0)} of ${r.hostH.toFixed(0)}px)`);
  pass('the scaled surface stretches to the full card, so a background it draws fills the whole card');
  for (const id of ['wide', 'tall']) assert.ok(m[id].boxW <= m[id].hostW + 1.5 && m[id].boxH <= m[id].hostH + 1.5, `${id}: odd shapes fit too`);
  pass('very wide and very tall cards fit too');

  await page.evaluate(() => { window.grow_c3(); window.grow_c5(); });
  await page.waitForTimeout(500);
  const after = await measure();
  for (const id of ['c3', 'c5']) {
    assert.ok(after[id].boxH <= after[id].hostH + 1.5, `${id}: after the list grew, contents still fit`);
    assert.ok(after[id].scale < m[id].scale, `${id}: more items must shrink the text so everything still fits`);
  }
  pass('when the content changes (a list grows) the card re-fits and everything stays inside');

  const one = await measure(); await page.waitForTimeout(500); const two = await measure();
  assert.deepEqual(two.c3, one.c3, 'the layout must settle, not keep changing');
  pass('the layout settles: no endless re-layout');
  await page.screenshot({ path: join(work, 'fit.png'), fullPage: true });
  assert.deepEqual(errors, [], `page errors: ${errors.join(' | ')}`);
  console.log(`\nAll card fit checks passed. Screenshot: ${join(work, 'fit.png')}`);
} finally { await browser.close(); }
