"use client";

import { useEffect, useState } from "react";
import { formatContextBarDate, formatContextBarTime } from "@/lib/format/datetime";

/**
 * The context bar's clock, actually running.
 *
 * It used to be a Server Component value, and `format/datetime.ts` called that "the time the
 * screen was built rather than a ticking clock … the honest reading of it". The reasoning
 * was sound and the outcome was not: it is rendered as a clock — large time over small date,
 * top right — so a person reads it as one and a clock that only moves on reload reads as
 * broken. A thing that looks like a clock owes you the current minute.
 *
 * The server value still arrives as `initialTime` / `initialDate` and is what the first
 * paint shows, so the markup hydrates byte-identical and the bar is correct with JavaScript
 * disabled. Only the tick is client-side.
 *
 * Minutes, not seconds: the bar displays `오전 6:30`, so a second-by-second timer would
 * re-render the shell sixty times for every visible change. The first tick is aligned to the
 * next minute boundary rather than set to a flat 60s, because mounting at :59.7 would
 * otherwise leave the wrong minute on screen for the next 59 seconds.
 */
export interface LiveClockProps {
  readonly initialTime: string;
  /** Omitted when the bar shows a time with no date under it. Never invented. */
  readonly initialDate?: string;
  readonly timeClassName?: string;
  readonly dateClassName?: string;
}

export function LiveClock({
  initialTime,
  initialDate,
  timeClassName,
  dateClassName,
}: LiveClockProps) {
  const [now, setNow] = useState<{ time: string; date: string | undefined }>({
    time: initialTime,
    date: initialDate,
  });

  useEffect(() => {
    let timer: number | undefined;

    const tick = () => {
      const moment = new Date();
      setNow({
        time: formatContextBarTime(moment),
        // Only ever updates a date that was there to begin with. A bar asked for a time
        // alone stays a time alone.
        date: initialDate === undefined ? undefined : formatContextBarDate(moment),
      });
      // Land on the next minute, then keep landing on it. `+ 250ms` of slack so a timer
      // that fires a hair early does not read the minute that is about to end.
      const untilNextMinute = 60_000 - (moment.getSeconds() * 1000 + moment.getMilliseconds());
      timer = window.setTimeout(tick, untilNextMinute + 250);
    };

    tick();
    return () => {
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    };
  }, [initialDate]);

  return (
    <>
      {/* `aria-live` deliberately absent: a clock that announces itself every minute would
          interrupt a screen reader mid-sentence, forever, to say something nobody asked for. */}
      <strong className={timeClassName}>{now.time}</strong>
      {now.date === undefined ? null : <small className={dateClassName}>{now.date}</small>}
    </>
  );
}
