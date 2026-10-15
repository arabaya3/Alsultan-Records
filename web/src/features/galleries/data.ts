import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { signMediaUrls } from "@/features/media/sign";

export const PAGE_SIZE = 48;

export type GalleryItem = {
  id: string;
  width: number | null;
  height: number | null;
  /** Signed thumb (falls back to display). null = no preview available. */
  src: string | null;
  expiresAt: number | null;
};

export type GalleryPage = { items: GalleryItem[]; total: number; nextOffset: number | null };

type Client = SupabaseClient<Database>;

/** One server page of event images (RLS-scoped). selectedOnly limits to the event's selection items. */
export async function fetchGalleryPage(
  supabase: Client,
  eventId: string,
  offset: number,
  selectedOnly = false,
): Promise<GalleryPage | null> {
  const from = Math.max(0, Math.floor(offset));
  const to = from + PAGE_SIZE - 1;
  let rows: { id: string; width: number | null; height: number | null }[] = [];
  let total = 0;
  if (selectedOnly) {
    const { data: sel } = await supabase.from("album_selections").select("id").eq("event_id", eventId).maybeSingle();
    if (!sel) return { items: [], total: 0, nextOffset: null };
    const { data, count, error } = await supabase
      .from("media_assets")
      .select("id, width, height, album_selection_items!inner(selection_id)", { count: "exact" })
      .eq("event_id", eventId)
      .eq("kind", "image")
      .eq("album_selection_items.selection_id", sel.id)
      .order("sort_order")
      .order("id")
      .range(from, to);
    if (error) return null;
    rows = (data ?? []).map((r) => ({ id: r.id, width: r.width, height: r.height }));
    total = count ?? 0;
  } else {
    const { data, count, error } = await supabase
      .from("media_assets")
      .select("id, width, height", { count: "exact" })
      .eq("event_id", eventId)
      .eq("kind", "image")
      .order("sort_order")
      .order("id")
      .range(from, to);
    if (error) return null;
    rows = data ?? [];
    total = count ?? 0;
  }
  const signed = rows.length
    ? await signMediaUrls({ assetIds: rows.map((r) => r.id), variant: "thumb", ttlSeconds: 600 })
    : [];
  const byId = new Map(signed.map((s) => [s.key, s]));
  const items = rows.map((r) => ({
    id: r.id,
    width: r.width,
    height: r.height,
    src: byId.get(r.id)?.url ?? null,
    expiresAt: byId.get(r.id)?.expiresAt ?? null,
  }));
  const next = from + rows.length;
  return { items, total, nextOffset: rows.length === PAGE_SIZE && next < total ? next : null };
}
