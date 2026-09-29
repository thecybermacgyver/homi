import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import {
  applySyncActions,
  enqueueMutation,
  getModuleMutations,
  homiClientDb,
  markMutationApplied,
  markMutationConflict,
  markMutationRejected,
  recoverInterruptedMutations,
  seedCachedRecord,
} from "./local-db.js";

function fixture(moduleKey = "shopping") {
  const authSubject = crypto.randomUUID();
  const householdId = crypto.randomUUID();
  const entityId = crypto.randomUUID();
  return {
    authSubject,
    householdId,
    entityId,
    moduleKey,
    queue(operation: string, baseRevision: string, payload: Record<string, unknown> = {}) {
      return enqueueMutation(authSubject, {
        householdId, moduleKey, entityType: "item", entityId,
        operation, baseRevision, payload,
      });
    },
    applied(clientMutationId: string, serverRevision: string, changeSequence: string) {
      return markMutationApplied(authSubject, clientMutationId, {
        serverRevision, changeSequence, errorCode: null, serverState: { revision: serverRevision },
      });
    },
    pull(revision: string, sequence: string) {
      return applySyncActions(authSubject, householdId, sequence, [{
        kind: "put", moduleKey, entityType: "item", entityId,
        revision, sequence, data: { revision },
      }]);
    },
  };
}

test("ticking right after an add continues from the delivered add", async () => {
  const f = fixture();
  const create = await f.queue("create", "0", { name: "Eggs" });
  await f.applied(create.clientMutationId, "1", "5");
  // The view still shows the add's provisional revision 0.
  const tick = await f.queue("update", "0", { name: "Eggs", checked: true });
  assert.equal(tick.baseRevision, "1");
  assert.equal(tick.dependsOnMutationId, undefined);
});

test("the rule still applies after reconciliation retires the add's receipt", async () => {
  const f = fixture();
  const create = await f.queue("create", "0", { name: "Eggs" });
  await f.applied(create.clientMutationId, "1", "1");
  const result = await f.pull("1", "1");
  assert.deepEqual(result.completedMutationIds, [create.clientMutationId]);
  const tick = await f.queue("update", "0", { checked: true });
  assert.equal(tick.baseRevision, "1");
});

test("a chain of this device's own writes is followed to the latest result", async () => {
  const f = fixture();
  const create = await f.queue("create", "0");
  await f.applied(create.clientMutationId, "1", "1");
  const edit = await f.queue("update", "1");
  await f.applied(edit.clientMutationId, "2", "2");
  const tick = await f.queue("update", "0");
  assert.equal(tick.baseRevision, "2");
});

test("another device's change is never skipped", async () => {
  const f = fixture();
  await seedCachedRecord(f.authSubject, {
    householdId: f.householdId, moduleKey: f.moduleKey, entityType: "item",
    entityId: f.entityId, revision: "1", data: {},
  });
  // Someone else moved the item to revision 3; this view still shows 1.
  await f.pull("3", "4");
  const edit = await f.queue("update", "1");
  assert.equal(edit.baseRevision, "1");
});

test("an own write followed by another device's change still conflicts", async () => {
  const f = fixture();
  const create = await f.queue("create", "0");
  await f.applied(create.clientMutationId, "1", "1");
  await f.pull("1", "1");
  await f.pull("2", "2");
  const tick = await f.queue("update", "0");
  assert.equal(tick.baseRevision, "0");
});

test("sync recovery keeps module changes awaiting review or retry", async () => {
  const f = fixture();
  // Separate items, so no change is blocked behind another's failure.
  const onItem = (payload: Record<string, unknown>) => enqueueMutation(f.authSubject, {
    householdId: f.householdId, moduleKey: f.moduleKey, entityType: "item",
    entityId: crypto.randomUUID(), operation: "update", baseRevision: "1", payload,
  });
  const conflict = await onItem({});
  const rejected = await onItem({ other: true });
  const retrying = await onItem({ again: true });
  await markMutationConflict(f.authSubject, conflict.clientMutationId, {
    serverRevision: "2", changeSequence: null, errorCode: "REVISION_CONFLICT", serverState: {},
  });
  await markMutationRejected(f.authSubject, rejected.clientMutationId, {
    serverRevision: null, changeSequence: null, errorCode: "SHOPPING_UPDATE_INVALID", serverState: null,
  });
  await homiClientDb.mutations.update(retrying.clientMutationId, { attempts: 5 });

  const core = fixture("core");
  const coreConflict = await core.queue("update", "1");
  await markMutationConflict(core.authSubject, coreConflict.clientMutationId, {
    serverRevision: "2", changeSequence: null, errorCode: "REVISION_CONFLICT", serverState: {},
  });

  await recoverInterruptedMutations(f.authSubject);
  await recoverInterruptedMutations(core.authSubject);
  const kept = await getModuleMutations(f.authSubject, f.householdId, f.moduleKey);
  assert.deepEqual(
    kept.map((row) => [row.clientMutationId, row.status]).sort(),
    [
      [conflict.clientMutationId, "conflict"],
      [rejected.clientMutationId, "rejected"],
      [retrying.clientMutationId, "queued"],
    ].sort(),
  );
  assert.equal(await homiClientDb.mutations.get(coreConflict.clientMutationId), undefined);
});
