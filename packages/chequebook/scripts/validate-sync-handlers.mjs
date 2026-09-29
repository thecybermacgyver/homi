import assert from "node:assert/strict";
import { chequebookChangeHandlers } from "../dist/sync.js";

// Change handlers must materialize a change replayed after its entity was
// deleted as a local delete, and still surface every other failure.
const household = "0b8f7a52-3c1e-4d7a-9f2b-6e5c4d3b2a19";
const context = { householdId: household, clientId: "5d2e8c71-9a4b-4f6e-8d3c-1b7a6e5f4c32" };
const transaction = chequebookChangeHandlers.find((handler) => handler.entityType === "transaction");
assert.ok(transaction);

function change(operation, entityId = crypto.randomUUID()) {
  return {
    sequence: "7", householdId: household, moduleKey: "chequebook", entityType: "transaction",
    entityId, operation, revision: "1", changedByUserId: null, clientId: null,
    changedAt: new Date().toISOString(),
  };
}

async function withResponse(status, body, work) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(body), { status });
  try {
    return await work();
  } finally {
    globalThis.fetch = original;
  }
}

for (const operation of ["create", "update"]) {
  const replayed = change(operation);
  const action = await withResponse(404,
    { error: { code: "CHEQUEBOOK_TRANSACTION_NOT_FOUND", message: "Transaction not found." } },
    () => transaction.materialize(replayed, context));
  assert.deepEqual(action, {
    kind: "delete", moduleKey: "chequebook", entityType: "transaction",
    entityId: replayed.entityId, sequence: "7",
  });
}

const live = change("update");
const put = await withResponse(200, { data: { id: live.entityId, revision: "2", amount: "4.00" } },
  () => transaction.materialize(live, context));
assert.equal(put.kind, "put");
assert.equal(put.revision, "2");

await assert.rejects(
  withResponse(404, { error: { code: "RESOURCE_NOT_FOUND", message: "Not found." } },
    () => transaction.materialize(change("update"), context)),
  (error) => error.code === "RESOURCE_NOT_FOUND",
);
await assert.rejects(
  withResponse(500, { error: { code: "INTERNAL_ERROR", message: "Failure." } },
    () => transaction.materialize(change("update"), context)),
  (error) => error.code === "INTERNAL_ERROR",
);

console.log("PASS_CHEQUEBOOK_SYNC_DELETED_ENTITY_HANDLING");
