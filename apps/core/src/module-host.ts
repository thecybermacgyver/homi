import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { FastifyInstance } from "fastify";
import { fromNodeHeaders } from "better-auth/node";
import { sql } from "drizzle-orm";
import type {
  HomiDatabase,
} from "@homi/db";
import {
  HOMI_MODULE_API_VERSION,
  assertHomiModuleCompatibility,
  type HomiBrokerInvocation,
  type HomiCoreCapability,
  type HomiHouseholdPeopleCapability,
  type HomiModuleAtomicCapability,
  type HomiModuleAtomicServices,
  type HomiModuleJobHandler,
  type HomiModuleJobScheduleInput,
  type HomiModuleMutationServices,
  type HomiModuleJobsCapability,
  type HomiModuleNotificationInput,
  type HomiModuleNotificationsCapability,
  type HomiModuleSecretsCapability,
  type HomiModuleSyncPublishInput,
  type HomiModuleSyncPublisherCapability,
  type HomiModuleBrokerClient,
  type HomiServerBrokerProvider,
  type HomiModuleServerMutationHandler,
  type HomiModuleSetupStatus,
  type HomiRequestContext,
  type HomiServerModuleHostContext,
} from "@homi/module-sdk";
import type {
  HomiRequestContextResolver,
} from "./context.js";
import {
  createHomiModuleDatabase,
  createTransactionalHomiModuleDatabase,
  getHomiModuleSqlPool,
  type HomiModuleSqlClient,
} from "./module-database.js";
import {
  inspectHomiModulePackage,
} from "./module-package.js";

export interface HomiModuleHostContext
  extends HomiServerModuleHostContext {
  // Transitional legacy field for pre-platform first-party modules.
  // New modules use only the public HomiServerModuleHostContext contract.
  readonly database: HomiDatabase["db"];
}

export interface HomiRuntimeModule {
  readonly moduleKey: string;
  readonly moduleApiVersion?: typeof HOMI_MODULE_API_VERSION;
  readonly mutationHandlers?: readonly HomiModuleServerMutationHandler[];
  readonly jobHandlers?: readonly HomiModuleJobHandler[];
  readonly brokerProviders?: readonly HomiServerBrokerProvider[];
  readonly createMutationServices?: (
    client: HomiModuleSqlClient,
    context: HomiRequestContext,
  ) => Promise<HomiModuleMutationServices>;
  register(app: FastifyInstance): void;
  getSetupStatus?(
    context: HomiRequestContext,
  ): HomiModuleSetupStatus | Promise<HomiModuleSetupStatus>;
}

interface HomiModuleEntrypoint {
  createHomiServerModule?: (
    context: HomiModuleHostContext,
  ) => HomiRuntimeModule | Promise<HomiRuntimeModule>;
}

interface RegistryRuntimeRow {
  readonly moduleKey: string;
  readonly state: string;
  readonly currentVersion: string;
  readonly manifest: unknown;
  readonly activeVersion: string | null;
  readonly packageDigest: string | null;
}

function singleHeader(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseEntrypoints(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];

  const entries = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (new Set(entries).size !== entries.length) {
    throw new Error("HOMI_MODULE_ENTRYPOINTS contains duplicate entries.");
  }

  return entries;
}

function importSpecifier(entry: string): string {
  if (entry.startsWith("file:")) return entry;
  if (entry.startsWith("/")) return pathToFileURL(entry).href;
  return entry;
}

function validateModule(
  value: unknown,
  source: string,
): HomiRuntimeModule {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new Error(
      `Module entrypoint '${source}' did not return a module object.`,
    );
  }

  const module = value as Partial<HomiRuntimeModule> & {
    sync?: {
      mutationHandlers?:
        readonly HomiModuleServerMutationHandler[];
    };
    jobs?: {
      handlers?: readonly HomiModuleJobHandler[];
    };
    broker?: {
      providers?: readonly HomiServerBrokerProvider[];
    };
  };

  if (
    typeof module.moduleKey !== "string" ||
    !/^[a-z][a-z0-9-]{1,63}$/.test(module.moduleKey)
  ) {
    throw new Error(
      `Module entrypoint '${source}' returned an invalid moduleKey.`,
    );
  }

  if (
    module.moduleApiVersion !== undefined &&
    module.moduleApiVersion !== HOMI_MODULE_API_VERSION
  ) {
    throw new Error(
      `Module entrypoint '${source}' returned an unsupported moduleApiVersion.`,
    );
  }

  if (typeof module.register !== "function") {
    throw new Error(
      `Module entrypoint '${source}' did not provide register().`,
    );
  }

  if (
    module.getSetupStatus !== undefined &&
    typeof module.getSetupStatus !== "function"
  ) {
    throw new Error(
      `Module entrypoint '${source}' returned an invalid getSetupStatus().`,
    );
  }

  const mutationHandlers =
    module.sync?.mutationHandlers ??
    module.mutationHandlers;
  const jobHandlers = module.jobs?.handlers;
  const brokerProviders = module.broker?.providers;

  return {
    moduleKey: module.moduleKey,
    ...(module.moduleApiVersion === undefined
      ? {}
      : { moduleApiVersion: module.moduleApiVersion }),
    ...(mutationHandlers === undefined
      ? {}
      : {
          mutationHandlers: Object.freeze([
            ...mutationHandlers,
          ]),
        }),
    ...(jobHandlers === undefined
      ? {}
      : {
          jobHandlers: Object.freeze([...jobHandlers]),
        }),
    ...(brokerProviders === undefined
      ? {}
      : {
          brokerProviders: Object.freeze([
            ...brokerProviders,
          ]),
        }),
    register: module.register.bind(module),
    ...(module.getSetupStatus === undefined
      ? {}
      : {
          getSetupStatus:
            module.getSetupStatus.bind(module),
        }),
  };
}

async function importRuntimeModule(
  entry: string,
  context: HomiModuleHostContext,
): Promise<HomiRuntimeModule> {
  const imported =
    await import(importSpecifier(entry)) as HomiModuleEntrypoint;

  if (typeof imported.createHomiServerModule !== "function") {
    throw new Error(
      `Module entrypoint '${entry}' does not export createHomiServerModule().`,
    );
  }

  return validateModule(
    await imported.createHomiServerModule(context),
    entry,
  );
}

