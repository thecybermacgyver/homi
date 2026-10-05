import type {
  HomiModuleMutationAdapter,
  HomiModuleMutationSubmissionResult,
  HomiModuleQueuedMutation,
  HomiModuleSyncChange,
  HomiModuleSyncChangeHandler,
  HomiModuleSyncHandlerContext,
} from "@homi/module-sdk";
import { NOTICEBOARD_MODULE_KEY } from "./constants.js";
import type { Notice } from "./types.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POSITIVE_INTEGER = /^[1-9][0-9]*$/;
const NON_NEGATIVE_INTEGER = /^(0|[1-9][0-9]*)$/;

class NoticeboardApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "NoticeboardApiError";
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function json(response: Response): Promise<unknown> {
  const raw = await response.text();
  try {
    return JSON.parse(raw);
  } catch {
    throw new NoticeboardApiError(
      "NOTICEBOARD_API_INVALID_RESPONSE",
      "Noticeboard returned an invalid response.",
      response.status,
    );
  }
}

function responseError(body: unknown, status: number): NoticeboardApiError {
  if (
    object(body) &&
    object(body.error) &&
    typeof body.error.code === "string" &&
    typeof body.error.message === "string"
  ) {
    return new NoticeboardApiError(body.error.code, body.error.message, status);
  }
  return new NoticeboardApiError("NOTICEBOARD_API_FAILED", "The Noticeboard request failed.", status);
}

const COLOR = /^#[0-9a-f]{6}$/i;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseChecklist(value: unknown): Notice["checklist"] {
  if (!Array.isArray(value)) throw new NoticeboardApiError("NOTICEBOARD_NOTICE_INVALID_RESPONSE", "A Noticeboard checklist is invalid.");
  return Object.freeze(value.map((entry) => {
    if (!object(entry) || typeof entry.id !== "string" || typeof entry.text !== "string" || typeof entry.done !== "boolean") {
      throw new NoticeboardApiError("NOTICEBOARD_NOTICE_INVALID_RESPONSE", "A Noticeboard checklist item is invalid.");
    }
    return Object.freeze({ id: entry.id, text: entry.text, done: entry.done });
  }));
}

export function parseNotice(value: unknown): Notice {
  return parseNoticeValue(value, POSITIVE_INTEGER);
}

// A notice created on this device has revision 0 and no author until it is
// delivered, so the working view accepts both.
export function parseWorkingNotice(value: unknown): Notice {
  return parseNoticeValue(object(value)
    ? { authorPersonId: null, deleted: false, body: "", image: null, checklist: [], pinned: true, z: 0, ...value }
    : value, NON_NEGATIVE_INTEGER);
}

function parseNoticeValue(value: unknown, revisionPattern: RegExp): Notice {
  if (
    !object(value) ||
    typeof value.id !== "string" ||
    !UUID.test(value.id) ||
    typeof value.title !== "string" ||
    typeof value.body !== "string" ||
    typeof value.color !== "string" ||
    !COLOR.test(value.color) ||
    !(value.image === null || typeof value.image === "string") ||
    typeof value.pinned !== "boolean" ||
    !finite(value.x) || !finite(value.y) || !finite(value.w) ||
    !finite(value.rotation) || !finite(value.z) ||
    !(value.authorPersonId === null || (typeof value.authorPersonId === "string" && UUID.test(value.authorPersonId))) ||
    typeof value.revision !== "string" ||
    !revisionPattern.test(value.revision) ||
    typeof value.createdAt !== "string" ||
    typeof value.updatedAt !== "string" ||
    typeof value.deleted !== "boolean"
  ) {
    throw new NoticeboardApiError("NOTICEBOARD_NOTICE_INVALID_RESPONSE", "A Noticeboard notice response is invalid.");
  }
  return Object.freeze({
    id: value.id,
    title: value.title,
    body: value.body,
    color: value.color.toLowerCase(),
    image: value.image,
    checklist: parseChecklist(value.checklist),
    pinned: value.pinned,
    x: value.x,
    y: value.y,
    w: value.w,
    rotation: value.rotation,
    z: value.z,
    authorPersonId: value.authorPersonId,
    revision: value.revision,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    deleted: value.deleted,
  });
}

function parseMutationResult(
  body: unknown,
  clientMutationId: string,
): HomiModuleMutationSubmissionResult {
  if (!object(body) || !object(body.data)) {
    throw new NoticeboardApiError("NOTICEBOARD_MUTATION_INVALID_RESPONSE", "The mutation response is invalid.");
  }
  const data = body.data;
  if (
    data.clientMutationId !== clientMutationId ||
    !["received", "applied", "conflict", "rejected"].includes(String(data.status)) ||
    !(data.serverRevision === null || (typeof data.serverRevision === "string" && POSITIVE_INTEGER.test(data.serverRevision))) ||
    !(data.changeSequence === null || (typeof data.changeSequence === "string" && NON_NEGATIVE_INTEGER.test(data.changeSequence))) ||
    !(data.errorCode === null || typeof data.errorCode === "string") ||
    typeof data.replayed !== "boolean"
  ) {
    throw new NoticeboardApiError("NOTICEBOARD_MUTATION_INVALID_RESPONSE", "The mutation response data is invalid.");
  }
  return Object.freeze({
    clientMutationId,
    status: data.status as HomiModuleMutationSubmissionResult["status"],
    serverRevision: data.serverRevision,
    changeSequence: data.changeSequence,
    errorCode: data.errorCode,
    serverState: data.serverState,
    replayed: data.replayed,
  });
}

