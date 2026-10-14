// Regression: a moved occurrence of a recurring event must be placed on the
// date it was moved to (displayDate), not on its original rule date.
import assert from "node:assert/strict";
import {
  expandCalendarEvent,
  findCalendarOccurrence,
} from "../dist/recurrence.js";

const transport = { mode: "none", pickupPersonId: null, dropoffPersonId: null, notes: null };
const timed = (startsAt, endsAt) => ({
  calendarId: "c", color: "blue", title: "Gym", description: null, allDay: false,
  timeZone: "UTC", startsAt, endsAt, startDate: null, endDateExclusive: null,
  location: null, notes: null, personIds: [], reminderMinutes: [], transport,
});
const event = {
  ...timed("2026-10-05T09:00:00.000Z", "2026-10-05T10:00:00.000Z"),
  id: "e1",
  recurrence: { frequency: "weekly", interval: 1, weekdays: [1], endDate: null },
  recurrenceOverrides: [
    { occurrenceDate: "2026-10-12", action: "replace",
      replacement: timed("2026-10-14T09:00:00.000Z", "2026-10-14T10:00:00.000Z") },
    { occurrenceDate: "2026-10-19", action: "replace",
      replacement: timed("2026-11-03T09:00:00.000Z", "2026-11-03T10:00:00.000Z") },
  ],
};
const show = (from, to) =>
  expandCalendarEvent(event, from, to).map((o) => `${o.occurrenceDate}>${o.displayDate}`);

assert.deepEqual(show("2026-10-05", "2026-10-26"), ["2026-10-05>2026-10-05", "2026-10-12>2026-10-14"]);
assert.deepEqual(show("2026-10-12", "2026-10-13"), [], "original day must be empty");
assert.deepEqual(show("2026-10-14", "2026-10-15"), ["2026-10-12>2026-10-14"]);
assert.deepEqual(show("2026-11-02", "2026-11-05"), ["2026-10-19>2026-11-03", "2026-11-02>2026-11-02"]);
assert.equal(findCalendarOccurrence(event, "2026-10-12")?.displayDate, "2026-10-14");
assert.equal(findCalendarOccurrence(event, "2026-10-13"), null);
console.log("Calendar recurrence move validation passed.");
