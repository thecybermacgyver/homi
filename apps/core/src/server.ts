import { createHomiDatabase } from "@homi/db";
import { buildApp } from "./app.js";
import { createHomiAuth } from "./auth.js";
import { createHomiAuthorization } from "./authorization.js";
import { createHomiClientService } from "./client.js";
import { createHomiRequestContextResolver } from "./context.js";
import { createHomiHouseholdService } from "./household.js";
import { createHomiHouseholdModuleService } from "./household-modules.js";
import { createHomiMemberModulePreferenceService } from "./member-module-preferences.js";
import { createHomiSyncService } from "./sync.js";
import { createHomiModuleAssetService } from "./module-assets.js";
import { createHomiModuleDirectoryService } from "./module-directory.js";
import { createHomiModuleManagerClient } from "./module-manager-client.js";
import { createHomiModuleSyncService } from "./module-sync.js";
import { loadHomiServerModules } from "./module-host.js";
import { createHomiModuleJobRunner } from "./module-jobs.js";

const host = process.env.HOMI_HOST ?? "0.0.0.0";
const port = Number.parseInt(process.env.HOMI_PORT ?? "3001", 10);
const databaseUrl = process.env.HOMI_DATABASE_URL;
const authSecret = process.env.HOMI_AUTH_SECRET;
const authBaseURL = process.env.HOMI_AUTH_BASE_URL;
const moduleDirectoryUrl = process.env.HOMI_MODULE_DIRECTORY_URL?.trim() || undefined;
const moduleDirectoryKeys = process.env.HOMI_MODULE_DIRECTORY_TRUSTED_KEYS?.trim() || undefined;
const moduleManagerUrl = process.env.HOMI_MODULE_MANAGER_URL?.trim();
const moduleManagerSecret = process.env.HOMI_MODULE_MANAGER_SECRET?.trim();
const githubToken = process.env.HOMI_GITHUB_TOKEN?.trim();

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("HOMI_PORT must be a valid TCP port.");
}

if (!databaseUrl) {
  throw new Error("HOMI_DATABASE_URL is required.");
}

if (!authSecret) {
  throw new Error("HOMI_AUTH_SECRET is required.");
}

if (!authBaseURL) {
  throw new Error("HOMI_AUTH_BASE_URL is required.");
}

const database = createHomiDatabase(databaseUrl);
const auth = createHomiAuth({
  database: database.db,
  secret: authSecret,
  baseURL: authBaseURL,
});

const requestContext = createHomiRequestContextResolver(
  database.db,
  auth,
);

const legacyModuleEntrypoints =
  process.env.HOMI_MODULE_ENTRYPOINTS;
const moduleInstallRoot =
  process.env.HOMI_MODULES_DIRECTORY;

const modules = await loadHomiServerModules({
  ...(legacyModuleEntrypoints === undefined
    ? {}
    : { legacyEntrypoints: legacyModuleEntrypoints }),
  ...(moduleInstallRoot === undefined
    ? {}
    : { installRoot: moduleInstallRoot }),
  database: database.db,
  requestContext,
  moduleSecretMaster: authSecret,
});

const authorization = createHomiAuthorization(database.db);
const household = createHomiHouseholdService(database.db);
const householdModules = createHomiHouseholdModuleService(
  database.db,
  modules,
);
const client = createHomiClientService(database.db);
const sync = createHomiSyncService(database.db);
const memberModulePreferences =
  createHomiMemberModulePreferenceService(database.db);
const moduleSync = createHomiModuleSyncService(
  database.db,
  modules,
);
const moduleAssets =
  moduleInstallRoot === undefined
    ? undefined
    : createHomiModuleAssetService(
        database.db,
        moduleInstallRoot,
      );

let moduleDirectory;
if ((moduleDirectoryUrl === undefined) !== (moduleDirectoryKeys === undefined)) {
  throw new Error("HOMI_MODULE_DIRECTORY_URL and HOMI_MODULE_DIRECTORY_TRUSTED_KEYS must be configured together.");
}
if (moduleDirectoryUrl !== undefined && moduleDirectoryKeys !== undefined) {
  const parsed = JSON.parse(moduleDirectoryKeys) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("HOMI_MODULE_DIRECTORY_TRUSTED_KEYS must be a JSON object of key IDs to PEM public keys.");
  }
  const entries = Object.entries(parsed);
  if (entries.length === 0 || entries.some(([, value]) => typeof value !== "string")) {
    throw new Error("HOMI_MODULE_DIRECTORY_TRUSTED_KEYS must contain at least one PEM public key.");
  }
  moduleDirectory = createHomiModuleDirectoryService({
    directoryUrl: moduleDirectoryUrl,
    trustedPublicKeys: new Map(entries as [string, string][]),
    ...(githubToken === undefined ? {} : { githubToken }),
  });
}

if ((moduleManagerUrl === undefined) !== (moduleManagerSecret === undefined)) {
  throw new Error(
    "HOMI_MODULE_MANAGER_URL and HOMI_MODULE_MANAGER_SECRET must be configured together.",
  );
}
const moduleManager =
  moduleManagerUrl && moduleManagerSecret
    ? createHomiModuleManagerClient({
        endpoint: moduleManagerUrl,
        secret: moduleManagerSecret,
      })
    : undefined;

const moduleJobs = createHomiModuleJobRunner(
  database.db,
  modules,
);

const app = buildApp({
  checkDatabase: database.check,
  auth,
  authBaseURL,
  requestContext,
  authorization,
  household,
  householdModules,
  memberModulePreferences,
  client,
  sync,
  moduleSync,
  ...(moduleAssets === undefined ? {} : { moduleAssets }),
  ...(moduleDirectory === undefined ? {} : { moduleDirectory }),
  ...(moduleManager === undefined ? {} : { moduleManager }),
  ...(moduleManager === undefined
    ? {}
    : {
        onModuleInstalled: () => {
          setTimeout(() => process.exit(0), 1_500).unref();
        },
        onModulesChanged: () => {
          setTimeout(() => process.exit(0), 1_500).unref();
        },
      }),
  modules,
});

moduleJobs.start();

app.addHook("onClose", async () => {
  moduleJobs.stop();
  await database.close();
});

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "Shutting down Homi Core");
  await app.close();
  process.exit(0);
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ host, port });
} catch (error) {
  app.log.error(error);
  await database.close();
  process.exit(1);
}
