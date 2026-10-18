/**
 * Pure CMS model (no I/O): Zod row schemas for the owner-managed content of docs/cms-contract.md and
 * the defaults that keep today's site rendering when a table/row/column does not exist yet.
 * Everything here is plain text; nothing is ever rendered as HTML.
 */
import { z } from "zod";
import { isSiteTarget, OFFER_SLUG, SITE_TARGETS, targetLabel, targetPath, type SiteTarget } from "@/lib/site-targets";

const text = (max: number) =>
  z
    .string()
    .nullable()
    .optional()
    .transform((v) => {
      const t = v?.trim();
      return t ? t.slice(0, max) : null;
    });
const bool = (d: boolean) => z.boolean().nullable().optional().transform((v) => v ?? d);
const num = (d: number) => z.number().nullable().optional().transform((v) => v ?? d);
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const optUuid = uuid.nullable().optional().catch(null).transform((v) => v ?? null);
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}/)
  .nullable()
  .optional()
  .catch(null)
  .transform((v) => (v ? v.slice(0, 10) : null));

/* ---------------- nav ---------------- */
export const navItemRow = z.object({
  id: z.string(),
  label: text(30),
  target: z.string(),
  sort_order: num(0),
  is_visible: bool(true),
});
export type NavLink = { key: string; target: SiteTarget; href: string; label: string };

export function toNavLinks(rows: z.infer<typeof navItemRow>[]): NavLink[] {
  const seen = new Set<string>();
  return rows
    .filter((r) => r.is_visible && isSiteTarget(r.target))
    .sort((a, b) => a.sort_order - b.sort_order)
    .flatMap((r) => {
      const t = r.target as SiteTarget;
      if (seen.has(t)) return [];
      seen.add(t);
      return [{ key: r.id, target: t, href: targetPath(t), label: targetLabel(t, r.label) }];
    });
}
export const defaultNav = (targets: SiteTarget[]): NavLink[] =>
  targets.map((t) => ({ key: t, target: t, href: SITE_TARGETS[t].path, label: SITE_TARGETS[t].label }));

/* ---------------- home sections ---------------- */
export const SECTION_KEYS = ["works", "services", "offers", "promos", "albums", "process", "about", "contact"] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export const siteSectionRow = z.object({
  key: z.enum(SECTION_KEYS),
  title: text(120),
  intro: text(600),
  is_visible: bool(true),
  sort_order: num(0),
  item_limit: z.number().int().min(1).max(12).nullable().optional().catch(null).transform((v) => v ?? 6),
  featured_ids: z.array(z.string()).nullable().optional().catch(null).transform((v) => (v ?? []).filter((x) => uuid.safeParse(x).success)),
});
export type SectionConfig = {
  key: SectionKey;
  title: string;
  intro: string | null;
  visible: boolean;
  limit: number;
  featured: string[];
};

export const SECTION_DEFAULTS: Record<SectionKey, { title: string; visible: boolean }> = {
  works: { title: "من أعمالنا", visible: true },
  services: { title: "الخدمات", visible: true },
  offers: { title: "العروض", visible: true },
  promos: { title: "البروموهات", visible: false },
  albums: { title: "ألبومات الصور", visible: false },
  process: { title: "كيف نشتغل", visible: true },
  about: { title: "من نحن", visible: false },
  contact: { title: "تواصل معنا", visible: false },
};
/** Today's home order. Offers render only when at least one offer is active. */
const DEFAULT_ORDER: SectionKey[] = ["works", "services", "offers", "process", "promos", "albums", "about", "contact"];

export function resolveSections(rows: z.infer<typeof siteSectionRow>[] | null): SectionConfig[] {
  const byKey = new Map((rows ?? []).map((r) => [r.key, r]));
  const base = DEFAULT_ORDER.map((key, i) => {
    const r = byKey.get(key);
    return {
      order: r ? r.sort_order : 10_000 + i,
      cfg: {
        key,
        title: r?.title ?? SECTION_DEFAULTS[key].title,
        intro: r?.intro ?? null,
        visible: r ? r.is_visible : SECTION_DEFAULTS[key].visible,
        limit: r?.item_limit ?? 6,
        featured: r?.featured_ids ?? [],
      } satisfies SectionConfig,
    };
  });
  return base.sort((a, b) => a.order - b.order).map((x) => x.cfg);
}

