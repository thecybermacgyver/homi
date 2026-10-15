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
import { KISS_MODULE_KEY, LIMITS, PHASES, type EntityType, type Phase } from "./constants.js";
import { INTIMACY_IDEAS } from "./intimacydata.js";
import { DAILY_COUNT, QUIZZES } from "./quizdata.js";
import type { Answer, Checkin, DateStep, Me, Note, Partnership, PlannedDate, QuizItem, QuizResult, Swipe } from "./types.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const QUESTION_ID = /^[a-z0-9-]{1,40}$/;
const T = "mod_kiss";

// Everything in this module is private to the two partners. The change feed
// Core sends to other devices carries only an id, so every read below is
// filtered here, on the server, by who is asking.

function httpError(statusCode: number, code: string, message: string) {
  return Object.assign(new Error(message), { statusCode, code });
}
function iso(v: string | Date): string { return new Date(v).toISOString(); }
function day(v: string | Date): string {
  return typeof v === "string" ? v.slice(0, 10) : v.toISOString().slice(0, 10);
}
function headers(request: FastifyRequest) {
  return request.headers as Record<string, string | string[] | undefined>;
}

async function contextFor(host: HomiServerModuleHostContext, request: FastifyRequest): Promise<HomiRequestContext> {
  const context = await host.resolveContext({ id: request.id, headers: headers(request) });
  await host.requireEnabled(KISS_MODULE_KEY, context);
  return context;
}

interface PartnershipRow extends Record<string, unknown> {
  id: string; partnerA: string; partnerB: string; phase: Phase; startedOn: string | Date;
  revision: string; deletedAt: string | Date | null;
}
interface AnswerRow extends Record<string, unknown> {
  id: string; day: string | Date; questionId: string; body: string; resonance: number;
  authorPersonId: string; revision: string; deletedAt: string | Date | null;
}
interface CheckinRow extends Record<string, unknown> {
  id: string; day: string | Date; battery: number; desire: number; stress: number;
  authorPersonId: string; revision: string; deletedAt: string | Date | null;
}
interface NoteRow extends Record<string, unknown> {
  id: string; body: string; authorPersonId: string; recipientPersonId: string;
  readAt: string | Date | null; createdAt: string | Date; revision: string; deletedAt: string | Date | null;
}

const PARTNERSHIP_SELECT = `id::text AS id, partner_a::text AS "partnerA", partner_b::text AS "partnerB", phase,
  started_on::text AS "startedOn", revision::text AS revision, deleted_at AS "deletedAt"`;
const ANSWER_SELECT = `id::text AS id, day::text AS day, question_id AS "questionId", body, resonance::int AS resonance,
  author_person_id::text AS "authorPersonId", revision::text AS revision, deleted_at AS "deletedAt"`;
const CHECKIN_SELECT = `id::text AS id, day::text AS day, battery::int AS battery, desire::int AS desire, stress::int AS stress,
  author_person_id::text AS "authorPersonId", revision::text AS revision, deleted_at AS "deletedAt"`;
const NOTE_SELECT = `id::text AS id, body, author_person_id::text AS "authorPersonId",
  recipient_person_id::text AS "recipientPersonId", read_at AS "readAt", created_at AS "createdAt",
  revision::text AS revision, deleted_at AS "deletedAt"`;

const partnershipState = (r: PartnershipRow): Partnership => ({
  id: r.id, partnerA: r.partnerA, partnerB: r.partnerB, phase: r.phase, startedOn: day(r.startedOn), revision: r.revision,
});
const answerState = (r: AnswerRow): Answer => ({
  id: r.id, day: day(r.day), questionId: r.questionId, body: r.body, resonance: r.resonance,
  authorPersonId: r.authorPersonId, revision: r.revision,
});
const checkinState = (r: CheckinRow): Checkin => ({
  id: r.id, day: day(r.day), battery: r.battery, desire: r.desire, stress: r.stress,
  authorPersonId: r.authorPersonId, revision: r.revision,
});
const noteState = (r: NoteRow): Note => ({
  id: r.id, body: r.body, authorPersonId: r.authorPersonId, recipientPersonId: r.recipientPersonId,
  readAt: r.readAt === null ? null : iso(r.readAt), createdAt: iso(r.createdAt), revision: r.revision,
});

interface DateRow extends Record<string, unknown> {
  id: string; ideaId: string | null; title: string; scheduledFor: string | Date | null; checklist: unknown;
  done: boolean; authorPersonId: string; revision: string; deletedAt: string | Date | null;
}
interface QuizRow extends Record<string, unknown> {
  id: string; quizId: string; day: string | Date | null; answers: unknown; authorPersonId: string; revision: string; deletedAt: string | Date | null;
}
interface SwipeRow extends Record<string, unknown> {
  id: string; itemId: string; choice: "yes" | "no" | "maybe"; authorPersonId: string; revision: string;
  deletedAt: string | Date | null;
}

const DATE_SELECT = `id::text AS id, idea_id AS "ideaId", title, scheduled_for AS "scheduledFor", checklist, done,
  author_person_id::text AS "authorPersonId", revision::text AS revision, deleted_at AS "deletedAt"`;
const QUIZ_SELECT = `id::text AS id, quiz_id AS "quizId", day::text AS day, answers, author_person_id::text AS "authorPersonId",
  revision::text AS revision, deleted_at AS "deletedAt"`;
const SWIPE_SELECT = `id::text AS id, item_id AS "itemId", choice, author_person_id::text AS "authorPersonId",
  revision::text AS revision, deleted_at AS "deletedAt"`;

