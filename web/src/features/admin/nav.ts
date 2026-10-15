import type { AppRole } from "@/lib/permissions";

export type NavItem = { href: string; label: string; roles: AppRole[] };
export type NavGroup = { title: string; items: NavItem[] };

const A: AppRole[] = ["owner", "admin"];
const S: AppRole[] = ["owner", "admin", "staff"];
const O: AppRole[] = ["owner"];

export const NAV: NavGroup[] = [
  { title: "اليوم", items: [{ href: "/admin", label: "نظرة عامة", roles: S }] },
  {
    title: "العملاء والحجوزات",
    items: [
      { href: "/admin/bookings", label: "طلبات الحجز", roles: A },
      { href: "/admin/customers", label: "العملاء", roles: A },
      { href: "/admin/calendar", label: "التقويم", roles: A },
    ],
  },
  {
    title: "المناسبات والإنتاج",
    items: [
      { href: "/admin/events", label: "المناسبات", roles: S },
      { href: "/admin/media", label: "الوسائط", roles: S },
      { href: "/admin/production", label: "الإنتاج والتسليم", roles: S },
      { href: "/admin/reviews", label: "التقييمات", roles: A },
    ],
  },
  {
    title: "المال والعقود",
    items: [
      { href: "/admin/quotes", label: "عروض الأسعار", roles: A },
      { href: "/admin/contracts", label: "العقود", roles: A },
      { href: "/admin/finance", label: "المالية", roles: A },
    ],
  },
  {
    title: "التشغيل",
    items: [
      { href: "/admin/staff", label: "الطاقم", roles: A },
      { href: "/admin/equipment", label: "المعدات", roles: A },
      { href: "/admin/support", label: "الدعم", roles: A },
    ],
  },
  {
    title: "الإدارة",
    items: [
      { href: "/admin/users", label: "المستخدمون والصلاحيات", roles: O },
      { href: "/admin/settings", label: "الإعدادات", roles: A },
      { href: "/admin/backups", label: "النسخ الاحتياطي", roles: O },
    ],
  },
];

export function navFor(role: AppRole): NavGroup[] {
  return NAV.map((g) => ({ ...g, items: g.items.filter((i) => i.roles.includes(role)) })).filter((g) => g.items.length);
}
