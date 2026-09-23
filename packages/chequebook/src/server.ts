import { randomUUID } from "node:crypto";
import type {
  FastifyInstance,
  FastifyRequest,
} from "fastify";
import {
  HOMI_MODULE_API_VERSION,
  defineHomiServerModule,
  type HomiModuleDatabase,
  type HomiModuleMutationServices,
  type HomiModuleServerMutationInput,
  type HomiModuleServerMutationResult,
  type HomiRequestContext,
  type HomiServerModuleHostContext,
} from "@homi/module-sdk";
import {
  CHEQUEBOOK_ACCOUNT_TYPES,
  CHEQUEBOOK_MODULE_KEY,
  CHEQUEBOOK_RECURRENCE_FREQUENCIES,
  CHEQUEBOOK_TRANSACTION_KINDS,
} from "./constants.js";
import {
  expandRecurringRules,
} from "./recurrence.js";
import type {
  ChequebookAccount,
  ChequebookBudgetLimit,
  ChequebookCategory,
  ChequebookRecurringRule,
  ChequebookSettings,
  ChequebookTransaction,
  ChequebookTransactionKind,
} from "./types.js";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}-01$/;
const CURRENCY = /^[A-Z]{3}$/;
const MONEY = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/;
const COLORS = new Set([
  "red","orange","yellow","lime","green","dark green","aqua","cyan",
  "blue","navy","purple","violet","pink","magenta","brown","black",
]);

interface AccountRow extends Record<string, unknown> {
  id: string;
  householdId: string;
  name: string;
  type: ChequebookAccount["type"];
  openingBalance: string;
  openingDate: string | Date;
  archived: boolean;
  revision: string;
  createdAt: string | Date;
  updatedAt: string | Date;
  deletedAt: string | Date | null;
}
interface CategoryRow extends Record<string, unknown> {
  id: string;
  householdId: string;
  name: string;
  kind: ChequebookCategory["kind"];
  color: string;
  archived: boolean;
  revision: string;
  createdAt: string | Date;
  updatedAt: string | Date;
  deletedAt: string | Date | null;
}
interface TransactionRow extends Record<string, unknown> {
  id: string;
  householdId: string;
  accountId: string;
  transferAccountId: string | null;
  categoryId: string | null;
  personId: string | null;
  kind: ChequebookTransaction["kind"];
  amount: string;
  description: string;
  payee: string | null;
  date: string | Date;
  cleared: boolean;
  reconciledAt: string | Date | null;
  notes: string | null;
  recurringRuleId: string | null;
  recurringOccurrenceDate: string | Date | null;
  calendarLinkEnabled: boolean;
  revision: string;
  createdAt: string | Date;
  updatedAt: string | Date;
  deletedAt: string | Date | null;
}
interface RecurringRow extends Record<string, unknown> {
  id: string;
  householdId: string;
  accountId: string;
  transferAccountId: string | null;
  categoryId: string | null;
  personId: string | null;
  kind: ChequebookRecurringRule["kind"];
  amount: string;
  label: string;
  notes: string | null;
  startDate: string | Date;
  frequency: ChequebookRecurringRule["frequency"];
  interval: number;
  recurrenceUntil: string | Date | null;
  active: boolean;
  calendarLinkEnabled: boolean;
  revision: string;
  createdAt: string | Date;
  updatedAt: string | Date;
  deletedAt: string | Date | null;
}
interface BudgetRow extends Record<string, unknown> {
  id: string;
  householdId: string;
  categoryId: string;
  budgetMonth: string | Date;
  amount: string;
  rolloverEnabled: boolean;
  revision: string;
  createdAt: string | Date;
  updatedAt: string | Date;
  deletedAt: string | Date | null;
}
interface SettingsRow extends Record<string, unknown> {
  householdId: string;
  currency: string;
  defaultAccountId: string;
  lowBalanceThreshold: string | null;
  revision: string;
}

function httpError(
  statusCode: number,
  code: string,
  message: string,
): Error & { statusCode: number; code: string } {
  const error = new Error(message) as Error & {
    statusCode: number;
    code: string;
  };
  error.statusCode = statusCode;
  error.code = code;
  return error;
}
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw httpError(400, "CHEQUEBOOK_INPUT_INVALID", "A JSON object is required.");
  }
  return value as Record<string, unknown>;
}
function cleanText(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") {
    throw httpError(400, "CHEQUEBOOK_INPUT_INVALID", field + " must be text.");
  }
  const result = value.trim();
  if (result.length < 1 || result.length > max) {
    throw httpError(400, "CHEQUEBOOK_INPUT_INVALID", field + " has an invalid length.");
  }
  return result;
}
function nullableText(value: unknown, max: number): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") {
    throw httpError(400, "CHEQUEBOOK_INPUT_INVALID", "Expected optional text.");
  }
  const result = value.trim();
  return result.length === 0 ? null : result.slice(0, max);
}
function money(value: unknown, allowZero = false): string {
  const input =
    typeof value === "number" && Number.isFinite(value)
      ? value.toFixed(2)
      : typeof value === "string"
        ? value.trim()
        : "";
  if (!MONEY.test(input)) {
    throw httpError(400, "CHEQUEBOOK_AMOUNT_INVALID", "The amount is invalid.");
  }
  const number = Number(input);
  if ((!allowZero && number <= 0) || number < 0) {
    throw httpError(400, "CHEQUEBOOK_AMOUNT_INVALID", "The amount must be positive.");
  }
  return number.toFixed(2);
}
function signedMoney(value: unknown): string {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(number) || Math.abs(number) > 999999999999.99) {
    throw httpError(400, "CHEQUEBOOK_AMOUNT_INVALID", "The balance is invalid.");
  }
  return number.toFixed(2);
}
function dateOnly(value: unknown, field = "date"): string {
  if (typeof value !== "string" || !DATE.test(value)) {
    throw httpError(400, "CHEQUEBOOK_DATE_INVALID", field + " must be YYYY-MM-DD.");
  }
  const parsed = new Date(value + "T00:00:00Z");
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw httpError(400, "CHEQUEBOOK_DATE_INVALID", field + " is invalid.");
  }
  return value;
}
function monthOnly(value: unknown): string {
  const date = dateOnly(value, "budgetMonth");
  if (!MONTH.test(date)) {
    throw httpError(400, "CHEQUEBOOK_MONTH_INVALID", "budgetMonth must be the first day of a month.");
  }
  return date;
}
function uuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw httpError(400, "CHEQUEBOOK_ID_INVALID", field + " must be a UUID.");
  }
  return value;
}
function nullableUuid(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  return uuid(value, field);
}
function bool(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw httpError(400, "CHEQUEBOOK_INPUT_INVALID", field + " must be boolean.");
  }
  return value;
}
function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
function day(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}
function decimal(value: string | number): string {
  return Number(value).toFixed(2);
}
function headersFor(request: FastifyRequest) {
  return request.headers as Record<string, string | string[] | undefined>;
}
async function requestContext(
  host: HomiServerModuleHostContext,
  request: FastifyRequest,
): Promise<HomiRequestContext> {
  const context = await host.resolveContext({
    id: request.id,
    headers: headersFor(request),
  });
  await host.requireEnabled(CHEQUEBOOK_MODULE_KEY, context);
  return context;
}
async function requirePerson(
  host: HomiServerModuleHostContext,
  context: HomiRequestContext,
  personId: string | null,
): Promise<void> {
  if (personId === null) return;
  const people = host.householdPeople;
  if (!people) throw new Error("Chequebook requires household-people.");
  const list = await people.listActive(context);
  if (!list.some((person) => person.id === personId)) {
    throw httpError(400, "CHEQUEBOOK_PERSON_INVALID", "The household person is not active.");
  }
}
function accountState(row: AccountRow): ChequebookAccount {
  return Object.freeze({
    id: row.id,
    householdId: row.householdId,
    name: row.name,
    type: row.type,
    openingBalance: decimal(row.openingBalance),
    openingDate: day(row.openingDate),
    archived: row.archived,
    revision: row.revision,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  });
}
function categoryState(row: CategoryRow): ChequebookCategory {
  return Object.freeze({
    id: row.id,
    householdId: row.householdId,
    name: row.name,
    kind: row.kind,
    color: row.color,
    archived: row.archived,
    revision: row.revision,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  });
}
function transactionState(row: TransactionRow): ChequebookTransaction {
  return Object.freeze({
    id: row.id,
    householdId: row.householdId,
    accountId: row.accountId,
    transferAccountId: row.transferAccountId,
    categoryId: row.categoryId,
    personId: row.personId,
    kind: row.kind,
    amount: decimal(row.amount),
    description: row.description,
    payee: row.payee,
    date: day(row.date),
    cleared: row.cleared,
    reconciledAt: row.reconciledAt === null ? null : iso(row.reconciledAt),
    notes: row.notes,
    recurringRuleId: row.recurringRuleId,
    recurringOccurrenceDate:
      row.recurringOccurrenceDate === null
        ? null
        : day(row.recurringOccurrenceDate),
    calendarLinkEnabled: row.calendarLinkEnabled,
    revision: row.revision,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  });
}
function recurringState(row: RecurringRow): ChequebookRecurringRule {
  return Object.freeze({
    id: row.id,
    householdId: row.householdId,
    accountId: row.accountId,
    transferAccountId: row.transferAccountId,
    categoryId: row.categoryId,
    personId: row.personId,
    kind: row.kind,
    amount: decimal(row.amount),
    label: row.label,
    notes: row.notes,
    startDate: day(row.startDate),
    frequency: row.frequency,
    interval: row.interval,
    recurrenceUntil: row.recurrenceUntil === null ? null : day(row.recurrenceUntil),
    active: row.active,
    calendarLinkEnabled: row.calendarLinkEnabled,
    revision: row.revision,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  });
}
function budgetState(row: BudgetRow): ChequebookBudgetLimit {
  return Object.freeze({
    id: row.id,
    householdId: row.householdId,
    categoryId: row.categoryId,
    budgetMonth: day(row.budgetMonth),
    amount: decimal(row.amount),
    rolloverEnabled: row.rolloverEnabled,
    revision: row.revision,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  });
}
function settingsState(row: SettingsRow): ChequebookSettings {
  return Object.freeze({
    householdId: row.householdId,
    currency: row.currency,
    defaultAccountId: row.defaultAccountId,
    lowBalanceThreshold:
      row.lowBalanceThreshold === null ? null : decimal(row.lowBalanceThreshold),
    revision: row.revision,
  });
}

