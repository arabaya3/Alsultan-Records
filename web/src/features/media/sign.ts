/**
 * signMediaUrls — shared SERVER helper for short-lived media URLs.
 *
 * STABLE API (imported by portal and admin code):
 *
 *   signMediaUrls(input: SignInput): Promise<SignedMedia[]>
 *     input = { assetIds: string[], variant?: "thumb" | "display" | "original", ttlSeconds?: number }
 *          | { paths: string[], ttlSeconds?: number }        // private-media object paths
 *
 *   Each result: { key, assetId, path, url, expiresAt }  (url = null when not authorized or
 *   the object does not exist; key = the asset id or the path you passed in).
 *
 * Authorization (two independent layers, no service-role key involved):
 *   1. Ownership is verified with the CALLER's RLS-scoped client: asset ids are resolved by
 *      selecting `media_assets` (rows the caller cannot see are simply absent); raw paths must
 *      match `events/{uuid}/...` and that event must be visible to the caller via `events`.
 *   2. URLs are minted with the same user client (`storage.createSignedUrls`), so the
 *      `private-media read` storage policy (admin / assigned staff / owning customer) applies
 *      again. The admin client is deliberately NOT used.
 *
 * Variants: "thumb" falls back to "display" (never the original); "display" falls back to the
 * original path only for non-image media (videos/documents have no variants). ttlSeconds is
 * clamped to [30, 600]. public-media assets get their permanent public URL.
 */
import "server-only";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";

export type MediaVariant = "thumb" | "display" | "original";

export type SignInput =
  | { assetIds: string[]; variant?: MediaVariant; ttlSeconds?: number; download?: boolean }
  | { paths: string[]; ttlSeconds?: number; download?: boolean };

export type SignedMedia = {
  key: string;
  assetId: string | null;
  path: string | null;
  url: string | null;
  /** epoch ms; null when url is null or permanent (public bucket). */
  expiresAt: number | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PATH_RE = /^events\/([0-9a-f-]{36})\/[A-Za-z0-9._/-]+$/i;
const MAX_ITEMS = 200;

export const clampTtl = (t?: number) => Math.min(600, Math.max(30, Math.floor(t ?? 600)));

type Variants = { thumb?: unknown; display?: unknown };

export function pickVariantPath(
  row: { path: string; kind: string; variants: unknown },
  variant: MediaVariant,
): string | null {
  const v = (row.variants ?? {}) as Variants;
  const thumb = typeof v.thumb === "string" ? v.thumb : null;
  const display = typeof v.display === "string" ? v.display : null;
  if (variant === "original") return row.path;
  if (variant === "thumb") return thumb ?? display;
  return display ?? (row.kind === "image" ? null : row.path);
}

export async function signMediaUrls(input: SignInput): Promise<SignedMedia[]> {
  // Signed URLs are per-request and time-dependent: never prerender/cache them.
  await connection();
  const ttl = clampTtl(input.ttlSeconds);
  const supabase = await createClient();
  const wanted: { key: string; assetId: string | null; path: string | null; bucket: string }[] = [];

  if ("assetIds" in input) {
    const ids = [...new Set(input.assetIds)].filter((id) => UUID.test(id)).slice(0, MAX_ITEMS);
    const variant = input.variant ?? "display";
    const found = new Map<string, { path: string; bucket: string; kind: string; variants: unknown }>();
    if (ids.length) {
      const { data } = await supabase
        .from("media_assets")
        .select("id, bucket, path, kind, variants")
        .in("id", ids);
      for (const r of data ?? []) found.set(r.id, r);
    }
    for (const id of input.assetIds) {
      const row = found.get(id);
      wanted.push({
        key: id,
        assetId: id,
        path: row ? pickVariantPath(row, variant) : null,
        bucket: row?.bucket ?? "private-media",
      });
    }
  } else {
    const paths = input.paths.slice(0, MAX_ITEMS);
    const eventIds = [...new Set(paths.map((p) => PATH_RE.exec(p)?.[1]).filter((x): x is string => !!x && UUID.test(x)))];
    const visible = new Set<string>();
    if (eventIds.length) {
      const { data } = await supabase.from("events").select("id").in("id", eventIds);
      for (const e of data ?? []) visible.add(e.id);
    }
    for (const p of input.paths) {
      const m = PATH_RE.exec(p);
      const ok = m && !p.includes("..") && visible.has(m[1]);
      wanted.push({ key: p, assetId: null, path: ok ? p : null, bucket: "private-media" });
    }
  }

  const out: SignedMedia[] = wanted.map((w) => ({ key: w.key, assetId: w.assetId, path: w.path, url: null, expiresAt: null }));

  // public bucket: permanent URLs
  wanted.forEach((w, i) => {
    if (w.path && w.bucket === "public-media") {
      out[i].url = supabase.storage.from("public-media").getPublicUrl(w.path).data.publicUrl;
    }
  });

  const priv = [...new Set(wanted.filter((w) => w.path && w.bucket === "private-media").map((w) => w.path as string))];
  if (priv.length) {
    const expiresAt = Date.now() + ttl * 1000;
    const { data } = await supabase.storage
      .from("private-media")
      .createSignedUrls(priv, ttl, input.download ? { download: true } : undefined);
    const byPath = new Map<string, string>();
    for (const s of data ?? []) if (s.path && s.signedUrl && !s.error) byPath.set(s.path, s.signedUrl);
    wanted.forEach((w, i) => {
      if (w.path && w.bucket === "private-media") {
        const u = byPath.get(w.path);
        if (u) {
          out[i].url = u;
          out[i].expiresAt = expiresAt;
        }
      }
    });
  }
  return out;
}
