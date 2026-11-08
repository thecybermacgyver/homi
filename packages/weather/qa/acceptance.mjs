// Isolated browser acceptance for Weather (suite homi-weather-multiuser-1.0.0).
// Run only against a localhost stack (see qa/README.md) whose owner is a fixture account
// (HOMI_TEST_CREDENTIALS) with a second fixture member and Weather installed. Three browser
// profiles: two devices of the owner (a, b) and the second member (c). All data is invented.
// Outputs (screenshots and the results file) go to HOMI_QA_OUT; location names of the real
// network are never written to the results.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const OUT = process.env.HOMI_QA_OUT ?? new URL('./', import.meta.url).pathname;
const PROFILES = process.env.HOMI_TEST_PROFILES ?? '/tmp/homi-weather-profiles';
mkdirSync(PROFILES, {recursive: true}); mkdirSync(OUT, {recursive: true});
const env = Object.fromEntries(readFileSync(process.env.HOMI_TEST_CREDENTIALS, 'utf8').trim().split('\n').map(s => {const i = s.indexOf('='); return [s.slice(0, i), s.slice(i + 1)];}));
const base = process.env.HOMI_TEST_URL ?? 'http://localhost:3400';
if (new URL(base).hostname !== 'localhost') throw new Error('Acceptance requires the isolated localhost test stack');
const run = Date.now().toString().slice(-6);
const SECOND = 'weather-second@example.invalid';
const TZ = 'America/Toronto';
// A neutral, invented position (a Toronto district) for the owner's two devices.
const GEO = {latitude: 43.77, longitude: -79.23};
const contexts = [], errors = [], results = [];
const pass = (name, detail = {}) => {results.push({name, ...detail}); console.log('PASS', name, Object.keys(detail).length ? JSON.stringify(detail) : '');};
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function poll(fn, message, tries = 45) {let last; for (let i = 0; i < tries; i++) {try {last = await fn(); if (last) return last;} catch (e) {last = e.message;} await sleep(1000);} throw new Error(message + (last ? ' (' + String(last).slice(0, 160) + ')' : ''));}

