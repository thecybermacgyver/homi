import { dayNumber } from "./engine.js";

export interface Axis { readonly id: string; readonly label: string; readonly talk: string }
export interface QuizStatement { readonly id: string; readonly axis: string; readonly text: string }
export interface Quiz {
  readonly id: string;
  readonly title: string;
  readonly intro: string;
  readonly axes: readonly Axis[];
  readonly statements: readonly QuizStatement[];
}
export interface Item { readonly id: string; readonly v: number }

// Every day brings DAILY_COUNT statements from one topic, rotating through
// the topics. Statements are re-asked as the bank cycles, which is what lets
// the running picture show how the two of you change over time.
export const DAILY_COUNT = 8;
export const SCALE = ["Not at all", "A little", "Somewhat", "Mostly", "Very much"] as const;

// Statement ids are "<axis>-<n>" and never change once shipped, so history
// stays meaningful when the bank grows: new statements are only appended.
function quiz(id: string, title: string, intro: string, axes: Axis[], texts: string[][]): Quiz {
  const statements: QuizStatement[] = [];
  const longest = Math.max(...texts.map((t) => t.length));
  for (let n = 0; n < longest; n++) {
    axes.forEach((axis, i) => {
      const text = (texts[i] as string[])[n];
      if (text !== undefined) statements.push({ id: `${axis.id}-${n + 1}`, axis: axis.id, text });
    });
  }
  return { id, title, intro, axes, statements };
}

