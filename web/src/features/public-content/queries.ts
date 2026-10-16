import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import type { z } from "zod";
import { getPublicClient, publicMediaUrl } from "./client";
import {
  businessSettingsRow,
  mediaAssetRow,
  projectRow,
  reviewRow,
  serviceRow,
  showcaseVideoRow,
  type ShowcaseVideo,
  type BusinessSettings,
  type Loaded,
  type MediaAssetRow,
  type Project,
  type PublicMedia,
  type ReviewRow,
  type Service,
} from "./schema";

const PROJECT_COLUMNS =
  "id, public_slug, title, event_type, event_date, city, featured, featured_order, seo_title, seo_description, highlight, coverage_notes";
const MEDIA_COLUMNS =
  "id, event_id, bucket, path, kind, mime, width, height, duration_s, variants, sort_order";
const SERVICE_COLUMNS = "id, slug, title, summary, body, cover_media_id, sort_order";

function toPublicMedia(row: MediaAssetRow): PublicMedia | null {
  if (row.kind === "document") return null;
  const src = publicMediaUrl(row.bucket, row.id, row.kind === "image" && row.variants?.display ? "display" : "original");
  if (!src) return null;
  const posterVariant = row.variants?.poster ? "poster" : row.variants?.thumb ? "thumb" : null;
  return {
    id: row.id,
    kind: row.kind,
    src,
    poster: posterVariant ? publicMediaUrl(row.bucket, row.id, posterVariant) : null,
    width: row.width ?? null,
    height: row.height ?? null,
  };
}

function parseRows<S extends z.ZodType>(schema: S, rows: unknown): z.output<S>[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((r) => {
    const parsed = schema.safeParse(r);
    return parsed.success ? [parsed.data as z.output<S>] : [];
  });
}

async function mediaForEvents(eventIds: string[]): Promise<Map<string, PublicMedia[]>> {
  const map = new Map<string, PublicMedia[]>();
  const sb = getPublicClient();
  if (!sb || eventIds.length === 0) return map;
  const { data, error } = await sb
    .from("media_assets")
    .select(MEDIA_COLUMNS)
    .in("event_id", eventIds)
    .eq("visibility", "public")
    .eq("upload_status", "ready")
    .order("sort_order", { ascending: true });
  if (error) throw error;
  for (const row of parseRows(mediaAssetRow, data)) {
    const m = toPublicMedia(row);
    if (!m || !row.event_id) continue;
    map.set(row.event_id, [...(map.get(row.event_id) ?? []), m]);
  }
  return map;
}

async function mediaById(ids: string[]): Promise<Map<string, PublicMedia>> {
  const map = new Map<string, PublicMedia>();
  const sb = getPublicClient();
  if (!sb || ids.length === 0) return map;
  const { data, error } = await sb
    .from("media_assets")
    .select(MEDIA_COLUMNS)
    .in("id", ids)
    .eq("visibility", "public")
    .eq("upload_status", "ready");
  if (error) throw error;
  for (const row of parseRows(mediaAssetRow, data)) {
    const m = toPublicMedia(row);
    if (m) map.set(row.id, m);
  }
  return map;
}

export async function getBusinessSettings(): Promise<Loaded<BusinessSettings | null>> {
  "use cache";
  cacheLife("minutes");
  cacheTag("business-settings");
  const sb = getPublicClient();
  if (!sb) return { status: "unavailable" };
  try {
    const { data, error } = await sb.from("business_settings").select("*").limit(1).maybeSingle();
    if (error) throw error;
    if (!data) return { status: "ok", data: null };
    const parsed = businessSettingsRow.safeParse(data);
    return { status: "ok", data: parsed.success ? parsed.data : null };
  } catch {
    return { status: "unavailable" };
  }
}

export async function getHeroMedia(): Promise<PublicMedia | null> {
  "use cache";
  cacheLife("minutes");
  cacheTag("business-settings", "media");
  const settings = await getBusinessSettings();
  const id = settings.status === "ok" ? settings.data?.hero_media_id : null;
  if (!id) return null;
  try {
    return (await mediaById([id])).get(id) ?? null;
  } catch {
    return null;
  }
}

