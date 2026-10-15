import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  defineHomiWebModule, HOMI_MODULE_API_VERSION,
  type HomiWebModuleSurfaceProps, type HomiWebModuleMutationState,
} from "@homi/module-sdk";
import { Button, FormField, Select, Switch, Tabs, TextArea, TextField } from "@homi/ui";
import { KISS_MODULE_KEY, LIMITS, PHASES, type Phase } from "./constants.js";
import { ADVICE, prompt as promptFor, questionById, questionFor, streakOf, vibeMatch } from "./engine.js";
import { Dates } from "./dates.js";
import { Intimacy } from "./intimacy.js";
import { LOGO } from "./logo.js";
import { Quizzes } from "./quizzes.js";
import { changeHandlers, mutationAdapters } from "./sync.js";
import type { Answer, Checkin, KissContext, Me, Note, PersonOption, PlannedDate, QuizResult, Swipe } from "./types.js";

// Palette from the K.I.S.S. brand brief. Fonts fall back to the system's
// rounded faces so nothing is fetched from a third party.
const css = `
.kiss {--k-coral:#ff4d6d;--k-gold:#ffb703;--k-violet:#5e0894;--k-plum:#9d40d6;--k-cream:#fff0f5;
  background:radial-gradient(circle at 20% 0,#7a14c2 0,#7209b7 50%,var(--k-violet) 100%);color:var(--k-cream);
  font-family:"Nunito",ui-rounded,system-ui,sans-serif;border-radius:24px;padding:clamp(1rem,3vw,1.6rem);
  max-width:48rem;margin:auto;position:relative;overflow:hidden;box-shadow:0 0 20px rgba(255,77,109,.25)}
.kiss h1,.kiss h2,.kiss h3,.kiss p {margin:0}
.kiss-title {font-family:"Baloo 2",ui-rounded,system-ui,sans-serif;font-size:clamp(1.8rem,6vw,2.4rem);color:var(--k-gold);
  letter-spacing:.02em}
.kiss-sub {opacity:.85;margin:.1rem 0 1rem}
.kiss-head {display:flex;align-items:center;justify-content:space-between;gap:.8rem;margin:0 0 .6rem}
.kiss-head .kiss-sub {margin:0;font-size:clamp(.72rem,2.6vw,1rem)}
.kiss-streak {display:flex;flex-direction:column;align-items:center;flex:0 0 auto;position:relative;
  width:74px;color:#fff;text-align:center}
.kiss-streak svg {width:74px;height:68px;display:block;filter:drop-shadow(0 0 10px rgba(255,77,109,.7))}
.kiss-streak b {position:absolute;top:19px;left:0;right:0;font-family:"Baloo 2",ui-rounded,system-ui,sans-serif;
  font-size:1.45rem;line-height:1;text-shadow:0 1px 3px rgba(60,0,60,.7)}
.kiss-streak span {font-size:.7rem;opacity:.9;margin-top:-2px}
.kiss-streak.sad {width:120px}
.kiss-streak.sad span {font-size:.78rem;text-align:center;margin-top:.1rem}
.kiss-streak.sad svg {filter:drop-shadow(0 0 8px rgba(154,122,181,.6))}
.kiss-streak.live svg {animation:kiss-beat 1.6s ease-in-out infinite}
@keyframes kiss-beat {0%,100%{transform:scale(1)}50%{transform:scale(1.07)}}
@media (prefers-reduced-motion: reduce) {.kiss-streak.live svg{animation:none}}
.kiss-today {display:flex;gap:.5rem;flex-wrap:wrap;margin:.2rem 0 .6rem}
.kiss-chip {display:inline-flex;align-items:center;gap:.4rem;border-radius:999px;padding:.35rem .8rem;min-height:40px;
  background:rgba(255,240,245,.15);border:1px solid rgba(255,240,245,.4);color:var(--k-cream);font:inherit;cursor:pointer}
.kiss-chip.done {background:var(--k-gold);border-color:var(--k-gold);color:#3b0764;font-weight:700}
.kiss-logo {width:72px;height:72px;flex:0 0 auto;border-radius:18px;box-shadow:0 0 16px rgba(255,183,3,.35)}
.kiss-brand {text-align:right;min-width:0}
.kiss-title {line-height:1.05}
.kiss-card {background:var(--k-plum);border:1px solid rgba(255,240,245,.4);border-radius:20px;padding:1rem 1.1rem;
  margin:.8rem 0;box-shadow:0 0 20px rgba(255,77,109,.18)}
.kiss-q {font-family:"Baloo 2",ui-rounded,system-ui,sans-serif;font-size:1.35rem;line-height:1.3}
.kiss-kind {display:inline-block;font-size:.75rem;font-weight:800;text-transform:uppercase;letter-spacing:.08em;
  background:var(--k-gold);color:#3b0764;border-radius:999px;padding:.1rem .6rem;margin-bottom:.5rem}
.kiss label,.kiss legend {color:var(--k-cream)}
.kiss textarea,.kiss input[type=text],.kiss select {width:100%;box-sizing:border-box}
.kiss input[type=range] {width:100%;accent-color:var(--k-coral);min-height:32px}
.kiss .homi-ui-button--primary {background:var(--k-coral);border-color:var(--k-coral);color:#fff}
.kiss .homi-ui-button--secondary,.kiss .homi-ui-button--quiet {background:transparent;color:var(--k-cream);border-color:rgba(255,240,245,.5)}
.kiss-row {display:flex;gap:.6rem;flex-wrap:wrap;align-items:center}
.kiss-locked {filter:blur(7px);user-select:none;pointer-events:none}
.kiss-score {font-family:"Baloo 2",ui-rounded,system-ui,sans-serif;font-size:3rem;color:var(--k-gold);line-height:1}
.kiss-bar {height:12px;border-radius:99px;background:rgba(255,240,245,.2);overflow:hidden;margin:.4rem 0}
.kiss-bar > span {display:block;height:100%;background:linear-gradient(90deg,var(--k-coral),var(--k-gold))}
.kiss-answer {background:rgba(74,8,118,.5);border-radius:16px;padding:.7rem .9rem;margin:.5rem 0;white-space:pre-wrap;overflow-wrap:anywhere}
.kiss-err {background:#ffe3e8;color:#6b0020;border-radius:12px;padding:.6rem .8rem;margin:.6rem 0}
.kiss .kiss-err .homi-ui-button {background:#6b0020;border-color:#6b0020;color:#fff;margin-top:.4rem}
.kiss-note {margin:.5rem 0}
.kiss-note.mine {text-align:right}
.kiss-bubble {display:inline-block;max-width:90%;text-align:left;background:var(--k-plum);border:1px solid rgba(255,240,245,.3);
  border-radius:18px;padding:.6rem .9rem;overflow-wrap:anywhere;white-space:pre-wrap}
.kiss-note.new .kiss-bubble {border-color:var(--k-gold);box-shadow:0 0 14px rgba(255,183,3,.45)}
.kiss-meta {font-size:.8rem;opacity:.8;margin-top:.15rem}
.kiss-lock {text-align:center;padding:2rem 1rem}
.kiss-spark {position:absolute;width:6px;height:6px;border-radius:50%;background:var(--k-gold);opacity:.6;
  animation:kiss-float 7s ease-in infinite;pointer-events:none}
@keyframes kiss-float {0%{transform:translateY(0);opacity:0}20%{opacity:.7}100%{transform:translateY(-120px);opacity:0}}
@media (prefers-reduced-motion: reduce) {.kiss-spark{display:none}}
`;