function jsonOf<T>(value: unknown, fallback: T): T {
  try {
    return (typeof value === "string" ? JSON.parse(value) : value) as T;
  } catch {
    return fallback;
  }
}
const dateState = (r: DateRow): PlannedDate => ({
  id: r.id, ideaId: r.ideaId, title: r.title, scheduledFor: r.scheduledFor === null ? null : iso(r.scheduledFor),
  checklist: jsonOf<DateStep[]>(r.checklist, []), done: r.done, authorPersonId: r.authorPersonId, revision: r.revision,
});
// Results saved before quizzes became daily held plain numbers; they carry no
// day and no items and are ignored by the page.
const quizState = (r: QuizRow): QuizResult => {
  const raw = jsonOf<unknown[]>(r.answers, []);
  const items = raw.filter((x): x is QuizItem =>
    typeof x === "object" && x !== null && typeof (x as QuizItem).id === "string" && typeof (x as QuizItem).v === "number");
  return {
    id: r.id, quizId: r.quizId, day: r.day === null ? null : day(r.day), items,
    authorPersonId: r.authorPersonId, revision: r.revision,
  };
};
const swipeState = (r: SwipeRow): Swipe => ({
  id: r.id, itemId: r.itemId, choice: r.choice, authorPersonId: r.authorPersonId, revision: r.revision,
});

async function activePartnership(database: HomiModuleDatabase, householdId: string, forUpdate = false) {
  const result = await database.query<PartnershipRow>(
    `SELECT ${PARTNERSHIP_SELECT} FROM ${T}.partnerships
     WHERE household_id = $1::uuid AND deleted_at IS NULL${forUpdate ? " FOR UPDATE" : ""}`,
    [householdId],
  );
  return result.rows[0] ?? null;
}

function partnerOf(p: PartnershipRow | null, personId: string): string | null {
  if (!p) return null;
  if (p.partnerA === personId) return p.partnerB;
  if (p.partnerB === personId) return p.partnerA;
  return null;
}

async function isAdmin(host: HomiServerModuleHostContext, context: HomiRequestContext) {
  return host.householdRoles ? host.householdRoles.isAdministrator(context) : false;
}

// The day's two answers are visible to both partners only when both exist.
async function visibleAnswers(
  database: HomiModuleDatabase, context: HomiRequestContext, p: PartnershipRow | null,
): Promise<Answer[]> {
  const partner = partnerOf(p, context.householdPersonId);
  if (!p || !partner) return [];
  const result = await database.query<AnswerRow>(
    `SELECT ${ANSWER_SELECT} FROM ${T}.answers a
     WHERE household_id = $1::uuid AND deleted_at IS NULL
       AND author_person_id IN ($2::uuid, $3::uuid)
       AND (author_person_id = $2::uuid OR EXISTS (
         SELECT 1 FROM ${T}.answers mine
         WHERE mine.household_id = a.household_id AND mine.day = a.day
           AND mine.author_person_id = $2::uuid AND mine.deleted_at IS NULL))
     ORDER BY day DESC, author_person_id`,
    [context.householdId, context.householdPersonId, partner],
  );
  return result.rows.map(answerState);
}

async function visibleCheckins(database: HomiModuleDatabase, context: HomiRequestContext, p: PartnershipRow | null) {
  const partner = partnerOf(p, context.householdPersonId);
  if (!p || !partner) return [];
  const result = await database.query<CheckinRow>(
    `SELECT ${CHECKIN_SELECT} FROM ${T}.checkins
     WHERE household_id = $1::uuid AND deleted_at IS NULL AND author_person_id IN ($2::uuid, $3::uuid)
     ORDER BY day DESC LIMIT 800`,
    [context.householdId, context.householdPersonId, partner],
  );
  return result.rows.map(checkinState);
}

async function visibleNotes(database: HomiModuleDatabase, context: HomiRequestContext, p: PartnershipRow | null) {
  if (!p || partnerOf(p, context.householdPersonId) === null) return [];
  const result = await database.query<NoteRow>(
    `SELECT ${NOTE_SELECT} FROM ${T}.notes
     WHERE household_id = $1::uuid AND deleted_at IS NULL
       AND (author_person_id = $2::uuid OR recipient_person_id = $2::uuid)
     ORDER BY created_at DESC LIMIT 200`,
    [context.householdId, context.householdPersonId],
  );
  return result.rows.map(noteState);
}

async function visibleDates(database: HomiModuleDatabase, context: HomiRequestContext, p: PartnershipRow | null) {
  if (!p || partnerOf(p, context.householdPersonId) === null) return [];
  const result = await database.query<DateRow>(
    `SELECT ${DATE_SELECT} FROM ${T}.dates WHERE household_id = $1::uuid AND deleted_at IS NULL
     ORDER BY created_at DESC LIMIT 200`,
    [context.householdId],
  );
  return result.rows.map(dateState);
}

// A partner's quiz answers for a day open only after you have answered the
// same day's quiz.
async function visibleQuizzes(database: HomiModuleDatabase, context: HomiRequestContext, p: PartnershipRow | null) {
  const partner = partnerOf(p, context.householdPersonId);
  if (!p || !partner) return [];
  const result = await database.query<QuizRow>(
    `SELECT ${QUIZ_SELECT} FROM ${T}.quiz_results q
     WHERE household_id = $1::uuid AND deleted_at IS NULL AND author_person_id IN ($2::uuid, $3::uuid)
       AND (author_person_id = $2::uuid OR (q.day IS NOT NULL AND EXISTS (
         SELECT 1 FROM ${T}.quiz_results mine
         WHERE mine.household_id = q.household_id AND mine.day = q.day
           AND mine.author_person_id = $2::uuid AND mine.deleted_at IS NULL)))
     ORDER BY day DESC NULLS LAST LIMIT 800`,
    [context.householdId, context.householdPersonId, partner],
  );
  return result.rows.map(quizState);
}

// Your own choices, and your partner's only where you BOTH said yes. A "no",
// a "maybe" or no answer from them is never revealed.
async function visibleSwipes(database: HomiModuleDatabase, context: HomiRequestContext, p: PartnershipRow | null) {
  const partner = partnerOf(p, context.householdPersonId);
  if (!p || !partner) return [];
  const result = await database.query<SwipeRow>(
    `SELECT ${SWIPE_SELECT} FROM ${T}.swipes s
     WHERE household_id = $1::uuid AND deleted_at IS NULL
       AND (author_person_id = $2::uuid OR (
         author_person_id = $3::uuid AND choice = 'yes' AND EXISTS (
           SELECT 1 FROM ${T}.swipes mine
           WHERE mine.household_id = s.household_id AND mine.item_id = s.item_id
             AND mine.author_person_id = $2::uuid AND mine.choice = 'yes' AND mine.deleted_at IS NULL)))`,
    [context.householdId, context.householdPersonId, partner],
  );
  return result.rows.map(swipeState);
}

