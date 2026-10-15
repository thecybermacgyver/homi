import type { Phase } from "./constants.js";
import { SEASONAL, SEED, type Question } from "./questions.js";
import type { Checkin } from "./types.js";

// Days since the couple's start, so the deck is the same for both partners
// without any server round trip and is available offline.
export function dayNumber(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Math.floor(Date.UTC(y as number, (m as number) - 1, d as number) / 86_400_000);
}

// Newly dating couples start with lighter, story-telling questions; settled
// couples lean toward depth and romance. The weights set how often each mood
// comes up; the order inside a mood is fixed so nothing repeats within a year.
const WEIGHTS: Record<Phase, readonly [number, number, number, number]> = {
  dating: [4, 3, 2, 1],
  cohabiting: [2, 3, 3, 2],
  married: [2, 2, 3, 3],
};
const KINDS = ["light", "memory", "deep", "romance"] as const;

const decks = new Map<Phase, readonly Question[]>();

// One pass through the whole seed deck per cycle, with the moods interleaved
// in the phase's proportions until each mood runs out, so no question comes
// back before every other has been asked.
function deckFor(phase: Phase): readonly Question[] {
  const cached = decks.get(phase);
  if (cached) return cached;
  const weights = WEIGHTS[phase];
  const pools = KINDS.map((kind) => SEED.filter((q) => q.kind === kind));
  const cursor: number[] = [0, 0, 0, 0];
  const deck: Question[] = [];
  while (deck.length < SEED.length) {
    KINDS.forEach((_, k) => {
      for (let i = 0; i < (weights[k] as number); i++) {
        const pool = pools[k] as Question[];
        const at = cursor[k] ?? 0;
        if (at < pool.length) { deck.push(pool[at] as Question); cursor[k] = at + 1; }
      }
    });
  }
  decks.set(phase, deck);
  return deck;
}

export function questionFor(day: string, phase: Phase, answered: ReadonlySet<string> = new Set()): Question {
  const seasonal = SEASONAL.find((s) => day.slice(5) === `${String(s.month).padStart(2, "0")}-${String(s.day).padStart(2, "0")}`);
  if (seasonal) return { id: seasonal.id, kind: "romance", text: seasonal.text };
  const deck = deckFor(phase);
  const start = ((dayNumber(day) % deck.length) + deck.length) % deck.length;
  for (let offset = 0; offset < deck.length; offset++) {
    const candidate = deck[(start + offset) % deck.length] as Question;
    if (!answered.has(candidate.id)) return candidate;
  }
  return deck[start] as Question;
}

export function questionById(id: string): Question | null {
  const seasonal = SEASONAL.find((s) => s.id === id);
  if (seasonal) return { id: seasonal.id, kind: "romance", text: seasonal.text };
  return SEED.find((q) => q.id === id) ?? null;
}

const STOP = new Set("a an the and or but of to in on at for with is are was were be been it its this that i we you my our your me us do did have has had so as if not no yes just very more most than then too can could would should will".split(" "));

function words(text: string): Set<string> {
  return new Set(text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
}

export interface Vibe {
  readonly score: number;
  readonly shared: readonly string[];
  readonly tone: "aligned" | "complementary" | "different";
}

// Vibe Match blends how closely the two partners felt about the question (the
// 1-5 slider) with the words their answers share. It is a conversation
// starter, never a verdict.
export function vibeMatch(a: { body: string; resonance: number }, b: { body: string; resonance: number }): Vibe {
  const closeness = 1 - Math.abs(a.resonance - b.resonance) / 4;
  const wa = words(a.body);
  const wb = words(b.body);
  const shared = [...wa].filter((w) => wb.has(w));
  const union = new Set([...wa, ...wb]).size || 1;
  const overlap = Math.min(1, (shared.length / union) * 3);
  const score = Math.round((closeness * 0.6 + overlap * 0.4) * 100);
  const tone = score >= 70 ? "aligned" : score >= 45 ? "complementary" : "different";
  return { score, shared: shared.slice(0, 6), tone };
}

export const ADVICE: Record<Vibe["tone"], readonly string[]> = {
  aligned: [
    "You are close on this one. Say out loud what you each love about it.",
    "Pick one thing from your shared answer and do it together this week.",
  ],
  complementary: [
    "You see this a little differently, and that is useful. Ask each other what is behind your answer.",
    "Try: \"Tell me more about what that looks like for you.\" Listen before you answer.",
  ],
  different: [
    "Differences are information, not a problem. Take turns: one speaks, the other repeats back what they heard.",
    "Start with what you agree on, however small, then ask one curious question about the gap.",
    "If it gets heated, pause for ten minutes and come back. You are on the same side.",
  ],
};

export function prompt(partner: Checkin | null, own: Checkin | null): string {
  const c = partner ?? own;
  if (!c) return "Check in with each other tonight: ask one open question and listen without fixing.";
  if (c.stress >= 70) return "Skip the heavy talk tonight. Offer a 10-minute shoulder rub, or just quiet company.";
  if (c.battery <= 30) return "Energy is low. Keep it gentle: tea, a blanket, and ten minutes of easy conversation.";
  if (c.desire >= 70 && c.stress < 50) return "There is spark in the air. Make a little time for just the two of you.";
  if (c.battery >= 70) return "Good energy today. Plan something small to look forward to together.";
  return "A calm day. Ask: what is one thing I can do to make tomorrow easier for you?";
}

export interface Streak {
  readonly current: number;
  readonly longest: number;
  readonly todayDone: boolean;
  // Who did not answer yesterday, once the habit had started; null when
  // yesterday was fine or there is no history yet.
  readonly missed: "me" | "partner" | "both" | null;
}

// The streak goes up by one on each day both partners answered the daily
// question. Today never breaks it: until today is done the streak shows what
// it was through yesterday. A day that ends without both answers resets it.
export function streakOf(mine: ReadonlySet<string>, theirs: ReadonlySet<string>, today: string): Streak {
  const both = new Set<number>();
  mine.forEach((d) => { if (theirs.has(d)) both.add(dayNumber(d)); });
  const t = dayNumber(today);
  const todayDone = both.has(t);
  let current = 0;
  for (let n = todayDone ? t : t - 1; both.has(n); n--) current++;
  const sorted = [...both].sort((a, b) => a - b);
  let longest = 0, run = 0, prev = Number.NaN;
  for (const n of sorted) {
    run = n === prev + 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = n;
  }
  // A missed day only means something after the habit has started.
  const firstDay = Math.min(...[...mine, ...theirs].map(dayNumber));
  const y = t - 1;
  let missed: Streak["missed"] = null;
  if (Number.isFinite(firstDay) && firstDay <= y && !both.has(y) && !todayDone) {
    const iDid = [...mine].some((d) => dayNumber(d) === y);
    const theyDid = [...theirs].some((d) => dayNumber(d) === y);
    // When I did not answer I cannot see their answer, so it is reported as
    // mine to own up to; "both" is only known when I did answer.
    missed = !iDid ? "me" : !theyDid ? "partner" : null;
  }
  return { current, longest, todayDone, missed };
}
