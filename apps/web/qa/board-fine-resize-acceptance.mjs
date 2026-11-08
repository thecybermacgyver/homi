// Fine resize acceptance, in a real browser with Homi's real Dashboard CSS and the
// real FamilyBoardGrid. Layouts saved before the fine grid (whole cells) must render
// exactly as they did; dragging a card's corner must change its size in small
// steps (not a whole column at a time); and the spacing between cards must stay even.
//   pnpm --filter @homi/web build && node apps/web/qa/board-fine-resize-acceptance.mjs
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
const work = mkdtempSync(join(tmpdir(), 'homi-board-'));
writeFileSync(join(work, 'entry.tsx'), `
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { FamilyBoardGrid } from ${JSON.stringify(here('../src/FamilyBoardGrid.tsx'))};
const layout = location.hash === '#phone' ? 'phone' : 'wide';
const start = layout === 'wide'
  ? { a: { x: 0, y: 0, w: 2, h: 3 }, b: { x: 2, y: 0, w: 3, h: 2 }, c: { x: 5, y: 0, w: 3, h: 3 } }
  : { a: { x: 0, y: 0, w: 2, h: 3 }, b: { x: 2, y: 0, w: 2, h: 2 }, c: { x: 0, y: 3, w: 4, h: 3 } };
function App() {
  const [placements, setPlacements] = useState<Record<string, any>>(start);
  (window as any).saved = placements;
  const items = ['a', 'b', 'c'].map((key) => ({ key, label: 'Card ' + key, size: undefined, phoneLayout: layout === 'phone' ? placements[key] : null, wideLayout: layout === 'wide' ? placements[key] : null,
    content: <div id={'content-' + key} style={{ background: '#fff', width: '100%', height: '100%' }}>{key}</div> }));
  return <div className="homi-family-board"><FamilyBoardGrid items={items} layout={layout as any} editing={true}
    onSave={async (_l, arrangement) => { setPlacements(Object.fromEntries([...arrangement])); }} /></div>;
}
createRoot(document.getElementById('root')!).render(<App />);
`);
execFileSync('pnpm', ['exec', 'esbuild', join(work, 'entry.tsx'), '--bundle', '--format=iife', '--jsx=automatic', `--outfile=${join(work, 'out.js')}`, '--log-level=error'], { cwd: here('../'), stdio: 'inherit' });
writeFileSync(join(work, 'index.html'), `<!doctype html><meta charset=utf-8>${css}<div id=root></div><script src="out.js"></script>`);

