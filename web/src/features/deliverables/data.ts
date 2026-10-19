import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

export type Revision = { id: string; revisionNo: number; notes: string | null; createdAt: string; mediaAssetId: string | null };
export type Deliverable = {
  id: string;
  kind: string;
  title: string;
  status: string;
  dueAt: string | null;
  revisions: Revision[];
};

const COLS = "id, kind, title, status, due_at, deliverable_revisions(id, revision_no, notes, created_at, media_asset_id)";

type Row = {
  id: string;
  kind: string;
  title: string;
  status: string;
  due_at: string | null;
  deliverable_revisions: { id: string; revision_no: number; notes: string | null; created_at: string; media_asset_id: string | null }[];
};

function map(r: Row): Deliverable {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    status: r.status,
    dueAt: r.due_at,
    revisions: [...(r.deliverable_revisions ?? [])]
      .sort((a, b) => b.revision_no - a.revision_no)
      .map((v) => ({ id: v.id, revisionNo: v.revision_no, notes: v.notes, createdAt: v.created_at, mediaAssetId: v.media_asset_id })),
  };
}

export async function listDeliverables(supabase: Client, eventId: string, kinds?: string[]) {
  let q = supabase.from("deliverables").select(COLS).eq("event_id", eventId).order("created_at");
  if (kinds) q = q.in("kind", kinds as Database["public"]["Enums"]["deliverable_kind"][]);
  const { data, error } = await q;
  if (error) return null;
  return ((data ?? []) as unknown as Row[]).map(map);
}

export async function getDeliverable(supabase: Client, eventId: string, deliverableId: string) {
  const { data, error } = await supabase
    .from("deliverables")
    .select(COLS)
    .eq("event_id", eventId)
    .eq("id", deliverableId)
    .maybeSingle();
  if (error) return { status: "unavailable" as const };
  return { status: "ok" as const, data: data ? map(data as unknown as Row) : null };
}

export type FileAsset = { id: string; kind: string; mime: string; bytes: number | null; createdAt: string; label: string };

/** Downloadable files for the event: documents + delivered revision media. */
export async function listEventFiles(supabase: Client, eventId: string) {
  const { data, error } = await supabase
    .from("media_assets")
    .select("id, kind, mime, bytes, path, created_at")
    .eq("event_id", eventId)
    .in("kind", ["document", "video"])
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return null;
  return (data ?? []).map((r) => ({
    id: r.id,
    kind: r.kind,
    mime: r.mime,
    bytes: r.bytes,
    createdAt: r.created_at,
    label: r.path.split("/").pop() ?? "ملف",
  }));
}