const ACCOUNT_SELECT = `
  id::text AS id,
  household_id::text AS "householdId",
  name, type,
  opening_balance::text AS "openingBalance",
  opening_date AS "openingDate",
  archived,
  revision::text AS revision,
  created_at AS "createdAt",
  updated_at AS "updatedAt",
  deleted_at AS "deletedAt"`;
const CATEGORY_SELECT = `
  id::text AS id,
  household_id::text AS "householdId",
  name, kind, color, archived,
  revision::text AS revision,
  created_at AS "createdAt",
  updated_at AS "updatedAt",
  deleted_at AS "deletedAt"`;
const TRANSACTION_SELECT = `
  id::text AS id,
  household_id::text AS "householdId",
  account_id::text AS "accountId",
  transfer_account_id::text AS "transferAccountId",
  category_id::text AS "categoryId",
  person_id::text AS "personId",
  kind, amount::text AS amount, description, payee,
  date, cleared, reconciled_at AS "reconciledAt", notes,
  recurring_rule_id::text AS "recurringRuleId",
  recurring_occurrence_date AS "recurringOccurrenceDate",
  calendar_link_enabled AS "calendarLinkEnabled",
  revision::text AS revision,
  created_at AS "createdAt",
  updated_at AS "updatedAt",
  deleted_at AS "deletedAt"`;
const RECURRING_SELECT = `
  id::text AS id,
  household_id::text AS "householdId",
  account_id::text AS "accountId",
  transfer_account_id::text AS "transferAccountId",
  category_id::text AS "categoryId",
  person_id::text AS "personId",
  kind, amount::text AS amount, label, notes,
  start_date AS "startDate",
  frequency,
  recurrence_interval AS interval,
  recurrence_until AS "recurrenceUntil",
  active,
  calendar_link_enabled AS "calendarLinkEnabled",
  revision::text AS revision,
  created_at AS "createdAt",
  updated_at AS "updatedAt",
  deleted_at AS "deletedAt"`;
const BUDGET_SELECT = `
  id::text AS id,
  household_id::text AS "householdId",
  category_id::text AS "categoryId",
  budget_month AS "budgetMonth",
  amount::text AS amount,
  rollover_enabled AS "rolloverEnabled",
  revision::text AS revision,
  created_at AS "createdAt",
  updated_at AS "updatedAt",
  deleted_at AS "deletedAt"`;

const DEFAULT_CATEGORIES = Object.freeze([
  ["Housing", "expense", "navy"],
  ["Groceries", "expense", "green"],
  ["Transport", "expense", "blue"],
  ["Health", "expense", "red"],
  ["Insurance", "expense", "purple"],
  ["Children", "expense", "cyan"],
  ["Bills", "expense", "orange"],
  ["Subscriptions", "expense", "violet"],
  ["Home", "expense", "brown"],
  ["Leisure", "expense", "pink"],
  ["Other", "both", "black"],
  ["Salary", "income", "green"],
  ["Other income", "income", "aqua"],
] as const);

async function loadSettings(
  database: HomiModuleDatabase,
  context: HomiRequestContext,
): Promise<ChequebookSettings | null> {
  const result = await database.query<SettingsRow>(
    `SELECT household_id::text AS "householdId",
            currency,
            default_account_id::text AS "defaultAccountId",
            low_balance_threshold::text AS "lowBalanceThreshold",
            revision::text AS revision
     FROM mod_chequebook.household_settings
     WHERE household_id=$1::uuid`,
    [context.householdId],
  );
  return result.rows[0] ? settingsState(result.rows[0]) : null;
}
async function setupState(
  database: HomiModuleDatabase,
  context: HomiRequestContext,
) {
  const settings = await loadSettings(database, context);
  if (!settings) return null;
  const [accounts, categories] = await Promise.all([
    database.query<AccountRow>(
      `SELECT ${ACCOUNT_SELECT} FROM mod_chequebook.accounts
       WHERE household_id=$1::uuid AND deleted_at IS NULL
       ORDER BY archived,name,id`,
      [context.householdId],
    ),
    database.query<CategoryRow>(
      `SELECT ${CATEGORY_SELECT} FROM mod_chequebook.categories
       WHERE household_id=$1::uuid AND deleted_at IS NULL
       ORDER BY archived,name,id`,
      [context.householdId],
    ),
  ]);
  return Object.freeze({
    settings,
    accounts: Object.freeze(accounts.rows.map(accountState)),
    categories: Object.freeze(categories.rows.map(categoryState)),
  });
}
async function validateAccountAndCategory(
  database: HomiModuleDatabase,
  context: HomiRequestContext,
  input: {
    accountId: string;
    transferAccountId: string | null;
    categoryId: string | null;
    kind: ChequebookTransactionKind;
  },
) {
  const ids = [input.accountId, input.transferAccountId].filter(
    (value): value is string => value !== null,
  );
  const accounts = await database.query<{ id: string }>(
    `SELECT id::text AS id FROM mod_chequebook.accounts
     WHERE household_id=$1::uuid
       AND deleted_at IS NULL
       AND archived=false
       AND id = ANY($2::uuid[])`,
    [context.householdId, ids],
  );
  if (accounts.rows.length !== new Set(ids).size) {
    throw httpError(400, "CHEQUEBOOK_ACCOUNT_INVALID", "The selected account is unavailable.");
  }
  if (input.categoryId !== null) {
    const category = await database.query(
      `SELECT 1 FROM mod_chequebook.categories
       WHERE household_id=$1::uuid AND id=$2::uuid
         AND deleted_at IS NULL AND archived=false`,
      [context.householdId, input.categoryId],
    );
    if (category.rows.length !== 1) {
      throw httpError(400, "CHEQUEBOOK_CATEGORY_INVALID", "The selected category is unavailable.");
    }
  }
}

function parseAccountPayload(payload: Record<string, unknown>) {
  const type = payload.type;
  if (typeof type !== "string" || !CHEQUEBOOK_ACCOUNT_TYPES.includes(type as never)) {
    throw httpError(400, "CHEQUEBOOK_ACCOUNT_INVALID", "Account type is invalid.");
  }
  return {
    name: cleanText(payload.name, "name", 80),
    type: type as ChequebookAccount["type"],
    openingBalance: signedMoney(payload.openingBalance ?? "0"),
    openingDate: dateOnly(payload.openingDate, "openingDate"),
    archived: bool(payload.archived ?? false, "archived"),
  };
}
function parseCategoryPayload(payload: Record<string, unknown>) {
  const kind = payload.kind;
  const color = payload.color;
  if (kind !== "expense" && kind !== "income" && kind !== "both") {
    throw httpError(400, "CHEQUEBOOK_CATEGORY_INVALID", "Category kind is invalid.");
  }
  if (typeof color !== "string" || !COLORS.has(color)) {
    throw httpError(400, "CHEQUEBOOK_CATEGORY_INVALID", "Category color is invalid.");
  }
  return {
    name: cleanText(payload.name, "name", 80),
    kind,
    color,
    archived: bool(payload.archived ?? false, "archived"),
  };
}
function parseFinancialShape(payload: Record<string, unknown>) {
  const kind = payload.kind;
  if (
    typeof kind !== "string" ||
    !CHEQUEBOOK_TRANSACTION_KINDS.includes(kind as never)
  ) {
    throw httpError(400, "CHEQUEBOOK_TRANSACTION_INVALID", "Transaction kind is invalid.");
  }
  const accountId = uuid(payload.accountId, "accountId");
  const transferAccountId = nullableUuid(payload.transferAccountId, "transferAccountId");
  const categoryId = nullableUuid(payload.categoryId, "categoryId");
  if (kind === "transfer") {
    if (!transferAccountId || transferAccountId === accountId || categoryId !== null) {
      throw httpError(400, "CHEQUEBOOK_TRANSFER_INVALID", "Transfer accounts are invalid.");
    }
  } else if (transferAccountId !== null) {
    throw httpError(400, "CHEQUEBOOK_TRANSACTION_INVALID", "Only transfers may have a destination account.");
  }
  return {
    kind: kind as ChequebookTransactionKind,
    accountId,
    transferAccountId,
    categoryId,
    personId: nullableUuid(payload.personId, "personId"),
    amount: money(payload.amount),
  };
}
function parseTransactionPayload(payload: Record<string, unknown>) {
  const recurringRuleId = nullableUuid(
    payload.recurringRuleId,
    "recurringRuleId",
  );
  const recurringOccurrenceDate =
    payload.recurringOccurrenceDate === null ||
    payload.recurringOccurrenceDate === undefined ||
    payload.recurringOccurrenceDate === ""
      ? null
      : dateOnly(
          payload.recurringOccurrenceDate,
          "recurringOccurrenceDate",
        );
  if (
    (recurringRuleId === null) !==
    (recurringOccurrenceDate === null)
  ) {
    throw httpError(
      400,
      "CHEQUEBOOK_RECURRING_SOURCE_INVALID",
      "Recurring rule and occurrence date must be supplied together.",
    );
  }
  return {
    ...parseFinancialShape(payload),
    description: cleanText(payload.description, "description", 200),
    payee: nullableText(payload.payee, 160),
    date: dateOnly(payload.date),
    cleared: bool(payload.cleared ?? false, "cleared"),
    reconciledAt:
      payload.reconciledAt === null || payload.reconciledAt === undefined
        ? null
        : typeof payload.reconciledAt === "string" &&
            !Number.isNaN(Date.parse(payload.reconciledAt))
          ? new Date(payload.reconciledAt).toISOString()
          : (() => {
              throw httpError(400, "CHEQUEBOOK_RECONCILE_INVALID", "reconciledAt is invalid.");
            })(),
    notes: nullableText(payload.notes, 2000),
    recurringRuleId,
    recurringOccurrenceDate,
    calendarLinkEnabled: bool(
      payload.calendarLinkEnabled ?? false,
      "calendarLinkEnabled",
    ),
  };
}
function parseRecurringPayload(payload: Record<string, unknown>) {
  const base = parseFinancialShape(payload);
  const frequency = payload.frequency;
  if (
    typeof frequency !== "string" ||
    !CHEQUEBOOK_RECURRENCE_FREQUENCIES.includes(frequency as never)
  ) {
    throw httpError(400, "CHEQUEBOOK_RECURRENCE_INVALID", "Recurrence frequency is invalid.");
  }
  const interval = Number(payload.interval ?? 1);
  if (!Number.isSafeInteger(interval) || interval < 1 || interval > 365) {
    throw httpError(400, "CHEQUEBOOK_RECURRENCE_INVALID", "Recurrence interval is invalid.");
  }
  const startDate = dateOnly(payload.startDate, "startDate");
  const recurrenceUntil =
    payload.recurrenceUntil === null ||
    payload.recurrenceUntil === undefined ||
    payload.recurrenceUntil === ""
      ? null
      : dateOnly(payload.recurrenceUntil, "recurrenceUntil");
  if (recurrenceUntil !== null && recurrenceUntil < startDate) {
    throw httpError(400, "CHEQUEBOOK_RECURRENCE_INVALID", "Repeat-until cannot precede start date.");
  }
  return {
    ...base,
    label: cleanText(payload.label, "label", 200),
    notes: nullableText(payload.notes, 2000),
    startDate,
    frequency: frequency as ChequebookRecurringRule["frequency"],
    interval,
    recurrenceUntil,
    active: bool(payload.active ?? true, "active"),
    calendarLinkEnabled: bool(
      payload.calendarLinkEnabled ?? false,
      "calendarLinkEnabled",
    ),
  };
}
function parseBudgetPayload(payload: Record<string, unknown>) {
  return {
    categoryId: uuid(payload.categoryId, "categoryId"),
    budgetMonth: monthOnly(payload.budgetMonth),
    amount: money(payload.amount, true),
    rolloverEnabled: bool(payload.rolloverEnabled ?? false, "rolloverEnabled"),
  };
}