const options = (dir, {width = 390, offline = false, geo = true} = {}) => ({headless: true, executablePath: process.env.HOMI_TEST_CHROME, viewport: {width, height: 900}, offline, timezoneId: TZ, ...(geo ? {permissions: ['geolocation'], geolocation: GEO} : {})});
async function launch(label, opts = {}) {
  const dir = `${PROFILES}/${label}-${run}`;
  const ctx = await chromium.launchPersistentContext(dir, options(dir, opts));
  contexts.push(ctx);
  const p = ctx.pages()[0] ?? await ctx.newPage();
  p.on('pageerror', e => errors.push(label + ': ' + e.message));
  return {label, dir, ctx, p, opts};
}
async function login(d, email = env.HOMI_BOOTSTRAP_EMAIL) {
  await d.p.goto(base);
  await d.p.getByLabel('Email', {exact: true}).fill(email);
  await d.p.getByLabel('Password', {exact: true}).fill(env.HOMI_OWNER_PASSWORD);
  await d.p.getByRole('button', {name: 'Sign in', exact: true}).click();
  await d.p.getByRole('button', {name: 'Settings', exact: true}).first().waitFor({timeout: 30000});
}
async function restart(d, offline) {
  await d.ctx.close();
  const ctx = await chromium.launchPersistentContext(d.dir, options(d.dir, {...d.opts, offline}));
  contexts.push(ctx); d.ctx = ctx; d.p = ctx.pages()[0] ?? await ctx.newPage();
  d.p.on('pageerror', e => errors.push(d.label + ': ' + e.message));
  await d.p.goto(base);
}
async function idb(d, store) {
  return d.p.evaluate(async store => {
    const db = await new Promise((res, rej) => {const r = indexedDB.open('homi-client'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);});
    return await new Promise((res, rej) => {const r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);});
  }, store);
}
async function identity(d) {return JSON.parse((await idb(d, 'meta')).find(r => r.key === 'activeOfflineContext').value);}
async function api(d, path, method = 'GET', body) {
  const id = await identity(d);
  return d.p.evaluate(async ({path, method, body, id}) => {
    const r = await fetch('/api/v1/' + path, {method, headers: {'Content-Type': 'application/json', 'X-Homi-Household-ID': id.householdId, 'X-Homi-Client-ID': id.clientId}, ...(body ? {body: JSON.stringify(body)} : {})});
    return {status: r.status, body: await r.json()};
  }, {path, method, body, id});
}
const places = async d => (await api(d, 'modules/weather/places')).body.data;
const prefs = async d => (await api(d, 'modules/weather/preferences')).body.data;
const placeNamed = async (d, name) => (await places(d)).find(p => p.name === name);
const card = (d, key) => d.p.locator(`[data-family-board-card="weather:${key}"]`);
const slotName = async (d, n) => { const l = card(d, 'place-' + n).locator('.wx-place'); return (await l.count()) ? (await l.first().innerText()).replace(/\s+/g, ' ').trim() : ''; };
const slotEmpty = async (d, n) => /has no place yet/.test(await card(d, 'place-' + n).innerText());
const cardLabel = async (d, key) => (await card(d, key).locator('.wx').first().getAttribute('aria-label')) ?? '';
const home = async d => {await d.p.getByRole('button', {name: 'Dashboard', exact: true}).first().click(); await card(d, 'current').waitFor({timeout: 30000});};
async function openWeather(d) {
  await d.p.getByRole('button', {name: 'Modules', exact: true}).first().click();
  await d.p.getByRole('button', {name: /^Weather/}).first().click();
  await d.p.getByRole('heading', {name: 'Weather', exact: true}).waitFor({timeout: 30000});
}
async function addPlace(d, query, label) {
  await d.p.getByRole('button', {name: 'Add a place', exact: true}).first().click();
  await d.p.locator('#wx-search').fill(query);
  const choice = d.p.locator('.wx-results button', {hasText: label}).first();
  await choice.waitFor({timeout: 30000}); await choice.click();
  await d.p.locator('#wx-search').waitFor({state: 'detached', timeout: 15000});
}
const slotSelect = (d, id) => d.p.locator('#wx-slot-' + id);
async function axeRun(d, name) {
  const r = await d.p.evaluate(async src => {if (!window.axe) (0, eval)(src); return await window.axe.run(document, {runOnly: {type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']}, resultTypes: ['violations', 'incomplete']});}, AXE);
  const violations = r.violations.map(v => v.id + ' x' + v.nodes.length + ': ' + v.nodes.slice(0, 2).map(n => n.target.join(' ')).join(' | '));
  assert.deepEqual(violations, [], `accessibility violations on ${name}`);
  return {screen: name, violations: 0, needsReview: r.incomplete.length, reviewRules: [...new Set(r.incomplete.map((i) => i.id))]};
}
const overflow = d => d.p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

try {
  const a = await launch('a'), b = await launch('b'), c = await launch('c', {geo: false});
  await login(a); await login(b); await login(c, SECOND);
  const mods = (await api(a, 'core/modules')).body.data.modules;
  const weather = mods.find(m => m.moduleKey === 'weather');
  assert.ok(weather, 'Weather must be installed on the stack');
  if (!weather.enabled) assert.equal((await api(a, 'core/modules/weather', 'PATCH', {enabled: true, baseRevision: weather.revision})).status, 200);
  for (const d of [a, b, c]) {await d.p.reload(); await card(d, 'current').waitFor({timeout: 30000});}
  const ia = await identity(a), ib = await identity(b), ic = await identity(c);
  assert.equal(ia.authSubject, ib.authSubject); assert.notEqual(ia.clientId, ib.clientId);
  assert.notEqual(ia.authSubject, ic.authSubject); assert.equal(ia.householdId, ic.householdId);
  pass('two devices of one member and a distinct member share the household');
  // Start from nothing, so a re-run on the same stack behaves like the first.
  for (const p of await places(a)) await api(a, 'core/sync/mutations', 'POST', {clientMutationId: crypto.randomUUID(), moduleKey: 'weather', entityType: 'place', entityId: p.id, operation: 'delete', baseRevision: p.revision, payload: {}});
  for (const d of [a, b, c]) {await d.p.reload(); await card(d, 'current').waitFor({timeout: 30000});}

  // 1. The six cards and their first state.
  for (const key of ['current', 'place-1', 'place-2', 'place-3', 'place-4', 'place-5']) await card(a, key).waitFor({timeout: 20000});
  for (let n = 1; n <= 5; n++) assert.equal(await slotEmpty(a, n), true, 'place ' + n + ' starts empty');
  pass('the Dashboard shows the Current card and five empty place cards');

  // 2. The Current card: a precise position on the owner's devices, an approximate one without a position.
  await poll(async () => /Scarborough/.test(await cardLabel(a, 'current')), 'precise name', 40);
  assert.ok(!/Approximate location/.test(await cardLabel(a, 'current')), 'a precise position is not labelled approximate');
  await poll(async () => /Approximate location/.test(await cardLabel(c, 'current')), 'approximate label for the member without a position', 40);
  assert.match(await cardLabel(c, 'current'), /°/);
  const href = await card(a, 'current').locator('a.wx').getAttribute('href');
  assert.match(href, /^https:\/\/weather\.com\/weather\/today\/l\/43\.77\d*,-79\.23\d*$/);
  pass('the Current card uses the device position, or an approximate one labelled as such, and links to the right forecast');

  // 3. Add places on one device; they reach the other device of the same member, in both directions.
  await openWeather(a);
  await addPlace(a, 'Winnipeg', 'Winnipeg, Manitoba');
  const wp = await poll(() => placeNamed(a, 'Winnipeg'), 'Winnipeg stored');
  assert.equal(wp.cardSlot, 1);
  await openWeather(b);
  await poll(async () => (await b.p.locator('.wx-item').count()) === 1, 'Winnipeg appears on the second device');
  await addPlace(b, 'Toronto', 'Toronto, Ontario');
  const tp = await poll(() => placeNamed(b, 'Toronto'), 'Toronto stored');
  assert.equal(tp.cardSlot, 2);
  await poll(async () => (await a.p.locator('.wx-item').count()) === 2, 'Toronto appears on the first device');
  await home(a); await home(b);
  for (const d of [a, b]) {
    await poll(async () => /Winnipeg/.test(await slotName(d, 1)) && /Toronto/.test(await slotName(d, 2)), 'place cards follow on ' + d.label, 40);
    await poll(async () => /°/.test(await cardLabel(d, 'place-1')), 'a forecast reaches the card', 40);
  }
  pass('places saved on one device reach the other device and its Dashboard cards, in both directions');

  // 4. Privacy: the second member sees none of them, by the screen and by the server.
  await c.p.reload(); await card(c, 'current').waitFor({timeout: 30000}); await sleep(1500);
  assert.equal(await slotEmpty(c, 1), true); assert.equal(await slotEmpty(c, 2), true);
  assert.deepEqual(await places(c), []);
  assert.equal((await api(c, 'modules/weather/places/' + wp.id)).status, 404, 'another member\'s place must not be readable by id');
  assert.deepEqual((await places(a)).map(p => p.name).sort(), ['Toronto', 'Winnipeg']);
  const steal = await api(c, 'core/sync/mutations', 'POST', {clientMutationId: crypto.randomUUID(), moduleKey: 'weather', entityType: 'place', entityId: wp.id, operation: 'delete', baseRevision: wp.revision, payload: {}});
  assert.notEqual(steal.body.data?.status, 'applied', 'another member must not be able to delete a place');
  assert.ok(await placeNamed(a, 'Winnipeg'), 'the place survives the attempt');
  pass('another member sees none of a member\'s places and cannot read or delete them');

  // 5. Choose which place a Dashboard card shows; a card is given to one place at a time.
  await openWeather(a);
  await slotSelect(a, tp.id).selectOption('3');
  await poll(async () => (await placeNamed(a, 'Toronto')).cardSlot === 3, 'Toronto moved to place 3');
  await home(a); await home(b);
  for (const d of [a, b]) await poll(async () => /Toronto/.test(await slotName(d, 3)) && (await slotEmpty(d, 2)), 'cards follow the choice on ' + d.label, 40);
  await openWeather(a);
  await slotSelect(a, tp.id).selectOption('1');
  await poll(async () => (await placeNamed(a, 'Toronto')).cardSlot === 1 && (await placeNamed(a, 'Winnipeg')).cardSlot === null, 'a card is taken from the place that had it');
  await slotSelect(a, wp.id).selectOption('2');
  await poll(async () => (await placeNamed(a, 'Winnipeg')).cardSlot === 2, 'Winnipeg given place 2');
  await home(a); await home(b);
  for (const d of [a, b]) await poll(async () => /Toronto/.test(await slotName(d, 1)) && /Winnipeg/.test(await slotName(d, 2)), 'final card choice on ' + d.label, 40);
  pass('choosing a place for a Dashboard card moves it on every device and a card holds one place at a time');

  // 6. Celsius or Fahrenheit: synced to the member's other device, and private.
  await openWeather(a);
  const inC = await cardLabel(a, 'place-1').catch(() => '');
  await a.p.getByRole('button', {name: '°F', exact: true}).click();
  await poll(async () => (await prefs(a))?.units === 'imperial', 'imperial preference stored');
  await home(a); await home(b);
  for (const d of [a, b]) await poll(async () => /°F|, -?\d+°/.test(await d.p.locator('[data-family-board-card="weather:place-1"]').innerText()) && /°F/.test(await d.p.locator('[data-family-board-card="weather:place-1"] .wx-temp').innerText()), 'Fahrenheit on ' + d.label, 40);
  await poll(async () => /°C/.test(await c.p.locator('[data-family-board-card="weather:current"] .wx-temp').innerText()), 'the other member keeps Celsius', 20);
  pass('the Celsius or Fahrenheit choice follows the member to their other device and does not change another member\'s cards', {before: inC ? 'had a forecast' : 'none'});

  // 7. Core's Add creates a place; the floating button is only there on the Weather page.
  await openWeather(a);
  await a.p.getByRole('button', {name: 'Add a place', exact: true}).last().click();
  await a.p.locator('#wx-search').waitFor();
  await a.p.keyboard.press('Escape');
  await a.p.locator('#wx-search').waitFor({state: 'detached', timeout: 10000});
  pass('Core\'s Add opens the add-a-place sheet and Escape closes it');

  // 8. Offline: the Dashboard and its places load after a full restart, edits queue and survive another restart, then reconnect delivers them.
  await a.p.getByRole('button', {name: '°C', exact: true}).click();
  await poll(async () => (await prefs(a))?.units === 'metric', 'metric preference stored');
  await a.p.evaluate(() => navigator.serviceWorker.ready);
  await home(a); await sleep(2500);
  await restart(a, true);
  await card(a, 'current').waitFor({timeout: 45000});
  await poll(async () => /Toronto/.test(await slotName(a, 1)) && /Winnipeg/.test(await slotName(a, 2)), 'places load offline', 20);
  assert.match(await cardLabel(a, 'place-1'), /Offline/);
  assert.match(await cardLabel(a, 'place-1'), /°/);
  await openWeather(a);
  assert.equal(await a.p.getByRole('button', {name: 'Add a place', exact: true}).first().isDisabled(), true, 'adding a place needs a connection (a search)');
  await slotSelect(a, wp.id).selectOption('4');
  await a.p.getByRole('button', {name: '°F', exact: true}).click();
  await poll(async () => (await idb(a, 'mutations')).filter(m => m.moduleKey === 'weather' && m.status === 'queued').length >= 2, 'two changes queued', 10);
  await restart(a, true);
  await card(a, 'current').waitFor({timeout: 45000});
  await poll(async () => /Winnipeg/.test(await slotName(a, 4)), 'the offline choice survives another restart', 20);
  assert.ok((await idb(a, 'mutations')).filter(m => m.moduleKey === 'weather' && ['queued', 'sending'].includes(m.status)).length >= 2);
  pass('after a full restart while offline the Dashboard and the places load with their last forecast; changes made offline survive another restart');
  await a.ctx.setOffline(false);
  await poll(async () => !(await idb(a, 'mutations')).some(m => m.moduleKey === 'weather' && ['queued', 'sending'].includes(m.status)), 'queue drained', 60);
  assert.deepEqual((await idb(a, 'mutations')).filter(m => m.moduleKey === 'weather' && ['conflict', 'rejected'].includes(m.status)), []);
  await poll(async () => (await placeNamed(a, 'Winnipeg')).cardSlot === 4 && (await prefs(a)).units === 'imperial', 'offline changes delivered');
  await poll(async () => (await places(b)).find(p => p.name === 'Winnipeg')?.cardSlot === 4, 'delivered changes reach the other device');
  pass('reconnect delivers every queued change without conflicts and the other device agrees');

  // 9. A stale offline edit is surfaced for review and the shared version stays.
  await openWeather(a);
  await a.ctx.setOffline(true);
  await slotSelect(a, wp.id).selectOption('5');
  await poll(async () => (await idb(a, 'mutations')).some(m => m.moduleKey === 'weather' && m.status === 'queued'), 'the offline edit is queued', 10);
  const live = await placeNamed(b, 'Winnipeg');
  const shared = await api(b, 'core/sync/mutations', 'POST', {clientMutationId: crypto.randomUUID(), moduleKey: 'weather', entityType: 'place', entityId: live.id, operation: 'update', baseRevision: live.revision, payload: {name: live.name, region: live.region, country: live.country, latitude: live.latitude, longitude: live.longitude, cardSlot: 3, position: live.position}});
  assert.equal(shared.body.data.status, 'applied');
  await a.ctx.setOffline(false);
  await a.p.getByText('This changed on another device before your change arrived.').waitFor({timeout: 60000});
  assert.equal((await placeNamed(a, 'Winnipeg')).cardSlot, 3, 'the shared version stays');
  await a.p.getByRole('button', {name: 'Dismiss', exact: true}).first().click();
  await a.p.getByText('This changed on another device before your change arrived.').waitFor({state: 'detached', timeout: 10000});
  pass('a stale offline edit is surfaced for review and the shared version stays on screen');

  // 10. Layout at three widths: no horizontal overflow, every card fills its box, and axe finds nothing.
  const axeResults = [];
  for (const width of [390, 768, 1440]) {
    await a.p.setViewportSize({width, height: 900});
    await home(a); await a.p.evaluate(() => scrollTo(0, 0)); await sleep(800);
    assert.equal(await overflow(a), true, 'dashboard overflow at ' + width);
    const fit = await a.p.evaluate(() => [...document.querySelectorAll('[data-family-board-card^="weather:"]')].map((cell) => { const c = cell.getBoundingClientRect(), w = cell.querySelector('.wx')?.getBoundingClientRect(); return w ? {key: cell.dataset.familyBoardCard, dw: Math.abs(w.width - c.width), dh: Math.abs(w.height - c.height), inside: w.right <= c.right + 1.5 && w.bottom <= c.bottom + 1.5} : null; }).filter(Boolean));
    assert.ok(fit.length >= 6, 'all six cards are drawn at ' + width);
    for (const f of fit) assert.ok(f.dw <= 1.5 && f.dh <= 1.5 && f.inside, `${f.key} does not fill its box at ${width}px (${f.dw.toFixed(1)}x${f.dh.toFixed(1)})`);
    await a.p.screenshot({path: OUT + `weather-dashboard-${width}.png`});
    axeResults.push(await axeRun(a, `dashboard ${width}px`));
    await openWeather(a); await sleep(800);
    assert.equal(await overflow(a), true, 'Weather page overflow at ' + width);
    await a.p.screenshot({path: OUT + `weather-page-${width}.png`});
    axeResults.push(await axeRun(a, `Weather page ${width}px`));
  }
  // The sheets and the confirmation dialog.
  await a.p.setViewportSize({width: 390, height: 900});
  await a.p.getByRole('button', {name: 'Add a place', exact: true}).first().click(); await a.p.locator('#wx-search').fill('Win'); await sleep(1500);
  axeResults.push(await axeRun(a, 'add-a-place sheet')); await a.p.keyboard.press('Escape'); await a.p.locator('#wx-search').waitFor({state: 'detached'});
  await a.p.locator('.wx-toolbar').getByRole('button', {name: 'Settings', exact: true}).click(); await a.p.locator('#wx-units').waitFor();
  axeResults.push(await axeRun(a, 'settings sheet')); await a.p.keyboard.press('Escape'); await a.p.locator('#wx-units').waitFor({state: 'detached'});
  await a.p.getByRole('button', {name: 'Remove', exact: true}).first().click(); await a.p.getByText('Remove this place?').waitFor();
  axeResults.push(await axeRun(a, 'remove confirmation')); await a.p.keyboard.press('Escape');
  assert.deepEqual(errors, []);
  pass('no horizontal overflow at 390, 768 and 1440 px, every card fills its box, and no page errors');
  pass('the axe pass (WCAG 2.0 and 2.1 A and AA) finds no violation on ' + axeResults.length + ' screens', {screens: axeResults.length, needsReview: axeResults.reduce((n, r) => n + r.needsReview, 0), needsReviewRules: [...new Set(axeResults.flatMap((r) => r.reviewRules))]});

  // 11. Removing a place frees its card on every device.
  await a.p.getByRole('button', {name: 'Remove', exact: true}).first().click();
  await a.p.getByRole('dialog').getByRole('button', {name: 'Remove', exact: true}).click();
  await poll(async () => (await places(a)).length === 1, 'one place removed', 20);
  await poll(async () => (await places(b)).length === 1, 'the removal reaches the other device', 20);
  pass('removing a place removes it everywhere');

  writeFileSync(OUT + 'browser-acceptance.json', JSON.stringify({suite: 'homi-weather-multiuser-1.0.0', date: new Date().toISOString(), run, results}, null, 2) + '\n');
  console.log('PASS_WEATHER_ACCEPTANCE', results.length);
} catch (error) {
  console.error(error);
  for (const [i, ctx] of contexts.entries()) {
    try {const page = ctx.pages()[0]; if (page) {await page.screenshot({path: OUT + `failure-${i}.png`}); console.log('PAGE', i, (await page.locator('body').innerText()).slice(0, 900).replace(/\n+/g, ' | '));}} catch {}
  }
  process.exitCode = 1;
} finally {
  for (const ctx of contexts) await ctx.close().catch(() => {});
}
