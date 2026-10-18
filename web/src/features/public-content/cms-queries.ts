import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import type { z } from "zod";
import { TAGS } from "@/lib/cache-tags";
import { DEFAULT_FOOTER_NAV, DEFAULT_HEADER_NAV, isSiteTarget, offerPath, targetPath } from "@/lib/site-targets";
import { getPublicClient } from "./client";
import {
  albumCategoryRow,
  announcementRow,
  defaultNav,
  hebronToday,
  isOfferActive,
  navItemRow,
  offerItemRow,
  offerRow,
  packageItemRow,
  packageRow,
  sortPackages,
  processStepRow,
  resolveSections,
  serviceLinkRow,
  siteSectionRow,
  sortOffers,
  toNavLinks,
  type AlbumCategory,
  type Announcement,
  type NavLink,
  type Offer,
  type Package,
  type ProcessStep,
  type SectionConfig,
  type ServiceLink,
} from "./cms-model";
import { STEPS } from "./home-content";
import type { Loaded } from "./schema";

function parseRows<S extends z.ZodType>(schema: S, rows: unknown): z.output<S>[] {
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((r) => {
    const p = schema.safeParse(r);
    return p.success ? [p.data as z.output<S>] : [];
  });
}

/**
 * Every reader below FAILS SOFT to today's built-in content: a missing table/column (migration not
 * applied yet) or an outage must never blank the public site.
 */

export type SiteNav = { header: NavLink[]; footer: NavLink[]; fromDb: boolean };

export async function getSiteNav(): Promise<SiteNav> {
  "use cache";
  cacheLife("minutes");
  cacheTag(TAGS.nav);
  const fallback = { header: defaultNav(DEFAULT_HEADER_NAV), footer: defaultNav(DEFAULT_FOOTER_NAV), fromDb: false };
  const sb = getPublicClient();
  if (!sb) return fallback;
  try {
    const { data, error } = await sb.from("nav_items").select("id, label, target, sort_order, is_visible").order("sort_order", { ascending: true });
    if (error || !data?.length) return fallback;
    const links = toNavLinks(parseRows(navItemRow, data));
    // Footer «روابط مهمة» = the same items; the booking page always stays reachable there.
    const footer = links.some((l) => l.target === "book") ? links : [...links, ...defaultNav(["book"])];
    return { header: links, footer, fromDb: true };
  } catch {
    return fallback;
  }
}

export async function getSiteSections(): Promise<SectionConfig[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag(TAGS.sections);
  const sb = getPublicClient();
  if (!sb) return resolveSections(null);
  try {
    const { data, error } = await sb
      .from("site_sections")
      .select("key, title, intro, is_visible, sort_order, item_limit, featured_ids")
      .order("sort_order", { ascending: true });
    if (error || !data?.length) return resolveSections(null);
    return resolveSections(parseRows(siteSectionRow, data));
  } catch {
    return resolveSections(null);
  }
}

const FALLBACK_STEPS: ProcessStep[] = STEPS.map((s) => ({ key: s.title, title: s.title, body: s.body, photoId: null }));

export async function getProcessSteps(): Promise<ProcessStep[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag(TAGS.process);
  const sb = getPublicClient();
  if (!sb) return FALLBACK_STEPS;
  try {
    const { data, error } = await sb.from("process_steps").select("id, title, description, photo_id, sort_order").order("sort_order", { ascending: true });
    if (error) return FALLBACK_STEPS;
    const rows = parseRows(processStepRow, data);
    // A table that exists but is empty means the owner removed every step: honour that (section hides).
    return rows.map((r) => ({ key: r.id, title: r.title, body: r.description, photoId: r.photo_id }));
  } catch {
    return FALLBACK_STEPS;
  }
}

const OFFER_COLUMNS =
  "id, slug, title, description, image_photo_id, display_price_minor, currency, show_price, starts_on, ends_on, terms, whatsapp_message, pinned_home, sort_order, target_month, target_year, package_id";

/** Active offers (anon RLS already applies the Asia/Hebron date rule; re-checked here). Pinned first. */
export async function getActiveOffers(): Promise<Loaded<Offer[]>> {
  "use cache";
  cacheLife("minutes");
  cacheTag(TAGS.offers);
  const sb = getPublicClient();
  if (!sb) return { status: "unavailable" };
  try {
    const { data, error } = await sb.from("offers").select(OFFER_COLUMNS).order("sort_order", { ascending: true });
    if (error) {
      // Table not there yet → simply no offers (not an outage message).
      return error.code === "42P01" || error.code === "PGRST205" ? { status: "ok", data: [] } : { status: "unavailable" };
    }
    const today = hebronToday();
    const rows = parseRows(offerRow, data).filter((o) => isOfferActive(o, today));
    const items = new Map<string, string[]>();
    if (rows.length) {
      const res = await sb.from("offer_items").select("offer_id, label, sort_order").in("offer_id", rows.map((r) => r.id)).order("sort_order", { ascending: true });
      for (const it of res.error ? [] : parseRows(offerItemRow, res.data)) items.set(it.offer_id, [...(items.get(it.offer_id) ?? []), it.label]);
    }
    return { status: "ok", data: sortOffers(rows).map((r) => ({ ...r, items: items.get(r.id) ?? [] })) };
  } catch {
    return { status: "unavailable" };
  }
}