function conflict(
  revision: string,
  state: unknown,
): HomiModuleServerMutationResult {
  return {
    status: "conflict",
    revision,
    errorCode: "REVISION_CONFLICT",
    serverState: state,
  };
}
function rejected(
  code: string,
  revision: string | null,
  state: unknown,
): HomiModuleServerMutationResult {
  return {
    status: "rejected",
    revision,
    errorCode: code,
    serverState: state,
  };
}
async function scheduleCalendarLink(
  services: HomiModuleMutationServices,
  context: HomiRequestContext,
  sourceType: "transaction" | "recurring-rule",
  sourceId: string,
  revision: string,
) {
  if (!services.jobs) return;
  await services.jobs.schedule(context, {
    jobType: "calendar-link-sync",
    runAt: new Date().toISOString(),
    dedupeKey: `calendar-link:${sourceType}:${sourceId}:${revision}`,
    payload: { sourceType, sourceId },
  });
}

async function applyAccountMutation(
  context: HomiRequestContext,
  database: HomiModuleDatabase,
  input: HomiModuleServerMutationInput,
): Promise<HomiModuleServerMutationResult> {
  const currentResult = await database.query<AccountRow>(
    `SELECT ${ACCOUNT_SELECT} FROM mod_chequebook.accounts
     WHERE household_id=$1::uuid AND id=$2::uuid FOR UPDATE`,
    [context.householdId, input.entityId],
  );
  const current = currentResult.rows[0] ?? null;
  if (input.operation === "create") {
    if (input.baseRevision !== "0" || current) {
      return current ? conflict(current.revision, accountState(current)) :
        rejected("CHEQUEBOOK_ACCOUNT_CREATE_INVALID", null, null);
    }
    const value = parseAccountPayload(input.payload);
    const result = await database.query<AccountRow>(
      `INSERT INTO mod_chequebook.accounts
       (id,household_id,name,type,opening_balance,opening_date,archived,revision)
       VALUES ($1::uuid,$2::uuid,$3,$4,$5::numeric,$6::date,$7,1)
       RETURNING ${ACCOUNT_SELECT}`,
      [input.entityId, context.householdId, value.name, value.type,
       value.openingBalance, value.openingDate, value.archived],
    );
    const row = result.rows[0]!;
    return { status: "applied", revision: row.revision, serverState: accountState(row) };
  }
  if (!current || current.deletedAt !== null) {
    return rejected("CHEQUEBOOK_ACCOUNT_NOT_FOUND", current?.revision ?? null, current ? accountState(current) : null);
  }
  if (current.revision !== input.baseRevision) return conflict(current.revision, accountState(current));
  if (input.operation === "delete") {
    const refs = await database.query<{ count: string }>(
      `SELECT (
        (SELECT count(*) FROM mod_chequebook.transactions WHERE household_id=$1::uuid AND deleted_at IS NULL AND (account_id=$2::uuid OR transfer_account_id=$2::uuid)) +
        (SELECT count(*) FROM mod_chequebook.recurring_rules WHERE household_id=$1::uuid AND deleted_at IS NULL AND (account_id=$2::uuid OR transfer_account_id=$2::uuid)) +
        (SELECT count(*) FROM mod_chequebook.household_settings WHERE household_id=$1::uuid AND default_account_id=$2::uuid)
      )::text AS count`,
      [context.householdId, input.entityId],
    );
    if (Number(refs.rows[0]?.count ?? "0") > 0) {
      return rejected("CHEQUEBOOK_ACCOUNT_IN_USE", current.revision, accountState(current));
    }
    const result = await database.query<AccountRow>(
      `UPDATE mod_chequebook.accounts SET deleted_at=now(),revision=revision+1,updated_at=now()
       WHERE household_id=$1::uuid AND id=$2::uuid RETURNING ${ACCOUNT_SELECT}`,
      [context.householdId, input.entityId],
    );
    const row = result.rows[0]!;
    return { status: "applied", revision: row.revision, serverState: { ...accountState(row), deleted: true } };
  }
  if (input.operation !== "update") return rejected("CHEQUEBOOK_OPERATION_UNSUPPORTED", current.revision, accountState(current));
  const value = parseAccountPayload(input.payload);
  const result = await database.query<AccountRow>(
    `UPDATE mod_chequebook.accounts SET name=$3,type=$4,opening_balance=$5::numeric,
       opening_date=$6::date,archived=$7,revision=revision+1,updated_at=now()
     WHERE household_id=$1::uuid AND id=$2::uuid RETURNING ${ACCOUNT_SELECT}`,
    [context.householdId, input.entityId, value.name, value.type,
     value.openingBalance, value.openingDate, value.archived],
  );
  const row = result.rows[0]!;
  return { status: "applied", revision: row.revision, serverState: accountState(row) };
}

async function applyCategoryMutation(
  context: HomiRequestContext,
  database: HomiModuleDatabase,
  input: HomiModuleServerMutationInput,
): Promise<HomiModuleServerMutationResult> {
  const found = await database.query<CategoryRow>(
    `SELECT ${CATEGORY_SELECT} FROM mod_chequebook.categories
     WHERE household_id=$1::uuid AND id=$2::uuid FOR UPDATE`,
    [context.householdId, input.entityId],
  );
  const current = found.rows[0] ?? null;
  if (input.operation === "create") {
    if (input.baseRevision !== "0" || current) {
      return current ? conflict(current.revision, categoryState(current)) :
        rejected("CHEQUEBOOK_CATEGORY_CREATE_INVALID", null, null);
    }
    const value = parseCategoryPayload(input.payload);
    const result = await database.query<CategoryRow>(
      `INSERT INTO mod_chequebook.categories
       (id,household_id,name,kind,color,archived,revision)
       VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,1)
       RETURNING ${CATEGORY_SELECT}`,
      [input.entityId, context.householdId, value.name, value.kind,
       value.color, value.archived],
    );
    const row = result.rows[0]!;
    return { status: "applied", revision: row.revision, serverState: categoryState(row) };
  }
  if (!current || current.deletedAt !== null) {
    return rejected("CHEQUEBOOK_CATEGORY_NOT_FOUND", current?.revision ?? null, current ? categoryState(current) : null);
  }
  if (current.revision !== input.baseRevision) return conflict(current.revision, categoryState(current));
  if (input.operation === "delete") {
    const result = await database.query<CategoryRow>(
      `UPDATE mod_chequebook.categories SET deleted_at=now(),archived=true,
       revision=revision+1,updated_at=now()
       WHERE household_id=$1::uuid AND id=$2::uuid RETURNING ${CATEGORY_SELECT}`,
      [context.householdId, input.entityId],
    );
    const row = result.rows[0]!;
    return { status: "applied", revision: row.revision, serverState: { ...categoryState(row), deleted: true } };
  }
  if (input.operation !== "update") return rejected("CHEQUEBOOK_OPERATION_UNSUPPORTED", current.revision, categoryState(current));
  const value = parseCategoryPayload(input.payload);
  const result = await database.query<CategoryRow>(
    `UPDATE mod_chequebook.categories SET name=$3,kind=$4,color=$5,
       archived=$6,revision=revision+1,updated_at=now()
     WHERE household_id=$1::uuid AND id=$2::uuid RETURNING ${CATEGORY_SELECT}`,
    [context.householdId, input.entityId, value.name, value.kind,
     value.color, value.archived],
  );
  const row = result.rows[0]!;
  return { status: "applied", revision: row.revision, serverState: categoryState(row) };
}

