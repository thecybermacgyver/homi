import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Button, FormField, Select, TextField } from "@homi/ui";
import {
  BUDGET_LABEL, DATE_IDEAS, SPAN_LABEL, VIBE_LABEL, ideaById,
  type Budget, type DateIdea, type Span, type Vibe,
} from "./dateideas.js";
import type { KissContext, PlannedDate } from "./types.js";

function countdown(target: string | null, now: number): string {
  if (!target) return "No date chosen yet";
  const ms = Date.parse(target) - now;
  if (ms <= 0) return "It is time";
  const m = Math.floor(ms / 60000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  if (d > 0) return `In ${d} day${d === 1 ? "" : "s"} ${h} h`;
  if (h > 0) return `In ${h} h ${m % 60} min`;
  return `In ${m} min`;
}

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function Planner({ idea, ctx, onClose }: { idea: DateIdea | null; ctx: KissContext; onClose: () => void }) {
  const [title, setTitle] = useState(idea?.title ?? "");
  const [when, setWhen] = useState("");
  const id = useRef(crypto.randomUUID());
  const sending = useRef(false);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (sending.current || title.trim() === "") return;
    sending.current = true;
    const steps = (idea?.steps ?? ["Choose the day", "Get ready"]).map((text) => ({ id: crypto.randomUUID(), text, done: false }));
    const ok = await ctx.mutate({
      entityType: "date", entityId: id.current, operation: "create", baseRevision: "0",
      payload: {
        ideaId: idea?.id ?? null, title: title.trim(), checklist: steps, done: false,
        scheduledFor: when ? new Date(when).toISOString() : null,
      },
    });
    sending.current = false;
    if (ok) onClose();
  }
  return (
    <form className="kiss-card" onSubmit={save}>
      <h3>Plan this date</h3>
      <FormField label="What are you doing?" htmlFor="kiss-dt-title">
        <TextField id="kiss-dt-title" type="text" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
      </FormField>
      <FormField label="When? (optional, starts the countdown)" htmlFor="kiss-dt-when">
        <TextField id="kiss-dt-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
      </FormField>
      <div className="kiss-row">
        <Button type="submit" disabled={ctx.busy || title.trim() === ""}>Add to our dates</Button>
        <Button variant="quiet" onClick={onClose}>Cancel</Button>
      </div>
    </form>
  );
}

function DateCard({ date, ctx, now }: { date: PlannedDate; ctx: KissContext; now: number }) {
  const [editing, setEditing] = useState(false);
  const [when, setWhen] = useState(toLocalInput(date.scheduledFor));
  const idea = ideaById(date.ideaId);
  const finished = date.checklist.filter((s) => s.done).length;
  const save = async (event: FormEvent) => {
    event.preventDefault();
    const ok = await ctx.mutate({
      entityType: "date", entityId: date.id, operation: "update", baseRevision: date.revision,
      payload: { title: date.title, checklist: date.checklist, scheduledFor: when ? new Date(when).toISOString() : null },
    });
    if (ok) setEditing(false);
  };
  return (
    <article className="kiss-card" aria-label={date.title}>
      <div className="kiss-row" style={{ justifyContent: "space-between" }}>
        <h3 style={date.done ? { textDecoration: "line-through", opacity: 0.8 } : undefined}>{date.title}</h3>
        {idea && <span className="kiss-kind">{VIBE_LABEL[idea.vibe]}</span>}
      </div>
      <p className="kiss-score" style={{ fontSize: "1.6rem" }}>{date.done ? "Done" : countdown(date.scheduledFor, now)}</p>
      {date.scheduledFor && <p className="kiss-meta">{new Date(date.scheduledFor).toLocaleString()}</p>}
      {date.checklist.length > 0 && (
        <fieldset style={{ border: 0, padding: 0, margin: ".6rem 0" }}>
          <legend className="kiss-meta">Checklist, {finished} of {date.checklist.length}</legend>
          {date.checklist.map((step) => (
            <label key={step.id} className="kiss-row" style={{ minHeight: 40 }}>
              <input type="checkbox" checked={step.done} style={{ width: 22, height: 22 }}
                onChange={(e) => void ctx.mutate({
                  entityType: "date", entityId: date.id, operation: "update", baseRevision: date.revision,
                  payload: { ticks: { [step.id]: e.target.checked } },
                })} />
              <span>{step.text}</span>
            </label>
          ))}
        </fieldset>
      )}
      {editing ? (
        <form onSubmit={save}>
          <FormField label="Change the date and time" htmlFor={"kiss-edit-" + date.id}>
            <TextField id={"kiss-edit-" + date.id} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </FormField>
          <div className="kiss-row"><Button type="submit">Save</Button><Button variant="quiet" onClick={() => setEditing(false)}>Cancel</Button></div>
        </form>
      ) : (
        <div className="kiss-row">
          <Button variant="secondary" onClick={() => void ctx.mutate({
            entityType: "date", entityId: date.id, operation: "update", baseRevision: date.revision, payload: { done: !date.done },
          })}>{date.done ? "Not done yet" : "We did it"}</Button>
          <Button variant="quiet" onClick={() => setEditing(true)}>Reschedule</Button>
          <Button variant="quiet" onClick={() => void ctx.mutate({
            entityType: "date", entityId: date.id, operation: "delete", baseRevision: date.revision, payload: {},
          })}>Remove</Button>
        </div>
      )}
    </article>
  );
}

