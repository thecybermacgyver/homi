import assert from "node:assert/strict";
import test from "node:test";
import {
  CoreHouseholdModuleSyncHandlerError,
  createCoreHouseholdModuleSyncHandler,
} from "./core-household-module-sync-handler.js";
import type { HouseholdModuleSnapshot } from "./household-modules.js";
import type { SyncChange } from "./sync-feed.js";

const householdId = "b7bc2be9-e004-488e-835b-cacf5bf14720";
const clientId = "c96fc97f-6c09-4d05-be99-85dbaba037ce";
const entityId = "e98397db-7bc2-405f-ac53-c6efb2907e6f";

const change: SyncChange = Object.freeze({
  sequence: "53",
  householdId,
  moduleKey: "core",
  entityType: "household-module",
  entityId,
  operation: "update",
  revision: "2",
  changedByUserId: null,
  clientId: null,
  changedAt: "2026-09-25T19:00:00.000Z",
});
function snapshot(revision: string): HouseholdModuleSnapshot {
  return Object.freeze({
    id: entityId,
    moduleKey: "shopping",
    name: "Shopping",
    publisher: "Homi",
    version: "0.1.0",
    globalState: "installed",
    available: true,
    enabled: false,
    revision,
    setupRequired: false,
    setupState: "not-required",
  });
}

test("removes a cached module omitted from the authoritative catalog", async () => {
  const handler = createCoreHouseholdModuleSyncHandler({
    async fetchHouseholdModules() {
      return Object.freeze({
        modules: Object.freeze([]),
        canManage: true,
      });
    },
  });

  const action = await handler.materialize(change, {
    householdId,
    clientId,
  });

  assert.deepEqual(action, {
    kind: "delete",
    moduleKey: "core",
    entityType: "household-module",
    entityId,
    sequence: "53",
  });
});

test("rejects a present module snapshot older than the change", async () => {
  const handler = createCoreHouseholdModuleSyncHandler({
    async fetchHouseholdModules() {
      return Object.freeze({
        modules: Object.freeze([snapshot("1")]),
        canManage: true,
      });
    },
  });

  await assert.rejects(
    handler.materialize(change, { householdId, clientId }),
    (error: unknown) =>
      error instanceof CoreHouseholdModuleSyncHandlerError &&
      error.code === "CORE_HOUSEHOLD_MODULE_SYNC_STALE_SNAPSHOT",
  );
});

test("uses an authoritative snapshot at or beyond the change revision", async () => {
  const module = snapshot("3");
  const handler = createCoreHouseholdModuleSyncHandler({
    async fetchHouseholdModules() {
      return Object.freeze({
        modules: Object.freeze([module]),
        canManage: false,
      });
    },
  });

  const action = await handler.materialize(change, {
    householdId,
    clientId,
  });

  assert.deepEqual(action, {
    kind: "put",
    moduleKey: "core",
    entityType: "household-module",
    entityId,
    revision: "3",
    sequence: "53",
    data: module,
  });
});