async function validateRecurringPosting(
  database: HomiModuleDatabase,
  context: HomiRequestContext,
  value: ReturnType<typeof parseTransactionPayload>,
): Promise<void> {
  if (
    value.recurringRuleId === null ||
    value.recurringOccurrenceDate === null
  ) {
    return;
  }

  const result = await database.query<RecurringRow>(
    `SELECT ${RECURRING_SELECT}
     FROM mod_chequebook.recurring_rules
     WHERE household_id=$1::uuid
       AND id=$2::uuid
       AND deleted_at IS NULL
       AND active=true
     LIMIT 1`,
    [context.householdId, value.recurringRuleId],
  );
  const row = result.rows[0];
  if (!row) {
    throw httpError(
      400,
      "CHEQUEBOOK_RECURRING_SOURCE_INVALID",
      "The recurring transaction is unavailable.",
    );
  }
  const rule = recurringState(row);
  const occurrence = expandRecurringRules(
    [rule],
    value.recurringOccurrenceDate,
    value.recurringOccurrenceDate,
  )[0];
  if (
    !occurrence ||
    occurrence.occurrenceDate !==
      value.recurringOccurrenceDate ||
    value.date !== value.recurringOccurrenceDate ||
    value.accountId !== rule.accountId ||
    value.transferAccountId !==
      rule.transferAccountId ||
    value.categoryId !== rule.categoryId ||
    value.personId !== rule.personId ||
    value.kind !== rule.kind ||
    Number(value.amount) !== Number(rule.amount)
  ) {
    throw httpError(
      400,
      "CHEQUEBOOK_RECURRING_SOURCE_INVALID",
      "The posted transaction does not match the recurring occurrence.",
    );
  }
}

async function applyTransactionMutation(
  host: HomiServerModuleHostContext,
  context: HomiRequestContext,
  database: HomiModuleDatabase,
  input: HomiModuleServerMutationInput,
  services: HomiModuleMutationServices,
): Promise<HomiModuleServerMutationResult> {
  const found = await database.query<TransactionRow>(
    `SELECT ${TRANSACTION_SELECT} FROM mod_chequebook.transactions
     WHERE household_id=$1::uuid AND id=$2::uuid FOR UPDATE`,
    [context.householdId, input.entityId],
  );
  const current = found.rows[0] ?? null;
  if (input.operation === "create") {
    if (input.baseRevision !== "0" || current) {
      return current ? conflict(current.revision, transactionState(current)) :
        rejected("CHEQUEBOOK_TRANSACTION_CREATE_INVALID", null, null);
    }
    const value = parseTransactionPayload(input.payload);
    await validateAccountAndCategory(database, context, value);
    await requirePerson(host, context, value.personId);
    await validateRecurringPosting(database, context, value);
    const result = await database.query<TransactionRow>(
      `INSERT INTO mod_chequebook.transactions
       (id,household_id,account_id,transfer_account_id,category_id,person_id,
        kind,amount,description,payee,date,cleared,reconciled_at,notes,
        recurring_rule_id,recurring_occurrence_date,
        calendar_link_enabled,revision)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,
        $7,$8::numeric,$9,$10,$11::date,$12,$13::timestamptz,$14,
        $15::uuid,$16::date,$17,1)
       RETURNING ${TRANSACTION_SELECT}`,
      [input.entityId, context.householdId, value.accountId,
       value.transferAccountId, value.categoryId, value.personId,
       value.kind, value.amount, value.description, value.payee,
       value.date, value.cleared, value.reconciledAt, value.notes,
       value.recurringRuleId, value.recurringOccurrenceDate,
       value.calendarLinkEnabled],
    );
    const row = result.rows[0]!;
    if (
      row.recurringRuleId !== null &&
      row.recurringOccurrenceDate !== null
    ) {
      await database.query(
        `INSERT INTO mod_chequebook.recurring_occurrences
         (recurring_rule_id,occurrence_date,status,posted_transaction_id,updated_at)
         VALUES ($1::uuid,$2::date,'posted',$3::uuid,now())
         ON CONFLICT (recurring_rule_id,occurrence_date)
         DO UPDATE SET status='posted',
           posted_transaction_id=EXCLUDED.posted_transaction_id,
           updated_at=now()`,
        [row.recurringRuleId, day(row.recurringOccurrenceDate), row.id],
      );
    }
    await scheduleCalendarLink(services, context, "transaction", row.id, row.revision);
    return { status: "applied", revision: row.revision, serverState: transactionState(row) };
  }
  if (!current || current.deletedAt !== null) {
    return rejected("CHEQUEBOOK_TRANSACTION_NOT_FOUND", current?.revision ?? null, current ? transactionState(current) : null);
  }
  if (current.revision !== input.baseRevision) return conflict(current.revision, transactionState(current));
  if (input.operation === "delete") {
    const result = await database.query<TransactionRow>(
      `UPDATE mod_chequebook.transactions SET deleted_at=now(),
       revision=revision+1,updated_at=now()
       WHERE household_id=$1::uuid AND id=$2::uuid RETURNING ${TRANSACTION_SELECT}`,
      [context.householdId, input.entityId],
    );
    const row = result.rows[0]!;
    if (
      current.recurringRuleId !== null &&
      current.recurringOccurrenceDate !== null
    ) {
      await database.query(
        `INSERT INTO mod_chequebook.recurring_occurrences
         (recurring_rule_id,occurrence_date,status,posted_transaction_id,updated_at)
         VALUES ($1::uuid,$2::date,'pending',NULL,now())
         ON CONFLICT (recurring_rule_id,occurrence_date)
         DO UPDATE SET status='pending',
           posted_transaction_id=NULL,
           updated_at=now()`,
        [
          current.recurringRuleId,
          day(current.recurringOccurrenceDate),
        ],
      );
    }
    await scheduleCalendarLink(services, context, "transaction", row.id, row.revision);
    return { status: "applied", revision: row.revision, serverState: { ...transactionState(row), deleted: true } };
  }
  if (input.operation !== "update") return rejected("CHEQUEBOOK_OPERATION_UNSUPPORTED", current.revision, transactionState(current));
  const value = parseTransactionPayload(input.payload);
  if (
    current.recurringRuleId !== null &&
    value.recurringRuleId !== null &&
    value.recurringRuleId !== current.recurringRuleId
  ) {
    return rejected(
      "CHEQUEBOOK_RECURRING_SOURCE_IMMUTABLE",
      current.revision,
      transactionState(current),
    );
  }
  await validateAccountAndCategory(database, context, value);
  await requirePerson(host, context, value.personId);
  await validateRecurringPosting(database, context, value);
  const result = await database.query<TransactionRow>(
    `UPDATE mod_chequebook.transactions SET
       account_id=$3::uuid,transfer_account_id=$4::uuid,category_id=$5::uuid,
       person_id=$6::uuid,kind=$7,amount=$8::numeric,description=$9,payee=$10,
       date=$11::date,cleared=$12,reconciled_at=$13::timestamptz,notes=$14,
       calendar_link_enabled=$15,recurring_rule_id=$16::uuid,
       recurring_occurrence_date=$17::date,revision=revision+1,updated_at=now()
     WHERE household_id=$1::uuid AND id=$2::uuid RETURNING ${TRANSACTION_SELECT}`,
    [context.householdId, input.entityId, value.accountId,
     value.transferAccountId, value.categoryId, value.personId,
     value.kind, value.amount, value.description, value.payee,
     value.date, value.cleared, value.reconciledAt, value.notes,
     value.calendarLinkEnabled, value.recurringRuleId,
     value.recurringOccurrenceDate],
  );
  const row = result.rows[0]!;
  const previousOccurrenceDate = current.recurringOccurrenceDate === null
    ? null
    : day(current.recurringOccurrenceDate);
  if (
    current.recurringRuleId !== null &&
    previousOccurrenceDate !== null &&
    (value.recurringRuleId !== current.recurringRuleId ||
      value.recurringOccurrenceDate !== previousOccurrenceDate)
  ) {
    await database.query(
      `INSERT INTO mod_chequebook.recurring_occurrences
       (recurring_rule_id,occurrence_date,status,posted_transaction_id,updated_at)
       VALUES ($1::uuid,$2::date,'skipped',NULL,now())
       ON CONFLICT (recurring_rule_id,occurrence_date)
       DO UPDATE SET status='skipped',posted_transaction_id=NULL,updated_at=now()`,
      [current.recurringRuleId, previousOccurrenceDate],
    );
  }
  if (value.recurringRuleId !== null && value.recurringOccurrenceDate !== null) {
    await database.query(
      `INSERT INTO mod_chequebook.recurring_occurrences
       (recurring_rule_id,occurrence_date,status,posted_transaction_id,updated_at)
       VALUES ($1::uuid,$2::date,'posted',$3::uuid,now())
       ON CONFLICT (recurring_rule_id,occurrence_date)
       DO UPDATE SET status='posted',posted_transaction_id=EXCLUDED.posted_transaction_id,updated_at=now()`,
      [value.recurringRuleId, value.recurringOccurrenceDate, row.id],
    );
  }
  await scheduleCalendarLink(services, context, "transaction", row.id, row.revision);
  return { status: "applied", revision: row.revision, serverState: transactionState(row) };
}