async function registryRows(
  database: HomiDatabase["db"],
): Promise<RegistryRuntimeRow[]> {
  const result = await database.execute(sql`
    SELECT
      m.module_key AS "moduleKey",
      m.state,
      m.current_version AS "currentVersion",
      m.manifest,
      mv.version AS "activeVersion",
      mv.package_digest AS "packageDigest"
    FROM core.modules AS m
    LEFT JOIN core.module_versions AS mv
      ON mv.module_id = m.id
     AND mv.version = m.current_version
     AND mv.migration_state = 'applied'
     AND mv.retired_at IS NULL
    ORDER BY m.module_key
  `);

  return result.rows as unknown as RegistryRuntimeRow[];
}

function moduleAccessError(
  code: string,
  message: string,
): Error & { statusCode: number; code: string } {
  const error = new Error(message) as Error & {
    statusCode: number;
    code: string;
  };
  error.statusCode = 403;
  error.code = code;
  return error;
}

interface HomiBrokerProviderRegistration {
  readonly moduleKey: string;
  readonly provider: HomiServerBrokerProvider;
}

type HomiBrokerRegistry = Map<
  string,
  HomiBrokerProviderRegistration
>;

function registerBrokerProviders(
  module: HomiRuntimeModule,
  declared: readonly string[],
  registry: HomiBrokerRegistry,
): void {
  const providers = module.brokerProviders ?? [];
  const providerCapabilities = providers.map(
    (provider) => provider.capability,
  );
  if (
    providerCapabilities.length !== declared.length ||
    declared.some(
      (capability) => !providerCapabilities.includes(capability),
    ) ||
    providerCapabilities.some(
      (capability) => !declared.includes(capability),
    )
  ) {
    throw new Error(
      `Module '${module.moduleKey}' broker providers do not match its manifest declarations.`,
    );
  }
  for (const provider of providers) {
    const existing = registry.get(provider.capability);
    if (existing) {
      throw new Error(
        `Broker capability '${provider.capability}' is provided by both '${existing.moduleKey}' and '${module.moduleKey}'.`,
      );
    }
    registry.set(
      provider.capability,
      Object.freeze({
        moduleKey: module.moduleKey,
        provider,
      }),
    );
  }
}

function moduleServiceError(code: string, message: string): Error & { statusCode: number; code: string } {
  const error = new Error(message) as Error & { statusCode: number; code: string };
  error.statusCode = 400;
  error.code = code;
  return error;
}

function secretKeyMaterial(master: string): Buffer {
  return Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(master, "utf8"),
      Buffer.from("homi-module-secrets-v1", "utf8"),
      Buffer.from("module-secret-encryption", "utf8"),
      32,
    ),
  );
}

function validateServiceKey(value: string, field: string): void {
  if (!/^[a-z][a-z0-9._:-]{0,127}$/.test(value)) {
    throw moduleServiceError("MODULE_SERVICE_KEY_INVALID", `${field} is invalid.`);
  }
}

function atomicModuleId(
  client: HomiModuleSqlClient,
  moduleKey: string,
  context: HomiRequestContext,
): Promise<string> {
  return client
    .query(
      `SELECT m.id::text AS id
       FROM core.modules AS m
       JOIN core.household_modules AS hm
         ON hm.module_id = m.id
       WHERE m.module_key = $1
         AND m.state = 'installed'
         AND hm.household_id = $2::uuid
         AND hm.enabled = true
       LIMIT 1`,
      [moduleKey, context.householdId],
    )
    .then((result) => {
      const row = result.rows[0] as { id?: unknown } | undefined;
      if (!row || typeof row.id !== "string") {
        throw moduleAccessError(
          "MODULE_NOT_ENABLED",
          `Module '${moduleKey}' is not enabled for this household.`,
        );
      }
      return row.id;
    });
}

