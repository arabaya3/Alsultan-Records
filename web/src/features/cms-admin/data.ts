import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PickPhoto } from "./fields";

/** Published, ready photos of published albums (picker source). Admin RLS sees all; we filter to public ones. */
export async function pickPhotos(sb: SupabaseClient): Promise<PickPhoto[]> {
  const [albums, photos] = await Promise.all([
    sb.from("photo_albums").select("id, title").eq("is_published", true).order("listed_at", { ascending: false }).order("id", { ascending: false }),
    sb.from("album_photos").select("id, album_id, sort_order").eq("is_published", true).eq("upload_status", "ready").order("sort_order").limit(1500),
  ]);
  const title = new Map(((albums.data ?? []) as { id: string; title: string }[]).map((a) => [a.id, a.title]));
  return ((photos.data ?? []) as { id: string; album_id: string }[])
    .filter((p) => title.has(p.album_id))
    .map((p) => ({ id: p.id, album: title.get(p.album_id)! }));
}

export type Opt = { id: string; title: string; hidden?: boolean };

export async function pickVideos(sb: SupabaseClient): Promise<Opt[]> {
  const { data } = await sb.from("showcase_videos").select("id, title, is_published").order("sort_order").order("created_at");
  return ((data ?? []) as { id: string; title: string; is_published: boolean }[]).map((v) => ({ id: v.id, title: v.title, hidden: !v.is_published }));
}
export async function pickAlbums(sb: SupabaseClient): Promise<Opt[]> {
  const { data } = await sb.from("photo_albums").select("id, title, is_published").order("listed_at", { ascending: false }).order("id", { ascending: false });
  return ((data ?? []) as { id: string; title: string; is_published: boolean }[]).map((v) => ({ id: v.id, title: v.title, hidden: !v.is_published }));
}
export async function pickServices(sb: SupabaseClient): Promise<Opt[]> {
  const { data } = await sb.from("services").select("id, title, is_published").order("sort_order");
  return ((data ?? []) as { id: string; title: string; is_published: boolean }[]).map((v) => ({ id: v.id, title: v.title, hidden: !v.is_published }));
}
export async function pickOffers(sb: SupabaseClient): Promise<Opt[]> {
  const { data } = await sb.from("offers").select("id, title, status").neq("status", "archived").order("sort_order");
  return ((data ?? []) as { id: string; title: string; status: string }[]).map((v) => ({ id: v.id, title: v.title, hidden: v.status !== "published" }));
}

export type SectionRow = { key: string; title: string | null; intro: string | null; is_visible: boolean; sort_order: number; item_limit: number; featured_ids: string[]; stat_value?: number | null };
export async function loadSection(sb: SupabaseClient, key: string): Promise<SectionRow | null> {
  const { data } = await sb.from("site_sections").select("key, title, intro, is_visible, sort_order, item_limit, featured_ids").eq("key", key).maybeSingle();
  return (data as SectionRow | null) ?? null;
}
