// Isolated browser acceptance for the Shopping List notepad card (0.4.1). Run
// only against a localhost stack whose owner is a fixture account
// (HOMI_TEST_CREDENTIALS) with Shopping installed and enabled. All data is
// invented.
//
//   HOMI_TEST_CREDENTIALS=... HOMI_TEST_PROFILES=<fresh dir> HOMI_TEST_URL=http://localhost:3400 \
//     node packages/shopping/qa/notepad-acceptance.mjs
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
const OUT = process.env.HOMI_QA_OUT ?? new URL('./', import.meta.url).pathname;
const PROFILES = process.env.HOMI_TEST_PROFILES ?? '/tmp/homi-shopping-notepad-profiles';
mkdirSync(PROFILES, {recursive: true});
const env = Object.fromEntries(readFileSync(process.env.HOMI_TEST_CREDENTIALS, 'utf8').trim().split('\n').map(s => {const i = s.indexOf('='); return [s.slice(0, i), s.slice(i + 1).replace(/^"|"$/g, '')];}));
const base = process.env.HOMI_TEST_URL ?? 'http://localhost:3400';
if (new URL(base).hostname !== 'localhost') throw new Error('Acceptance requires the isolated localhost test stack');
const run = Date.now().toString().slice(-6);
const errors = [], results = [];
const pass = (name, detail = {}) => {results.push({name, ...detail}); console.log('PASS', name, JSON.stringify(detail));};
const sleep = ms => new Promise(r => setTimeout(r, ms));

const ctx = await chromium.launchPersistentContext(`${PROFILES}/notepad-${run}`, {
  headless: true, executablePath: process.env.HOMI_TEST_CHROME, viewport: {width: 1440, height: 900},
});
const p = ctx.pages()[0] ?? await ctx.newPage();
p.on('pageerror', e => errors.push(e.message));
const card = () => p.locator('[data-family-board-card="shopping:shopping-list"]');
const pad = () => card().locator('.shopping-pad');
let household = null, client = null;
const api = (path, method = 'GET', body = null) => p.evaluate(async ({path, method, body, household, client}) => {
  const r = await fetch('/api/v1/' + path, {method, credentials: 'same-origin',
    headers: {'Content-Type': 'application/json', 'X-Homi-Household-ID': household, 'X-Homi-Client-ID': client},
    ...(body ? {body: JSON.stringify(body)} : {})});
  return {status: r.status, body: await r.json().catch(() => null)};
}, {path, method, body, household, client});
async function dashboard() {
  await p.goto(base);
  await card().locator('.shopping-pad-open').waitFor({timeout: 30000});
  await sleep(1200);
}
async function add(name, store = 'Corner Market') {
  const r = await api('core/sync/mutations', 'POST', {clientMutationId: crypto.randomUUID(), moduleKey: 'shopping', entityType: 'item',
    entityId: crypto.randomUUID(), operation: 'create', baseRevision: '0',
    payload: {name, quantity: '1', store, aisle: '', assignedTo: null, checked: false}});
  assert.equal(r.body?.data?.status, 'applied', name + ': ' + JSON.stringify(r.body));
}
// Starts from an empty pad: anything already on the list is ticked off.
async function tickEverything() {
  for (const item of (await api('modules/shopping/items')).body.data.filter(i => !i.checked)) {
    const r = await api('core/sync/mutations', 'POST', {clientMutationId: crypto.randomUUID(), moduleKey: 'shopping', entityType: 'item',
      entityId: item.id, operation: 'update', baseRevision: item.revision,
      payload: {name: item.name, quantity: item.quantity, store: item.store, aisle: item.aisle, assignedTo: item.assignedTo, checked: true}});
    assert.equal(r.body?.data?.status, 'applied', item.name + ': ' + JSON.stringify(r.body));
  }
}
async function setStyle(style) {
  const pref = (await api('core/module-preferences')).body.data.preferences.find(x => x.moduleKey === 'shopping' && x.surfaceId === 'shopping-list');
  const r = await api('core/sync/mutations', 'POST', {clientMutationId: crypto.randomUUID(), moduleKey: 'core', entityType: 'member-module-preference',
    entityId: pref.id, operation: 'update', baseRevision: pref.revision, payload: {cardStyle: style}});
  assert.equal(r.body?.data?.status, 'applied', JSON.stringify(r.body));
}
// Where the parts of the notepad are drawn, in page pixels.
const layout = () => card().evaluate(el => {
  const box = n => {const r = n.getBoundingClientRect(); return {x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom};};
  const sheet = el.querySelector('.shopping-pad-sheet'), lines = el.querySelector('.shopping-pad-lines');
  const gutter = Number.parseFloat(getComputedStyle(el.querySelector('.shopping-pad')).getPropertyValue('--pad-gutter'));
  const pitch = Number.parseFloat(getComputedStyle(el.querySelector('.shopping-pad')).getPropertyValue('--pad-pitch'));
  return {
    card: box(el), pad: box(el.querySelector('.shopping-pad')),
    spiral: box(el.querySelector('.shopping-pad-spiral')), paper: box(el.querySelector('.shopping-pad-paper')),
    title: {...box(el.querySelector('.homi-family-card__header h2')), text: el.querySelector('.homi-family-card__header h2').textContent},
    sheet: box(sheet), lines: box(lines), gutter, pitch,
    scroll: {height: lines.scrollHeight, client: lines.clientHeight},
    ruling: getComputedStyle(lines).backgroundImage,
    footer: box(el.querySelector('.shopping-pad-footer')),
    rows: [...el.querySelectorAll('.shopping-pad-row')].map(row => ({
      ...box(row), box: box(row.querySelector('input')), text: box(row.querySelector('.homi-ui-check span')),
      name: row.textContent.trim(),
    })),
    counts: [...el.querySelectorAll('.shopping-count')].map(row => row.textContent.trim()),
    open: el.querySelector('.shopping-pad-open')?.textContent ?? null,
  };
});

