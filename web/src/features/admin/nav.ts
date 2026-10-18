import type { AppRole } from "@/lib/permissions";

export type NavItem = { href: string; label: string; roles: AppRole[] };
/** collapsible: rendered as a closed disclosure unless it holds the current page. */
export type NavGroup = { title: string; items: NavItem[]; collapsible?: boolean };

const A: AppRole[] = ["owner", "admin"];
const S: AppRole[] = ["owner", "admin", "staff"];
const O: AppRole[] = ["owner"];

export const NAV: NavGroup[] = [
  { title: "اليوم", items: [{ href: "/admin", label: "نظرة عامة", roles: S }] },
  {
    title: "محتوى الموقع",
    items: [
      { href: "/admin/content", label: "كل المحتوى", roles: A },
      { href: "/admin/content/identity", label: "الهوية ومعلومات النشاط", roles: A },
      { href: "/admin/content/home", label: "الرئيسية", roles: A },
      { href: "/admin/content/services", label: "الخدمات", roles: A },
      { href: "/admin/content/process", label: "طريقة شغلنا", roles: A },
      { href: "/admin/content/packages", label: "البكجات", roles: A },
      { href: "/admin/content/offers", label: "العروض", roles: A },
      { href: "/admin/content/announcements", label: "الإعلانات", roles: A },
      { href: "/admin/videos", label: "الفيديوهات", roles: A },
      { href: "/admin/videos/categories", label: "تصنيفات الفيديو", roles: A },
      { href: "/admin/albums", label: "ألبومات الصور", roles: A },
      { href: "/admin/content/nav", label: "القائمة والأقسام", roles: A },
    ],
  },
  {
    title: "الإدارة التشغيلية",
    collapsible: true,
    items: [
      { href: "/admin/bookings", label: "طلبات الحجز", roles: A },
      { href: "/admin/customers", label: "العملاء", roles: A },
      { href: "/admin/calendar", label: "التقويم", roles: A },
      { href: "/admin/events", label: "المناسبات", roles: S },
      { href: "/admin/media", label: "الوسائط", roles: S },
      { href: "/admin/production", label: "الإنتاج والتسليم", roles: S },
      { href: "/admin/reviews", label: "التقييمات", roles: A },
      { href: "/admin/quotes", label: "عروض الأسعار", roles: A },
      { href: "/admin/contracts", label: "العقود", roles: A },
      { href: "/admin/finance", label: "المالية", roles: A },
      { href: "/admin/staff", label: "الطاقم", roles: A },
      { href: "/admin/equipment", label: "المعدات", roles: A },
      { href: "/admin/support", label: "الدعم", roles: A },
      { href: "/admin/users", label: "المستخدمون والصلاحيات", roles: O },
    ],
  },
  {
    title: "النظام",
    items: [
      { href: "/admin/settings", label: "الإعدادات", roles: A },
      { href: "/admin/backups", label: "النسخ الاحتياطي", roles: O },
    ],
  },
];

export function navFor(role: AppRole): NavGroup[] {
  return NAV.map((g) => ({ ...g, items: g.items.filter((i) => i.roles.includes(role)) })).filter((g) => g.items.length);
}
