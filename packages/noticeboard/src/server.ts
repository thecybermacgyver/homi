import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  HOMI_MODULE_API_VERSION,
  defineHomiServerModule,
  type HomiModuleDatabase,
  type HomiModuleServerMutationInput,
  type HomiModuleServerMutationResult,
  type HomiRequestContext,
  type HomiServerModuleHostContext,
} from "@homi/module-sdk";
import { LIMITS, NOTICEBOARD_MODULE_KEY } from "./constants.js";
import type { ChecklistItem, Notice, NoticeContent, NoticePlacement } from "./types.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COLOR = /^#[0-9a-f]{6}$/i;
const CHECKLIST_ID = /^[A-Za-z0-9-]{1,40}$/;
const IMAGE = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/;

interface NoticeRow extends Record<string, unknown> {
  id: string;
  title: string;
  body: string;
  color: string;
  image: string | null;
  checklist: unknown;
  pinned: boolean;
  x: number;
  y: number;
  w: number;
  rotation: number;
  z: number;
  authorPersonId: string;
  revision: string;
  createdAt: string | Date;
  updatedAt: string | Date;
  deletedAt: string | Date | null;
}

function httpError(statusCode: number, code: string, message: string) {
  return Object.assign(new Error(message), { statusCode, code });
}

function iso(value: string | Date): string {
  return new Date(value).toISOString();
}

function checklistOf(value: unknown): readonly ChecklistItem[] {
  const list = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  return Array.isArray(list) ? (list as ChecklistItem[]) : [];
}

function state(row: NoticeRow, deleted = row.deletedAt !== null): Notice {
  return Object.freeze({
    id: row.id,
    title: row.title,
    body: row.body,
    color: row.color,
    image: row.image,
    checklist: checklistOf(row.checklist),
    pinned: row.pinned,
    x: row.x,
    y: row.y,
    w: row.w,
    rotation: row.rotation,
    z: row.z,
    authorPersonId: row.authorPersonId,
    revision: row.revision,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    deleted,
  });
}

function headers(request: FastifyRequest) {
  return request.headers as Record<string, string | string[] | undefined>;
}

async function contextFor(
  host: HomiServerModuleHostContext,
  request: FastifyRequest,
): Promise<HomiRequestContext> {
  const context = await host.resolveContext({ id: request.id, headers: headers(request) });
  await host.requireEnabled(NOTICEBOARD_MODULE_KEY, context);
  return context;
}

function invalid(message: string): never {
  throw httpError(400, "NOTICEBOARD_INPUT_INVALID", message);
}

function number(value: unknown, field: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    invalid(field + " is out of range.");
  }
  return value as number;
}

function parseContent(payload: Readonly<Record<string, unknown>>): NoticeContent {
  const title = typeof payload.title === "string" ? payload.title.trim() : "";
  if (title.length < 1 || title.length > LIMITS.title) invalid("title has an invalid length.");
  const body = typeof payload.body === "string" ? payload.body.trim() : null;
  if (body === null || body.length > LIMITS.body) invalid("body has an invalid length.");
  if (typeof payload.color !== "string" || !COLOR.test(payload.color)) invalid("color must be #rrggbb.");
  const image = payload.image;
  if (image !== null && (typeof image !== "string" || image.length > LIMITS.image || !IMAGE.test(image))) {
    invalid("image must be a small JPEG.");
  }
  return {
    title,
    body: body as string,
    color: (payload.color as string).toLowerCase(),
    image: image as string | null,
    checklist: parseChecklist(payload.checklist),
  };
}

