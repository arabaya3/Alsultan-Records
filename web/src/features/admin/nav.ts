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

/** module: shown only while that module is enabled (UX only — routes stay reachable).
 *  match: other path prefixes that mark this entry current (e.g. «الإعدادات» on its tab pages). */
export type NavItem = { href: string; label: string; roles: AppRole[]; module?: ModuleKey; match?: string[] };
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
];

/** Labels for the «الأقسام المفعّلة» settings card. */
export const MODULE_LABEL = Object.fromEntries(OPS.filter((i) => i.module).map((i) => [i.module, i.label])) as Record<ModuleKey, string>;

/** Settings: one sidebar entry; its pages are tabs inside (SettingsTabs), filtered by role like the menu. */
export const SETTINGS_TABS: NavItem[] = [
  { href: "/admin/content/identity", label: "هوية النشاط", roles: A },
  { href: "/admin/settings", label: "القائمة والأقسام", roles: A },
  { href: "/admin/account", label: "حسابي", roles: S },
  { href: "/admin/users", label: "المستخدمون والصلاحيات", roles: O },
  { href: "/admin/settings/facebook", label: "فيسبوك", roles: O },
  { href: "/admin/backups", label: "النسخ الاحتياطي", roles: O },
];
const SETTINGS_PATHS = SETTINGS_TABS.map((t) => t.href).filter((h) => h !== "/admin/settings");

/** The settings inner menu, in groups (the designs). Entries are filtered by SETTINGS_TABS roles. */
export const SETTINGS_GROUPS: { title: string; items: string[] }[] = [
  { title: "الموقع", items: ["/admin/content/identity", "/admin/settings"] },
  { title: "الحساب والأمان", items: ["/admin/account", "/admin/users"] },
  { title: "التكامل والبيانات", items: ["/admin/settings/facebook", "/admin/backups"] },
];

export const NAV: NavGroup[] = [
  { title: "الرئيسية", items: [{ href: "/admin", label: "نظرة عامة", roles: S }] },
  {
    title: "الموقع",
    items: [
      { href: "/admin/content/home", label: "الصفحة الرئيسية", roles: A, match: ["/admin/content/process"] },
      { href: "/admin/videos", label: "الفيديوهات", roles: A },
      { href: "/admin/albums", label: "ألبومات الموقع", roles: A },
      { href: "/admin/content/packages", label: "البكجات", roles: A },
      { href: "/admin/content/offers", label: "العروض", roles: A },
      { href: "/admin/content/announcements", label: "الإعلانات", roles: A },
      { href: "/admin/content/nav", label: "القائمة العلوية", roles: A },
    ],
  },
  // Shown open like the other groups (owner design); each entry still follows its module switch.
  { title: "الزبائن والمناسبات", items: OPS },
  {
    title: "الإعدادات",
    items: [
      { href: "/admin/settings", label: "الإعدادات", roles: A, match: SETTINGS_PATHS },
      // Staff have no settings page: their own account is their only setting.
      { href: "/admin/account", label: "حسابي وكلمة السر", roles: ["staff"] },
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