/* ---------------- process steps ---------------- */
export const processStepRow = z.object({
  id: z.string(),
  title: z.string().min(1).transform((v) => v.slice(0, 80)),
  description: text(300),
  photo_id: optUuid,
  sort_order: num(0),
});
export type ProcessStep = { key: string; title: string; body: string | null; photoId: string | null };

/* ---------------- offers ---------------- */
export const offerRow = z.object({
  id: z.string(),
  slug: z.string().regex(OFFER_SLUG),
  title: z.string().min(1).transform((v) => v.slice(0, 120)),
  description: text(600),
  image_photo_id: optUuid,
  /** Anon reads display_price_minor (= price_minor only when show_price). */
  display_price_minor: z.union([z.number(), z.string()]).nullable().optional().catch(null).transform((v) => {
    const n = v == null ? NaN : Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }),
  currency: z.string().regex(/^[A-Z]{3}$/).nullable().optional().catch(null).transform((v) => v ?? "ILS"),
  show_price: bool(false),
  starts_on: isoDate,
  ends_on: isoDate,
  terms: text(2000),
  whatsapp_message: text(600),
  status: z.string().nullable().optional(),
  pinned_home: bool(false),
  sort_order: num(0),
  /** The month the offer is FOR (owner-set). Ordering never reads the title. */
  target_month: z.union([z.number(), z.string()]).nullable().optional().catch(null).transform((v) => {
    const n = v == null ? NaN : Number(v);
    return Number.isInteger(n) && n >= 1 && n <= 12 ? n : null;
  }),
  target_year: z.union([z.number(), z.string()]).nullable().optional().catch(null).transform((v) => {
    const n = v == null ? NaN : Number(v);
    return Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : null;
  }),
  package_id: optUuid,
});
export type OfferRow = z.infer<typeof offerRow>;
export const offerItemRow = z.object({ offer_id: z.string(), label: z.string().min(1).transform((v) => v.slice(0, 120)), sort_order: num(0) });
export type Offer = OfferRow & { items: string[] };

/** Today's date in Asia/Hebron as YYYY-MM-DD (same rule as app.hebron_today()). */
export function hebronToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hebron", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Active = published and today within [starts_on, ends_on] (inclusive). RLS applies the same rule; this is defence in depth. */
export function isOfferActive(o: Pick<OfferRow, "status" | "starts_on" | "ends_on">, today: string = hebronToday()): boolean {
  if (o.status != null && o.status !== "published") return false;
  if (o.starts_on && o.starts_on > today) return false;
  if (o.ends_on && o.ends_on < today) return false;
  return true;
}

/**
 * Period an offer targets, as a sortable month number (year*12 + month-1): the owner's target month/year,
 * otherwise the month of starts_on, otherwise null. The title is never parsed.
 */
export function offerPeriodKey(o: Pick<OfferRow, "target_month" | "target_year" | "starts_on">): number | null {
  if (o.target_year != null && o.target_month != null) return o.target_year * 12 + (o.target_month - 1);
  const m = o.starts_on ? /^(\d{4})-(\d{2})/.exec(o.starts_on) : null;
  return m ? Number(m[1]) * 12 + (Number(m[2]) - 1) : null;
}

/**
 * Offer order (public /offers, home section):
 *  1. pinned first, in the owner's order (sort_order);
 *  2. then the newest target period first (October 2026 above September 2026; 2027 above 2026);
 *  3. offers with no period after those with one; ties by the owner's sort_order.
 */
export function sortOffers<T extends Pick<OfferRow, "pinned_home" | "sort_order"> & Partial<Pick<OfferRow, "target_month" | "target_year" | "starts_on">>>(list: T[]): T[] {
  const key = (o: T) => offerPeriodKey({ target_month: o.target_month ?? null, target_year: o.target_year ?? null, starts_on: o.starts_on ?? null });
  return [...list].sort((a, b) => {
    if (a.pinned_home !== b.pinned_home) return a.pinned_home ? -1 : 1;
    if (a.pinned_home) return a.sort_order - b.sort_order;
    const ka = key(a);
    const kb = key(b);
    if (ka !== kb) return ka == null ? 1 : kb == null ? -1 : kb - ka;
    return a.sort_order - b.sort_order;
  });
}