// ---- mutations ----------------------------------------------------------

type Result = HomiModuleServerMutationResult;
const rejected = (code: string, state: unknown = null, revision: string | null = null): Result =>
  ({ status: "rejected", revision, errorCode: code, serverState: state });
const conflict = (revision: string, state: unknown): Result =>
  ({ status: "conflict", revision, errorCode: "REVISION_CONFLICT", serverState: state });
const applied = (revision: string, state: unknown): Result => ({ status: "applied", revision, serverState: state });

function exactly(payload: Readonly<Record<string, unknown>>, keys: readonly string[]) {
  const own = Object.keys(payload);
  return own.length === keys.length && keys.every((k) => Object.hasOwn(payload, k));
}
function int(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : null;
}
function validDay(value: unknown): value is string {
  if (typeof value !== "string" || !DAY.test(value)) return false;
  const t = Date.parse(value + "T00:00:00Z");
  if (Number.isNaN(t)) return false;
  // Tolerates time zones and offline entry, but not far-future days.
  return t <= Date.now() + 2 * 86_400_000 && t >= Date.now() - 400 * 86_400_000;
}

async function applyPartnership(
  host: HomiServerModuleHostContext, context: HomiRequestContext, db: HomiModuleDatabase,
  input: HomiModuleServerMutationInput,
): Promise<Result> {
  if (!(await isAdmin(host, context))) return rejected("KISS_ADMIN_ONLY");
  const current = await activePartnership(db, context.householdId, true);
  if (input.operation === "delete") {
    if (!current || current.id !== input.entityId) return rejected("KISS_NOT_FOUND");
    await db.query(
      `UPDATE ${T}.partnerships SET deleted_at = now(), updated_at = now(), revision = revision + 1
       WHERE household_id = $1::uuid AND id = $2::uuid`,
      [context.householdId, current.id],
    );
    return applied(String(BigInt(current.revision) + 1n), { ...partnershipState(current) });
  }
  const p = input.payload;
  if (!exactly(p, ["partnerA", "partnerB", "phase", "startedOn"])) return rejected("KISS_PARTNERSHIP_INVALID");
  const { partnerA, partnerB, phase, startedOn } = p as Record<string, unknown>;
  if (
    typeof partnerA !== "string" || typeof partnerB !== "string" || !UUID.test(partnerA) || !UUID.test(partnerB) ||
    partnerA === partnerB || !PHASES.includes(phase as Phase) || typeof startedOn !== "string" || !DAY.test(startedOn) ||
    Number.isNaN(Date.parse(startedOn + "T00:00:00Z"))
  ) return rejected("KISS_PARTNERSHIP_INVALID");
  const people = host.householdPeople ? await host.householdPeople.listActive(context) : [];
  const ids = new Set(people.map((x) => x.id));
  if (!ids.has(partnerA) || !ids.has(partnerB)) return rejected("KISS_PARTNER_UNKNOWN");

  if (input.operation === "create") {
    if (input.baseRevision !== "0") return rejected("KISS_PARTNERSHIP_INVALID");
    if (current) {
      // The same pairing sent again (a double tap, a retry) is not a conflict.
      const same = current.id === input.entityId && current.partnerA === partnerA && current.partnerB === partnerB &&
        current.phase === phase && day(current.startedOn) === startedOn;
      return same ? applied(current.revision, partnershipState(current)) : conflict(current.revision, partnershipState(current));
    }
    const inserted = await db.query<PartnershipRow>(
      `INSERT INTO ${T}.partnerships (id, household_id, partner_a, partner_b, phase, started_on, revision)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6::date, 1) RETURNING ${PARTNERSHIP_SELECT}`,
      [input.entityId, context.householdId, partnerA, partnerB, phase, startedOn],
    );
    const row = inserted.rows[0];
    if (!row) throw new Error("Partnership insert returned no row.");
    return applied(row.revision, partnershipState(row));
  }
  if (!current || current.id !== input.entityId) return rejected("KISS_NOT_FOUND");
  if (current.revision !== input.baseRevision) return conflict(current.revision, partnershipState(current));
  const updated = await db.query<PartnershipRow>(
    `UPDATE ${T}.partnerships SET partner_a = $3::uuid, partner_b = $4::uuid, phase = $5, started_on = $6::date,
       revision = revision + 1, updated_at = now()
     WHERE household_id = $1::uuid AND id = $2::uuid RETURNING ${PARTNERSHIP_SELECT}`,
    [context.householdId, current.id, partnerA, partnerB, phase, startedOn],
  );
  const row = updated.rows[0];
  if (!row) throw new Error("Partnership update returned no row.");
  return applied(row.revision, partnershipState(row));
}

