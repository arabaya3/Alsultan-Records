/**
 * Allow-listed public destinations for owner-managed links (nav_items.target, announcements.link_page,
 * section actions). The database stores only the KEY; the path is decided here, so no URL from the
 * database is ever rendered. Admin and login are deliberately not targets.
 */
export const SITE_TARGETS = {
  home: { path: "/", label: "الرئيسية" },
  work: { path: "/work", label: "أعمالنا" },
  services: { path: "/services", label: "الخدمات" },
  packages: { path: "/packages", label: "البكجات" },
  offers: { path: "/offers", label: "العروض" },
  promos: { path: "/work?tab=promos", label: "البروموهات" },
  albums: { path: "/work?tab=photos", label: "الصور" },
  about: { path: "/about", label: "من نحن" },
  contact: { path: "/contact", label: "تواصل معنا" },
  book: { path: "/book", label: "احجز" },
  faq: { path: "/faq", label: "أسئلة شائعة" },
} as const;

export type SiteTarget = keyof typeof SITE_TARGETS;
export const SITE_TARGET_KEYS = Object.keys(SITE_TARGETS) as SiteTarget[];

export function isSiteTarget(v: unknown): v is SiteTarget {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(SITE_TARGETS, v);
}

export function targetPath(t: SiteTarget): string {
  return SITE_TARGETS[t].path;
}

export function targetLabel(t: SiteTarget, label?: string | null): string {
  const l = label?.trim();
  return l ? l.slice(0, 30) : SITE_TARGETS[t].label;
}

/** Default header nav when no nav_items rows exist (today's design). */
export const DEFAULT_HEADER_NAV: SiteTarget[] = ["work", "packages", "offers", "services", "about"];
/** Default footer «روابط مهمة» (today's design). */
export const DEFAULT_FOOTER_NAV: SiteTarget[] = ["work", "packages", "offers", "services", "about", "book"];

/** Offer slugs are lowercase latin (slug_redirects check). */
export const OFFER_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const offerPath = (slug: string) => `/offers/${slug}`;
export const packagePath = (slug: string) => `/packages#${slug}`;
