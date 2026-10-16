import "server-only";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Cookieless, anonymous Supabase client for PUBLIC content only.
 *
 * Why not `@/lib/supabase/server`? That client reads cookies (a request-time API) and so
 * cannot run inside `'use cache'`. Public pages read only RLS-public rows (published,
 * consented projects; published services; approved reviews; business_settings) and call
 * the SECURITY DEFINER public RPCs, so the anonymous publishable key is the correct,
 * least-privileged credential here.
 *
 * Returns null when env is missing so pages render a "service unavailable" state
 * instead of crashing the build.
 */
export function getPublicClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export const MEDIA_VARIANTS = ["display", "thumb", "poster", "original"] as const;
export type MediaVariant = (typeof MEDIA_VARIANTS)[number];

/**
 * Same-origin URL of a published asset: /m/{assetId}/{variant}. The route handler
 * (app/m/[assetId]/[variant]/route.ts) re-checks on every request that the asset is still
 * public (event published + consent granted + visibility public) before serving bytes, so a
 * consent withdrawal stops serving immediately. Never a direct storage URL.
 */
export function publicMediaUrl(bucket: string, assetId: string, variant: MediaVariant): string | null {
  if (bucket !== "public-media") return null;
  return `/m/${encodeURIComponent(assetId)}/${variant}`;
}
