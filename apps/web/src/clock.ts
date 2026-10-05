// Date and time shown in the Family Board header, in the household's locale and
// time zone. English follows the board's own style ("5th October 2026" and
// "03:15 P.M."); other locales use the browser's own long date and short time.

function ordinal(day: number): string {
  const teen = day % 100;
  if (teen >= 11 && teen <= 13) return `${day}th`;
  switch (day % 10) {
    case 1: return `${day}st`;
    case 2: return `${day}nd`;
    case 3: return `${day}rd`;
    default: return `${day}th`;
  }
}

function isEnglish(locale: string): boolean {
  return locale === "" || /^en(?:[-_]|$)/i.test(locale);
}

function parts(date: Date, locale: string, timeZone: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(locale || "en", { timeZone, ...options }).formatToParts(date);
}

export interface BoardClock {
  readonly date: string;
  readonly time: string;
  // YYYY-MM-DDTHH:mm in the household time zone, for the <time> elements.
  readonly dateTime: string;
}

export function boardClock(now: Date, locale: string, timeZone: string): BoardClock {
  const numeric = parts(now, "en-CA", timeZone, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const get = (type: string) => numeric.find((p) => p.type === type)?.value ?? "00";
  const hour24 = Number(get("hour")) % 24;
  const dateTime = `${get("year")}-${get("month")}-${get("day")}T${String(hour24).padStart(2, "0")}:${get("minute")}`;
  if (isEnglish(locale)) {
    const month = parts(now, "en", timeZone, { month: "long" }).find((p) => p.type === "month")?.value ?? "";
    const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
    return {
      date: `${ordinal(Number(get("day")))} ${month} ${get("year")}`,
      time: `${String(hour12).padStart(2, "0")}:${get("minute")} ${hour24 < 12 ? "A.M." : "P.M."}`,
      dateTime,
    };
  }
  return {
    date: new Intl.DateTimeFormat(locale, { timeZone, dateStyle: "long" }).format(now),
    time: new Intl.DateTimeFormat(locale, { timeZone, timeStyle: "short" }).format(now),
    dateTime,
  };
}
