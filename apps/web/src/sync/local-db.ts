import Dexie, { type Table } from "dexie";

export type SyncMetaKey =
  | "clientInstanceId"
  | "activeOfflineContext"
  | `clientId:${string}`
  | `lastAppliedSequence:${string}:${string}`
  | `mutationOrder:${string}:${string}`;

export interface SyncMetaRow {
  key: SyncMetaKey;
  value: string;
  updatedAt: string;
}

export interface OfflineActiveContext {
  authSubject: string;
  householdId: string;
  clientId: string;
  coreUserId: string;
  householdName: string;
  locale: string;
  timeZone: string;
  validatedAt: string;
}

export interface LocalCacheRecord {
  key: string;
  authSubject: string;
  householdId: string;
  moduleKey: string;
  entityType: string;
  entityId: string;
  revision: string;
  sequence: string;
  data: unknown;
  updatedAt: string;
}

export type QueuedMutationStatus =
  | "queued"
  | "sending"
  | "applied"
  | "conflict"
  | "rejected";

export interface QueuedMutation {
  clientMutationId: string;
  authSubject: string;
  householdId: string;
  queueOrder: number;
  moduleKey: string;
  entityType: string;
  entityId: string;
  operation: string;
  baseRevision: string;
  payload: Record<string, unknown>;
  status: QueuedMutationStatus;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  lastErrorCode?: string;
  serverRevision?: string | null;
  changeSequence?: string | null;
  serverState?: unknown;
}

export interface MutationResultSnapshot {
  serverRevision: string | null;
  changeSequence: string | null;
  errorCode: string | null;
  serverState: unknown;
}

export interface LocalCacheIdentity {
  moduleKey: string;
  entityType: string;
  entityId: string;
}

export type LocalCacheApplyAction =
  | (LocalCacheIdentity & {
      kind: "put";
      revision: string;
      sequence: string;
      data: unknown;
    })
  | (LocalCacheIdentity & {
      kind: "delete";
      sequence: string;
    });

export interface ApplySyncActionsResult {
  lastAppliedSequence: string;
  completedMutationIds: string[];
}

class HomiClientDatabase extends Dexie {
  meta!: Table<SyncMetaRow, string>;
  cache!: Table<LocalCacheRecord, string>;
  mutations!: Table<QueuedMutation, string>;

  constructor() {
    super("homi-client");

    this.version(1).stores({
      meta: "&key",
      cache:
        "&key, householdId, moduleKey, entityType, entityId, [householdId+moduleKey+entityType]",
      mutations:
        "&clientMutationId, status, createdAt, householdId, [householdId+status], moduleKey, entityType, entityId",
    });

    this.version(2).stores({
      meta: "&key",
      cache:
        "&key, authSubject, householdId, moduleKey, entityType, entityId, [authSubject+householdId], [authSubject+householdId+moduleKey+entityType]",
      mutations:
        "&clientMutationId, authSubject, status, createdAt, householdId, [authSubject+status], [authSubject+householdId+status], moduleKey, entityType, entityId",
    }).upgrade(async (transaction) => {
      // Version-1 cache/mutation/sequence state has no authenticated owner.
      // It cannot be assigned safely after an account switch, so discard only
      // that unowned sync state while preserving installation/account client IDs.
      await transaction.table("cache").clear();
      await transaction.table("mutations").clear();
      const meta = transaction.table<SyncMetaRow, string>("meta");
      const legacySequenceKeys = await meta
        .filter((row) => row.key.startsWith("lastAppliedSequence:"))
        .primaryKeys();
      if (legacySequenceKeys.length > 0) {
        await meta.bulkDelete(legacySequenceKeys);
      }
    });

    this.version(3).stores({
      meta: "&key",
      cache:
        "&key, authSubject, householdId, moduleKey, entityType, entityId, [authSubject+householdId], [authSubject+householdId+moduleKey+entityType]",
      mutations:
        "&clientMutationId, authSubject, status, createdAt, queueOrder, householdId, [authSubject+status], [authSubject+householdId+status], moduleKey, entityType, entityId",
    }).upgrade(async (transaction) => {
      type PreOrderMutation = Omit<QueuedMutation, "queueOrder"> & {
        queueOrder?: number;
      };
      const mutations = transaction.table<PreOrderMutation, string>("mutations");
      const meta = transaction.table<SyncMetaRow, string>("meta");
      const rows = await mutations.toArray();
      rows.sort((left, right) =>
        left.authSubject.localeCompare(right.authSubject) ||
        left.householdId.localeCompare(right.householdId) ||
        left.createdAt.localeCompare(right.createdAt) ||
        left.clientMutationId.localeCompare(right.clientMutationId)
      );
      const counters = new Map<string, number>();
      for (const row of rows) {
        const scope = `${row.authSubject}:${row.householdId}`;
        const queueOrder = (counters.get(scope) ?? 0) + 1;
        counters.set(scope, queueOrder);
        await mutations.update(row.clientMutationId, { queueOrder });
      }
      const timestamp = now();
      for (const [scope, queueOrder] of counters) {
        await meta.put({
          key: `mutationOrder:${scope}` as SyncMetaKey,
          value: String(queueOrder),
          updatedAt: timestamp,
        });
      }
    });

    this.version(4).stores({
      meta: "&key",
      cache:
        "&key, authSubject, householdId, moduleKey, entityType, entityId, [authSubject+householdId], [authSubject+householdId+moduleKey+entityType]",
      mutations:
        "&clientMutationId, authSubject, status, createdAt, queueOrder, householdId, [authSubject+status], [authSubject+householdId+status], moduleKey, entityType, entityId",
    }).upgrade(async (transaction) => {
      // Clear out any trapped, poisoned, or unconfirmed historical mutation outboxes across all browsers
      await transaction.table("mutations").clear();
    });
  }
}