async function applyAnswer(
  context: HomiRequestContext, db: HomiModuleDatabase, input: HomiModuleServerMutationInput,
): Promise<Result> {
  const p = await activePartnership(db, context.householdId);
  const partner = partnerOf(p, context.householdPersonId);
  if (!p || !partner) return rejected("KISS_NOT_PARTNER");
  const found = await db.query<AnswerRow>(
    `SELECT ${ANSWER_SELECT} FROM ${T}.answers WHERE household_id = $1::uuid AND id = $2::uuid FOR UPDATE`,
    [context.householdId, input.entityId],
  );
  const current = found.rows[0] ?? null;
  if (current && current.authorPersonId !== context.householdPersonId) return rejected("KISS_NOT_FOUND");

  if (input.operation === "create") {
    const body = input.payload;
    const text = typeof body.body === "string" ? body.body.trim() : "";
    const resonance = int(body.resonance, 1, 5);
    if (
      !exactly(body, ["day", "questionId", "body", "resonance"]) || !validDay(body.day) ||
      typeof body.questionId !== "string" || !QUESTION_ID.test(body.questionId) ||
      text.length < 1 || text.length > LIMITS.answer || resonance === null || input.baseRevision !== "0"
    ) return rejected("KISS_ANSWER_INVALID");
    const existing = await db.query<AnswerRow>(
      `SELECT ${ANSWER_SELECT} FROM ${T}.answers
       WHERE household_id = $1::uuid AND author_person_id = $2::uuid AND day = $3::date AND deleted_at IS NULL`,
      [context.householdId, context.householdPersonId, body.day],
    );
    if (current || existing.rows[0]) {
      const row = (current ?? existing.rows[0]) as AnswerRow;
      const same = row.id === input.entityId && row.body === text && row.resonance === resonance;
      return same ? applied(row.revision, answerState(row)) : conflict(row.revision, answerState(row));
    }
    const inserted = await db.query<AnswerRow>(
      `INSERT INTO ${T}.answers (id, household_id, day, question_id, body, resonance, author_person_id, revision)
       VALUES ($1::uuid, $2::uuid, $3::date, $4, $5, $6, $7::uuid, 1) RETURNING ${ANSWER_SELECT}`,
      [input.entityId, context.householdId, body.day, body.questionId, text, resonance, context.householdPersonId],
    );
    const row = inserted.rows[0];
    if (!row) throw new Error("Answer insert returned no row.");
    return applied(row.revision, answerState(row));
  }

  if (!current || current.deletedAt !== null) return rejected("KISS_NOT_FOUND");
  // Once the partner has answered, both answers are open and fixed.
  const partnerAnswered = await db.query(
    `SELECT 1 FROM ${T}.answers
     WHERE household_id = $1::uuid AND author_person_id = $2::uuid AND day = $3::date AND deleted_at IS NULL`,
    [context.householdId, partner, current.day],
  );
  if (partnerAnswered.rows.length > 0) return rejected("KISS_ANSWER_LOCKED", answerState(current), current.revision);

  if (input.operation === "delete") {
    if (Object.keys(input.payload).length !== 0) return rejected("KISS_ANSWER_INVALID", answerState(current), current.revision);
    await db.query(
      `UPDATE ${T}.answers SET deleted_at = now(), updated_at = now(), revision = revision + 1
       WHERE household_id = $1::uuid AND id = $2::uuid`,
      [context.householdId, current.id],
    );
    return applied(String(BigInt(current.revision) + 1n), { ...answerState(current) });
  }
  if (input.operation !== "update") return rejected("KISS_OPERATION_UNSUPPORTED");
  const text = typeof input.payload.body === "string" ? input.payload.body.trim() : "";
  const resonance = int(input.payload.resonance, 1, 5);
  if (!exactly(input.payload, ["body", "resonance"]) || text.length < 1 || text.length > LIMITS.answer || resonance === null) {
    return rejected("KISS_ANSWER_INVALID", answerState(current), current.revision);
  }
  if (current.revision !== input.baseRevision) return conflict(current.revision, answerState(current));
  const updated = await db.query<AnswerRow>(
    `UPDATE ${T}.answers SET body = $3, resonance = $4, revision = revision + 1, updated_at = now()
     WHERE household_id = $1::uuid AND id = $2::uuid RETURNING ${ANSWER_SELECT}`,
    [context.householdId, current.id, text, resonance],
  );
  const row = updated.rows[0];
  if (!row) throw new Error("Answer update returned no row.");
  return applied(row.revision, answerState(row));
}

async function applyCheckin(
  context: HomiRequestContext, db: HomiModuleDatabase, input: HomiModuleServerMutationInput,
): Promise<Result> {
  const p = await activePartnership(db, context.householdId);
  if (!p || partnerOf(p, context.householdPersonId) === null) return rejected("KISS_NOT_PARTNER");
  const found = await db.query<CheckinRow>(
    `SELECT ${CHECKIN_SELECT} FROM ${T}.checkins WHERE household_id = $1::uuid AND id = $2::uuid FOR UPDATE`,
    [context.householdId, input.entityId],
  );
  const current = found.rows[0] ?? null;
  if (current && current.authorPersonId !== context.householdPersonId) return rejected("KISS_NOT_FOUND");
  const body = input.payload;
  const levels = [int(body.battery, 0, 100), int(body.desire, 0, 100), int(body.stress, 0, 100)];
  if (levels.some((v) => v === null)) return rejected("KISS_CHECKIN_INVALID", current && checkinState(current));
  const [battery, desire, stress] = levels as number[];

  if (input.operation === "create") {
    if (!exactly(body, ["day", "battery", "desire", "stress"]) || !validDay(body.day) || input.baseRevision !== "0") {
      return rejected("KISS_CHECKIN_INVALID");
    }
    const existing = await db.query<CheckinRow>(
      `SELECT ${CHECKIN_SELECT} FROM ${T}.checkins
       WHERE household_id = $1::uuid AND author_person_id = $2::uuid AND day = $3::date AND deleted_at IS NULL`,
      [context.householdId, context.householdPersonId, body.day],
    );
    if (current || existing.rows[0]) {
      const row = (current ?? existing.rows[0]) as CheckinRow;
      const same = row.id === input.entityId && row.battery === battery && row.desire === desire && row.stress === stress;
      return same ? applied(row.revision, checkinState(row)) : conflict(row.revision, checkinState(row));
    }
    const inserted = await db.query<CheckinRow>(
      `INSERT INTO ${T}.checkins (id, household_id, day, battery, desire, stress, author_person_id, revision)
       VALUES ($1::uuid, $2::uuid, $3::date, $4, $5, $6, $7::uuid, 1) RETURNING ${CHECKIN_SELECT}`,
      [input.entityId, context.householdId, body.day, battery, desire, stress, context.householdPersonId],
    );
    const row = inserted.rows[0];
    if (!row) throw new Error("Check-in insert returned no row.");
    return applied(row.revision, checkinState(row));
  }
  if (input.operation !== "update") return rejected("KISS_OPERATION_UNSUPPORTED");
  if (!current || current.deletedAt !== null) return rejected("KISS_NOT_FOUND");
  if (!exactly(body, ["battery", "desire", "stress"])) return rejected("KISS_CHECKIN_INVALID", checkinState(current), current.revision);
  // A check-in is a feeling at a moment: the latest one simply wins.
  const updated = await db.query<CheckinRow>(
    `UPDATE ${T}.checkins SET battery = $3, desire = $4, stress = $5, revision = revision + 1, updated_at = now()
     WHERE household_id = $1::uuid AND id = $2::uuid RETURNING ${CHECKIN_SELECT}`,
    [context.householdId, current.id, battery, desire, stress],
  );
  const row = updated.rows[0];
  if (!row) throw new Error("Check-in update returned no row.");
  return applied(row.revision, checkinState(row));
}

