/**
 * Pure gallery model (no I/O): row schemas for the video-category / photo-album contract
 * (migration 20261017000015) and the selection / filtering / pagination rules.
 * Rows are validated with Zod because the generated database types may lag the migration.
 */
import { cleanVideoTitle } from "./labels";
import { z } from "zod";
import { isYouTubeId } from "@/lib/youtube";
import type { ShowcaseVideo } from "./schema";

const nullableText = z
  .string()
  .nullable()
  .optional()
  .transform((v) => v ?? null);
/** Category slugs: ^[a-z0-9_]{2,30}$; album slugs: ^[a-z0-9][a-z0-9-]{1,79}$ (migration 0015). */
export const SLUG = /^[a-z0-9][a-z0-9_-]{1,79}$/;

export const videoCategoryRow = z.object({
  id: z.string(),
  slug: z.string().regex(SLUG),
  title: z.string().min(1),
  sort_order: z.number().nullable().optional().transform((v) => v ?? 0),
});
export type VideoCategory = z.infer<typeof videoCategoryRow>;

export const videoCategoryLinkRow = z.object({
  video_id: z.string(),
  category_id: z.string(),
  is_primary: z.boolean().nullable().optional().transform((v) => v ?? false),
});
export type VideoCategoryLink = z.infer<typeof videoCategoryLinkRow>;

export const photoAlbumRow = z.object({
  id: z.string(),
  slug: z.string().regex(SLUG),
  title: z.string().min(1),
  description: nullableText,
  event_date: nullableText,
  source_label: nullableText,
  source_url: nullableText,
  cover_photo_id: nullableText,
  sort_order: z.number().nullable().optional().transform((v) => v ?? 0),
  category_id: nullableText,
  created_at: nullableText,
  published_at: nullableText,
  listed_at: nullableText,
});
export type PhotoAlbumRow = z.infer<typeof photoAlbumRow>;

/**
 * Public album order (migration 0026): newest PUBLISHED first. `listed_at` = published_at, or created_at for albums
 * published before publish times were recorded (documented fallback; no invented date). Never the event date,
 * the title or the manual sort_order. Ties (same instant) break on id, so pages never overlap or skip.
 */
