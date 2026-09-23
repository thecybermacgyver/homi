import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  HOMI_MODULE_API_VERSION,
  defineHomiWebModule,
  type HomiWebModuleHostContext,
  type HomiWebModuleMutationInput,
  type HomiWebModuleSurfaceProps,
} from "@homi/module-sdk";
import {
  Badge,
  BottomSheet,
  Button,
  Checkbox,
  Dialog,
  EmptyState,
  FormField,
  ModuleHeader,
  Notice,
  SearchField,
  Select,
  SettingsSection,
  SetupLayout,
  Surface,
  Switch,
  Tabs,
  TextArea,
  TextField,
} from "@homi/ui";
import {
  CHEQUEBOOK_ACCOUNT_TYPES,
  CHEQUEBOOK_MODULE_KEY,
  CHEQUEBOOK_RECURRENCE_FREQUENCIES,
} from "./constants.js";
import {
  expandRecurringRules,
} from "./recurrence.js";
import {
  chequebookChangeHandlers,
  chequebookMutationAdapters,
} from "./sync.js";
import type {
  ChequebookAccount,
  ChequebookBudgetLimit,
  ChequebookCategory,
  ChequebookMonthlySummary,
  ChequebookRecurringOccurrence,
  ChequebookRecurringRule,
  ChequebookSettings,
  ChequebookTransaction,
  ChequebookTransactionKind,
} from "./types.js";

type ChequebookTab =
  | "register"
  | "recurring"
  | "budget"
  | "analytics";

interface SetupSnapshot {
  readonly settings: ChequebookSettings;
  readonly accounts: readonly ChequebookAccount[];
  readonly categories: readonly ChequebookCategory[];
}

interface ModuleCatalogSnapshot {
  readonly modules: readonly {
    readonly moduleKey: string;
    readonly available: boolean;
    readonly enabled: boolean;
  }[];
}

export type RecurringUpdateScope =
  | "now-forward"
  | "now-backward"
  | "all"
  | "this-only";

interface TransactionEditor {
  readonly mode: "create" | "edit";
  readonly transaction: ChequebookTransaction | null;
  kind: ChequebookTransactionKind;
  accountId: string;
  transferAccountId: string;
  categoryId: string;
  amount: string;
  description: string;
  payee: string;
  date: string;
  cleared: boolean;
  reconciled: boolean;
  notes: string;
  calendarLinkEnabled: boolean;
  recurringRuleId: string | null;
  recurringOccurrenceDate: string | null;
  repeatFrequency: "" | ChequebookRecurringRule["frequency"];
  repeatInterval: string;
  repeatUntil: string;
}

interface RecurringEditor {
  readonly mode: "create" | "edit";
  readonly rule: ChequebookRecurringRule | null;
  kind: ChequebookTransactionKind;
  accountId: string;
  transferAccountId: string;
  categoryId: string;
  amount: string;
  label: string;
  startDate: string;
  frequency: ChequebookRecurringRule["frequency"];
  interval: string;
  recurrenceUntil: string;
  active: boolean;
  notes: string;
  calendarLinkEnabled: boolean;
}

function isObject(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function headers(
  context?: HomiWebModuleHostContext | null,
): Record<string, string> {
  return {
    "X-Homi-Household-ID": context?.householdId ?? "",
    "X-Homi-Client-ID": context?.clientId ?? "",
  };
}

async function readJson(
  response: Response,
): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      "Chequebook returned an invalid response.",
    );
  }
}

function responseError(
  body: unknown,
  fallback: string,
): Error {
  if (
    isObject(body) &&
    isObject(body.error) &&
    typeof body.error.message === "string"
  ) {
    return new Error(body.error.message);
  }
  return new Error(fallback);
}

async function apiData<T>(
  context: HomiWebModuleHostContext,
  path: string,
): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: headers(context),
  });
  const body = await readJson(response);
  if (!response.ok) {
    throw responseError(
      body,
      "Chequebook could not load this information.",
    );
  }
  if (!isObject(body) || !Object.hasOwn(body, "data")) {
    throw new Error(
      "Chequebook response shape is invalid.",
    );
  }
  return body.data as T;
}

async function putData<T>(
  context: HomiWebModuleHostContext,
  path: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(path, {
    method: "PUT",
    credentials: "same-origin",
    headers: {
      ...headers(context),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const body = await readJson(response);
  if (!response.ok) {
    throw responseError(
      body,
      "Chequebook could not save this information.",
    );
  }
  if (!isObject(body) || !Object.hasOwn(body, "data")) {
    throw new Error(
      "Chequebook response shape is invalid.",
    );
  }
  return body.data as T;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthKey(date = today()): string {
  return date.slice(0, 7) + "-01";
}

function monthEnd(month: string): string {
  const value = new Date(month + "T00:00:00Z");
  value.setUTCMonth(value.getUTCMonth() + 1);
  value.setUTCDate(0);
  return value.toISOString().slice(0, 10);
}

function addMonths(
  month: string,
  delta: number,
): string {
  const value = new Date(month + "T00:00:00Z");
  value.setUTCMonth(value.getUTCMonth() + delta);
  return value.toISOString().slice(0, 7) + "-01";
}

function formatMonth(
  month: string,
  locale: string,
): string {
  return new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(month + "T00:00:00Z"));
}

function formatMoney(
  amount: string | number,
  currency: string,
  locale: string,
): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(Number(amount));
}

function signed(
  kind: ChequebookTransactionKind,
  amount: string,
): number {
  if (kind === "income") return Number(amount);
  if (kind === "expense") return -Number(amount);
  return 0;
}

function parseCached<T>(
  value: unknown,
): T | null {
  if (
    !isObject(value) ||
    typeof value.revision !== "string" ||
    !/^[1-9][0-9]*$/.test(value.revision)
  ) {
    return null;
  }
  return value as T;
}

async function cached<T>(
  actions: HomiWebModuleSurfaceProps["actions"],
  entityType: string,
): Promise<readonly T[]> {
  const rows =
    await actions.listCachedEntities(entityType);
  return Object.freeze(
    rows
      .map((row) => parseCached<T>(row.data))
      .filter(
        (value): value is T => value !== null,
      ),
  );
}

async function seedCollection<
  T extends { id: string; revision: string },
>(
  actions: HomiWebModuleSurfaceProps["actions"],
  entityType: string,
  values: readonly T[],
): Promise<void> {
  await actions.replaceCachedEntities(
    entityType,
    values.map((value) => ({
      entityId: value.id,
      revision: value.revision,
      data: value,
    })),
  );
}

async function seedSettings(
  actions: HomiWebModuleSurfaceProps["actions"],
  settings: ChequebookSettings,
): Promise<void> {
  await actions.replaceCachedEntities(
    "chequebook-settings",
    [
      {
        entityId: settings.householdId,
        revision: settings.revision,
        data: settings,
      },
    ],
  );
}

function offlineSummary(
  month: string,
  settings: ChequebookSettings,
  accounts: readonly ChequebookAccount[],
  transactions: readonly ChequebookTransaction[],
  rules: readonly ChequebookRecurringRule[],
  categories: readonly ChequebookCategory[],
  limits: readonly ChequebookBudgetLimit[],
): ChequebookMonthlySummary {
  const end = monthEnd(month);
  const inMonth = transactions.filter(
    (item) =>
      item.date >= month && item.date <= end,
  );
  const income = inMonth
    .filter((item) => item.kind === "income")
    .reduce(
      (sum, item) =>
        sum + Number(item.amount),
      0,
    );
  const expenses = inMonth
    .filter((item) => item.kind === "expense")
    .reduce(
      (sum, item) =>
        sum + Number(item.amount),
      0,
    );
  const transfers = inMonth
    .filter((item) => item.kind === "transfer")
    .reduce(
      (sum, item) =>
        sum + Number(item.amount),
      0,
    );
  const current =
    accounts.reduce(
      (sum, account) =>
        sum + Number(account.openingBalance),
      0,
    ) +
    transactions.reduce(
      (sum, item) =>
        sum + signed(item.kind, item.amount),
      0,
    );
  const posted = new Set(
    transactions
      .filter(
        (item) =>
          item.recurringRuleId !== null &&
          item.recurringOccurrenceDate !== null,
      )
      .map(
        (item) =>
          item.recurringRuleId +
          ":" +
          item.recurringOccurrenceDate,
      ),
  );
  const future = expandRecurringRules(
    rules,
    today() < month ? month : today(),
    end,
  ).filter(
    (occurrence) =>
      !posted.has(
        occurrence.ruleId +
          ":" +
          occurrence.occurrenceDate,
      ),
  );
  const upcomingIncome = future
    .filter((item) => item.kind === "income")
    .reduce(
      (sum, item) =>
        sum + Number(item.amount),
      0,
    );
  const upcomingExpenses = future
    .filter((item) => item.kind === "expense")
    .reduce(
      (sum, item) =>
        sum + Number(item.amount),
      0,
    );
  const projected = expandRecurringRules(
    rules,
    month,
    end,
  ).filter(
    (occurrence) =>
      !posted.has(
        occurrence.ruleId +
          ":" +
          occurrence.occurrenceDate,
      ),
  );

  return {
    month,
    currency: settings.currency,
    income: income.toFixed(2),
    expenses: expenses.toFixed(2),
    transfers: transfers.toFixed(2),
    currentBalance: current.toFixed(2),
    forecastBalance: (
      current +
      upcomingIncome -
      upcomingExpenses
    ).toFixed(2),
    upcomingRecurringIncome:
      upcomingIncome.toFixed(2),
    upcomingRecurringExpenses:
      upcomingExpenses.toFixed(2),
    spentByCategory: categories
      .filter((category) => !category.archived)
      .map((category) => {
        const actual = inMonth
          .filter(
            (item) =>
              item.kind === "expense" &&
              item.categoryId === category.id,
          )
          .reduce(
            (sum, item) =>
              sum + Number(item.amount),
            0,
          );
        const pending = projected
          .filter(
            (item) =>
              item.kind === "expense" &&
              item.categoryId === category.id,
          )
          .reduce(
            (sum, item) =>
              sum + Number(item.amount),
            0,
          );
        const limit =
          limits.find(
            (item) =>
              item.categoryId === category.id &&
              item.budgetMonth === month,
          )?.amount ?? null;
        const total = actual + pending;
        return {
          categoryId: category.id,
          categoryName: category.name,
          amount: total.toFixed(2),
          limit,
          percentUsed:
            limit === null ||
            Number(limit) <= 0
              ? null
              : Math.round(
                  (total / Number(limit)) *
                    1000,
                ) / 10,
        };
      }),
  };
}

function cleanAmount(raw: unknown, allowZero = false): string {
  const str =
    typeof raw === "string"
      ? raw.trim()
      : typeof raw === "number" && Number.isFinite(raw)
        ? String(raw)
        : "";
  const num = Number(str);
  if (!Number.isFinite(num) || (allowZero ? num < 0 : num <= 0) || num > 999999999999.99) {
    throw new Error("Amount must be a positive number.");
  }
  return num.toFixed(2);
}

function cleanDate(raw: unknown, fieldName = "Date"): string {
  if (raw instanceof Date) {
    return raw.toISOString().slice(0, 10);
  }
  if (typeof raw !== "string") {
    throw new Error(`${fieldName} must be a valid date string.`);
  }
  let str = raw.trim();
  if (str.length > 10) {
    str = str.slice(0, 10);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    throw new Error(`${fieldName} must be in YYYY-MM-DD format.`);
  }
  const parsed = new Date(str + "T00:00:00Z");
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== str) {
    throw new Error(`${fieldName} is an invalid calendar date.`);
  }
  return str;
}

function cleanUuid(raw: unknown, fieldName = "ID"): string {
  if (
    typeof raw !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      raw.trim(),
    )
  ) {
    throw new Error(`${fieldName} must be selected.`);
  }
  return raw.trim();
}

function cleanNullableUuid(raw: unknown): string | null {
  if (!raw || typeof raw !== "string" || !raw.trim()) return null;
  const str = raw.trim();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      str,
    )
  ) {
    return null;
  }
  return str;
}

