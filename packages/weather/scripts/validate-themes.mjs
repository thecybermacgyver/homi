// Every weather look must keep its text at 4.5:1 or better (WCAG AA) against
// every colour that can sit behind it. Run after `pnpm build`.
import assert from "node:assert/strict";
import { THEMES, themeFor } from "../dist/themes.js";

const channel = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const luminance = (hex) => {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};
const ratio = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

const mix = (a, b, t) => { const p = (h) => [0, 2, 4].map((i) => parseInt(h.replace('#', '').slice(i, i + 2), 16)); const [x, y] = [p(a), p(b)]; return '#' + x.map((v, i) => Math.round(v * (1 - t) + y[i] * t).toString(16).padStart(2, '0')).join(''); };

for (const theme of Object.values(THEMES)) {
  for (const colour of theme.zone) {
    const value = ratio(theme.ink, colour);
    assert.ok(value >= 4.5, `${theme.id}: text ${theme.ink} on ${colour} is ${value.toFixed(2)}:1, below 4.5:1`);
    // the pill is the text colour at 14% over the card
    const pill = ratio(theme.ink, mix(colour, theme.ink, 0.14));
    assert.ok(pill >= 4.5, `${theme.id}: pill text on ${colour} is ${pill.toFixed(2)}:1, below 4.5:1`);
  }
}
// Every WMO code Open-Meteo can send maps to a known look.
for (const code of [0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99, 123]) {
  for (const day of [true, false]) assert.ok(THEMES[themeFor(code, day)], `code ${code} has no look`);
}
console.log(`PASS_HOMI_WEATHER_THEME_CONTRAST (${Object.keys(THEMES).length} looks)`);