export function listedKey(a: Pick<PhotoAlbumRow, "listed_at" | "published_at" | "created_at">): string {
  const v = a.listed_at ?? a.published_at ?? a.created_at;
  const t = v ? Date.parse(v) : NaN;
  return Number.isNaN(t) ? "" : new Date(t).toISOString();
}
export function newestPublishedFirst<T extends Pick<PhotoAlbumRow, "id" | "listed_at" | "published_at" | "created_at">>(xs: T[]): T[] {
  return [...xs].sort((a, b) => listedKey(b).localeCompare(listedKey(a)) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

/**
 * Automatic hero (business_settings.hero_cover_source = 'latest_album'): the cover of the newest published album
 * that has a usable photo. `coverId` is already the album's chosen cover when it is a ready+published photo, else
 * its first published photo in album order (getPublishedAlbums). Only anon-visible rows reach this function, so a
 * draft, hidden, archived or trashed album/photo can never be chosen. null → the designed (photo-less) hero.
 */
export function latestAlbumHeroPhoto(albums: Pick<PhotoAlbum, "id" | "listed_at" | "published_at" | "created_at" | "coverId">[]): string | null {
  return newestPublishedFirst(albums).find((a) => a.coverId)?.coverId ?? null;
}

export const albumPhotoRow = z.object({
  id: z.string(),
  album_id: z.string(),
  width: z.number().int().positive().nullable().optional().transform((v) => v ?? null),
  height: z.number().int().positive().nullable().optional().transform((v) => v ?? null),
  alt_text: nullableText,
  sort_order: z.number().nullable().optional().transform((v) => v ?? 0),
});
export type AlbumPhoto = z.infer<typeof albumPhotoRow>;

export type CategoryRef = { slug: string; title: string };
export type GalleryVideo = ShowcaseVideo & { categories: CategoryRef[]; primary: CategoryRef | null };
export type CategoryWithCount = VideoCategory & { count: number };
export type VideoGallery = { videos: GalleryVideo[]; categories: CategoryWithCount[]; promo: GalleryVideo | null };
/** Role (docs/cms-contract.md): "work" = portfolio only, "promo" = promos only, "both" = in both lists. */
export const isWork = (v: Pick<ShowcaseVideo, "role">) => v.role !== "promo";
export const isPromoRole = (v: Pick<ShowcaseVideo, "role">) => v.role === "promo" || v.role === "both";
export const promoVideos = (g: VideoGallery) => g.videos.filter(isPromoRole);
export type PhotoAlbum = PhotoAlbumRow & { photoCount: number; coverId: string | null };

export const PAGE_SIZE = 9;
export const PHOTO_VARIANTS = ["thumb", "display"] as const;
export type PhotoVariant = (typeof PHOTO_VARIANTS)[number];

/** Same-origin, publication-checked photo URL (app/p/[photoId]/[variant]/route.ts). Never the original. */
export const photoUrl = (photoId: string, variant: PhotoVariant) => `/p/${encodeURIComponent(photoId)}/${variant}`;

/** Joins videos with their published categories. Primary category first, then category sort order. */
export function buildGallery(videos: ShowcaseVideo[], categories: VideoCategory[], links: VideoCategoryLink[]): VideoGallery {
  const cats = [...categories].sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title, "ar"));
  const byId = new Map(cats.map((c) => [c.id, c]));
  const order = new Map(cats.map((c, i) => [c.id, i]));
  const perVideo = new Map<string, VideoCategoryLink[]>();
  for (const l of links) {
    if (!byId.has(l.category_id)) continue;
    perVideo.set(l.video_id, [...(perVideo.get(l.video_id) ?? []), l]);
  }
  const seen = new Set<string>();
  const all: GalleryVideo[] = [];
  for (const v of videos) {
    if (!isYouTubeId(v.youtube_id) || seen.has(v.youtube_id)) continue;
    seen.add(v.youtube_id);
    const ls = (perVideo.get(v.id) ?? []).sort(
      (a, b) => Number(b.is_primary) - Number(a.is_primary) || (order.get(a.category_id)! - order.get(b.category_id)!),
    );
    const refs = ls.map((l) => byId.get(l.category_id)!).map((c) => ({ slug: c.slug, title: c.title }));
    all.push({ ...v, categories: refs, primary: refs[0] ?? null });
  }
  const promo = all.find((v) => v.is_promo) ?? null;
  const counts = new Map<string, number>();
  for (const v of all) if (isWork(v)) for (const c of v.categories) counts.set(c.slug, (counts.get(c.slug) ?? 0) + 1);
  return {
    videos: all,
    promo,
    categories: cats.map((c) => ({ ...c, count: counts.get(c.slug) ?? 0 })).filter((c) => c.count > 0),
  };
}

/** Homepage selection: no promo, no duplicates, ≤ max; one per category (category order) first, then fill by sort order. */
export function homeSelection(g: VideoGallery, max = 6, featured: string[] = []): GalleryVideo[] {
  const pool = g.videos.filter((v) => !v.is_promo && isWork(v));
  // Owner-picked videos (site_sections.featured_ids) win, in the owner's order.
  if (featured.length) {
    const byId = new Map(pool.map((v) => [v.id, v]));
    const picked = featured.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
    if (picked.length) return picked.slice(0, max);
  }
  const picked: GalleryVideo[] = [];
  const used = new Set<string>();
  for (const c of g.categories) {
    if (picked.length >= max) break;
    const v = pool.find((x) => !used.has(x.id) && x.primary?.slug === c.slug) ?? pool.find((x) => !used.has(x.id) && x.categories.some((y) => y.slug === c.slug));
    if (v) {
      used.add(v.id);
      picked.push(v);
    }
  }
  for (const v of pool) {
    if (picked.length >= max) break;
    if (!used.has(v.id)) {
      used.add(v.id);
      picked.push(v);
    }
  }
  // Present in the editor's sort order, not in category-pick order.
  const pos = new Map(pool.map((v, i) => [v.id, i]));
  return picked.sort((a, b) => pos.get(a.id)! - pos.get(b.id)!);
}

