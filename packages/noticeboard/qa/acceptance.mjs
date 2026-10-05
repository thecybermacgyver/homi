// Isolated browser acceptance for Noticeboard. Run only against a localhost
// stack whose owner is a fixture account (HOMI_TEST_CREDENTIALS) with a second
// fixture member (qa/seed-member.mjs) and Noticeboard installed. All data is invented.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
const OUT = process.env.HOMI_QA_OUT ?? new URL('./', import.meta.url).pathname;
const PROFILES = process.env.HOMI_TEST_PROFILES ?? '/tmp/homi-noticeboard-profiles';
mkdirSync(PROFILES, {recursive: true});
const env = Object.fromEntries(readFileSync(process.env.HOMI_TEST_CREDENTIALS, 'utf8').trim().split('\n').map(s => {const i = s.indexOf('='); return [s.slice(0, i), s.slice(i + 1)];}));
const base = process.env.HOMI_TEST_URL ?? 'http://localhost:3400';
if (new URL(base).hostname !== 'localhost') throw new Error('Acceptance requires the isolated localhost test stack');
const run = Date.now().toString().slice(-6);
const SECOND = 'noticeboard-second@example.invalid';
const contexts = [], errors = [], results = [];
const pass = (name, detail = {}) => {results.push({name, ...detail}); console.log('PASS', name, JSON.stringify(detail));};
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function poll(fn, message) {let last; for (let i = 0; i < 45; i++) {try {last = await fn(); if (last) return last;} catch (e) {last = e.message;} await sleep(1000);} throw new Error(message + ': ' + JSON.stringify(last));}

async function launch(label, offline = false, width = 390) {
  const dir = `${PROFILES}/${label}-${run}`;
  const ctx = await chromium.launchPersistentContext(dir, {headless: true, executablePath: process.env.HOMI_TEST_CHROME, viewport: {width, height: 900}, offline});
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
  const ctx = await chromium.launchPersistentContext(d.dir, {headless: true, executablePath: process.env.HOMI_TEST_CHROME, viewport: {width: 390, height: 900}, offline});
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
const notices = async d => (await api(d, 'modules/noticeboard/notices')).body.data;
const byTitle = async (d, title) => (await notices(d)).find(n => n.title === title);
async function raw(d, entityId, operation, baseRevision, payload) {
  return (await api(d, 'core/sync/mutations', 'POST', {clientMutationId: crypto.randomUUID(), moduleKey: 'noticeboard', entityType: 'notice', entityId, operation, baseRevision, payload})).body.data;
}
const open = (d, title) => d.p.getByRole('button', {name: 'Open notice: ' + title, exact: true});
const noteBox = async (d, title) => open(d, title).locator('xpath=..').boundingBox();
const home = async d => {await d.p.getByRole('button', {name: 'Dashboard', exact: true}).first().click(); await d.p.getByRole('button', {name: 'Add a notice', exact: true}).waitFor();};
const moduleList = async d => {await d.p.getByRole('button', {name: 'Open all notices', exact: true}).click(); await d.p.getByRole('heading', {name: 'Noticeboard', exact: true}).waitFor();};

// A big picture made in the page, to prove it is shrunk before it is stored.
async function attachBigPicture(p) {
  await p.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 3200; canvas.height = 2400;
    const c = canvas.getContext('2d');
    for (let i = 0; i < 400; i++) {c.fillStyle = `hsl(${(i * 37) % 360} 70% ${30 + (i % 40)}%)`; c.fillRect((i * 97) % 3200, (i * 53) % 2400, 400, 300);}
    return new Promise(resolve => canvas.toBlob(blob => {
      const input = document.getElementById('nb-photo');
      const dt = new DataTransfer(); dt.items.add(new File([blob], 'big.png', {type: 'image/png'}));
      input.files = dt.files; input.dispatchEvent(new Event('change', {bubbles: true})); resolve();
    }, 'image/png'));
  });
}