export async function getPublishedProjects(limit?: number): Promise<Loaded<Project[]>> {
  "use cache";
  cacheLife("minutes");
  cacheTag("projects");
  const sb = getPublicClient();
  if (!sb) return { status: "unavailable" };
  try {
    let q = sb
      .from("events")
      .select(PROJECT_COLUMNS)
      .eq("is_published", true)
      .eq("publication_consent", "granted")
      .not("public_slug", "is", null)
      .order("featured", { ascending: false })
      .order("featured_order", { ascending: true, nullsFirst: false })
      .order("event_date", { ascending: false, nullsFirst: false });
    if (limit) q = q.limit(limit);
    const { data, error } = await q;
    if (error) throw error;
    const rows = parseRows(projectRow, data);
    const media = await mediaForEvents(rows.map((r) => r.id));
    return {
      status: "ok",
      data: rows.map((r) => {
        const list = media.get(r.id) ?? [];
        return { ...r, media: list, cover: list[0] ?? null };
      }),
    };
  } catch {
    return { status: "unavailable" };
  }
}

export async function getProjectBySlug(slug: string): Promise<Loaded<Project | null>> {
  "use cache";
  cacheLife("minutes");
  cacheTag("projects", `project:${slug}`);
  const sb = getPublicClient();
  if (!sb) return { status: "unavailable" };
  try {
    const { data, error } = await sb
      .from("events")
      .select(PROJECT_COLUMNS)
      .eq("public_slug", slug)
      .eq("is_published", true)
      .eq("publication_consent", "granted")
      .maybeSingle();
    if (error) throw error;
    const parsed = projectRow.safeParse(data);
    if (!data || !parsed.success) return { status: "ok", data: null };
    const list = (await mediaForEvents([parsed.data.id])).get(parsed.data.id) ?? [];
    return { status: "ok", data: { ...parsed.data, media: list, cover: list[0] ?? null } };
  } catch {
    return { status: "unavailable" };
  }
}

export async function getPublishedServices(): Promise<Loaded<Service[]>> {
  "use cache";
  cacheLife("minutes");
  cacheTag("services");
  const sb = getPublicClient();
  if (!sb) return { status: "unavailable" };
  try {
    const { data, error } = await sb
      .from("services")
      .select(SERVICE_COLUMNS)
      .eq("is_published", true)
      .order("sort_order", { ascending: true });
    if (error) throw error;
    const rows = parseRows(serviceRow, data);
    const covers = await mediaById(
      rows.flatMap((r) => (r.cover_media_id ? [r.cover_media_id] : [])),
    );
    return {
      status: "ok",
      data: rows.map((r) => ({
        ...r,
        cover: r.cover_media_id ? (covers.get(r.cover_media_id) ?? null) : null,
      })),
    };
  } catch {
    return { status: "unavailable" };
  }
}

export async function getServiceBySlug(slug: string): Promise<Loaded<Service | null>> {
  "use cache";
  cacheLife("minutes");
  cacheTag("services", `service:${slug}`);
  const all = await getPublishedServices();
  if (all.status !== "ok") return all;
  return { status: "ok", data: all.data.find((s) => s.slug === slug) ?? null };
}

export async function getApprovedReviews(limit = 6): Promise<Loaded<ReviewRow[]>> {
  "use cache";
  cacheLife("minutes");
  cacheTag("reviews");
  const sb = getPublicClient();
  if (!sb) return { status: "unavailable" };
  try {
    const { data, error } = await sb
      .from("reviews")
      .select("id, rating, body, display_name")
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return { status: "ok", data: parseRows(reviewRow, data) };
  } catch {
    return { status: "unavailable" };
  }
}

const VIDEO_COLUMNS = "id, youtube_id, title, description, category, duration_seconds, published_at, is_promo, sort_order";

/** Published showcase videos (promo first, then sort_order). Anon RLS returns published rows only. */
export async function getShowcaseVideos(): Promise<Loaded<ShowcaseVideo[]>> {
  "use cache";
  cacheLife("minutes");
  cacheTag("showcase-videos");
  const sb = getPublicClient();
  if (!sb) return { status: "unavailable" };
  try {
    // Rows are validated with Zod (the table may be newer than the generated types).
    const { data, error } = await sb
      .from("showcase_videos")
      .select(VIDEO_COLUMNS) // RLS (showcase_public_read) returns published rows only; is_published is not anon-selectable.
      .order("is_promo", { ascending: false })
      .order("sort_order", { ascending: true });
    if (error) throw error;
    return { status: "ok", data: parseRows(showcaseVideoRow, data) };
  } catch {
    return { status: "unavailable" };
  }
}
