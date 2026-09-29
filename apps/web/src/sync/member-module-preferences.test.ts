import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { seedCachedRecord } from "./local-db.js";
import {
  fetchMemberModulePreferences,
  getEffectiveMemberModulePreferences,
  queueMemberModulePreferenceUpdate,
} from "./member-module-preferences.js";

const styles = [
  { id: "items", label: "List" },
  { id: "store-counts", label: "Counts by store" },
];

function preference(overrides: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    moduleId: crypto.randomUUID(),
    moduleKey: "shopping",
    surfaceId: "shopping-list",
    label: "Shopping List",
    visible: true,
    displayOrder: 0,
    cardStyle: "items",
    cardStyles: styles,
    phoneLayout: null,
    wideLayout: null,
    revision: "1",
    ...overrides,
  };
}

async function withResponse<T>(body: unknown, work: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(body), { status: 200 });
  try {
    return await work();
  } finally {
    globalThis.fetch = original;
  }
}

const identity = {
  householdId: crypto.randomUUID(),
  clientId: crypto.randomUUID(),
};

test("server preferences carry the effective card style and declared styles", async () => {
  const value = preference({ cardStyle: "store-counts" });
  const [parsed] = await withResponse(
    { data: { preferences: [value, preference({ cardStyle: null, cardStyles: [] })] } },
    () => fetchMemberModulePreferences(identity),
  );
  assert.equal(parsed!.cardStyle, "store-counts");
  assert.deepEqual(parsed!.cardStyles, styles);
});

test("server preferences with an undeclared or missing card style are rejected", async () => {
  for (const invalid of [
    preference({ cardStyle: "unknown" }),
    preference({ cardStyle: null }),
    preference({ cardStyles: [], cardStyle: "items" }),
  ]) {
    await assert.rejects(
      withResponse({ data: { preferences: [invalid] } }, () =>
        fetchMemberModulePreferences(identity)),
      /invalid data/,
    );
  }
});

test("preferences cached before card styles existed stay readable", async () => {
  const authSubject = crypto.randomUUID();
  const householdId = crypto.randomUUID();
  const { cardStyle: _style, cardStyles: _styles, ...legacy } = preference({ visible: false });
  await seedCachedRecord(authSubject, {
    householdId,
    moduleKey: "core",
    entityType: "member-module-preference",
    entityId: legacy.id,
    revision: legacy.revision,
    data: legacy,
  });
  const [cached] = await getEffectiveMemberModulePreferences(authSubject, householdId);
  assert.equal(cached!.visible, false);
  assert.equal(cached!.cardStyle, null);
  assert.deepEqual(cached!.cardStyles, []);
});

test("a queued card style change applies immediately while offline", async () => {
  const authSubject = crypto.randomUUID();
  const householdId = crypto.randomUUID();
  const value = preference();
  await seedCachedRecord(authSubject, {
    householdId,
    moduleKey: "core",
    entityType: "member-module-preference",
    entityId: value.id,
    revision: value.revision,
    data: value,
  });
  const [current] = await getEffectiveMemberModulePreferences(authSubject, householdId);
  await queueMemberModulePreferenceUpdate(authSubject, householdId, current!, {
    cardStyle: "store-counts",
  });
  const [effective] = await getEffectiveMemberModulePreferences(authSubject, householdId);
  assert.equal(effective!.cardStyle, "store-counts");
  await assert.rejects(
    queueMemberModulePreferenceUpdate(authSubject, householdId, current!, {
      cardStyle: "Not Valid",
    }),
    /card style identifier/,
  );
});

test("server preferences carry separate phone and wide placements", async () => {
  const value = preference({
    phoneLayout: { x: 0, y: 3, w: 4, h: 5 },
    wideLayout: { x: 4, y: 0, w: 4, h: 5 },
  });
  const [parsed] = await withResponse(
    { data: { preferences: [value] } },
    () => fetchMemberModulePreferences(identity),
  );
  assert.deepEqual(parsed!.phoneLayout, { x: 0, y: 3, w: 4, h: 5 });
  assert.deepEqual(parsed!.wideLayout, { x: 4, y: 0, w: 4, h: 5 });

  for (const invalid of [
    preference({ phoneLayout: { x: 4, y: 0, w: 4, h: 5 } }),
    preference({ wideLayout: { x: 0, y: 0, w: 2, h: 13 } }),
    preference({ wideLayout: { x: 0, y: 0, w: 2 } }),
  ]) {
    await assert.rejects(
      withResponse({ data: { preferences: [invalid] } }, () =>
        fetchMemberModulePreferences(identity)),
      /invalid data/,
    );
  }
});

test("preferences cached before card layouts existed read as unplaced", async () => {
  const authSubject = crypto.randomUUID();
  const householdId = crypto.randomUUID();
  const { phoneLayout: _phone, wideLayout: _wide, ...legacy } =
    preference({ cardStyle: "store-counts" });
  await seedCachedRecord(authSubject, {
    householdId,
    moduleKey: "core",
    entityType: "member-module-preference",
    entityId: legacy.id,
    revision: legacy.revision,
    data: legacy,
  });
  const [cached] = await getEffectiveMemberModulePreferences(authSubject, householdId);
  assert.equal(cached!.cardStyle, "store-counts");
  assert.equal(cached!.phoneLayout, null);
  assert.equal(cached!.wideLayout, null);
});

test("a queued placement applies immediately and can be cleared", async () => {
  const authSubject = crypto.randomUUID();
  const householdId = crypto.randomUUID();
  const value = preference({ phoneLayout: { x: 0, y: 0, w: 4, h: 4 } });
  await seedCachedRecord(authSubject, {
    householdId,
    moduleKey: "core",
    entityType: "member-module-preference",
    entityId: value.id,
    revision: value.revision,
    data: value,
  });
  const [current] = await getEffectiveMemberModulePreferences(authSubject, householdId);
  await queueMemberModulePreferenceUpdate(authSubject, householdId, current!, {
    wideLayout: { x: 2, y: 1, w: 3, h: 4 },
  });
  let [effective] = await getEffectiveMemberModulePreferences(authSubject, householdId);
  assert.deepEqual(effective!.wideLayout, { x: 2, y: 1, w: 3, h: 4 });
  assert.deepEqual(effective!.phoneLayout, { x: 0, y: 0, w: 4, h: 4 });

  await queueMemberModulePreferenceUpdate(authSubject, householdId, current!, {
    phoneLayout: null,
  });
  [effective] = await getEffectiveMemberModulePreferences(authSubject, householdId);
  assert.equal(effective!.phoneLayout, null);
  assert.deepEqual(effective!.wideLayout, { x: 2, y: 1, w: 3, h: 4 });

  await assert.rejects(
    queueMemberModulePreferenceUpdate(authSubject, householdId, current!, {
      phoneLayout: { x: 1, y: 0, w: 4, h: 4 },
    }),
    /card placement on the phone board/,
  );
});
