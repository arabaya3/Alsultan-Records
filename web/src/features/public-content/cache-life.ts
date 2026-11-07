import { cacheLife } from "next/cache";

/**
 * Lifetime of a cached public read, decided once its result is known (call it exactly once, inside "use cache").
 * Successful reads live for hours (Vercel Hobby CPU budget; admin changes expire them through cache tags). A failed
 * read is kept for minutes only, so a short database outage never pins an error state on public pages for an hour.
 */
export function publicLife<T extends { status: string }>(result: T): T {
  if (result.status === "ok") cacheLife("hours");
  else cacheLife("minutes");
  return result;
}