async function applyRecurringMutation(
  host: HomiServerModuleHostContext,
  context: HomiRequestContext,
  database: HomiModuleDatabase,
  input: HomiModuleServerMutationInput,
  services: HomiModuleMutationServices,
): Promise<HomiModuleServerMutationResult> {
  const found = await database.query<RecurringRow>(
    `SELECT ${RECURRING_SELECT} FROM mod_chequebook.recurring_rules
     WHERE household_id=$1::uuid AND id=$2::uuid FOR UPDATE`,
    [context.householdId, input.entityId],
  );
  const current = found.rows[0] ?? null;
  if (input.operation === "create") {
    if (input.baseRevision !== "0" || current) {
      return current ? conflict(current.revision, recurringState(current)) :
        rejected("CHEQUEBOOK_RECURRING_CREATE_INVALID", null, null);
    }
    const value = parseRecurringPayload(input.payload);
    await validateAccountAndCategory(database, context, value);
    await requirePerson(host, context, value.personId);
    const result = await database.query<RecurringRow>(
      `INSERT INTO mod_chequebook.recurring_rules
       (id,household_id,account_id,transfer_account_id,category_id,person_id,
        kind,amount,label,notes,start_date,frequency,recurrence_interval,
        recurrence_until,active,calendar_link_enabled,revision)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,
        $7,$8::numeric,$9,$10,$11::date,$12,$13,$14::date,$15,$16,1)
       RETURNING ${RECURRING_SELECT}`,
      [input.entityId, context.householdId, value.accountId,
       value.transferAccountId, value.categoryId, value.personId,
       value.kind, value.amount, value.label, value.notes,
       value.startDate, value.frequency, value.interval,
       value.recurrenceUntil, value.active, value.calendarLinkEnabled],
    );
    const row = result.rows[0]!;
    await scheduleCalendarLink(services, context, "recurring-rule", row.id, row.revision);
    return { status: "applied", revision: row.revision, serverState: recurringState(row) };
  }
  if (!current || current.deletedAt !== null) {
    return rejected("CHEQUEBOOK_RECURRING_NOT_FOUND", current?.revision ?? null, current ? recurringState(current) : null);
  }
  if (current.revision !== input.baseRevision) return conflict(current.revision, recurringState(current));
  if (input.operation === "delete") {
    const result = await database.query<RecurringRow>(
      `UPDATE mod_chequebook.recurring_rules SET deleted_at=now(),active=false,
       revision=revision+1,updated_at=now()
       WHERE household_id=$1::uuid AND id=$2::uuid RETURNING ${RECURRING_SELECT}`,
      [context.householdId, input.entityId],
    );
    const row = result.rows[0]!;
    await scheduleCalendarLink(services, context, "recurring-rule", row.id, row.revision);
    return { status: "applied", revision: row.revision, serverState: { ...recurringState(row), deleted: true } };
  }
  if (input.operation !== "update") return rejected("CHEQUEBOOK_OPERATION_UNSUPPORTED", current.revision, recurringState(current));
  const value = parseRecurringPayload(input.payload);
  await validateAccountAndCategory(database, context, value);
  await requirePerson(host, context, value.personId);
  const result = await database.query<RecurringRow>(
    `UPDATE mod_chequebook.recurring_rules SET
       account_id=$3::uuid,transfer_account_id=$4::uuid,category_id=$5::uuid,
       person_id=$6::uuid,kind=$7,amount=$8::numeric,label=$9,notes=$10,
       start_date=$11::date,frequency=$12,recurrence_interval=$13,
       recurrence_until=$14::date,active=$15,calendar_link_enabled=$16,
       revision=revision+1,updated_at=now()
     WHERE household_id=$1::uuid AND id=$2::uuid RETURNING ${RECURRING_SELECT}`,
    [context.householdId, input.entityId, value.accountId,
     value.transferAccountId, value.categoryId, value.personId,
     value.kind, value.amount, value.label, value.notes,
     value.startDate, value.frequency, value.interval,
     value.recurrenceUntil, value.active, value.calendarLinkEnabled],
  );
  const row = result.rows[0]!;
  await scheduleCalendarLink(services, context, "recurring-rule", row.id, row.revision);
  return { status: "applied", revision: row.revision, serverState: recurringState(row) };
}

async function applyBudgetMutation(
  context: HomiRequestContext,
  database: HomiModuleDatabase,
  input: HomiModuleServerMutationInput,
): Promise<HomiModuleServerMutationResult> {
  const found = await database.query<BudgetRow>(
    `SELECT ${BUDGET_SELECT} FROM mod_chequebook.budget_limits
     WHERE household_id=$1::uuid AND id=$2::uuid FOR UPDATE`,
    [context.householdId, input.entityId],
  );
  const current = found.rows[0] ?? null;
  if (input.operation === "create") {
    if (input.baseRevision !== "0" || current) {
      return current ? conflict(current.revision, budgetState(current)) :
        rejected("CHEQUEBOOK_BUDGET_CREATE_INVALID", null, null);
    }
    const value = parseBudgetPayload(input.payload);
    await validateAccountAndCategory(database, context, {
      accountId: (await loadSettings(database, context))!.defaultAccountId,
      transferAccountId: null,
      categoryId: value.categoryId,
      kind: "expense",
    });
    const result = await database.query<BudgetRow>(
      `INSERT INTO mod_chequebook.budget_limits
       (id,household_id,category_id,budget_month,amount,rollover_enabled,revision)
       VALUES ($1::uuid,$2::uuid,$3::uuid,$4::date,$5::numeric,$6,1)
       RETURNING ${BUDGET_SELECT}`,
      [input.entityId, context.householdId, value.categoryId,
       value.budgetMonth, value.amount, value.rolloverEnabled],
    );
    const row = result.rows[0]!;
    return { status: "applied", revision: row.revision, serverState: budgetState(row) };
  }
  if (!current || current.deletedAt !== null) {
    return rejected("CHEQUEBOOK_BUDGET_NOT_FOUND", current?.revision ?? null, current ? budgetState(current) : null);
  }
  if (current.revision !== input.baseRevision) return conflict(current.revision, budgetState(current));
  if (input.operation === "delete") {
    const result = await database.query<BudgetRow>(
      `UPDATE mod_chequebook.budget_limits SET deleted_at=now(),revision=revision+1,updated_at=now()
       WHERE household_id=$1::uuid AND id=$2::uuid RETURNING ${BUDGET_SELECT}`,
      [context.householdId, input.entityId],
    );
    const row = result.rows[0]!;
    return { status: "applied", revision: row.revision, serverState: { ...budgetState(row), deleted: true } };
  }
  if (input.operation !== "update") return rejected("CHEQUEBOOK_OPERATION_UNSUPPORTED", current.revision, budgetState(current));
  const value = parseBudgetPayload(input.payload);
  const result = await database.query<BudgetRow>(
    `UPDATE mod_chequebook.budget_limits SET category_id=$3::uuid,budget_month=$4::date,
       amount=$5::numeric,rollover_enabled=$6,revision=revision+1,updated_at=now()
     WHERE household_id=$1::uuid AND id=$2::uuid RETURNING ${BUDGET_SELECT}`,
    [context.householdId, input.entityId, value.categoryId,
     value.budgetMonth, value.amount, value.rolloverEnabled],
  );
  const row = result.rows[0]!;
  return { status: "applied", revision: row.revision, serverState: budgetState(row) };
}

async function applySettingsMutation(
  context: HomiRequestContext,
  database: HomiModuleDatabase,
  input: HomiModuleServerMutationInput,
): Promise<HomiModuleServerMutationResult> {
  const current = await loadSettings(database, context);
  if (!current) return rejected("CHEQUEBOOK_NOT_CONFIGURED", null, null);
  if (input.operation !== "update" || input.entityId !== context.householdId) {
    return rejected("CHEQUEBOOK_SETTINGS_OPERATION_INVALID", current.revision, current);
  }
  if (current.revision !== input.baseRevision) return conflict(current.revision, current);
  const payload = input.payload;
  const currency = payload.currency;
  if (typeof currency !== "string" || !CURRENCY.test(currency)) {
    throw httpError(400, "CHEQUEBOOK_CURRENCY_INVALID", "Currency must be a three-letter ISO code.");
  }
  const defaultAccountId = uuid(payload.defaultAccountId, "defaultAccountId");
  const lowBalanceThreshold =
    payload.lowBalanceThreshold === null || payload.lowBalanceThreshold === ""
      ? null
      : signedMoney(payload.lowBalanceThreshold);
  const account = await database.query(
    `SELECT 1 FROM mod_chequebook.accounts WHERE household_id=$1::uuid
      AND id=$2::uuid AND deleted_at IS NULL AND archived=false`,
    [context.householdId, defaultAccountId],
  );
  if (account.rows.length !== 1) throw httpError(400, "CHEQUEBOOK_ACCOUNT_INVALID", "Default account is unavailable.");
  const result = await database.query<SettingsRow>(
    `UPDATE mod_chequebook.household_settings SET currency=$2,default_account_id=$3::uuid,
      low_balance_threshold=$4::numeric,revision=revision+1,updated_at=now()
     WHERE household_id=$1::uuid
     RETURNING household_id::text AS "householdId",currency,
       default_account_id::text AS "defaultAccountId",
       low_balance_threshold::text AS "lowBalanceThreshold",
       revision::text AS revision`,
    [context.householdId, currency, defaultAccountId, lowBalanceThreshold],
  );
  const state = settingsState(result.rows[0]!);
  return { status: "applied", revision: state.revision, serverState: state };
}

