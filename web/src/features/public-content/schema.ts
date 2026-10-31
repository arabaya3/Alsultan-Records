import { z } from "zod";

const nullableText = z
  .string()
  .nullable()
  .optional()
  .transform((v) => v ?? null);

export const businessSettingsRow = z.object({
  name: nullableText,
  tagline: nullableText,
  phone: nullableText,
  whatsapp: nullableText,
  email: nullableText,
  address: nullableText,
  instagram: nullableText,
  facebook: nullableText,
  youtube_url: nullableText,
  whatsapp_url: nullableText,
  hero_media_id: nullableText,
  canonical_base_url: nullableText,
  // CMS (docs/cms-contract.md). Absent columns parse as null → code fallbacks apply.
  hero_title: nullableText,
  hero_subtitle: nullableText,
  hero_primary_label: nullableText,
  hero_secondary_label: nullableText,
  booking_message: nullableText,
  hero_cover_photo_id: nullableText,
  /** Migration 0026. Absent (older schema) or unknown → "manual" (the stored hero_cover_photo_id, as before). */
  hero_cover_source: z.enum(["manual", "latest_album"]).nullable().optional().catch(null).transform((v) => v ?? "manual"),
  hero_promo_source: z.enum(["site", "youtube"]).nullable().optional().catch(null).transform((v) => v ?? "site"),
  hero_promo_video_id: nullableText,
  active_logo_id: nullableText,
});
export type BusinessSettings = z.infer<typeof businessSettingsRow>;

export const mediaAssetRow = z.object({
  id: z.string(),
  event_id: nullableText,
  bucket: z.string(),
  path: z.string(),
  kind: z.enum(["image", "video", "document"]),
  mime: nullableText,
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
  duration_s: z.union([z.number(), z.string()]).nullable().optional(),
  variants: z
    .object({ thumb: z.string(), display: z.string(), poster: z.string() })
    .partial()
    .nullable()
    .optional(),
  sort_order: z.number().nullable().optional(),
});
export type MediaAssetRow = z.infer<typeof mediaAssetRow>;

/** Public-safe projection of `events`. Never select customer, venue or private notes here. */
export const projectRow = z.object({
  id: z.string(),
  public_slug: z.string(),
  title: z.string(),
  event_type: nullableText,
  event_date: nullableText,
  city: nullableText,
  featured: z.boolean().nullable().optional(),
  featured_order: z.number().nullable().optional(),
  seo_title: nullableText,
  seo_description: nullableText,
  highlight: nullableText,
  coverage_notes: nullableText,
});
export type ProjectRow = z.infer<typeof projectRow>;

export const serviceRow = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  summary: nullableText,
  body: nullableText,
  cover_media_id: nullableText,
  cover_photo_id: nullableText,
  sort_order: z.number().nullable().optional(),
});
export type ServiceRow = z.infer<typeof serviceRow>;

export const reviewRow = z.object({
  id: z.string(),
  rating: z.number().int().min(1).max(5),
  body: z.string(),
  display_name: nullableText,
});
export type ReviewRow = z.infer<typeof reviewRow>;

/** Resolved media ready for rendering. */
export type PublicMedia = {
  id: string;
  kind: "image" | "video";
  src: string;
  poster: string | null;
  width: number | null;
  height: number | null;
};

export type Project = ProjectRow & { cover: PublicMedia | null; media: PublicMedia[] };
export type Service = ServiceRow & { cover: PublicMedia | null; coverPhotoSrc: string | null };

/** Distinguishes "the service failed" from "there is nothing yet". */
export type Loaded<T> = { status: "ok"; data: T } | { status: "unavailable" };

export const VIDEO_CATEGORIES = ["wedding", "evening", "groom_prep", "folk", "engagement", "graduation", "festival", "dj", "other"] as const;

/** Public projection of `showcase_videos`. The YouTube ID is re-validated before anything renders. */
export const showcaseVideoRow = z.object({
  id: z.string(),
  youtube_id: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
  title: z.string().min(1),
  description: nullableText,
  category: z.enum(VIDEO_CATEGORIES).catch("other"),
  duration_seconds: z.number().int().nonnegative().nullable().optional().transform((v) => v ?? null),
  published_at: nullableText,
  is_promo: z.boolean().nullable().optional().transform((v) => v ?? false),
  sort_order: z.number().nullable().optional(),
  role: z.enum(["work", "promo", "both"]).nullable().optional().catch(null).transform((v) => v ?? "work"),
  pinned: z.boolean().nullable().optional().transform((v) => v ?? false),
  custom_cover_photo_id: nullableText,
});
export type ShowcaseVideo = z.infer<typeof showcaseVideoRow>;