function transactionPayload(
  editor: {
    mode?: string;
    kind: string;
    accountId: string;
    transferAccountId?: string | null;
    categoryId?: string | null;
    amount: string;
    description: string;
    payee?: string | null;
    date: string;
    cleared?: boolean;
    reconciled?: boolean;
    reconciledAt?: string | null;
    notes?: string | null;
    recurringRuleId?: string | null;
    recurringOccurrenceDate?: string | null;
    calendarLinkEnabled?: boolean;
    transaction?: ChequebookTransaction | null;
  },
): Record<string, unknown> {
  const accountId = cleanUuid(editor.accountId, "Account");
  const kind = editor.kind;
  if (kind !== "expense" && kind !== "income" && kind !== "transfer") {
    throw new Error("Transaction type is invalid.");
  }

  let transferAccountId: string | null = null;
  if (kind === "transfer") {
    transferAccountId = cleanUuid(
      editor.transferAccountId,
      "Transfer destination account",
    );
    if (transferAccountId === accountId) {
      throw new Error(
        "Transfer destination account must be different from source account.",
      );
    }
  }

  const categoryId =
    kind === "transfer"
      ? null
      : cleanNullableUuid(editor.categoryId);

  const amount = cleanAmount(editor.amount);
  const description = (editor.description ?? "").trim();
  if (!description) {
    throw new Error("Description is required.");
  }
  const date = cleanDate(editor.date, "Date");
  const payee =
    editor.payee && editor.payee.trim() ? editor.payee.trim().slice(0, 160) : null;
  const notes =
    editor.notes && editor.notes.trim() ? editor.notes.trim().slice(0, 2000) : null;

  let reconciledAt: string | null = null;
  if (editor.reconciled || (editor.reconciledAt && typeof editor.reconciledAt === "string")) {
    const rawReconciledAt =
      editor.reconciledAt ?? editor.transaction?.reconciledAt ?? new Date().toISOString();
    if (!Number.isNaN(Date.parse(rawReconciledAt))) {
      reconciledAt = new Date(rawReconciledAt).toISOString();
    }
  }

  // Recurrence coupling: Fastify schema requires (recurringRuleId === null) === (recurringOccurrenceDate === null)
  const cleanRuleId = cleanNullableUuid(editor.recurringRuleId);
  let cleanOccDate: string | null = null;
  if (cleanRuleId !== null) {
    const rawOcc =
      editor.recurringOccurrenceDate ??
      editor.transaction?.recurringOccurrenceDate ??
      null;
    if (rawOcc) {
      try {
        cleanOccDate = cleanDate(rawOcc, "Occurrence date");
      } catch {
        cleanOccDate = null;
      }
    }
    if (!cleanOccDate) {
      cleanOccDate = date;
    }
  }

  const recurringRuleId = cleanRuleId;
  const recurringOccurrenceDate = cleanRuleId !== null ? cleanOccDate : null;

  const calendarLinkEnabled =
    kind !== "transfer" && Boolean(editor.calendarLinkEnabled);

  return {
    accountId,
    transferAccountId,
    categoryId,
    personId: null,
    kind,
    amount,
    description: description.slice(0, 200),
    payee,
    date,
    cleared: Boolean(editor.cleared),
    reconciledAt,
    notes,
    recurringRuleId,
    recurringOccurrenceDate,
    calendarLinkEnabled,
  };
}

function recurringPayload(
  editor: {
    mode?: string;
    rule?: ChequebookRecurringRule | null;
    kind: string;
    accountId: string;
    transferAccountId?: string | null;
    categoryId?: string | null;
    amount: string;
    label: string;
    notes?: string | null;
    startDate: string;
    frequency: string;
    interval: string | number;
    recurrenceUntil?: string | null;
    active?: boolean;
    calendarLinkEnabled?: boolean;
  },
): Record<string, unknown> {
  const accountId = cleanUuid(editor.accountId, "Account");
  const kind = editor.kind;
  if (kind !== "expense" && kind !== "income" && kind !== "transfer") {
    throw new Error("Transaction type is invalid.");
  }

  let transferAccountId: string | null = null;
  if (kind === "transfer") {
    transferAccountId = cleanUuid(
      editor.transferAccountId,
      "Transfer destination account",
    );
    if (transferAccountId === accountId) {
      throw new Error(
        "Transfer destination account must be different from source account.",
      );
    }
  }

  const categoryId =
    kind === "transfer"
      ? null
      : cleanNullableUuid(editor.categoryId);

  const amount = cleanAmount(editor.amount);
  const label = (editor.label ?? "").trim();
  if (!label) {
    throw new Error("Label is required.");
  }
  const startDate = cleanDate(editor.startDate, "Start date");
  const frequency = editor.frequency;
  if (!CHEQUEBOOK_RECURRENCE_FREQUENCIES.includes(frequency as never)) {
    throw new Error("Recurrence frequency is invalid.");
  }
  const intervalNum = Number(editor.interval);
  const interval =
    Number.isSafeInteger(intervalNum) && intervalNum >= 1 && intervalNum <= 365
      ? intervalNum
      : 1;

  let recurrenceUntil: string | null = null;
  if (
    editor.recurrenceUntil &&
    typeof editor.recurrenceUntil === "string" &&
    editor.recurrenceUntil.trim()
  ) {
    const rawUntil = cleanDate(editor.recurrenceUntil, "Repeat-until date");
    if (rawUntil < startDate) {
      throw new Error("Repeat-until cannot precede start date.");
    }
    recurrenceUntil = rawUntil;
  }

  const notes =
    editor.notes && editor.notes.trim() ? editor.notes.trim().slice(0, 2000) : null;
  const calendarLinkEnabled =
    kind !== "transfer" && Boolean(editor.calendarLinkEnabled);

  return {
    accountId,
    transferAccountId,
    categoryId,
    personId: null,
    kind,
    amount,
    label: label.slice(0, 200),
    notes,
    startDate,
    frequency,
    interval,
    recurrenceUntil,
    active: editor.active !== undefined ? Boolean(editor.active) : true,
    calendarLinkEnabled,
  };
}