function createAtomicModuleServices(input: {
  client: HomiModuleSqlClient;
  moduleKey: string;
  moduleId: string;
  declaredCapabilities: ReadonlySet<HomiCoreCapability>;
  moduleSecretMaster?: string;
}): HomiModuleAtomicServices {
  const database = createTransactionalHomiModuleDatabase(
    input.client,
  );

  const sync: HomiModuleSyncPublisherCapability | undefined =
    input.declaredCapabilities.has("sync")
      ? Object.freeze({
          async publish(context: HomiRequestContext, change: HomiModuleSyncPublishInput) {
            validateServiceKey(change.entityType, "sync entity type");
            if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(change.entityId)) {
              throw moduleServiceError(
                "MODULE_SYNC_CHANGE_INVALID",
                "Sync entity ID must be a UUID.",
              );
            }
            if (!/^[1-9][0-9]*$/.test(change.revision)) {
              throw moduleServiceError(
                "MODULE_SYNC_CHANGE_INVALID",
                "Sync revision must be a positive decimal string.",
              );
            }
            if (
              change.recipientUserId !== undefined &&
              !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(change.recipientUserId)
            ) {
              throw moduleServiceError(
                "MODULE_SYNC_CHANGE_INVALID",
                "Sync recipient user ID must be a UUID.",
              );
            }
            await input.client.query(
              `INSERT INTO core.audit_log (
                 household_id, actor_user_id, actor_client_id,
                 action, target_type, target_id, source_module_key,
                 request_id, metadata
               ) VALUES (
                 $1::uuid, $2::uuid, $3::uuid,
                 $4, $5, $6::uuid, $7, $8, $9::jsonb
               )`,
              [
                context.householdId,
                context.userId,
                context.clientId ?? null,
                `${input.moduleKey}.${change.entityType}.${change.operation}`,
                change.entityType,
                change.entityId,
                input.moduleKey,
                context.requestId,
                JSON.stringify({
                  source: "module-background",
                  revision: change.revision,
                }),
              ],
            );
            const result = await input.client.query(
              `INSERT INTO core.change_log (
                 household_id, module_key, entity_type, entity_id,
                 operation, revision, changed_by_user_id,
                 recipient_user_id, client_id
               ) VALUES (
                 $1::uuid, $2, $3, $4::uuid,
                 $5, $6::bigint, $7::uuid,
                 $8::uuid, $9::uuid
               ) RETURNING sequence::text AS sequence`,
              [
                context.householdId,
                input.moduleKey,
                change.entityType,
                change.entityId,
                change.operation,
                change.revision,
                context.userId,
                change.recipientUserId ?? null,
                context.clientId ?? null,
              ],
            );
            await input.client.query(
              `INSERT INTO core.event_outbox (
                 household_id, source_module_key, event_type,
                 aggregate_type, aggregate_id, payload
               ) VALUES (
                 $1::uuid, $2, $3, $4, $5::uuid, $6::jsonb
               )`,
              [
                context.householdId,
                input.moduleKey,
                `${input.moduleKey}.${change.entityType}.${change.operation}`,
                change.entityType,
                change.entityId,
                JSON.stringify({
                  revision: change.revision,
                  serverState: change.serverState ?? null,
                  source: "module-background",
                }),
              ],
            );
            const row = result.rows[0] as
              | { sequence?: unknown }
              | undefined;
            if (!row || typeof row.sequence !== "string") {
              throw new Error(
                "Module background change did not return a sequence.",
              );
            }
            return row.sequence;
          },
        })
      : undefined;

  const secrets: HomiModuleSecretsCapability | undefined =
    input.declaredCapabilities.has("secrets") &&
    input.moduleSecretMaster
      ? Object.freeze({
          async get(context: HomiRequestContext, key: string) {
            validateServiceKey(key, "secret key");
            const result = await input.client.query(
              `SELECT ciphertext, iv, auth_tag AS "authTag"
               FROM core.module_secrets
               WHERE household_id = $1::uuid
                 AND module_id = $2::uuid
                 AND secret_key = $3
               LIMIT 1`,
              [context.householdId, input.moduleId, key],
            );
            const row = result.rows[0] as
              | { ciphertext: string; iv: string; authTag: string }
              | undefined;
            if (!row) return null;
            const decipher = createDecipheriv(
              "aes-256-gcm",
              secretKeyMaterial(input.moduleSecretMaster!),
              Buffer.from(row.iv, "base64"),
            );
            decipher.setAuthTag(
              Buffer.from(row.authTag, "base64"),
            );
            return Buffer.concat([
              decipher.update(
                Buffer.from(row.ciphertext, "base64"),
              ),
              decipher.final(),
            ]).toString("utf8");
          },
          async set(context: HomiRequestContext, key: string, value: string) {
            validateServiceKey(key, "secret key");
            if (value.length > 65536) {
              throw moduleServiceError(
                "MODULE_SECRET_INVALID",
                "Module secret must be text no larger than 64 KiB.",
              );
            }
            const iv = randomBytes(12);
            const cipher = createCipheriv(
              "aes-256-gcm",
              secretKeyMaterial(input.moduleSecretMaster!),
              iv,
            );
            const ciphertext = Buffer.concat([
              cipher.update(value, "utf8"),
              cipher.final(),
            ]);
            const authTag = cipher.getAuthTag();
            await input.client.query(
              `INSERT INTO core.module_secrets (
                 household_id, module_id, secret_key,
                 ciphertext, iv, auth_tag, revision
               ) VALUES (
                 $1::uuid, $2::uuid, $3, $4, $5, $6, 1
               )
               ON CONFLICT (household_id, module_id, secret_key)
               DO UPDATE SET
                 ciphertext = EXCLUDED.ciphertext,
                 iv = EXCLUDED.iv,
                 auth_tag = EXCLUDED.auth_tag,
                 revision = core.module_secrets.revision + 1,
                 updated_at = now()`,
              [
                context.householdId,
                input.moduleId,
                key,
                ciphertext.toString("base64"),
                iv.toString("base64"),
                authTag.toString("base64"),
              ],
            );
          },
          async delete(context: HomiRequestContext, key: string) {
            validateServiceKey(key, "secret key");
            await input.client.query(
              `DELETE FROM core.module_secrets
               WHERE household_id = $1::uuid
                 AND module_id = $2::uuid
                 AND secret_key = $3`,
              [context.householdId, input.moduleId, key],
            );
          },
        })
      : undefined;

  const jobs: HomiModuleJobsCapability | undefined =
    input.declaredCapabilities.has("jobs")
      ? Object.freeze({
          async schedule(context: HomiRequestContext, job: HomiModuleJobScheduleInput) {
            validateServiceKey(job.jobType, "job type");
            if (job.dedupeKey !== undefined) {
              validateServiceKey(
                job.dedupeKey,
                "job dedupe key",
              );
            }
            const runAt = new Date(job.runAt);
            if (!Number.isFinite(runAt.getTime())) {
              throw moduleServiceError(
                "MODULE_JOB_INVALID",
                "runAt must be an ISO date-time.",
              );
            }
            const params = [
              context.householdId,
              input.moduleId,
              job.jobType,
              runAt.toISOString(),
              JSON.stringify(job.payload),
              JSON.stringify(context),
            ];
            const result = job.dedupeKey === undefined
              ? await input.client.query(
                  `INSERT INTO core.module_jobs (
                     household_id, module_id, job_type, run_at,
                     payload, context, status
                   ) VALUES (
                     $1::uuid, $2::uuid, $3, $4::timestamptz,
                     $5::jsonb, $6::jsonb, 'pending'
                   ) RETURNING id::text AS id`,
                  params,
                )
              : await input.client.query(
                  `INSERT INTO core.module_jobs (
                     household_id, module_id, job_type, run_at,
                     payload, context, dedupe_key, status
                   ) VALUES (
                     $1::uuid, $2::uuid, $3, $4::timestamptz,
                     $5::jsonb, $6::jsonb, $7, 'pending'
                   )
                   ON CONFLICT (household_id, module_id, dedupe_key)
                     WHERE dedupe_key IS NOT NULL AND status = 'pending'
                   DO UPDATE SET
                     job_type = EXCLUDED.job_type,
                     run_at = EXCLUDED.run_at,
                     payload = EXCLUDED.payload,
                     context = EXCLUDED.context,
                     updated_at = now()
                   RETURNING id::text AS id`,
                  [...params, job.dedupeKey],
                );
            const row = result.rows[0] as
              | { id?: unknown }
              | undefined;
            if (!row || typeof row.id !== "string") {
              throw new Error(
                "Scheduled module job returned no ID.",
              );
            }
            return row.id;
          },
          async cancelByDedupeKey(context: HomiRequestContext, dedupeKey: string) {
            validateServiceKey(
              dedupeKey,
              "job dedupe key",
            );
            const result = await input.client.query(
              `UPDATE core.module_jobs
               SET
                 status = 'cancelled',
                 updated_at = now(),
                 completed_at = now()
               WHERE household_id = $1::uuid
                 AND module_id = $2::uuid
                 AND dedupe_key = $3
                 AND status = 'pending'
               RETURNING id`,
              [context.householdId, input.moduleId, dedupeKey],
            );
            return result.rows.length;
          },
        })
      : undefined;

  const notifications:
    | HomiModuleNotificationsCapability
    | undefined = input.declaredCapabilities.has("notifications")
      ? Object.freeze({
          async notify(context: HomiRequestContext, notification: HomiModuleNotificationInput) {
            validateServiceKey(
              notification.notificationType,
              "notification type",
            );
            if (
              !notification.titleKey.trim() ||
              !notification.bodyKey.trim()
            ) {
              throw moduleServiceError(
                "MODULE_NOTIFICATION_INVALID",
                "Notification titleKey and bodyKey are required.",
              );
            }
            const personIds = notification.personIds ?? [];
            if (
              personIds.some(
                (id: string) => !/^[0-9a-f-]{36}$/i.test(id),
              )
            ) {
              throw moduleServiceError(
                "MODULE_NOTIFICATION_INVALID",
                "Notification person IDs are invalid.",
              );
            }
            const users = personIds.length === 0
              ? await input.client.query(
                  `SELECT hm.user_id::text AS "userId"
                   FROM core.household_memberships AS hm
                   WHERE hm.household_id = $1::uuid
                     AND hm.status = 'active'
                     AND hm.ended_at IS NULL
                   ORDER BY hm.user_id`,
                  [context.householdId],
                )
              : await input.client.query(
                  `SELECT DISTINCT hm.user_id::text AS "userId"
                   FROM core.household_people AS hp
                   JOIN core.household_memberships AS hm
                     ON hm.household_id = hp.household_id
                    AND hm.id = hp.linked_membership_id
                   WHERE hp.household_id = $1::uuid
                     AND hp.id = ANY($2::uuid[])
                     AND hp.status = 'active'
                     AND hm.status = 'active'
                     AND hm.ended_at IS NULL
                   ORDER BY "userId"`,
                  [context.householdId, [...personIds]],
                );
            const created: string[] = [];
            for (const row of users.rows as unknown as {
              userId: string;
            }[]) {
              const result = await input.client.query(
                `INSERT INTO core.notifications (
                   household_id, user_id, source_module_key,
                   notification_type, title_key, body_key,
                   arguments, data, expires_at
                 ) VALUES (
                   $1::uuid, $2::uuid, $3, $4, $5, $6,
                   $7::jsonb, $8::jsonb, $9::timestamptz
                 ) RETURNING id::text AS id`,
                [
                  context.householdId,
                  row.userId,
                  input.moduleKey,
                  notification.notificationType,
                  notification.titleKey,
                  notification.bodyKey,
                  JSON.stringify(notification.arguments ?? {}),
                  JSON.stringify(notification.data ?? {}),
                  notification.expiresAt ?? null,
                ],
              );
              const inserted = result.rows[0] as
                | { id?: unknown }
                | undefined;
              if (
                inserted &&
                typeof inserted.id === "string"
              ) {
                created.push(inserted.id);
              }
            }
            return Object.freeze(created);
          },
        })
      : undefined;

  return Object.freeze({
    database,
    ...(sync === undefined ? {} : { sync }),
    ...(secrets === undefined ? {} : { secrets }),
    ...(jobs === undefined ? {} : { jobs }),
    ...(notifications === undefined
      ? {}
      : { notifications }),
  });
}

