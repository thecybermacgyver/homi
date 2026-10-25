import { useState, type FormEvent } from "react";
import { Button, FormField, TextArea } from "@homi/ui";
import { LIMITS, type Phase } from "./constants.js";
import { dayNumber, questionById, questionFor, vibeMatch } from "./engine.js";
import type { Answer, KissContext } from "./types.js";

export const HISTORY_DAYS = 7;

function dayString(n: number): string {
  return new Date(n * 86_400_000).toISOString().slice(0, 10);
}

function label(day: string): string {
  return new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" })
    .format(new Date(day + "T00:00:00Z"));
}

function PastDay({ ctx, day, phase, mine, theirs }: {
  ctx: KissContext; day: string; phase: Phase; mine: Answer | undefined; theirs: Answer | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [resonance, setResonance] = useState(3);
  // A partner's answer is only visible once you have answered, so the question
  // comes from whichever answer is known, else from the day's place in the deck.
  const known = mine ?? theirs;
  const question = (known ? questionById(known.questionId) : null) ?? questionFor(day, phase);
  const vibe = mine && theirs ? vibeMatch(mine, theirs) : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const body = text.trim();
    if (!body) return;
    const ok = await ctx.mutate({
      entityType: "answer", entityId: crypto.randomUUID(), operation: "create", baseRevision: "0",
      payload: { day, questionId: question.id, body, resonance },
    });
    if (ok) setText("");
  }

  const status = mine && theirs ? "Both answered" : mine ? `Waiting for ${ctx.partnerName}` : "Not answered yet";
  return (
    <div className="kiss-card">
      <button type="button" className="kiss-chip" aria-expanded={open} onClick={() => setOpen(!open)}>
        {label(day)} · {status}
      </button>
      {open && (
        <div>
          <h3 className="kiss-q" style={{ marginTop: ".6rem" }}>{question.text}</h3>
          {mine && theirs ? (
            <>
              <h3>You</h3><div className="kiss-answer">{mine.body}</div>
              <h3>{ctx.partnerName}</h3><div className="kiss-answer">{theirs.body}</div>
              {vibe && <p className="kiss-meta">Vibe match {vibe.score}%{vibe.shared.length > 0 ? ` · Common ground: ${vibe.shared.join(", ")}` : ""}</p>}
            </>
          ) : mine ? (
            <>
              <h3>You</h3><div className="kiss-answer">{mine.body}</div>
              <p className="kiss-meta" role="status">{ctx.partnerName} has not answered this one. Their answer will open here if they do.</p>
            </>
          ) : (
            <form onSubmit={submit}>
              <p className="kiss-meta">Answer it now to catch up. If {ctx.partnerName} answered that day, their answer opens as soon as yours is saved.</p>
              <FormField label="Your answer" htmlFor={`kiss-past-${day}`}>
                <TextArea id={`kiss-past-${day}`} rows={3} maxLength={LIMITS.answer} value={text} onChange={(e) => setText(e.target.value)} />
              </FormField>
              <FormField label={`How much does this feel true or important to you? ${resonance} of 5`} htmlFor={`kiss-past-res-${day}`}>
                <input id={`kiss-past-res-${day}`} type="range" min={1} max={5} value={resonance} onChange={(e) => setResonance(Number(e.target.value))} />
              </FormField>
              <Button type="submit" disabled={ctx.busy || text.trim().length === 0}>Lock in my answer</Button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

// The last week of daily questions, newest first, so a missed day can be read
// back or caught up on. Privacy is unchanged: the server still shows a
// partner's answer only after you have answered that same day.
export function History({ ctx, answers, day, phase, startedOn }: {
  ctx: KissContext; answers: readonly Answer[]; day: string; phase: Phase; startedOn: string;
}) {
  const t = dayNumber(day);
  const first = dayNumber(startedOn);
  const days: string[] = [];
  for (let n = t - 1; n >= t - HISTORY_DAYS && n >= first; n--) days.push(dayString(n));
  if (days.length === 0) return null;
  const own = (a: Answer) => a.authorPersonId === ctx.me.personId || a.authorPersonId === null;
  return (
    <section aria-label="The past week">
      <h2 className="kiss-q" style={{ marginTop: "1.2rem" }}>The past week</h2>
      {days.map((d) => (
        <PastDay key={d} ctx={ctx} day={d} phase={phase}
          mine={answers.find((a) => a.day === d && own(a))}
          theirs={answers.find((a) => a.day === d && a.authorPersonId === ctx.me.partnerPersonId)} />
      ))}
    </section>
  );
}
