import {
  account as betterAuthAccount,
  session as betterAuthSession,
  user as betterAuthUser,
  verification as betterAuthVerification,
} from "./schema/auth.generated.js";

export const HOMI_DB_ARCHITECTURE_VERSION = "0.1" as const;

export const HOMI_DATABASE_SCHEMAS = {
  core: "core",
  auth: "auth",
  jobs: "jobs",
  modulePrefix: "mod_",
} as const;

export const HOMI_BETTER_AUTH_SCHEMA = {
  user: betterAuthUser,
  session: betterAuthSession,
  account: betterAuthAccount,
  verification: betterAuthVerification,
};

export { createHomiDatabase, type HomiDatabase } from "./client.js";

export {
  users,
  households,
  householdMemberships,
  householdPeople,
} from "./schema/identity.js";

export {
  clients,
  changeLog,
  syncCursors,
  syncMutations,
} from "./schema/sync.js";

export { auditLog, eventOutbox } from "./schema/events.js";

export { modules, moduleVersions, householdModules } from "./schema/modules.js";
