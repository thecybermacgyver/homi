import assert from "node:assert/strict";
import { buildApp } from "../dist/app.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const HOUSEHOLD_ID = "22222222-2222-4222-8222-222222222222";
const MEMBERSHIP_ID = "33333333-3333-4333-8333-333333333333";
const PERSON_ID = "44444444-4444-4444-8444-444444444444";
const CLIENT_ID = "55555555-5555-4555-8555-555555555555";
const ITEM_ID = "66666666-6666-4666-8666-666666666666";
const MODULE_MUTATION_ID =
  "77777777-7777-4777-8777-777777777777";
const CORE_MUTATION_ID =
  "88888888-8888-4888-8888-888888888888";

const context = Object.freeze({
  requestId: "99999999-9999-4999-8999-999999999999",
  userId: USER_ID,
  householdId: HOUSEHOLD_ID,
  membershipId: MEMBERSHIP_ID,
  householdPersonId: PERSON_ID,
  clientId: CLIENT_ID,
  locale: "en-CA",
  timeZone: "America/Toronto",
});

let canManage = false;
let moduleInput = null;
let coreInput = null;

const app = buildApp({
  checkDatabase: async () => undefined,
  auth: {
    async handler() {
      return new Response(null, { status: 204 });
    },
    async getAuthSubject() {
      return "auth-subject";
    },
  },
  authBaseURL: "https://example.invalid",
  requestContext: {
    async resolve() {
      return context;
    },
  },
  authorization: {
    async listPermissions() {
      return canManage ? ["core.household.admin"] : [];
    },
    async hasPermission(_context, permissionKey) {
      return (
        canManage &&
        permissionKey === "core.household.admin"
      );
    },
    async requirePermission(_context, permissionKey) {
      if (
        !canManage ||
        permissionKey !== "core.household.admin"
      ) {
        const error = new Error(
          `Permission '${permissionKey}' is required.`,
        );
        error.statusCode = 403;
        error.code = "PERMISSION_DENIED";
        throw error;
      }
    },
  },
  household: {
    async discover() {
      return { userId: USER_ID, households: [] };
    },
    async getSettings() {
      return {
        id: HOUSEHOLD_ID,
        name: "Home",
        defaultLocale: "en-CA",
        timeZone: "America/Toronto",
        status: "active",
        revision: 4n,
      };
    },
    async updateSettings() {
      throw new Error("not used");
    },
  },
  householdModules: {
    async list() {
      return [];
    },
    async runtime() {
      return [];
    },
    async setEnabled() {
      throw new Error("not used");
    },
  },
  client: {
    async register() {
      throw new Error("not used");
    },
  },
  moduleSync: {
    async applyMutation(_context, input) {
      moduleInput = input;
      return {
        clientMutationId: input.clientMutationId,
        status: "applied",
        serverRevision: "1",
        changeSequence: "10",
        errorCode: null,
        serverState: {
          id: input.entityId,
          title: input.payload.title,
          revision: "1",
          deleted: false,
        },
        replayed: false,
      };
    },
  },
  sync: {
    async getChanges() {
      return {
        changes: [],
        nextSequence: "0",
        hasMore: false,
      };
    },
    async getStatus() {
      return {
        clientId: CLIENT_ID,
        householdId: HOUSEHOLD_ID,
        lastChangeSequence: "0",
        latestChangeSequence: "0",
      };
    },
    async acknowledgeCursor() {
      throw new Error("not used");
    },
    async applyMutation(_context, input) {
      coreInput = input;
      return {
        clientMutationId: input.clientMutationId,
        status: "applied",
        serverRevision: "5",
        changeSequence: "11",
        errorCode: null,
        serverState: {
          id: HOUSEHOLD_ID,
          name: "Updated Home",
          defaultLocale: "en-CA",
          timeZone: "America/Toronto",
          status: "active",
          revision: "5",
        },
        replayed: false,
      };
    },
  },
  modules: [],
});

try {
  const headers = {
    "x-homi-household-id": HOUSEHOLD_ID,
    "x-homi-client-id": CLIENT_ID,
  };

  const moduleResponse = await app.inject({
    method: "POST",
    url: "/api/v1/core/sync/mutations",
    headers,
    payload: {
      clientMutationId: MODULE_MUTATION_ID,
      moduleKey: "starter",
      entityType: "item",
      entityId: ITEM_ID,
      operation: "create",
      baseRevision: "0",
      payload: { title: "Queued item" },
    },
  });

  assert.equal(moduleResponse.statusCode, 200);
  assert.deepEqual(moduleInput, {
    clientMutationId: MODULE_MUTATION_ID,
    moduleKey: "starter",
    entityType: "item",
    entityId: ITEM_ID,
    operation: "create",
    baseRevision: 0n,
    payload: { title: "Queued item" },
  });
  assert.equal(coreInput, null);
  assert.equal(
    moduleResponse.json().data.serverRevision,
    "1",
  );

  const invalidModule = await app.inject({
    method: "POST",
    url: "/api/v1/core/sync/mutations",
    headers,
    payload: {
      clientMutationId:
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      moduleKey: "starter",
      entityType: "item",
      entityId: ITEM_ID,
      operation: "create",
      baseRevision: "9223372036854775808",
      payload: { title: "Too large" },
    },
  });
  assert.equal(invalidModule.statusCode, 400);
  assert.equal(
    invalidModule.json().error.code,
    "VALIDATION_FAILED",
  );

  const deniedCore = await app.inject({
    method: "POST",
    url: "/api/v1/core/sync/mutations",
    headers,
    payload: {
      clientMutationId: CORE_MUTATION_ID,
      moduleKey: "core",
      entityType: "household",
      entityId: HOUSEHOLD_ID,
      operation: "update",
      baseRevision: "4",
      payload: { name: "Updated Home" },
    },
  });
  assert.equal(deniedCore.statusCode, 403);
  assert.equal(
    deniedCore.json().error.code,
    "PERMISSION_DENIED",
  );
  assert.equal(coreInput, null);

  canManage = true;

  const coreResponse = await app.inject({
    method: "POST",
    url: "/api/v1/core/sync/mutations",
    headers,
    payload: {
      clientMutationId: CORE_MUTATION_ID,
      moduleKey: "core",
      entityType: "household",
      entityId: HOUSEHOLD_ID,
      operation: "update",
      baseRevision: "4",
      payload: { name: "Updated Home" },
    },
  });

  assert.equal(coreResponse.statusCode, 200);
  assert.deepEqual(coreInput, {
    clientMutationId: CORE_MUTATION_ID,
    moduleKey: "core",
    entityType: "household",
    entityId: HOUSEHOLD_ID,
    operation: "update",
    baseRevision: 4n,
    payload: { name: "Updated Home" },
  });
  assert.equal(
    coreResponse.json().data.serverRevision,
    "5",
  );

  console.log(
    "PASS_56_SYNC_ROUTE_CORE_MODULE_DISPATCH",
  );
} finally {
  await app.close();
}
