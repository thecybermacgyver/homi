// Isolated browser acceptance for Meal Planner. Run only against a localhost
// stack whose owner is a fixture account (HOMI_TEST_CREDENTIALS) with a second
// fixture member (qa/seed-member.mjs), Meal Planner installed and the test-only
// recipes fixture (qa/recipes-fixture) installed but not yet enabled. All data is invented.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
const OUT = process.env.HOMI_QA_OUT ?? new URL('./', import.meta.url).pathname;
const PROFILES = process.env.HOMI_TEST_PROFILES ?? '/tmp/homi-mealplanner-profiles';
mkdirSync(PROFILES, {recursive: true});
const env = Object.fromEntries(readFileSync(process.env.HOMI_TEST_CREDENTIALS, 'utf8').trim().split('\n').map(s => {const i = s.indexOf('='); return [s.slice(0, i), s.slice(i + 1)];}));
const base = process.env.HOMI_TEST_URL ?? 'http://localhost:3400';
if (new URL(base).hostname !== 'localhost') throw new Error('Acceptance requires the isolated localhost test stack');
const run = Date.now().toString().slice(-6);
const SECOND = 'mealplanner-second@example.invalid';
const TZ = 'America/Toronto';
const contexts = [], errors = [], results = [];
const pass = (name, detail = {}) => {results.push({name, ...detail}); console.log('PASS', name, JSON.stringify(detail));};
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function poll(fn, message, tries = 45) {let last; for (let i = 0; i < tries; i++) {try {last = await fn(); if (last) return last;} catch (e) {last = e.message;} await sleep(1000);} throw new Error(message + ': ' + JSON.stringify(last));}