function parseChecklist(value: unknown): readonly ChecklistItem[] {
  if (!Array.isArray(value) || value.length > LIMITS.checklistItems) invalid("checklist is invalid.");
  const seen = new Set<string>();
  return (value as unknown[]).map((entry) => {
    const item = entry as Record<string, unknown> | null;
    if (
      typeof item !== "object" || item === null ||
      Object.keys(item).length !== 3 ||
      typeof item.id !== "string" || !CHECKLIST_ID.test(item.id) || seen.has(item.id) ||
      typeof item.text !== "string" || typeof item.done !== "boolean"
    ) invalid("a checklist item is invalid.");
    const text = (item!.text as string).trim();
    if (text.length < 1 || text.length > LIMITS.checklistText) invalid("a checklist item has an invalid length.");
    seen.add(item!.id as string);
    return { id: item!.id as string, text, done: item!.done as boolean };
  });
}

function parsePlacement(payload: Readonly<Record<string, unknown>>): NoticePlacement {
  if (typeof payload.pinned !== "boolean") invalid("pinned must be true or false.");
  return {
    pinned: payload.pinned as boolean,
    x: number(payload.x, "x", 0, 1),
    y: number(payload.y, "y", 0, 1),
    w: number(payload.w, "w", 0.15, 0.9),
    rotation: number(payload.rotation, "rotation", -8, 8),
    z: Math.round(number(payload.z, "z", 0, 1_000_000)),
  };
}

const CONTENT_KEYS = ["title", "body", "color", "image", "checklist"];
const PLACEMENT_KEYS = ["pinned", "x", "y", "w", "rotation", "z"];

function hasExactly(payload: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  const own = Object.keys(payload);
  return own.length === keys.length && keys.every((key) => Object.hasOwn(payload, key));
}

const selection = `
  id::text AS id,
  title,
  body,
  color,
  image,
  checklist,
  pinned,
  pos_x AS x,
  pos_y AS y,
  width AS w,
  rotation,
  z,
  author_person_id::text AS "authorPersonId",
  revision::text AS revision,
  created_at AS "createdAt",
  updated_at AS "updatedAt",
  deleted_at AS "deletedAt"`;

async function findForUpdate(
  database: HomiModuleDatabase,
  householdId: string,
  entityId: string,
): Promise<NoticeRow | null> {
  const result = await database.query<NoticeRow>(
    `SELECT ${selection}
     FROM mod_noticeboard.notices
     WHERE household_id = $1::uuid AND id = $2::uuid
     FOR UPDATE`,
    [householdId, entityId],
  );
  return result.rows[0] ?? null;
}