try {
  await p.goto(base);
  await p.getByLabel('Email', {exact: true}).fill(env.HOMI_BOOTSTRAP_EMAIL);
  await p.getByLabel('Password', {exact: true}).fill(env.HOMI_OWNER_PASSWORD ?? env.HOMI_BOOTSTRAP_PASSWORD);
  await p.getByRole('button', {name: 'Sign in', exact: true}).click();
  await p.getByRole('button', {name: 'Settings', exact: true}).first().waitFor({timeout: 30000});
  const id = await p.evaluate(async () => {
    const db = await new Promise((res, rej) => {const r = indexedDB.open('homi-client'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);});
    const rows = await new Promise((res, rej) => {const r = db.transaction('meta').objectStore('meta').getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);});
    return JSON.parse(rows.find(x => x.key === 'activeOfflineContext').value);
  });
  household = id.householdId; client = id.clientId;
  await setStyle('items');
  await tickEverything();
  const first = 'Rolled oats ' + run;
  await add(first);
  await add('Corn starch ' + run);
  await add('Dish soap ' + run);
  await dashboard();

  const a = await layout();
  // The pad is drawn inside the module's own surface, under Homi's title.
  assert.equal(a.title.text, 'Shopping List', 'Homi shows the card title');
  assert.ok(a.spiral.y >= a.title.bottom - 1, 'the pad sits under the card title');
  assert.ok(a.spiral.y <= a.paper.y && a.spiral.bottom > a.paper.y, 'the coils run over the top edge of the paper');
  assert.ok(a.spiral.w > a.paper.w * 0.9, 'the coils run the width of the pad');
  assert.ok(a.card.bottom - a.paper.bottom < 40, 'the pad fills the card to its foot');
  pass('the card holds a notepad: coils over the top edge of the paper, filling the card under its title', {
    titleBottom: Math.round(a.title.bottom - a.card.y), coilsTop: Math.round(a.spiral.y - a.card.y), paperTop: Math.round(a.paper.y - a.card.y)});

  const margin = a.sheet.x + a.gutter;
  for (const row of a.rows) {
    assert.ok(row.box.right <= margin - 2, `${row.name}: the box to tick sits in the margin`);
    assert.ok(row.text.x >= margin + 2, `${row.name}: the item is written right of the margin line`);
    assert.ok(Math.abs(row.h - a.pitch) <= 1, `${row.name}: each item takes one ruled line`);
    assert.ok(Math.abs(((row.y - a.lines.y - 2) % a.pitch + a.pitch) % a.pitch) <= 1, `${row.name}: each item sits between two rules`);
  }
  assert.ok(a.rows.some(r => r.name === first), 'the new item is on the pad');
  // The rules are drawn over the whole writing area, down to the foot of the
  // page, and move with the items, so they carry on below the last one.
  assert.match(a.ruling, /repeating-linear-gradient/, 'the writing area is ruled');
  assert.ok(Math.abs(a.lines.bottom - a.footer.y) <= 1, 'the ruled area reaches the foot of the page');
  pass('items are written on the ruled lines with the box to tick in the margin', {rows: a.rows.length, pitch: a.pitch, margin: Math.round(margin - a.card.x)});

  await card().getByRole('checkbox', {name: first, exact: true}).click();
  await card().getByRole('checkbox', {name: first, exact: true}).waitFor({state: 'detached', timeout: 15000});
  assert.equal(new URL(p.url()).pathname, '/', 'ticking an item stays on the Dashboard');
  // The tick shows at once and is synchronized a moment later.
  let ticked = null;
  for (let attempt = 0; attempt < 30 && !ticked?.checked; attempt++) {
    ticked = (await api('modules/shopping/items')).body.data.find(i => i.name === first);
    if (!ticked?.checked) await sleep(500);
  }
  assert.equal(ticked?.checked, true, 'the tick reaches the shared list');
  pass('ticking an item on the pad checks it off and leaves the Dashboard where it is');

  // A long list shows nine items and says how many more are on the full list,
  // as Shopping 0.3.2 did, so Open list stays in view.
  for (let i = 1; i <= 12; i++) await add(`Long list ${String(i).padStart(2, '0')} ${run}`);
  await dashboard();
  const long = await layout();
  const total = (await api('modules/shopping/items')).body.data.filter(i => !i.checked).length;
  assert.equal(long.rows.length, 9, 'nine items on the pad');
  assert.equal(long.open, `+ ${total - 9} more · Open list`, 'the footer says how many more there are');
  pass('a long list shows nine items and how many more are on the list', {items: total});

  // The title and coils belong to the card: tapping the title opens the list.
  await card().locator('.homi-family-card__header h2').click();
  await p.getByRole('heading', {name: 'Shopping List', exact: true, level: 1}).waitFor({timeout: 15000});
  pass('tapping the title opens the Shopping List page');
  await dashboard();
  await card().locator('.shopping-pad-open').click();
  await p.getByRole('heading', {name: 'Shopping List', exact: true, level: 1}).waitFor({timeout: 15000});
  pass('Open list opens the Shopping List page');

  await setStyle('store-counts');
  await add('Hammer ' + run, 'Hardware Store');
  await dashboard();
  const counts = await layout();
  assert.ok(counts.counts[0].startsWith('All stores'), 'the counts start with every store');
  assert.ok(counts.counts.some(c => c.startsWith('Hardware Store')), 'each store has its own line');
  pass('the counts by store style is written on the same notepad', {lines: counts.counts});
  await setStyle('items');

  for (const width of [390, 768, 1440]) {
    await p.setViewportSize({width, height: 900});
    await dashboard();
    const at = await layout();
    assert.ok(at.paper.right <= at.card.right + 1 && at.paper.x >= at.card.x - 1, `${width}px: the paper fits its card`);
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width}px: no sideways scrolling`);
    await card().screenshot({path: `${OUT}/notepad-card-${width}.png`});
  }
  pass('the notepad fits its card on phone, tablet and desktop widths');

  assert.deepEqual(errors, [], 'page errors');
  pass('no JavaScript page errors');
  writeFileSync(OUT + '/notepad-acceptance.json', JSON.stringify({date: new Date().toISOString(), run, results}, null, 2) + '\n');
  console.log('SHOPPING_NOTEPAD_ACCEPTANCE_OK checks=' + results.length);
} catch (failure) {
  try {await p.screenshot({path: OUT + '/notepad-failure.png'});} catch { /* ignore */ }
  throw failure;
} finally {
  await ctx.close();
}
