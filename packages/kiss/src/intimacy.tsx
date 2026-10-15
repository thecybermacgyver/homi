import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Tabs } from "@homi/ui";
import { CHALLENGES, GROUP_LABEL, INTIMACY_IDEAS, type Challenge } from "./intimacydata.js";
import type { KissContext, Swipe } from "./types.js";

type Choice = "yes" | "no" | "maybe";
const CHOICE_LABEL: Record<Choice, string> = { yes: "Yes", maybe: "Maybe", no: "No" };

function Checklist({ ctx, swipes }: { ctx: KissContext; swipes: readonly Swipe[] }) {
  const mine = useMemo(() => {
    const map = new Map<string, Swipe>();
    swipes.forEach((s) => { if (s.authorPersonId === ctx.me.personId || s.authorPersonId === null) map.set(s.itemId, s); });
    return map;
  }, [swipes, ctx.me.personId]);
  const next = INTIMACY_IDEAS.find((i) => !mine.has(i.id)) ?? null;
  const [reviewing, setReviewing] = useState(false);
  const inflight = useRef(new Set<string>());

  async function choose(itemId: string, choice: Choice) {
    if (inflight.current.has(itemId)) return;
    inflight.current.add(itemId);
    const existing = mine.get(itemId);
    try {
      if (existing) {
        await ctx.mutate({ entityType: "swipe", entityId: existing.id, operation: "update", baseRevision: existing.revision, payload: { choice } });
      } else {
        await ctx.mutate({ entityType: "swipe", entityId: crypto.randomUUID(), operation: "create", baseRevision: "0", payload: { itemId, choice } });
      }
    } finally { inflight.current.delete(itemId); }
  }
  const answered = mine.size;
  return (
    <section aria-label="Yes, No, Maybe checklist">
      <p className="kiss-sub">Answer on your own. Your partner never sees a No or a Maybe, only the ideas you both said Yes to.</p>
      <p className="kiss-meta">{answered} of {INTIMACY_IDEAS.length} answered</p>
      {next && !reviewing ? (
        <div className="kiss-card">
          <span className="kiss-kind">{GROUP_LABEL[next.group]}</span>
          <h2 className="kiss-q">{next.text}</h2>
          <div className="kiss-row" style={{ marginTop: ".8rem" }}>
            {(["yes", "maybe", "no"] as Choice[]).map((c) => (
              <Button key={c} variant={c === "yes" ? "primary" : "secondary"} disabled={ctx.busy}
                onClick={() => void choose(next.id, c)}>{CHOICE_LABEL[c]}</Button>
            ))}
          </div>
        </div>
      ) : !reviewing && (
        <div className="kiss-card"><p>You have answered everything. New ideas will appear as the deck grows.</p></div>
      )}
      <Button variant="quiet" onClick={() => setReviewing((v) => !v)}>{reviewing ? "Back to the cards" : "Review and change my answers"}</Button>
      {reviewing && INTIMACY_IDEAS.filter((i) => mine.has(i.id)).map((idea) => {
        const s = mine.get(idea.id) as Swipe;
        return (
          <div key={idea.id} className="kiss-card">
            <p>{idea.text}</p>
            <div className="kiss-row" role="group" aria-label={idea.text}>
              {(["yes", "maybe", "no"] as Choice[]).map((c) => (
                <Button key={c} variant={s.choice === c ? "primary" : "secondary"} aria-pressed={s.choice === c}
                  onClick={() => void choose(idea.id, c)}>{CHOICE_LABEL[c]}</Button>
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}

function Matches({ ctx, swipes }: { ctx: KissContext; swipes: readonly Swipe[] }) {
  const matched = INTIMACY_IDEAS.filter((idea) => {
    const mine = swipes.find((s) => s.itemId === idea.id && (s.authorPersonId === ctx.me.personId || s.authorPersonId === null));
    const theirs = swipes.find((s) => s.itemId === idea.id && s.authorPersonId === ctx.me.partnerPersonId);
    return mine?.choice === "yes" && theirs?.choice === "yes";
  });
  return (
    <section aria-label="Shared yes matches">
      <p className="kiss-sub">Only ideas you both said Yes to appear here.</p>
      {matched.length === 0 && <div className="kiss-card"><p>No matches yet. They show up the moment you both say Yes to the same idea.</p></div>}
      {matched.map((m) => (
        <div key={m.id} className="kiss-card"><span className="kiss-kind">{GROUP_LABEL[m.group]}</span><p>{m.text}</p></div>
      ))}
    </section>
  );
}

function format(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function Runner({ challenge, onClose }: { challenge: Challenge; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [left, setLeft] = useState(challenge.steps[0]?.seconds ?? 0);
  const [running, setRunning] = useState(false);
  const current = challenge.steps[step];
  const finished = step >= challenge.steps.length;
  useEffect(() => {
    if (!running || finished) return;
    const t = window.setInterval(() => setLeft((v) => v - 1), 1000);
    return () => window.clearInterval(t);
  }, [running, finished, step]);
  useEffect(() => {
    if (left > 0 || !running) return;
    try { navigator.vibrate?.(200); } catch { /* optional */ }
    setRunning(false);
  }, [left, running]);
  const advance = () => {
    const nextStep = step + 1;
    setStep(nextStep);
    setLeft(challenge.steps[nextStep]?.seconds ?? 0);
    setRunning(false);
  };
  return (
    <section aria-label={challenge.title}>
      <div className="kiss-card">
        <h2 className="kiss-q">{challenge.title}</h2>
        {finished ? (
          <>
            <p>That was lovely. Take a moment before you go back to your evening.</p>
            <Button onClick={onClose}>Done</Button>
          </>
        ) : (
          <>
            <p className="kiss-meta">Step {step + 1} of {challenge.steps.length}</p>
            <p style={{ fontSize: "1.15rem", margin: ".4rem 0" }}>{current?.text}</p>
            <p className="kiss-score" role="timer" aria-live="off" aria-label={`${format(Math.max(0, left))} left`}>{format(Math.max(0, left))}</p>
            <div className="kiss-bar" aria-hidden="true">
              <span style={{ width: `${100 - (Math.max(0, left) / (current?.seconds || 1)) * 100}%` }} />
            </div>
            <div className="kiss-row">
              <Button onClick={() => setRunning((v) => !v)}>{running ? "Pause" : left === current?.seconds ? "Start" : "Resume"}</Button>
              <Button variant="secondary" onClick={advance}>{step === challenge.steps.length - 1 ? "Finish" : "Next step"}</Button>
              <Button variant="quiet" onClick={onClose}>Stop</Button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function Challenges() {
  const [open, setOpen] = useState<Challenge | null>(null);
  if (open) return <Runner challenge={open} onClose={() => setOpen(null)} />;
  return (
    <section aria-label="Guided challenges">
      <p className="kiss-sub">Short, gentle, step-by-step. Stop whenever either of you wants to.</p>
      {CHALLENGES.map((c) => {
        const total = c.steps.reduce((n, s) => n + s.seconds, 0);
        return (
          <div key={c.id} className="kiss-card">
            <h3>{c.title}</h3>
            <p>{c.intro}</p>
            <p className="kiss-meta">About {Math.round(total / 60)} min · {c.steps.length} steps</p>
            <Button onClick={() => setOpen(c)}>Begin</Button>
          </div>
        );
      })}
    </section>
  );
}

export function Intimacy({ ctx, swipes }: { ctx: KissContext; swipes: readonly Swipe[] }) {
  const [tab, setTab] = useState("checklist");
  return (
    <section aria-label="Passion and depth">
      <Tabs label="Passion and depth" activeId={tab} onChange={setTab} items={[
        { id: "checklist", label: "Checklist" }, { id: "matches", label: "Matches" }, { id: "challenges", label: "Challenges" },
      ]} />
      {tab === "checklist" && <Checklist ctx={ctx} swipes={swipes} />}
      {tab === "matches" && <Matches ctx={ctx} swipes={swipes} />}
      {tab === "challenges" && <Challenges />}
    </section>
  );
}
