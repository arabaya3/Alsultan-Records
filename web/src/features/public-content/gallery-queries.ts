import "server-only";
import { allRows, allRowsResult } from "@/lib/supabase/all-rows";
import { cacheLife, cacheTag } from "next/cache";
import { publicLife } from "./cache-life";
import { TAGS } from "@/lib/cache-tags";
import { getPublicClient } from "./client";
import {
  albumPhotoRow,
  buildGallery,
  albumHeroPhotos, latestAlbumHeroPhoto,
  newestPublishedFirst,
  photoAlbumRow,
  videoCategoryLinkRow,
  videoCategoryRow,
  type AlbumPhoto,
  type PhotoAlbum,
  type VideoGallery,
} from "./gallery-model";
import type { Loaded } from "./schema";
import { getBusinessSettings, getShowcaseVideos } from "./queries";
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
/** Published videos with a ready studio file for reels mode (no paths: the file is read through /r/<id>). */
export async function getReelFiles(): Promise<Map<string, { width: number | null; height: number | null }>> {
  "use cache";
  cacheLife("hours");
  cacheTag(TAGS.videos);
  const sb = getPublicClient();
  if (!sb) return new Map();
  const { data, error } = await (sb as unknown as { rpc: (f: string) => PromiseLike<{ data: unknown; error: unknown }> }).rpc("reel_files");
  if (error || !Array.isArray(data)) return new Map();
  return new Map((data as { video_id: string; width: number | null; height: number | null }[]).map((r) => [r.video_id, { width: r.width, height: r.height }]));
}

export async function getVideoGallery(): Promise<Loaded<VideoGallery>> {
  "use cache";
  cacheTag(TAGS.videos, "video-categories");
  return publicLife(
    await (async (): Promise<Loaded<VideoGallery>> => {
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
    })(),
  );
}

const ALBUM_COLUMNS = "id, slug, title, description, event_date, source_label, source_url, cover_photo_id, sort_order, created_at";

/**
 * Published albums, newest PUBLISHED first (listed_at desc, id desc — see newestPublishedFirst), with their published
 * photo count and a usable cover (falls back to the first photo). One tag (TAGS.albums) covers every change that
 * affects this list: publish/unpublish, archive/trash, cover, photo hide/trash (albums-admin/actions.ts).
 */
export async function getPublishedAlbums(): Promise<Loaded<PhotoAlbum[]>> {
  "use cache";
  cacheTag(TAGS.albums);
  return publicLife(
    await (async (): Promise<Loaded<PhotoAlbum[]>> => {
      const sb = getPublicClient();
      if (!sb) return { status: "unavailable" };
      try {
        // Anon RLS hides unpublished, archived and trashed albums/photos.
        const readAlbums = (cols: string, byListed: boolean) => {
          const q = sb.from("photo_albums").select(cols);
          return byListed
            ? q.order("listed_at", { ascending: false }).order("id", { ascending: false })
            : q.order("created_at", { ascending: false }).order("id", { ascending: false });
        };
        const [albumsFirst, photos] = await Promise.all([
          readAlbums(`${ALBUM_COLUMNS}, category_id, published_at, listed_at`, true),
          allRowsResult((a, b) => sb.from("album_photos").select("id, album_id, sort_order").order("sort_order", { ascending: true }).order("id", { ascending: true }).range(a, b)),
        ]);
        // Older schema (before 0026 / the CMS migration): same rule from created_at, never the event date.
        const albums = albumsFirst.error ? await readAlbums(ALBUM_COLUMNS, false) : albumsFirst;
        if (albums.error || photos.error) throw albums.error ?? photos.error;
        const byAlbum = new Map<string, string[]>();
        for (const p of (photos.data ?? []) as { id: string; album_id: string }[]) {
          byAlbum.set(p.album_id, [...(byAlbum.get(p.album_id) ?? []), p.id]);
        }
        return {
          status: "ok",
          data: newestPublishedFirst(parseRows(photoAlbumRow, albums.data)).map((a) => {
            const ids = byAlbum.get(a.id) ?? [];
            const coverId = a.cover_photo_id && ids.includes(a.cover_photo_id) ? a.cover_photo_id : (ids[0] ?? null);
            return { ...a, photoCount: ids.length, coverId };
          }),
        };
      } catch {
        return { status: "unavailable" };
      }
    })(),
  );
}

export async function getAlbumBySlug(slug: string): Promise<Loaded<{ album: PhotoAlbum; photos: AlbumPhoto[] } | null>> {
  "use cache";
  cacheTag(TAGS.albums, `photo-album:${slug}`);
  return publicLife(
    await (async (): Promise<Loaded<{ album: PhotoAlbum; photos: AlbumPhoto[] } | null>> => {
      const sb = getPublicClient();
      if (!sb) return { status: "unavailable" };
      try {
        const { data, error } = await sb
          .from("photo_albums")
          .select("id, slug, title, description, event_date, source_label, source_url, cover_photo_id, sort_order, created_at, published_at, listed_at")
          .eq("slug", slug)
          .maybeSingle();
        if (error) throw error;
        const parsed = photoAlbumRow.safeParse(data);
        if (!data || !parsed.success) return { status: "ok", data: null };
        const rows = await allRows((a, b) =>
          sb
            .from("album_photos")
            .select("id, album_id, width, height, alt_text, sort_order")
            .eq("album_id", parsed.data.id)
            .order("sort_order", { ascending: true })
            .order("id", { ascending: true })
            .range(a, b),
        );
        const photos = parseRows(albumPhotoRow, rows);
        const ids = photos.map((p) => p.id);
        const coverId = parsed.data.cover_photo_id && ids.includes(parsed.data.cover_photo_id) ? parsed.data.cover_photo_id : (ids[0] ?? null);
        return { status: "ok", data: { album: { ...parsed.data, photoCount: photos.length, coverId }, photos } };
      } catch {
        return { status: "unavailable" };
      }
    })(),
  );
}

/**
 * The public hero backdrop (home + inner pages that use the shared hero). business_settings.hero_cover_source:
 *   "manual"       → hero_cover_photo_id (the owner's chosen photo; unchanged behaviour);
 *   "latest_album" → latestAlbumHeroPhoto(getPublishedAlbums()): follows the newest published album, so publishing
 *                    an album, changing its cover, or hiding/trashing the photo or album (all expire TAGS.albums)
 *                    moves the hero with no further step. null → the designed photo-less hero.
 * Both reads are already cached and tagged; this adds no cache layer of its own. The bytes come from /p/<id>/display,
 * which re-checks publication on every request and is never stored by shared caches.
 */
/** The site hero photo first (see getSiteHeroPhotoId), then the other album covers: the backdrops change as photos are published. */
export async function getSiteHeroPhotoIds(): Promise<string[]> {
  const [first, albums] = await Promise.all([getSiteHeroPhotoId(), getPublishedAlbums()]);
  const covers = albums.status === "ok" ? albumHeroPhotos(albums.data) : [];
  return [...new Set([...(first ? [first] : []), ...covers])];
}

export async function getSiteHeroPhotoId(): Promise<string | null> {
  const s = await getBusinessSettings();
  if (s.status !== "ok" || !s.data) return null;
  if (s.data.hero_cover_source === "latest_album") {
    const albums = await getPublishedAlbums();
    return albums.status === "ok" ? latestAlbumHeroPhoto(albums.data) : null;
  }
  return s.data.hero_cover_photo_id ?? null;
}
