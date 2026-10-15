import type { Phase } from "./constants.js";

export interface Partnership {
  readonly id: string;
  readonly partnerA: string;
  readonly partnerB: string;
  readonly phase: Phase;
  readonly startedOn: string;
  readonly revision: string;
}
export interface Answer {
  readonly id: string;
  readonly day: string;
  readonly questionId: string;
  readonly body: string;
  readonly resonance: number;
  readonly authorPersonId: string | null;
  readonly revision: string;
}
export interface Checkin {
  readonly id: string;
  readonly day: string;
  readonly battery: number;
  readonly desire: number;
  readonly stress: number;
  readonly authorPersonId: string | null;
  readonly revision: string;
}
export interface Note {
  readonly id: string;
  readonly body: string;
  readonly authorPersonId: string | null;
  readonly recipientPersonId: string | null;
  readonly readAt: string | null;
  readonly createdAt: string;
  readonly revision: string;
}
export interface Me {
  readonly personId: string;
  readonly administrator: boolean;
  readonly partnerPersonId: string | null;
  readonly partnership: Partnership | null;
  readonly isPartner: boolean;
}
export interface PersonOption { readonly personId: string; readonly displayName: string }

export interface DateStep { readonly id: string; readonly text: string; readonly done: boolean }
export interface PlannedDate {
  readonly id: string;
  readonly ideaId: string | null;
  readonly title: string;
  readonly scheduledFor: string | null;
  readonly checklist: readonly DateStep[];
  readonly done: boolean;
  readonly authorPersonId: string | null;
  readonly revision: string;
}
export interface QuizItem { readonly id: string; readonly v: number }
export interface QuizResult {
  readonly id: string;
  readonly quizId: string;
  // null on results saved before quizzes became daily.
  readonly day: string | null;
  readonly items: readonly QuizItem[];
  readonly authorPersonId: string | null;
  readonly revision: string;
}
export interface Swipe {
  readonly id: string;
  readonly itemId: string;
  readonly choice: "yes" | "no" | "maybe";
  readonly authorPersonId: string | null;
  readonly revision: string;
}

// What each section needs from the page's data layer.
export interface KissContext {
  readonly me: Me;
  readonly partnerName: string;
  readonly busy: boolean;
  readonly online: boolean;
  readonly timeZone: string;
  mutate(input: {
    entityType: string; entityId: string; operation: string; baseRevision: string; payload: Record<string, unknown>;
  }): Promise<boolean>;
  pull(): Promise<void>;
}
