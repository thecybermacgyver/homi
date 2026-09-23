export type ChequebookAccountType =
  | "checking"
  | "savings"
  | "cash"
  | "credit";

export type ChequebookTransactionKind =
  | "expense"
  | "income"
  | "transfer";

export type ChequebookRecurrenceFrequency =
  | "daily"
  | "weekly"
  | "monthly"
  | "yearly";

export type ChequebookCategoryKind =
  | "expense"
  | "income"
  | "both";

export interface ChequebookAccount {
  readonly id: string;
  readonly householdId: string;
  readonly name: string;
  readonly type: ChequebookAccountType;
  readonly openingBalance: string;
  readonly openingDate: string;
  readonly archived: boolean;
  readonly revision: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ChequebookCategory {
  readonly id: string;
  readonly householdId: string;
  readonly name: string;
  readonly kind: ChequebookCategoryKind;
  readonly color: string;
  readonly archived: boolean;
  readonly revision: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ChequebookTransaction {
  readonly id: string;
  readonly householdId: string;
  readonly accountId: string;
  readonly transferAccountId: string | null;
  readonly categoryId: string | null;
  readonly personId: string | null;
  readonly kind: ChequebookTransactionKind;
  readonly amount: string;
  readonly description: string;
  readonly payee: string | null;
  readonly date: string;
  readonly cleared: boolean;
  readonly reconciledAt: string | null;
  readonly notes: string | null;
  readonly recurringRuleId: string | null;
  readonly recurringOccurrenceDate: string | null;
  readonly calendarLinkEnabled: boolean;
  readonly revision: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ChequebookRecurringRule {
  readonly id: string;
  readonly householdId: string;
  readonly accountId: string;
  readonly transferAccountId: string | null;
  readonly categoryId: string | null;
  readonly personId: string | null;
  readonly kind: ChequebookTransactionKind;
  readonly amount: string;
  readonly label: string;
  readonly notes: string | null;
  readonly startDate: string;
  readonly frequency: ChequebookRecurrenceFrequency;
  readonly interval: number;
  readonly recurrenceUntil: string | null;
  readonly active: boolean;
  readonly calendarLinkEnabled: boolean;
  readonly revision: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ChequebookBudgetLimit {
  readonly id: string;
  readonly householdId: string;
  readonly categoryId: string;
  readonly budgetMonth: string;
  readonly amount: string;
  readonly rolloverEnabled: boolean;
  readonly revision: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ChequebookSettings {
  readonly householdId: string;
  readonly currency: string;
  readonly defaultAccountId: string;
  readonly lowBalanceThreshold: string | null;
  readonly revision: string;
}

export interface ChequebookRecurringOccurrence {
  readonly ruleId: string;
  readonly occurrenceDate: string;
  readonly kind: ChequebookTransactionKind;
  readonly amount: string;
  readonly label: string;
  readonly categoryId: string | null;
  readonly accountId: string;
  readonly personId: string | null;
  readonly status: "pending" | "posted" | "skipped";
  readonly postedTransactionId: string | null;
}

export interface ChequebookAccountBalance {
  readonly accountId: string;
  readonly balance: string;
  readonly clearedBalance: string;
}

export interface ChequebookMonthlySummary {
  readonly month: string;
  readonly currency: string;
  readonly income: string;
  readonly expenses: string;
  readonly transfers: string;
  readonly currentBalance: string;
  readonly forecastBalance: string;
  readonly upcomingRecurringIncome: string;
  readonly upcomingRecurringExpenses: string;
  readonly spentByCategory: ReadonlyArray<{
    readonly categoryId: string;
    readonly categoryName: string;
    readonly amount: string;
    readonly limit: string | null;
    readonly percentUsed: number | null;
  }>;
}

export interface ChequebookCalendarLinkStatus {
  readonly sourceType: "transaction" | "recurring-rule";
  readonly sourceId: string;
  readonly status: "pending" | "linked" | "unlinked" | "error";
  readonly calendarEventId: string | null;
  readonly lastError: string | null;
}