async function applyNoticeMutation(
  context: HomiRequestContext,
  database: HomiModuleDatabase,
  input: HomiModuleServerMutationInput,
  host: HomiServerModuleHostContext,
): Promise<HomiModuleServerMutationResult> {
  if (!["create", "update", "delete"].includes(input.operation)) {
    return { status: "rejected", revision: null, errorCode: "NOTICEBOARD_OPERATION_UNSUPPORTED", serverState: null };
  }
  const current = await findForUpdate(database, context.householdId, input.entityId);

  if (input.operation === "create") {
    let content: NoticeContent;
    let placement: NoticePlacement;
    try {
      if (!hasExactly(input.payload, [...CONTENT_KEYS, ...PLACEMENT_KEYS])) invalid("payload keys");
      content = parseContent(input.payload);
      placement = parsePlacement(input.payload);
    } catch {
      return { status: "rejected", revision: null, errorCode: "NOTICEBOARD_CREATE_INVALID", serverState: null };
    }
    if (input.baseRevision !== "0" || current !== null) {
      return current
        ? { status: "conflict", revision: current.revision, errorCode: "REVISION_CONFLICT", serverState: state(current) }
        : { status: "rejected", revision: null, errorCode: "NOTICEBOARD_CREATE_INVALID", serverState: null };
    }
    const inserted = await database.query<NoticeRow>(
      `INSERT INTO mod_noticeboard.notices (
         id, household_id, title, body, color, image, checklist,
         pinned, pos_x, pos_y, width, rotation, z, author_person_id, revision
       ) VALUES (
         $1::uuid, $2::uuid, $3, $4, $5, $6, $7::jsonb,
         $8, $9, $10, $11, $12, $13, $14::uuid, 1
       ) RETURNING ${selection}`,
      [
        input.entityId, context.householdId, content.title, content.body, content.color,
        content.image, JSON.stringify(content.checklist), placement.pinned,
        placement.x, placement.y, placement.w, placement.rotation, placement.z,
        context.householdPersonId,
      ],
    );
    const row = inserted.rows[0];
    if (!row) throw new Error("Notice insert returned no row.");
    return { status: "applied", revision: row.revision, serverState: state(row, false) };
  }

  if (!current || current.deletedAt !== null) {
    return {
      status: "rejected",
      revision: current?.revision ?? null,
      errorCode: "NOTICEBOARD_NOTICE_NOT_FOUND",
      serverState: current ? state(current) : null,
    };
  }

  if (input.operation === "update") {
    // Three kinds of update. Moving, pinning and ticking list items are small
    // changes that must not clash with someone editing the text, so only a
    // content edit is checked against the revision the editor started from.
    if (hasExactly(input.payload, PLACEMENT_KEYS)) {
      let placement: NoticePlacement;
      try {
        placement = parsePlacement(input.payload);
      } catch {
        return { status: "rejected", revision: current.revision, errorCode: "NOTICEBOARD_UPDATE_INVALID", serverState: state(current) };
      }
      const updated = await database.query<NoticeRow>(
        `UPDATE mod_noticeboard.notices SET
           pinned = $3, pos_x = $4, pos_y = $5, width = $6, rotation = $7, z = $8,
           revision = revision + 1, updated_at = now()
         WHERE household_id = $1::uuid AND id = $2::uuid
         RETURNING ${selection}`,
        [context.householdId, input.entityId, placement.pinned, placement.x, placement.y,
          placement.w, placement.rotation, placement.z],
      );
      const row = updated.rows[0];
      if (!row) throw new Error("Notice placement update returned no row.");
      return { status: "applied", revision: row.revision, serverState: state(row, false) };
    }

    if (hasExactly(input.payload, ["checklist"])) {
      let sent: readonly ChecklistItem[];
      try {
        sent = parseChecklist(input.payload.checklist);
      } catch {
        return { status: "rejected", revision: current.revision, errorCode: "NOTICEBOARD_UPDATE_INVALID", serverState: state(current) };
      }
      // Apply ticks to the list the server holds, so two people ticking
      // different items at the same time both keep their change.
      const done = new Map(sent.map((item) => [item.id, item.done]));
      const merged = checklistOf(current.checklist).map((item) =>
        done.has(item.id) ? { ...item, done: done.get(item.id) as boolean } : item);
      const updated = await database.query<NoticeRow>(
        `UPDATE mod_noticeboard.notices SET
           checklist = $3::jsonb, revision = revision + 1, updated_at = now()
         WHERE household_id = $1::uuid AND id = $2::uuid
         RETURNING ${selection}`,
        [context.householdId, input.entityId, JSON.stringify(merged)],
      );
      const row = updated.rows[0];
      if (!row) throw new Error("Notice checklist update returned no row.");
      return { status: "applied", revision: row.revision, serverState: state(row, false) };
    }

    if (current.revision !== input.baseRevision) {
      return { status: "conflict", revision: current.revision, errorCode: "REVISION_CONFLICT", serverState: state(current) };
    }
    let content: NoticeContent;
    try {
      if (!hasExactly(input.payload, CONTENT_KEYS)) invalid("payload keys");
      content = parseContent(input.payload);
    } catch {
      return { status: "rejected", revision: current.revision, errorCode: "NOTICEBOARD_UPDATE_INVALID", serverState: state(current) };
    }
    const updated = await database.query<NoticeRow>(
      `UPDATE mod_noticeboard.notices SET
         title = $3, body = $4, color = $5, image = $6, checklist = $7::jsonb,
         revision = revision + 1, updated_at = now()
       WHERE household_id = $1::uuid AND id = $2::uuid
       RETURNING ${selection}`,
      [context.householdId, input.entityId, content.title, content.body, content.color,
        content.image, JSON.stringify(content.checklist)],
    );
    const row = updated.rows[0];
    if (!row) throw new Error("Notice update returned no row.");
    return { status: "applied", revision: row.revision, serverState: state(row, false) };
  }

  if (Object.keys(input.payload).length !== 0) {
    return { status: "rejected", revision: current.revision, errorCode: "NOTICEBOARD_DELETE_INVALID", serverState: state(current) };
  }
  // The author or a household administrator may delete a notice.
  const allowed =
    current.authorPersonId === context.householdPersonId ||
    (host.householdRoles ? await host.householdRoles.isAdministrator(context) : false);
  if (!allowed) {
    return { status: "rejected", revision: current.revision, errorCode: "NOTICEBOARD_DELETE_FORBIDDEN", serverState: state(current) };
  }
  const deleted = await database.query<NoticeRow>(
    `UPDATE mod_noticeboard.notices
     SET revision = revision + 1, deleted_at = now(), updated_at = now()
     WHERE household_id = $1::uuid AND id = $2::uuid
     RETURNING ${selection}`,
    [context.householdId, input.entityId],
  );
  const row = deleted.rows[0];
  if (!row) throw new Error("Notice delete returned no row.");
  return { status: "applied", revision: row.revision, serverState: state(row, true) };
}

