export const CHEQUEBOOK_MODULE_KEY = "chequebook" as const;
export const CHEQUEBOOK_VERSION = "0.1.13" as const;

export const CHEQUEBOOK_ACCOUNT_TYPES = [
  "checking",
  "savings",
  "cash",
  "credit",
] as const;

export const CHEQUEBOOK_TRANSACTION_KINDS = [
  "expense",
  "income",
  "transfer",
] as const;

export const CHEQUEBOOK_RECURRENCE_FREQUENCIES = [
  "daily",
  "weekly",
  "monthly",
  "yearly",
] as const;