// Dates, as plain strings in the household time zone.
const todayStr = () => {const p = new Intl.DateTimeFormat('en-CA', {timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(new Date()); const g = t => p.find(x => x.type === t).value; return `${g('year')}-${g('month')}-${g('day')}`;};
const addDays = (d, n) => {const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10);};
const dow = d => new Date(d + 'T00:00:00Z').getUTCDay();
const mondayOf = d => addDays(d, -((dow(d) + 6) % 7));
const MON = mondayOf(todayStr()), TUE = addDays(MON, 1), WED = addDays(MON, 2), SAT = addDays(MON, 5);
const NEXT_TUE = addDays(TUE, 7);

async function launch(label, offline = false, width = 390) {
  const dir = `${PROFILES}/${label}-${run}`;
  const ctx = await chromium.launchPersistentContext(dir, {headless: true, executablePath: process.env.HOMI_TEST_CHROME, viewport: {width, height: 900}, offline, timezoneId: TZ});
  contexts.push(ctx);
  const p = ctx.pages()[0] ?? await ctx.newPage();
  p.on('pageerror', e => errors.push(label + ': ' + e.message));
  return {label, dir, ctx, p};
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
  const ctx = await chromium.launchPersistentContext(d.dir, {headless: true, executablePath: process.env.HOMI_TEST_CHROME, viewport: {width: 390, height: 900}, offline, timezoneId: TZ});
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
const meals = async d => (await api(d, 'modules/mealplanner/meals?from=' + addDays(MON, -14))).body.data;
const mealByTitle = async (d, title) => (await meals(d)).find(m => m.title === title);
const ideas = async d => (await api(d, 'modules/mealplanner/ideas')).body.data;
const settings = async d => (await api(d, 'modules/mealplanner/settings')).body.data;
const row = (d, label) => d.p.locator('.mp-row').filter({has: d.p.locator('.mp-row-day', {hasText: new RegExp('^' + label + '$')})});
const cardText = async (d, label) => (await row(d, label).locator('.mp-row-meal').innerText()).trim().toLowerCase();
const home = async d => {await d.p.getByRole('button', {name: 'Dashboard', exact: true}).first().click(); await d.p.locator('.mp-row').first().waitFor({timeout: 30000});};
const openPlanner = async d => {await d.p.getByRole('button', {name: 'Open planner', exact: true}).click(); await d.p.getByRole('heading', {name: 'Meal Planner', exact: true}).waitFor();};
async function goTo(d, date) {
  // The planner opens on this week; step week by week to reach a date.
  const target = mondayOf(date);
  for (let i = 0; i < 12; i++) {
    const label = await d.p.locator('.mp-range').innerText();
    const wanted = new Intl.DateTimeFormat('en-CA', {timeZone: 'UTC', month: 'short', day: 'numeric'}).format(new Date(target + 'T00:00:00Z'));
    if (label.replace(/\./g, '').startsWith(wanted.replace(/\./g, ''))) return;
    const current = mondayOf(todayStr());
    await d.p.getByRole('button', {name: target > current ? 'Next week' : 'Previous week', exact: true}).click();
    await sleep(150);
  }
}
async function fillMeal(d, {date, title, slot, repeat, kind, notes}) {
  if (date) await d.p.getByLabel('Date', {exact: true}).fill(date);
  if (slot) await d.p.locator('#mp-slot').selectOption(slot);
  if (kind) await d.p.locator('#mp-kind').selectOption(kind);
  if (title !== undefined) await d.p.getByLabel(/^(What's for the meal\?|Details \(optional\))$/).fill(title);
  if (notes) await d.p.getByLabel('Notes', {exact: true}).fill(notes);
  if (repeat) await d.p.locator('#mp-repeat').selectOption(String(repeat));
}
const saveMeal = d => d.p.getByRole('button', {name: 'Save meal', exact: true}).click();

try {
  const a = await launch('a'), b = await launch('b'), c = await launch('c');
  await login(a); await login(b); await login(c, SECOND);
  const mods = (await api(a, 'core/modules')).body.data.modules;
  const mp = mods.find(m => m.moduleKey === 'mealplanner');
  if (!mp.enabled) assert.equal((await api(a, 'core/modules/mealplanner', 'PATCH', {enabled: true, baseRevision: mp.revision})).status, 200);
  for (const d of [a, b, c]) {await d.p.reload(); await d.p.locator('.mp-row').first().waitFor({timeout: 30000});}
  // Start from an empty plan, so a re-run on the same stack behaves like the first.
  const rawMutation = (d, entityType, entityId, operation, baseRevision, payload) => api(d, 'core/sync/mutations', 'POST', {clientMutationId: crypto.randomUUID(), moduleKey: 'mealplanner', entityType, entityId, operation, baseRevision, payload});
  for (const m of await meals(a)) await rawMutation(a, 'meal', m.id, 'delete', m.revision, {});
  for (const i of await ideas(a)) await rawMutation(a, 'idea', i.id, 'delete', i.revision, {});
  const fx = (await api(a, 'core/modules')).body.data.modules.find(m => m.moduleKey === 'recipesfixture');
  if (fx.enabled) assert.equal((await api(a, 'core/modules/recipesfixture', 'PATCH', {enabled: false, baseRevision: fx.revision})).status, 200);
  const was = await settings(a);
  if (was) assert.equal((await rawMutation(a, 'settings', was.id, 'update', was.revision, {slots: ['dinner'], weekStart: 1, cardMode: 'week', cardDays: [1, 2, 3, 4, 5], cardUpcoming: 5, cardSlot: 'dinner', cardLabel: 'short',
    dayColors: {0: '#7a4f7a', 1: '#b9553f', 2: '#c9753a', 3: '#d9a441', 4: '#5b7357', 5: '#8a9a14', 6: '#3f7a8a'}})).body.data.status, 'applied');
  for (const d of [a, b, c]) {await d.p.reload(); await d.p.locator('.mp-row').first().waitFor({timeout: 30000});}
  const ia = await identity(a), ib = await identity(b), ic = await identity(c);
  assert.equal(ia.authSubject, ib.authSubject); assert.notEqual(ia.clientId, ib.clientId);
  assert.notEqual(ia.authSubject, ic.authSubject); assert.equal(ia.householdId, ic.householdId);
  pass('two devices of one member and a distinct member share the household');

  // 1. The card starts as Monday to Friday in the mock-up's colours.
  const labels = await a.p.locator('.mp-row-day').allInnerTexts();
  assert.deepEqual(labels, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
  const monColor = await a.p.locator('.mp-row-day').first().evaluate(el => getComputedStyle(el).backgroundColor);
  assert.equal(monColor, 'rgb(185, 85, 63)');
  pass('the card shows Monday to Friday, each in its own colour', {monColor});

  // 2. Plan a meal from the planner page; it shows on the card of every device.
  const t1 = 'Tacos ' + run;
  await openPlanner(a);
  await a.p.getByRole('button', {name: 'Plan a meal', exact: true}).click();
  await fillMeal(a, {date: TUE, title: t1, notes: 'Soft shells.'}); await saveMeal(a);
  const m1 = await poll(() => mealByTitle(a, t1), 'meal stored');
  assert.equal(m1.date, TUE); assert.equal(m1.slot, 'dinner'); assert.equal(m1.kind, 'meal');
  await home(a);
  await poll(async () => (await cardText(a, 'Tue')).includes(t1.toLowerCase()), 'card shows the meal');
  await poll(async () => (await cardText(b, 'Tue')).includes(t1.toLowerCase()), 'second device card');
  await poll(async () => (await cardText(c, 'Tue')).includes(t1.toLowerCase()), 'second member card');
  pass('a planned meal reaches the Dashboard card on every device');

  // 3. Quick edit from the card by the other member.
  const t2 = 'Pasta ' + run;
  await row(c, 'Wed').click();
  await c.p.getByRole('button', {name: 'Add a meal', exact: true}).click();
  await fillMeal(c, {title: t2}); await saveMeal(c);
  const m2 = await poll(() => mealByTitle(a, t2), 'meal from the card');
  assert.equal(m2.date, WED);
  await poll(async () => (await cardText(a, 'Wed')).includes(t2.toLowerCase()), 'card on the owner device');
  pass('tapping a day on the card opens a quick editor and the meal is shared');

  // 4. Cooked, from the planner.
  await openPlanner(a);
  await a.p.getByRole('checkbox', {name: t1, exact: true}).click();
  await poll(async () => (await mealByTitle(a, t1)).status === 'cooked', 'cooked saved');
  pass('a meal can be marked cooked');

  // 5. Settings: other days, a new colour, long names, a breakfast slot. The card follows on every device.
  await a.p.locator('.mp-toolbar').getByRole('button', {name: 'Settings', exact: true}).click();
  await a.p.getByRole('button', {name: 'Monday', exact: true}).click();     // off
  await a.p.getByRole('button', {name: 'Saturday', exact: true}).click();   // on
  await a.p.getByLabel('Tuesday colour', {exact: true}).fill('#112233');
  await a.p.getByLabel(/^Day names/).selectOption('long');
  await a.p.getByLabel('Breakfast', {exact: true}).click();
  await a.p.getByRole('button', {name: 'Save settings', exact: true}).click();
  const st = await poll(async () => {const s = await settings(a); return s && s.cardDays.includes(6) ? s : null;}, 'settings stored');
  assert.deepEqual(st.cardDays, [2, 3, 4, 5, 6]); assert.equal(st.dayColors['2'], '#112233'); assert.deepEqual(st.slots, ['breakfast', 'dinner']);
  await home(a);
  await poll(async () => (await a.p.locator('.mp-row-day').allInnerTexts()).join() === 'Tuesday,Wednesday,Thursday,Friday,Saturday', 'card days changed on a');
  await poll(async () => (await b.p.locator('.mp-row-day').allInnerTexts()).join() === 'Tuesday,Wednesday,Thursday,Friday,Saturday', 'card days changed on b');
  await poll(async () => (await c.p.locator('.mp-row-day').allInnerTexts()).join() === 'Tuesday,Wednesday,Thursday,Friday,Saturday', 'card days changed on c');
  const tueColor = await c.p.locator('.mp-row-day').first().evaluate(el => getComputedStyle(el).backgroundColor);
  assert.equal(tueColor, 'rgb(17, 34, 51)');
  const tueInk = await c.p.locator('.mp-row-day').first().evaluate(el => getComputedStyle(el).color);
  assert.equal(tueInk, 'rgb(255, 253, 247)', 'light text on a dark colour');
  pass('the card follows the chosen days, colours and names on every device', {tueColor});

  // 6. Breakfast is planned but not on the dinner card.
  const tb = 'Oatmeal ' + run;
  await openPlanner(a);
  await a.p.getByRole('button', {name: 'Plan a meal', exact: true}).click();
  await fillMeal(a, {date: WED, slot: 'breakfast', title: tb}); await saveMeal(a);
  const mb = await poll(() => mealByTitle(a, tb), 'breakfast stored');
  assert.equal(mb.slot, 'breakfast');
  await home(a);
  assert.ok(!(await cardText(a, 'Wednesday')).includes(tb.toLowerCase()), 'breakfast is not on the dinner card');
  assert.ok((await cardText(a, 'Wednesday')).includes(t2.toLowerCase()));
  pass('extra meal slots are planned in the planner and the card shows only the chosen one');

  // 7. Repeat weekly, then delete this and later repeats.
  const tr = 'Taco Tuesday ' + run;
  await openPlanner(a);
  await goTo(a, NEXT_TUE);
  await a.p.getByRole('button', {name: 'Plan a meal', exact: true}).click();
  await fillMeal(a, {date: NEXT_TUE, title: tr, repeat: 4}); await saveMeal(a);
  const series = await poll(async () => {const list = (await meals(a)).filter(m => m.title === tr); return list.length === 4 ? list : null;}, 'four repeats');
  assert.equal(new Set(series.map(m => m.seriesId)).size, 1); assert.ok(series[0].seriesId);
  assert.deepEqual(series.map(m => m.date).sort(), [0, 7, 14, 21].map(n => addDays(NEXT_TUE, n)));
  await goTo(a, addDays(NEXT_TUE, 7));
  await a.p.getByRole('button', {name: 'Edit ' + tr, exact: true}).click();
  await a.p.getByRole('button', {name: 'Delete…', exact: true}).click();
  await a.p.getByRole('button', {name: 'Delete this and later repeats', exact: true}).click();
  await poll(async () => (await meals(a)).filter(m => m.title === tr).length === 1, 'later repeats deleted');
  pass('a meal can repeat weekly, and later repeats can be deleted together');

  // 8. Copy a meal to another day, and copy last week into next week.
  await a.p.getByRole('button', {name: 'Today', exact: true}).click();
  await a.p.getByRole('button', {name: 'Edit ' + t2, exact: true}).click();
  await a.p.getByLabel('Copy to another day', {exact: true}).fill(SAT);
  await a.p.getByRole('button', {name: 'Copy meal', exact: true}).click();
  await poll(async () => (await meals(a)).some(m => m.title === t2 && m.date === SAT), 'meal copied to Saturday');
  await goTo(a, addDays(MON, 7));
  await a.p.getByRole('button', {name: 'Copy last week', exact: true}).click();
  await a.p.getByRole('button', {name: 'Copy meals', exact: true}).click();
  await poll(async () => {const list = await meals(a); return list.some(m => m.title === t2 && m.date === addDays(WED, 7) && m.status === 'planned') && !list.some(m => m.title === t1 && m.date === NEXT_TUE);}, 'last week copied onto empty days only');
  pass('a meal can be copied to another day, and a whole week copied forward');

  // 9. Meal ideas: add, suggest, plan.
  await a.p.getByRole('tab', {name: 'Meal ideas', exact: true}).click();
  const idea = 'Chili ' + run;
  await a.p.getByRole('button', {name: 'Add an idea', exact: true}).click();
  await a.p.locator('#mp-idea-title').fill(idea);
  await a.p.locator('#mp-idea-tags').fill('quick, freezer');
  await a.p.getByRole('button', {name: 'Save idea', exact: true}).click();
  const saved = await poll(async () => (await ideas(a)).find(i => i.title === idea), 'idea stored');
  assert.deepEqual(saved.tags, ['quick', 'freezer']);
  await a.p.getByRole('button', {name: 'Suggest something', exact: true}).click();
  await a.p.getByRole('dialog', {name: 'How about…'}).waitFor();
  await a.p.getByRole('button', {name: 'Close', exact: true}).last().click();
  await a.p.getByRole('listitem').filter({hasText: idea}).getByRole('button', {name: 'Plan it'}).click();
  assert.equal(await a.p.getByLabel(/^What's for the meal\?/).inputValue(), idea);
  await a.p.getByLabel('Date', {exact: true}).fill(SAT); await saveMeal(a);
  await poll(async () => (await meals(a)).some(m => m.title === idea && m.date === SAT), 'idea planned');
  pass('meal ideas can be saved, suggested and planned in a tap');

  // 10. Recipes: hidden until a Recipes module is enabled, then searchable and linked.
  assert.equal((await api(a, 'modules/mealplanner/recipes/status')).body.data.available, false);
  await a.p.getByRole('tab', {name: 'Planner', exact: true}).click();
  await a.p.getByRole('button', {name: 'Plan a meal', exact: true}).click();
  assert.equal(await a.p.getByRole('button', {name: 'Choose a recipe'}).count(), 0, 'no recipe picker without a Recipes module');
  await a.p.getByRole('button', {name: 'Cancel', exact: true}).click();
  const fixture = (await api(a, 'core/modules')).body.data.modules.find(m => m.moduleKey === 'recipesfixture');
  assert.equal((await api(a, 'core/modules/recipesfixture', 'PATCH', {enabled: true, baseRevision: fixture.revision})).status, 200);
  await a.p.reload(); await a.p.locator('.mp-row').first().waitFor({timeout: 30000});
  await poll(async () => (await api(a, 'modules/mealplanner/recipes/status')).body.data.available, 'recipes available');
  await openPlanner(a);
  await a.p.getByRole('button', {name: 'Plan a meal', exact: true}).click();
  await a.p.getByRole('button', {name: 'Choose a recipe', exact: true}).click();
  await a.p.getByLabel('Search recipes', {exact: true}).fill('lentil');
  await a.p.getByRole('button', {name: /Lentil soup/}).click();
  assert.equal(await a.p.getByLabel(/^What's for the meal\?/).inputValue(), 'Lentil soup');
  assert.equal(await a.p.getByLabel('Servings', {exact: true}).inputValue(), '6');
  await a.p.getByLabel('Date', {exact: true}).fill(addDays(MON, 3)); await saveMeal(a);
  const withRecipe = await poll(() => mealByTitle(a, 'Lentil soup'), 'recipe meal stored');
  assert.deepEqual(withRecipe.recipe, {id: 'fixture-lentil', title: 'Lentil soup', servings: 6});
  const got = (await api(a, 'modules/mealplanner/recipes/fixture-lasagna')).body.data;
  assert.equal(got.title, 'Veggie lasagna');
  pass('with a Recipes module enabled a recipe can be searched and linked to a meal; without one the control is hidden', {recipe: withRecipe.recipe.id});

  // 11. Core Search and Add.
  await a.p.getByRole('button', {name: 'Search Homi', exact: true}).click();
  await a.p.getByRole('searchbox').fill(t1.toLowerCase());
  await a.p.getByRole('region', {name: 'Meals'}).getByRole('listitem').filter({hasText: t1}).first().click();
  await a.p.getByRole('dialog', {name: 'Edit meal'}).waitFor();
  await a.p.getByRole('button', {name: 'Cancel', exact: true}).click();
  await a.p.getByRole('button', {name: 'Add meal', exact: true}).click();
  const viaAdd = 'Added by plus ' + run;
  await fillMeal(a, {title: viaAdd}); await saveMeal(a);
  await poll(() => mealByTitle(a, viaAdd), 'meal added with Core Add');
  pass('Search finds meals and opens them; Add creates one');

  // 12. Offline: restart offline, plan, edit and cook offline across a restart, then reconnect.
  await a.p.evaluate(() => navigator.serviceWorker.ready);
  await home(a); await sleep(1500);
  await restart(a, true);
  await a.p.locator('.mp-row').first().waitFor({timeout: 30000});
  assert.ok((await cardText(a, 'Wednesday')).includes(t2.toLowerCase()), 'the card loads offline');
  const off = 'Written offline ' + run;
  await row(a, 'Friday').click();
  await a.p.getByRole('button', {name: 'Add a meal', exact: true}).click();
  await fillMeal(a, {title: off}); await saveMeal(a);
  await poll(async () => (await cardText(a, 'Friday')).includes(off.toLowerCase()), 'offline meal on the card', 10);
  await restart(a, true);
  await a.p.locator('.mp-row').first().waitFor({timeout: 30000});
  await poll(async () => (await cardText(a, 'Friday')).includes(off.toLowerCase()), 'offline meal survives a restart', 10);
  pass('after a full restart while offline the card loads and an offline meal survives another restart');
  await a.ctx.setOffline(false);
  await poll(async () => !(await idb(a, 'mutations')).some(m => m.moduleKey === 'mealplanner' && ['queued', 'sending'].includes(m.status)), 'queue drained');
  assert.deepEqual((await idb(a, 'mutations')).filter(m => m.moduleKey === 'mealplanner' && ['conflict', 'rejected'].includes(m.status)), []);
  await poll(() => mealByTitle(a, off), 'offline meal delivered');
  await poll(async () => (await cardText(c, 'Friday')).includes(off.toLowerCase()), 'offline meal reaches the other member');
  pass('reconnect delivers queued changes without conflicts and every device agrees');

  // 13. A stale offline edit is surfaced and the shared version stays.
  await openPlanner(a);
  await a.p.getByRole('button', {name: 'Edit ' + t2, exact: true}).first().click();
  await a.ctx.setOffline(true);
  await a.p.getByLabel(/^What's for the meal\?/).fill(t2 + ' (offline edit)'); await saveMeal(a);
  const live = (await meals(b)).find(m => m.title === t2 && m.date === WED);
  const result = (await api(b, 'core/sync/mutations', 'POST', {clientMutationId: crypto.randomUUID(), moduleKey: 'mealplanner', entityType: 'meal', entityId: live.id, operation: 'update', baseRevision: live.revision,
    payload: {date: live.date, slot: live.slot, kind: live.kind, title: t2 + ' (shared edit)', notes: live.notes, servings: live.servings, cookPersonId: live.cookPersonId, status: live.status, recipe: live.recipe, position: live.position, seriesId: live.seriesId}})).body.data;
  assert.equal(result.status, 'applied');
  await a.ctx.setOffline(false);
  await a.p.getByText('Someone changed this before your change arrived.').waitFor({timeout: 45000});
  assert.equal((await meals(a)).find(m => m.id === live.id).title, t2 + ' (shared edit)');
  await a.p.getByRole('button', {name: 'Keep shared version', exact: true}).click();
  pass('a stale offline edit is surfaced for review and the shared version stays on screen');

  // 14. Layout at three widths, no horizontal overflow.
  for (const width of [390, 768, 1440]) {
    await a.p.setViewportSize({width, height: 900});
    await home(a);
    await a.p.evaluate(() => scrollTo(0, 0));
    assert.equal(await a.p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'dashboard overflow at ' + width);
    await a.p.screenshot({path: OUT + `mealplanner-card-${width}.png`});
    await openPlanner(a);
    assert.equal(await a.p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'planner overflow at ' + width);
    await a.p.screenshot({path: OUT + `mealplanner-page-${width}.png`});
  }
  assert.deepEqual(errors, []);
  pass('no horizontal overflow at 390, 768 and 1440 px and no page errors');

  writeFileSync(OUT + 'browser-acceptance.json', JSON.stringify({date: new Date().toISOString(), run, results}, null, 2) + '\n');
  console.log('PASS_MEALPLANNER_ACCEPTANCE', results.length);
} catch (error) {
  console.error(error);
  for (const [i, ctx] of contexts.entries()) {
    try {const page = ctx.pages()[0]; if (page) {await page.screenshot({path: OUT + `failure-${i}.png`}); console.log('PAGE', i, (await page.locator('body').innerText()).slice(0, 1200));}} catch {}
  }
  process.exitCode = 1;
} finally {
  for (const ctx of contexts) await ctx.close().catch(() => {});
}
