import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import {
  dismissModuleMutation,
  enqueueMutation,
  getModuleMutations,
  markMutationConflict,
} from "./local-db.js";

const ACCOUNT_A = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_B = "22222222-2222-4222-8222-222222222222";
const HOUSEHOLD_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const HOUSEHOLD_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

async function queue(
  authSubject: string,
  householdId: string,
  moduleKey: string,
  entityId: string,
) {
  return enqueueMutation(authSubject, {
    householdId,
    moduleKey,
    entityType: "item",
    entityId,
    operation: "create",
    baseRevision: "0",
    payload: { name: entityId },
  });
}

test("module outbox view survives a database reopen and is scoped", async () => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase("homi-client");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });

  const visible = await queue(
    ACCOUNT_A,
    HOUSEHOLD_A,
    "shopping",
    "visible",
  );
  await queue(ACCOUNT_A, HOUSEHOLD_A, "calendar", "other-module");
  await queue(ACCOUNT_A, HOUSEHOLD_B, "shopping", "other-household");
  await queue(ACCOUNT_B, HOUSEHOLD_A, "shopping", "other-account");

  const firstRead = await getModuleMutations(
    ACCOUNT_A,
    HOUSEHOLD_A,
    "shopping",
  );
  assert.deepEqual(
    firstRead.map((row) => row.clientMutationId),
    [visible.clientMutationId],
  );
  assert.equal(firstRead[0]?.payload.name, "visible");

  const reopenedModule = await import(
    `./local-db.js?reopen=${Date.now()}`
  );
  const afterReopen = await reopenedModule.getModuleMutations(
    ACCOUNT_A,
    HOUSEHOLD_A,
    "shopping",
  );
  assert.deepEqual(
    afterReopen.map(
      (row: { clientMutationId: string }) => row.clientMutationId,
    ),
    [visible.clientMutationId],
  );

  await assert.rejects(
    dismissModuleMutation(
      ACCOUNT_A,
      HOUSEHOLD_A,
      "shopping",
      visible.clientMutationId,
    ),
    /Only conflict or rejected mutations/,
  );

  await markMutationConflict(ACCOUNT_A, visible.clientMutationId, {
    serverRevision: "3",
    changeSequence: "17",
    errorCode: "REVISION_CONFLICT",
    serverState: { name: "server value" },
  });
  const [conflict] = await getModuleMutations(
    ACCOUNT_A,
    HOUSEHOLD_A,
    "shopping",
  );
  assert.equal(conflict?.status, "conflict");
  assert.equal(conflict?.serverRevision, "3");
  assert.deepEqual(conflict?.serverState, { name: "server value" });

  await assert.rejects(
    dismissModuleMutation(
      ACCOUNT_A,
      HOUSEHOLD_A,
      "calendar",
      visible.clientMutationId,
    ),
    /Unknown mutation/,
  );
  await dismissModuleMutation(
    ACCOUNT_A,
    HOUSEHOLD_A,
    "shopping",
    visible.clientMutationId,
  );
  assert.deepEqual(
    await getModuleMutations(ACCOUNT_A, HOUSEHOLD_A, "shopping"),
    [],
  );
});
