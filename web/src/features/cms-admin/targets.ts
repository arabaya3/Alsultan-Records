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
  services: "كيف نوثّق مناسبتكم",
  offers: "العروض",
  promos: "البرومو",
  albums: "ألبومات الصور",
  process: "طريقة شغلنا",
  about: "من نحن",
  contact: "تواصل معنا",
  stats: "عدّاد الحفلات",
};
/** Which entity a section's featured_ids point at (null = no featured picker). */
export const SECTION_FEATURE: Record<SectionKey, "video" | "offer" | "album" | null> = {
  works: "video",
  services: null, // the poster columns are fixed; there is no services table to pick from
  offers: "offer",
  promos: "video",
  albums: "album",
  process: null,
  about: null,
  contact: null,
  stats: null,
};

/**
 * Which saved fields the home page really uses for each section (the poster layout). A field that is `false` is shown
 * disabled in the admin with a reason, and its stored value is sent back unchanged — never an editable field that does
 * nothing. Visibility and order apply to every section.
 */
export const SECTION_FIELDS: Record<SectionKey, { title: boolean; intro: boolean; limit: boolean; featured: boolean; why?: string }> = {
  works: { title: true, intro: true, limit: true, featured: true },
  offers: { title: true, intro: true, limit: true, featured: true },
  promos: { title: true, intro: true, limit: true, featured: true },
  albums: { title: true, intro: true, limit: true, featured: true }, // picks are stored but never mixed in (owner rule; the card says so)
  process: { title: true, intro: true, limit: true, featured: false },
  stats: { title: true, intro: true, limit: false, featured: false },
  about: { title: true, intro: true, limit: false, featured: false, why: "قسم «من نحن» نص واحد: لا يوجد عدد عناصر." },
  services: { title: true, intro: true, limit: false, featured: false, why: "تصميم الرئيسية يعرض عمودين ثابتين (تصوير فوتوغرافي وتصوير فيديو)، فلا ينطبق عدد العناصر ولا العناصر المميزة هنا." },
  contact: { title: false, intro: false, limit: false, featured: false, why: "شريط التواصل يعرض الموقع والهاتف وزر واتساب من إعدادات الهوية بدون عنوان أو نص. يمكنك إظهاره أو إخفاؤه وترتيبه فقط." },
};
