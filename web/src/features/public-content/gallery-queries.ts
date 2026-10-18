import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { TAGS } from "@/lib/cache-tags";
import { getPublicClient } from "./client";
import {
  albumPhotoRow,
  buildGallery,
  photoAlbumRow,
  videoCategoryLinkRow,
  videoCategoryRow,
  type AlbumPhoto,
  type PhotoAlbum,
  type VideoGallery,
} from "./gallery-model";
import type { Loaded } from "./schema";
import { getShowcaseVideos } from "./queries";
import type { z } from "zod";

function parseRows<S extends z.ZodType>(schema: S, rows: unknown): z.output<S>[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((r) => {
    const p = schema.safeParse(r);
    return p.success ? [p.data as z.output<S>] : [];
  });
}

/**
 * Published videos joined with published categories. Anonymous key only: RLS returns published
 * categories and links whose video AND category are published. If the category tables are not
 * reachable the videos still render (uncategorised) rather than failing the whole page.
 */
export async function getVideoGallery(): Promise<Loaded<VideoGallery>> {
  "use cache";
  cacheLife("minutes");
  cacheTag(TAGS.videos, "video-categories");
  const videos = await getShowcaseVideos();
  if (videos.status !== "ok") return videos;
  const sb = getPublicClient();
  if (!sb) return { status: "unavailable" };
  try {
    const [cats, links] = await Promise.all([
      sb.from("video_categories").select("id, slug, title, sort_order").order("sort_order", { ascending: true }),
      sb.from("showcase_video_categories").select("video_id, category_id, is_primary"),
    ]);
    if (cats.error || links.error) throw cats.error ?? links.error;
    return {
      status: "ok",
      data: buildGallery(videos.data, parseRows(videoCategoryRow, cats.data), parseRows(videoCategoryLinkRow, links.data)),
    };
  } catch {
    return { status: "ok", data: buildGallery(videos.data, [], []) };
  }
}

const ALBUM_COLUMNS = "id, slug, title, description, event_date, source_label, source_url, cover_photo_id, sort_order";

/** Published albums with their published photo count and a usable cover (falls back to the first photo). */
export async function getPublishedAlbums(): Promise<Loaded<PhotoAlbum[]>> {
  "use cache";
  cacheLife("minutes");
  cacheTag(TAGS.albums);
  const sb = getPublicClient();
  if (!sb) return { status: "unavailable" };
  try {
    // Anon RLS hides unpublished, archived and trashed albums/photos.
    const readAlbums = (cols: string) =>
      sb.from("photo_albums").select(cols).order("sort_order", { ascending: true }).order("event_date", { ascending: false, nullsFirst: false });
    const [albumsFirst, photos] = await Promise.all([
      readAlbums(`${ALBUM_COLUMNS}, category_id`),
      sb.from("album_photos").select("id, album_id, sort_order").order("sort_order", { ascending: true }),
    ]);
    const albums = albumsFirst.error ? await readAlbums(ALBUM_COLUMNS) : albumsFirst; // CMS column not migrated yet
    if (albums.error || photos.error) throw albums.error ?? photos.error;
    const byAlbum = new Map<string, string[]>();
    for (const p of (photos.data ?? []) as { id: string; album_id: string }[]) {
      byAlbum.set(p.album_id, [...(byAlbum.get(p.album_id) ?? []), p.id]);
    }
    return {
      status: "ok",
      data: parseRows(photoAlbumRow, albums.data).map((a) => {
        const ids = byAlbum.get(a.id) ?? [];
        const coverId = a.cover_photo_id && ids.includes(a.cover_photo_id) ? a.cover_photo_id : (ids[0] ?? null);
        return { ...a, photoCount: ids.length, coverId };
      }),
    };
  } catch {
    return { status: "unavailable" };
  }
}

export async function getAlbumBySlug(slug: string): Promise<Loaded<{ album: PhotoAlbum; photos: AlbumPhoto[] } | null>> {
  "use cache";
  cacheLife("minutes");
  cacheTag(TAGS.albums, `photo-album:${slug}`);
  const sb = getPublicClient();
  if (!sb) return { status: "unavailable" };
  try {
    const { data, error } = await sb
      .from("photo_albums")
      .select("id, slug, title, description, event_date, source_label, source_url, cover_photo_id, sort_order")
      .eq("slug", slug)
      .maybeSingle();
    if (error) throw error;
    const parsed = photoAlbumRow.safeParse(data);
    if (!data || !parsed.success) return { status: "ok", data: null };
    const res = await sb
      .from("album_photos")
      .select("id, album_id, width, height, alt_text, sort_order")
      .eq("album_id", parsed.data.id)
      .order("sort_order", { ascending: true });
    if (res.error) throw res.error;
    const photos = parseRows(albumPhotoRow, res.data);
    const ids = photos.map((p) => p.id);
    const coverId = parsed.data.cover_photo_id && ids.includes(parsed.data.cover_photo_id) ? parsed.data.cover_photo_id : (ids[0] ?? null);
    return { status: "ok", data: { album: { ...parsed.data, photoCount: photos.length, coverId }, photos } };
  } catch {
    return { status: "unavailable" };
  }
}