export function createHomiServerModule(host: HomiServerModuleHostContext) {
  const database = host.moduleDatabase;
  return defineHomiServerModule({
    moduleKey: NOTICEBOARD_MODULE_KEY,
    moduleApiVersion: HOMI_MODULE_API_VERSION,

    register(app: FastifyInstance) {
      app.get("/api/v1/modules/noticeboard/health", async (request) => {
        await contextFor(host, request);
        return { data: { moduleKey: NOTICEBOARD_MODULE_KEY, status: "ok" } };
      });

      // Who is asking: the web page shows Delete only where the server would allow it.
      app.get("/api/v1/modules/noticeboard/me", async (request) => {
        const context = await contextFor(host, request);
        return {
          data: {
            personId: context.householdPersonId,
            administrator: host.householdRoles ? await host.householdRoles.isAdministrator(context) : false,
          },
        };
      });

      app.get("/api/v1/modules/noticeboard/notices", async (request) => {
        const context = await contextFor(host, request);
        const result = await database.query<NoticeRow>(
          `SELECT ${selection}
           FROM mod_noticeboard.notices
           WHERE household_id = $1::uuid AND deleted_at IS NULL
           ORDER BY created_at DESC, id`,
          [context.householdId],
        );
        return { data: result.rows.map((row) => state(row, false)) };
      });

      app.get("/api/v1/modules/noticeboard/notices/:noticeId", async (request) => {
        const context = await contextFor(host, request);
        const noticeId = (request.params as { noticeId?: unknown }).noticeId;
        if (typeof noticeId !== "string" || !UUID.test(noticeId)) {
          throw httpError(400, "NOTICEBOARD_NOTICE_ID_INVALID", "noticeId must be a UUID.");
        }
        const result = await database.query<NoticeRow>(
          `SELECT ${selection}
           FROM mod_noticeboard.notices
           WHERE household_id = $1::uuid AND id = $2::uuid
           LIMIT 1`,
          [context.householdId, noticeId],
        );
        const notice = result.rows[0];
        if (!notice) throw httpError(404, "NOTICEBOARD_NOTICE_NOT_FOUND", "The notice was not found.");
        return { data: state(notice) };
      });
    },

    sync: {
      mutationHandlers: [{
        entityType: "notice",
        operations: ["create", "update", "delete"],
        apply: (context, database, input) =>
          applyNoticeMutation(context, database, input, host),
      }],
    },
  });
}