async function applyNote(
  context: HomiRequestContext, db: HomiModuleDatabase, input: HomiModuleServerMutationInput,
): Promise<Result> {
  const p = await activePartnership(db, context.householdId);
  const partner = partnerOf(p, context.householdPersonId);
  if (!p || !partner) return rejected("KISS_NOT_PARTNER");
  const found = await db.query<NoteRow>(
    `SELECT ${NOTE_SELECT} FROM ${T}.notes WHERE household_id = $1::uuid AND id = $2::uuid FOR UPDATE`,
    [context.householdId, input.entityId],
  );
  const current = found.rows[0] ?? null;
  const involved = current !== null &&
    (current.authorPersonId === context.householdPersonId || current.recipientPersonId === context.householdPersonId);
  if (current && !involved) return rejected("KISS_NOT_FOUND");

  if (input.operation === "create") {
    const text = typeof input.payload.body === "string" ? input.payload.body.trim() : "";
    if (!exactly(input.payload, ["body"]) || text.length < 1 || text.length > LIMITS.note || input.baseRevision !== "0") {
      return rejected("KISS_NOTE_INVALID");
    }
    if (current) {
      return current.body === text ? applied(current.revision, noteState(current)) : conflict(current.revision, noteState(current));
    }
    const inserted = await db.query<NoteRow>(
      `INSERT INTO ${T}.notes (id, household_id, body, author_person_id, recipient_person_id, revision)
       VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5::uuid, 1) RETURNING ${NOTE_SELECT}`,
      [input.entityId, context.householdId, text, context.householdPersonId, partner],
    );
    const row = inserted.rows[0];
    if (!row) throw new Error("Note insert returned no row.");
    return applied(row.revision, noteState(row));
  }
  if (!current || current.deletedAt !== null) return rejected("KISS_NOT_FOUND");
  if (input.operation === "delete") {
    if (current.authorPersonId !== context.householdPersonId) return rejected("KISS_NOTE_FORBIDDEN", noteState(current), current.revision);
    await db.query(
      `UPDATE ${T}.notes SET deleted_at = now(), updated_at = now(), revision = revision + 1
       WHERE household_id = $1::uuid AND id = $2::uuid`,
      [context.householdId, current.id],
    );
    return applied(String(BigInt(current.revision) + 1n), { ...noteState(current) });
  }
  if (input.operation !== "update") return rejected("KISS_OPERATION_UNSUPPORTED");
  // Only the recipient changes a note, and only to mark it read.
  if (!exactly(input.payload, ["read"]) || input.payload.read !== true || current.recipientPersonId !== context.householdPersonId) {
    return rejected("KISS_NOTE_FORBIDDEN", noteState(current), current.revision);
  }
  const updated = await db.query<NoteRow>(
    `UPDATE ${T}.notes SET read_at = COALESCE(read_at, now()), revision = revision + 1, updated_at = now()
     WHERE household_id = $1::uuid AND id = $2::uuid RETURNING ${NOTE_SELECT}`,
    [context.householdId, current.id],
  );
  const row = updated.rows[0];
  if (!row) throw new Error("Note update returned no row.");
  return applied(row.revision, noteState(row));
}

