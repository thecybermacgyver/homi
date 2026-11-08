// Weather card size acceptance, in a real browser with Homi's real Dashboard styles
// and Homi's scale-to-fit. The card is made every size from half a cell to a tall or
// very wide card, on a monitor and on a phone. At every size the card must exactly
// fill its box (no overflow onto its neighbours), nothing may be cut off or touch the
// edge, and the contents must grow with the card.
//   pnpm --filter @homi/web build && node qa/browser-sizes.mjs   (HOMI_TEST_CHROME optional)
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { normalizeForecast } from '../dist/server.js';

const here = (p) => new URL(p, import.meta.url).pathname;
const dist = here('../../../apps/web/dist/assets/');
const css = readdirSync(dist).filter((f) => f.endsWith('.css')).map((f) => `<link rel="stylesheet" href="file://${dist}${f}">`).join('');
const forecast = normalizeForecast(JSON.parse(readFileSync(here('./fixtures/forecast.json'), 'utf8')), new Date());
const work = mkdtempSync(join(tmpdir(), 'homi-wx-sizes-'));
writeFileSync(join(work, 'forecast.json'), JSON.stringify(forecast));
writeFileSync(join(work, 'entry.tsx'), `
import { createRoot } from 'react-dom/client';
import { FitToCard } from ${JSON.stringify(here('../../../apps/web/src/FitToCard.tsx'))};
import { WxCard, css } from ${JSON.stringify(here('../src/web.tsx'))};
import forecast from './forecast.json';
const sizes: [string, number, number][] = ${JSON.stringify([['0.5x0.5', .5, .5], ['1x0.5', 1, .5], ['1x1', 1, 1], ['1x2', 1, 2], ['1.5x1', 1.5, 1], ['2x1', 2, 1], ['2x2', 2, 2], ['2.5x2', 2.5, 2], ['3x2', 3, 2], ['4x2', 4, 2], ['2x3', 2, 3], ['4x3', 4, 3], ['2x5', 2, 5], ['3x4', 3, 4], ['6x3', 6, 3], ['8x4', 8, 4]])};
const pitch = Number(new URLSearchParams(location.search).get('pitch'));
const px = (cells: number, p: number) => Math.round(cells * p - 16);
createRoot(document.getElementById('root')!).render(<div style={{ padding: 8, display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}><style>{css}</style>
  {sizes.map(([name, w, h]) => <div key={name} className="homi-family-board__cell" data-size={name} style={{ width: px(w, pitch), height: px(h, 68) }}>
    <article className="homi-family-card--bare"><div className="homi-family-module-surface homi-family-module-surface--fit"><FitToCard><div className="wx-wrap">
      <WxCard title="Scarborough" place="Scarborough, Toronto" forecast={forecast as any} units="metric" href="#" locale="en-CA" nowMs={Date.now()} offline={false} />
    </div></FitToCard></div></article></div>)}
</div>);
`);
execFileSync('pnpm', ['exec', 'esbuild', join(work, 'entry.tsx'), '--bundle', '--format=iife', '--jsx=automatic', '--loader:.json=json', `--outfile=${join(work, 'out.js')}`, '--log-level=error'], { cwd: here('../'), stdio: 'inherit' });
writeFileSync(join(work, 'index.html'), `<!doctype html><meta charset=utf-8>${css}<div id=root></div><script src="out.js"></script>`);

const browser = await chromium.launch({ headless: true, executablePath: process.env.HOMI_TEST_CHROME ?? undefined });
const errors = [];
try {
  for (const [label, pitch, width] of [['monitor', 215, 2200], ['phone', 90, 2200]]) {
    const page = await browser.newPage({ viewport: { width, height: 1200 } });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`file://${join(work, 'index.html')}?pitch=${pitch}`);
    await page.waitForTimeout(1200);
    const rows = await page.evaluate(() => [...document.querySelectorAll('.homi-family-board__cell')].map((cell) => {
      const c = cell.getBoundingClientRect(), card = cell.querySelector('.wx').getBoundingClientRect();
      const parts = ['.wx-temp', '.wx-meta', '.wx-place', '.wx-pill', '.wx-note', '.wx-icon'].map((sel) => cell.querySelector(sel)).filter((el) => el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0);
      const inset = Math.min(...parts.map((el) => { const r = el.getBoundingClientRect(); return Math.min(r.left - card.left, card.right - r.right, r.top - card.top, card.bottom - r.bottom); }));
      const temp = cell.querySelector('.wx-temp').getBoundingClientRect().height;
      const clipped = parts.some((el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).textOverflow === 'ellipsis' && el.classList.contains('wx-cond'));
      return { size: cell.dataset.size, cellW: c.width, cellH: c.height, cardW: card.width, cardH: card.height, inset, temp, clipped };
    }));
    for (const r of rows) {
      assert.ok(Math.abs(r.cardW - r.cellW) <= 1.5 && Math.abs(r.cardH - r.cellH) <= 1.5, `${label} ${r.size}: the card is ${r.cardW.toFixed(0)}x${r.cardH.toFixed(0)}px in a ${r.cellW}x${r.cellH}px box`);
      assert.ok(r.inset >= 1, `${label} ${r.size}: contents touch or pass the card edge (inset ${r.inset.toFixed(1)}px)`);
      assert.ok(!r.clipped, `${label} ${r.size}: the conditions text is cut off`);
    }
    const by = Object.fromEntries(rows.map((r) => [r.size, r]));
    assert.ok(by['4x3'].temp > by['2x2'].temp && by['2x2'].temp > by['1x1'].temp, `${label}: the temperature must grow with the card (${by['1x1'].temp.toFixed(0)} < ${by['2x2'].temp.toFixed(0)} < ${by['4x3'].temp.toFixed(0)}px)`);
    console.log('PASS', `${label}: all ${rows.length} sizes fill their box exactly, nothing touches the edge or is cut off, and the temperature grows with the card (${by['1x1'].temp.toFixed(0)} < ${by['2x2'].temp.toFixed(0)} < ${by['4x3'].temp.toFixed(0)}px)`);
    if (label === 'monitor') await page.screenshot({ path: join(work, 'sizes.png'), fullPage: true });
    await page.close();
  }
  assert.deepEqual(errors, [], `page errors: ${errors.join(' | ')}`);
  console.log(`\nAll Weather size checks passed. Screenshot: ${join(work, 'sizes.png')}`);
} finally { await browser.close(); }