const AR_MONTHS = ["كانون الثاني", "شباط", "آذار", "نيسان", "أيار", "حزيران", "تموز", "آب", "أيلول", "تشرين الأول", "تشرين الثاني", "كانون الأول"];
export const monthLabelAr = (m: number) => AR_MONTHS[m - 1] ?? "";
export function offerPeriodLabel(o: Pick<OfferRow, "target_month" | "target_year">): string | null {
  return o.target_month && o.target_year ? `${monthLabelAr(o.target_month)} ${o.target_year}` : null;
}

/** Price only when the owner chose to show it. */
export function offerPriceLabel(o: Pick<OfferRow, "show_price" | "display_price_minor" | "currency">): string | null {
  if (!o.show_price || o.display_price_minor == null) return null;
  const major = o.display_price_minor / 100;
  try {
    return new Intl.NumberFormat("ar-PS", { style: "currency", currency: o.currency, maximumFractionDigits: major % 1 ? 2 : 0 }).format(major);
  } catch {
    return `${major} ${o.currency}`;
  }
}

/** "حتى ١٥ تشرين الثاني ٢٠٢٦" etc. Dates are calendar dates (no timezone shift). */
export function formatDayAr(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("ar-PS", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}
export function offerDatesLabel(o: Pick<OfferRow, "starts_on" | "ends_on">): string | null {
  if (o.starts_on && o.ends_on) return `من ${formatDayAr(o.starts_on)} حتى ${formatDayAr(o.ends_on)}`;
  if (o.ends_on) return `حتى ${formatDayAr(o.ends_on)}`;
  if (o.starts_on) return `ابتداءً من ${formatDayAr(o.starts_on)}`;
  return null;
}
export const offerWhatsappText = (o: Pick<OfferRow, "title" | "whatsapp_message">) =>
  o.whatsapp_message ?? `مرحباً، بدي أستفسر عن عرض: ${o.title}`;

/* ---------------- packages ---------------- */
export const packageRow = z.object({
  id: z.string(),
  slug: z.string().regex(OFFER_SLUG),
  title: z.string().min(1).transform((v) => v.slice(0, 120)),
  description: text(1000),
  image_photo_id: optUuid,
  display_price_minor: z.union([z.number(), z.string()]).nullable().optional().catch(null).transform((v) => {
    const n = v == null ? NaN : Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }),
  currency: z.string().regex(/^[A-Z]{3}$/).nullable().optional().catch(null).transform((v) => v ?? "ILS"),
  show_price: bool(false),
  whatsapp_message: text(600),
  featured: bool(false),
  sort_order: num(0),
});
export type PackageRow = z.infer<typeof packageRow>;
export const packageItemRow = z.object({ package_id: z.string(), label: z.string().min(1).transform((v) => v.slice(0, 120)), sort_order: num(0) });
export type Package = PackageRow & { items: string[] };
export const sortPackages = <T extends Pick<PackageRow, "sort_order">>(list: T[]): T[] => [...list].sort((a, b) => a.sort_order - b.sort_order);
/** WhatsApp text always names the package (owner may write their own message). */
export const packageWhatsappText = (p: Pick<PackageRow, "title" | "whatsapp_message">) =>
  p.whatsapp_message ?? `مرحباً، بدي أستفسر عن بكج: ${p.title}`;

/* ---------------- announcements ---------------- */
export const announcementRow = z.object({
  id: z.string(),
  template: z.enum(["bar", "banner"]).catch("bar"),
  text: z.string().min(1).transform((v) => v.trim().slice(0, 140)),
  link_kind: z.enum(["none", "offer", "page"]).catch("none"),
  link_offer_id: optUuid,
  link_page: z.string().nullable().optional(),
  starts_on: isoDate,
  ends_on: isoDate,
  is_visible: bool(true),
  dismissible: bool(true),
  sort_order: num(0),
});
export type Announcement = {
  id: string;
  template: "bar" | "banner";
  text: string;
  href: string | null;
  dismissible: boolean;
};

/* ---------------- services ---------------- */
export const serviceLinkRow = z.object({
  service_id: z.string(),
  kind: z.enum(["video", "album"]),
  target_id: z.string(),
  sort_order: num(0),
});
export type ServiceLink = z.infer<typeof serviceLinkRow>;

/* ---------------- albums ---------------- */
export const albumCategoryRow = z.object({
  id: z.string(),
  slug: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/),
  title: z.string().min(1),
  sort_order: num(0),
});
export type AlbumCategory = z.infer<typeof albumCategoryRow>;