async function applyDate(
  context: HomiRequestContext, db: HomiModuleDatabase, input: HomiModuleServerMutationInput,
): Promise<Result> {
  const p = await activePartnership(db, context.householdId);
  if (!p || partnerOf(p, context.householdPersonId) === null) return rejected("KISS_NOT_PARTNER");
  const found = await db.query<DateRow>(
    `SELECT ${DATE_SELECT} FROM ${T}.dates WHERE household_id = $1::uuid AND id = $2::uuid FOR UPDATE`,
    [context.householdId, input.entityId],
  );
  const current = found.rows[0] ?? null;
  const parseSteps = (value: unknown): DateStep[] | null => {
    if (!Array.isArray(value) || value.length > LIMITS.steps) return null;
    const seen = new Set<string>();
    const out: DateStep[] = [];
    for (const raw of value as unknown[]) {
      const item = raw as Record<string, unknown> | null;
      if (
        typeof item !== "object" || item === null || Object.keys(item).length !== 3 ||
        typeof item.id !== "string" || !/^[A-Za-z0-9-]{1,40}$/.test(item.id) || seen.has(item.id) ||
        typeof item.text !== "string" || typeof item.done !== "boolean"
      ) return null;
      const text = item.text.trim();
      if (text.length < 1 || text.length > LIMITS.step) return null;
      seen.add(item.id);
      out.push({ id: item.id, text, done: item.done });
    }
    return out;
  };
  const when = (v: unknown): string | null | undefined => {
    if (v === null) return null;
    if (typeof v !== "string" || Number.isNaN(Date.parse(v))) return undefined;
    return new Date(v).toISOString();
  };
  const body = input.payload;
  const FULL = ["ideaId", "title", "scheduledFor", "checklist", "done"];

  if (input.operation === "create") {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const steps = parseSteps(body.checklist);
    const at = when(body.scheduledFor);
    const idea = body.ideaId;
    if (
      !exactly(body, FULL) || title.length < 1 || title.length > LIMITS.title || steps === null || at === undefined ||
      !(idea === null || (typeof idea === "string" && /^[a-z0-9-]{1,40}$/.test(idea))) || body.done !== false ||
      input.baseRevision !== "0"
    ) return rejected("KISS_DATE_INVALID");
    if (current) {
      return current.title === title ? applied(current.revision, dateState(current)) : conflict(current.revision, dateState(current));
    }
    const inserted = await db.query<DateRow>(
      `INSERT INTO ${T}.dates (id, household_id, idea_id, title, scheduled_for, checklist, done, author_person_id, revision)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5::timestamptz, $6::jsonb, false, $7::uuid, 1) RETURNING ${DATE_SELECT}`,
      [input.entityId, context.householdId, idea, title, at, JSON.stringify(steps), context.householdPersonId],
    );
    const row = inserted.rows[0];
    if (!row) throw new Error("Date insert returned no row.");
    return applied(row.revision, dateState(row));
  }
  if (!current || current.deletedAt !== null) return rejected("KISS_NOT_FOUND");

  if (input.operation === "delete") {
    if (Object.keys(body).length !== 0) return rejected("KISS_DATE_INVALID", dateState(current), current.revision);
    await db.query(
      `UPDATE ${T}.dates SET deleted_at = now(), updated_at = now(), revision = revision + 1
       WHERE household_id = $1::uuid AND id = $2::uuid`,
      [context.householdId, current.id],
    );
    return applied(String(BigInt(current.revision) + 1n), { ...dateState(current) });
  }
  if (input.operation !== "update") return rejected("KISS_OPERATION_UNSUPPORTED");

  // Ticking steps and marking done are small changes that must never clash
  // with the other partner's edits, so they merge into the stored list.
  if (exactly(body, ["ticks"])) {
    const ticks = body.ticks as Record<string, unknown> | null;
    if (typeof ticks !== "object" || ticks === null || Object.values(ticks).some((v) => typeof v !== "boolean")) {
      return rejected("KISS_DATE_INVALID", dateState(current), current.revision);
    }
    const merged = jsonOf<DateStep[]>(current.checklist, []).map((x) =>
      typeof ticks[x.id] === "boolean" ? { ...x, done: ticks[x.id] as boolean } : x);
    const updated = await db.query<DateRow>(
      `UPDATE ${T}.dates SET checklist = $3::jsonb, revision = revision + 1, updated_at = now()
       WHERE household_id = $1::uuid AND id = $2::uuid RETURNING ${DATE_SELECT}`,
      [context.householdId, current.id, JSON.stringify(merged)],
    );
    const row = updated.rows[0];
    if (!row) throw new Error("Date tick returned no row.");
    return applied(row.revision, dateState(row));
  }
  if (exactly(body, ["done"]) && typeof body.done === "boolean") {
    const updated = await db.query<DateRow>(
      `UPDATE ${T}.dates SET done = $3, revision = revision + 1, updated_at = now()
       WHERE household_id = $1::uuid AND id = $2::uuid RETURNING ${DATE_SELECT}`,
      [context.householdId, current.id, body.done],
    );
    const row = updated.rows[0];
    if (!row) throw new Error("Date done update returned no row.");
    return applied(row.revision, dateState(row));
  }
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const steps = parseSteps(body.checklist);
  const at = when(body.scheduledFor);
  if (!exactly(body, ["title", "scheduledFor", "checklist"]) || title.length < 1 || title.length > LIMITS.title ||
      steps === null || at === undefined) {
    return rejected("KISS_DATE_INVALID", dateState(current), current.revision);
  }
  if (current.revision !== input.baseRevision) return conflict(current.revision, dateState(current));
  const updated = await db.query<DateRow>(
    `UPDATE ${T}.dates SET title = $3, scheduled_for = $4::timestamptz, checklist = $5::jsonb,
       revision = revision + 1, updated_at = now()
     WHERE household_id = $1::uuid AND id = $2::uuid RETURNING ${DATE_SELECT}`,
    [context.householdId, current.id, title, at, JSON.stringify(steps)],
  );
  const row = updated.rows[0];
  if (!row) throw new Error("Date update returned no row.");
  return applied(row.revision, dateState(row));
}

