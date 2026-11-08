// Browser load check: the built web module must load in a real browser exactly as
// Homi serves it, with Homi's own /module-runtime files, and define every card
// and page its manifest declares. This catches "Failed to resolve module
// specifier" before an installed module breaks on a member's device.
//   pnpm --filter @homi/web build && pnpm build && node qa/browser-load.mjs
//   HOMI_TEST_CHROME=/usr/bin/google-chrome  (optional)
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const runtimeDir = here('../../../apps/web/dist/module-runtime/');
const moduleDir = here('../dist/');
const assetsDir = here('../../../apps/web/dist/assets/');
const manifest = JSON.parse(await readFile(here('../homi.module.json'), 'utf8'));
const types = { '.js': 'text/javascript', '.html': 'text/html' };

const server = http.createServer(async (req, res) => {
  if (req.url === '/favicon.ico') { res.writeHead(204); return res.end(); }
  const path = normalize(new URL(req.url, 'http://x').pathname);
  const [dir, rel] = path.startsWith('/module-runtime/') ? [runtimeDir, path.slice('/module-runtime/'.length)] : path.startsWith('/mod/') ? [moduleDir, path.slice('/mod/'.length)] : path.startsWith('/assets/') ? [assetsDir, path.slice('/assets/'.length)] : [null, ''];
  if (!dir || rel.includes('..')) { res.writeHead(path === '/' ? 200 : 404, { 'content-type': 'text/html' }); return res.end('<!doctype html><title>load</title>'); }
  try { const body = await readFile(join(dir, rel)); res.writeHead(200, { 'content-type': types[extname(rel)] ?? 'application/octet-stream' }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0);

const browser = await chromium.launch({ headless: true, executablePath: process.env.HOMI_TEST_CHROME ?? undefined });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`http://localhost:${server.address().port}/`);
  const result = await page.evaluate(async () => {
    const out = { files: [], pages: [], cards: [], failed: null };
    try {
      for (const file of ['art.js', 'themes.js', 'projection.js', 'sync.js', 'constants.js', 'web.js']) { await import(`/mod/${file}`); out.files.push(file); }
      const mod = (await import('/mod/web.js')).createHomiWebModule();
      out.pages = Object.keys(mod.pages ?? {});
      out.cards = Object.keys(mod.familyBoard ?? {});
      out.key = mod.moduleKey;
    } catch (e) { out.failed = String(e && e.message || e); }
    return out;
  });
  assert.equal(result.failed, null, `the module failed to load in the browser: ${result.failed}`);
  assert.equal(result.key, manifest.moduleKey);
  const wantCards = manifest.extensions.familyBoard.map((c) => c.surfaceId).sort();
  assert.deepEqual([...result.cards].sort(), wantCards, 'every Dashboard card the manifest declares must be defined');
  assert.deepEqual(result.pages, ['weather']);
  assert.deepEqual(errors, [], `page errors: ${errors.join(' | ')}`);
  console.log(`PASS_HOMI_WEATHER_BROWSER_LOAD (${result.files.length} files, ${result.cards.length} cards, ${result.pages.length} page)`);
} finally { await browser.close(); server.close(); }