function mutationServicesFromAtomic(
  services: HomiModuleAtomicServices,
): HomiModuleMutationServices {
  return Object.freeze({
    ...(services.secrets === undefined
      ? {}
      : { secrets: services.secrets }),
    ...(services.jobs === undefined
      ? {}
      : { jobs: services.jobs }),
    ...(services.notifications === undefined
      ? {}
      : { notifications: services.notifications }),
  });
}

async function createManagedMutationServices(input: {
  client: HomiModuleSqlClient;
  context: HomiRequestContext;
  moduleKey: string;
  declaredCapabilities: ReadonlySet<HomiCoreCapability>;
  moduleSecretMaster?: string;
}): Promise<HomiModuleMutationServices> {
  const moduleId = await atomicModuleId(
    input.client,
    input.moduleKey,
    input.context,
  );
  const services = createAtomicModuleServices({
    client: input.client,
    moduleKey: input.moduleKey,
    moduleId,
    declaredCapabilities: input.declaredCapabilities,
    ...(input.moduleSecretMaster === undefined
      ? {}
      : { moduleSecretMaster: input.moduleSecretMaster }),
  });
  return mutationServicesFromAtomic(services);
}

function createAtomicCapability(input: {
  database: HomiDatabase["db"];
  moduleKey: string;
  declaredCapabilities: ReadonlySet<HomiCoreCapability>;
  moduleSecretMaster?: string;
}): HomiModuleAtomicCapability {
  const pool = getHomiModuleSqlPool(input.database);
  return Object.freeze({
    async run<T>(
      context: HomiRequestContext,
      work: (services: HomiModuleAtomicServices) => Promise<T>,
    ): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const moduleId = await atomicModuleId(
          client,
          input.moduleKey,
          context,
        );
        const services = createAtomicModuleServices({
          client,
          moduleKey: input.moduleKey,
          moduleId,
          declaredCapabilities: input.declaredCapabilities,
          ...(input.moduleSecretMaster === undefined
            ? {}
            : { moduleSecretMaster: input.moduleSecretMaster }),
        });
        const value = await work(services);
        await client.query("COMMIT");
        return value;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
  });
}