export function Dates({ ctx, dates }: { ctx: KissContext; dates: readonly PlannedDate[] }) {
  const [budget, setBudget] = useState<"any" | `${Budget}`>("any");
  const [span, setSpan] = useState<"any" | Span>("any");
  const [vibe, setVibe] = useState<"any" | Vibe>("any");
  const [picked, setPicked] = useState<DateIdea | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [planning, setPlanning] = useState<DateIdea | "custom" | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(t); }, []);

  const pool = useMemo(() => DATE_IDEAS.filter((d) =>
    (budget === "any" || d.budget === Number(budget)) && (span === "any" || d.span === span) && (vibe === "any" || d.vibe === vibe)),
  [budget, span, vibe]);

  function spin() {
    if (pool.length === 0 || spinning) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const final = pool[Math.floor(Math.random() * pool.length)] as DateIdea;
    if (reduce) { setPicked(final); return; }
    setSpinning(true);
    let n = 0;
    const timer = window.setInterval(() => {
      setPicked(pool[Math.floor(Math.random() * pool.length)] as DateIdea);
      if (++n >= 10) { window.clearInterval(timer); setPicked(final); setSpinning(false); }
    }, 110);
  }

  const upcoming = [...dates].filter((d) => !d.done).sort((a, b) =>
    (a.scheduledFor ?? "9").localeCompare(b.scheduledFor ?? "9"));
  const past = dates.filter((d) => d.done);
  return (
    <section aria-label="Date nights">
      {planning ? (
        <Planner idea={planning === "custom" ? null : planning} ctx={ctx} onClose={() => setPlanning(null)} />
      ) : (
        <div className="kiss-card">
          <h2 className="kiss-q">Spin the date wheel</h2>
          <div className="kiss-row" style={{ alignItems: "end" }}>
            <FormField label="Budget" htmlFor="kiss-f-b">
              <Select id="kiss-f-b" value={budget} onChange={(e) => setBudget(e.target.value as typeof budget)}>
                <option value="any">Any</option>
                {([0, 1, 2] as Budget[]).map((b) => <option key={b} value={String(b)}>{BUDGET_LABEL[b]}</option>)}
              </Select>
            </FormField>
            <FormField label="Time" htmlFor="kiss-f-t">
              <Select id="kiss-f-t" value={span} onChange={(e) => setSpan(e.target.value as typeof span)}>
                <option value="any">Any</option>
                {(Object.keys(SPAN_LABEL) as Span[]).map((k) => <option key={k} value={k}>{SPAN_LABEL[k]}</option>)}
              </Select>
            </FormField>
            <FormField label="Vibe" htmlFor="kiss-f-v">
              <Select id="kiss-f-v" value={vibe} onChange={(e) => setVibe(e.target.value as typeof vibe)}>
                <option value="any">Any</option>
                {(Object.keys(VIBE_LABEL) as Vibe[]).map((k) => <option key={k} value={k}>{VIBE_LABEL[k]}</option>)}
              </Select>
            </FormField>
          </div>
          <p className="kiss-meta">{pool.length} idea{pool.length === 1 ? "" : "s"} match</p>
          <div className="kiss-row" style={{ margin: ".5rem 0" }}>
            <Button onClick={spin} disabled={pool.length === 0 || spinning}>{picked ? "Spin again" : "Spin the wheel"}</Button>
            <Button variant="secondary" onClick={() => setPlanning("custom")}>Plan our own</Button>
          </div>
          {picked && (
            <div className="kiss-answer" aria-live="polite">
              <strong>{picked.title}</strong>
              <p className="kiss-meta">{BUDGET_LABEL[picked.budget]} · {SPAN_LABEL[picked.span]} · {VIBE_LABEL[picked.vibe]}</p>
              {!spinning && <Button onClick={() => setPlanning(picked)}>Plan this date</Button>}
            </div>
          )}
        </div>
      )}
      <h2 className="kiss-q" style={{ margin: "1rem 0 .2rem" }}>Coming up</h2>
      {upcoming.length === 0 && <p className="kiss-sub">Nothing planned yet. Spin the wheel and pick one.</p>}
      {upcoming.map((d) => <DateCard key={d.id} date={d} ctx={ctx} now={now} />)}
      {past.length > 0 && <h2 className="kiss-q" style={{ margin: "1rem 0 .2rem" }}>Done</h2>}
      {past.map((d) => <DateCard key={d.id} date={d} ctx={ctx} now={now} />)}
    </section>
  );
}
