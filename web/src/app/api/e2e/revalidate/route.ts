import "server-only";
import { timingSafeEqual } from "node:crypto";
import { revalidateTag } from "next/cache";
import { TAGS } from "@/lib/cache-tags";

/**
 * TEST-ONLY cache invalidation for the e2e suites, which seed and remove public rows directly in the LOCAL
 * database (bypassing the admin actions that normally call updateTag). Without this, a later page can still show
 * an album the previous suite deleted, until the cache window ends.
 *
 * Closed by default: unless the server runs with E2E_REVALIDATE_SECRET (≥ 32 chars) it answers 404 like any
 * unknown route — production never sets it. Only the public cache tags can be expired; nothing is read or written.
 */
const PUBLIC_TAGS = new Set<string>(Object.values(TAGS));
const ALBUM_TAG = /^photo-album:[a-z0-9][a-z0-9_-]{1,79}$/;

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.E2E_REVALIDATE_SECRET ?? "";
  if (secret.length < 32) return notFound();
  const given = Buffer.from(req.headers.get("x-e2e-secret") ?? "");
  const want = Buffer.from(secret);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return notFound();
  const body = (await req.json().catch(() => null)) as { tags?: unknown } | null;
  const tags = Array.isArray(body?.tags) ? body.tags.filter((t): t is string => typeof t === "string" && (PUBLIC_TAGS.has(t) || ALBUM_TAG.test(t))) : [];
  if (!tags.length) return new Response("No valid tags", { status: 400, headers: { "Cache-Control": "no-store" } });
  // expire immediately: the next request recomputes instead of serving the stale entry
  for (const t of tags) revalidateTag(t, { expire: 0 });
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