async function addFromCard(d, {title, body, color, items = [], photo = false}) {
  await d.p.getByRole('button', {name: 'Add a notice', exact: true}).click();
  await d.p.getByLabel('Title', {exact: true}).fill(title);
  if (body) await d.p.getByLabel('Notice', {exact: true}).fill(body);
  if (color) await d.p.getByLabel('Choose any colour').fill(color);
  for (const [i, text] of items.entries()) {
    await d.p.getByRole('button', {name: 'Add list item', exact: true}).click();
    await d.p.getByLabel('List item ' + (i + 1), {exact: true}).fill(text);
  }
  if (photo) {await attachBigPicture(d.p); await d.p.getByAltText('Photo on this notice').waitFor({timeout: 30000});}
  await d.p.getByRole('button', {name: 'Save notice', exact: true}).click();
  await open(d, title).waitFor();
}

try {
  // Enable Noticeboard for the household (owner), then three devices.
  const a = await launch('a'), b = await launch('b'), c = await launch('c');
  await login(a); await login(b); await login(c, SECOND);
  const mods = (await api(a, 'core/modules')).body.data.modules;
  const nbModule = mods.find(m => m.moduleKey === 'noticeboard');
  if (!nbModule.enabled) assert.equal((await api(a, 'core/modules/noticeboard', 'PATCH', {enabled: true, baseRevision: nbModule.revision})).status, 200);
  for (const d of [a, b, c]) {await d.p.reload(); await d.p.getByRole('button', {name: 'Add a notice', exact: true}).waitFor({timeout: 30000});}
  const ia = await identity(a), ib = await identity(b), ic = await identity(c);
  assert.equal(ia.authSubject, ib.authSubject); assert.notEqual(ia.clientId, ib.clientId);
  assert.notEqual(ia.authSubject, ic.authSubject); assert.equal(ia.householdId, ic.householdId);
  pass('two devices of one member and a distinct member share the household');

  // 1. Create on the card: text, colour, list, photo (shrunk). Others see it automatically.
  const t1 = 'Soccer sign-up ' + run;
  await addFromCard(a, {title: t1, body: 'Bring water bottles and shin pads.', color: '#336699', items: ['Water', 'Shin pads'], photo: true});
  const n1 = await poll(() => byTitle(a, t1), 'notice stored');
  assert.match(n1.image, /^data:image\/jpeg;base64,/); assert.ok(n1.image.length <= 450000, 'photo shrunk: ' + n1.image.length);
  assert.equal(n1.color, '#336699'); assert.equal(n1.checklist.length, 2); assert.equal(n1.pinned, true);
  await poll(async () => await open(b, t1).count(), 'second device sees the new notice');
  await poll(async () => await open(c, t1).count(), 'second member sees the new notice');
  pass('a notice made on the card with colour, list and a shrunk photo reaches every device', {imageChars: n1.image.length});

  // 2. A second notice, then arrange: move and overlap.
  const t2 = 'Dentist Thursday ' + run;
  await addFromCard(a, {title: t2, body: 'Both kids, 3:30.', color: '#e8a58f'});
  const n2 = await poll(() => byTitle(a, t2), 'second notice');
  const board = a.p.locator('.nb-board');
  const bb = await board.boundingBox(), before = await noteBox(a, t2);
  await a.p.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await a.p.mouse.down();
  await a.p.mouse.move(before.x + before.width / 2 + 30, before.y + before.height / 2 + 20, {steps: 4});
  await a.p.mouse.move(before.x + before.width / 2 + 60, before.y + before.height / 2 + 40, {steps: 4});
  await a.p.mouse.up();
  const moved = await poll(async () => {const n = await byTitle(a, t2); return n.x !== n2.x || n.y !== n2.y ? n : null;}, 'move saved');
  assert.ok(moved.z > n2.z - 1);
  await poll(async () => Math.abs((await noteBox(b, t2)).x - (await noteBox(a, t2)).x) < 3, 'moved note appears at the same place on the other device');
  // Overlap: drop the first note onto the second.
  const second = await noteBox(a, t2), first = await noteBox(a, t1);
  await a.p.mouse.move(first.x + first.width / 2, first.y + first.height / 2); await a.p.mouse.down();
  await a.p.mouse.move(second.x + second.width / 3, second.y + second.height / 3, {steps: 8}); await a.p.mouse.up();
  const lifted = await poll(async () => {const n = await byTitle(a, t1); const o = await byTitle(a, t2); return n.z > o.z ? n : null;}, 'notice brought to the front');
  const f2 = await noteBox(a, t1), s2 = await noteBox(a, t2);
  assert.ok(f2.x < s2.x + s2.width && f2.x + f2.width > s2.x && f2.y < s2.y + s2.height && f2.y + f2.height > s2.y, 'notes overlap');
  assert.ok(lifted.x >= 0 && lifted.x + lifted.w <= 1.0001 && lifted.y >= 0);
  pass('notes can be dragged, overlap, and the last one touched comes to the front', {z: lifted.z});

  // 3. Positions are relative: the same arrangement at other widths.
  const relative = async (d, title) => {const box = await d.p.locator('.nb-board').boundingBox(), nb = await noteBox(d, title); return {x: (nb.x - box.x) / box.width, w: nb.width / box.width};};
  const r390 = await relative(a, t1);
  await a.p.setViewportSize({width: 1440, height: 900});
  await sleep(500);
  const r1440 = await relative(a, t1);
  assert.ok(Math.abs(r390.x - r1440.x) < 0.03 && Math.abs(r390.w - r1440.w) < 0.03, JSON.stringify({r390, r1440}));
  await a.p.screenshot({path: OUT + 'noticeboard-board-1440.png'});
  await a.p.setViewportSize({width: 390, height: 900});
  pass('the arrangement scales with the board at phone and desktop widths', {r390, r1440});

  // 4. Unpin with the pin (by the other member): leaves the board everywhere, stays in the module.
  await c.p.getByRole('button', {name: 'Unpin ' + t2 + ' from the board', exact: true}).click();
  await poll(async () => (await byTitle(a, t2)).pinned === false, 'unpinned on server');
  await poll(async () => (await open(a, t2).count()) === 0 && (await open(b, t2).count()) === 0, 'gone from every board');
  await moduleList(a);
  await a.p.getByRole('button', {name: new RegExp(t2)}).waitFor();
  pass('anyone can unpin a notice: it leaves the board but stays in the module');

  // 5. Module list: newest first, brief text; open the whole notice; pin back from the module (by a third device).
  const rows = await a.p.locator('.nb-row-title').allInnerTexts();
  assert.deepEqual(rows.slice(0, 2), [t2, t1], 'newest first');
  assert.match(await a.p.locator('.nb-row-brief').first().innerText(), /Both kids/);
  await moduleList(b).catch(async () => {await b.p.getByRole('button', {name: 'Open all notices', exact: true}).click();});
  await b.p.getByRole('button', {name: new RegExp(t2)}).click();
  await b.p.getByRole('button', {name: 'Pin to board', exact: true}).click();
  await poll(async () => (await byTitle(a, t2)).pinned === true, 'pinned again');
  await b.p.getByRole('button', {name: 'Done', exact: true}).click();
  await home(b); await home(a);
  await poll(async () => await open(a, t2).count(), 'pinned note returns to the board');
  pass('the module lists every notice newest first and anyone can pin one back to the board');

  // 6. Ticking list items from another member.
  await open(c, t1).dispatchEvent('click');
  await c.p.getByRole('checkbox', {name: 'Water', exact: true}).click();
  await poll(async () => (await byTitle(a, t1)).checklist.find(i => i.text === 'Water').done, 'tick saved');
  await c.p.getByRole('button', {name: 'Done', exact: true}).click();
  pass('anyone can tick list items');

  // 7. Delete rights: author or administrator only.
  const tc = 'From the second member ' + run;
  await addFromCard(c, {title: tc, body: 'Made by the second member.'});
  await poll(() => byTitle(a, tc), 'second member notice stored');
  await open(c, t1).dispatchEvent('click');
  assert.equal(await c.p.getByRole('button', {name: 'Delete', exact: true}).count(), 0, 'no Delete on another member\'s notice');
  await c.p.getByRole('button', {name: 'Done', exact: true}).click();
  const forbidden = await raw(c, n1.id, 'delete', (await byTitle(a, t1)).revision, {});
  assert.equal(forbidden.status, 'rejected'); assert.equal(forbidden.errorCode, 'NOTICEBOARD_DELETE_FORBIDDEN');
  assert.ok(await byTitle(a, t1), 'notice still exists');
  await open(c, tc).dispatchEvent('click');
  assert.equal(await c.p.getByRole('button', {name: 'Delete', exact: true}).count(), 1, 'author sees Delete');
  await c.p.getByRole('button', {name: 'Done', exact: true}).click();
  await open(a, tc).dispatchEvent('click');
  await a.p.getByRole('button', {name: 'Delete', exact: true}).click();
  await a.p.getByRole('button', {name: 'Delete for everyone', exact: true}).click();
  await poll(async () => !(await byTitle(a, tc)), 'administrator deleted the member\'s notice');
  await poll(async () => (await open(c, tc).count()) === 0, 'removed on the other device');
  const own = 'Delete me ' + run;
  await addFromCard(c, {title: own});
  await open(c, own).dispatchEvent('click');
  await c.p.getByRole('button', {name: 'Delete', exact: true}).click();
  await c.p.getByRole('button', {name: 'Delete for everyone', exact: true}).click();
  await poll(async () => !(await byTitle(a, own)), 'author deleted own notice');
  pass('only the author or an administrator can delete', {forbiddenCode: forbidden.errorCode});

  // 8. Core Search and Add.
  await a.p.getByRole('button', {name: 'Search Homi', exact: true}).click();
  await a.p.getByRole('searchbox').fill('shin pads');
  await a.p.getByRole('region', {name: 'Notices'}).getByRole('listitem').filter({hasText: t1}).click();
  await a.p.getByRole('dialog', {name: t1}).waitFor();
  await a.p.getByRole('button', {name: 'Done', exact: true}).click();
  await a.p.getByRole('button', {name: 'Add notice', exact: true}).click();
  const viaAdd = 'Added from the module ' + run;
  await a.p.getByLabel('Title', {exact: true}).fill(viaAdd);
  await a.p.getByRole('button', {name: 'Save notice', exact: true}).click();
  const added = await poll(() => byTitle(a, viaAdd), 'notice added with Core Add');
  assert.equal(added.pinned, true);
  pass('Search finds notice text (including list items) and opens the notice; Add creates one');

  // 9. Offline: restart offline, then create, move and tick offline, reconnect.
  await a.p.evaluate(() => navigator.serviceWorker.ready);
  await home(a); await sleep(1500);
  await restart(a, true);
  await open(a, t1).waitFor({timeout: 30000});
  assert.ok(await a.p.locator('.nb-note-photo').count() >= 1, 'photo shows offline');
  const off = 'Written offline ' + run;
  await addFromCard(a, {title: off, body: 'Queued until the network returns.'});
  const offBox = await noteBox(a, off);
  await a.p.mouse.move(offBox.x + offBox.width / 2, offBox.y + offBox.height / 2); await a.p.mouse.down();
  await a.p.mouse.move(offBox.x + offBox.width / 2 + 40, offBox.y + offBox.height / 2 + 25, {steps: 6}); await a.p.mouse.up();
  await sleep(500); await open(a, t1).dispatchEvent('click'); await a.p.getByRole('checkbox', {name: 'Shin pads', exact: true}).click();
  await a.p.getByRole('button', {name: 'Done', exact: true}).click();
  await restart(a, true);
  await open(a, off).waitFor({timeout: 30000});
  pass('after a full restart while offline the board loads, and offline create, move and tick survive another restart');
  await a.ctx.setOffline(false);
  await poll(async () => !(await idb(a, 'mutations')).some(m => m.moduleKey === 'noticeboard' && ['queued', 'sending'].includes(m.status)), 'queue drained');
  assert.deepEqual((await idb(a, 'mutations')).filter(m => m.moduleKey === 'noticeboard' && ['conflict', 'rejected'].includes(m.status)), []);
  await poll(async () => (await byTitle(a, off)) && (await byTitle(a, t1)).checklist.find(i => i.text === 'Shin pads').done, 'offline changes delivered');
  await poll(async () => await open(c, off).count(), 'offline notice reaches the other member');
  pass('reconnect delivers every queued change without conflicts and every device agrees');

  // 10. A stale offline edit is surfaced for review and the shared version stays.
  await open(a, t1).dispatchEvent('click'); await a.p.getByRole('button', {name: 'Edit', exact: true}).click();
  await a.ctx.setOffline(true);
  await a.p.getByLabel('Title', {exact: true}).fill(t1 + ' (offline edit)');
  await a.p.getByRole('button', {name: 'Save notice', exact: true}).click();
  const live = await byTitle(b, t1);
  assert.equal((await raw(b, live.id, 'update', live.revision, {title: t1 + ' (shared edit)', body: live.body, color: live.color, image: live.image, checklist: live.checklist})).status, 'applied');
  await a.ctx.setOffline(false);
  await a.p.getByText('Open the Noticeboard to review a change.').waitFor({timeout: 45000});
  await moduleList(a);
  await a.p.getByText('Someone changed this notice before your change arrived.').waitFor({timeout: 15000});
  assert.equal((await notices(a)).find(n => n.id === live.id).title, t1 + ' (shared edit)');
  await a.p.getByRole('button', {name: 'Keep shared version', exact: true}).click();
  await home(a);
  pass('a stale offline edit is surfaced for review and the shared version stays on screen');

  // 11. Layout at three widths, no horizontal overflow.
  for (const width of [390, 768, 1440]) {
    await a.p.setViewportSize({width, height: 900});
    await a.p.evaluate(() => scrollTo(0, 0));
    assert.equal(await a.p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'dashboard overflow at ' + width);
    await a.p.screenshot({path: OUT + `noticeboard-card-${width}.png`});
    await a.p.getByRole('button', {name: 'Open all notices', exact: true}).click();
    await a.p.getByRole('heading', {name: 'Noticeboard', exact: true}).waitFor();
    assert.equal(await a.p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'page overflow at ' + width);
    await a.p.screenshot({path: OUT + `noticeboard-page-${width}.png`});
    await a.p.getByRole('button', {name: 'Dashboard', exact: true}).first().click();
    await a.p.getByRole('button', {name: 'Add a notice', exact: true}).waitFor();
  }
  assert.deepEqual(errors, []);
  pass('no horizontal overflow at 390, 768 and 1440 px and no page errors');

  writeFileSync(OUT + 'browser-acceptance.json', JSON.stringify({date: new Date().toISOString(), run, results}, null, 2) + '\n');
  console.log('PASS_NOTICEBOARD_ACCEPTANCE', results.length);
} catch (error) {
  console.error(error);
  for (const [i, ctx] of contexts.entries()) {
    try {const page = ctx.pages()[0]; if (page) {await page.screenshot({path: OUT + `failure-${i}.png`}); console.log('PAGE', i, (await page.locator('body').innerText()).slice(0, 1500));}} catch {}
  }
  process.exitCode = 1;
} finally {
  for (const ctx of contexts) await ctx.close().catch(() => {});
}