const browser = await chromium.launch({ headless: true, executablePath: process.env.HOMI_TEST_CHROME ?? undefined });
const pass = (s) => console.log('PASS', s);
const errors = [];
async function open(width, hash) {
  const page = await browser.newPage({ viewport: { width, height: 1000 } });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('file://' + join(work, 'index.html') + hash);
  await page.waitForTimeout(400);
  return page;
}
const box = (page, key) => page.evaluate((k) => { const r = document.querySelector('[data-family-board-card="' + k + '"]').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, key);
const vars = (page) => page.evaluate(() => { const g = document.querySelector('.homi-family-board__grid'); const s = getComputedStyle(g); return { row: parseFloat(s.getPropertyValue('--homi-board-row')), gap: parseFloat(s.getPropertyValue('--homi-board-gap')), width: g.clientWidth, columns: Number(g.style.getPropertyValue('--homi-board-columns')) }; });
try {
  // 1. whole-cell layouts render exactly as before: width = w x pitch - gap, height = h x (row + gap) - gap
  for (const [width, hash, name] of [[1400, '', 'wide'], [390, '#phone', 'phone']]) {
    const page = await open(width, hash);
    const v = await vars(page); const pitch = v.width / v.columns; const rowPitch = v.row + v.gap;
    const a = await box(page, 'a'), b = await box(page, 'b');
    assert.ok(Math.abs(a.w - (2 * pitch - v.gap)) < 1, `${name}: card a is ${a.w.toFixed(1)}px wide, expected ${(2 * pitch - v.gap).toFixed(1)}`);
    assert.ok(Math.abs(a.h - (3 * rowPitch - v.gap)) < 1, `${name}: card a is ${a.h.toFixed(1)}px tall, expected ${(3 * rowPitch - v.gap).toFixed(1)}`);
    assert.ok(Math.abs(b.x - (a.x + a.w) - v.gap) < 1, `${name}: the gap between neighbouring cards is ${(b.x - a.x - a.w).toFixed(1)}px, expected ${v.gap}`);
    await page.close();
  }
  pass('layouts saved as whole cells render exactly as before (card sizes and the gap between cards), on a monitor and a phone');

  // 2. dragging a card's corner changes its size in small steps
  const page = await open(1400, '');
  const v = await vars(page); const pitch = v.width / v.columns;
  const handle = await page.evaluate(() => { const r = document.querySelector('[data-family-board-card="a"] .homi-family-board__resize').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  const widths = [];
  const savedWidths = [];
  for (let step = 1; step <= 8; step += 1) {
    const before = await box(page, 'c');
    const start = await page.evaluate(() => { const r = document.querySelector('[data-family-board-card="a"] .homi-family-board__resize').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(start.x + 13, start.y + 4, { steps: 3 });
    await page.mouse.up(); await page.waitForTimeout(120);
    widths.push((await box(page, 'a')).w);
    savedWidths.push((await page.evaluate(() => window.saved.a)).w);
    void before;
  }
  const steps = widths.slice(1).map((w, i) => w - widths[i]);
  console.log('   card a width after each 13px drag:', widths.map((w) => w.toFixed(0)).join(' -> '));
  assert.ok(new Set(widths.map((w) => Math.round(w))).size >= 6, 'eight small drags must give at least six different widths');
  assert.ok(Math.max(...steps) < pitch / 2, `no single step may jump as much as half a cell (${(pitch / 2).toFixed(0)}px); the biggest was ${Math.max(...steps).toFixed(0)}px`);
  assert.ok(widths.at(-1) > widths[0] + 40, 'the card must actually grow with the drags');
  pass(`resizing is fine-grained: eight 13px drags gave ${new Set(widths.map((w) => Math.round(w))).size} different widths, the biggest jump ${Math.max(...steps).toFixed(0)}px (a whole cell is ${pitch.toFixed(0)}px)`);

  // 3. what is saved is a multiple of 1/8 of a cell, so Core and the database accept it
  const saved = await page.evaluate(() => window.saved.a);
  for (const key of ['x', 'y', 'w', 'h']) assert.ok(Number.isInteger(saved[key] * 8), `saved ${key}=${saved[key]} is not a multiple of 1/8`);
  for (const w of savedWidths) assert.ok(Number.isInteger(w * 8), `a saved width of ${w} is not on the 1/8 grid`);
  assert.ok(savedWidths.some((w) => !Number.isInteger(w)), `some saved widths should be fractions of a cell: ${savedWidths.join(', ')}`);
  pass(`the saved widths are on the 1/8 grid, mostly fractions of a cell: ${savedWidths.join(', ')}`);

  // 4. moving a card is fine-grained too, and cards never overlap
  const grip = await page.evaluate(() => { const r = document.querySelector('[data-family-board-card="b"] .homi-family-board__grip').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  const bBefore = await box(page, 'b');
  await page.mouse.move(grip.x, grip.y); await page.mouse.down(); await page.mouse.move(grip.x + 21, grip.y + 9, { steps: 4 }); await page.mouse.up(); await page.waitForTimeout(150);
  const bAfter = await box(page, 'b');
  const moved = Math.hypot(bAfter.x - bBefore.x, bAfter.y - bBefore.y);
  assert.ok(moved > 5 && moved < pitch / 2, `a 21px drag should move the card a little (it moved ${moved.toFixed(0)}px)`);
  const boxes = await Promise.all(['a', 'b', 'c'].map((k) => box(page, k)));
  for (let i = 0; i < boxes.length; i += 1) for (let j = i + 1; j < boxes.length; j += 1) {
    const p = boxes[i], q = boxes[j];
    assert.ok(p.x + p.w <= q.x + 0.5 || q.x + q.w <= p.x + 0.5 || p.y + p.h <= q.y + 0.5 || q.y + q.h <= p.y + 0.5, `cards ${i} and ${j} overlap`);
  }
  pass(`moving is fine-grained too (a 21px drag moved the card ${moved.toFixed(0)}px) and no cards overlap`);
  assert.deepEqual(errors, [], `page errors: ${errors.join(' | ')}`);
  console.log('\nAll fine-resize checks passed.');
} finally { await browser.close(); }
