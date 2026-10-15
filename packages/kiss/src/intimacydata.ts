export type IdeaGroup = "romantic" | "sensual" | "playful";
export interface IntimacyIdea { readonly id: string; readonly group: IdeaGroup; readonly text: string }

const R: string[] = [
  "Write a love letter and read it aloud", "Slow dance in the living room", "Share a candlelit bath", "Fall asleep talking about our favourite memories",
  "Go to bed early with no screens", "Trade foot rubs", "Leave a note on the pillow", "Take a long, slow morning together",
  "Kiss for a full minute, no rush", "Cook dinner together by candlelight", "Plan a surprise weekend away", "Watch the sunrise wrapped in a blanket",
  "Say three things we love about each other", "Hold hands the whole evening", "Make a playlist for us", "Recreate our first kiss",
  "Take turns choosing the evening, no vetoes", "Wear something the other loves", "Write down our favourite moments of the year", "Stay in bed with tea and talk",
];
const S: string[] = [
  "A slow shoulder and back massage", "Massage with warm oil and low light", "Kissing in the kitchen", "Cuddling skin to skin under a blanket",
  "Whisper something sweet at a party", "Eye contact for three minutes", "Share a long hug, then breathe together", "Try a new kind of kiss",
  "Take a shower together", "Trade stories of our favourite kind of touch", "Slow dance with eyes closed", "Brush or braid each other's hair",
  "Touch only hands and arms for ten minutes", "Wear matching comfy clothes and cuddle", "A massage with no talking", "Light touches on the back while we watch a movie",
  "Spend an evening just kissing", "Lie close and match our breathing", "A foot and hand spa night", "Wake each other with a kiss",
];
const P: string[] = [
  "Truth or dare, kind edition", "A tickle fight", "A blindfolded taste test", "Play a card or board game with silly stakes",
  "Build a pillow fort and hide in it", "Compose a love song for each other", "Dress up for no reason", "Hide little notes for each other to find",
  "A scavenger hunt ending in a kiss", "Compliment battle", "Dance badly on purpose", "Play twenty questions about each other",
  "Make a coupon book of favours", "Pick a secret word that means come closer", "Swap clothes for an evening", "Write a story starring the two of us",
  "A water-fight or snowball fight", "A staring contest that ends in a kiss", "Plan a mini surprise for tomorrow", "Karaoke duet in the living room",
];

export const INTIMACY_IDEAS: readonly IntimacyIdea[] = [
  ...R.map((text, i) => ({ id: `r${i + 1}`, group: "romantic" as const, text })),
  ...S.map((text, i) => ({ id: `s${i + 1}`, group: "sensual" as const, text })),
  ...P.map((text, i) => ({ id: `p${i + 1}`, group: "playful" as const, text })),
];

export const GROUP_LABEL: Record<IdeaGroup, string> = { romantic: "Romantic", sensual: "Sensual", playful: "Playful" };

export interface Challenge {
  readonly id: string;
  readonly title: string;
  readonly intro: string;
  readonly steps: readonly { readonly text: string; readonly seconds: number }[];
}

export const CHALLENGES: readonly Challenge[] = [
  { id: "gaze", title: "Three minutes of eye contact", intro: "No talking. Breathe slowly and let it feel a little silly, then a little sweet.", steps: [
    { text: "Sit facing each other, knees almost touching. Take three slow breaths.", seconds: 30 },
    { text: "Look into each other's eyes. It is fine to smile or laugh.", seconds: 180 },
    { text: "Tell each other one thing you noticed.", seconds: 60 },
  ] },
  { id: "massage", title: "Massage swap", intro: "Ten minutes each, no goal except feeling good.", steps: [
    { text: "Decide who goes first. The receiver says where and how firmly.", seconds: 60 },
    { text: "First partner receives. The giver asks: lighter, firmer, or fine?", seconds: 600 },
    { text: "Swap places. Take a quiet moment to say thank you.", seconds: 600 },
  ] },
  { id: "appreciate", title: "Appreciation round", intro: "A warm-up that works any time.", steps: [
    { text: "Take turns: say one thing you appreciated about each other this week.", seconds: 120 },
    { text: "Say one thing you admire that you rarely say out loud.", seconds: 120 },
    { text: "Finish with a long hug.", seconds: 60 },
  ] },
  { id: "slowdance", title: "One song, slow", intro: "Pick a song that feels like both of you.", steps: [
    { text: "Choose a song together and dim the lights.", seconds: 60 },
    { text: "Dance close. Let the song set the pace.", seconds: 240 },
    { text: "Stay still for a moment when it ends.", seconds: 30 },
  ] },
  { id: "kissing", title: "Kiss like you mean it", intro: "Slow down and take your time.", steps: [
    { text: "Start with soft kisses on the hands, wrists and forehead.", seconds: 120 },
    { text: "Kiss slowly. Pay attention to each other.", seconds: 300 },
    { text: "Say what you enjoyed.", seconds: 60 },
  ] },
  { id: "wishes", title: "Three wishes", intro: "Share what you want more of, safely.", steps: [
    { text: "Each write down three small wishes for closeness this month.", seconds: 180 },
    { text: "Trade lists. Circle one from the other's list you can do this week.", seconds: 120 },
    { text: "Agree when you will do it.", seconds: 60 },
  ] },
  { id: "breathe", title: "Breathe together", intro: "A calm reset after a long day.", steps: [
    { text: "Sit back to back. Feel each other's breathing.", seconds: 120 },
    { text: "Match your breathing for a few minutes.", seconds: 180 },
    { text: "Turn around and share a hug.", seconds: 30 },
  ] },
  { id: "memory", title: "Memory lane", intro: "Rekindle the feelings of early days.", steps: [
    { text: "Each tell the story of the moment you first felt a spark.", seconds: 240 },
    { text: "Say what you felt then and what you feel now.", seconds: 180 },
    { text: "Plan one small thing that echoes that moment.", seconds: 60 },
  ] },
];
