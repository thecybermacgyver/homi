import assert from "node:assert/strict";
import test from "node:test";
import { boardClock } from "./clock.js";

const at = (iso: string) => new Date(iso);

test("English shows an ordinal day, the month and a padded 12-hour time with dots", () => {
  const clock = boardClock(at("2026-10-05T19:15:00Z"), "en-CA", "America/Toronto");
  assert.equal(clock.date, "5th October 2026");
  assert.equal(clock.time, "03:15 P.M.");
  assert.equal(clock.dateTime, "2026-10-05T15:15");
});

test("ordinals handle 1st, 2nd, 3rd, the teens and 21st to 23rd", () => {
  const day = (n: number) => boardClock(at(`2026-10-${String(n).padStart(2, "0")}T12:00:00Z`), "en", "UTC").date.split(" ")[0];
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31].map(day), ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "31st"]);
});

test("midnight is 12:00 A.M. and noon is 12:00 P.M.", () => {
  assert.equal(boardClock(at("2026-03-01T00:05:00Z"), "en", "UTC").time, "12:05 A.M.");
  assert.equal(boardClock(at("2026-03-01T12:30:00Z"), "en", "UTC").time, "12:30 P.M.");
});

test("the household time zone decides the date and the hour", () => {
  const instant = at("2026-10-06T02:30:00Z");
  assert.equal(boardClock(instant, "en", "America/Toronto").date, "5th October 2026");
  assert.equal(boardClock(instant, "en", "Pacific/Auckland").date, "6th October 2026");
  assert.equal(boardClock(instant, "en", "Pacific/Auckland").time, "03:30 P.M.");
});

test("other locales use the browser's own long date and short time", () => {
  const clock = boardClock(at("2026-10-05T19:15:00Z"), "fr-CA", "America/Toronto");
  assert.match(clock.date, /5 octobre 2026/);
  assert.match(clock.time, /15\s?[:h]\s?15/);
});
