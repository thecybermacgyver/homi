import { useMemo, useRef, useState } from "react";
import { Button } from "@homi/ui";
import {
  DAILY_COUNT, QUIZZES, SCALE, axisScores, compare, dailyQuiz, pooled, quizById, statementById,
  type Item, type Quiz,
} from "./quizdata.js";
import type { KissContext, QuizResult } from "./types.js";

const MINE = "#ffb703";
const THEIRS = "#ff9db0";

function Radar({ quiz, mine, theirs, partnerName }: {
  quiz: Quiz; mine: Record<string, number>; theirs: Record<string, number>; partnerName: string;
}) {
  const size = 300, c = size / 2, r = 100;
  const n = quiz.axes.length;
  const point = (i: number, value: number): [number, number] => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    const rr = (value / 5) * r;
    return [c + Math.cos(angle) * rr, c + Math.sin(angle) * rr];
  };
  const poly = (scores: Record<string, number>) =>
    quiz.axes.map((x, i) => point(i, scores[x.id] ?? 0).join(",")).join(" ");
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${size} ${size}`} role="img" style={{ width: "100%", maxWidth: 340, display: "block", margin: "0 auto" }}
        aria-label={`Radar chart for ${quiz.title}. ${quiz.axes.map((x) => `${x.label}: you ${(mine[x.id] ?? 0).toFixed(1)}, ${partnerName} ${(theirs[x.id] ?? 0).toFixed(1)}`).join("; ")}.`}>
        {[1, 2, 3, 4, 5].map((ring) => (
          <polygon key={ring} points={quiz.axes.map((_, i) => point(i, ring).join(",")).join(" ")}
            fill="none" stroke="rgba(255,240,245,.35)" strokeWidth="1" />
        ))}
        {quiz.axes.map((x, i) => {
          const [ex, ey] = point(i, 5);
          const [lx, ly] = point(i, 6.3);
          return (
            <g key={x.id}>
              <line x1={c} y1={c} x2={ex} y2={ey} stroke="rgba(255,240,245,.35)" />
              <text x={lx} y={ly} fill="#fff0f5" fontSize="12" textAnchor="middle" dominantBaseline="middle">{x.label}</text>
            </g>
          );
        })}
        <polygon points={poly(theirs)} fill={THEIRS} fillOpacity=".3" stroke={THEIRS} strokeWidth="2.5" strokeDasharray="6 4" />
        <polygon points={poly(mine)} fill={MINE} fillOpacity=".3" stroke={MINE} strokeWidth="2.5" />
      </svg>
      <figcaption className="kiss-row" style={{ justifyContent: "center", fontSize: ".85rem" }}>
        <span><span style={{ color: MINE }}>■</span> You</span>
        <span><span style={{ color: THEIRS }}>▪▪</span> {partnerName}</span>
      </figcaption>
    </figure>
  );
}

function Take({ day, existing, ctx }: { day: string; existing: QuizResult | null; ctx: KissContext }) {
  const daily = useMemo(() => dailyQuiz(day), [day]);
  const [values, setValues] = useState<Record<string, number>>(() =>
    Object.fromEntries((existing?.items ?? []).map((i) => [i.id, i.v])));
  const id = useRef(crypto.randomUUID());
  const sending = useRef(false);
  const answered = daily.statements.filter((s) => (values[s.id] ?? 0) >= 1).length;
  const complete = answered === daily.statements.length;
  const items: Item[] = daily.statements.map((s) => ({ id: s.id, v: values[s.id] ?? 0 }));
  async function submit() {
    if (!complete || sending.current) return;
    sending.current = true;
    if (existing) {
      await ctx.mutate({ entityType: "quiz", entityId: existing.id, operation: "update", baseRevision: existing.revision, payload: { items } });
    } else {
      await ctx.mutate({
        entityType: "quiz", entityId: id.current, operation: "create", baseRevision: "0",
        payload: { quizId: daily.quiz.id, day, items },
      });
    }
    sending.current = false;
  }
  return (
    <section aria-label="Today's quiz">
      <div className="kiss-card">
        <span className="kiss-kind">Today's quiz</span>
        <h2 className="kiss-q">{daily.quiz.title}</h2>
        <p className="kiss-sub">{daily.quiz.intro} {DAILY_COUNT} statements a day. Your answers stay private until you have both finished.</p>
        <p className="kiss-meta">{answered} of {DAILY_COUNT} answered</p>
      </div>
      {daily.statements.map((s, i) => (
        <fieldset key={s.id} className="kiss-card">
          <legend style={{ fontWeight: 700 }}>{i + 1}. {s.text}</legend>
          <div className="kiss-row">
            {SCALE.map((label, v) => (
              <label key={label} style={{ display: "flex", gap: ".3rem", alignItems: "center", minHeight: 40 }}>
                <input type="radio" name={s.id} checked={values[s.id] === v + 1}
                  onChange={() => setValues((cur) => ({ ...cur, [s.id]: v + 1 }))} />
                <span style={{ fontSize: ".85rem" }}>{label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <Button onClick={() => void submit()} disabled={!complete || ctx.busy}>
        {existing ? "Save my answers" : "Lock in today's quiz"}
      </Button>
    </section>
  );
}

function DayResults({ quiz, mine, theirs, ctx }: { quiz: Quiz; mine: QuizResult; theirs: QuizResult; ctx: KissContext }) {
  const cmp = useMemo(() => compare(quiz, mine.items, theirs.items), [quiz, mine, theirs]);
  const a = axisScores(quiz, mine.items);
  const b = axisScores(quiz, theirs.items);
  return (
    <div>
      <div className="kiss-card">
        <h3>{quiz.title}, {mine.day}</h3>
        <p className="kiss-score" aria-label={`Closeness ${cmp.closeness} percent`}>{cmp.closeness}%</p>
        <p className="kiss-meta">How close you were on today's statements</p>
        <Radar quiz={quiz} mine={a} theirs={b} partnerName={ctx.partnerName} />
      </div>
      <div className="kiss-card">
        <h3>Shared strengths</h3>
        {cmp.strengths.length === 0 ? <p>No big overlap today. That is a place to explore, not a problem.</p> :
          <ul>{cmp.strengths.map((x) => <li key={x.id}>{x.label}: you both rate this high.</li>)}</ul>}
      </div>
      <div className="kiss-card">
        <h3>Where to grow, gently</h3>
        {cmp.growth.length === 0 ? <p>You were well matched on everything asked today.</p> :
          <ul>{cmp.growth.map((x) => <li key={x.id}><strong>{x.label}.</strong> {x.talk}</li>)}</ul>}
        <p className="kiss-meta">Use these as conversation starters. Neither of you is wrong.</p>
      </div>
      <div className="kiss-card">
        <h3>Your answers</h3>
        <ul style={{ paddingLeft: "1.1rem" }}>
          {mine.items.map((it) => {
            const st = statementById(quiz, it.id);
            const other = theirs.items.find((x) => x.id === it.id);
            return st ? (
              <li key={it.id} style={{ margin: ".4rem 0" }}>
                {st.text}
                <div className="kiss-meta">You: {SCALE[it.v - 1]} · {ctx.partnerName}: {other ? SCALE[other.v - 1] : "not asked"}</div>
              </li>
            ) : null;
          })}
        </ul>
      </div>
    </div>
  );
}

function RunningPicture({ ctx, pairs }: {
  ctx: KissContext; pairs: readonly { quiz: Quiz; day: string; mine: QuizResult; theirs: QuizResult }[];
}) {
  const byTopic = QUIZZES.map((quiz) => {
    const mine = pairs.filter((p) => p.quiz.id === quiz.id);
    return { quiz, days: mine };
  }).filter((t) => t.days.length > 0);
  if (byTopic.length === 0) return null;
  return (
    <div>
      <h2 className="kiss-q" style={{ margin: "1rem 0 .2rem" }}>Your picture over time</h2>
      <p className="kiss-sub">Every day you both finish adds to it, so it gets truer the longer you keep going.</p>
      {byTopic.map(({ quiz, days }) => {
        const a = pooled(quiz, days.map((d) => d.mine.items));
        const b = pooled(quiz, days.map((d) => d.theirs.items));
        const trend = days.slice().sort((x, y) => y.day.localeCompare(x.day)).slice(0, 7).map((d) => ({
          day: d.day, closeness: compare(quiz, d.mine.items, d.theirs.items).closeness,
        }));
        return (
          <div key={quiz.id} className="kiss-card">
            <h3>{quiz.title}</h3>
            <p className="kiss-meta">{days.length} day{days.length === 1 ? "" : "s"} together</p>
            <Radar quiz={quiz} mine={a} theirs={b} partnerName={ctx.partnerName} />
            <p className="kiss-meta" style={{ marginTop: ".6rem" }}>Closeness, most recent first</p>
            <p>{trend.map((t) => `${t.closeness}%`).join("  ·  ")}</p>
          </div>
        );
      })}
    </div>
  );
}

export function Quizzes({ ctx, results, day }: { ctx: KissContext; results: readonly QuizResult[]; day: string }) {
  const [viewing, setViewing] = useState<string | null>(null);
  const isMine = (r: QuizResult) => r.authorPersonId === ctx.me.personId || r.authorPersonId === null;
  const daily = results.filter((r) => r.day !== null);
  const mineByDay = new Map(daily.filter(isMine).map((r) => [r.day as string, r]));
  const theirsByDay = new Map(daily.filter((r) => r.authorPersonId === ctx.me.partnerPersonId).map((r) => [r.day as string, r]));

  const pairs = [...mineByDay.entries()].flatMap(([d, mine]) => {
    const theirs = theirsByDay.get(d);
    const quiz = quizById(mine.quizId);
    return theirs && quiz ? [{ quiz, day: d, mine, theirs }] : [];
  }).sort((x, y) => y.day.localeCompare(x.day));

  const todayMine = mineByDay.get(day) ?? null;
  const todayTheirs = theirsByDay.get(day) ?? null;
  const viewed = pairs.find((p) => p.day === (viewing ?? "")) ?? null;
  const daily8 = dailyQuiz(day);

  return (
    <section aria-label="Couples quizzes">
      {viewed ? (
        <div>
          <Button variant="secondary" onClick={() => setViewing(null)}>Back</Button>
          <DayResults quiz={viewed.quiz} mine={viewed.mine} theirs={viewed.theirs} ctx={ctx} />
        </div>
      ) : (
        <>
          {!todayMine ? (
            <Take day={day} existing={null} ctx={ctx} />
          ) : !todayTheirs ? (
            <div className="kiss-card">
              <h3>{daily8.quiz.title}</h3>
              <p role="status">You finished today's quiz. Waiting for {ctx.partnerName}. Results open when they finish.</p>
              <div className="kiss-row">
                <Button variant="secondary" onClick={() => void ctx.pull()}>Check now</Button>
              </div>
            </div>
          ) : (
            <>
              <p className="kiss-sub">Today's quiz is done. A new one of {DAILY_COUNT} statements arrives tomorrow.</p>
              <DayResults quiz={daily8.quiz} mine={todayMine} theirs={todayTheirs} ctx={ctx} />
            </>
          )}
          <RunningPicture ctx={ctx} pairs={pairs} />
          {pairs.length > 0 && (
            <div>
              <h2 className="kiss-q" style={{ margin: "1rem 0 .2rem" }}>Past days</h2>
              {pairs.filter((p) => p.day !== day).map((p) => (
                <div key={p.day} className="kiss-card">
                  <div className="kiss-row" style={{ justifyContent: "space-between" }}>
                    <span><strong>{p.quiz.title}</strong> · {p.day}</span>
                    <Button variant="secondary" onClick={() => setViewing(p.day)}>View</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