/** Related works: same primary category, excluding itself, max 3. */
export function relatedVideos(g: VideoGallery, v: GalleryVideo, max = 3): GalleryVideo[] {
  if (!v.primary) return [];
  return g.videos.filter((x) => x.id !== v.id && !x.is_promo && isWork(x) && x.categories.some((c) => c.slug === v.primary!.slug)).slice(0, max);
}

export type WorkQuery = { tab: "videos" | "photos" | "promos"; cat: string | null; page: number };

export function parseWorkQuery(sp: Record<string, string | string[] | undefined>): WorkQuery {
  const one = (k: string) => {
    const v = sp[k];
    return typeof v === "string" ? v : Array.isArray(v) ? v[0] : undefined;
  };
  const rawTab = one("tab");
  const tab = rawTab === "photos" ? "photos" : rawTab === "promos" ? "promos" : "videos";
  const rawCat = one("cat");
  const cat = rawCat && SLUG.test(rawCat) && rawCat.length <= 64 ? rawCat : null;
  const n = Number.parseInt(one("page") ?? "1", 10);
  const page = Number.isFinite(n) && n > 0 && n < 10_000 ? n : 1;
  return { tab, cat, page };
}

export function workHref(q: Partial<WorkQuery>): string {
  const p = new URLSearchParams();
  if (q.tab === "photos" || q.tab === "promos") {
    p.set("tab", q.tab);
    if (q.tab === "photos" && q.cat) p.set("cat", q.cat);
  } else {
    if (q.cat) p.set("cat", q.cat);
    if (q.page && q.page > 1) p.set("page", String(q.page));
  }
  const s = p.toString();
  return s ? `/work?${s}` : "/work";
}

/** Grid list for /work: promo excluded (shown separately on the unfiltered view). */
export function filterVideos(g: VideoGallery, cat: string | null): GalleryVideo[] {
  return g.videos.filter((v) => isWork(v) && (cat ? v.categories.some((c) => c.slug === cat) : v !== g.promo));
}

/** "Load more" pagination: page N shows the first N×size items (shareable, server-rendered). */
export function paginate<T>(items: T[], page: number, size = PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(page, pages);
  return { shown: items.slice(0, current * size), page: current, pages, hasMore: current < pages, total: items.length };
}

/** Props for <YouTubeCard> / the dialog: original title, categories, video page link. */
export function toCardVideo(v: GalleryVideo, duration: string | null) {
  return {
    youtubeId: v.youtube_id,
    title: cleanVideoTitle(v.title),
    duration,
    categories: v.categories,
    href: `/work/v/${v.youtube_id}`,
    coverSrc: v.custom_cover_photo_id ? photoUrl(v.custom_cover_photo_id, "thumb") : null,
  };
}

/**
 * Home «albums» section (owner request 2026-10-29): the newest PUBLISHED album is always first, even when older
 * manual picks (site_sections.featured_ids) exist; then the picks in the owner's order; then the next newest, up to
 * `limit`. The picks are never cleared or rewritten — only how they combine with the newest album changed.
 * `newestFirst` must already be in publish order (getPublishedAlbums).
 */
export function homeAlbums<T extends { id: string }>(newestFirst: T[], featured: string[], limit: number): T[] {
  if (!newestFirst.length || limit < 1) return [];
  const byId = new Map(newestFirst.map((a) => [a.id, a]));
  const out: T[] = [];
  const add = (a: T | undefined) => {
    if (a && out.length < limit && !out.includes(a)) out.push(a);
  };
  add(newestFirst[0]);
  for (const id of featured) add(byId.get(id));
  for (const a of newestFirst) add(a);
  return out;
}
