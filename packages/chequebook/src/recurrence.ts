import type {
  ChequebookRecurrenceFrequency,
  ChequebookRecurringOccurrence,
  ChequebookRecurringRule,
} from "./types.js";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseDateOnly(value: string): Date | null {
  if (!DATE.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysInUtcMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

export function recurrenceDate(
  startDate: string,
  frequency: ChequebookRecurrenceFrequency,
  interval: number,
  index: number,
): string | null {
  const base = parseDateOnly(startDate);
  if (!base || index < 0 || interval < 1) return null;
  if (index === 0) return startDate;

  if (frequency === "daily") {
    const next = new Date(base);
    next.setUTCDate(
      next.getUTCDate() + index * interval,
    );
    return formatDateOnly(next);
  }

  if (frequency === "weekly") {
    const next = new Date(base);
    next.setUTCDate(
      next.getUTCDate() + index * interval * 7,
    );
    return formatDateOnly(next);
  }

  if (frequency === "monthly") {
    const totalMonths =
      base.getUTCFullYear() * 12 +
      base.getUTCMonth() +
      index * interval;
    const year = Math.floor(totalMonths / 12);
    const month = totalMonths % 12;
    const day = base.getUTCDate();
    if (day > daysInUtcMonth(year, month)) {
      return null;
    }
    return formatDateOnly(
      new Date(Date.UTC(year, month, day)),
    );
  }

  const year =
    base.getUTCFullYear() + index * interval;
  const month = base.getUTCMonth();
  const day = base.getUTCDate();
  if (day > daysInUtcMonth(year, month)) {
    return null;
  }
  return formatDateOnly(
    new Date(Date.UTC(year, month, day)),
  );
}

export function expandRecurringRule(
  rule: ChequebookRecurringRule,
  rangeStart: string,
  rangeEnd: string,
): readonly ChequebookRecurringOccurrence[] {
  if (
    !rule.active ||
    !DATE.test(rangeStart) ||
    !DATE.test(rangeEnd) ||
    rangeEnd < rangeStart
  ) {
    return Object.freeze([]);
  }

  const results: ChequebookRecurringOccurrence[] = [];
  let index = 0;
  let attempts = 0;
  while (attempts < 20_000) {
    attempts += 1;
    const date = recurrenceDate(
      rule.startDate,
      rule.frequency,
      rule.interval,
      index,
    );
    index += 1;

    // Invalid month/year occurrences (e.g. Jan 31 -> Feb,
    // Feb 29 in a non-leap year) are skipped, not shifted.
    if (date === null) {
      continue;
    }

    if (
      rule.recurrenceUntil !== null &&
      date > rule.recurrenceUntil
    ) {
      break;
    }
    if (date > rangeEnd) break;
    if (date < rangeStart) continue;

    results.push(
      Object.freeze({
        ruleId: rule.id,
        occurrenceDate: date,
        kind: rule.kind,
        amount: rule.amount,
        label: rule.label,
        categoryId: rule.categoryId,
        accountId: rule.accountId,
        personId: rule.personId,
        status: "pending" as const,
        postedTransactionId: null,
      }),
    );
  }

  return Object.freeze(results);
}

export function expandRecurringRules(
  rules: readonly ChequebookRecurringRule[],
  rangeStart: string,
  rangeEnd: string,
): readonly ChequebookRecurringOccurrence[] {
  return Object.freeze(
    rules
      .flatMap((rule) =>
        expandRecurringRule(rule, rangeStart, rangeEnd),
      )
      .sort((a, b) =>
        a.occurrenceDate.localeCompare(b.occurrenceDate) ||
        a.ruleId.localeCompare(b.ruleId),
      ),
  );
}