export const QUIZZES: readonly Quiz[] = [
  quiz("love-languages", "Love languages", "How you most feel loved. Rate how true each is for you.", [
    { id: "words", label: "Words", talk: "One of you hears love in words more than the other. Try saying one specific appreciation a day." },
    { id: "time", label: "Quality time", talk: "You differ on how much undivided time matters. Agree on a protected, phone-free half hour." },
    { id: "gifts", label: "Gifts", talk: "Thoughtful tokens mean different things to each of you. Share what a meaningful gift looks like." },
    { id: "acts", label: "Acts of service", talk: "Helping out lands differently for each of you. Name one task that would feel like care." },
    { id: "touch", label: "Touch", talk: "Your comfort with affection differs. Ask which kind of touch feels best, and when." },
  ], [
    ["Hearing \"I love you\" and compliments makes my day.", "A kind message from my partner stays with me for hours.",
      "I love being told what I did well.", "Words of encouragement help me get through hard days.",
      "I keep notes or messages that were kind to me.", "An unexpected \"I am proud of you\" means a lot.",
      "I want my partner to say out loud what they appreciate in me.", "Harsh words stay with me longer than a gesture ever would."],
    ["Time together with no distractions fills me up.", "I feel closest when we do something side by side.",
      "I would rather spend an hour together than receive a present.", "I notice when my partner puts their phone away for me.",
      "A regular date or ritual matters a lot to me.", "Being listened to, fully, is how I feel loved.",
      "A quiet evening at home together is a great evening.", "I feel distant when we go days without real time together."],
    ["A thoughtful little gift tells me I was on their mind.", "I treasure small keepsakes from my partner.",
      "I enjoy choosing a gift that fits the person.", "A surprise token on an ordinary day makes my week.",
      "I remember the gifts that mattered to me for years.", "It is the thought, not the price, that counts most to me.",
      "I like to bring something home when I know my partner would love it.", "A forgotten occasion would sting more than I would say."],
    ["When my partner takes a task off my plate, I feel loved.", "Help with chores is a real way of saying I care.",
      "I notice when something I dislike gets done without being asked.", "I show love by fixing, tidying or preparing things.",
      "A shared load at home makes me feel like a team.", "I feel unloved when I carry everything alone.",
      "Doing something I have been dreading means a great deal.", "Reliable follow-through tells me I can count on my partner."],
    ["A hug or hand-hold can change my whole mood.", "Physical closeness is how I feel most connected.",
      "I like to sit close, or lean on my partner, when we are together.", "A hand on my back says more than words sometimes.",
      "I feel calmer after a long hug.", "I reach for my partner's hand without thinking.",
      "A goodbye or hello kiss matters to me.", "I miss touch when we have been apart for long."],
  ]),
  quiz("desires", "Desires and boundaries", "What closeness means for you, and where your edges are. Keep it honest and kind.", [
    { id: "affection", label: "Affection", talk: "Your appetite for everyday affection differs. Ask what small gestures you each want more of." },
    { id: "adventure", label: "Adventure", talk: "One of you wants more novelty. Try one small new thing each month and rate it together." },
    { id: "communication", label: "Talking about it", talk: "You differ on how openly to talk about intimacy. Agree on a calm time and a gentle opener." },
    { id: "pace", label: "Pace", talk: "Your preferred pace differs. Slowing down or speeding up by choice, not pressure, builds safety." },
    { id: "privacy", label: "Privacy", talk: "You hold different views on privacy and sharing. Name what is private to you and respect it." },
  ], [
    ["I want more everyday affection than I get.", "Cuddling on the sofa matters a lot to me.",
      "Small kisses through the day make me feel close.", "I like being greeted warmly when we meet at home.",
      "Holding hands in public makes me happy.", "I would like more spontaneous affection.",
      "Affection helps me feel secure in us.", "I light up when my partner says something sweet out of nowhere."],
    ["I like trying new things that bring us closer.", "Surprises and novelty keep our spark alive for me.",
      "I would enjoy planning something new for us this month.", "I like when we step out of our routine together.",
      "A spontaneous trip or evening out excites me.", "I enjoy learning new things as a couple.",
      "Variety keeps closeness interesting for me.", "I would try something new if we both felt safe doing it."],
    ["I am comfortable telling my partner what I like.", "I would rather talk openly than guess.",
      "I can say no to something without feeling guilty.", "I would like us to check in about closeness more often.",
      "I feel safe sharing a vulnerable wish.", "I appreciate it when my partner asks what I need.",
      "I can hear a difference in preference without feeling hurt.", "Talking about it makes us closer, not more awkward."],
    ["I prefer to take things slowly and build the mood.", "Being relaxed matters more to me than being spontaneous.",
      "I need time to switch from the day to being close.", "I enjoy a long, unhurried evening together.",
      "I like it when we agree on timing beforehand.", "Stress makes me need more lead-in time.",
      "I feel best when there is no pressure to hurry.", "A calm morning together beats a rushed night."],
    ["Some things I keep just for myself.", "I like to agree together what stays between us.",
      "I want clear understanding about what we share with others.", "I need personal space even in a close relationship.",
      "I would like my partner to ask before sharing something personal.", "I feel safest when we respect each other's boundaries.",
      "Privacy at home matters for me to relax.", "I like deciding for myself when to open up."],
  ]),
  quiz("triggers", "Emotional triggers", "What helps and what stings when things get tense.", [
    { id: "space", label: "Needing space", talk: "One of you needs space to settle, the other needs closeness. Agree a signal and a time to return." },
    { id: "reassure", label: "Needing reassurance", talk: "You differ on reassurance. Say what you need in one sentence: \"I need to hear that we are okay.\"" },
    { id: "voice", label: "Raised voices", talk: "Tone is a trigger for one of you. Agree to pause if either voice rises." },
    { id: "repair", label: "Repairing", talk: "You repair in different ways. Ask each other what a good apology looks like." },
    { id: "fairness", label: "Feeling heard", talk: "Feeling heard differs between you. Try reflecting back what you heard before you reply." },
  ], [
    ["When I am upset I need time alone before I can talk.", "I would rather pause a heated moment than push through.",
      "I think better after a walk or a quiet hour.", "I do not mean it as rejection when I need space.",
      "I would like my partner to trust that I will come back to the talk.", "Pressure to talk right now makes things worse for me.",
      "Naming how long I need helps me feel less guilty.", "I want to know my partner is okay while I take space."],
    ["When we disagree I need to hear we are okay.", "Warmth during a tense talk helps me settle.",
      "A touch or a kind word mid-argument helps me stay open.", "I worry when things go quiet after a disagreement.",
      "I feel better when my partner says what they still love about me.", "I want to know we are on the same side.",
      "Reassurance matters more to me than the solution.", "I can be patient if I know we will be okay."],
    ["Raised voices shut me down quickly.", "I find loud tones hard to think through.",
      "I would rather lower the volume than win the point.", "A sharp tone can hurt more than the words.",
      "I want us to agree to take a break when voices rise.", "I regret things I say when I am shouting.",
      "A calm voice helps me hear what is being said.", "I tense up quickly when a conversation gets heated."],
    ["A sincere apology helps me move on fast.", "I like to make up with a gesture, not just words.",
      "I want to hear what my partner understood about my side.", "I find it easy to say sorry first.",
      "A small act of kindness after a fight helps me reset.", "I need to know the same thing will not keep happening.",
      "Making up with humour works for me.", "I would like us to have our own way to reconnect."],
    ["I want to feel truly heard before we solve anything.", "Being interrupted is a big trigger for me.",
      "It helps when my partner repeats back what they heard.", "I feel respected when my view is taken seriously.",
      "I would like to finish my thought before the reply.", "I feel fine disagreeing when I know I am being heard.",
      "A quick fix feels dismissive when I want to be understood.", "I listen better when I know I will get my turn."],
  ]),
];

export function quizById(id: string): Quiz | null {
  return QUIZZES.find((q) => q.id === id) ?? null;
}

export function statementById(quiz: Quiz, id: string): QuizStatement | null {
  return quiz.statements.find((s) => s.id === id) ?? null;
}

