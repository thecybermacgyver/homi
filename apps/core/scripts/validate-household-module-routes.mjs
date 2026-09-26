import assert from "node:assert/strict";
import { buildApp } from "../dist/app.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const HOUSEHOLD_ID = "22222222-2222-4222-8222-222222222222";
const MEMBERSHIP_ID = "33333333-3333-4333-8333-333333333333";
const PERSON_ID = "44444444-4444-4444-8444-444444444444";
const CLIENT_ID = "55555555-5555-4555-8555-555555555555";
const MODULE_ID = "66666666-6666-4666-8666-666666666666";
const REQUEST_ID = "77777777-7777-4777-8777-777777777777";

const context = Object.freeze({
  requestId: REQUEST_ID,
  userId: USER_ID,
  householdId: HOUSEHOLD_ID,
  membershipId: MEMBERSHIP_ID,
  householdPersonId: PERSON_ID,
  clientId: CLIENT_ID,
  locale: "en-CA",
  timeZone: "America/Toronto",
});

let canManage = false;
let lastSetEnabled = null;
let installedDirectoryEntry = null;
let uninstalledModuleKey = null;
let directoryVerificationStatus = "verified";

const directoryEntry = Object.freeze({
  moduleKey: "starter",
  name: "Starter Module",
  publisher: "Homi",
  description: "Acceptance module.",
  latestVersion: "0.2.0",
  moduleApiVersion: 1,
  artifactUrl: "https://github.com/thecybermacgyver/homi/releases/download/starter-v0.2.0/starter.homi-module",
  packageDigest: "sha256:" + "a".repeat(64),
  sourceUrl: "https://github.com/thecybermacgyver/homi",
  requestedPermissions: [],
  publishedAt: "2026-09-22T18:00:00.000Z",
  verification: Object.freeze({
    status: "verified",
    testSuiteVersion: "homi-module-certification-1",
    testedAt: "2026-09-22T17:30:00.000Z",
  }),
  revoked: false,
});

const summary = Object.freeze({
  id: MODULE_ID,
  moduleKey: "starter",
  name: "Starter Module",
  publisher: "Homi",
  version: "0.1.0",
  globalState: "installed",
  available: true,
  enabled: false,
  revision: 0n,
  setupRequired: true,
  setupState: "unconfigured",
});

const authorization = {
  async listPermissions() {
    return canManage ? ["core.household.admin"] : [];
  },
  async hasPermission(_context, permissionKey) {
    return canManage && permissionKey === "core.household.admin";
  },
  async requirePermission(_context, permissionKey) {
    if (!canManage || permissionKey !== "core.household.admin") {
      const error = new Error(
        `Permission '${permissionKey}' is required.`,
      );
      error.statusCode = 403;
      error.code = "PERMISSION_DENIED";
      throw error;
    }
  },
};

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
  authorization,
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
        revision: 1n,
      };
    },
    async updateSettings() {
      throw new Error("not used");
    },
  },
  householdModules: {
    async list() {
      return [summary];
    },
    async setEnabled(_context, moduleKey, input) {
      lastSetEnabled = {
        moduleKey,
        enabled: input.enabled,
        baseRevision: input.baseRevision,
      };
      return {
        ...summary,
        enabled: input.enabled,
        revision: input.baseRevision + 1n,
      };
    },
  },
  client: {
    async register() {
      throw new Error("not used");
    },
  },
  moduleSync: {
    async applyMutation() {
      throw new Error("not used");
    },
  },
  moduleDirectory: {
    async list() {
      return {
        schemaVersion: 1,
        generatedAt: "2026-09-22T18:00:00.000Z",
        entries: [directoryVerificationStatus === "verified"
          ? directoryEntry
          : {
            ...directoryEntry,
            verification: {
              status: directoryVerificationStatus,
              testSuiteVersion: null,
              testedAt: null,
            },
            revoked: directoryVerificationStatus === "revoked",
          }],
        keyId: "acceptance-key",
      };
    },
  },
  moduleManager: {
    async install(entry) {
      installedDirectoryEntry = entry;
      return {
        moduleKey: entry.moduleKey,
        version: entry.latestVersion,
        status: "installed",
        fromVersion: "0.1.0",
        packageDigest: entry.packageDigest,
        backupId: "acceptance-backup",
      };
    },
    async uninstall(moduleKey) {
      uninstalledModuleKey = moduleKey;
      return {
        moduleKey,
        version: "0.1.0",
        backupId: "uninstall-backup",
        dataPreserved: true,
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
    async applyMutation() {
      throw new Error("not used");
    },
  },
  modules: [],
});