function ChequebookPage({
  context,
  actions,
}: HomiWebModuleSurfaceProps) {
  const householdId = context?.householdId ?? "";
  const online = Boolean(context?.online);
  const locale = context?.locale ?? "en";
  const [tab, setTab] =
    useState<ChequebookTab>("register");
  const [month, setMonth] =
    useState(monthKey());
  const [settings, setSettings] =
    useState<ChequebookSettings | null>(null);
  const [accounts, setAccounts] = useState<
    readonly ChequebookAccount[]
  >([]);
  const [categories, setCategories] =
    useState<readonly ChequebookCategory[]>([]);
  const [transactions, setTransactions] =
    useState<
      readonly ChequebookTransaction[]
    >([]);
  const [rules, setRules] = useState<
    readonly ChequebookRecurringRule[]
  >([]);
  const [limits, setLimits] = useState<
    readonly ChequebookBudgetLimit[]
  >([]);
  const [summary, setSummary] =
    useState<ChequebookMonthlySummary | null>(
      null,
    );
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [accountFilter, setAccountFilter] =
    useState("all");
  const [message, setMessage] =
    useState<string | null>(null);
  const [editor, setEditor] =
    useState<TransactionEditor | null>(null);
  const [recurringEditor, setRecurringEditor] =
    useState<RecurringEditor | null>(null);
  const [recurringScopePrompt, setRecurringScopePrompt] = useState<{
    pendingEditor: TransactionEditor;
    rule: ChequebookRecurringRule;
  } | null>(null);
  const [selectedScope, setSelectedScope] =
    useState<RecurringUpdateScope>("now-forward");
  const [limitCategoryId, setLimitCategoryId] =
    useState("");
  const [limitAmount, setLimitAmount] =
    useState("");
  const [busy, setBusy] = useState(false);
  const [calendarEnabled, setCalendarEnabled] =
    useState<boolean | null>(null);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  const activeAccounts = useMemo(
    () =>
      accounts.filter((item) => !item.archived),
    [accounts],
  );
  const activeCategories = useMemo(
    () =>
      categories.filter(
        (item) => !item.archived,
      ),
    [categories],
  );

  const latestRef = useRef({
    openNewTransaction,
    setSearchOpen,
    setTab,
  });
  latestRef.current = {
    openNewTransaction,
    setSearchOpen,
    setTab,
  };

  useEffect(() => {
    actions.registerContextActions({
      search: {
        label: "Search Chequebook",
        invoke: () => {
          latestRef.current.setTab("register");
          latestRef.current.setSearchOpen((current) => !current);
        },
      },
      create: {
        label: "Add transaction",
        available: activeAccounts.length > 0,
        invoke: () => latestRef.current.openNewTransaction(),
      },
    });
    return () => actions.registerContextActions(null);
  }, [actions, activeAccounts.length]);

  const accountById = useMemo(
    () =>
      new Map(
        accounts.map((item) => [
          item.id,
          item,
        ]),
      ),
    [accounts],
  );
  const categoryById = useMemo(
    () =>
      new Map(
        categories.map((item) => [
          item.id,
          item,
        ]),
      ),
    [categories],
  );

  const reloadCached = useCallback(
    async () => {
      const [
        nextAccounts,
        nextCategories,
        nextTransactions,
        nextRules,
        nextLimits,
        nextSettings,
      ] = await Promise.all([
        cached<ChequebookAccount>(
          actionsRef.current,
          "account",
        ),
        cached<ChequebookCategory>(
          actionsRef.current,
          "category",
        ),
        cached<ChequebookTransaction>(
          actionsRef.current,
          "transaction",
        ),
        cached<ChequebookRecurringRule>(
          actionsRef.current,
          "recurring-rule",
        ),
        cached<ChequebookBudgetLimit>(
          actionsRef.current,
          "budget-limit",
        ),
        cached<ChequebookSettings>(
          actionsRef.current,
          "chequebook-settings",
        ),
      ]);
      setAccounts(nextAccounts);
      setCategories(nextCategories);
      setTransactions(
        [...nextTransactions].sort(
          (a, b) =>
            b.date.localeCompare(a.date) ||
            b.createdAt.localeCompare(
              a.createdAt,
            ),
        ),
      );
      setRules(nextRules);
      setLimits(nextLimits);
      setSettings(
        nextSettings[0] ?? null,
      );
    },
    [],
  );

  const refreshOnline = useCallback(
    async () => {
      if (!online) return;
      const setup =
        await apiData<SetupSnapshot | null>(
          context,
          "/api/v1/modules/chequebook/setup",
        );
      if (!setup) return;
      const [
        nextTransactions,
        nextRules,
        nextLimits,
        nextSummary,
      ] = await Promise.all([
        apiData<
          readonly ChequebookTransaction[]
        >(
          context,
          "/api/v1/modules/chequebook/transactions",
        ),
        apiData<
          readonly ChequebookRecurringRule[]
        >(
          context,
          "/api/v1/modules/chequebook/recurring-rules",
        ),
        apiData<
          readonly ChequebookBudgetLimit[]
        >(
          context,
          "/api/v1/modules/chequebook/budget-limits",
        ),
        apiData<ChequebookMonthlySummary>(
          context,
          `/api/v1/modules/chequebook/summary?month=${encodeURIComponent(
            month,
          )}&asOf=${today()}`,
        ),
      ]);
      await Promise.all([
        seedSettings(
          actionsRef.current,
          setup.settings,
        ),
        seedCollection(
          actionsRef.current,
          "account",
          setup.accounts,
        ),
        seedCollection(
          actionsRef.current,
          "category",
          setup.categories,
        ),
        seedCollection(
          actionsRef.current,
          "transaction",
          nextTransactions,
        ),
        seedCollection(
          actionsRef.current,
          "recurring-rule",
          nextRules,
        ),
        seedCollection(
          actionsRef.current,
          "budget-limit",
          nextLimits,
        ),
      ]);
      setSettings(setup.settings);
      setAccounts(setup.accounts);
      setCategories(setup.categories);
      setTransactions(nextTransactions);
      setRules(nextRules);
      setLimits(nextLimits);
      setSummary(nextSummary);
    },
    [householdId, online, month],
  );

  useEffect(() => {
    void reloadCached()
      .then(() => {
        if (online) {
          return refreshOnline();
        }
      })
      .catch((error: unknown) =>
        setMessage(
          error instanceof Error
            ? error.message
            : "Chequebook could not be loaded.",
        ),
      );
  }, [
    householdId,
    online,
    month,
    reloadCached,
    refreshOnline,
  ]);

  useEffect(() => {
    if (!online) return;
    void apiData<ModuleCatalogSnapshot>(
      context,
      "/api/v1/core/modules",
    )
      .then((catalog) => {
        const calendar = catalog.modules.find(
          (item) => item.moduleKey === "calendar",
        );
        setCalendarEnabled(
          calendar?.available === true && calendar.enabled === true,
        );
      })
      .catch(() => setCalendarEnabled(false));
  }, [householdId, online]);

  useEffect(() => {
    if (!settings || online) return;
    setSummary(
      offlineSummary(
        month,
        settings,
        accounts,
        transactions,
        rules,
        categories,
        limits,
      ),
    );
  }, [
    accounts,
    categories,
    online,
    limits,
    month,
    rules,
    settings,
    transactions,
  ]);

  async function enqueueMutations(
    mutations: readonly HomiWebModuleMutationInput[],
    success: string,
  ): Promise<void> {
    for (const mutation of mutations) {
      await actions.enqueueMutation(mutation);
    }
    await reloadCached();
    if (online) {
      try {
        await actions.syncNow();
        await refreshOnline();
        setMessage(success);
      } catch (syncErr) {
        console.warn("Chequebook sync/refresh delayed:", syncErr);
        setMessage(`${success} Synced locally.`);
      }
    } else {
      setMessage(
        success +
          " It will synchronize automatically after reconnecting.",
      );
    }
  }

  async function queue(
    entityType: string,
    entityId: string,
    operation: string,
    baseRevision: string,
    payload: Record<string, unknown>,
    success: string,
  ): Promise<void> {
    await enqueueMutations(
      [{ entityType, entityId, operation, baseRevision, payload }],
      success,
    );
  }

  function openNewTransaction(
    occurrence?: ChequebookRecurringOccurrence,
  ): void {
    const rule =
      occurrence === undefined
        ? null
        : rules.find(
            (item) =>
              item.id === occurrence.ruleId,
          ) ?? null;
    setEditor({
      mode: "create",
      transaction: null,
      kind: rule?.kind ?? "expense",
      accountId:
        rule?.accountId ??
        settings?.defaultAccountId ??
        activeAccounts[0]?.id ??
        "",
      transferAccountId:
        rule?.transferAccountId ?? "",
      categoryId: rule?.categoryId ?? "",
      amount: rule?.amount ?? "",
      description: rule?.label ?? "",
      payee: "",
      date:
        occurrence?.occurrenceDate ??
        today(),
      cleared: occurrence !== undefined,
      reconciled: false,
      notes: rule?.notes ?? "",
      calendarLinkEnabled: false,
      recurringRuleId: rule?.id ?? null,
      recurringOccurrenceDate:
        occurrence?.occurrenceDate ?? null,
      repeatFrequency: rule?.frequency ?? "",
      repeatInterval: String(rule?.interval ?? 1),
      repeatUntil: rule?.recurrenceUntil ?? "",
    });
  }

  function openEditTransaction(
    item: ChequebookTransaction,
  ): void {
    const rule = item.recurringRuleId === null
      ? null
      : rules.find((candidate) => candidate.id === item.recurringRuleId) ?? null;
    setEditor({
      mode: "edit",
      transaction: item,
      kind: item.kind,
      accountId: item.accountId,
      transferAccountId:
        item.transferAccountId ?? "",
      categoryId: item.categoryId ?? "",
      amount: item.amount,
      description: item.description,
      payee: item.payee ?? "",
      date: item.date,
      cleared: item.cleared,
      reconciled:
        item.reconciledAt !== null,
      notes: item.notes ?? "",
      calendarLinkEnabled:
        item.calendarLinkEnabled,
      recurringRuleId:
        item.recurringRuleId,
      recurringOccurrenceDate:
        item.recurringOccurrenceDate,
      repeatFrequency: rule?.frequency ?? "",
      repeatInterval: String(rule?.interval ?? 1),
      repeatUntil: rule?.recurrenceUntil ?? "",
    });
  }

  async function saveTransaction(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (!editor || busy) return;

    const existingRule =
      editor.recurringRuleId === null
        ? null
        : rules.find((rule) => rule.id === editor.recurringRuleId) ?? null;

    // Validate inputs upfront
    try {
      transactionPayload(editor);
      if (editor.repeatFrequency !== "") {
        recurringPayload({
          mode: existingRule === null ? "create" : "edit",
          rule: existingRule,
          kind: editor.kind,
          accountId: editor.accountId,
          transferAccountId: editor.transferAccountId,
          categoryId: editor.categoryId,
          amount: editor.amount,
          label: editor.description,
          startDate: editor.date,
          frequency: editor.repeatFrequency,
          interval: editor.repeatInterval,
          recurrenceUntil: editor.repeatUntil,
          active: true,
          notes: editor.notes,
          calendarLinkEnabled: editor.calendarLinkEnabled,
        });
      }
    } catch (validationError) {
      setMessage(
        validationError instanceof Error
          ? validationError.message
          : "Please check your transaction entries.",
      );
      return;
    }

    if (existingRule !== null) {
      const templateChanged =
        (editor.mode === "create" && editor.recurringOccurrenceDate === null) ||
        (editor.mode === "create" &&
          (editor.kind !== existingRule.kind ||
            Number(editor.amount) !== Number(existingRule.amount) ||
            editor.accountId !== existingRule.accountId ||
            editor.transferAccountId !== (existingRule.transferAccountId ?? "") ||
            editor.categoryId !== (existingRule.categoryId ?? "") ||
            editor.description !== existingRule.label ||
            editor.date !== (editor.recurringOccurrenceDate ?? existingRule.startDate) ||
            (editor.repeatFrequency !== "" && editor.repeatFrequency !== existingRule.frequency) ||
            (editor.repeatInterval !== "" && editor.repeatInterval !== String(existingRule.interval)) ||
            editor.repeatUntil !== (existingRule.recurrenceUntil ?? ""))) ||
        (editor.transaction !== null &&
          (editor.kind !== existingRule.kind ||
            Number(editor.amount) !== Number(existingRule.amount) ||
            editor.accountId !== existingRule.accountId ||
            editor.transferAccountId !== (existingRule.transferAccountId ?? "") ||
            editor.categoryId !== (existingRule.categoryId ?? "") ||
            editor.description !== existingRule.label ||
            editor.date !== (editor.transaction.recurringOccurrenceDate ?? editor.transaction.date) ||
            (editor.repeatFrequency !== "" && editor.repeatFrequency !== existingRule.frequency) ||
            (editor.repeatInterval !== "" && editor.repeatInterval !== String(existingRule.interval)) ||
            editor.repeatUntil !== (existingRule.recurrenceUntil ?? "")));

      if (templateChanged) {
        setRecurringScopePrompt({ pendingEditor: editor, rule: existingRule });
        setSelectedScope("now-forward");
        return;
      }
    }

    setBusy(true);
    try {
      let transactionEditor = editor;

      if (existingRule !== null) {
        if (editor.repeatFrequency === "") {
          await queue(
            "recurring-rule",
            existingRule.id,
            "update",
            existingRule.revision,
            recurringPayload({
              mode: "edit",
              rule: existingRule,
              kind: existingRule.kind,
              accountId: existingRule.accountId,
              transferAccountId: existingRule.transferAccountId ?? "",
              categoryId: existingRule.categoryId ?? "",
              amount: existingRule.amount,
              label: existingRule.label,
              startDate: existingRule.startDate,
              frequency: existingRule.frequency,
              interval: String(existingRule.interval),
              recurrenceUntil: existingRule.recurrenceUntil ?? "",
              active: false,
              notes: existingRule.notes ?? "",
              calendarLinkEnabled: existingRule.calendarLinkEnabled,
            }),
            "Recurring schedule stopped.",
          );
          transactionEditor = {
            ...editor,
            recurringRuleId: null,
            recurringOccurrenceDate: null,
          };
        } else {
          const preservedOccDate =
            editor.recurringOccurrenceDate ??
            editor.transaction?.recurringOccurrenceDate ??
            editor.date;
          transactionEditor = {
            ...editor,
            recurringRuleId: existingRule.id,
            recurringOccurrenceDate: preservedOccDate,
          };
        }
      } else if (editor.repeatFrequency !== "") {
        const ruleId = crypto.randomUUID();
        await queue(
          "recurring-rule",
          ruleId,
          "create",
          "0",
          recurringPayload({
            mode: "create",
            rule: null,
            kind: editor.kind,
            accountId: editor.accountId,
            transferAccountId: editor.transferAccountId,
            categoryId: editor.categoryId,
            amount: editor.amount,
            label: editor.description,
            startDate: editor.date,
            frequency: editor.repeatFrequency,
            interval: editor.repeatInterval,
            recurrenceUntil: editor.repeatUntil,
            active: true,
            notes: editor.notes,
            calendarLinkEnabled: editor.calendarLinkEnabled,
          }),
          "Recurring schedule saved.",
        );
        transactionEditor = {
          ...editor,
          recurringRuleId: ruleId,
          recurringOccurrenceDate: editor.date,
        };
      } else {
        transactionEditor = {
          ...editor,
          recurringRuleId: null,
          recurringOccurrenceDate: null,
        };
      }

      await queue(
        "transaction",
        editor.transaction?.id ?? crypto.randomUUID(),
        editor.mode === "create" ? "create" : "update",
        editor.transaction?.revision ?? "0",
        transactionPayload(transactionEditor),
        "Transaction saved.",
      );
      setEditor(null);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Transaction could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function applyRecurringUpdate(
    scope: RecurringUpdateScope,
  ): Promise<void> {
    if (!recurringScopePrompt || busy) return;
    const { pendingEditor, rule } = recurringScopePrompt;
    setBusy(true);
    try {
      const mutationsToEnqueue: HomiWebModuleMutationInput[] = [];

      const originalOccurrenceDate =
        pendingEditor.transaction?.recurringOccurrenceDate ??
        pendingEditor.recurringOccurrenceDate ??
        pendingEditor.date;

      // 1. Update recurring rule template if scope is "now-forward" or "all"
      if (scope === "now-forward" || scope === "all") {
        const nextFrequency =
          pendingEditor.repeatFrequency !== ""
            ? pendingEditor.repeatFrequency
            : rule.frequency;

        const nextInterval =
          pendingEditor.repeatInterval !== ""
            ? pendingEditor.repeatInterval
            : rule.interval;

        const nextUntil =
          pendingEditor.repeatUntil !== ""
            ? pendingEditor.repeatUntil
            : (rule.recurrenceUntil ?? "");

        mutationsToEnqueue.push({
          entityType: "recurring-rule",
          entityId: rule.id,
          operation: "update",
          baseRevision: rule.revision,
          payload: recurringPayload({
            kind: pendingEditor.kind,
            accountId: pendingEditor.accountId,
            transferAccountId: pendingEditor.transferAccountId,
            categoryId: pendingEditor.categoryId,
            amount: pendingEditor.amount,
            label: pendingEditor.description,
            startDate: pendingEditor.date,
            frequency: nextFrequency,
            interval: nextInterval,
            recurrenceUntil: nextUntil,
            active: rule.active,
            notes: pendingEditor.notes,
            calendarLinkEnabled: pendingEditor.calendarLinkEnabled,
          }),
        });
      }

      // 2. Prepare target transaction mutation
      let targetRuleId: string | null = null;
      let targetOccDate: string | null = null;

      if (scope === "all" || scope === "now-forward") {
        targetRuleId = rule.id;
        targetOccDate = pendingEditor.date;
      } else {
        const matchesRule =
          pendingEditor.kind === rule.kind &&
          Number(pendingEditor.amount) === Number(rule.amount) &&
          pendingEditor.accountId === rule.accountId &&
          pendingEditor.transferAccountId === (rule.transferAccountId ?? "") &&
          pendingEditor.categoryId === (rule.categoryId ?? "") &&
          pendingEditor.date === originalOccurrenceDate;

        if (matchesRule) {
          targetRuleId = rule.id;
          targetOccDate = originalOccurrenceDate;
        } else {
          targetRuleId = null;
          targetOccDate = null;
        }
      }

      mutationsToEnqueue.push({
        entityType: "transaction",
        entityId: pendingEditor.transaction?.id ?? crypto.randomUUID(),
        operation: pendingEditor.mode === "create" ? "create" : "update",
        baseRevision: pendingEditor.transaction?.revision ?? "0",
        payload: transactionPayload({
          kind: pendingEditor.kind,
          accountId: pendingEditor.accountId,
          transferAccountId: pendingEditor.transferAccountId,
          categoryId: pendingEditor.categoryId,
          amount: pendingEditor.amount,
          description: pendingEditor.description,
          payee: pendingEditor.payee,
          date: pendingEditor.date,
          cleared: pendingEditor.cleared,
          reconciled: pendingEditor.reconciled,
          reconciledAt: pendingEditor.transaction?.reconciledAt ?? null,
          notes: pendingEditor.notes,
          recurringRuleId: targetRuleId,
          recurringOccurrenceDate: targetOccDate,
          calendarLinkEnabled: pendingEditor.calendarLinkEnabled,
        }),
      });

      // 3. Find and update sibling transactions based on scope
      const siblingFilter = (tx: ChequebookTransaction): boolean => {
        if (tx.recurringRuleId !== rule.id) return false;
        if (
          pendingEditor.transaction &&
          tx.id === pendingEditor.transaction.id
        ) {
          return false;
        }
        if (scope === "all") return true;
        if (scope === "now-forward") return tx.date >= pendingEditor.date;
        if (scope === "now-backward") return tx.date <= pendingEditor.date;
        return false;
      };

      const siblingTransactions = transactions.filter(siblingFilter);

      for (const sibling of siblingTransactions) {
        const siblingOccDate =
          sibling.recurringOccurrenceDate ?? sibling.date;

        let siblingRuleId: string | null = sibling.recurringRuleId;
        let siblingOcc: string | null = siblingOccDate;

        if (scope === "now-backward") {
          siblingRuleId = null;
          siblingOcc = null;
        }

        mutationsToEnqueue.push({
          entityType: "transaction",
          entityId: sibling.id,
          operation: "update",
          baseRevision: sibling.revision,
          payload: transactionPayload({
            kind: pendingEditor.kind,
            accountId: pendingEditor.accountId,
            transferAccountId: pendingEditor.transferAccountId,
            categoryId: pendingEditor.categoryId,
            amount: pendingEditor.amount,
            description: pendingEditor.description,
            payee: pendingEditor.payee,
            date: sibling.date,
            cleared: sibling.cleared,
            reconciled: sibling.reconciledAt !== null,
            reconciledAt: sibling.reconciledAt,
            notes: pendingEditor.notes,
            recurringRuleId: siblingRuleId,
            recurringOccurrenceDate: siblingOcc,
            calendarLinkEnabled: pendingEditor.calendarLinkEnabled,
          }),
        });
      }

      await enqueueMutations(
        mutationsToEnqueue,
        `Recurring transaction updates applied (${mutationsToEnqueue.length} record${mutationsToEnqueue.length === 1 ? "" : "s"}).`,
      );

      setRecurringScopePrompt(null);
      setEditor(null);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Recurring transaction updates could not be applied.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function deleteTransaction(): Promise<void> {
    if (!editor?.transaction || busy) {
      return;
    }
    setBusy(true);
    try {
      await queue(
        "transaction",
        editor.transaction.id,
        "delete",
        editor.transaction.revision,
        {},
        "Transaction deleted.",
      );
      setEditor(null);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Transaction could not be deleted.",
      );
    } finally {
      setBusy(false);
    }
  }

  function openNewRecurring(): void {
    setRecurringEditor({
      mode: "create",
      rule: null,
      kind: "expense",
      accountId:
        settings?.defaultAccountId ??
        activeAccounts[0]?.id ??
        "",
      transferAccountId: "",
      categoryId: "",
      amount: "",
      label: "",
      startDate: today(),
      frequency: "monthly",
      interval: "1",
      recurrenceUntil: "",
      active: true,
      notes: "",
      calendarLinkEnabled: false,
    });
  }

  function openEditRecurring(
    rule: ChequebookRecurringRule,
  ): void {
    setRecurringEditor({
      mode: "edit",
      rule,
      kind: rule.kind,
      accountId: rule.accountId,
      transferAccountId:
        rule.transferAccountId ?? "",
      categoryId:
        rule.categoryId ?? "",
      amount: rule.amount,
      label: rule.label,
      startDate: rule.startDate,
      frequency: rule.frequency,
      interval: String(rule.interval),
      recurrenceUntil:
        rule.recurrenceUntil ?? "",
      active: rule.active,
      notes: rule.notes ?? "",
      calendarLinkEnabled:
        rule.calendarLinkEnabled,
    });
  }

  async function saveRecurring(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (!recurringEditor || busy) return;
    try {
      recurringPayload(recurringEditor);
    } catch (validationError) {
      setMessage(
        validationError instanceof Error
          ? validationError.message
          : "Please check your recurring transaction entries.",
      );
      return;
    }

    setBusy(true);
    try {
      await queue(
        "recurring-rule",
        recurringEditor.rule?.id ??
          crypto.randomUUID(),
        recurringEditor.mode === "create"
          ? "create"
          : "update",
        recurringEditor.rule?.revision ??
          "0",
        recurringPayload(recurringEditor),
        "Recurring transaction saved.",
      );
      setRecurringEditor(null);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Recurring transaction could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveLimit(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (!limitCategoryId || !limitAmount) {
      return;
    }
    let cleanLimit: string;
    try {
      cleanLimit = cleanAmount(limitAmount, false);
    } catch (validationError) {
      setMessage(
        validationError instanceof Error
          ? validationError.message
          : "Please enter a valid limit amount.",
      );
      return;
    }
    const existing = limits.find(
      (item) =>
        item.categoryId ===
          limitCategoryId &&
        item.budgetMonth === month,
    );
    try {
      await queue(
        "budget-limit",
        existing?.id ??
          crypto.randomUUID(),
        existing ? "update" : "create",
        existing?.revision ?? "0",
        {
          categoryId: limitCategoryId,
          budgetMonth: month,
          amount: cleanLimit,
          rolloverEnabled:
            existing?.rolloverEnabled ??
            false,
        },
        "Monthly budget updated.",
      );
      setLimitAmount("");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Budget limit could not be saved.",
      );
    }
  }

  const visibleTransactions = useMemo(
    () => {
      const q =
        search.trim().toLowerCase();
      return transactions.filter(
        (item) => {
          if (
            accountFilter !== "all" &&
            item.accountId !==
              accountFilter &&
            item.transferAccountId !==
              accountFilter
          ) {
            return false;
          }
          if (
            item.date < month ||
            item.date > monthEnd(month)
          ) {
            return false;
          }
          if (!q) return true;
          return [
            item.description,
            item.payee ?? "",
            item.notes ?? "",
            categoryById.get(
              item.categoryId ?? "",
            )?.name ?? "",
          ].some((value) =>
            value
              .toLowerCase()
              .includes(q),
          );
        },
      );
    },
    [
      accountFilter,
      categoryById,
      month,
      search,
      transactions,
    ],
  );

  const upcoming = useMemo(() => {
    const posted = new Set(
      transactions
        .filter(
          (item) =>
            item.recurringRuleId &&
            item.recurringOccurrenceDate,
        )
        .map(
          (item) =>
            item.recurringRuleId +
            ":" +
            item.recurringOccurrenceDate,
        ),
    );
    return expandRecurringRules(
      rules,
      today(),
      monthEnd(addMonths(monthKey(), 2)),
    )
      .filter(
        (item) =>
          !posted.has(
            item.ruleId +
              ":" +
              item.occurrenceDate,
          ),
      )
      .slice(0, 30);
  }, [rules, transactions]);

  const currency =
    settings?.currency ?? "CAD";

  return (
    <section className="homi-chequebook">
      <style>{`
        .homi-chequebook{display:grid;gap:16px;padding-bottom:96px}
        .cheq-toolbar{display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap}
        .cheq-month{display:flex;gap:8px;align-items:center}
        .cheq-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
        .cheq-number{font-size:clamp(1.25rem,4vw,2rem);font-weight:900;letter-spacing:-.03em;margin:.3rem 0 0}
        .cheq-muted{opacity:.7;font-size:.85rem}
        .cheq-list{display:grid;gap:8px}
        .cheq-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center}
        .cheq-row button{width:100%;text-align:left}
        .cheq-amount{font-weight:800;white-space:nowrap}
        .cheq-expense{color:var(--homi-danger,#b42318)}
        .cheq-income{color:var(--homi-success,#067647)}
        .cheq-tags{display:flex;gap:6px;flex-wrap:wrap;margin-top:5px}
        .cheq-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
        .cheq-form{display:grid;gap:14px}
        .cheq-actions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}
        .cheq-budget-row{display:grid;gap:6px}
        .cheq-meter{height:8px;background:rgba(127,127,127,.18);border-radius:99px;overflow:hidden}
        .cheq-meter>span{display:block;height:100%;background:currentColor;border-radius:99px;max-width:100%}
        .cheq-bars{display:grid;gap:10px}
        .cheq-bar{display:grid;grid-template-columns:minmax(100px,1fr) 3fr auto;gap:8px;align-items:center}
        .cheq-bar-track{height:10px;background:rgba(127,127,127,.18);border-radius:99px;overflow:hidden}
        .cheq-bar-fill{height:100%;background:currentColor;border-radius:99px}
        .cheq-search-popover{position:fixed;right:max(18px,env(safe-area-inset-right));bottom:calc(146px + env(safe-area-inset-bottom));z-index:50;width:min(360px,calc(100vw - 36px));background:var(--homi-color-surface,#fffaf2);border:1px solid rgba(92,70,61,.2);border-radius:var(--homi-radius-md,8px);box-shadow:var(--homi-shadow-lg)}
        @media (min-width:900px){.cheq-search-popover{bottom:88px}}
        .cheq-scope-option{display:flex;gap:12px;align-items:flex-start;padding:10px 12px;border:1px solid rgba(127,127,127,.2);border-radius:var(--homi-radius-md,8px);cursor:pointer}
        .cheq-scope-option:hover{background:rgba(127,127,127,.05)}
        .cheq-scope-option input{margin-top:3px}
        @media (max-width:700px){
          .cheq-summary{grid-template-columns:1fr 1fr}
          .cheq-summary> :first-child{grid-column:1/-1}
          .cheq-grid{grid-template-columns:1fr}
          .cheq-bar{grid-template-columns:1fr auto}
          .cheq-bar-track{grid-column:1/-1}
        }
      `}</style>

      <ModuleHeader
        eyebrow="Homi"
        title="Chequebook"
        description="Your household register, recurring cash flow, monthly budgets, and spending overview."
      />

      {!online && (
        <Notice tone="warning">
          Offline mode. Changes are stored on this device and synchronize automatically when Homi reconnects.
        </Notice>
      )}

      {message && (
        <Notice tone="neutral">
          {message}
        </Notice>
      )}

      <div className="cheq-toolbar">
        <Tabs
          label="Chequebook view"
          activeId={tab}
          onChange={(id) =>
            setTab(id as ChequebookTab)
          }
          items={[
            {
              id: "register",
              label: "Register",
            },
            {
              id: "recurring",
              label: "Recurring",
            },
            {
              id: "budget",
              label: "Budget",
            },
            {
              id: "analytics",
              label: "Analytics",
            },
          ]}
        />
        <div className="cheq-month">
          <Button
            variant="quiet"
            onClick={() =>
              setMonth(
                addMonths(month, -1),
              )
            }
          >
            ‹
          </Button>
          <strong>
            {formatMonth(
              month,
              locale,
            )}
          </strong>
          <Button
            variant="quiet"
            onClick={() =>
              setMonth(
                addMonths(month, 1),
              )
            }
          >
            ›
          </Button>
        </div>
      </div>

      <div className="cheq-summary">
        <Surface padding="normal">
          <span className="cheq-muted">
            Current balance
          </span>
          <div className="cheq-number">
            {formatMoney(
              summary?.currentBalance ??
                "0",
              currency,
              locale,
            )}
          </div>
          <span className="cheq-muted">
            Across active accounts
          </span>
        </Surface>
        <Surface padding="normal">
          <span className="cheq-muted">
            Forecast
          </span>
          <div className="cheq-number">
            {formatMoney(
              summary?.forecastBalance ??
                "0",
              currency,
              locale,
            )}
          </div>
          <span className="cheq-muted">
            After pending recurring items
          </span>
        </Surface>
        <Surface padding="normal">
          <span className="cheq-muted">
            This month
          </span>
          <div className="cheq-number">
            {formatMoney(
              summary?.expenses ?? "0",
              currency,
              locale,
            )}
          </div>
          <span className="cheq-muted">
            spent ·{" "}
            {formatMoney(
              summary?.income ?? "0",
              currency,
              locale,
            )}{" "}
            income
          </span>
        </Surface>
      </div>

      {tab === "register" && (
        <>
          <div className="cheq-toolbar">
            <Select
              value={accountFilter}
              onChange={(event) =>
                setAccountFilter(
                  event.currentTarget.value,
                )
              }
              aria-label="Account filter"
            >
              <option value="all">
                All accounts
              </option>
              {activeAccounts.map(
                (account) => (
                  <option
                    key={account.id}
                    value={account.id}
                  >
                    {account.name}
                  </option>
                ),
              )}
            </Select>
          </div>

          <div className="cheq-list">
            {visibleTransactions.length ===
            0 ? (
              <EmptyState
                title="No transactions this month"
                description="Add income, expenses, or transfers to start your household register."
                action={
                  <Button
                    onClick={() =>
                      openNewTransaction()
                    }
                  >
                    Add transaction
                  </Button>
                }
              />
            ) : (
              visibleTransactions.map(
                (item) => (
                  <Surface
                    key={item.id}
                    padding="compact"
                  >
                    <button
                      type="button"
                      className="cheq-row"
                      onClick={() =>
                        openEditTransaction(
                          item,
                        )
                      }
                    >
                      <span>
                        <strong>
                          {item.description}
                        </strong>
                        <div className="cheq-muted">
                          {item.payee
                            ? item.payee +
                              " · "
                            : ""}
                          {item.date} ·{" "}
                          {accountById.get(
                            item.accountId,
                          )?.name ??
                            "Account"}
                        </div>
                        <span className="cheq-tags">
                          {item.categoryId && (
                            <Badge>
                              {categoryById.get(
                                item.categoryId,
                              )?.name ??
                                "Category"}
                            </Badge>
                          )}
                          {item.kind ===
                            "transfer" && (
                            <Badge>
                              Transfer
                            </Badge>
                          )}
                          {item.cleared && (
                            <Badge tone="success">
                              Cleared
                            </Badge>
                          )}
                          {item.reconciledAt && (
                            <Badge tone="neutral">
                              Reconciled
                            </Badge>
                          )}
                        </span>
                      </span>
                      <span
                        className={
                          "cheq-amount " +
                          (item.kind ===
                          "income"
                            ? "cheq-income"
                            : item.kind ===
                                "expense"
                              ? "cheq-expense"
                              : "")
                        }
                      >
                        {item.kind ===
                        "income"
                          ? "+"
                          : item.kind ===
                              "expense"
                            ? "−"
                            : ""}
                        {formatMoney(
                          item.amount,
                          currency,
                          locale,
                        )}
                      </span>
                    </button>
                  </Surface>
                ),
              )
            )}
          </div>
        </>
      )}

      {tab === "recurring" && (
        <div className="cheq-grid">
          <Surface padding="normal">
            <div className="cheq-toolbar">
              <div>
                <strong>
                  Recurring transactions
                </strong>
                <div className="cheq-muted">
                  Bills, subscriptions, pay,
                  allowances, and scheduled
                  transfers.
                </div>
              </div>
              <Button
                onClick={openNewRecurring}
              >
                + Recurring
              </Button>
            </div>
            <div className="cheq-list">
              {rules.length === 0 ? (
                <EmptyState
                  title="No recurring transactions"
                  description="Add a recurring bill or income item to make the cash-flow forecast useful."
                />
              ) : (
                rules.map((rule) => (
                  <button
                    key={rule.id}
                    type="button"
                    className="cheq-row"
                    onClick={() =>
                      openEditRecurring(rule)
                    }
                  >
                    <span>
                      <strong>
                        {rule.label}
                      </strong>
                      <div className="cheq-muted">
                        Every{" "}
                        {rule.interval >
                        1
                          ? rule.interval +
                            " "
                          : ""}
                        {rule.frequency}
                        {rule.interval >
                        1
                          ? "s"
                          : ""}{" "}
                        · starts{" "}
                        {rule.startDate}
                      </div>
                    </span>
                    <span
                      className={
                        "cheq-amount " +
                        (rule.kind ===
                        "income"
                          ? "cheq-income"
                          : rule.kind ===
                              "expense"
                            ? "cheq-expense"
                            : "")
                      }
                    >
                      {formatMoney(
                        rule.amount,
                        currency,
                        locale,
                      )}
                    </span>
                  </button>
                ))
              )}
            </div>
          </Surface>

          <Surface padding="normal">
            <strong>Coming up</strong>
            <p className="cheq-muted">
              Post an occurrence when it
              actually enters or leaves the
              account. Forecasting will stop
              counting it as pending.
            </p>
            <div className="cheq-list">
              {upcoming.length === 0 ? (
                <p className="cheq-muted">
                  Nothing scheduled in the
                  next two months.
                </p>
              ) : (
                upcoming.map(
                  (occurrence) => (
                    <div
                      className="cheq-row"
                      key={
                        occurrence.ruleId +
                        occurrence.occurrenceDate
                      }
                    >
                      <span>
                        <strong>
                          {occurrence.label}
                        </strong>
                        <div className="cheq-muted">
                          {
                            occurrence.occurrenceDate
                          }
                        </div>
                      </span>
                      <Button
                        variant="secondary"
                        onClick={() =>
                          openNewTransaction(
                            occurrence,
                          )
                        }
                      >
                        Post
                      </Button>
                    </div>
                  ),
                )
              )}
            </div>
          </Surface>
        </div>
      )}

      {tab === "budget" && (
        <div className="cheq-grid">
          <Surface padding="normal">
            <strong>
              Category budgets
            </strong>
            <p className="cheq-muted">
              Monthly limits include posted
              spending plus pending recurring
              expenses for the month.
            </p>
            <div className="cheq-list">
              {(summary?.spentByCategory ??
                []).map((item) => {
                const percent =
                  item.percentUsed ?? 0;
                return (
                  <div
                    className="cheq-budget-row"
                    key={item.categoryId}
                  >
                    <div className="cheq-row">
                      <span>
                        <strong>
                          {
                            item.categoryName
                          }
                        </strong>
                        <div className="cheq-muted">
                          {formatMoney(
                            item.amount,
                            currency,
                            locale,
                          )}
                          {item.limit
                            ? " of " +
                              formatMoney(
                                item.limit,
                                currency,
                                locale,
                              )
                            : " · no limit"}
                        </div>
                      </span>
                      {item.percentUsed !==
                        null && (
                        <Badge
                          tone={
                            percent >= 100
                              ? "danger"
                              : percent >= 80
                                ? "warning"
                                : "neutral"
                          }
                        >
                          {percent.toFixed(
                            0,
                          )}
                          %
                        </Badge>
                      )}
                    </div>
                    {item.limit && (
                      <div className="cheq-meter">
                        <span
                          style={{
                            width:
                              Math.min(
                                100,
                                percent,
                              ) + "%",
                          }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Surface>

          <Surface padding="normal">
            <strong>
              Set monthly limit
            </strong>
            <form
              className="cheq-form"
              onSubmit={(event) =>
                void saveLimit(event)
              }
            >
              <FormField
                label="Category"
                htmlFor="cheq-limit-category"
              >
                <Select
                  id="cheq-limit-category"
                  value={limitCategoryId}
                  onChange={(event) => {
                    const id =
                      event.currentTarget
                        .value;
                    setLimitCategoryId(id);
                    const existing =
                      limits.find(
                        (item) =>
                          item.categoryId ===
                            id &&
                          item.budgetMonth ===
                            month,
                      );
                    setLimitAmount(
                      existing?.amount ??
                        "",
                    );
                  }}
                >
                  <option value="">
                    Choose category
                  </option>
                  {activeCategories
                    .filter(
                      (item) =>
                        item.kind !==
                        "income",
                    )
                    .map((category) => (
                      <option
                        key={
                          category.id
                        }
                        value={
                          category.id
                        }
                      >
                        {category.name}
                      </option>
                    ))}
                </Select>
              </FormField>
              <FormField
                label="Monthly limit"
                htmlFor="cheq-limit-amount"
              >
                <TextField
                  id="cheq-limit-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  value={limitAmount}
                  onChange={(event) =>
                    setLimitAmount(
                      event.currentTarget
                        .value,
                    )
                  }
                />
              </FormField>
              <Button type="submit">
                Save limit
              </Button>
            </form>
          </Surface>
        </div>
      )}

      {tab === "analytics" && (
        <div className="cheq-grid">
          <Surface padding="normal">
            <strong>
              Monthly cash flow
            </strong>
            <div className="cheq-list">
              <div className="cheq-row">
                <span>Income</span>
                <strong className="cheq-income">
                  {formatMoney(
                    summary?.income ??
                      "0",
                    currency,
                    locale,
                  )}
                </strong>
              </div>
              <div className="cheq-row">
                <span>Expenses</span>
                <strong className="cheq-expense">
                  {formatMoney(
                    summary?.expenses ??
                      "0",
                    currency,
                    locale,
                  )}
                </strong>
              </div>
              <div className="cheq-row">
                <span>
                  Upcoming recurring income
                </span>
                <strong>
                  {formatMoney(
                    summary?.upcomingRecurringIncome ??
                      "0",
                    currency,
                    locale,
                  )}
                </strong>
              </div>
              <div className="cheq-row">
                <span>
                  Upcoming recurring expenses
                </span>
                <strong>
                  {formatMoney(
                    summary?.upcomingRecurringExpenses ??
                      "0",
                    currency,
                    locale,
                  )}
                </strong>
              </div>
            </div>
          </Surface>

          <Surface padding="normal">
            <strong>
              Spending by category
            </strong>
            <div className="cheq-bars">
              {(summary?.spentByCategory ??
                [])
                .filter(
                  (item) =>
                    Number(item.amount) >
                    0,
                )
                .sort(
                  (a, b) =>
                    Number(b.amount) -
                    Number(a.amount),
                )
                .map((item) => {
                  const max = Math.max(
                    ...(
                      summary?.spentByCategory ??
                      []
                    ).map((row) =>
                      Number(row.amount),
                    ),
                    1,
                  );
                  return (
                    <div
                      className="cheq-bar"
                      key={item.categoryId}
                    >
                      <span>
                        {item.categoryName}
                      </span>
                      <div className="cheq-bar-track">
                        <div
                          className="cheq-bar-fill"
                          style={{
                            width:
                              (Number(
                                item.amount,
                              ) /
                                max) *
                                100 +
                              "%",
                          }}
                        />
                      </div>
                      <strong>
                        {formatMoney(
                          item.amount,
                          currency,
                          locale,
                        )}
                      </strong>
                    </div>
                  );
                })}
            </div>
          </Surface>
        </div>
      )}

      {searchOpen && (
        <Surface
          className="cheq-search-popover"
          padding="compact"
          role="search"
          aria-label="Search transactions"
        >
          <SearchField
            id="chequebook-search"
            label="Search transactions"
            placeholder="Search payee, description, category…"
            autoFocus
            value={search}
            onChange={(event) =>
              setSearch(event.currentTarget.value)
            }
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setSearchOpen(false);
              }
            }}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8, gap: 8 }}>
            {search && (
              <Button
                variant="quiet"
                onClick={() => setSearch("")}
              >
                Clear
              </Button>
            )}
            <Button
              variant="quiet"
              onClick={() => {
                setSearch("");
                setSearchOpen(false);
              }}
            >
              Close
            </Button>
          </div>
        </Surface>
      )}

      <BottomSheet
        open={editor !== null}
        title={
          editor?.mode === "edit"
            ? "Edit transaction"
            : editor?.recurringRuleId
              ? "Post recurring transaction"
              : "Add transaction"
        }
        onDismiss={() =>
          !busy && setEditor(null)
        }
      >
        {editor && (
          <form
            className="cheq-form"
            onSubmit={(event) =>
              void saveTransaction(event)
            }
          >
            <div className="cheq-grid">
              <FormField
                label="Type"
                htmlFor="cheq-kind"
              >
                <Select
                  id="cheq-kind"
                  value={editor.kind}
                  onChange={(event) =>
                    setEditor({
                      ...editor,
                      kind: event
                        .currentTarget
                        .value as ChequebookTransactionKind,
                    })
                  }
                >
                  <option value="expense">
                    Expense
                  </option>
                  <option value="income">
                    Income
                  </option>
                  <option value="transfer">
                    Transfer
                  </option>
                </Select>
              </FormField>
              <FormField
                label="Amount"
                htmlFor="cheq-amount"
              >
                <TextField
                  id="cheq-amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                  value={editor.amount}
                  onChange={(event) =>
                    setEditor({
                      ...editor,
                      amount:
                        event.currentTarget
                          .value,
                    })
                  }
                />
              </FormField>
            </div>

            <FormField
              label="Description"
              htmlFor="cheq-description"
            >
              <TextField
                id="cheq-description"
                required
                maxLength={200}
                value={editor.description}
                onChange={(event) =>
                  setEditor({
                    ...editor,
                    description:
                      event.currentTarget
                        .value,
                  })
                }
              />
            </FormField>

            <div className="cheq-grid">
              <FormField
                label="Account"
                htmlFor="cheq-account"
              >
                <Select
                  id="cheq-account"
                  required
                  value={editor.accountId}
                  onChange={(event) =>
                    setEditor({
                      ...editor,
                      accountId:
                        event.currentTarget
                          .value,
                    })
                  }
                >
                  {activeAccounts.map(
                    (account) => (
                      <option
                        key={account.id}
                        value={account.id}
                      >
                        {account.name}
                      </option>
                    ),
                  )}
                </Select>
              </FormField>

              {editor.kind ===
              "transfer" ? (
                <FormField
                  label="To account"
                  htmlFor="cheq-transfer-account"
                >
                  <Select
                    id="cheq-transfer-account"
                    required
                    value={
                      editor.transferAccountId
                    }
                    onChange={(event) =>
                      setEditor({
                        ...editor,
                        transferAccountId:
                          event
                            .currentTarget
                            .value,
                      })
                    }
                  >
                    <option value="">
                      Choose account
                    </option>
                    {activeAccounts
                      .filter(
                        (account) =>
                          account.id !==
                          editor.accountId,
                      )
                      .map(
                        (account) => (
                          <option
                            key={
                              account.id
                            }
                            value={
                              account.id
                            }
                          >
                            {
                              account.name
                            }
                          </option>
                        ),
                      )}
                  </Select>
                </FormField>
              ) : (
                <FormField
                  label="Category"
                  htmlFor="cheq-category"
                >
                  <Select
                    id="cheq-category"
                    value={
                      editor.categoryId
                    }
                    onChange={(event) =>
                      setEditor({
                        ...editor,
                        categoryId:
                          event
                            .currentTarget
                            .value,
                      })
                    }
                  >
                    <option value="">
                      No category
                    </option>
                    {activeCategories
                      .filter(
                        (category) =>
                          category.kind ===
                            "both" ||
                          category.kind ===
                            editor.kind,
                      )
                      .map(
                        (category) => (
                          <option
                            key={
                              category.id
                            }
                            value={
                              category.id
                            }
                          >
                            {
                              category.name
                            }
                          </option>
                        ),
                      )}
                  </Select>
                </FormField>
              )}
            </div>

            <div className="cheq-grid">
              <FormField
                label="Date"
                htmlFor="cheq-date"
              >
                <TextField
                  id="cheq-date"
                  type="date"
                  required
                  value={editor.date}
                  onChange={(event) =>
                    setEditor({
                      ...editor,
                      date: event
                        .currentTarget
                        .value,
                    })
                  }
                />
              </FormField>
              <FormField
                label="Payee / source"
                htmlFor="cheq-payee"
              >
                <TextField
                  id="cheq-payee"
                  maxLength={160}
                  value={editor.payee}
                  onChange={(event) =>
                    setEditor({
                      ...editor,
                      payee:
                        event.currentTarget
                          .value,
                    })
                  }
                />
              </FormField>
            </div>

            <div className="cheq-grid">
              <FormField
                label="Repeat"
                htmlFor="cheq-repeat-frequency"
                hint="The current entry is saved now; future entries appear in Recurring."
              >
                <Select
                  id="cheq-repeat-frequency"
                  value={editor.repeatFrequency}
                  onChange={(event) =>
                    setEditor({
                      ...editor,
                      repeatFrequency: event.currentTarget.value as TransactionEditor["repeatFrequency"],
                    })
                  }
                >
                  <option value="">Does not repeat</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </Select>
              </FormField>
              {editor.repeatFrequency !== "" && (
                <FormField
                  label="Every"
                  htmlFor="cheq-repeat-interval"
                  hint={`1 ${editor.repeatFrequency}; use 2 for every two.`}
                >
                  <TextField
                    id="cheq-repeat-interval"
                    type="number"
                    min="1"
                    max="365"
                    required
                    value={editor.repeatInterval}
                    onChange={(event) =>
                      setEditor({
                        ...editor,
                        repeatInterval: event.currentTarget.value,
                      })
                    }
                  />
                </FormField>
              )}
            </div>

            {editor.repeatFrequency !== "" && (
              <FormField
                label="Repeat until (optional)"
                htmlFor="cheq-repeat-until"
              >
                <TextField
                  id="cheq-repeat-until"
                  type="date"
                  min={editor.date}
                  value={editor.repeatUntil}
                  onChange={(event) =>
                    setEditor({
                      ...editor,
                      repeatUntil: event.currentTarget.value,
                    })
                  }
                />
              </FormField>
            )}

            <FormField
              label="Notes"
              htmlFor="cheq-notes"
            >
              <TextArea
                id="cheq-notes"
                maxLength={2000}
                value={editor.notes}
                onChange={(event) =>
                  setEditor({
                    ...editor,
                    notes:
                      event.currentTarget
                        .value,
                  })
                }
              />
            </FormField>

            <Checkbox
              label="Cleared"
              checked={editor.cleared}
              onChange={(event) =>
                setEditor({
                  ...editor,
                  cleared:
                    event.currentTarget
                      .checked,
                })
              }
            />
            <Checkbox
              label="Reconciled"
              checked={editor.reconciled}
              onChange={(event) =>
                setEditor({
                  ...editor,
                  reconciled:
                    event.currentTarget
                      .checked,
                })
              }
            />
            {editor.kind !==
              "transfer" && (
              <Checkbox
                label="Show on Calendar"
                checked={
                  editor.calendarLinkEnabled
                }
                onChange={(event) => {
                  if (event.currentTarget.checked && calendarEnabled !== true) {
                    setMessage(
                      "Install and enable Calendar from Modules before showing Chequebook entries there.",
                    );
                    return;
                  }
                  setEditor({
                    ...editor,
                    calendarLinkEnabled:
                      event.currentTarget.checked,
                  });
                }}
              />
            )}

            <div className="cheq-actions">
              <Button
                type="button"
                variant="quiet"
                disabled={busy}
                onClick={() => setEditor(null)}
              >
                Cancel
              </Button>
              {editor.mode ===
                "edit" && (
                <Button
                  type="button"
                  variant="danger"
                  disabled={busy}
                  onClick={() =>
                    void deleteTransaction()
                  }
                >
                  Delete
                </Button>
              )}
              <Button
                type="submit"
                disabled={busy}
              >
                {editor.mode === "edit"
                  ? "Save transaction"
                  : editor.recurringRuleId
                    ? "Post transaction"
                    : "Save transaction"}
              </Button>
            </div>
          </form>
        )}
      </BottomSheet>

      <Dialog
        open={recurringScopePrompt !== null}
        title="Update Recurring Transaction"
        onDismiss={() => !busy && setRecurringScopePrompt(null)}
        actions={
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <Button
              variant="quiet"
              disabled={busy}
              onClick={() => setRecurringScopePrompt(null)}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => void applyRecurringUpdate(selectedScope)}
            >
              Save changes
            </Button>
          </div>
        }
      >
        <p className="cheq-muted" style={{ marginBottom: 16 }}>
          This transaction belongs to the recurring schedule{" "}
          <strong>"{recurringScopePrompt?.rule.label}"</strong>. Choose how you
          would like to apply your updates:
        </p>
        <div style={{ display: "grid", gap: 10 }}>
          <label className="cheq-scope-option">
            <input
              type="radio"
              name="recurring-scope"
              value="now-forward"
              checked={selectedScope === "now-forward"}
              onChange={() => setSelectedScope("now-forward")}
            />
            <div>
              <strong>Now forward (This and future occurrences)</strong>
              <div className="cheq-muted">
                Updates this transaction and updates the recurring schedule for all upcoming occurrences.
              </div>
            </div>
          </label>
          <label className="cheq-scope-option">
            <input
              type="radio"
              name="recurring-scope"
              value="now-backward"
              checked={selectedScope === "now-backward"}
              onChange={() => setSelectedScope("now-backward")}
            />
            <div>
              <strong>Now backward (This and past occurrences)</strong>
              <div className="cheq-muted">
                Updates this transaction and updates all previously posted past entries.
              </div>
            </div>
          </label>
          <label className="cheq-scope-option">
            <input
              type="radio"
              name="recurring-scope"
              value="all"
              checked={selectedScope === "all"}
              onChange={() => setSelectedScope("all")}
            />
            <div>
              <strong>All (Every past and future occurrence)</strong>
              <div className="cheq-muted">
                Updates all past ledger entries and updates the recurring schedule for future occurrences.
              </div>
            </div>
          </label>
          <label className="cheq-scope-option">
            <input
              type="radio"
              name="recurring-scope"
              value="this-only"
              checked={selectedScope === "this-only"}
              onChange={() => setSelectedScope("this-only")}
            />
            <div>
              <strong>Only this transaction</strong>
              <div className="cheq-muted">
                Applies modifications to this individual transaction only without altering any other entries.
              </div>
            </div>
          </label>
        </div>
      </Dialog>

      <BottomSheet
        open={recurringEditor !== null}
        title={
          recurringEditor?.mode ===
          "edit"
            ? "Edit recurring transaction"
            : "Add recurring transaction"
        }
        onDismiss={() =>
          !busy &&
          setRecurringEditor(null)
        }
      >
        {recurringEditor && (
          <form
            className="cheq-form"
            onSubmit={(event) =>
              void saveRecurring(event)
            }
          >
            <div className="cheq-grid">
              <FormField
                label="Type"
                htmlFor="cheq-rec-kind"
              >
                <Select
                  id="cheq-rec-kind"
                  value={
                    recurringEditor.kind
                  }
                  onChange={(event) =>
                    setRecurringEditor({
                      ...recurringEditor,
                      kind: event
                        .currentTarget
                        .value as ChequebookTransactionKind,
                    })
                  }
                >
                  <option value="expense">
                    Expense
                  </option>
                  <option value="income">
                    Income
                  </option>
                  <option value="transfer">
                    Transfer
                  </option>
                </Select>
              </FormField>
              <FormField
                label="Amount"
                htmlFor="cheq-rec-amount"
              >
                <TextField
                  id="cheq-rec-amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                  value={
                    recurringEditor.amount
                  }
                  onChange={(event) =>
                    setRecurringEditor({
                      ...recurringEditor,
                      amount:
                        event.currentTarget
                          .value,
                    })
                  }
                />
              </FormField>
            </div>

            <FormField
              label="Label"
              htmlFor="cheq-rec-label"
            >
              <TextField
                id="cheq-rec-label"
                required
                maxLength={200}
                value={
                  recurringEditor.label
                }
                onChange={(event) =>
                  setRecurringEditor({
                    ...recurringEditor,
                    label:
                      event.currentTarget
                        .value,
                  })
                }
              />
            </FormField>

            <div className="cheq-grid">
              <FormField
                label="Account"
                htmlFor="cheq-rec-account"
              >
                <Select
                  id="cheq-rec-account"
                  value={
                    recurringEditor.accountId
                  }
                  onChange={(event) =>
                    setRecurringEditor({
                      ...recurringEditor,
                      accountId:
                        event.currentTarget
                          .value,
                    })
                  }
                >
                  {activeAccounts.map(
                    (account) => (
                      <option
                        key={account.id}
                        value={account.id}
                      >
                        {account.name}
                      </option>
                    ),
                  )}
                </Select>
              </FormField>

              {recurringEditor.kind ===
              "transfer" ? (
                <FormField
                  label="To account"
                  htmlFor="cheq-rec-transfer"
                >
                  <Select
                    id="cheq-rec-transfer"
                    value={
                      recurringEditor.transferAccountId
                    }
                    onChange={(event) =>
                      setRecurringEditor({
                        ...recurringEditor,
                        transferAccountId:
                          event
                            .currentTarget
                            .value,
                      })
                    }
                  >
                    <option value="">
                      Choose account
                    </option>
                    {activeAccounts
                      .filter(
                        (account) =>
                          account.id !==
                          recurringEditor.accountId,
                      )
                      .map(
                        (account) => (
                          <option
                            key={
                              account.id
                            }
                            value={
                              account.id
                            }
                          >
                            {
                              account.name
                            }
                          </option>
                        ),
                      )}
                  </Select>
                </FormField>
              ) : (
                <FormField
                  label="Category"
                  htmlFor="cheq-rec-category"
                >
                  <Select
                    id="cheq-rec-category"
                    value={
                      recurringEditor.categoryId
                    }
                    onChange={(event) =>
                      setRecurringEditor({
                        ...recurringEditor,
                        categoryId:
                          event
                            .currentTarget
                            .value,
                      })
                    }
                  >
                    <option value="">
                      No category
                    </option>
                    {activeCategories
                      .filter(
                        (category) =>
                          category.kind ===
                            "both" ||
                          category.kind ===
                            recurringEditor.kind,
                      )
                      .map(
                        (category) => (
                          <option
                            key={
                              category.id
                            }
                            value={
                              category.id
                            }
                          >
                            {
                              category.name
                            }
                          </option>
                        ),
                      )}
                  </Select>
                </FormField>
              )}
            </div>

            <div className="cheq-grid">
              <FormField
                label="Starts"
                htmlFor="cheq-rec-start"
              >
                <TextField
                  id="cheq-rec-start"
                  type="date"
                  required
                  value={
                    recurringEditor.startDate
                  }
                  onChange={(event) =>
                    setRecurringEditor({
                      ...recurringEditor,
                      startDate:
                        event.currentTarget
                          .value,
                    })
                  }
                />
              </FormField>
              <FormField
                label="Frequency"
                htmlFor="cheq-rec-frequency"
              >
                <Select
                  id="cheq-rec-frequency"
                  value={
                    recurringEditor.frequency
                  }
                  onChange={(event) =>
                    setRecurringEditor({
                      ...recurringEditor,
                      frequency: event
                        .currentTarget
                        .value as ChequebookRecurringRule["frequency"],
                    })
                  }
                >
                  {CHEQUEBOOK_RECURRENCE_FREQUENCIES.map(
                    (frequency) => (
                      <option
                        key={frequency}
                        value={frequency}
                      >
                        {frequency}
                      </option>
                    ),
                  )}
                </Select>
              </FormField>
            </div>

            <div className="cheq-grid">
              <FormField
                label="Every"
                htmlFor="cheq-rec-interval"
                hint="For example, 2 monthly = every two months."
              >
                <TextField
                  id="cheq-rec-interval"
                  type="number"
                  min="1"
                  max="365"
                  value={
                    recurringEditor.interval
                  }
                  onChange={(event) =>
                    setRecurringEditor({
                      ...recurringEditor,
                      interval:
                        event.currentTarget
                          .value,
                    })
                  }
                />
              </FormField>
              <FormField
                label="Ends"
                htmlFor="cheq-rec-until"
              >
                <TextField
                  id="cheq-rec-until"
                  type="date"
                  value={
                    recurringEditor.recurrenceUntil
                  }
                  onChange={(event) =>
                    setRecurringEditor({
                      ...recurringEditor,
                      recurrenceUntil:
                        event.currentTarget
                          .value,
                    })
                  }
                />
              </FormField>
            </div>

            <FormField
              label="Notes"
              htmlFor="cheq-rec-notes"
            >
              <TextArea
                id="cheq-rec-notes"
                value={
                  recurringEditor.notes
                }
                onChange={(event) =>
                  setRecurringEditor({
                    ...recurringEditor,
                    notes:
                      event.currentTarget
                        .value,
                  })
                }
              />
            </FormField>

            <Switch
              label="Active"
              checked={
                recurringEditor.active
              }
              onChange={(event) =>
                setRecurringEditor({
                  ...recurringEditor,
                  active:
                    event.currentTarget
                      .checked,
                })
              }
            />
            {recurringEditor.kind !==
              "transfer" && (
              <Switch
                label="Show on Calendar"
                checked={
                  recurringEditor.calendarLinkEnabled
                }
                onChange={(event) => {
                  if (event.currentTarget.checked && calendarEnabled !== true) {
                    setMessage(
                      "Install and enable Calendar from Modules before showing recurring Chequebook entries there.",
                    );
                    return;
                  }
                  setRecurringEditor({
                    ...recurringEditor,
                    calendarLinkEnabled:
                      event.currentTarget.checked,
                  });
                }}
              />
            )}

            <div className="cheq-actions">
              <Button
                type="button"
                variant="quiet"
                disabled={busy}
                onClick={() => setRecurringEditor(null)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={busy}
              >
                Save recurring transaction
              </Button>
            </div>
          </form>
        )}
      </BottomSheet>
    </section>
  );
}

function ChequebookSetup({
  context,
  actions,
}: HomiWebModuleSurfaceProps) {
  const online = Boolean(context?.online);
  const [currency, setCurrency] =
    useState("CAD");
  const [accountName, setAccountName] =
    useState("Main chequing");
  const [openingBalance, setOpeningBalance] =
    useState("0.00");
  const [openingDate, setOpeningDate] =
    useState(today());
  const [message, setMessage] =
    useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(): Promise<void> {
    if (!online || busy) {
      setMessage(
        "Reconnect to complete Chequebook setup.",
      );
      return;
    }
    setBusy(true);
    try {
      const setup =
        await putData<SetupSnapshot>(
          context,
          "/api/v1/modules/chequebook/setup",
          {
            currency:
              currency.trim().toUpperCase(),
            accountName,
            openingBalance,
            openingDate,
          },
        );
      await Promise.all([
        seedSettings(
          actions,
          setup.settings,
        ),
        seedCollection(
          actions,
          "account",
          setup.accounts,
        ),
        seedCollection(
          actions,
          "category",
          setup.categories,
        ),
      ]);
      setMessage("Chequebook is ready.");
      await actions.refreshModuleState();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Chequebook setup failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <SetupLayout
      title="Set up Chequebook"
      description="Start with your main account. You can add more accounts, categories, recurring transactions, and monthly budgets afterward."
      actions={
        <Button
          disabled={busy || !online}
          onClick={() => void save()}
        >
          Create Chequebook
        </Button>
      }
    >
      <div className="cheq-grid">
        <FormField
          label="Currency"
          htmlFor="cheq-setup-currency"
          hint="Three-letter currency code, such as CAD or USD."
        >
          <TextField
            id="cheq-setup-currency"
            value={currency}
            maxLength={3}
            onChange={(event) =>
              setCurrency(
                event.currentTarget.value,
              )
            }
          />
        </FormField>
        <FormField
          label="Main account name"
          htmlFor="cheq-setup-account"
        >
          <TextField
            id="cheq-setup-account"
            value={accountName}
            onChange={(event) =>
              setAccountName(
                event.currentTarget.value,
              )
            }
          />
        </FormField>
      </div>
      <div className="cheq-grid">
        <FormField
          label="Opening balance"
          htmlFor="cheq-setup-opening"
        >
          <TextField
            id="cheq-setup-opening"
            type="number"
            step="0.01"
            value={openingBalance}
            onChange={(event) =>
              setOpeningBalance(
                event.currentTarget.value,
              )
            }
          />
        </FormField>
        <FormField
          label="Balance as of"
          htmlFor="cheq-setup-date"
        >
          <TextField
            id="cheq-setup-date"
            type="date"
            value={openingDate}
            onChange={(event) =>
              setOpeningDate(
                event.currentTarget.value,
              )
            }
          />
        </FormField>
      </div>
      {message && (
        <Notice tone="neutral">
          {message}
        </Notice>
      )}
    </SetupLayout>
  );
}

function ChequebookSettings({
  context,
  actions,
}: HomiWebModuleSurfaceProps) {
  const householdId = context?.householdId ?? "";
  const online = Boolean(context?.online);
  const locale = context?.locale ?? "en";
  const [settings, setSettings] =
    useState<ChequebookSettings | null>(null);
  const [accounts, setAccounts] =
    useState<readonly ChequebookAccount[]>([]);
  const [categories, setCategories] =
    useState<readonly ChequebookCategory[]>(
      [],
    );
  const [currency, setCurrency] =
    useState("CAD");
  const [
    defaultAccountId,
    setDefaultAccountId,
  ] = useState("");
  const [
    lowBalanceThreshold,
    setLowBalanceThreshold,
  ] = useState("");
  const [newAccountName, setNewAccountName] =
    useState("");
  const [newAccountType, setNewAccountType] =
    useState<
      ChequebookAccount["type"]
    >("checking");
  const [
    newAccountBalance,
    setNewAccountBalance,
  ] = useState("0.00");
  const [
    newCategoryName,
    setNewCategoryName,
  ] = useState("");
  const [
    newCategoryKind,
    setNewCategoryKind,
  ] = useState<
      ChequebookCategory["kind"]
    >("expense");
  const [message, setMessage] =
    useState<string | null>(null);
  const [editingCategory, setEditingCategory] =
    useState<ChequebookCategory | null>(null);
  const [editingCategoryName, setEditingCategoryName] =
    useState("");
  const [editingCategoryKind, setEditingCategoryKind] =
    useState<ChequebookCategory["kind"]>("expense");
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  const load = useCallback(async () => {
    if (!online) {
      const [
        cachedSettings,
        cachedAccounts,
        cachedCategories,
      ] = await Promise.all([
        cached<ChequebookSettings>(
          actionsRef.current,
          "chequebook-settings",
        ),
        cached<ChequebookAccount>(
          actionsRef.current,
          "account",
        ),
        cached<ChequebookCategory>(
          actionsRef.current,
          "category",
        ),
      ]);
      const next =
        cachedSettings[0] ?? null;
      setSettings(next);
      setAccounts(cachedAccounts);
      setCategories(cachedCategories);
      if (next) {
        setCurrency(next.currency);
        setDefaultAccountId(
          next.defaultAccountId,
        );
        setLowBalanceThreshold(
          next.lowBalanceThreshold ?? "",
        );
      }
      return;
    }
    const setup =
      await apiData<SetupSnapshot | null>(
        context,
        "/api/v1/modules/chequebook/setup",
      );
    if (!setup) return;
    setSettings(setup.settings);
    setAccounts(setup.accounts);
    setCategories(setup.categories);
    setCurrency(setup.settings.currency);
    setDefaultAccountId(
      setup.settings.defaultAccountId,
    );
    setLowBalanceThreshold(
      setup.settings.lowBalanceThreshold ??
        "",
    );
  }, [householdId, online]);

  useEffect(() => {
    void load().catch((error: unknown) =>
      setMessage(
        error instanceof Error
          ? error.message
          : "Chequebook settings could not be loaded.",
      ),
    );
  }, [householdId, online, load]);

  async function queue(
    entityType: string,
    entityId: string,
    operation: string,
    baseRevision: string,
    payload: Record<string, unknown>,
    success: string,
  ): Promise<void> {
    await actions.enqueueMutation({
      entityType,
      entityId,
      operation,
      baseRevision,
      payload,
    });
    if (online) {
      try {
        await actions.syncNow();
        await load();
      } catch (syncErr) {
        console.warn("Chequebook settings syncNow delayed:", syncErr);
      }
    }
    setMessage(success);
  }

  async function saveSettings(): Promise<void> {
    if (!settings) return;
    try {
      await queue(
        "chequebook-settings",
        householdId,
        "update",
        settings.revision,
        {
          currency:
            currency.trim().toUpperCase(),
          defaultAccountId,
          lowBalanceThreshold:
            lowBalanceThreshold.trim() ||
            null,
        },
        "Chequebook settings saved.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Settings could not be saved.",
      );
    }
  }

  async function addAccount(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (!newAccountName.trim()) return;
    let cleanBalance: string;
    try {
      cleanBalance = cleanAmount(newAccountBalance || "0", true);
    } catch (validationError) {
      setMessage(
        validationError instanceof Error
          ? validationError.message
          : "Please enter a valid opening balance.",
      );
      return;
    }
    try {
      await queue(
        "account",
        crypto.randomUUID(),
        "create",
        "0",
        {
          name: newAccountName.trim(),
          type: newAccountType,
          openingBalance: cleanBalance,
          openingDate: today(),
          archived: false,
        },
        "Account added.",
      );
      setNewAccountName("");
      setNewAccountBalance("0.00");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Account could not be added.",
      );
    }
  }

  async function addCategory(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (!newCategoryName.trim()) return;
    try {
      await queue(
        "category",
        crypto.randomUUID(),
        "create",
        "0",
        {
          name: newCategoryName.trim(),
          kind: newCategoryKind,
          color: "blue",
          archived: false,
        },
        "Category added for the household.",
      );
      setNewCategoryName("");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Category could not be added.",
      );
    }
  }

  function startCategoryEdit(
    category: ChequebookCategory,
  ): void {
    setEditingCategory(category);
    setEditingCategoryName(category.name);
    setEditingCategoryKind(category.kind);
  }

  async function saveCategory(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (!editingCategory || !editingCategoryName.trim()) return;
    try {
      await queue(
        "category",
        editingCategory.id,
        "update",
        editingCategory.revision,
        {
          name: editingCategoryName.trim(),
          kind: editingCategoryKind,
          color: editingCategory.color,
          archived: editingCategory.archived,
        },
        "Household category updated.",
      );
      setEditingCategory(null);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Category could not be updated.",
      );
    }
  }

  return (
    <section>
      <ModuleHeader
        eyebrow="Chequebook"
        title="Settings"
        description="Accounts, categories, currency, and balance alerts are owned by the Chequebook module."
      />
      {message && (
        <Notice tone="neutral">
          {message}
        </Notice>
      )}

      <SettingsSection
        title="Household defaults"
        description="These settings apply to the shared household Chequebook."
      >
        <div className="cheq-grid">
          <FormField
            label="Currency"
            htmlFor="cheq-settings-currency"
          >
            <TextField
              id="cheq-settings-currency"
              maxLength={3}
              value={currency}
              onChange={(event) =>
                setCurrency(
                  event.currentTarget.value,
                )
              }
            />
          </FormField>
          <FormField
            label="Default account"
            htmlFor="cheq-settings-account"
          >
            <Select
              id="cheq-settings-account"
              value={defaultAccountId}
              onChange={(event) =>
                setDefaultAccountId(
                  event.currentTarget.value,
                )
              }
            >
              {accounts
                .filter(
                  (account) =>
                    !account.archived,
                )
                .map((account) => (
                  <option
                    key={account.id}
                    value={account.id}
                  >
                    {account.name}
                  </option>
                ))}
            </Select>
          </FormField>
        </div>
        <FormField
          label="Low-balance alert threshold"
          htmlFor="cheq-settings-threshold"
          hint="Optional. Leave blank to disable."
        >
          <TextField
            id="cheq-settings-threshold"
            type="number"
            step="0.01"
            value={lowBalanceThreshold}
            onChange={(event) =>
              setLowBalanceThreshold(
                event.currentTarget.value,
              )
            }
          />
        </FormField>
        <Button
          onClick={() =>
            void saveSettings()
          }
        >
          Save settings
        </Button>
      </SettingsSection>

      <SettingsSection
        title="Accounts"
        description="Chequebook supports checking, savings, cash, and credit accounts."
      >
        <div className="cheq-list">
          {accounts.map((account) => (
            <div
              className="cheq-row"
              key={account.id}
            >
              <span>
                <strong>
                  {account.name}
                </strong>
                <div className="cheq-muted">
                  {account.type} · opening{" "}
                  {formatMoney(
                    account.openingBalance,
                    settings?.currency ??
                      "CAD",
                    locale,
                  )}
                </div>
              </span>
              {account.archived && (
                <Badge>Archived</Badge>
              )}
            </div>
          ))}
        </div>
        <form
          className="cheq-form"
          onSubmit={(event) =>
            void addAccount(event)
          }
        >
          <div className="cheq-grid">
            <FormField
              label="New account"
              htmlFor="cheq-new-account"
            >
              <TextField
                id="cheq-new-account"
                value={newAccountName}
                onChange={(event) =>
                  setNewAccountName(
                    event.currentTarget
                      .value,
                  )
                }
              />
            </FormField>
            <FormField
              label="Type"
              htmlFor="cheq-new-account-type"
            >
              <Select
                id="cheq-new-account-type"
                value={newAccountType}
                onChange={(event) =>
                  setNewAccountType(
                    event.currentTarget
                      .value as ChequebookAccount["type"],
                  )
                }
              >
                {CHEQUEBOOK_ACCOUNT_TYPES.map(
                  (type) => (
                    <option
                      key={type}
                      value={type}
                    >
                      {type}
                    </option>
                  ),
                )}
              </Select>
            </FormField>
          </div>
          <FormField
            label="Opening balance"
            htmlFor="cheq-new-account-balance"
          >
            <TextField
              id="cheq-new-account-balance"
              type="number"
              step="0.01"
              value={newAccountBalance}
              onChange={(event) =>
                setNewAccountBalance(
                  event.currentTarget.value,
                )
              }
            />
          </FormField>
          <Button type="submit">
            Add account
          </Button>
        </form>
      </SettingsSection>

      <SettingsSection
        title="Categories"
        description="Categories drive monthly budgets and spending analytics."
      >
        <div className="cheq-list">
          {categories
            .filter(
              (category) =>
                !category.archived,
            )
            .map((category) => (
              <div className="cheq-row" key={category.id}>
                <span>
                  <strong>{category.name}</strong>
                  <div className="cheq-muted">{category.kind}</div>
                </span>
                <Button
                  type="button"
                  variant="quiet"
                  onClick={() => startCategoryEdit(category)}
                >
                  Edit
                </Button>
              </div>
            ))}
        </div>
        {editingCategory && (
          <form
            className="cheq-form"
            onSubmit={(event) => void saveCategory(event)}
          >
            <div className="cheq-grid">
              <FormField
                label="Category name"
                htmlFor="cheq-edit-category"
              >
                <TextField
                  id="cheq-edit-category"
                  value={editingCategoryName}
                  onChange={(event) =>
                    setEditingCategoryName(event.currentTarget.value)
                  }
                />
              </FormField>
              <FormField
                label="Used for"
                htmlFor="cheq-edit-category-kind"
              >
                <Select
                  id="cheq-edit-category-kind"
                  value={editingCategoryKind}
                  onChange={(event) =>
                    setEditingCategoryKind(
                      event.currentTarget.value as ChequebookCategory["kind"],
                    )
                  }
                >
                  <option value="expense">Expenses</option>
                  <option value="income">Income</option>
                  <option value="both">Both</option>
                </Select>
              </FormField>
            </div>
            <div className="cheq-actions">
              <Button
                type="button"
                variant="quiet"
                onClick={() => setEditingCategory(null)}
              >
                Cancel
              </Button>
              <Button type="submit">Save category</Button>
            </div>
          </form>
        )}
        <form
          className="cheq-form"
          onSubmit={(event) =>
            void addCategory(event)
          }
        >
          <div className="cheq-grid">
            <FormField
              label="New category"
              htmlFor="cheq-new-category"
            >
              <TextField
                id="cheq-new-category"
                value={newCategoryName}
                onChange={(event) =>
                  setNewCategoryName(
                    event.currentTarget
                      .value,
                  )
                }
              />
            </FormField>
            <FormField
              label="Used for"
              htmlFor="cheq-new-category-kind"
            >
              <Select
                id="cheq-new-category-kind"
                value={newCategoryKind}
                onChange={(event) =>
                  setNewCategoryKind(
                    event.currentTarget
                      .value as ChequebookCategory["kind"],
                  )
                }
              >
                <option value="expense">
                  Expenses
                </option>
                <option value="income">
                  Income
                </option>
                <option value="both">
                  Both
                </option>
              </Select>
            </FormField>
          </div>
          <Button type="submit">
            Add category
          </Button>
        </form>
      </SettingsSection>
    </section>
  );
}

async function boardState(
  actions: HomiWebModuleSurfaceProps["actions"],
) {
  const [
    settingsRows,
    accounts,
    transactions,
    rules,
    categories,
    limits,
  ] = await Promise.all([
    cached<ChequebookSettings>(
      actions,
      "chequebook-settings",
    ),
    cached<ChequebookAccount>(
      actions,
      "account",
    ),
    cached<ChequebookTransaction>(
      actions,
      "transaction",
    ),
    cached<ChequebookRecurringRule>(
      actions,
      "recurring-rule",
    ),
    cached<ChequebookCategory>(
      actions,
      "category",
    ),
    cached<ChequebookBudgetLimit>(
      actions,
      "budget-limit",
    ),
  ]);
  const settings = settingsRows[0];
  if (!settings) return null;
  return {
    settings,
    summary: offlineSummary(
      monthKey(),
      settings,
      accounts,
      transactions,
      rules,
      categories,
      limits,
    ),
  };
}

function BalanceBoard({
  context,
  actions,
}: HomiWebModuleSurfaceProps) {
  const [state, setState] =
    useState<Awaited<
      ReturnType<typeof boardState>
    >>(null);

  const householdId = context?.householdId ?? "";
  const locale = context?.locale ?? "en";

  useEffect(() => {
    void boardState(actions).then(
      setState,
    );
  }, [actions, householdId]);

  return (
    <button
      type="button"
      onClick={() =>
        actions.navigate(
          "/modules/chequebook",
        )
      }
    >
      <strong>Current balance</strong>
      <div className="cheq-number">
        {state
          ? formatMoney(
              state.summary.currentBalance,
              state.settings.currency,
              locale,
            )
          : "—"}
      </div>
      <span className="cheq-muted">
        Open Chequebook
      </span>
    </button>
  );
}

function SpendingBoard({
  context,
  actions,
}: HomiWebModuleSurfaceProps) {
  const [state, setState] =
    useState<Awaited<
      ReturnType<typeof boardState>
    >>(null);

  const householdId = context?.householdId ?? "";
  const locale = context?.locale ?? "en";

  useEffect(() => {
    void boardState(actions).then(
      setState,
    );
  }, [actions, householdId]);

  return (
    <button
      type="button"
      onClick={() =>
        actions.navigate(
          "/modules/chequebook",
        )
      }
    >
      <strong>Spent this month</strong>
      <div className="cheq-number">
        {state
          ? formatMoney(
              state.summary.expenses,
              state.settings.currency,
              locale,
            )
          : "—"}
      </div>
      <span className="cheq-muted">
        Income{" "}
        {state
          ? formatMoney(
              state.summary.income,
              state.settings.currency,
              locale,
            )
          : "—"}
      </span>
    </button>
  );
}

function ForecastBoard({
  context,
  actions,
}: HomiWebModuleSurfaceProps) {
  const [state, setState] =
    useState<Awaited<
      ReturnType<typeof boardState>
    >>(null);

  const householdId = context?.householdId ?? "";
  const locale = context?.locale ?? "en";

  useEffect(() => {
    void boardState(actions).then(
      setState,
    );
  }, [actions, householdId]);

  return (
    <button
      type="button"
      onClick={() =>
        actions.navigate(
          "/modules/chequebook",
        )
      }
    >
      <strong>Cash-flow forecast</strong>
      <div className="cheq-number">
        {state
          ? formatMoney(
              state.summary.forecastBalance,
              state.settings.currency,
              locale,
            )
          : "—"}
      </div>
      <span className="cheq-muted">
        After pending recurring items
      </span>
    </button>
  );
}

export function createHomiWebModule(
  _context: HomiWebModuleHostContext,
) {
  return defineHomiWebModule({
    moduleKey: CHEQUEBOOK_MODULE_KEY,
    moduleApiVersion:
      HOMI_MODULE_API_VERSION,
    pages: {
      chequebook: ChequebookPage,
    },
    setup: ChequebookSetup,
    settings: {
      household: ChequebookSettings,
    },
    familyBoard: {
      "current-balance": BalanceBoard,
      "monthly-spend": SpendingBoard,
      "cash-flow-forecast":
        ForecastBoard,
    },
    sync: {
      mutationAdapters:
        chequebookMutationAdapters,
      changeHandlers:
        chequebookChangeHandlers,
    },
  });
}
