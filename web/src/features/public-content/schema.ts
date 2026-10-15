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
  hero_media_id: nullableText,
  canonical_base_url: nullableText,
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
export type Service = ServiceRow & { cover: PublicMedia | null };

/** Distinguishes "the service failed" from "there is nothing yet". */
export type Loaded<T> = { status: "ok"; data: T } | { status: "unavailable" };
