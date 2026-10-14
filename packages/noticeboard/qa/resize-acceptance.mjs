// Isolated browser acceptance for sizing a notice. Run only against a
// localhost stack whose owner is a fixture account (HOMI_TEST_CREDENTIALS) with
// Noticeboard installed, enabled and set up. All data is invented.
//
//   HOMI_TEST_CREDENTIALS=... HOMI_TEST_PROFILES=<fresh dir> \
//     node packages/noticeboard/qa/resize-acceptance.mjs
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
const OUT = process.env.HOMI_QA_OUT ?? new URL('./', import.meta.url).pathname;
const PROFILES = process.env.HOMI_TEST_PROFILES ?? '/tmp/homi-noticeboard-resize-profiles';
mkdirSync(PROFILES, {recursive: true});
const env = Object.fromEntries(readFileSync(process.env.HOMI_TEST_CREDENTIALS, 'utf8').trim().split('\n').map(s => {const i = s.indexOf('='); return [s.slice(0, i), s.slice(i + 1).replace(/^"|"$/g, '')];}));
const password = env.HOMI_OWNER_PASSWORD ?? env.HOMI_BOOTSTRAP_PASSWORD;
const base = process.env.HOMI_TEST_URL ?? 'http://localhost:3400';
if (new URL(base).hostname !== 'localhost') throw new Error('Acceptance requires the isolated localhost test stack');
const run = Date.now().toString().slice(-6);
const errors = [], results = [];
const pass = (name, detail = {}) => {results.push({name, ...detail}); console.log('PASS', name, JSON.stringify(detail));};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const near = (actual, expected, tolerance, what) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${what}: expected ${expected.toFixed(3)} ± ${tolerance}, got ${actual.toFixed(3)}`);
const round = value => Number(value.toFixed(3));

const ctx = await chromium.launchPersistentContext(`${PROFILES}/resize-${run}`, {
  headless: true, executablePath: process.env.HOMI_TEST_CHROME, viewport: {width: 1440, height: 900},
});
const p = ctx.pages()[0] ?? await ctx.newPage();
p.on('pageerror', e => errors.push(e.message));

const note = title => p.getByRole('button', {name: 'Open notice: ' + title, exact: true}).locator('xpath=..');
const handle = title => p.getByRole('button', {name: 'Resize notice: ' + title, exact: true});
// Layout sizes, not rendered bounding boxes: a notice is tilted on the cork, so
// its bounding box is wider than the size it was actually given. The picture is
// drawn inside its box at its own shape, so its drawn size is worked out the
// way object-fit: contain does.
async function geometry(title) {
  return note(title).evaluate(el => {
    const board = el.closest('.nb-board');
    const paper = el.querySelector('.nb-note-open');
    const photo = el.querySelector('.nb-note-photo');
    const scale = photo ? Math.min(photo.clientWidth / photo.naturalWidth, photo.clientHeight / photo.naturalHeight) : 0;
    return {
      w: el.offsetWidth / board.clientWidth,
      h: el.offsetHeight / board.clientHeight,
      x: Number.parseFloat(el.style.left) / 100,
      y: Number.parseFloat(el.style.top) / 100,
      boardWidth: board.clientWidth,
      boardHeight: board.clientHeight,
      noteWidth: el.offsetWidth,
      noteHeight: el.offsetHeight,
      fontSize: Number.parseFloat(getComputedStyle(paper).fontSize),
      overflow: getComputedStyle(el).overflow,
      ...(photo ? {
        photoBoxWidth: photo.clientWidth,
        photoBoxHeight: photo.clientHeight,
        naturalWidth: photo.naturalWidth,
        naturalHeight: photo.naturalHeight,
        drawnWidth: photo.naturalWidth * scale,
        drawnHeight: photo.naturalHeight * scale,
      } : {}),
    };
  });
}
// Where the tack sits in relation to the paper it holds, and whether the tack
// is the thing the pointer would actually hit at its own centre.
async function tack(title) {
  return note(title).evaluate(el => {
    const pin = el.querySelector('.nb-pin');
    const paper = el.getBoundingClientRect(), head = pin.getBoundingClientRect();
    const hit = document.elementFromPoint(head.x + head.width / 2, head.y + head.height / 2);
    return {
      aboveTopEdge: paper.top - head.top,
      headHeight: head.height,
      hitsTack: hit === pin || pin.contains(hit),
    };
  });
}
// Drags the corner handle by a fraction of the board, right and down. The
// pointer stays inside the board, as a real drag does: leaving the window
// cancels the pointer and abandons the resize.
async function dragHandle(title, byX, byY = 0) {
  const board = await p.locator('.nb-board').boundingBox();
  const box = await handle(title).boundingBox();
  const fromX = box.x + box.width / 2, fromY = box.y + box.height / 2;
  const hold = (value, low, high) => Math.min(Math.max(value, low), high);
  const toX = hold(fromX + board.width * byX, board.x + 2, board.x + board.width - 2);
  const toY = hold(fromY + board.height * byY, board.y + 2, board.y + board.height - 2);
  await p.mouse.move(fromX, fromY);
  await p.mouse.down();
  for (const step of [0.3, 0.7, 1]) await p.mouse.move(fromX + (toX - fromX) * step, fromY + (toY - fromY) * step, {steps: 4});
  await p.mouse.up();
  await sleep(1200);
}
// Places the notice at a known spot and size, upright and in front of the other
// notices, through the ordinary placement mutation. The checks below then do
// not depend on where a new notice landed, how far it happens to be tilted, or
// which notice is pinned over which.
async function park(title, x = 0.04, y = 0.05, w = 0.46, h = 0.3) {
  let current = null;
  for (let attempt = 0; attempt < 30 && !current; attempt++) {
    current = await stored(title);
    if (!current) await sleep(1000);
  }
  assert.ok(current, 'the notice reached the server before it was placed');
  const all = await p.evaluate(async ({household, client}) => {
    const r = await fetch('/api/v1/modules/noticeboard/notices', {headers: {'X-Homi-Household-ID': household, 'X-Homi-Client-ID': client}});
    return (await r.json()).data;
  }, {household, client});
  const front = all.reduce((highest, n) => Math.max(highest, n.z), 0) + 1;
  const result = await p.evaluate(async ({notice, household, client, placement}) => {
    const r = await fetch('/api/v1/core/sync/mutations', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'X-Homi-Household-ID': household, 'X-Homi-Client-ID': client},
      body: JSON.stringify({clientMutationId: crypto.randomUUID(), moduleKey: 'noticeboard', entityType: 'notice',
        entityId: notice.id, operation: 'update', baseRevision: notice.revision, payload: placement}),
    });
    return {status: r.status, body: await r.json()};
  }, {notice: current, household, client, placement: {pinned: true, x, y, w, h, rotation: 0, z: front}});
  assert.equal(result.status, 200, 'placement mutation: ' + JSON.stringify(result.body));
  await p.reload();
  await note(title).waitFor({timeout: 30000});
  await sleep(1000);
}
let household = null, client = null;
async function login() {
  await p.goto(base);
  await p.getByLabel('Email', {exact: true}).fill(env.HOMI_BOOTSTRAP_EMAIL);
  await p.getByLabel('Password', {exact: true}).fill(password);
  await p.getByRole('button', {name: 'Sign in', exact: true}).click();
  await p.getByRole('button', {name: 'Settings', exact: true}).first().waitFor({timeout: 30000});
  const id = await p.evaluate(async () => {
    const db = await new Promise((res, rej) => {const r = indexedDB.open('homi-client'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);});
    const rows = await new Promise((res, rej) => {const r = db.transaction('meta').objectStore('meta').getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);});
    return JSON.parse(rows.find(x => x.key === 'activeOfflineContext').value);
  });
  household = id.householdId; client = id.clientId;
  await p.reload();
  await p.getByRole('button', {name: 'Add a notice', exact: true}).waitFor({timeout: 30000});
}
// A notice made in the page, with a picture of the given size or with a note.
async function addNotice(title, pictureWidth, pictureHeight, body = '') {
  await p.getByRole('button', {name: 'Add a notice', exact: true}).click();
  await p.getByLabel('Title', {exact: true}).fill(title);
  if (body) await p.getByLabel('Notice', {exact: true}).fill(body);
  if (pictureWidth) {
    await p.evaluate(async ([w, h]) => {
      const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
      const c = canvas.getContext('2d');
      for (let i = 0; i < 160; i++) {c.fillStyle = `hsl(${(i * 31) % 360} 65% ${35 + (i % 35)}%)`; c.fillRect((i * 71) % w, (i * 47) % h, Math.round(w / 5), Math.round(h / 6));}
      await new Promise(resolve => canvas.toBlob(blob => {
        const input = document.getElementById('nb-photo');
        const dt = new DataTransfer(); dt.items.add(new File([blob], 'picture.png', {type: 'image/png'}));
        input.files = dt.files; input.dispatchEvent(new Event('change', {bubbles: true})); resolve();
      }, 'image/png'));
    }, [pictureWidth, pictureHeight]);
    await p.getByAltText('Photo on this notice').waitFor({timeout: 30000});
  }
  await p.getByRole('button', {name: 'Save notice', exact: true}).click();
  await note(title).waitFor();
  await sleep(900);
}
const stored = title => p.evaluate(async ({title, household, client}) => {
  const r = await fetch('/api/v1/modules/noticeboard/notices', {headers: {'X-Homi-Household-ID': household, 'X-Homi-Client-ID': client}});
  return (await r.json()).data.find(n => n.title === title);
}, {title, household, client});

try {
  await login();
  const title = 'Beach day ' + run;
  await addNotice(title, 1600, 1000);
  await park(title, 0.04, 0.05, 0.46, 0.3);
  const start = await geometry(title);
  near(start.x, 0.04, 0.01, 'the notice sits where it was placed');
  near(start.w, 0.46, 0.01, 'the notice is the width it was given');
  near(start.h, 0.3, 0.015, 'the notice is the height it was given');
  // 1600x1000 is 0.625 high; the picture is drawn at its own shape, whole.
  near(start.drawnHeight / start.drawnWidth, 0.625, 0.02, 'the drawn picture keeps its own shape');
  assert.ok(start.drawnWidth <= start.photoBoxWidth + 1 && start.drawnHeight <= start.photoBoxHeight + 1,
    'the whole picture is inside the notice, not cropped');
  pass('a notice is the size it was given and shows its photo whole, at the photo\'s own shape', {
    width: round(start.w), height: round(start.h), pictureShape: round(start.drawnHeight / start.drawnWidth),
  });

  // The tack holds the paper down: it stands proud of the top edge and is the
  // thing the pointer hits, rather than being clipped to the paper.
  const head = await tack(title);
  assert.equal(start.overflow, 'visible', 'the paper does not clip what stands on it');
  assert.ok(head.aboveTopEdge > head.headHeight * 0.2,
    `the tack stands above the top edge of the paper: ${head.aboveTopEdge.toFixed(1)}px of ${head.headHeight.toFixed(1)}px`);
  assert.ok(head.hitsTack, 'the tack is the thing the pointer hits at its centre');
  pass('the tack stands on top of the notice and holds it to the cork', {
    standsProudPx: Math.round(head.aboveTopEdge), tackPx: Math.round(head.headHeight),
  });

  // Sideways only: the notice gets wider and the picture gets more room, but a
  // picture is never stretched out of shape or cropped to fill it, so a wide
  // short notice shows the whole picture with paper beside it.
  await dragHandle(title, 0.18);
  const wider = await geometry(title);
  near(wider.w, start.w + 0.18, 0.05, 'width after dragging the handle right');
  near(wider.h, start.h, 0.02, 'height is unchanged by a sideways drag');
  assert.ok(wider.photoBoxWidth > start.photoBoxWidth + 10, 'the picture got more room across the notice');
  near(wider.drawnHeight / wider.drawnWidth, start.drawnHeight / start.drawnWidth, 0.02, 'the picture keeps its shape');
  assert.ok(wider.drawnWidth <= wider.photoBoxWidth + 1 && wider.drawnHeight <= wider.photoBoxHeight + 1,
    'the picture is still whole, not cropped to the wider notice');
  near(wider.x, start.x, 0.01, 'the left edge stays put while resizing');
  pass('dragging the corner handle sideways makes the notice wider and keeps the photo whole', {
    from: round(start.w), to: round(wider.w),
    pictureRoomPixels: Math.round(start.photoBoxWidth) + ' -> ' + Math.round(wider.photoBoxWidth),
  });

  // The complaint this release answers: the handle must also stretch downward.
  await dragHandle(title, 0, 0.25);
  const taller = await geometry(title);
  near(taller.h, wider.h + 0.25, 0.06, 'height after dragging the handle down');
  near(taller.w, wider.w, 0.02, 'width is unchanged by a downward drag');
  near(taller.y, wider.y, 0.01, 'the top edge stays put while stretching downward');
  assert.ok(taller.drawnHeight > wider.drawnHeight + 10, 'the picture got taller with the notice');
  pass('dragging the corner handle downward makes the notice taller and the photo follows', {
    from: round(wider.h), to: round(taller.h),
    picturePixels: Math.round(wider.drawnHeight) + ' -> ' + Math.round(taller.drawnHeight),
  });

  const savedSize = await stored(title);
  near(savedSize.w, taller.w, 0.03, 'the stored width matches what the board shows');
  near(savedSize.h, taller.h, 0.03, 'the stored height matches what the board shows');
  pass('the chosen size is stored on the notice and synchronized', {
    storedWidth: round(savedSize.w), storedHeight: round(savedSize.h),
  });

  await p.reload();
  await note(title).waitFor({timeout: 30000});
  await sleep(800);
  const reloaded = await geometry(title);
  near(reloaded.w, taller.w, 0.02, 'width after a reload');
  near(reloaded.h, taller.h, 0.02, 'height after a reload');
  pass('the chosen size survives a reload');

  const keys = async (key, presses) => {
    await handle(title).focus();
    for (let press = 0; press < presses; press++) {await p.keyboard.press(key); await sleep(140);}
    await sleep(1500);
  };
  await keys('ArrowLeft', 2);
  const narrower = await geometry(title);
  near(narrower.w, reloaded.w - 0.08, 0.035, 'width after two ArrowLeft presses on the handle');
  await keys('ArrowUp', 2);
  const shorter = await geometry(title);
  near(shorter.h, narrower.h - 0.08, 0.035, 'height after two ArrowUp presses on the handle');
  pass('the handle is focusable and arrow keys resize a notice in both directions without a mouse', {
    width: round(narrower.w), height: round(shorter.h),
  });

  // Dragging can only take the notice's corner to the edge of the cork; it must
  // stop there rather than hang over the frame and carry the handle away.
  await dragHandle(title, 1.5, 1.5);
  // The drag ends past the cork, over the card that carries the board; the
  // click that closes it must not open the Noticeboard page.
  assert.equal(new URL(p.url()).pathname, '/', 'a drag that ends past the board stays on the Dashboard');
  const edge = await geometry(title);
  assert.ok(edge.x + edge.w <= 1.005, `the notice stops at the right edge: ${(edge.x + edge.w).toFixed(3)}`);
  assert.ok(edge.y + edge.h <= 1.005, `the notice stops at the bottom edge: ${(edge.y + edge.h).toFixed(3)}`);
  assert.ok(edge.x + edge.w >= 0.92, `dragging right reaches the right edge: ${(edge.x + edge.w).toFixed(3)}`);
  assert.ok(edge.y + edge.h >= 0.9, `dragging down reaches the bottom edge: ${(edge.y + edge.h).toFixed(3)}`);
  const stillThere = await handle(title).boundingBox();
  const cork = await p.locator('.nb-board').boundingBox();
  assert.ok(stillThere.y + stillThere.height <= cork.y + cork.height + 1, 'the handle is still on the cork');
  // Nothing of the board's own may stand over the corner a notice is resized
  // by, or the notice could never be made smaller again.
  const reachable = await handle(title).evaluate(el => {
    const box = el.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return {hits: hit === el || el.contains(hit), instead: hit ? hit.className : null};
  });
  assert.ok(reachable.hits, 'the handle in the corner is still what the pointer hits, not ' + reachable.instead);
  pass('a notice stretched into the corner stops at the edge of the cork and keeps its handle', {
    rightEdge: round(edge.x + edge.w), bottomEdge: round(edge.y + edge.h),
  });

  // Keys keep working past that point: the notice grows to the stored maximum
  // and slides along the edge to stay on the board, then back to the minimum.
  await keys('ArrowRight', 25);
  await keys('ArrowDown', 25);
  const maxed = await geometry(title);
  near(maxed.w, 0.9, 0.02, 'width after holding ArrowRight');
  near(maxed.h, 0.9, 0.02, 'height after holding ArrowDown');
  assert.ok(maxed.x + maxed.w <= 1.005 && maxed.y + maxed.h <= 1.005, 'the biggest notice still fits the board');
  await keys('ArrowLeft', 25);
  await keys('ArrowUp', 25);
  const mined = await geometry(title);
  near(mined.w, 0.15, 0.02, 'width after holding ArrowLeft');
  near(mined.h, 0.12, 0.02, 'height after holding ArrowUp');
  pass('resizing stays within the limits the board stores', {
    biggest: round(maxed.w) + ' x ' + round(maxed.h), smallest: round(mined.w) + ' x ' + round(mined.h),
  });

  // The picture is no longer stopped at the size it was taken at: a big notice
  // draws it bigger than its own pixels.
  const stretched = 'Poster ' + run;
  await addNotice(stretched, 120, 90);
  await park(stretched, 0.05, 0.05, 0.85, 0.85);
  const big = await geometry(stretched);
  assert.ok(big.drawnWidth > big.naturalWidth + 20,
    `a small picture is drawn larger than its own size: ${Math.round(big.drawnWidth)}px from ${big.naturalWidth}px`);
  // As large as the notice allows: the picture meets the edge of the room it
  // has on one axis, and is held back only by the shape of the notice.
  assert.ok(big.drawnWidth >= big.photoBoxWidth - 1 || big.drawnHeight >= big.photoBoxHeight - 1,
    'the picture fills the room the notice gives it');
  near(big.drawnHeight / big.drawnWidth, big.naturalHeight / big.naturalWidth, 0.03, 'the stretched picture keeps its shape');
  pass('a picture is drawn as large as the notice allows, past the size it was taken at', {
    ownPixels: big.naturalWidth + 'x' + big.naturalHeight,
    drawnPixels: Math.round(big.drawnWidth) + 'x' + Math.round(big.drawnHeight),
  });

  // Writing is sized from the notice's box, so a bigger notice stands out.
  const words = 'Bake sale ' + run;
  await addNotice(words, 0, 0, 'Jam tarts, lemon squares and a very large cake. Bring a tin.');
  await park(words, 0.05, 0.05, 0.2, 0.18);
  const small = await geometry(words);
  await park(words, 0.05, 0.05, 0.8, 0.8);
  const grown = await geometry(words);
  assert.ok(grown.fontSize > small.fontSize * 2,
    `the writing grows with the notice: ${small.fontSize.toFixed(1)}px -> ${grown.fontSize.toFixed(1)}px`);
  await park(words, 0.05, 0.05, 0.2, 0.18);
  const shrunk = await geometry(words);
  near(shrunk.fontSize, small.fontSize, 0.6, 'the writing returns to its size when the notice is made small again');
  pass('the writing on a notice is sized to the notice, so a notice can be made to stand out', {
    smallPx: round(small.fontSize), largePx: round(grown.fontSize),
  });

  // A very tall picture is fitted into the notice whole, rather than pushing the
  // notice and its handle off the cork.
  const tall = 'Hike plan ' + run;
  await addNotice(tall, 1000, 2200);
  await park(tall, 0.5, 0.08, 0.3, 0.5);
  const tallStart = await geometry(tall);
  assert.ok(tallStart.noteHeight <= tallStart.boardHeight,
    `a tall picture stays inside the board: note ${Math.round(tallStart.noteHeight)}px, board ${Math.round(tallStart.boardHeight)}px`);
  assert.ok(tallStart.drawnHeight <= tallStart.photoBoxHeight + 1, 'the tall picture is fitted whole, not cropped');
  await dragHandle(tall, 0.15, 0.1);
  const tallWider = await geometry(tall);
  near(tallWider.w, tallStart.w + 0.15, 0.05, 'width of a notice holding a tall picture');
  near(tallWider.h, tallStart.h + 0.1, 0.05, 'height of a notice holding a tall picture');
  pass('a notice holding a very tall picture stays on the board and still resizes', {
    size: round(tallStart.w) + ' x ' + round(tallStart.h) + ' -> ' + round(tallWider.w) + ' x ' + round(tallWider.h),
  });

  assert.deepEqual(errors, [], 'page errors');
  pass('no JavaScript page errors');
  writeFileSync(OUT + '/resize-acceptance.json', JSON.stringify({date: new Date().toISOString(), run, results}, null, 2) + '\n');
  console.log('NOTICEBOARD_RESIZE_ACCEPTANCE_OK checks=' + results.length);
} catch (failure) {
  try {await p.screenshot({path: OUT + '/resize-failure.png', fullPage: false});} catch { /* ignore */ }
  throw failure;
} finally {
  await ctx.close();
}