async function submit(
  mutation: HomiModuleQueuedMutation,
  clientId: string,
  signal?: AbortSignal,
): Promise<HomiModuleMutationSubmissionResult> {
  if (
    mutation.moduleKey !== NOTICEBOARD_MODULE_KEY ||
    mutation.entityType !== "notice" ||
    !["create", "update", "delete"].includes(mutation.operation) ||
    !UUID.test(mutation.householdId) ||
    !UUID.test(mutation.entityId) ||
    !UUID.test(mutation.clientMutationId) ||
    !UUID.test(clientId) ||
    !NON_NEGATIVE_INTEGER.test(mutation.baseRevision)
  ) {
    throw new NoticeboardApiError("NOTICEBOARD_MUTATION_INVALID_INPUT", "The queued Noticeboard mutation is invalid.");
  }
  const response = await fetch("/api/v1/core/sync/mutations", {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "X-Homi-Household-ID": mutation.householdId,
      "X-Homi-Client-ID": clientId,
    },
    body: JSON.stringify({
      clientMutationId: mutation.clientMutationId,
      moduleKey: mutation.moduleKey,
      entityType: mutation.entityType,
      entityId: mutation.entityId,
      operation: mutation.operation,
      baseRevision: mutation.baseRevision,
      payload: mutation.payload,
    }),
    ...(signal ? { signal } : {}),
  });
  const body = await json(response);
  if (!response.ok) throw responseError(body, response.status);
  return parseMutationResult(body, mutation.clientMutationId);
}

async function fetchNotice(
  change: HomiModuleSyncChange,
  context: HomiModuleSyncHandlerContext,
  signal?: AbortSignal,
): Promise<Notice> {
  const response = await fetch(
    `/api/v1/modules/noticeboard/notices/${encodeURIComponent(change.entityId)}`,
    {
      credentials: "same-origin",
      headers: {
        "X-Homi-Household-ID": context.householdId,
        "X-Homi-Client-ID": context.clientId,
      },
      ...(signal ? { signal } : {}),
    },
  );
  const body = await json(response);
  if (!response.ok) throw responseError(body, response.status);
  if (!object(body) || !Object.hasOwn(body, "data")) {
    throw new NoticeboardApiError("NOTICEBOARD_NOTICE_INVALID_RESPONSE", "The Noticeboard notice response shape is invalid.");
  }
  const item = parseNotice(body.data);
  if (item.id !== change.entityId || BigInt(item.revision) < BigInt(change.revision)) {
    throw new NoticeboardApiError("NOTICEBOARD_NOTICE_STALE_RESPONSE", "The Noticeboard notice response is stale.");
  }
  return item;
}

export const noticeMutationAdapter: HomiModuleMutationAdapter =
  Object.freeze({
    moduleKey: NOTICEBOARD_MODULE_KEY,
    entityType: "notice",
    operations: Object.freeze(["create", "update", "delete"]),
    submit,
  });

export const noticeChangeHandler: HomiModuleSyncChangeHandler =
  Object.freeze({
    moduleKey: NOTICEBOARD_MODULE_KEY,
    entityType: "notice",
    async materialize(
      change: HomiModuleSyncChange,
      context: HomiModuleSyncHandlerContext,
      signal?: AbortSignal,
    ) {
      if (
        change.moduleKey !== NOTICEBOARD_MODULE_KEY ||
        change.entityType !== "notice" ||
        change.householdId !== context.householdId
      ) {
        throw new NoticeboardApiError("NOTICEBOARD_CHANGE_INVALID", "The Noticeboard sync change is invalid.");
      }
      if (change.operation === "delete") {
        return Object.freeze({
          kind: "delete" as const,
          moduleKey: NOTICEBOARD_MODULE_KEY,
          entityType: "notice",
          entityId: change.entityId,
          sequence: change.sequence,
        });
      }
      if (change.operation !== "create" && change.operation !== "update") {
        throw new NoticeboardApiError("NOTICEBOARD_CHANGE_INVALID", "The Noticeboard sync operation is invalid.");
      }
      const item = await fetchNotice(change, context, signal);
      if (item.deleted) return Object.freeze({
        kind: "delete" as const, moduleKey: NOTICEBOARD_MODULE_KEY,
        entityType: "notice", entityId: item.id, sequence: change.sequence,
      });
      return Object.freeze({
        kind: "put" as const,
        moduleKey: NOTICEBOARD_MODULE_KEY,
        entityType: "notice",
        entityId: item.id,
        revision: item.revision,
        sequence: change.sequence,
        data: item,
      });
    },
  });
