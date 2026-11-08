// Current-card location acceptance, in a real browser. The Current card must show
// the weather where the device is. When the device cannot give a precise position
// (no GPS or location service, a timeout, or the member said no) it must fall back
// to the server's estimate from the internet connection and say so, and a precise
// position must still win when the device can give one. The weather services are
// replaced with recorded answers; no network is used.
//   node qa/browser-location.mjs      (HOMI_TEST_CHROME=/usr/bin/google-chrome optional)
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { normalizeForecast } from '../dist/server.js';

const here = (p) => new URL(p, import.meta.url).pathname;
const forecast = normalizeForecast(JSON.parse(readFileSync(here('./fixtures/forecast.json'), 'utf8')), new Date());
const work = mkdtempSync(join(tmpdir(), 'homi-wx-loc-'));
writeFileSync(join(work, 'entry.tsx'), `
import { createRoot } from 'react-dom/client';
import { createHomiWebModule } from ${JSON.stringify(here('../src/web.tsx'))};
const none = async () => [];
const store = new Map<string, any>();
const actions: any = { listWorkingEntities: none, listCachedEntities: none, listMutations: none, registerContextActions: () => {}, navigate: () => {}, refreshModuleState: async () => {}, syncNow: async () => {}, dismissMutation: async () => {}, enqueueMutation: async () => ({ clientMutationId: 'x' }),
  getCachedEntity: async (t: string, id: string) => store.get(t + ':' + id) ?? null,
  replaceCachedEntities: async (t: string, rows: any[]) => { for (const r of rows) store.set(t + ':' + r.entityId, { entityType: t, entityId: r.entityId, revision: r.revision, data: r.data }); } };
const context = { authSubject: 'a', householdId: '00000000-0000-4000-8000-000000000001', clientId: '00000000-0000-4000-8000-000000000002', locale: 'en-CA', timeZone: 'America/Toronto', online: true };
const Current = createHomiWebModule().familyBoard!.current!;
createRoot(document.getElementById('root')!).render(<div className="homi-family-board__cell" style={{ width: 300, height: 200 }}><Current context={context} actions={actions} /></div>);
`);
execFileSync('pnpm', ['exec', 'esbuild', join(work, 'entry.tsx'), '--bundle', '--format=iife', '--jsx=automatic', `--outfile=${join(work, 'out.js')}`, '--log-level=error'], { cwd: here('../'), stdio: 'inherit' });
writeFileSync(join(work, 'index.html'), '<!doctype html><meta charset=utf-8><div id=root></div><script src="out.js"></script>');

const browser = await chromium.launch({ headless: true, executablePath: process.env.HOMI_TEST_CHROME ?? undefined });
const json = (data) => ({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
async function scenario(name, geo, locate, check) {
  const context = await browser.newContext({ viewport: { width: 400, height: 300 } });
  const page = await context.newPage();
  const calls = [];
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/v1/modules/weather/**', (route) => {
    const path = new URL(route.request().url()).pathname.split('/').pop();
    calls.push(path);
    if (path === 'locate') return locate === null ? route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: { message: 'down' } }) }) : route.fulfill(json(locate));
    if (path === 'forecast') return route.fulfill(json(forecast));
    if (path === 'place-name') return route.fulfill(json({ name: 'Toronto', region: 'Ontario', country: 'Canada', latitude: 43.65, longitude: -79.38 }));
    return route.fulfill(json(path === 'places' ? [] : path === 'profile' ? { userId: '00000000-0000-4000-8000-0000000000aa' } : null));
  });
  await page.addInitScript((mode) => {
    const fail = (code) => (ok, err) => setTimeout(() => err({ code, message: 'no' }), 20);
    const geolocation = mode === 'precise' ? { getCurrentPosition: (ok) => setTimeout(() => ok({ coords: { latitude: 43.6532, longitude: -79.3832 } }), 20) }
      : mode === 'denied' ? { getCurrentPosition: fail(1) } : mode === 'timeout' ? { getCurrentPosition: fail(3) } : { getCurrentPosition: fail(2) };
    Object.defineProperty(navigator, 'geolocation', { value: geolocation, configurable: true });
    if (mode === 'precise') Object.defineProperty(navigator, 'permissions', { value: { query: async () => ({ state: 'granted' }) }, configurable: true });
    else Object.defineProperty(navigator, 'permissions', { value: { query: async () => ({ state: mode === 'denied' ? 'denied' : 'prompt' }) }, configurable: true });
  }, geo);
  await page.goto('file://' + join(work, 'index.html'));
  await page.waitForTimeout(1500);
  const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  await check({ text, calls, errors });
  await context.close();
  console.log('PASS', name);
}
const ottawa = { name: 'Ottawa', region: 'Ontario', country: 'Canada', latitude: 45.41, longitude: -75.7, approximate: true };
try {
  await scenario('no GPS or location service (position unavailable): the estimate is used and labelled approximate', 'unavailable', ottawa, ({ text, calls, errors }) => {
    assert.match(text, /Ottawa, Ontario/); assert.match(text, /Approximate location/); assert.match(text, /\d+ ?°C/);
    assert.ok(calls.includes('locate') && calls.includes('forecast')); assert.deepEqual(errors, []);
  });
  await scenario('the member said no to location: the estimate is used, labelled approximate', 'denied', ottawa, ({ text, calls }) => {
    assert.match(text, /Ottawa, Ontario/); assert.match(text, /Approximate location/); assert.ok(calls.includes('locate'));
  });
  await scenario('location not asked yet (a prompt would appear): the estimate shows at once', 'timeout', ottawa, ({ text }) => {
    assert.match(text, /Ottawa, Ontario/); assert.match(text, /Approximate location/);
  });
  await scenario('a precise position wins when the device can give one: no estimate is asked for', 'precise', ottawa, ({ text, calls }) => {
    assert.match(text, /Toronto, Ontario/); assert.doesNotMatch(text, /Approximate location/); assert.ok(!calls.includes('locate'), 'the estimate must not be asked for');
  });
  await scenario('no position and the estimate service is down: a clear message and a Try again button, no crash', 'unavailable', null, ({ text, errors }) => {
    assert.match(text, /could not be found/i); assert.match(text, /Try again/); assert.deepEqual(errors, []);
  });
  console.log('\nAll location checks passed.');
} finally { await browser.close(); }