function createHostContext(input: {
  database: HomiDatabase["db"];
  requestContext: HomiRequestContextResolver;
  coreCapabilities?: readonly HomiCoreCapability[];
  moduleKey?: string;
  moduleSecretMaster?: string;
  brokerConsumes?: readonly string[];
  brokerRegistry?: HomiBrokerRegistry;
}): HomiModuleHostContext {
  const publicDatabase =
    createHomiModuleDatabase(input.database);
  const declaredCapabilities = new Set(
    input.coreCapabilities ?? [],
  );

  const householdPeople:
    | HomiHouseholdPeopleCapability
    | undefined = declaredCapabilities.has("household-people")
      ? Object.freeze({
          async listActive(context: HomiRequestContext) {
            const result = await input.database.execute(sql`
              SELECT
                hp.id::text AS id,
                hp.display_name AS "displayName",
                hp.avatar_file_id::text AS "avatarFileId"
              FROM core.household_people AS hp
              WHERE hp.household_id =
                CAST(${context.householdId} AS uuid)
                AND hp.status = 'active'
              ORDER BY hp.display_name, hp.id
            `);

            return Object.freeze(
              result.rows.map((row) => {
                const value = row as unknown as {
                  id: string;
                  displayName: string;
                  avatarFileId: string | null;
                };
                return Object.freeze({
                  id: value.id,
                  displayName: value.displayName,
                  avatarFileId: value.avatarFileId,
                });
              }),
            );
          },
        })
      : undefined;

  const scopedModuleKey = input.moduleKey;
  const moduleId = async (context: HomiRequestContext): Promise<string> => {
    if (!scopedModuleKey) {
      throw moduleServiceError(
        "MODULE_SERVICE_SCOPE_UNAVAILABLE",
        "This runtime module does not have a managed service scope.",
      );
    }
    const result = await input.database.execute(sql`
      SELECT m.id::text AS id
      FROM core.modules AS m
      JOIN core.household_modules AS hm
        ON hm.module_id = m.id
      WHERE m.module_key = ${scopedModuleKey}
        AND m.state = 'installed'
        AND hm.household_id = CAST(${context.householdId} AS uuid)
        AND hm.enabled = true
      LIMIT 1
    `);
    const row = result.rows[0] as { id?: unknown } | undefined;
    if (!row || typeof row.id !== "string") {
      throw moduleAccessError(
        "MODULE_NOT_ENABLED",
        `Module '${scopedModuleKey}' is not enabled for this household.`,
      );
    }
    return row.id;
  };

  const syncPublisher: HomiModuleSyncPublisherCapability | undefined =
    declaredCapabilities.has("sync") && scopedModuleKey
      ? Object.freeze({
          async publish(
            context: HomiRequestContext,
            change: HomiModuleSyncPublishInput,
          ) {
            validateServiceKey(change.entityType, "sync entity type");
            if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(change.entityId)) {
              throw moduleServiceError(
                "MODULE_SYNC_CHANGE_INVALID",
                "Sync entity ID must be a UUID.",
              );
            }
            if (!/^[1-9][0-9]*$/.test(change.revision)) {
              throw moduleServiceError(
                "MODULE_SYNC_CHANGE_INVALID",
                "Sync revision must be a positive decimal string.",
              );
            }
            if (
              change.recipientUserId !== undefined &&
              !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(change.recipientUserId)
            ) {
              throw moduleServiceError(
                "MODULE_SYNC_CHANGE_INVALID",
                "Sync recipient user ID must be a UUID.",
              );
            }
            await moduleId(context);
            const statePayload = JSON.stringify(
              change.serverState ?? null,
            );
            return input.database.transaction(async (tx) => {
              await tx.execute(sql`
                INSERT INTO core.audit_log (
                  household_id,
                  actor_user_id,
                  actor_client_id,
                  action,
                  target_type,
                  target_id,
                  source_module_key,
                  request_id,
                  metadata
                ) VALUES (
                  CAST(${context.householdId} AS uuid),
                  CAST(${context.userId} AS uuid),
                  CAST(${context.clientId ?? null} AS uuid),
                  ${`${scopedModuleKey}.${change.entityType}.${change.operation}`},
                  ${change.entityType},
                  CAST(${change.entityId} AS uuid),
                  ${scopedModuleKey},
                  ${context.requestId},
                  ${JSON.stringify({
                    source: "module-background",
                    revision: change.revision,
                  })}::jsonb
                )
              `);
              const result = await tx.execute(sql`
                INSERT INTO core.change_log (
                  household_id,
                  module_key,
                  entity_type,
                  entity_id,
                  operation,
                  revision,
                  changed_by_user_id,
                  recipient_user_id,
                  client_id
                ) VALUES (
                  CAST(${context.householdId} AS uuid),
                  ${scopedModuleKey},
                  ${change.entityType},
                  CAST(${change.entityId} AS uuid),
                  ${change.operation},
                  CAST(${change.revision} AS bigint),
                  CAST(${context.userId} AS uuid),
                  CAST(${change.recipientUserId ?? null} AS uuid),
                  CAST(${context.clientId ?? null} AS uuid)
                )
                RETURNING sequence::text AS sequence
              `);
              await tx.execute(sql`
                INSERT INTO core.event_outbox (
                  household_id,
                  source_module_key,
                  event_type,
                  aggregate_type,
                  aggregate_id,
                  payload
                ) VALUES (
                  CAST(${context.householdId} AS uuid),
                  ${scopedModuleKey},
                  ${`${scopedModuleKey}.${change.entityType}.${change.operation}`},
                  ${change.entityType},
                  CAST(${change.entityId} AS uuid),
                  ${JSON.stringify({
                    revision: change.revision,
                    serverState: JSON.parse(statePayload),
                    source: "module-background",
                  })}::jsonb
                )
              `);
              const row = result.rows[0] as
                | { sequence?: unknown }
                | undefined;
              if (!row || typeof row.sequence !== "string") {
                throw new Error(
                  "Module background change did not return a sequence.",
                );
              }
              return row.sequence;
            });
          },
        })
      : undefined;

  const secrets: HomiModuleSecretsCapability | undefined =
    declaredCapabilities.has("secrets") && input.moduleSecretMaster && scopedModuleKey
      ? Object.freeze({
          async get(context: HomiRequestContext, key: string) {
            validateServiceKey(key, "secret key");
            const id = await moduleId(context);
            const result = await input.database.execute(sql`
              SELECT ciphertext, iv, auth_tag AS "authTag"
              FROM core.module_secrets
              WHERE household_id = CAST(${context.householdId} AS uuid)
                AND module_id = CAST(${id} AS uuid)
                AND secret_key = ${key}
              LIMIT 1
            `);
            const row = result.rows[0] as
              | { ciphertext: string; iv: string; authTag: string }
              | undefined;
            if (!row) return null;
            const decipher = createDecipheriv(
              "aes-256-gcm",
              secretKeyMaterial(input.moduleSecretMaster!),
              Buffer.from(row.iv, "base64"),
            );
            decipher.setAuthTag(Buffer.from(row.authTag, "base64"));
            return Buffer.concat([
              decipher.update(Buffer.from(row.ciphertext, "base64")),
              decipher.final(),
            ]).toString("utf8");
          },
          async set(context: HomiRequestContext, key: string, value: string) {
            validateServiceKey(key, "secret key");
            if (typeof value !== "string" || value.length > 65536) {
              throw moduleServiceError(
                "MODULE_SECRET_INVALID",
                "Module secret must be text no larger than 64 KiB.",
              );
            }
            const id = await moduleId(context);
            const iv = randomBytes(12);
            const cipher = createCipheriv(
              "aes-256-gcm",
              secretKeyMaterial(input.moduleSecretMaster!),
              iv,
            );
            const ciphertext = Buffer.concat([
              cipher.update(value, "utf8"),
              cipher.final(),
            ]);
            const authTag = cipher.getAuthTag();
            await input.database.execute(sql`
              INSERT INTO core.module_secrets (
                household_id, module_id, secret_key,
                ciphertext, iv, auth_tag, revision
              )
              VALUES (
                CAST(${context.householdId} AS uuid),
                CAST(${id} AS uuid),
                ${key}, ${ciphertext.toString("base64")},
                ${iv.toString("base64")}, ${authTag.toString("base64")}, 1
              )
              ON CONFLICT (household_id, module_id, secret_key)
              DO UPDATE SET
                ciphertext = EXCLUDED.ciphertext,
                iv = EXCLUDED.iv,
                auth_tag = EXCLUDED.auth_tag,
                revision = core.module_secrets.revision + 1,
                updated_at = now()
            `);
          },
          async delete(context: HomiRequestContext, key: string) {
            validateServiceKey(key, "secret key");
            const id = await moduleId(context);
            await input.database.execute(sql`
              DELETE FROM core.module_secrets
              WHERE household_id = CAST(${context.householdId} AS uuid)
                AND module_id = CAST(${id} AS uuid)
                AND secret_key = ${key}
            `);
          },
        })
      : undefined;

  const jobs: HomiModuleJobsCapability | undefined =
    declaredCapabilities.has("jobs") && scopedModuleKey
      ? Object.freeze({
          async schedule(context: HomiRequestContext, job: HomiModuleJobScheduleInput) {
            validateServiceKey(job.jobType, "job type");
            if (job.dedupeKey !== undefined) {
              validateServiceKey(job.dedupeKey, "job dedupe key");
            }
            const runAt = new Date(job.runAt);
            if (!Number.isFinite(runAt.getTime())) {
              throw moduleServiceError("MODULE_JOB_INVALID", "runAt must be an ISO date-time.");
            }
            const id = await moduleId(context);
            const contextJson = JSON.stringify(context);
            const payloadJson = JSON.stringify(job.payload);
            const result = job.dedupeKey === undefined
              ? await input.database.execute(sql`
                  INSERT INTO core.module_jobs (
                    household_id, module_id, job_type, run_at,
                    payload, context, status
                  ) VALUES (
                    CAST(${context.householdId} AS uuid),
                    CAST(${id} AS uuid), ${job.jobType}, ${runAt.toISOString()}::timestamptz,
                    ${payloadJson}::jsonb, ${contextJson}::jsonb, 'pending'
                  ) RETURNING id::text AS id
                `)
              : await input.database.execute(sql`
                  INSERT INTO core.module_jobs (
                    household_id, module_id, job_type, run_at,
                    payload, context, dedupe_key, status
                  ) VALUES (
                    CAST(${context.householdId} AS uuid),
                    CAST(${id} AS uuid), ${job.jobType}, ${runAt.toISOString()}::timestamptz,
                    ${payloadJson}::jsonb, ${contextJson}::jsonb, ${job.dedupeKey}, 'pending'
                  )
                  ON CONFLICT (household_id, module_id, dedupe_key)
                    WHERE dedupe_key IS NOT NULL AND status = 'pending'
                  DO UPDATE SET
                    job_type = EXCLUDED.job_type,
                    run_at = EXCLUDED.run_at,
                    payload = EXCLUDED.payload,
                    context = EXCLUDED.context,
                    updated_at = now()
                  RETURNING id::text AS id
                `);
            const row = result.rows[0] as { id?: unknown } | undefined;
            if (!row || typeof row.id !== "string") {
              throw new Error("Scheduled module job returned no ID.");
            }
            return row.id;
          },
          async cancelByDedupeKey(context: HomiRequestContext, dedupeKey: string) {
            validateServiceKey(dedupeKey, "job dedupe key");
            const id = await moduleId(context);
            const result = await input.database.execute(sql`
              UPDATE core.module_jobs
              SET status = 'cancelled', updated_at = now(), completed_at = now()
              WHERE household_id = CAST(${context.householdId} AS uuid)
                AND module_id = CAST(${id} AS uuid)
                AND dedupe_key = ${dedupeKey}
                AND status = 'pending'
              RETURNING id
            `);
            return result.rows.length;
          },
        })
      : undefined;

  const notifications: HomiModuleNotificationsCapability | undefined =
    declaredCapabilities.has("notifications") && scopedModuleKey
      ? Object.freeze({
          async notify(context: HomiRequestContext, notification: HomiModuleNotificationInput) {
            validateServiceKey(notification.notificationType, "notification type");
            if (!notification.titleKey.trim() || !notification.bodyKey.trim()) {
              throw moduleServiceError(
                "MODULE_NOTIFICATION_INVALID",
                "Notification titleKey and bodyKey are required.",
              );
            }
            const personIds = notification.personIds ?? [];
            if (personIds.some((id: string) => !/^[0-9a-f-]{36}$/i.test(id))) {
              throw moduleServiceError(
                "MODULE_NOTIFICATION_INVALID",
                "Notification person IDs are invalid.",
              );
            }
            const peopleArray = `{${personIds.join(",")}}`;
            const users = personIds.length === 0
              ? await input.database.execute(sql`
                  SELECT hm.user_id::text AS "userId"
                  FROM core.household_memberships AS hm
                  WHERE hm.household_id = CAST(${context.householdId} AS uuid)
                    AND hm.status = 'active'
                    AND hm.ended_at IS NULL
                  ORDER BY hm.user_id
                `)
              : await input.database.execute(sql`
                  SELECT DISTINCT hm.user_id::text AS "userId"
                  FROM core.household_people AS hp
                  JOIN core.household_memberships AS hm
                    ON hm.household_id = hp.household_id
                   AND hm.id = hp.linked_membership_id
                  WHERE hp.household_id = CAST(${context.householdId} AS uuid)
                    AND hp.id = ANY(CAST(${peopleArray} AS uuid[]))
                    AND hp.status = 'active'
                    AND hm.status = 'active'
                    AND hm.ended_at IS NULL
                  ORDER BY "userId"
                `);
            const moduleIdValue = await moduleId(context);
            const created: string[] = [];
            for (const row of users.rows as unknown as { userId: string }[]) {
              const result = await input.database.execute(sql`
                INSERT INTO core.notifications (
                  household_id, user_id, source_module_key,
                  notification_type, title_key, body_key,
                  arguments, data, expires_at
                ) VALUES (
                  CAST(${context.householdId} AS uuid),
                  CAST(${row.userId} AS uuid),
                  ${scopedModuleKey}, ${notification.notificationType},
                  ${notification.titleKey}, ${notification.bodyKey},
                  ${JSON.stringify(notification.arguments ?? {})}::jsonb,
                  ${JSON.stringify(notification.data ?? {})}::jsonb,
                  ${notification.expiresAt ?? null}::timestamptz
                ) RETURNING id::text AS id
              `);
              const inserted = result.rows[0] as { id?: unknown } | undefined;
              if (inserted && typeof inserted.id === "string") created.push(inserted.id);
            }
            void moduleIdValue;
            return Object.freeze(created);
          },
        })
      : undefined;

  const atomic: HomiModuleAtomicCapability | undefined =
    scopedModuleKey
      ? createAtomicCapability({
          database: input.database,
          moduleKey: scopedModuleKey,
          declaredCapabilities,
          ...(input.moduleSecretMaster === undefined
            ? {}
            : { moduleSecretMaster: input.moduleSecretMaster }),
        })
      : undefined;

  const brokerConsumes = new Set(input.brokerConsumes ?? []);
  const broker:
    | HomiModuleBrokerClient
    | undefined = brokerConsumes.size > 0 && input.brokerRegistry
      ? Object.freeze({
          async status(
            context: HomiRequestContext,
            capability: string,
          ) {
            if (!brokerConsumes.has(capability)) {
              throw moduleAccessError(
                "BROKER_CAPABILITY_UNDECLARED",
                `This module did not declare broker capability '${capability}'.`,
              );
            }
            const registration = input.brokerRegistry!.get(capability);
            if (!registration) {
              return Object.freeze({
                capability,
                state: "not-installed" as const,
                providerModuleKey: null,
                available: false,
              });
            }
            const enabled = await input.database.execute(sql`
              SELECT 1
              FROM core.modules AS m
              JOIN core.household_modules AS hm
                ON hm.module_id = m.id
              WHERE m.module_key = ${registration.moduleKey}
                AND m.state = 'installed'
                AND hm.household_id =
                  CAST(${context.householdId} AS uuid)
                AND hm.enabled = true
              LIMIT 1
            `);
            return Object.freeze({
              capability,
              state: enabled.rows[0]
                ? "available" as const
                : "not-enabled" as const,
              providerModuleKey: registration.moduleKey,
              available: Boolean(enabled.rows[0]),
            });
          },
          async invoke(
            context: HomiRequestContext,
            capability: string,
            invocation: HomiBrokerInvocation,
          ) {
            if (
              typeof invocation.action !== "string" ||
              !/^[a-z][a-z0-9-]{0,63}$/.test(invocation.action)
            ) {
              throw moduleAccessError(
                "BROKER_ACTION_INVALID",
                "The broker action is invalid.",
              );
            }
            const capabilityStatus = await this.status(
              context,
              capability,
            );
            if (capabilityStatus.state === "not-installed") {
              throw moduleAccessError(
                "BROKER_CAPABILITY_UNAVAILABLE",
                `Broker capability '${capability}' is not installed.`,
              );
            }
            if (capabilityStatus.state === "not-enabled") {
              throw moduleAccessError(
                "BROKER_PROVIDER_NOT_ENABLED",
                `Broker provider '${capabilityStatus.providerModuleKey}' is not enabled for this household.`,
              );
            }
            const registration = input.brokerRegistry!.get(capability)!;
            return registration.provider.handle(
              context,
              Object.freeze({
                action: invocation.action,
                payload: invocation.payload,
              }),
            );
          },
        })
      : undefined;

  return Object.freeze({
    database: input.database,
    moduleDatabase: publicDatabase,
    ...(householdPeople === undefined
      ? {}
      : { householdPeople }),
    ...(syncPublisher === undefined ? {} : { sync: syncPublisher }),
    ...(secrets === undefined ? {} : { secrets }),
    ...(jobs === undefined ? {} : { jobs }),
    ...(notifications === undefined ? {} : { notifications }),
    ...(atomic === undefined ? {} : { atomic }),
    ...(broker === undefined ? {} : { broker }),

    resolveContext(request: {
      id: string;
      headers: Record<string, string | string[] | undefined>;
    }) {
      const clientId = singleHeader(
        request.headers["x-homi-client-id"],
      );

      return input.requestContext.resolve({
        requestId: request.id,
        headers: fromNodeHeaders(request.headers),
        householdId: singleHeader(
          request.headers["x-homi-household-id"],
        ),
        ...(clientId !== undefined ? { clientId } : {}),
      });
    },

    async requireEnabled(
      moduleKey: string,
      context: HomiRequestContext,
    ) {
      if (!/^[a-z][a-z0-9-]{1,63}$/.test(moduleKey)) {
        throw moduleAccessError(
          "MODULE_KEY_INVALID",
          "The module key is invalid.",
        );
      }

      const result = await input.database.execute(sql`
        SELECT hm.enabled
        FROM core.modules AS m
        JOIN core.household_modules AS hm
          ON hm.module_id = m.id
        WHERE m.module_key = ${moduleKey}
          AND m.state = 'installed'
          AND hm.household_id =
            CAST(${context.householdId} AS uuid)
          AND hm.enabled = true
        LIMIT 1
      `);

      if (!result.rows[0]) {
        throw moduleAccessError(
          "MODULE_NOT_ENABLED",
          `Module '${moduleKey}' is not enabled for this household.`,
        );
      }
    },
  });
}