export const homiClientDb = new HomiClientDatabase();

const now = (): string => new Date().toISOString();

const nonNegativeIntegerPattern = /^(0|[1-9]\d*)$/;

function requireNonEmpty(value: string, field: string): void {
  if (!value.trim()) {
    throw new Error(`${field} must not be empty`);
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireUuid(value: string, field: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new Error(`${field} must be a valid UUID`);
  }
}

function clientIdKey(authSubject: string): `clientId:${string}` {
  requireUuid(authSubject, "authSubject");
  return `clientId:${authSubject}`;
}

function requireNonNegativeIntegerString(
  value: string,
  field: string,
): void {
  if (!nonNegativeIntegerPattern.test(value)) {
    throw new Error(`${field} must be a non-negative integer string`);
  }
}

function compareIntegerStrings(left: string, right: string): number {
  requireNonNegativeIntegerString(left, "left integer");
  requireNonNegativeIntegerString(right, "right integer");
  return left.length === right.length
    ? left.localeCompare(right)
    : left.length - right.length;
}

function lastAppliedSequenceKey(
  authSubject: string,
  householdId: string,
): `lastAppliedSequence:${string}:${string}` {
  requireUuid(authSubject, "authSubject");
  requireUuid(householdId, "householdId");
  return `lastAppliedSequence:${authSubject}:${householdId}`;
}

function mutationOrderKey(
  authSubject: string,
  householdId: string,
): `mutationOrder:${string}:${string}` {
  requireUuid(authSubject, "authSubject");
  requireUuid(householdId, "householdId");
  return `mutationOrder:${authSubject}:${householdId}`;
}

function cacheRecordKey(input: {
  authSubject: string;
  householdId: string;
  moduleKey: string;
  entityType: string;
  entityId: string;
}): string {
  return JSON.stringify([
    input.authSubject,
    input.householdId,
    input.moduleKey,
    input.entityType,
    input.entityId,
  ]);
}

export async function getOrCreateClientInstanceId(): Promise<string> {
  const existing = await homiClientDb.meta.get("clientInstanceId");

  if (existing?.value) {
    return existing.value;
  }

  const clientInstanceId = crypto.randomUUID();

  await homiClientDb.meta.put({
    key: "clientInstanceId",
    value: clientInstanceId,
    updatedAt: now(),
  });

  return clientInstanceId;
}

export async function getClientIdForAuthSubject(
  authSubject: string,
): Promise<string | null> {
  const existing = await homiClientDb.meta.get(clientIdKey(authSubject));
  return existing?.value || null;
}

export async function setClientIdForAuthSubject(
  authSubject: string,
  clientId: string,
): Promise<void> {
  const key = clientIdKey(authSubject);
  requireUuid(clientId, "clientId");

  await homiClientDb.meta.put({
    key,
    value: clientId,
    updatedAt: now(),
  });
}

export async function setActiveOfflineContext(
  context: Omit<OfflineActiveContext, "validatedAt">,
): Promise<OfflineActiveContext> {
  requireUuid(context.authSubject, "authSubject");
  requireUuid(context.householdId, "householdId");
  requireUuid(context.clientId, "clientId");
  requireUuid(context.coreUserId, "coreUserId");
  requireNonEmpty(context.householdName, "householdName");
  requireNonEmpty(context.locale, "locale");
  requireNonEmpty(context.timeZone, "timeZone");

  const stored: OfflineActiveContext = {
    ...context,
    validatedAt: now(),
  };
  await homiClientDb.meta.put({
    key: "activeOfflineContext",
    value: JSON.stringify(stored),
    updatedAt: stored.validatedAt,
  });
  return Object.freeze({ ...stored });
}

export async function getActiveOfflineContext(): Promise<OfflineActiveContext | null> {
  const row = await homiClientDb.meta.get("activeOfflineContext");
  if (!row) return null;

  let value: unknown;
  try {
    value = JSON.parse(row.value);
  } catch (cause) {
    throw new Error("Stored offline context is invalid JSON", { cause });
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Stored offline context is invalid");
  }
  const source = value as Record<string, unknown>;
  const keys = [
    "authSubject",
    "householdId",
    "clientId",
    "coreUserId",
    "householdName",
    "locale",
    "timeZone",
    "validatedAt",
  ];
  if (
    Object.keys(source).length !== keys.length ||
    !keys.every((key) => Object.hasOwn(source, key)) ||
    typeof source.authSubject !== "string" ||
    typeof source.householdId !== "string" ||
    typeof source.clientId !== "string" ||
    typeof source.coreUserId !== "string" ||
    typeof source.householdName !== "string" ||
    typeof source.locale !== "string" ||
    typeof source.timeZone !== "string" ||
    typeof source.validatedAt !== "string"
  ) {
    throw new Error("Stored offline context has an invalid shape");
  }
  requireUuid(source.authSubject, "Stored authSubject");
  requireUuid(source.householdId, "Stored householdId");
  requireUuid(source.clientId, "Stored clientId");
  requireUuid(source.coreUserId, "Stored coreUserId");
  requireNonEmpty(source.householdName, "Stored householdName");
  requireNonEmpty(source.locale, "Stored locale");
  requireNonEmpty(source.timeZone, "Stored timeZone");
  if (!Number.isFinite(Date.parse(source.validatedAt))) {
    throw new Error("Stored validatedAt must be an ISO date string");
  }
  return Object.freeze({
    authSubject: source.authSubject,
    householdId: source.householdId,
    clientId: source.clientId,
    coreUserId: source.coreUserId,
    householdName: source.householdName,
    locale: source.locale,
    timeZone: source.timeZone,
    validatedAt: source.validatedAt,
  });
}

export async function clearActiveOfflineContext(): Promise<void> {
  await homiClientDb.meta.delete("activeOfflineContext");
}

export async function getLastAppliedSequence(
  authSubject: string,
  householdId: string,
): Promise<string> {
  const existing = await homiClientDb.meta.get(
    lastAppliedSequenceKey(authSubject, householdId),
  );

  if (!existing) {
    return "0";
  }

  requireNonNegativeIntegerString(
    existing.value,
    "Stored sync sequence",
  );

  return existing.value;
}

export async function setLastAppliedSequence(
  authSubject: string,
  householdId: string,
  sequence: string,
): Promise<void> {
  requireNonNegativeIntegerString(sequence, "Sync sequence");

  await homiClientDb.meta.put({
    key: lastAppliedSequenceKey(authSubject, householdId),
    value: sequence,
    updatedAt: now(),
  });
}

export async function putCachedRecord(
  authSubject: string,
  record: Omit<LocalCacheRecord, "key" | "updatedAt" | "authSubject">,
): Promise<void> {
  requireUuid(authSubject, "authSubject");
  requireUuid(record.householdId, "householdId");
  requireNonEmpty(record.moduleKey, "moduleKey");
  requireNonEmpty(record.entityType, "entityType");
  requireNonEmpty(record.entityId, "entityId");
  requireNonNegativeIntegerString(record.revision, "revision");
  requireNonNegativeIntegerString(record.sequence, "sequence");

  const owned = { ...record, authSubject };
  await homiClientDb.cache.put({
    ...owned,
    key: cacheRecordKey(owned),
    updatedAt: now(),
  });
}

export async function seedCachedRecord(
  authSubject: string,
  record: Omit<
    LocalCacheRecord,
    "key" | "updatedAt" | "authSubject" | "sequence"
  >,
): Promise<LocalCacheRecord> {
  requireUuid(authSubject, "authSubject");
  requireUuid(record.householdId, "householdId");
  requireNonEmpty(record.moduleKey, "moduleKey");
  requireNonEmpty(record.entityType, "entityType");
  requireNonEmpty(record.entityId, "entityId");
  requireNonNegativeIntegerString(record.revision, "revision");

  const identity = {
    authSubject,
    householdId: record.householdId,
    moduleKey: record.moduleKey,
    entityType: record.entityType,
    entityId: record.entityId,
  };
  const key = cacheRecordKey(identity);

  return homiClientDb.transaction(
    "rw",
    homiClientDb.cache,
    async () => {
      const existing = await homiClientDb.cache.get(key);

      if (
        existing &&
        compareIntegerStrings(
          existing.revision,
          record.revision,
        ) > 0
      ) {
        return existing;
      }

      const stored: LocalCacheRecord = {
        key,
        ...identity,
        revision: record.revision,
        sequence: existing?.sequence ?? "0",
        data: record.data,
        updatedAt: now(),
      };
      await homiClientDb.cache.put(stored);
      return stored;
    },
  );
}

export async function getCachedRecord(
  authSubject: string,
  householdId: string,
  identity: LocalCacheIdentity,
): Promise<LocalCacheRecord | null> {
  requireUuid(authSubject, "authSubject");
  requireUuid(householdId, "householdId");
  requireNonEmpty(identity.moduleKey, "moduleKey");
  requireNonEmpty(identity.entityType, "entityType");
  requireNonEmpty(identity.entityId, "entityId");
  const key = cacheRecordKey({ authSubject, householdId, ...identity });
  return (await homiClientDb.cache.get(key)) ?? null;
}

export async function deleteCachedRecord(
  authSubject: string,
  householdId: string,
  identity: LocalCacheIdentity,
): Promise<void> {
  requireUuid(authSubject, "authSubject");
  requireUuid(householdId, "householdId");
  requireNonEmpty(identity.moduleKey, "moduleKey");
  requireNonEmpty(identity.entityType, "entityType");
  requireNonEmpty(identity.entityId, "entityId");
  const key = cacheRecordKey({ authSubject, householdId, ...identity });
  await homiClientDb.cache.delete(key);
}

export async function getCachedRecords(
  authSubject: string,
  householdId: string,
  moduleKey: string,
  entityType: string,
): Promise<LocalCacheRecord[]> {
  requireUuid(authSubject, "authSubject");
  requireUuid(householdId, "householdId");
  requireNonEmpty(moduleKey, "moduleKey");
  requireNonEmpty(entityType, "entityType");

  return homiClientDb.cache
    .where("[authSubject+householdId+moduleKey+entityType]")
    .equals([authSubject, householdId, moduleKey, entityType])
    .toArray();
}

export async function applySyncActions(
  authSubject: string,
  householdId: string,
  nextSequence: string,
  actions: readonly LocalCacheApplyAction[],
): Promise<ApplySyncActionsResult> {
  requireUuid(authSubject, "authSubject");
  requireUuid(householdId, "householdId");
  requireNonNegativeIntegerString(nextSequence, "nextSequence");

  return homiClientDb.transaction(
    "rw",
    homiClientDb.meta,
    homiClientDb.cache,
    homiClientDb.mutations,
    async () => {
      const sequenceKey = lastAppliedSequenceKey(authSubject, householdId);
      const stored = await homiClientDb.meta.get(sequenceKey);
      const current = stored?.value ?? "0";
      requireNonNegativeIntegerString(current, "Stored sync sequence");
      if (compareIntegerStrings(nextSequence, current) < 0) {
        throw new Error("nextSequence cannot move the local sync cursor backward");
      }

      let previous = current;
      for (const action of actions) {
        requireNonEmpty(action.moduleKey, "moduleKey");
        requireNonEmpty(action.entityType, "entityType");
        requireNonEmpty(action.entityId, "entityId");
        requireNonNegativeIntegerString(action.sequence, "action sequence");
        if (
          compareIntegerStrings(action.sequence, previous) <= 0 ||
          compareIntegerStrings(action.sequence, nextSequence) > 0
        ) {
          throw new Error("Sync actions must be strictly ordered through nextSequence");
        }

        const key = cacheRecordKey({
          authSubject,
          householdId,
          moduleKey: action.moduleKey,
          entityType: action.entityType,
          entityId: action.entityId,
        });
        if (action.kind === "delete") {
          await homiClientDb.cache.delete(key);
        } else {
          requireNonNegativeIntegerString(action.revision, "revision");
          await homiClientDb.cache.put({
            key,
            authSubject,
            householdId,
            moduleKey: action.moduleKey,
            entityType: action.entityType,
            entityId: action.entityId,
            revision: action.revision,
            sequence: action.sequence,
            data: action.data,
            updatedAt: now(),
          });
        }
        previous = action.sequence;
      }

      if (actions.length > 0 && previous !== nextSequence) {
        throw new Error("The final sync action must match nextSequence");
      }
      if (actions.length === 0 && nextSequence !== current) {
        throw new Error("A non-empty cursor advance requires materialized sync actions");
      }

      await homiClientDb.meta.put({
        key: sequenceKey,
        value: nextSequence,
        updatedAt: now(),
      });

      const applied = await homiClientDb.mutations
        .where("[authSubject+householdId+status]")
        .equals([authSubject, householdId, "applied"])
        .toArray();
      const completedMutationIds: string[] = [];
      for (const mutation of applied) {
        if (mutation.changeSequence === null || mutation.changeSequence === undefined) {
          continue;
        }
        requireNonNegativeIntegerString(
          mutation.changeSequence,
          "Stored mutation change sequence",
        );
        if (compareIntegerStrings(mutation.changeSequence, nextSequence) <= 0) {
          completedMutationIds.push(mutation.clientMutationId);
        }
      }
      if (completedMutationIds.length > 0) {
        await homiClientDb.mutations.bulkDelete(completedMutationIds);
      }

      return {
        lastAppliedSequence: nextSequence,
        completedMutationIds,
      };
    },
  );
}

export async function enqueueMutation(
  authSubject: string,
  input: {
    householdId: string;
    moduleKey: string;
    entityType: string;
    entityId: string;
    operation: string;
    baseRevision: string;
    payload: Record<string, unknown>;
  },
): Promise<QueuedMutation> {
  requireUuid(authSubject, "authSubject");
  requireUuid(input.householdId, "householdId");
  requireNonEmpty(input.moduleKey, "moduleKey");
  requireNonEmpty(input.entityType, "entityType");
  requireNonEmpty(input.entityId, "entityId");
  requireNonEmpty(input.operation, "operation");
  requireNonNegativeIntegerString(
    input.baseRevision,
    "baseRevision",
  );

  return homiClientDb.transaction(
    "rw",
    homiClientDb.meta,
    homiClientDb.mutations,
    async () => {
      const orderKey = mutationOrderKey(authSubject, input.householdId);
      const existingOrder = await homiClientDb.meta.get(orderKey);
      const previousOrder = existingOrder ? Number(existingOrder.value) : 0;
      if (!Number.isSafeInteger(previousOrder) || previousOrder < 0) {
        throw new Error("Stored mutation order must be a non-negative safe integer");
      }
      const queueOrder = previousOrder + 1;
      if (!Number.isSafeInteger(queueOrder)) {
        throw new Error("Mutation order exceeded the safe integer range");
      }
      const timestamp = now();
      const mutation: QueuedMutation = {
        clientMutationId: crypto.randomUUID(),
        authSubject,
        householdId: input.householdId,
        queueOrder,
        moduleKey: input.moduleKey,
        entityType: input.entityType,
        entityId: input.entityId,
        operation: input.operation,
        baseRevision: input.baseRevision,
        payload: input.payload,
        status: "queued",
        attempts: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      await homiClientDb.meta.put({
        key: orderKey,
        value: String(queueOrder),
        updatedAt: timestamp,
      });
      await homiClientDb.mutations.add(mutation);
      return mutation;
    },
  );
}

export async function getQueuedMutations(
  authSubject: string,
  householdId: string,
  limit = 100,
): Promise<QueuedMutation[]> {
  requireUuid(authSubject, "authSubject");
  requireUuid(householdId, "householdId");

  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error("limit must be a positive safe integer");
  }

  const queued = await homiClientDb.mutations
    .where("[authSubject+householdId+status]")
    .equals([authSubject, householdId, "queued"])
    .sortBy("queueOrder");

  return queued.slice(0, limit);
}

export async function retireQueuedMutationsForMissingModules(
  authSubject: string,
  householdId: string,
  installedModuleKeys: ReadonlySet<string>,
): Promise<number> {
  requireUuid(authSubject, "authSubject");
  requireUuid(householdId, "householdId");

  const queued = await homiClientDb.mutations
    .where("[authSubject+householdId+status]")
    .equals([authSubject, householdId, "queued"])
    .and(
      (mutation) =>
        mutation.moduleKey !== "core" &&
        !installedModuleKeys.has(mutation.moduleKey),
    )
    .toArray();

  if (queued.length === 0) return 0;

  const timestamp = now();
  await homiClientDb.mutations.bulkPut(
    queued.map((mutation) => ({
      ...mutation,
      status: "rejected" as const,
      updatedAt: timestamp,
      lastErrorCode: "MODULE_UNINSTALLED",
      serverRevision: null,
      changeSequence: null,
      serverState: null,
    })),
  );
  return queued.length;
}

export async function getHouseholdMutations(
  authSubject: string,
  householdId: string,
): Promise<QueuedMutation[]> {
  requireUuid(authSubject, "authSubject");
  requireUuid(householdId, "householdId");

  const rows = await homiClientDb.mutations
    .where("authSubject")
    .equals(authSubject)
    .and((mutation) => mutation.householdId === householdId)
    .toArray();

  return rows.sort((left, right) => left.queueOrder - right.queueOrder);
}

export async function rewriteUnsentMutation(
  authSubject: string,
  clientMutationId: string,
  patch: {
    operation: string;
    baseRevision: string;
    payload: Record<string, unknown>;
  },
): Promise<QueuedMutation> {
  requireUuid(authSubject, "authSubject");
  requireUuid(clientMutationId, "clientMutationId");
  requireNonEmpty(patch.operation, "operation");
  requireNonNegativeIntegerString(patch.baseRevision, "baseRevision");

  return homiClientDb.transaction("rw", homiClientDb.mutations, async () => {
    const mutation = await homiClientDb.mutations.get(clientMutationId);
    if (!mutation || mutation.authSubject !== authSubject) {
      throw new Error(`Unknown mutation ${clientMutationId}`);
    }
    if (mutation.status !== "queued" || mutation.attempts !== 0) {
      throw new Error(
        "Only never-dispatched queued mutations may be rewritten",
      );
    }

    const updated: QueuedMutation = {
      ...mutation,
      operation: patch.operation,
      baseRevision: patch.baseRevision,
      payload: patch.payload,
      updatedAt: now(),
    };
    delete updated.lastErrorCode;
    delete updated.serverRevision;
    delete updated.changeSequence;
    delete updated.serverState;
    await homiClientDb.mutations.put(updated);
    return updated;
  });
}

function ownedMutationCollection(
  authSubject: string,
  clientMutationId: string,
) {
  requireUuid(authSubject, "authSubject");
  requireUuid(clientMutationId, "clientMutationId");
  return homiClientDb.mutations
    .where("clientMutationId")
    .equals(clientMutationId)
    .and((mutation) => mutation.authSubject === authSubject);
}

export async function markMutationSending(
  authSubject: string,
  clientMutationId: string,
): Promise<void> {
  const timestamp = now();

  const updated = await ownedMutationCollection(
    authSubject,
    clientMutationId,
  ).modify((mutation) => {
    mutation.status = "sending";
    mutation.attempts += 1;
    mutation.updatedAt = timestamp;
    delete mutation.lastErrorCode;
  });

  if (updated === 0) {
    throw new Error(`Unknown mutation ${clientMutationId}`);
  }
}

export async function returnMutationToQueue(
  authSubject: string,
  clientMutationId: string,
  errorCode?: string,
): Promise<void> {
  const timestamp = now();

  const updated = await ownedMutationCollection(
    authSubject,
    clientMutationId,
  ).modify((mutation) => {
    mutation.status = "queued";
    mutation.updatedAt = timestamp;

    if (errorCode === undefined) {
      delete mutation.lastErrorCode;
    } else {
      mutation.lastErrorCode = errorCode;
    }
  });

  if (updated === 0) {
    throw new Error(`Unknown mutation ${clientMutationId}`);
  }
}

async function storeTerminalMutationResult(
  authSubject: string,
  clientMutationId: string,
  status: "applied" | "conflict" | "rejected",
  result: MutationResultSnapshot,
): Promise<void> {
  const timestamp = now();

  const updated = await ownedMutationCollection(
    authSubject,
    clientMutationId,
  ).modify((mutation) => {
    mutation.status = status;
    mutation.updatedAt = timestamp;
    mutation.serverRevision = result.serverRevision;
    mutation.changeSequence = result.changeSequence;
    mutation.serverState = result.serverState;

    if (result.errorCode === null) {
      delete mutation.lastErrorCode;
    } else {
      mutation.lastErrorCode = result.errorCode;
    }
  });

  if (updated === 0) {
    throw new Error(`Unknown mutation ${clientMutationId}`);
  }
}

export async function markMutationApplied(
  authSubject: string,
  clientMutationId: string,
  result: MutationResultSnapshot,
): Promise<void> {
  await storeTerminalMutationResult(
    authSubject,
    clientMutationId,
    "applied",
    result,
  );
}

export async function markMutationConflict(
  authSubject: string,
  clientMutationId: string,
  result: MutationResultSnapshot,
): Promise<void> {
  await storeTerminalMutationResult(
    authSubject,
    clientMutationId,
    "conflict",
    result,
  );
}

export async function markMutationRejected(
  authSubject: string,
  clientMutationId: string,
  result: MutationResultSnapshot,
): Promise<void> {
  await storeTerminalMutationResult(
    authSubject,
    clientMutationId,
    "rejected",
    result,
  );
}

export async function completeMutation(
  authSubject: string,
  clientMutationId: string,
): Promise<void> {
  requireUuid(authSubject, "authSubject");
  requireUuid(clientMutationId, "clientMutationId");
  const existing = await homiClientDb.mutations.get(clientMutationId);

  if (!existing) {
    return;
  }

  if (existing.authSubject !== authSubject) {
    throw new Error(`Unknown mutation ${clientMutationId}`);
  }

  await homiClientDb.mutations.delete(clientMutationId);
}

export async function recoverInterruptedMutations(
  authSubject: string,
): Promise<number> {
  requireUuid(authSubject, "authSubject");

  const stale = await homiClientDb.mutations
    .where("authSubject")
    .equals(authSubject)
    .and(
      (mutation) =>
        mutation.status === "rejected" ||
        mutation.status === "conflict" ||
        mutation.attempts >= 3,
    )
    .primaryKeys();
  if (stale.length > 0) {
    await homiClientDb.mutations.bulkDelete(stale);
  }

  const interrupted = await homiClientDb.mutations
    .where("[authSubject+status]")
    .equals([authSubject, "sending"])
    .primaryKeys();

  if (interrupted.length === 0) {
    return 0;
  }

  const timestamp = now();

  await homiClientDb.mutations.bulkUpdate(
    interrupted.map((clientMutationId) => ({
      key: clientMutationId,
      changes: {
        status: "queued" as const,
        updatedAt: timestamp,
      },
    })),
  );

  return interrupted.length;
}

export async function clearLingeringMutations(
  authSubject?: string,
  householdId?: string,
): Promise<number> {
  if (authSubject && householdId) {
    const rows = await homiClientDb.mutations
      .where("[authSubject+householdId+status]")
      .equals([authSubject, householdId, "queued"])
      .primaryKeys();
    await homiClientDb.mutations.bulkDelete(rows);
    return rows.length;
  }
  const allKeys = await homiClientDb.mutations.toCollection().primaryKeys();
  await homiClientDb.mutations.bulkDelete(allKeys);
  return allKeys.length;
}