const PACKAGE_COLUMNS = "id, slug, title, description, image_photo_id, display_price_minor, currency, show_price, whatsapp_message, featured, sort_order";

/** Published packages (anon RLS: status = 'published'), owner order, with their included services. */
export async function getPublishedPackages(): Promise<Loaded<Package[]>> {
  "use cache";
  cacheLife("minutes");
  cacheTag(TAGS.packages);
  const sb = getPublicClient();
  if (!sb) return { status: "unavailable" };
  try {
    const { data, error } = await sb.from("packages").select(PACKAGE_COLUMNS).order("sort_order", { ascending: true });
    if (error) return error.code === "42P01" || error.code === "PGRST205" ? { status: "ok", data: [] } : { status: "unavailable" };
    const rows = parseRows(packageRow, data);
    const items = new Map<string, string[]>();
    if (rows.length) {
      const res = await sb.from("package_items").select("package_id, label, sort_order").in("package_id", rows.map((r) => r.id)).order("sort_order", { ascending: true });
      for (const it of res.error ? [] : parseRows(packageItemRow, res.data)) items.set(it.package_id, [...(items.get(it.package_id) ?? []), it.label]);
    }
    return { status: "ok", data: sortPackages(rows).map((r) => ({ ...r, items: items.get(r.id) ?? [] })) };
  } catch {
    return { status: "unavailable" };
  }
}

export async function getOfferBySlug(slug: string): Promise<Loaded<Offer | null>> {
  "use cache";
  cacheLife("minutes");
  cacheTag(TAGS.offers, `offer:${slug}`);
  const all = await getActiveOffers();
  if (all.status !== "ok") return all;
  return { status: "ok", data: all.data.find((o) => o.slug === slug) ?? null };
}

export async function getActiveAnnouncements(): Promise<Announcement[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag(TAGS.announcements, TAGS.offers);
  const sb = getPublicClient();
  if (!sb) return [];
  try {
    const { data, error } = await sb
      .from("announcements")
      .select("id, template, text, link_kind, link_offer_id, link_page, starts_on, ends_on, dismissible, sort_order") // RLS: visible + in window
      .order("sort_order", { ascending: true });
    if (error || !data?.length) return [];
    const today = hebronToday();
    const rows = parseRows(announcementRow, data).filter((a) => a.is_visible && isOfferActive({ status: null, starts_on: a.starts_on, ends_on: a.ends_on }, today));
    if (!rows.length) return [];
    // Resolve linked offers in THIS cache entry (not via the separately cached getActiveOffers(), whose stale
    // entry could keep a just-published offer out of the link). Anon RLS returns active offers only.
    const offerIds = [...new Set(rows.flatMap((r) => (r.link_kind === "offer" && r.link_offer_id ? [r.link_offer_id] : [])))];
    const linked = offerIds.length ? await sb.from("offers").select("id, slug").in("id", offerIds) : { data: [] as { id: string; slug: string }[] };
    const offerSlug = new Map((linked.data ?? []).map((o) => [o.id as string, o.slug as string]));
    return rows.flatMap((r): Announcement[] => {
      let href: string | null = null;
      if (r.link_kind === "page" && isSiteTarget(r.link_page)) href = targetPath(r.link_page);
      if (r.link_kind === "offer" && r.link_offer_id) {
        const slug = offerSlug.get(r.link_offer_id);
        // Offer no longer active (or deleted): the announcement still shows, without a dead link.
        href = slug ? offerPath(slug) : null;
      }
      return [{ id: r.id, template: r.template, text: r.text, href, dismissible: r.dismissible }];
    });
  } catch {
    return [];
  }
}

export async function getServiceLinks(): Promise<ServiceLink[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag(TAGS.services, TAGS.videos, TAGS.albums);
  const sb = getPublicClient();
  if (!sb) return [];
  try {
    const { data, error } = await sb.from("service_links").select("service_id, kind, target_id, sort_order").order("sort_order", { ascending: true });
    if (error) return [];
    return parseRows(serviceLinkRow, data);
  } catch {
    return [];
  }
}

export async function getAlbumCategories(): Promise<AlbumCategory[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag(TAGS.albums);
  const sb = getPublicClient();
  if (!sb) return [];
  try {
    const { data, error } = await sb.from("album_categories").select("id, slug, title, sort_order").order("sort_order", { ascending: true });
    if (error) return [];
    return parseRows(albumCategoryRow, data);
  } catch {
    return [];
  }
}
