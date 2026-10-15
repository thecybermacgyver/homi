import type { Notice, NoticePlacement } from "./types.js";

function channel(value: number): number {
  const v = value / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

function contrast(a: number, b: number): number {
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

const DARK = "#2b211c";
const LIGHT = "#fffdf7";

// Text colour with the best contrast on whatever paper colour was chosen, so
// any colour stays readable.
export function inkFor(paper: string): string {
  const l = luminance(paper);
  return contrast(l, luminance(DARK)) >= contrast(l, luminance(LIGHT)) ? DARK : LIGHT;
}

const PINS = ["#c2634b", "#3f7a58", "#3f6fa3", "#b86e36", "#7a4f9a"] as const;

export function pinColor(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return PINS[hash % PINS.length] as string;
}

export function excerpt(notice: Notice, length = 110): string {
  // Line breaks the writer typed are kept (a run of blank lines becomes one);
  // only runs of spaces and tabs are tidied.
  const text = notice.body
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text) return text.length > length ? text.slice(0, length - 1).trimEnd() + "…" : text;
  if (notice.checklist.length > 0) {
    const done = notice.checklist.filter((item) => item.done).length;
    return `List: ${done} of ${notice.checklist.length} done`;
  }
  return notice.image ? "Photo" : "";
}

export function nextZ(notices: readonly Notice[]): number {
  return notices.reduce((highest, notice) => Math.max(highest, notice.z), 0) + 1;
}

// The size a notice may be given, as a fraction of the board. The stored
// columns carry the same limits, so clamping here keeps a drag or a key press
// from reaching the server as a rejected placement.
export const MIN_WIDTH = 0.15;
export const MAX_WIDTH = 0.9;
export const MIN_HEIGHT = 0.12;
export const MAX_HEIGHT = 0.9;

// How tall a new notice starts. A notice with a photo starts taller so the
// picture has room; either way the owner can resize it to anything.
export const DEFAULT_HEIGHT = 0.36;
export const DEFAULT_PHOTO_HEIGHT = 0.5;

// A free-looking spot for a new note: staggered from the pinned ones, with a
// slight random tilt like a real note.
export function newPlacement(notices: readonly Notice[], hasPhoto = false): NoticePlacement {
  const pinned = notices.filter((notice) => notice.pinned).length;
  const step = pinned % 5;
  const w = 0.46;
  const h = hasPhoto ? DEFAULT_PHOTO_HEIGHT : DEFAULT_HEIGHT;
  return clampPlacement({
    pinned: true,
    x: Math.min(1 - w, 0.06 + step * 0.1 + Math.random() * 0.06),
    y: 0.08 + step * 0.13 + Math.random() * 0.05,
    w,
    h,
    rotation: Math.round((Math.random() * 8 - 4) * 10) / 10,
    z: nextZ(notices),
  });
}

// A notice is kept whole on the cork: it is sized within the limits first, and
// then its corner is pulled back so that neither its right nor its bottom edge
// runs off the board and takes the resize handle with it.
export function clampPlacement(placement: NoticePlacement): NoticePlacement {
  const w = Math.min(Math.max(placement.w, MIN_WIDTH), MAX_WIDTH);
  const h = Math.min(Math.max(placement.h, MIN_HEIGHT), MAX_HEIGHT);
  return {
    ...placement,
    w,
    h,
    x: Math.min(Math.max(placement.x, 0), Math.max(0, 1 - w)),
    y: Math.min(Math.max(placement.y, 0), Math.max(0, 1 - h)),
  };
}

export function searchText(notice: Notice): string {
  return [notice.title, notice.body, ...notice.checklist.map((item) => item.text)].join(" ").toLocaleLowerCase();
}
