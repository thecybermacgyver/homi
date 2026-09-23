import assert from "node:assert/strict";
import test from "node:test";
import type {
  LocalCacheRecord,
  QueuedMutation,
} from "./local-db.js";
import { projectWorkingEntities } from "./working-entities.js";

const cached = [{
  key: "cache",
  authSubject: "account",
  householdId: "household",
  moduleKey: "module",
  entityType: "item",
  entityId: "existing",
  revision: "2",
  sequence: "4",
  data: { id: "existing", revision: "2", name: "old" },
  updatedAt: "2026-01-01T00:00:00.000Z",
}] satisfies LocalCacheRecord[];

function mutation(
  values: Partial<QueuedMutation> &
    Pick<QueuedMutation, "clientMutationId" | "entityId" | "operation">,
): QueuedMutation {
  return {
    authSubject: "account",
    householdId: "household",
    queueOrder: 1,
    moduleKey: "module",
    entityType: "item",
    baseRevision: "0",
    payload: {},
    status: "queued",
    attempts: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...values,
  };
}

test("projects durable creates, updates, deletes and conflicts", () => {
  const result = projectWorkingEntities(
    cached,
    [
      mutation({
        clientMutationId: "create",
        entityId: "created",
        operation: "create",
        payload: { name: "new" },
      }),
      mutation({
        clientMutationId: "update",
        entityId: "existing",
        operation: "update",
        baseRevision: "2",
        payload: { name: "edited" },
        status: "conflict",
        serverRevision: "3",
      }),
      mutation({
        clientMutationId: "delete",
        entityId: "removed",
        operation: "delete",
      }),
      mutation({
        clientMutationId: "rejected",
        entityId: "rejected",
        operation: "create",
        payload: { name: "invalid" },
        status: "rejected",
      }),
    ],
    "item",
  );

  assert.deepEqual(
    result.map((item) => item.entityId).sort(),
    ["created", "existing"],
  );
  assert.deepEqual(
    result.find((item) => item.entityId === "created")?.data,
    {
      householdId: "household",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      id: "created",
      revision: "0",
      name: "new",
    },
  );
  assert.deepEqual(
    result.find((item) => item.entityId === "existing")?.data,
    {
      id: "existing",
      revision: "3",
      name: "edited",
      householdId: "household",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  );
});