export async function loadHomiServerModules(input: {
  readonly legacyEntrypoints?: string;
  readonly installRoot?: string;
  readonly database: HomiDatabase["db"];
  readonly requestContext: HomiRequestContextResolver;
  readonly moduleSecretMaster?: string;
}): Promise<readonly HomiRuntimeModule[]> {
  const rows = await registryRows(input.database);
  const registry = new Map(
    rows.map((row) => [row.moduleKey, row] as const),
  );
  const modules: HomiRuntimeModule[] = [];
  const keys = new Set<string>();
  const resolvedInstalledKeys = new Set<string>();
  const brokerRegistry: HomiBrokerRegistry = new Map();

  if (input.installRoot?.trim()) {
    for (const row of rows) {
      if (row.state !== "installed") {
        continue;
      }

      if (
        row.activeVersion !== row.currentVersion ||
        row.packageDigest === null
      ) {
        // This installed registry row is still transitional/legacy. It may
        // fall back to HOMI_MODULE_ENTRYPOINTS below.
        continue;
      }

      const artifactRoot = join(
        input.installRoot,
        row.moduleKey,
        row.currentVersion,
      );

      const exists = await access(artifactRoot)
        .then(() => true)
        .catch(() => false);

      if (!exists) {
        throw new Error(
          `Installed module '${row.moduleKey}' is missing managed artifact version '${row.currentVersion}'.`,
        );
      }

      const prepared = await inspectHomiModulePackage(
        artifactRoot,
      );

      if (
        prepared.manifest.moduleKey !== row.moduleKey ||
        prepared.manifest.version !== row.currentVersion ||
        prepared.packageDigest !== row.packageDigest
      ) {
        throw new Error(
          `Managed module artifact '${row.moduleKey}@${row.currentVersion}' does not match the authoritative registry.`,
        );
      }

      assertHomiModuleCompatibility(
        prepared.manifest,
        HOMI_MODULE_API_VERSION,
      );

      resolvedInstalledKeys.add(row.moduleKey);

      const serverEntrypoint =
        prepared.manifest.entrypoints.server;
      if (!serverEntrypoint) continue;

      const entry = join(
        artifactRoot,
        serverEntrypoint.slice(2),
      );
      const module = await importRuntimeModule(
        entry,
        createHostContext({
          database: input.database,
          requestContext: input.requestContext,
          coreCapabilities:
            prepared.manifest.coreCapabilities,
          moduleKey: prepared.manifest.moduleKey,
          ...(input.moduleSecretMaster === undefined
            ? {}
            : { moduleSecretMaster: input.moduleSecretMaster }),
          brokerConsumes:
            prepared.manifest.broker?.consumes ?? [],
          brokerRegistry,
        }),
      );

      if (module.moduleKey !== row.moduleKey) {
        throw new Error(
          `Managed server entrypoint for '${row.moduleKey}' returned module key '${module.moduleKey}'.`,
        );
      }

      if (
        module.moduleApiVersion !==
        HOMI_MODULE_API_VERSION
      ) {
        throw new Error(
          `Managed server module '${row.moduleKey}' must declare Homi module API ${HOMI_MODULE_API_VERSION}.`,
        );
      }

      const declaredCapabilities = new Set(
        prepared.manifest.coreCapabilities,
      );
      const managedModule: HomiRuntimeModule = {
        ...module,
        async createMutationServices(client, context) {
          return createManagedMutationServices({
            client,
            context,
            moduleKey: prepared.manifest.moduleKey,
            declaredCapabilities,
            ...(input.moduleSecretMaster === undefined
              ? {}
              : { moduleSecretMaster: input.moduleSecretMaster }),
          });
        },
      };

      registerBrokerProviders(
        managedModule,
        prepared.manifest.broker?.provides ?? [],
        brokerRegistry,
      );

      keys.add(managedModule.moduleKey);
      modules.push(managedModule);
    }
  }

  const managedRuntimeKeys = new Set(keys);
  const installedRows = rows.filter(
    (row) => row.state === "installed",
  );
  const needsLegacyFallback = installedRows.some(
    (row) => !resolvedInstalledKeys.has(row.moduleKey),
  );

  if (needsLegacyFallback) {
    const legacyContext = createHostContext({
      ...input,
      brokerRegistry,
    });

    for (const entry of parseEntrypoints(input.legacyEntrypoints)) {
      const module = await importRuntimeModule(
        entry,
        legacyContext,
      );
      const row = registry.get(module.moduleKey);

      if (!row || row.state !== "installed") {
        continue;
      }

      if (managedRuntimeKeys.has(module.moduleKey)) {
        // Managed runtime is authoritative when both paths exist.
        continue;
      }

      if (keys.has(module.moduleKey)) {
        throw new Error(
          `Duplicate legacy runtime module key '${module.moduleKey}'.`,
        );
      }

      keys.add(module.moduleKey);
      resolvedInstalledKeys.add(module.moduleKey);
      modules.push(module);
    }
  }

  const unresolvedInstalled = installedRows.filter(
    (row) => !resolvedInstalledKeys.has(row.moduleKey),
  );
  if (unresolvedInstalled.length > 0) {
    throw new Error(
      `Installed modules have no loadable runtime: ${unresolvedInstalled
        .map((row) => row.moduleKey)
        .join(", ")}.`,
    );
  }

  return Object.freeze(modules);
}