async function listRecurring(
  database: HomiModuleDatabase,
  context: HomiRequestContext,
): Promise<readonly ChequebookRecurringRule[]> {
  const result = await database.query<RecurringRow>(
    `SELECT ${RECURRING_SELECT} FROM mod_chequebook.recurring_rules
     WHERE household_id=$1::uuid AND deleted_at IS NULL
     ORDER BY active DESC,start_date,label,id`,
    [context.householdId],
  );
  return Object.freeze(result.rows.map(recurringState));
}
function monthBounds(month: string) {
  const start = monthOnly(month);
  const date = new Date(start + "T00:00:00Z");
  date.setUTCMonth(date.getUTCMonth() + 1);
  return { start, endExclusive: date.toISOString().slice(0, 10) };
}
function previousDay(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function recurringOccurrences(
  database: HomiModuleDatabase,
  context: HomiRequestContext,
  start: string,
  end: string,
) {
  const rules = await listRecurring(database, context);
  const projected = expandRecurringRules(
    rules,
    start,
    end,
  );
  const logs = await database.query<{
    ruleId: string;
    occurrenceDate: string | Date;
    status: "pending" | "posted" | "skipped";
    postedTransactionId: string | null;
  }>(
    `SELECT ro.recurring_rule_id::text AS "ruleId",
            ro.occurrence_date AS "occurrenceDate",
            ro.status,
            ro.posted_transaction_id::text AS "postedTransactionId"
     FROM mod_chequebook.recurring_occurrences ro
     JOIN mod_chequebook.recurring_rules rr
       ON rr.id=ro.recurring_rule_id
     WHERE rr.household_id=$1::uuid
       AND ro.occurrence_date >= $2::date
       AND ro.occurrence_date <= $3::date`,
    [context.householdId, start, end],
  );
  const state = new Map(
    logs.rows.map((row) => [
      `${row.ruleId}:${day(row.occurrenceDate)}`,
      row,
    ]),
  );
  return Object.freeze(
    projected.map((occurrence) => {
      const log = state.get(
        `${occurrence.ruleId}:${occurrence.occurrenceDate}`,
      );
      return Object.freeze({
        ...occurrence,
        status: log?.status ?? "pending",
        postedTransactionId:
          log?.postedTransactionId ?? null,
      });
    }),
  );
}

async function monthlySummary(
  database: HomiModuleDatabase,
  context: HomiRequestContext,
  month: string,
  asOf: string,
) {
  const settings = await loadSettings(database, context);
  if (!settings) throw httpError(409, "CHEQUEBOOK_NOT_CONFIGURED", "Complete Chequebook setup.");
  const range = monthBounds(month);
  const actuals = await database.query<{
    income: string;
    expenses: string;
    transfers: string;
  }>(
    `SELECT
       COALESCE(sum(amount) FILTER (WHERE kind='income'),0)::text AS income,
       COALESCE(sum(amount) FILTER (WHERE kind='expense'),0)::text AS expenses,
       COALESCE(sum(amount) FILTER (WHERE kind='transfer'),0)::text AS transfers
     FROM mod_chequebook.transactions
     WHERE household_id=$1::uuid AND deleted_at IS NULL
       AND date >= $2::date AND date < $3::date`,
    [context.householdId, range.start, range.endExclusive],
  );
  const balance = await database.query<{ balance: string }>(
    `SELECT (
       COALESCE((SELECT sum(opening_balance) FROM mod_chequebook.accounts
         WHERE household_id=$1::uuid AND deleted_at IS NULL),0)
       + COALESCE((SELECT sum(CASE
           WHEN kind='income' THEN amount
           WHEN kind='expense' THEN -amount
           WHEN kind='transfer' THEN -amount
           ELSE 0 END)
         FROM mod_chequebook.transactions
         WHERE household_id=$1::uuid AND deleted_at IS NULL),0)
       + COALESCE((SELECT sum(t.amount)
         FROM mod_chequebook.transactions t
         WHERE t.household_id=$1::uuid AND t.deleted_at IS NULL
           AND t.kind='transfer' AND t.transfer_account_id IS NOT NULL),0)
     )::text AS balance`,
    [context.householdId],
  );
  const occurrences = await recurringOccurrences(
    database,
    context,
    asOf < range.start ? range.start : asOf,
    previousDay(range.endExclusive),
  );
  let upcomingIncome = 0;
  let upcomingExpenses = 0;
  for (const occurrence of occurrences) {
    if (occurrence.status !== "pending") continue;
    if (occurrence.kind === "income") {
      upcomingIncome += Number(occurrence.amount);
    }
    if (occurrence.kind === "expense") {
      upcomingExpenses += Number(occurrence.amount);
    }
  }
  const currentBalance = Number(balance.rows[0]?.balance ?? "0");
  const categoryRows = await database.query<{
    categoryId: string;
    categoryName: string;
    spent: string;
    limit: string | null;
  }>(
    `SELECT c.id::text AS "categoryId",c.name AS "categoryName",
       COALESCE(sum(t.amount) FILTER (WHERE t.kind='expense'),0)::text AS spent,
       b.amount::text AS limit
     FROM mod_chequebook.categories c
     LEFT JOIN mod_chequebook.transactions t
       ON t.household_id=c.household_id AND t.category_id=c.id
       AND t.deleted_at IS NULL AND t.date >= $2::date AND t.date < $3::date
     LEFT JOIN mod_chequebook.budget_limits b
       ON b.household_id=c.household_id AND b.category_id=c.id
       AND b.budget_month=$2::date AND b.deleted_at IS NULL
     WHERE c.household_id=$1::uuid AND c.deleted_at IS NULL
     GROUP BY c.id,c.name,b.amount
     ORDER BY c.name`,
    [context.householdId, range.start, range.endExclusive],
  );
  const projectedByCategory = new Map<string, number>();
  const monthOccurrences = await recurringOccurrences(
    database,
    context,
    range.start,
    previousDay(range.endExclusive),
  );
  for (const occurrence of monthOccurrences) {
    if (
      occurrence.status === "pending" &&
      occurrence.kind === "expense" &&
      occurrence.categoryId
    ) {
      projectedByCategory.set(
        occurrence.categoryId,
        (projectedByCategory.get(occurrence.categoryId) ?? 0) +
          Number(occurrence.amount),
      );
    }
  }
  return Object.freeze({
    month: range.start,
    currency: settings.currency,
    income: decimal(actuals.rows[0]?.income ?? "0"),
    expenses: decimal(actuals.rows[0]?.expenses ?? "0"),
    transfers: decimal(actuals.rows[0]?.transfers ?? "0"),
    currentBalance: currentBalance.toFixed(2),
    forecastBalance: (
      currentBalance + upcomingIncome - upcomingExpenses
    ).toFixed(2),
    upcomingRecurringIncome: upcomingIncome.toFixed(2),
    upcomingRecurringExpenses: upcomingExpenses.toFixed(2),
    spentByCategory: Object.freeze(
      categoryRows.rows.map((row) => {
        const projected =
          Number(row.spent) +
          (projectedByCategory.get(row.categoryId) ?? 0);
        const limit =
          row.limit === null ? null : Number(row.limit);
        return Object.freeze({
          categoryId: row.categoryId,
          categoryName: row.categoryName,
          amount: projected.toFixed(2),
          limit: limit === null ? null : limit.toFixed(2),
          percentUsed:
            limit === null || limit <= 0
              ? null
              : Math.round((projected / limit) * 1000) / 10,
        });
      }),
    ),
  });
}

export type ChequebookCalendarColor = "red" | "green" | "blue";

export function evaluateChequebookCalendarColor(
  kind: ChequebookTransactionKind,
): ChequebookCalendarColor {
  switch (kind) {
    case "expense":
      return "red";
    case "income":
      return "green";
    case "transfer":
    default:
      return "blue";
  }
}

export function evaluateChequebookCalendarTitle(
  title: string,
  kind: ChequebookTransactionKind,
): string {
  const prefix = kind === "expense" ? "-" : kind === "income" ? "+" : "";
  const trimmed = title.trim();
  if (!prefix) return trimmed;
  if (trimmed.startsWith(prefix)) return trimmed;
  return `${prefix} ${trimmed}`;
}

async function syncCalendarLinkJob(
  host: HomiServerModuleHostContext,
  database: HomiModuleDatabase,
  context: HomiRequestContext,
  payload: Readonly<Record<string, unknown>>,
) {
  const sourceType = payload.sourceType;
  const sourceId = payload.sourceId;
  if (
    (sourceType !== "transaction" && sourceType !== "recurring-rule") ||
    typeof sourceId !== "string" ||
    !UUID.test(sourceId)
  ) {
    throw new Error("Chequebook calendar-link job payload is invalid.");
  }
  const broker = host.broker;
  if (!broker) throw new Error("Chequebook broker client is unavailable.");
  const settings = await loadSettings(database, context);
  if (!settings) return;

  let enabled = false;
  let invocationPayload: Record<string, unknown> | null = null;
  if (sourceType === "transaction") {
    const result = await database.query<TransactionRow>(
      `SELECT ${TRANSACTION_SELECT} FROM mod_chequebook.transactions
       WHERE household_id=$1::uuid AND id=$2::uuid LIMIT 1`,
      [context.householdId, sourceId],
    );
    const row = result.rows[0];
    if (row && row.deletedAt === null && row.calendarLinkEnabled) {
      const state = transactionState(row);
      enabled = true;
      invocationPayload = {
        sourceModule: CHEQUEBOOK_MODULE_KEY,
        sourceEntityType: "transaction",
        sourceEntityId: state.id,
        title: evaluateChequebookCalendarTitle(state.description, state.kind),
        date: state.date,
        color: evaluateChequebookCalendarColor(state.kind),
        recurrence: null,
        notes: state.notes,
      };
    }
  } else {
    const result = await database.query<RecurringRow>(
      `SELECT ${RECURRING_SELECT} FROM mod_chequebook.recurring_rules
       WHERE household_id=$1::uuid AND id=$2::uuid LIMIT 1`,
      [context.householdId, sourceId],
    );
    const row = result.rows[0];
    if (
      row &&
      row.deletedAt === null &&
      row.active &&
      row.calendarLinkEnabled
    ) {
      const state = recurringState(row);
      enabled = true;
      invocationPayload = {
        sourceModule: CHEQUEBOOK_MODULE_KEY,
        sourceEntityType: "recurring-rule",
        sourceEntityId: state.id,
        title: evaluateChequebookCalendarTitle(state.label, state.kind),
        date: state.startDate,
        color: evaluateChequebookCalendarColor(state.kind),
        recurrence: {
          frequency: state.frequency,
          interval: state.interval,
          until: state.recurrenceUntil,
        },
        notes: state.notes,
      };
    }
  }

  try {
    const result = enabled
      ? await broker.invoke(context, "calendar.linked-events.v1", {
          action: "upsert-linked-event",
          payload: invocationPayload,
        })
      : await broker.invoke(context, "calendar.linked-events.v1", {
          action: "remove-linked-event",
          payload: {
            sourceModule: CHEQUEBOOK_MODULE_KEY,
            sourceEntityType: sourceType,
            sourceEntityId: sourceId,
          },
        });
    const eventId =
      typeof result === "object" &&
      result !== null &&
      !Array.isArray(result) &&
      typeof (result as Record<string, unknown>).eventId === "string"
        ? String((result as Record<string, unknown>).eventId)
        : null;
    await database.query(
      `INSERT INTO mod_chequebook.calendar_links
       (household_id,source_type,source_id,calendar_event_id,status,last_error,updated_at)
       VALUES ($1::uuid,$2,$3::uuid,$4::uuid,$5,NULL,now())
       ON CONFLICT (household_id,source_type,source_id)
       DO UPDATE SET calendar_event_id=EXCLUDED.calendar_event_id,
        status=EXCLUDED.status,last_error=NULL,updated_at=now()`,
      [context.householdId, sourceType, sourceId, eventId,
       enabled ? "linked" : "unlinked"],
    );
  } catch (error) {
    await database.query(
      `INSERT INTO mod_chequebook.calendar_links
       (household_id,source_type,source_id,status,last_error,updated_at)
       VALUES ($1::uuid,$2,$3::uuid,'error',$4,now())
       ON CONFLICT (household_id,source_type,source_id)
       DO UPDATE SET status='error',last_error=EXCLUDED.last_error,updated_at=now()`,
      [
        context.householdId,
        sourceType,
        sourceId,
        error instanceof Error ? error.message.slice(0, 1000) : "Calendar link failed.",
      ],
    );
    throw error;
  }
}

async function brokerLinkedRecurring(
  host: HomiServerModuleHostContext,
  database: HomiModuleDatabase,
  context: HomiRequestContext,
  action: string,
  rawPayload: unknown,
) {
  const payload = object(rawPayload);
  const sourceModule = cleanText(
    payload.sourceModule,
    "sourceModule",
    64,
  );
  const sourceEntityType = cleanText(
    payload.sourceEntityType,
    "sourceEntityType",
    64,
  );
  const sourceEntityId = uuid(
    payload.sourceEntityId,
    "sourceEntityId",
  );
  const linked = await database.query<{
    targetType: string;
    targetId: string;
  }>(
    `SELECT target_type AS "targetType",target_id::text AS "targetId"
     FROM mod_chequebook.module_source_links
     WHERE household_id=$1::uuid AND source_module=$2
       AND source_entity_type=$3 AND source_entity_id=$4::uuid
     LIMIT 1`,
    [
      context.householdId,
      sourceModule,
      sourceEntityType,
      sourceEntityId,
    ],
  );
  const existingLink = linked.rows[0] ?? null;
  const targetId = existingLink?.targetId ?? randomUUID();
  const currentResult = await database.query<RecurringRow>(
    `SELECT ${RECURRING_SELECT}
     FROM mod_chequebook.recurring_rules
     WHERE household_id=$1::uuid AND id=$2::uuid
     LIMIT 1`,
    [context.householdId, targetId],
  );
  const current = currentResult.rows[0] ?? null;

  if (action === "remove-linked-entry") {
    if (!current || current.deletedAt !== null) {
      return { targetType: "recurring-rule", targetId, removed: false };
    }
    const result = await applyRecurringMutation(
      host,
      context,
      database,
      {
        entityId: targetId,
        operation: "delete",
        baseRevision: current.revision,
        payload: {},
      },
      {},
    );
    if (result.status !== "applied") {
      throw new Error("Chequebook linked recurring entry removal failed.");
    }
    await database.query(
      `DELETE FROM mod_chequebook.module_source_links
       WHERE household_id=$1::uuid AND source_module=$2
         AND source_entity_type=$3 AND source_entity_id=$4::uuid`,
      [
        context.householdId,
        sourceModule,
        sourceEntityType,
        sourceEntityId,
      ],
    );
    if (host.sync) {
      await host.sync.publish(context, {
        entityType: "recurring-rule",
        entityId: targetId,
        operation: "delete",
        revision: result.revision,
        serverState: result.serverState,
      });
    }
    return { targetType: "recurring-rule", targetId, removed: true };
  }

  if (action !== "upsert-linked-recurring") {
    throw httpError(
      400,
      "CHEQUEBOOK_BROKER_ACTION_UNSUPPORTED",
      "Unsupported Chequebook broker action.",
    );
  }

  if (
    existingLink &&
    existingLink.targetType !== "recurring-rule"
  ) {
    throw httpError(
      409,
      "CHEQUEBOOK_SOURCE_LINK_CONFLICT",
      "This Calendar event is linked to a different Chequebook entry type.",
    );
  }

  const mutationPayload = {
    accountId: uuid(payload.accountId, "accountId"),
    transferAccountId: null,
    categoryId:
      payload.categoryId === null
        ? null
        : uuid(payload.categoryId, "categoryId"),
    personId: null,
    kind: payload.kind,
    amount: payload.amount,
    label: payload.label,
    notes:
      payload.notes === undefined ? null : payload.notes,
    startDate: payload.startDate,
    frequency: payload.frequency,
    interval: payload.interval,
    recurrenceUntil:
      payload.recurrenceUntil === undefined
        ? null
        : payload.recurrenceUntil,
    active:
      payload.active === undefined ? true : payload.active,
    calendarLinkEnabled: false,
  };
  const result = await applyRecurringMutation(
    host,
    context,
    database,
    {
      entityId: targetId,
      operation:
        current && current.deletedAt === null
          ? "update"
          : "create",
      baseRevision:
        current && current.deletedAt === null
          ? current.revision
          : "0",
      payload: mutationPayload,
    },
    {},
  );
  if (result.status !== "applied") {
    throw httpError(
      409,
      result.errorCode ?? "CHEQUEBOOK_LINK_FAILED",
      "Chequebook could not save the linked recurring entry.",
    );
  }
  await database.query(
    `INSERT INTO mod_chequebook.module_source_links
     (household_id,source_module,source_entity_type,source_entity_id,
      target_type,target_id,updated_at)
     VALUES ($1::uuid,$2,$3,$4::uuid,'recurring-rule',$5::uuid,now())
     ON CONFLICT (
       household_id,source_module,source_entity_type,source_entity_id
     ) DO UPDATE SET target_type='recurring-rule',
       target_id=EXCLUDED.target_id,updated_at=now()`,
    [
      context.householdId,
      sourceModule,
      sourceEntityType,
      sourceEntityId,
      targetId,
    ],
  );
  if (host.sync) {
    await host.sync.publish(context, {
      entityType: "recurring-rule",
      entityId: targetId,
      operation:
        current && current.deletedAt === null
          ? "update"
          : "create",
      revision: result.revision,
      serverState: result.serverState,
    });
  }
  return {
    targetType: "recurring-rule",
    targetId,
    revision: result.revision,
  };
}

async function brokerOptions(
  database: HomiModuleDatabase,
  context: HomiRequestContext,
) {
  const [settings, accounts, categories] = await Promise.all([
    loadSettings(database, context),
    database.query<AccountRow>(
      `SELECT ${ACCOUNT_SELECT} FROM mod_chequebook.accounts
       WHERE household_id=$1::uuid AND deleted_at IS NULL AND archived=false
       ORDER BY name,id`,
      [context.householdId],
    ),
    database.query<CategoryRow>(
      `SELECT ${CATEGORY_SELECT} FROM mod_chequebook.categories
       WHERE household_id=$1::uuid AND deleted_at IS NULL AND archived=false
       ORDER BY name,id`,
      [context.householdId],
    ),
  ]);
  return Object.freeze({
    configured: settings !== null,
    currency: settings?.currency ?? null,
    defaultAccountId: settings?.defaultAccountId ?? null,
    accounts: Object.freeze(accounts.rows.map(accountState)),
    categories: Object.freeze(categories.rows.map(categoryState)),
  });
}

async function listAllRows<T extends Record<string, unknown>>(
  database: HomiModuleDatabase,
  sql: string,
  params: readonly unknown[],
) {
  const result = await database.query<T>(sql, params);
  return result.rows;
}

export function createHomiServerModule(
  host: HomiServerModuleHostContext,
) {
  const database = host.moduleDatabase;

  return defineHomiServerModule({
    moduleKey: CHEQUEBOOK_MODULE_KEY,
    moduleApiVersion: HOMI_MODULE_API_VERSION,

    register(app: FastifyInstance) {
      app.get("/api/v1/modules/chequebook/health", async (request) => {
        await requestContext(host, request);
        return { data: { moduleKey: CHEQUEBOOK_MODULE_KEY, status: "ok" } };
      });

      app.get("/api/v1/modules/chequebook/setup", async (request) => {
        const context = await requestContext(host, request);
        return { data: await setupState(database, context) };
      });

      app.put("/api/v1/modules/chequebook/setup", async (request) => {
        const context = await requestContext(host, request);
        const body = object(request.body);
        const existing = await setupState(database, context);
        if (existing) return { data: existing };
        const currency = body.currency;
        if (typeof currency !== "string" || !CURRENCY.test(currency)) {
          throw httpError(400, "CHEQUEBOOK_CURRENCY_INVALID", "Currency must be a three-letter ISO code.");
        }
        const accountName = cleanText(body.accountName, "accountName", 80);
        const openingBalance = signedMoney(body.openingBalance ?? "0");
        const openingDate = dateOnly(body.openingDate, "openingDate");
        const result = await database.transaction(async (tx) => {
          const accountId = randomUUID();
          await tx.query(
            `INSERT INTO mod_chequebook.accounts
             (id,household_id,name,type,opening_balance,opening_date,archived,revision)
             VALUES ($1::uuid,$2::uuid,$3,'checking',$4::numeric,$5::date,false,1)`,
            [accountId, context.householdId, accountName, openingBalance, openingDate],
          );
          for (const [name, kind, color] of DEFAULT_CATEGORIES) {
            await tx.query(
              `INSERT INTO mod_chequebook.categories
               (id,household_id,name,kind,color,archived,revision)
               VALUES ($1::uuid,$2::uuid,$3,$4,$5,false,1)`,
              [randomUUID(), context.householdId, name, kind, color],
            );
          }
          await tx.query(
            `INSERT INTO mod_chequebook.household_settings
             (household_id,currency,default_account_id,revision)
             VALUES ($1::uuid,$2,$3::uuid,1)`,
            [context.householdId, currency, accountId],
          );
          return true;
        });
        void result;
        return { data: await setupState(database, context) };
      });

      app.get("/api/v1/modules/chequebook/settings", async (request) => {
        const context = await requestContext(host, request);
        const settings = await loadSettings(database, context);
        if (!settings) {
          throw httpError(
            404,
            "CHEQUEBOOK_NOT_CONFIGURED",
            "Chequebook is not configured.",
          );
        }
        return { data: settings };
      });

      app.get("/api/v1/modules/chequebook/accounts", async (request) => {
        const context = await requestContext(host, request);
        const rows = await listAllRows<AccountRow>(
          database,
          `SELECT ${ACCOUNT_SELECT} FROM mod_chequebook.accounts
           WHERE household_id=$1::uuid AND deleted_at IS NULL
           ORDER BY archived,name,id`,
          [context.householdId],
        );
        return { data: rows.map(accountState) };
      });
      app.get("/api/v1/modules/chequebook/accounts/:id", async (request) => {
        const context = await requestContext(host, request);
        const id = uuid((request.params as Record<string, unknown>).id, "id");
        const result = await database.query<AccountRow>(
          `SELECT ${ACCOUNT_SELECT} FROM mod_chequebook.accounts
           WHERE household_id=$1::uuid AND id=$2::uuid AND deleted_at IS NULL`,
          [context.householdId, id],
        );
        if (!result.rows[0]) throw httpError(404, "CHEQUEBOOK_ACCOUNT_NOT_FOUND", "Account not found.");
        return { data: accountState(result.rows[0]) };
      });

      app.get("/api/v1/modules/chequebook/categories", async (request) => {
        const context = await requestContext(host, request);
        const rows = await listAllRows<CategoryRow>(
          database,
          `SELECT ${CATEGORY_SELECT} FROM mod_chequebook.categories
           WHERE household_id=$1::uuid AND deleted_at IS NULL
           ORDER BY archived,name,id`,
          [context.householdId],
        );
        return { data: rows.map(categoryState) };
      });
      app.get("/api/v1/modules/chequebook/categories/:id", async (request) => {
        const context = await requestContext(host, request);
        const id = uuid((request.params as Record<string, unknown>).id, "id");
        const result = await database.query<CategoryRow>(
          `SELECT ${CATEGORY_SELECT} FROM mod_chequebook.categories
           WHERE household_id=$1::uuid AND id=$2::uuid AND deleted_at IS NULL`,
          [context.householdId, id],
        );
        if (!result.rows[0]) throw httpError(404, "CHEQUEBOOK_CATEGORY_NOT_FOUND", "Category not found.");
        return { data: categoryState(result.rows[0]) };
      });

      app.get("/api/v1/modules/chequebook/transactions", async (request) => {
        const context = await requestContext(host, request);
        const query = request.query as Record<string, unknown>;
        const start = query.start === undefined ? null : dateOnly(query.start, "start");
        const end = query.end === undefined ? null : dateOnly(query.end, "end");
        const accountId = query.accountId === undefined ? null : uuid(query.accountId, "accountId");
        const categoryId = query.categoryId === undefined ? null : uuid(query.categoryId, "categoryId");
        const search = typeof query.q === "string" ? query.q.trim().slice(0, 120) : null;
        const result = await database.query<TransactionRow>(
          `SELECT ${TRANSACTION_SELECT} FROM mod_chequebook.transactions
           WHERE household_id=$1::uuid AND deleted_at IS NULL
             AND ($2::date IS NULL OR date >= $2::date)
             AND ($3::date IS NULL OR date <= $3::date)
             AND ($4::uuid IS NULL OR account_id=$4::uuid OR transfer_account_id=$4::uuid)
             AND ($5::uuid IS NULL OR category_id=$5::uuid)
             AND ($6::text IS NULL OR description ILIKE '%'||$6||'%' OR payee ILIKE '%'||$6||'%' OR notes ILIKE '%'||$6||'%')
           ORDER BY date DESC,created_at DESC,id DESC
           LIMIT 1000`,
          [context.householdId, start, end, accountId, categoryId, search],
        );
        return { data: result.rows.map(transactionState) };
      });
      app.get("/api/v1/modules/chequebook/transactions/:id", async (request) => {
        const context = await requestContext(host, request);
        const id = uuid((request.params as Record<string, unknown>).id, "id");
        const result = await database.query<TransactionRow>(
          `SELECT ${TRANSACTION_SELECT} FROM mod_chequebook.transactions
           WHERE household_id=$1::uuid AND id=$2::uuid AND deleted_at IS NULL`,
          [context.householdId, id],
        );
        if (!result.rows[0]) throw httpError(404, "CHEQUEBOOK_TRANSACTION_NOT_FOUND", "Transaction not found.");
        return { data: transactionState(result.rows[0]) };
      });

      app.get("/api/v1/modules/chequebook/recurring-rules", async (request) => {
        const context = await requestContext(host, request);
        return { data: await listRecurring(database, context) };
      });
      app.get("/api/v1/modules/chequebook/recurring-rules/:id", async (request) => {
        const context = await requestContext(host, request);
        const id = uuid((request.params as Record<string, unknown>).id, "id");
        const result = await database.query<RecurringRow>(
          `SELECT ${RECURRING_SELECT} FROM mod_chequebook.recurring_rules
           WHERE household_id=$1::uuid AND id=$2::uuid AND deleted_at IS NULL`,
          [context.householdId, id],
        );
        if (!result.rows[0]) throw httpError(404, "CHEQUEBOOK_RECURRING_NOT_FOUND", "Recurring transaction not found.");
        return { data: recurringState(result.rows[0]) };
      });
      app.get("/api/v1/modules/chequebook/recurring-occurrences", async (request) => {
        const context = await requestContext(host, request);
        const query = request.query as Record<string, unknown>;
        const start = dateOnly(query.start, "start");
        const end = dateOnly(query.end, "end");
        return {
          data: await recurringOccurrences(
            database,
            context,
            start,
            end,
          ),
        };
      });

      app.get("/api/v1/modules/chequebook/budget-limits", async (request) => {
        const context = await requestContext(host, request);
        const query = request.query as Record<string, unknown>;
        const month = query.month === undefined ? null : monthOnly(query.month);
        const result = await database.query<BudgetRow>(
          `SELECT ${BUDGET_SELECT} FROM mod_chequebook.budget_limits
           WHERE household_id=$1::uuid AND deleted_at IS NULL
             AND ($2::date IS NULL OR budget_month=$2::date)
           ORDER BY budget_month DESC,category_id,id`,
          [context.householdId, month],
        );
        return { data: result.rows.map(budgetState) };
      });
      app.get("/api/v1/modules/chequebook/budget-limits/:id", async (request) => {
        const context = await requestContext(host, request);
        const id = uuid((request.params as Record<string, unknown>).id, "id");
        const result = await database.query<BudgetRow>(
          `SELECT ${BUDGET_SELECT} FROM mod_chequebook.budget_limits
           WHERE household_id=$1::uuid AND id=$2::uuid AND deleted_at IS NULL`,
          [context.householdId, id],
        );
        if (!result.rows[0]) throw httpError(404, "CHEQUEBOOK_BUDGET_NOT_FOUND", "Budget limit not found.");
        return { data: budgetState(result.rows[0]) };
      });


      app.get("/api/v1/modules/chequebook/summary", async (request) => {
        const context = await requestContext(host, request);
        const query = request.query as Record<string, unknown>;
        const month = monthOnly(query.month);
        const asOf = query.asOf === undefined
          ? new Date().toISOString().slice(0, 10)
          : dateOnly(query.asOf, "asOf");
        return { data: await monthlySummary(database, context, month, asOf) };
      });

      app.get("/api/v1/modules/chequebook/calendar-links", async (request) => {
        const context = await requestContext(host, request);
        const result = await database.query(
          `SELECT source_type AS "sourceType",source_id::text AS "sourceId",
                  status,calendar_event_id::text AS "calendarEventId",
                  last_error AS "lastError"
           FROM mod_chequebook.calendar_links
           WHERE household_id=$1::uuid ORDER BY source_type,source_id`,
          [context.householdId],
        );
        return { data: result.rows };
      });
    },

    async getSetupStatus(context) {
      const settings = await loadSettings(database, context);
      return { state: settings ? "configured" : "unconfigured" } as const;
    },

    jobs: {
      handlers: [
        {
          jobType: "calendar-link-sync",
          async handle(context, payload) {
            await syncCalendarLinkJob(host, database, context, payload);
          },
        },
      ],
    },

    broker: {
      providers: [
        {
          capability: "chequebook.transactions.v1",
          async handle(context, invocation) {
            if (invocation.action === "options") {
              return brokerOptions(database, context);
            }
            if (
              invocation.action === "upsert-linked-recurring" ||
              invocation.action === "remove-linked-entry"
            ) {
              return brokerLinkedRecurring(
                host,
                database,
                context,
                invocation.action,
                invocation.payload,
              );
            }
            if (invocation.action === "get-linked-transaction") {
              const payload = object(invocation.payload);
              const sourceModule = cleanText(payload.sourceModule, "sourceModule", 64);
              const sourceEntityType = cleanText(payload.sourceEntityType, "sourceEntityType", 64);
              const sourceEntityId = uuid(payload.sourceEntityId, "sourceEntityId");
              const result = await database.query<{
                targetType: string;
                targetId: string;
              }>(
                `SELECT target_type AS "targetType",target_id::text AS "targetId"
                 FROM mod_chequebook.module_source_links
                 WHERE household_id=$1::uuid AND source_module=$2
                   AND source_entity_type=$3 AND source_entity_id=$4::uuid`,
                [context.householdId, sourceModule, sourceEntityType, sourceEntityId],
              );
              return result.rows[0] ?? null;
            }
            throw httpError(
              400,
              "CHEQUEBOOK_BROKER_ACTION_UNSUPPORTED",
              "Unsupported Chequebook broker action.",
            );
          },
        },
      ],
    },

    sync: {
      mutationHandlers: [
        {
          entityType: "account",
          operations: ["create", "update", "delete"],
          apply: applyAccountMutation,
        },
        {
          entityType: "category",
          operations: ["create", "update", "delete"],
          apply: applyCategoryMutation,
        },
        {
          entityType: "transaction",
          operations: ["create", "update", "delete"],
          apply(context, database, input, services) {
            return applyTransactionMutation(
              host,
              context,
              database,
              input,
              services,
            );
          },
        },
        {
          entityType: "recurring-rule",
          operations: ["create", "update", "delete"],
          apply(context, database, input, services) {
            return applyRecurringMutation(
              host,
              context,
              database,
              input,
              services,
            );
          },
        },
        {
          entityType: "budget-limit",
          operations: ["create", "update", "delete"],
          apply: applyBudgetMutation,
        },
        {
          entityType: "chequebook-settings",
          operations: ["update"],
          apply: applySettingsMutation,
        },
      ],
    },
  });
}
