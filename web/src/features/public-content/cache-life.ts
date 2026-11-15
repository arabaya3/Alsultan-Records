import { cacheLife } from "next/cache";

/** Seconds from `now` until the next midnight in Hebron (offers and announcements switch by Hebron date). */
export function secondsUntilHebronMidnight(now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Hebron",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const elapsed = get("hour") * 3600 + get("minute") * 60 + get("second");
  return Math.max(60, 86400 - elapsed);
}

/**
 * Lifetime for date-bound content (offers, announcements): refreshed at the next Hebron midnight (plus a minute),
 * so an offer appears on its start date and disappears after its end date without an hourly re-render.
 */
export function untilHebronMidnight(): void {
  const revalidate = secondsUntilHebronMidnight() + 60;
  cacheLife({ stale: 300, revalidate, expire: revalidate + 3600 });
}

/**
 * Lifetime of a cached public read, decided once its result is known (call it exactly once, inside "use cache").
 * Successful reads live for a day (Vercel Hobby CPU budget; admin changes expire them at once through cache tags),
 * or until the next Hebron midnight for date-bound content. A failed read is kept for minutes only, so a short
 * database outage never pins an error state on public pages.
 */
export function publicLife<T extends { status: string }>(result: T, dateBound = false): T {
  if (result.status !== "ok") cacheLife("minutes");
  else if (dateBound) untilHebronMidnight();
  else cacheLife("days");
  return result;
}
