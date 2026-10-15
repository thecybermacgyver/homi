export const KISS_MODULE_KEY = "kiss" as const;
export const KISS_VERSION = "0.4.1" as const;

export const LIMITS = { answer: 2000, note: 500, title: 120, step: 200, steps: 30 } as const;
export const PHASES = ["dating", "cohabiting", "married"] as const;
export type Phase = (typeof PHASES)[number];
export const ENTITY_TYPES = ["partnership", "answer", "checkin", "note", "date", "quiz", "swipe"] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];