try {
  const headers = {
    "x-homi-household-id": HOUSEHOLD_ID,
    "x-homi-client-id": CLIENT_ID,
  };

  const memberCatalog = await app.inject({
    method: "GET",
    url: "/api/v1/core/modules",
    headers,
  });
  assert.equal(memberCatalog.statusCode, 200);
  assert.deepEqual(memberCatalog.json(), {
    data: {
      modules: [
        {
          id: MODULE_ID,
          moduleKey: "starter",
          name: "Starter Module",
          publisher: "Homi",
          version: "0.1.0",
          globalState: "installed",
          available: true,
          enabled: false,
          revision: "0",
          setupRequired: true,
          setupState: "unconfigured",
        },
      ],
      canManage: false,
    },
  });

  const denied = await app.inject({
    method: "PATCH",
    url: "/api/v1/core/modules/starter",
    headers,
    payload: {
      enabled: true,
      baseRevision: "0",
    },
  });
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.json().error.code, "PERMISSION_DENIED");
  assert.equal(lastSetEnabled, null);

  const deniedInstall = await app.inject({
    method: "POST",
    url: "/api/v1/core/module-directory/starter/install",
    headers,
  });
  assert.equal(deniedInstall.statusCode, 403);
  assert.equal(installedDirectoryEntry, null);

  const deniedUninstall = await app.inject({
    method: "DELETE",
    url: "/api/v1/core/modules/starter",
    headers,
  });
  assert.equal(deniedUninstall.statusCode, 403);
  assert.equal(uninstalledModuleKey, null);

  canManage = true;

  const unknownField = await app.inject({
    method: "PATCH",
    url: "/api/v1/core/modules/starter",
    headers,
    payload: {
      enabled: true,
      baseRevision: "0",
      extra: true,
    },
  });
  assert.equal(unknownField.statusCode, 400);
  assert.equal(
    unknownField.json().error.code,
    "VALIDATION_FAILED",
  );

  const tooLarge = await app.inject({
    method: "PATCH",
    url: "/api/v1/core/modules/starter",
    headers,
    payload: {
      enabled: true,
      baseRevision: "9223372036854775808",
    },
  });
  assert.equal(tooLarge.statusCode, 400);
  assert.equal(
    tooLarge.json().error.code,
    "VALIDATION_FAILED",
  );

  const invalidKey = await app.inject({
    method: "PATCH",
    url: "/api/v1/core/modules/Starter",
    headers,
    payload: {
      enabled: true,
      baseRevision: "0",
    },
  });
  assert.equal(invalidKey.statusCode, 400);

  const enabled = await app.inject({
    method: "PATCH",
    url: "/api/v1/core/modules/starter",
    headers,
    payload: {
      enabled: true,
      baseRevision: "0",
    },
  });
  assert.equal(enabled.statusCode, 200);
  assert.deepEqual(lastSetEnabled, {
    moduleKey: "starter",
    enabled: true,
    baseRevision: 0n,
  });
  assert.equal(enabled.json().data.enabled, true);
  assert.equal(enabled.json().data.revision, "1");

  directoryVerificationStatus = "unverified";
  installedDirectoryEntry = null;
  const unverifiedDenied = await app.inject({
    method: "POST",
    url: "/api/v1/core/module-directory/starter/install",
    headers,
    payload: { allowUnverified: false },
  });
  assert.equal(unverifiedDenied.statusCode, 409);
  assert.equal(
    unverifiedDenied.json().error.code,
    "MODULE_DIRECTORY_ENTRY_UNVERIFIED",
  );
  assert.equal(installedDirectoryEntry, null);

  const unverifiedAccepted = await app.inject({
    method: "POST",
    url: "/api/v1/core/module-directory/starter/install",
    headers,
    payload: { allowUnverified: true },
  });
  assert.equal(unverifiedAccepted.statusCode, 200);
  assert.equal(
    installedDirectoryEntry.verification.status,
    "unverified",
  );

  directoryVerificationStatus = "failed";
  installedDirectoryEntry = null;
  const failedDirectory = await app.inject({
    method: "GET",
    url: "/api/v1/core/module-directory",
    headers,
  });
  assert.equal(failedDirectory.statusCode, 200);
  assert.deepEqual(failedDirectory.json().data.entries, []);

  const failedDenied = await app.inject({
    method: "POST",
    url: "/api/v1/core/module-directory/starter/install",
    headers,
    payload: { allowUnverified: true },
  });
  assert.equal(failedDenied.statusCode, 409);
  assert.equal(
    failedDenied.json().error.code,
    "MODULE_DIRECTORY_ENTRY_FAILED",
  );
  assert.equal(installedDirectoryEntry, null);

  directoryVerificationStatus = "verified";
  const installed = await app.inject({
    method: "POST",
    url: "/api/v1/core/module-directory/starter/install",
    headers,
  });
  assert.equal(installed.statusCode, 200);
  assert.equal(installedDirectoryEntry, directoryEntry);
  assert.deepEqual(installed.json().data, {
    moduleKey: "starter",
    version: "0.2.0",
    status: "installed",
    fromVersion: "0.1.0",
    packageDigest: directoryEntry.packageDigest,
    backupId: "acceptance-backup",
    restarting: true,
  });

  const uninstalled = await app.inject({
    method: "DELETE",
    url: "/api/v1/core/modules/starter",
    headers,
  });
  assert.equal(uninstalled.statusCode, 200);
  assert.equal(uninstalledModuleKey, "starter");
  assert.deepEqual(uninstalled.json().data, {
    moduleKey: "starter",
    version: "0.1.0",
    backupId: "uninstall-backup",
    dataPreserved: true,
    restarting: true,
  });

  console.log(
    "PASS_55_HOUSEHOLD_MODULE_ROUTES directory-install=yes uninstall=yes admin-only=yes",
  );
} finally {
  await app.close();
}
