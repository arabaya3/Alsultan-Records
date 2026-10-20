import { SITE_TARGETS, SITE_TARGET_KEYS, type SiteTarget } from "@/lib/site-targets";

/** Internal link allow-list (owned by the public agent in @/lib/site-targets). Admin stores keys only. */
export const PAGE_TARGETS = SITE_TARGET_KEYS as unknown as readonly [SiteTarget, ...SiteTarget[]];
export type PageTarget = SiteTarget;
export const PAGE_TARGET_LABEL = Object.fromEntries(SITE_TARGET_KEYS.map((k) => [k, SITE_TARGETS[k].label])) as Record<SiteTarget, string>;
export const PAGE_TARGET_PATH = (k: SiteTarget) => SITE_TARGETS[k].path;

export const SECTION_KEYS = ["works", "services", "offers", "promos", "albums", "process", "about", "contact", "stats"] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];
export const SECTION_LABEL: Record<SectionKey, string> = {
  works: "أعمالنا (الفيديوهات)",
  services: "الخدمات",
  offers: "العروض",
  promos: "البرومو",
  albums: "ألبومات الصور",
  process: "طريقة شغلنا",
  about: "من نحن",
  contact: "تواصل معنا",
  stats: "عدّاد الحفلات",
};
/** Which entity a section's featured_ids point at (null = no featured picker). */
export const SECTION_FEATURE: Record<SectionKey, "video" | "service" | "offer" | "album" | null> = {
  works: "video",
  services: "service",
  offers: "offer",
  promos: "video",
  albums: "album",
  process: null,
  about: null,
  contact: null,
  stats: null,
};
