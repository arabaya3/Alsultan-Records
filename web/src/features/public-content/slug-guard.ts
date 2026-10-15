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
export async function publicSlugExists(kind: "work" | "services", slug: string): Promise<boolean> {
  if (!/^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u.test(slug) || slug.length > 120) return false;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return true;
  const q =
    kind === "work"
      ? `events?select=id&public_slug=eq.${encodeURIComponent(slug)}&is_published=eq.true&publication_consent=eq.granted&limit=1`
      : `services?select=id&slug=eq.${encodeURIComponent(slug)}&is_published=eq.true&limit=1`;
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
