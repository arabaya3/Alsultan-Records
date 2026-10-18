/**
 * Fast existence check for public slugs, meant for `proxy.ts` (lead-owned).
 *
 * Why: with Cache Components/PPR the static shell is flushed with HTTP 200 before the page
 * can call notFound(), so unknown /work/[slug] and /services/[slug] are soft 404s. Next 16 docs
 * (api-reference/file-conventions/loading.md "Status codes") prescribe checking the slug in Proxy
 * and returning a 404 there. See components/layout/security-headers.md for the proxy snippet.
 *
 * Edge-safe: plain fetch to PostgREST with the publishable key; selects only the id;
 * RLS limits rows to published+consented projects / published services.
 * Returns true on any infrastructure error (fail open → page renders its own states).
 */
export type PublicSlugKind = "work" | "services" | "video" | "album" | "offer";

export async function publicSlugExists(kind: PublicSlugKind, slug: string): Promise<boolean> {
  if (kind === "video") {
    if (!/^[A-Za-z0-9_-]{11}$/.test(slug)) return false;
  } else if (kind === "album") {
    if (!/^[a-z0-9][a-z0-9-]{1,79}$/.test(slug)) return false;
  } else if (kind === "offer") {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 120) return false;
  } else if (!/^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u.test(slug) || slug.length > 120) return false;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return true;
  // video / album / offer: anon RLS already limits rows to published (offers: active today, Asia/Hebron) ones.
  const s = encodeURIComponent(slug);
  const q =
    kind === "work"
      ? `events?select=id&public_slug=eq.${s}&is_published=eq.true&publication_consent=eq.granted&limit=1`
      : kind === "services"
        ? `services?select=id&slug=eq.${s}&is_published=eq.true&limit=1`
        : kind === "video"
          ? `showcase_videos?select=id&youtube_id=eq.${s}&limit=1`
          : kind === "offer"
            ? `offers?select=id&slug=eq.${s}&limit=1`
            : `photo_albums?select=id&slug=eq.${s}&limit=1`;
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/${q}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return true;
    const rows = (await res.json()) as unknown[];
    return rows.length > 0;
  } catch {
    return true;
  }
}

/** Same shape as the slug_redirects check constraint (docs/cms-contract.md). */
const REDIRECT_PATH = /^\/(services|offers|work\/albums)\/[a-z0-9-]+$/;

/**
 * Old URL → new URL after a slug rename (table slug_redirects, written by DB trigger; anon-readable paths).
 * Returns the validated target path or null (also on any error: the caller then serves its 404).
 */
export async function slugRedirectTarget(path: string): Promise<string | null> {
  const from = path.replace(/\/$/, "");
  if (!REDIRECT_PATH.test(from)) return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/slug_redirects?select=to_path&from_path=eq.${encodeURIComponent(from)}&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as { to_path?: unknown }[];
    const to = rows[0]?.to_path;
    return typeof to === "string" && REDIRECT_PATH.test(to) && to !== from ? to : null;
  } catch {
    return null;
  }
}
