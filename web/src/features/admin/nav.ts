import type { AppRole } from "@/lib/permissions";

/** Operational sections the owner can switch on/off (app_settings.enabled_modules). */
export const MODULES = [
  "bookings",
  "customers",
  "calendar",
  "events",
  "media",
  "production",
  "reviews",
  "quotes",
  "contracts",
  "finance",
  "staff",
  "equipment",
  "support",
] as const;
export type ModuleKey = (typeof MODULES)[number];
export const DEFAULT_MODULES: ModuleKey[] = ["customers", "events", "calendar"];

/** module: shown only while that module is enabled (UX only — routes stay reachable). */
export type NavItem = { href: string; label: string; roles: AppRole[]; module?: ModuleKey };
/** collapsible: rendered as a closed disclosure unless it holds the current page. */
export type NavGroup = { title: string; items: NavItem[]; collapsible?: boolean };

const A: AppRole[] = ["owner", "admin"];
const S: AppRole[] = ["owner", "admin", "staff"];
const O: AppRole[] = ["owner"];

const OPS: NavItem[] = [
  { href: "/admin/bookings", label: "طلبات الحجز", roles: A, module: "bookings" },
  { href: "/admin/customers", label: "العملاء", roles: A, module: "customers" },
  { href: "/admin/calendar", label: "التقويم", roles: A, module: "calendar" },
  { href: "/admin/events", label: "المناسبات", roles: S, module: "events" },
  { href: "/admin/media", label: "الوسائط", roles: S, module: "media" },
  { href: "/admin/production", label: "الإنتاج والتسليم", roles: S, module: "production" },
  { href: "/admin/reviews", label: "التقييمات", roles: A, module: "reviews" },
  { href: "/admin/quotes", label: "عروض الأسعار", roles: A, module: "quotes" },
  { href: "/admin/contracts", label: "العقود", roles: A, module: "contracts" },
  { href: "/admin/finance", label: "المالية", roles: A, module: "finance" },
  { href: "/admin/staff", label: "الطاقم", roles: A, module: "staff" },
  { href: "/admin/equipment", label: "المعدات", roles: A, module: "equipment" },
  { href: "/admin/support", label: "الدعم", roles: A, module: "support" },
  { href: "/admin/users", label: "المستخدمون والصلاحيات", roles: O },
];

/** Labels for the «الأقسام المفعّلة» settings card. */
export const MODULE_LABEL = Object.fromEntries(OPS.filter((i) => i.module).map((i) => [i.module, i.label])) as Record<ModuleKey, string>;

export const NAV: NavGroup[] = [
  { title: "اليوم", items: [{ href: "/admin", label: "نظرة عامة", roles: S }] },
  {
    title: "الأعمال",
    items: [
      { href: "/admin/videos", label: "الفيديوهات", roles: A },
      { href: "/admin/albums", label: "ألبومات الصور", roles: A },
    ],
  },
  {
    title: "البيع",
    items: [
      { href: "/admin/content/packages", label: "البكجات", roles: A },
      { href: "/admin/content/offers", label: "العروض والإعلانات", roles: A },
    ],
  },
  {
    title: "صفحات الموقع",
    items: [
      { href: "/admin/content/home", label: "الرئيسية", roles: A },
      { href: "/admin/content/services", label: "الخدمات وطريقة الشغل", roles: A },
    ],
  },
  { title: "شغل المناسبات", collapsible: true, items: OPS },
  {
    title: "الإعدادات",
    items: [
      { href: "/admin/content/identity", label: "الهوية ومعلومات النشاط", roles: A },
      { href: "/admin/content/nav", label: "القائمة والأقسام", roles: A },
      { href: "/admin/account", label: "حسابي وكلمة السر", roles: S },
      { href: "/admin/settings", label: "إعدادات اللوحة", roles: A },
      { href: "/admin/backups", label: "النسخ الاحتياطي", roles: O },
    ],
  },
];

/** Role filter (unchanged rules) + enabled-module filter for operational items. */
export function navFor(role: AppRole, enabled: readonly string[] = DEFAULT_MODULES): NavGroup[] {
  return NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => i.roles.includes(role) && (!i.module || enabled.includes(i.module))),
  })).filter((g) => g.items.length);
}