// The first pass through a topic keeps the order the bank was written in,
// so nothing already shown changes. From the second pass on, each pass is
// reshuffled and regrouped. Both partners work out the same order because it
// is seeded from the topic and the pass number, never from chance.
const LAUNCH_DAY = dayNumber("2026-10-15");

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const orders = new Map<string, readonly QuizStatement[]>();

// The order the topic's statements are asked in on pass number `pass`.
function orderFor(topic: Quiz, pass: number): readonly QuizStatement[] {
  if (pass <= 0) return topic.statements;
  const key = `${topic.id}:${pass}`;
  const cached = orders.get(key);
  if (cached) return cached;
  const random = seeded(hash(key));
  // Shuffle inside each axis, then deal one from each axis in turn, so every
  // day still touches several axes but with different statements together.
  const lanes = topic.axes.map((axis) => {
    const lane = topic.statements.filter((st) => st.axis === axis.id);
    for (let i = lane.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [lane[i], lane[j]] = [lane[j] as QuizStatement, lane[i] as QuizStatement];
    }
    return lane;
  });
  const dealt: QuizStatement[] = [];
  const longest = Math.max(...lanes.map((l) => l.length));
  for (let n = 0; n < longest; n++) lanes.forEach((lane) => { if (lane[n]) dealt.push(lane[n] as QuizStatement); });
  // Start the deal at a different place each pass so the same axes do not
  // always sit together.
  const turn = (pass * 3) % dealt.length;
  const order = [...dealt.slice(turn), ...dealt.slice(0, turn)];
  orders.set(key, order);
  return order;
}

// Today's set: one topic per day, DAILY_COUNT statements, moving forward
// through that topic's current order, and starting a freshly reshuffled order
// once the whole topic has been asked.
export function dailyQuiz(day: string): { quiz: Quiz; statements: readonly QuizStatement[] } {
  const n = dayNumber(day);
  const topics = QUIZZES.length;
  const topic = QUIZZES[((n % topics) + topics) % topics] as Quiz;
  const size = topic.statements.length;
  const round = Math.floor(n / topics);
  const launchRound = Math.floor(LAUNCH_DAY / topics);
  const first = round * DAILY_COUNT;
  const launchPass = Math.floor((launchRound * DAILY_COUNT) / size);
  const statements: QuizStatement[] = [];
  const used = new Set<string>();
  for (let i = 0; i < DAILY_COUNT; i++) {
    const k = first + i;
    const pass = Math.floor(k / size) - launchPass;
    let st = orderFor(topic, pass)[k % size] as QuizStatement;
    // A day that straddles two passes never asks the same statement twice.
    for (let step = 1; used.has(st.id) && step < size; step++) {
      st = orderFor(topic, pass)[(k + step) % size] as QuizStatement;
    }
    used.add(st.id);
    statements.push(st);
  }
  return { quiz: topic, statements };
}

export function axisScores(quiz: Quiz, items: readonly Item[]): Record<string, number> {
  const sum: Record<string, number> = {};
  const n: Record<string, number> = {};
  for (const item of items) {
    const st = statementById(quiz, item.id);
    if (!st) continue;
    sum[st.axis] = (sum[st.axis] ?? 0) + item.v;
    n[st.axis] = (n[st.axis] ?? 0) + 1;
  }
  return Object.fromEntries(quiz.axes.filter((a) => (n[a.id] ?? 0) > 0).map((a) => [a.id, (sum[a.id] ?? 0) / (n[a.id] as number)]));
}

export interface Comparison {
  readonly strengths: readonly Axis[];
  readonly growth: readonly Axis[];
  readonly closeness: number;
}

// Only topics both of you were asked about are compared.
export function compare(quiz: Quiz, a: readonly Item[], b: readonly Item[]): Comparison {
  const sa = axisScores(quiz, a);
  const sb = axisScores(quiz, b);
  const shared = quiz.axes.filter((x) => sa[x.id] !== undefined && sb[x.id] !== undefined);
  const strengths = shared.filter((x) => (sa[x.id] as number) >= 3.5 && (sb[x.id] as number) >= 3.5);
  const growth = shared.filter((x) => Math.abs((sa[x.id] as number) - (sb[x.id] as number)) >= 1.5);
  const gaps = shared.map((x) => Math.abs((sa[x.id] as number) - (sb[x.id] as number)) / 4);
  const closeness = gaps.length === 0 ? 0 : Math.round((1 - gaps.reduce((p, c) => p + c, 0) / gaps.length) * 100);
  return { strengths, growth, closeness };
}

// Several days of answers folded into one score per topic.
export function pooled(quiz: Quiz, days: readonly (readonly Item[])[]): Record<string, number> {
  return axisScores(quiz, days.flat());
}