async function applyQuiz(
  context: HomiRequestContext, db: HomiModuleDatabase, input: HomiModuleServerMutationInput,
): Promise<Result> {
  const p = await activePartnership(db, context.householdId);
  const partner = partnerOf(p, context.householdPersonId);
  if (!p || !partner) return rejected("KISS_NOT_PARTNER");
  const found = await db.query<QuizRow>(
    `SELECT ${QUIZ_SELECT} FROM ${T}.quiz_results WHERE household_id = $1::uuid AND id = $2::uuid FOR UPDATE`,
    [context.householdId, input.entityId],
  );
  const current = found.rows[0] ?? null;
  if (current && current.authorPersonId !== context.householdPersonId) return rejected("KISS_NOT_FOUND");

  // Every item must be a statement of that quiz, each once, DAILY_COUNT of them.
  const validItems = (quizId: string, items: unknown): QuizItem[] | null => {
    const quiz = QUIZZES.find((q) => q.id === quizId);
    if (!quiz || !Array.isArray(items) || items.length !== DAILY_COUNT) return null;
    const seen = new Set<string>();
    const out: QuizItem[] = [];
    for (const raw of items as unknown[]) {
      const item = raw as Record<string, unknown> | null;
      if (
        typeof item !== "object" || item === null || Object.keys(item).length !== 2 ||
        typeof item.id !== "string" || !quiz.statements.some((s) => s.id === item.id) || seen.has(item.id) ||
        !Number.isInteger(item.v) || (item.v as number) < 1 || (item.v as number) > 5
      ) return null;
      seen.add(item.id);
      out.push({ id: item.id, v: item.v as number });
    }
    return out;
  };

  if (input.operation === "create") {
    const body = input.payload;
    const quizId = body.quizId;
    const items = typeof quizId === "string" ? validItems(quizId, body.items) : null;
    if (!exactly(body, ["quizId", "day", "items"]) || items === null || !validDay(body.day) || input.baseRevision !== "0") {
      return rejected("KISS_QUIZ_INVALID");
    }
    const existing = await db.query<QuizRow>(
      `SELECT ${QUIZ_SELECT} FROM ${T}.quiz_results
       WHERE household_id = $1::uuid AND author_person_id = $2::uuid AND day = $3::date AND deleted_at IS NULL`,
      [context.householdId, context.householdPersonId, body.day],
    );
    if (current || existing.rows[0]) {
      const row = (current ?? existing.rows[0]) as QuizRow;
      const same = row.id === input.entityId && JSON.stringify(jsonOf<unknown[]>(row.answers, [])) === JSON.stringify(items);
      return same ? applied(row.revision, quizState(row)) : conflict(row.revision, quizState(row));
    }
    const inserted = await db.query<QuizRow>(
      `INSERT INTO ${T}.quiz_results (id, household_id, quiz_id, day, answers, author_person_id, revision)
       VALUES ($1::uuid, $2::uuid, $3, $4::date, $5::jsonb, $6::uuid, 1) RETURNING ${QUIZ_SELECT}`,
      [input.entityId, context.householdId, quizId, body.day, JSON.stringify(items), context.householdPersonId],
    );
    const row = inserted.rows[0];
    if (!row) throw new Error("Quiz insert returned no row.");
    return applied(row.revision, quizState(row));
  }
  if (input.operation !== "update") return rejected("KISS_OPERATION_UNSUPPORTED");
  if (!current || current.deletedAt !== null || current.day === null) return rejected("KISS_NOT_FOUND");
  const items = validItems(current.quizId, input.payload.items);
  if (!exactly(input.payload, ["items"]) || items === null) return rejected("KISS_QUIZ_INVALID", quizState(current), current.revision);
  const partnerDone = await db.query(
    `SELECT 1 FROM ${T}.quiz_results
     WHERE household_id = $1::uuid AND author_person_id = $2::uuid AND day = $3::date AND deleted_at IS NULL`,
    [context.householdId, partner, day(current.day)],
  );
  if (partnerDone.rows.length > 0) return rejected("KISS_QUIZ_LOCKED", quizState(current), current.revision);
  if (current.revision !== input.baseRevision) return conflict(current.revision, quizState(current));
  const updated = await db.query<QuizRow>(
    `UPDATE ${T}.quiz_results SET answers = $3::jsonb, revision = revision + 1, updated_at = now()
     WHERE household_id = $1::uuid AND id = $2::uuid RETURNING ${QUIZ_SELECT}`,
    [context.householdId, current.id, JSON.stringify(items)],
  );
  const row = updated.rows[0];
  if (!row) throw new Error("Quiz update returned no row.");
  return applied(row.revision, quizState(row));
}

const CHOICES = ["yes", "no", "maybe"];
const IDEA_IDS = new Set(INTIMACY_IDEAS.map((i) => i.id));

async function applySwipe(
  context: HomiRequestContext, db: HomiModuleDatabase, input: HomiModuleServerMutationInput,
): Promise<Result> {
  const p = await activePartnership(db, context.householdId);
  if (!p || partnerOf(p, context.householdPersonId) === null) return rejected("KISS_NOT_PARTNER");
  const found = await db.query<SwipeRow>(
    `SELECT ${SWIPE_SELECT} FROM ${T}.swipes WHERE household_id = $1::uuid AND id = $2::uuid FOR UPDATE`,
    [context.householdId, input.entityId],
  );
  const current = found.rows[0] ?? null;
  if (current && current.authorPersonId !== context.householdPersonId) return rejected("KISS_NOT_FOUND");
  const choice = input.payload.choice;
  if (typeof choice !== "string" || !CHOICES.includes(choice)) return rejected("KISS_SWIPE_INVALID");

  if (input.operation === "create") {
    const itemId = input.payload.itemId;
    if (!exactly(input.payload, ["itemId", "choice"]) || typeof itemId !== "string" || !IDEA_IDS.has(itemId) ||
        input.baseRevision !== "0") return rejected("KISS_SWIPE_INVALID");
    const existing = await db.query<SwipeRow>(
      `SELECT ${SWIPE_SELECT} FROM ${T}.swipes
       WHERE household_id = $1::uuid AND author_person_id = $2::uuid AND item_id = $3 AND deleted_at IS NULL`,
      [context.householdId, context.householdPersonId, itemId],
    );
    if (current || existing.rows[0]) {
      const row = (current ?? existing.rows[0]) as SwipeRow;
      return row.id === input.entityId && row.choice === choice ? applied(row.revision, swipeState(row)) : conflict(row.revision, swipeState(row));
    }
    const inserted = await db.query<SwipeRow>(
      `INSERT INTO ${T}.swipes (id, household_id, item_id, choice, author_person_id, revision)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5::uuid, 1) RETURNING ${SWIPE_SELECT}`,
      [input.entityId, context.householdId, itemId, choice, context.householdPersonId],
    );
    const row = inserted.rows[0];
    if (!row) throw new Error("Swipe insert returned no row.");
    return applied(row.revision, swipeState(row));
  }
  if (input.operation !== "update") return rejected("KISS_OPERATION_UNSUPPORTED");
  if (!current || current.deletedAt !== null) return rejected("KISS_NOT_FOUND");
  if (!exactly(input.payload, ["choice"])) return rejected("KISS_SWIPE_INVALID", swipeState(current), current.revision);
  // Changing your mind is your own decision: the latest choice wins.
  const updated = await db.query<SwipeRow>(
    `UPDATE ${T}.swipes SET choice = $3, revision = revision + 1, updated_at = now()
     WHERE household_id = $1::uuid AND id = $2::uuid RETURNING ${SWIPE_SELECT}`,
    [context.householdId, current.id, choice],
  );
  const row = updated.rows[0];
  if (!row) throw new Error("Swipe update returned no row.");
  return applied(row.revision, swipeState(row));
}

