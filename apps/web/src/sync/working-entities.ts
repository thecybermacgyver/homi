import type {
  LocalCacheRecord,
  QueuedMutation,
} from "./local-db.js";

export interface WorkingEntity {
  entityType: string;
  entityId: string;
  revision: string;
  sequence: string;
  data: unknown;
}

function objectData(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function projectWorkingEntities(
  cached: readonly LocalCacheRecord[],
  mutations: readonly QueuedMutation[],
  entityType: string,
): readonly WorkingEntity[] {
  const working = new Map<string, WorkingEntity>();
  for (const record of cached) {
    working.set(record.entityId, {
      entityType: record.entityType,
      entityId: record.entityId,
      revision: record.revision,
      sequence: record.sequence,
      data: record.data,
    });
  }

  for (const mutation of mutations) {
    if (
      mutation.entityType !== entityType ||
      mutation.status === "rejected"
    ) {
      continue;
    }
    const current = working.get(mutation.entityId);
    // An already-applied receipt must not roll a fresher pull snapshot backward.
    if (mutation.status === "applied" && current && mutation.serverRevision &&
      BigInt(current.revision) > BigInt(mutation.serverRevision)) continue;
    if (mutation.operation === "delete") {
      working.delete(mutation.entityId);
      continue;
    }

    const data = {
      householdId: mutation.householdId,
      createdAt: mutation.createdAt,
      updatedAt: mutation.updatedAt,
      ...objectData(current?.data),
      ...mutation.payload,
      ...(mutation.status === "applied" ? objectData(mutation.serverState) : {}),
      id: mutation.entityId,
      revision: mutation.serverRevision ?? mutation.baseRevision,
    };
    working.set(mutation.entityId, {
      entityType,
      entityId: mutation.entityId,
      revision: mutation.serverRevision ?? mutation.baseRevision,
      sequence:
        mutation.changeSequence ??
        current?.sequence ??
        "0",
      data: Object.freeze(data),
    });
  }

  return Object.freeze([...working.values()]);
}