function today(timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

async function getData(path: string, props: HomiWebModuleSurfaceProps, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch("/api/v1/modules/kiss/" + path, {
    credentials: "same-origin",
    headers: { "X-Homi-Household-ID": props.context.householdId, "X-Homi-Client-ID": props.context.clientId },
    ...(signal ? { signal } : {}),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error?.message ?? "K.I.S.S. could not be loaded.");
  return body.data;
}

// ---- data ---------------------------------------------------------------

function useKiss(props: HomiWebModuleSurfaceProps) {
  const latest = useRef(props); latest.current = props;
  const [me, setMe] = useState<Me | null>(null);
  const [partnerName, setPartnerName] = useState("Your partner");
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [checkins, setCheckins] = useState<Checkin[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [dates, setDates] = useState<PlannedDate[]>([]);
  const [quizzes, setQuizzes] = useState<QuizResult[]>([]);
  const [swipes, setSwipes] = useState<Swipe[]>([]);
  const [mutations, setMutations] = useState<readonly HomiWebModuleMutationState[]>([]);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const active = useRef(true);
  const chain = useRef<Promise<unknown>>(Promise.resolve());

  const readWorking = useCallback(async () => {
    const a = latest.current.actions;
    const [ans, chk, nts, dts, qzs, sws, pend] = await Promise.all([
      a.listWorkingEntities("answer"), a.listWorkingEntities("checkin"), a.listWorkingEntities("note"),
      a.listWorkingEntities("date"), a.listWorkingEntities("quiz"), a.listWorkingEntities("swipe"), a.listMutations(),
    ]);
    if (!active.current) return;
    setAnswers(ans.map((r) => r.data as Answer));
    setCheckins(chk.map((r) => r.data as Checkin));
    setNotes(nts.map((r) => r.data as Note).sort((x, y) => String(y.createdAt).localeCompare(String(x.createdAt))));
    setDates(dts.map((r) => r.data as PlannedDate).filter((d) => !(d as { deleted?: boolean }).deleted));
    setQuizzes(qzs.map((r) => r.data as QuizResult));
    setSwipes(sws.map((r) => r.data as Swipe));
    setMutations(pend);
  }, []);

  // Pull the filtered server view. This is also how a partner's answer
  // appears the moment both have answered.
  const pull = useCallback(async (signal?: AbortSignal) => {
    const p = latest.current;
    if (!p.context.online) return;
    const who = (await getData("me", p, signal)) as Me;
    if (signal?.aborted) return;
    setMe(who);
    await p.actions.replaceCachedEntities("me", [{ entityId: "me", revision: "0", data: who }]);
    if (!who.isPartner) { setLoaded(true); return; }
    const [ans, chk, nts, partner, dts, qzs, sws] = await Promise.all([
      getData("answers", p, signal), getData("checkins", p, signal), getData("notes", p, signal), getData("partner", p, signal),
      getData("dates", p, signal), getData("quizzes", p, signal), getData("swipes", p, signal),
    ]);
    if (signal?.aborted) return;
    const put = (items: unknown) => (items as Array<{ id: string; revision: string }>).map((x) => ({ entityId: x.id, revision: x.revision, data: x }));
    await Promise.all([
      p.actions.replaceCachedEntities("answer", put(ans)),
      p.actions.replaceCachedEntities("checkin", put(chk)),
      p.actions.replaceCachedEntities("note", put(nts)),
      p.actions.replaceCachedEntities("date", put(dts)),
      p.actions.replaceCachedEntities("quiz", put(qzs)),
      p.actions.replaceCachedEntities("swipe", put(sws)),
    ]);
    setPartnerName((partner as PersonOption).displayName);
    try { localStorage.setItem("kiss.partner." + p.context.householdId, (partner as PersonOption).displayName); } catch { /* optional */ }
    await readWorking();
    setLoaded(true);
  }, [readWorking]);

  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => { void readWorking().catch((e) => setError(String(e.message ?? e))); }, [props.actions, readWorking]);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const stored = await latest.current.actions.listCachedEntities("me");
      if (!controller.signal.aborted && stored[0]) { setMe(stored[0].data as Me); setLoaded(true); }
      try {
        const name = localStorage.getItem("kiss.partner." + latest.current.context.householdId);
        if (name) setPartnerName(name);
      } catch { /* optional */ }
      await readWorking();
      await pull(controller.signal);
    })().catch((e) => { if (!controller.signal.aborted) setError(String(e.message ?? e)); });
    // Re-check now and then so the unlock appears without a manual refresh.
    const timer = window.setInterval(() => { void pull(controller.signal).catch(() => undefined); }, 20_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [props.context.authSubject, props.context.householdId, props.context.online, pull, readWorking]);

  const mutate = (input: Parameters<HomiWebModuleSurfaceProps["actions"]["enqueueMutation"]>[0]): Promise<boolean> => {
    const run = chain.current.then(async () => {
      setBusy(true); setError("");
      try {
        await latest.current.actions.enqueueMutation(input);
        await readWorking();
        void pull().catch(() => undefined);
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return false;
      } finally { setBusy(false); }
    });
    chain.current = run;
    return run;
  };
  const dismiss = async (id: string) => {
    try { await latest.current.actions.dismissMutation(id); await readWorking(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  return {
    me, partnerName, answers, checkins, notes, dates, quizzes, swipes, error, loaded, busy, mutate, dismiss, pull,
    pending: mutations.filter((m) => m.status === "queued" || m.status === "sending").length,
    failures: mutations.filter((m) => m.status === "conflict" || m.status === "rejected"),
  };
}
type Data = ReturnType<typeof useKiss>;

// ---- privacy lock (per device; never leaves the browser) ------------------

async function digest(pin: string, salt: string): Promise<string> {
  const bytes = new TextEncoder().encode(salt + ":" + pin);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
const PIN_KEY = "kiss.pin";
function readPin(): { salt: string; hash: string } | null {
  try { const raw = localStorage.getItem(PIN_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

function Lock({ onUnlock }: { onUnlock: () => void }) {
  const [pin, setPin] = useState("");
  const [bad, setBad] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const stored = readPin();
    if (!stored || (await digest(pin, stored.salt)) === stored.hash) { onUnlock(); return; }
    setBad(true); setPin("");
  }
  return (
    <form className="kiss-card kiss-lock" onSubmit={submit}>
      <h2 className="kiss-q">Private</h2>
      <p className="kiss-sub">Enter your PIN to open this space.</p>
      <FormField label="PIN" htmlFor="kiss-pin" {...(bad ? { error: "That PIN is not right." } : {})}>
        <TextField id="kiss-pin" type="password" inputMode="numeric" autoComplete="off" value={pin}
          onChange={(e) => { setPin(e.target.value); setBad(false); }} />
      </FormField>
      <Button type="submit" disabled={pin.length === 0}>Unlock</Button>
    </form>
  );
}

// ---- tabs ---------------------------------------------------------------

function Today({ data, props, day }: { data: Data; props: HomiWebModuleSurfaceProps; day: string }) {
  const me = data.me as Me;
  const phase = me.partnership?.phase ?? "dating";
  const answeredIds = useMemo(() => new Set(data.answers.map((a) => a.questionId)), [data.answers]);
  const todays = data.answers.filter((a) => a.day === day);
  const mine = todays.find((a) => a.authorPersonId === me.personId || a.authorPersonId === null);
  const theirs = todays.find((a) => a.authorPersonId === me.partnerPersonId);
  const question = useMemo(() => {
    const own = mine ? questionById(mine.questionId) : null;
    return own ?? questionFor(day, phase as Phase, new Set([...answeredIds].filter((id) => id !== mine?.questionId)));
  }, [day, phase, answeredIds, mine]);
  const [text, setText] = useState("");
  const [resonance, setResonance] = useState(3);
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (mine) { setText(mine.body); setResonance(mine.resonance); } }, [mine?.id, mine?.revision]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const body = text.trim();
    if (!body) return;
    const ok = mine
      ? await data.mutate({ entityType: "answer", entityId: mine.id, operation: "update", baseRevision: mine.revision, payload: { body, resonance } })
      : await data.mutate({ entityType: "answer", entityId: crypto.randomUUID(), operation: "create", baseRevision: "0",
          payload: { day, questionId: question.id, body, resonance } });
    if (ok) setEditing(false);
  }

  const vibe = mine && theirs ? vibeMatch(mine, theirs) : null;
  const showForm = !mine || editing;
  return (
    <section aria-label="Today's spark">
      <div className="kiss-card">
        <span className="kiss-kind">{question.kind === "light" ? "Playful" : question.kind === "memory" ? "Remember" : question.kind === "deep" ? "Go deeper" : "Romance"}</span>
        <h2 className="kiss-q">{question.text}</h2>
      </div>
      {showForm ? (
        <form className="kiss-card" onSubmit={submit}>
          <FormField label="Your answer (only you see it until both of you answer)" htmlFor="kiss-answer">
            <TextArea id="kiss-answer" rows={4} maxLength={LIMITS.answer} value={text} onChange={(e) => setText(e.target.value)} />
          </FormField>
          <FormField label={`How much does this feel true or important to you? ${resonance} of 5`} htmlFor="kiss-res">
            <input id="kiss-res" type="range" min={1} max={5} value={resonance} onChange={(e) => setResonance(Number(e.target.value))} />
          </FormField>
          <div className="kiss-row">
            <Button type="submit" disabled={data.busy || text.trim().length === 0}>{mine ? "Save answer" : "Lock in my answer"}</Button>
            {mine && <Button variant="quiet" onClick={() => setEditing(false)}>Cancel</Button>}
          </div>
        </form>
      ) : !theirs ? (
        <div className="kiss-card">
          <p><strong>Your answer is locked in.</strong></p>
          <div className="kiss-answer kiss-locked" aria-hidden="true">{"•".repeat(40)}</div>
          <p className="kiss-meta" role="status">Waiting for {data.partnerName}. Their answer opens the moment they reply.</p>
          <div className="kiss-row"><Button variant="secondary" onClick={() => setEditing(true)}>Change my answer</Button>
            <Button variant="quiet" onClick={() => void data.pull()}>Check now</Button></div>
        </div>
      ) : (
        <div className="kiss-card">
          <p className="kiss-meta">Both answered</p>
          <h3>You</h3><div className="kiss-answer">{mine?.body}</div>
          <h3>{data.partnerName}</h3><div className="kiss-answer">{theirs.body}</div>
          {vibe && (
            <>
              <p className="kiss-score" aria-label={`Vibe match ${vibe.score} percent`}>{vibe.score}%</p>
              <div className="kiss-bar" aria-hidden="true"><span style={{ width: vibe.score + "%" }} /></div>
              {vibe.shared.length > 0 && <p>Common ground: {vibe.shared.join(", ")}</p>}
              <h3 style={{ marginTop: ".7rem" }}>Talk about it</h3>
              <ul>{ADVICE[vibe.tone].map((t) => <li key={t}>{t}</li>)}</ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function CheckIn({ data, day }: { data: Data; day: string }) {
  const me = data.me as Me;
  const own = data.checkins.find((c) => c.day === day && (c.authorPersonId === me.personId || c.authorPersonId === null));
  const theirs = data.checkins.find((c) => c.authorPersonId === me.partnerPersonId && c.day === day) ??
    data.checkins.filter((c) => c.authorPersonId === me.partnerPersonId)[0] ?? null;
  const [battery, setBattery] = useState(own?.battery ?? 50);
  const [desire, setDesire] = useState(own?.desire ?? 50);
  const [stress, setStress] = useState(own?.stress ?? 50);
  useEffect(() => { if (own) { setBattery(own.battery); setDesire(own.desire); setStress(own.stress); } }, [own?.id, own?.revision]);
  const save = (event: FormEvent) => {
    event.preventDefault();
    void (own
      ? data.mutate({ entityType: "checkin", entityId: own.id, operation: "update", baseRevision: own.revision, payload: { battery, desire, stress } })
      : data.mutate({ entityType: "checkin", entityId: crypto.randomUUID(), operation: "create", baseRevision: "0", payload: { day, battery, desire, stress } }));
  };
  const slider = (id: string, label: string, value: number, set: (n: number) => void) => (
    <FormField label={`${label}: ${value}`} htmlFor={id}>
      <input id={id} type="range" min={0} max={100} value={value} onChange={(e) => set(Number(e.target.value))} />
    </FormField>
  );
  return (
    <section aria-label="Daily check-in">
      <form className="kiss-card" onSubmit={save}>
        <h2 className="kiss-q">How are you today?</h2>
        {slider("kiss-b", "Emotional battery", battery, setBattery)}
        {slider("kiss-d", "Closeness and desire", desire, setDesire)}
        {slider("kiss-s", "Stress", stress, setStress)}
        <Button type="submit" disabled={data.busy}>{own ? "Update check-in" : "Share check-in"}</Button>
      </form>
      <div className="kiss-card">
        <h3>For tonight</h3>
        <p>{promptFor(theirs, own ?? null)}</p>
        {theirs && <p className="kiss-meta">Based on {data.partnerName}'s latest check-in ({theirs.day}).</p>}
      </div>
    </section>
  );
}

function Notes({ data }: { data: Data }) {
  const me = data.me as Me;
  const [text, setText] = useState("");
  const send = async (event: FormEvent) => {
    event.preventDefault();
    const body = text.trim();
    if (!body) return;
    if (await data.mutate({ entityType: "note", entityId: crypto.randomUUID(), operation: "create", baseRevision: "0", payload: { body } })) setText("");
  };
  return (
    <section aria-label="Love notes">
      <form className="kiss-card" onSubmit={send}>
        <FormField label={`A note for ${data.partnerName}`} htmlFor="kiss-note">
          <TextArea id="kiss-note" rows={3} maxLength={LIMITS.note} value={text} onChange={(e) => setText(e.target.value)} />
        </FormField>
        <Button type="submit" disabled={data.busy || text.trim().length === 0}>Drop in the jar</Button>
      </form>
      {data.notes.length === 0 && <p className="kiss-sub">No notes yet. A small compliment goes a long way.</p>}
      {data.notes.map((note) => {
        const mine = note.authorPersonId === me.personId || note.authorPersonId === null;
        const fresh = !mine && !note.readAt;
        return (
          <div key={note.id} className={`kiss-note${mine ? " mine" : ""}${fresh ? " new" : ""}`}>
            <div className="kiss-bubble">{note.body}</div>
            <p className="kiss-meta">
              {mine ? "You" : data.partnerName} · {new Date(note.createdAt).toLocaleDateString()}
              {fresh && <> · <button type="button" className="homi-ui-button homi-ui-button--quiet"
                onClick={() => void data.mutate({ entityType: "note", entityId: note.id, operation: "update", baseRevision: note.revision, payload: { read: true } })}>Mark read</button></>}
              {mine && <> · <button type="button" className="homi-ui-button homi-ui-button--quiet"
                onClick={() => void data.mutate({ entityType: "note", entityId: note.id, operation: "delete", baseRevision: note.revision, payload: {} })}>Delete</button></>}
            </p>
          </div>
        );
      })}
    </section>
  );
}

function Setup({ data, props, onDone }: { data: Data; props: HomiWebModuleSurfaceProps; onDone?: () => void }) {
  const me = data.me as Me;
  const [people, setPeople] = useState<PersonOption[]>([]);
  const existing = me.partnership;
  const [a, setA] = useState(existing?.partnerA ?? "");
  const [b, setB] = useState(existing?.partnerB ?? "");
  const [phase, setPhase] = useState<Phase>(existing?.phase ?? "dating");
  const [started, setStarted] = useState(existing?.startedOn ?? today(props.context.timeZone));
  const newId = useRef(crypto.randomUUID());
  const sending = useRef(false);
  useEffect(() => {
    if (!me.administrator || !props.context.online) return;
    void getData("people", props).then((rows) => setPeople(rows as PersonOption[])).catch(() => undefined);
  }, [me.administrator, props.context.online]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!me.administrator) {
    return <div className="kiss-card"><p>K.I.S.S. has not been set up for you. Ask a household administrator to pair the two partners.</p></div>;
  }
  const valid = a !== "" && b !== "" && a !== b;
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!valid || sending.current) return;
    sending.current = true;
    const payload = { partnerA: a, partnerB: b, phase, startedOn: started };
    try {
      const ok = existing
        ? await data.mutate({ entityType: "partnership", entityId: existing.id, operation: "update", baseRevision: existing.revision, payload })
        : await data.mutate({ entityType: "partnership", entityId: newId.current, operation: "create", baseRevision: "0", payload });
      if (ok) { await data.pull().catch(() => undefined); onDone?.(); }
    } finally { sending.current = false; }
  };
  const personSelect = (id: string, label: string, value: string, set: (v: string) => void) => (
    <FormField label={label} htmlFor={id}>
      <Select id={id} value={value} onChange={(e) => set(e.target.value)}>
        <option value="">Choose a person</option>
        {people.map((p) => <option key={p.personId} value={p.personId}>{p.displayName}</option>)}
      </Select>
    </FormField>
  );
  return (
    <form className="kiss-card" onSubmit={save}>
      <h2 className="kiss-q">Pair two partners</h2>
      <p className="kiss-sub">Only these two people will ever see each other's answers, check-ins and notes. Nobody else in the household can, including administrators.</p>
      {!props.context.online && <p className="kiss-meta">Connect to the server to choose people.</p>}
      {personSelect("kiss-a", "First partner", a, setA)}
      {personSelect("kiss-b", "Second partner", b, setB)}
      <FormField label="Where are you in your relationship?" htmlFor="kiss-phase">
        <Select id="kiss-phase" value={phase} onChange={(e) => setPhase(e.target.value as Phase)}>
          {PHASES.map((p) => <option key={p} value={p}>{p === "dating" ? "Newly dating" : p === "cohabiting" ? "Living together" : "Married"}</option>)}
        </Select>
      </FormField>
      <FormField label="Together since" htmlFor="kiss-since">
        <TextField id="kiss-since" type="date" value={started} onChange={(e) => setStarted(e.target.value)} />
      </FormField>
      <Button type="submit" disabled={!valid || data.busy}>{existing ? "Save pairing" : "Start K.I.S.S."}</Button>
    </form>
  );
}

function Privacy({ onLockNow }: { onLockNow: () => void }) {
  const [enabled, setEnabled] = useState(readPin() !== null);
  const [pin, setPin] = useState("");
  const [message, setMessage] = useState("");
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!/^\d{4,12}$/.test(pin)) { setMessage("Use 4 to 12 digits."); return; }
    const salt = crypto.randomUUID();
    try {
      localStorage.setItem(PIN_KEY, JSON.stringify({ salt, hash: await digest(pin, salt) }));
      setEnabled(true); setPin(""); setMessage("PIN set for this device.");
    } catch { setMessage("This browser would not save the PIN."); }
  }
  return (
    <div className="kiss-card">
      <h2 className="kiss-q">Privacy</h2>
      <p className="kiss-sub">The PIN is stored only on this device. Nothing here appears in notifications or on the Homi dashboard.</p>
      <form onSubmit={save}>
        <FormField label={enabled ? "Change PIN" : "Set a PIN"} htmlFor="kiss-newpin">
          <TextField id="kiss-newpin" type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} />
        </FormField>
        <div className="kiss-row">
          <Button type="submit">Save PIN</Button>
          {enabled && <Button variant="secondary" onClick={() => { try { localStorage.removeItem(PIN_KEY); } catch { /* optional */ } setEnabled(false); setMessage("PIN removed."); }}>Remove PIN</Button>}
          <Button variant="quiet" onClick={onLockNow}>Hide screen now</Button>
        </div>
        {message && <p className="kiss-meta" role="status">{message}</p>}
      </form>
    </div>
  );
}

// ---- page ---------------------------------------------------------------

function missedName(who: "me" | "partner" | "both", partner: string): string {
  return who === "me" ? "You" : who === "partner" ? partner : "You both";
}

function KissPage(props: HomiWebModuleSurfaceProps) {
  const data = useKiss(props);
  const [tab, setTab] = useState("today");
  const [locked, setLocked] = useState(() => readPin() !== null);
  const day = today(props.context.timeZone);
  const me = data.me;
  const ready = me?.isPartner === true && me.partnership !== null;
  const streak = useMemo(() => {
    if (!ready || !me) return null;
    const mine = new Set<string>();
    const theirs = new Set<string>();
    const add = (authorId: string | null, d: string) => {
      if (authorId === me.personId || authorId === null) mine.add(d);
      else if (authorId === me.partnerPersonId) theirs.add(d);
    };
    data.answers.forEach((a) => add(a.authorPersonId, a.day));
    return { ...streakOf(mine, theirs, day), mineToday: mine.has(day), theirsToday: theirs.has(day) };
  }, [ready, me, data.answers, day]);
  const ctx: KissContext | null = me ? {
    me, partnerName: data.partnerName, busy: data.busy, online: props.context.online, timeZone: props.context.timeZone,
    mutate: data.mutate, pull: data.pull,
  } : null;

  // Hide the screen when the tab is left, so a glance at a shared device shows nothing.
  useEffect(() => {
    const hide = () => { if (document.hidden && readPin() !== null) setLocked(true); };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, []);

  const tabs = [
    ...(ready ? [{ id: "today", label: "Today" }, { id: "checkin", label: "Check-in" }, { id: "notes", label: "Notes" },
      { id: "dates", label: "Dates" }, { id: "quizzes", label: "Quizzes" }, { id: "intimacy", label: "Passion" }] : []),
    ...(me?.administrator || ready ? [{ id: "settings", label: "Settings" }] : []),
  ];
  const active = tabs.some((t) => t.id === tab) ? tab : (tabs[0]?.id ?? "settings");
  const sparks = useMemo(() => Array.from({ length: 6 }, (_, i) => ({ left: 8 + i * 16, delay: i * 1.1, top: 70 + (i % 3) * 8 })), []);

  return (
    <section className="kiss">
      <style>{css}</style>
      {sparks.map((s, i) => <span key={i} className="kiss-spark" aria-hidden="true" style={{ left: s.left + "%", top: s.top + "%", animationDelay: s.delay + "s" }} />)}
      <header className="kiss-head">
        <img className="kiss-logo" src={LOGO} alt="" width={72} height={72} />
        {ready && streak && (
          streak.missed !== null ? (
            <div className="kiss-streak sad" role="img"
              aria-label={`${missedName(streak.missed, data.partnerName)} missed a day. Streak is back to zero. Longest ${streak.longest}.`}>
              <svg viewBox="0 0 74 68" aria-hidden="true">
                <path d="M37 64C12 46 3 33 3 21 3 11 11 4 21 4c7 0 12 4 16 10C41 8 46 4 53 4c10 0 18 7 18 17 0 12-9 25-34 43Z"
                  fill="#9a7ab5" stroke="#ffb703" strokeWidth="3" strokeLinejoin="round" />
                <circle cx="27" cy="26" r="3.2" fill="#2a0a4a" /><circle cx="47" cy="26" r="3.2" fill="#2a0a4a" />
                <path d="M26 44c4-6 18-6 22 0" fill="none" stroke="#2a0a4a" strokeWidth="3.5" strokeLinecap="round" />
                <path d="M52 31c2 3 2 6 0 8-2-2-2-5 0-8Z" fill="#8fd3ff" />
              </svg>
              <span aria-hidden="true" style={{ maxWidth: 110, lineHeight: 1.15 }}>{missedName(streak.missed, data.partnerName)} missed a day</span>
            </div>
          ) : (
            <div className={`kiss-streak${streak.current > 0 ? " live" : ""}`} role="img"
              aria-label={`Streak: ${streak.current} day${streak.current === 1 ? "" : "s"} in a row. Longest ${streak.longest}.`}>
              <svg viewBox="0 0 74 68" aria-hidden="true">
                <path d="M37 64C12 46 3 33 3 21 3 11 11 4 21 4c7 0 12 4 16 10C41 8 46 4 53 4c10 0 18 7 18 17 0 12-9 25-34 43Z"
                  fill="#ff4d6d" stroke="#ffb703" strokeWidth="3" strokeLinejoin="round" />
              </svg>
              <b aria-hidden="true">{streak.current}</b>
              <span aria-hidden="true">day streak</span>
            </div>
          )
        )}
        <div className="kiss-brand">
          <h1 className="kiss-title">K.I.S.S.</h1>
          <p className="kiss-sub">Keep Igniting Special Sparks</p>
        </div>
      </header>
      {locked ? <Lock onUnlock={() => setLocked(false)} /> : (
        <>
          {data.pending > 0 && <p className="kiss-meta" role="status">{props.context.online ? "Sending…" : "Saved on this device. It will send when you are online."}</p>}
          {data.error && <p className="kiss-err" role="alert">{data.error}</p>}
          {data.failures.map((f) => (
            <div key={f.clientMutationId} className="kiss-err" role="alert">
              <p>A change could not be saved ({f.status === "conflict" ? "it was changed elsewhere" : "it was refused"}).</p>
              <Button variant="secondary" onClick={() => void data.dismiss(f.clientMutationId)}>Dismiss</Button>
            </div>
          ))}
          {!data.loaded ? <p className="kiss-sub">Loading…</p> : (
            <>
              {ready && me && (
                <div className="kiss-today" aria-label="Today">
                  <button type="button" className={`kiss-chip${data.answers.some((a) => a.day === day && (a.authorPersonId === me.personId || a.authorPersonId === null)) ? " done" : ""}`}
                    onClick={() => setTab("today")}>
                    {data.answers.some((a) => a.day === day && (a.authorPersonId === me.personId || a.authorPersonId === null)) ? "✓" : "○"} Daily question
                  </button>
                  <button type="button" className={`kiss-chip${data.checkins.some((c) => c.day === day && (c.authorPersonId === me.personId || c.authorPersonId === null)) ? " done" : ""}`}
                    onClick={() => setTab("checkin")}>
                    {data.checkins.some((c) => c.day === day && (c.authorPersonId === me.personId || c.authorPersonId === null)) ? "✓" : "○"} Check-in
                  </button>
                  {streak && streak.todayDone && <span className="kiss-chip done" style={{ cursor: "default" }}>Both answered today</span>}
                  {streak && !streak.todayDone && streak.mineToday && <span className="kiss-meta" style={{ alignSelf: "center" }}>Waiting for {data.partnerName} to keep the streak</span>}
                </div>
              )}
              {tabs.length > 1 && <Tabs label="K.I.S.S. sections" items={tabs} activeId={active} onChange={setTab} />}
              {!me?.isPartner && !me?.administrator && (
                <div className="kiss-card"><p>K.I.S.S. has not been set up for you. Ask a household administrator to pair the two partners.</p></div>
              )}
              {me && active === "today" && ready && <Today data={data} props={props} day={day} />}
              {me && active === "checkin" && ready && <CheckIn data={data} day={day} />}
              {me && active === "notes" && ready && <Notes data={data} />}
              {me && ctx && active === "dates" && ready && <Dates ctx={ctx} dates={data.dates} />}
              {me && ctx && active === "quizzes" && ready && <Quizzes ctx={ctx} results={data.quizzes} day={day} />}
              {me && ctx && active === "intimacy" && ready && <Intimacy ctx={ctx} swipes={data.swipes} />}
              {me && active === "settings" && (
                <>
                  {me.administrator && <Setup data={data} props={props} />}
                  {ready && <Privacy onLockNow={() => setLocked(true)} />}
                </>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}

export function createHomiWebModule() {
  return defineHomiWebModule({
    moduleKey: KISS_MODULE_KEY,
    moduleApiVersion: HOMI_MODULE_API_VERSION,
    pages: { kiss: KissPage },
    sync: { mutationAdapters, changeHandlers },
  });
}