export function createHomiServerModule(host: HomiServerModuleHostContext) {
  const database = host.moduleDatabase;
  const handler = (entityType: EntityType, operations: string[]) => ({
    entityType,
    operations,
    apply: (context: HomiRequestContext, db: HomiModuleDatabase, input: HomiModuleServerMutationInput): Promise<Result> => {
      if (!operations.includes(input.operation)) return Promise.resolve(rejected("KISS_OPERATION_UNSUPPORTED"));
      switch (entityType) {
        case "partnership": return applyPartnership(host, context, db, input);
        case "answer": return applyAnswer(context, db, input);
        case "checkin": return applyCheckin(context, db, input);
        case "date": return applyDate(context, db, input);
        case "quiz": return applyQuiz(context, db, input);
        case "swipe": return applySwipe(context, db, input);
        default: return applyNote(context, db, input);
      }
    },
  });

  return defineHomiServerModule({
    moduleKey: KISS_MODULE_KEY,
    moduleApiVersion: HOMI_MODULE_API_VERSION,

    register(app: FastifyInstance) {
      const base = "/api/v1/modules/kiss";

      app.get(`${base}/health`, async (request) => {
        await contextFor(host, request);
        return { data: { moduleKey: KISS_MODULE_KEY, status: "ok" } };
      });

      // Who is asking, and whether this module is set up for them. Anyone who
      // is not one of the two partners (or the administrator) learns nothing.
      app.get(`${base}/me`, async (request) => {
        const context = await contextFor(host, request);
        const p = await activePartnership(database, context.householdId);
        const partner = partnerOf(p, context.householdPersonId);
        const administrator = await isAdmin(host, context);
        const me: Me = {
          personId: context.householdPersonId,
          administrator,
          partnerPersonId: partner,
          isPartner: partner !== null,
          partnership: p && (partner !== null || administrator) ? partnershipState(p) : null,
        };
        return { data: me };
      });

      // Names for the pairing form: administrators only.
      app.get(`${base}/people`, async (request) => {
        const context = await contextFor(host, request);
        if (!(await isAdmin(host, context))) throw httpError(403, "KISS_ADMIN_ONLY", "Only an administrator can set up K.I.S.S.");
        const people = host.householdPeople ? await host.householdPeople.listActive(context) : [];
        return { data: people.map((x) => ({ personId: x.id, displayName: x.displayName })) };
      });

      // The partner's name, for the two partners only.
      app.get(`${base}/partner`, async (request) => {
        const context = await contextFor(host, request);
        const p = await activePartnership(database, context.householdId);
        const partner = partnerOf(p, context.householdPersonId);
        if (!partner) throw httpError(404, "KISS_NOT_PARTNER", "K.I.S.S. is not set up for you.");
        const people = host.householdPeople ? await host.householdPeople.listActive(context) : [];
        const person = people.find((x) => x.id === partner);
        return { data: { personId: partner, displayName: person?.displayName ?? "Your partner" } };
      });

      app.get(`${base}/answers`, async (request) => {
        const context = await contextFor(host, request);
        const p = await activePartnership(database, context.householdId);
        return { data: await visibleAnswers(database, context, p) };
      });
      app.get(`${base}/checkins`, async (request) => {
        const context = await contextFor(host, request);
        const p = await activePartnership(database, context.householdId);
        return { data: await visibleCheckins(database, context, p) };
      });
      app.get(`${base}/notes`, async (request) => {
        const context = await contextFor(host, request);
        const p = await activePartnership(database, context.householdId);
        return { data: await visibleNotes(database, context, p) };
      });

      app.get(`${base}/dates`, async (request) => {
        const context = await contextFor(host, request);
        const p = await activePartnership(database, context.householdId);
        return { data: await visibleDates(database, context, p) };
      });
      app.get(`${base}/quizzes`, async (request) => {
        const context = await contextFor(host, request);
        const p = await activePartnership(database, context.householdId);
        return { data: await visibleQuizzes(database, context, p) };
      });
      app.get(`${base}/swipes`, async (request) => {
        const context = await contextFor(host, request);
        const p = await activePartnership(database, context.householdId);
        return { data: await visibleSwipes(database, context, p) };
      });

      // One entity by id for Core's change materialiser. The same visibility
      // rules apply, so another member's id returns 404, never the content.
      app.get(`${base}/entity/:type/:id`, async (request) => {
        const context = await contextFor(host, request);
        const { type, id } = request.params as { type?: string; id?: string };
        if (typeof id !== "string" || !UUID.test(id)) throw httpError(400, "KISS_ID_INVALID", "id must be a UUID.");
        const p = await activePartnership(database, context.householdId);
        const notFound = httpError(404, "KISS_NOT_FOUND", "Not found.");
        if (type === "partnership") {
          const admin = await isAdmin(host, context);
          if (p && p.id === id && (admin || partnerOf(p, context.householdPersonId) !== null)) return { data: partnershipState(p) };
          throw notFound;
        }
        const pool =
          type === "answer" ? await visibleAnswers(database, context, p) :
          type === "checkin" ? await visibleCheckins(database, context, p) :
          type === "note" ? await visibleNotes(database, context, p) :
          type === "date" ? await visibleDates(database, context, p) :
          type === "quiz" ? await visibleQuizzes(database, context, p) :
          type === "swipe" ? await visibleSwipes(database, context, p) : null;
        const hit = pool?.find((x) => x.id === id);
        if (!hit) throw notFound;
        return { data: hit };
      });
    },

    sync: {
      mutationHandlers: [
        handler("partnership", ["create", "update", "delete"]),
        handler("answer", ["create", "update", "delete"]),
        handler("checkin", ["create", "update"]),
        handler("note", ["create", "update", "delete"]),
        handler("date", ["create", "update", "delete"]),
        handler("quiz", ["create", "update"]),
        handler("swipe", ["create", "update"]),
      ],
    },
  });
}
