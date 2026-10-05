import { useEffect, useState } from "react";
import { boardClock, type BoardClock } from "./clock.js";

// Ticks every second but only re-renders when the shown minute or day changes.
export function FamilyBoardClock({ locale, timeZone }: { locale: string; timeZone: string }) {
  const [clock, setClock] = useState<BoardClock>(() => boardClock(new Date(), locale, timeZone));
  useEffect(() => {
    const tick = () => setClock((previous) => {
      const next = boardClock(new Date(), locale, timeZone);
      return next.dateTime === previous.dateTime && next.date === previous.date && next.time === previous.time ? previous : next;
    });
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [locale, timeZone]);
  return (
    <div className="homi-family-board__clock">
      <time className="homi-family-board__clock-date" dateTime={clock.dateTime.slice(0, 10)}>{clock.date}</time>
      <time className="homi-family-board__clock-time" dateTime={clock.dateTime}>{clock.time}</time>
    </div>
  );
}
