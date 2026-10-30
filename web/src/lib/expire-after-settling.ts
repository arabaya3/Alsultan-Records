import "server-only";
import { revalidateTag } from "next/cache";
import { after } from "next/server";
import type { CacheTag } from "./cache-tags";

const SETTLE_MS = 5000;

/**
 * Expire tags once more after renders already in flight have finished. updateTag expires what is cached now, but a
 * route render that read the old data before the save and writes its cache entry after it looks newer than the expiry,
 * so it is served as a valid hit until its normal revalidation (minutes). Call this next to updateTag, never instead.
 * If the race did not happen, this only costs one extra regeneration of the tagged data.
 */
export function expireAgainAfterSettling(...tags: CacheTag[]) {
  after(async () => {
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    for (const t of new Set(tags)) revalidateTag(t, { expire: 0 });
  });
}
