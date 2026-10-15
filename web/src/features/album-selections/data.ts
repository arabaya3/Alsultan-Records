import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

export type SelectionState = {
  selectionId: string | null;
  status: "draft" | "submitted" | "locked";
  submittedAt: string | null;
  count: number;
  /** assetId → note */
  items: Record<string, string | null>;
  snapshot: { id: string; itemCount: number; submittedAt: string } | null;
};

export async function getSelectionState(supabase: Client, eventId: string): Promise<SelectionState | null> {
  const { data: sel, error } = await supabase
    .from("album_selections")
    .select("id, status, submitted_at")
    .eq("event_id", eventId)
    .maybeSingle();
  if (error) return null;
  if (!sel) return { selectionId: null, status: "draft", submittedAt: null, count: 0, items: {}, snapshot: null };
  const items: Record<string, string | null> = {};
  for (let from = 0; ; from += 1000) {
    const { data, error: e } = await supabase
      .from("album_selection_items")
      .select("media_asset_id, note")
      .eq("selection_id", sel.id)
      .order("created_at")
      .range(from, from + 999);
    if (e) return null;
    for (const r of data ?? []) items[r.media_asset_id] = r.note;
    if (!data || data.length < 1000) break;
  }
  const { data: snap } = await supabase
    .from("album_selection_snapshots")
    .select("id, item_count, submitted_at")
    .eq("selection_id", sel.id)
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return {
    selectionId: sel.id,
    status: sel.status,
    submittedAt: sel.submitted_at,
    count: Object.keys(items).length,
    items,
    snapshot: snap ? { id: snap.id, itemCount: snap.item_count, submittedAt: snap.submitted_at } : null,
  };
}

export async function selectionCount(supabase: Client, selectionId: string) {
  const { count } = await supabase
    .from("album_selection_items")
    .select("id", { count: "exact", head: true })
    .eq("selection_id", selectionId);
  return count ?? 0;
}
