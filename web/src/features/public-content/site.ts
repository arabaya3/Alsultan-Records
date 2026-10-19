export const SITE_NAME_AR = "ستوديو وتسجيلات السلطان";
export const SITE_NAME_EN = "Sultan Records";

/** Canonical origin. Uses NEXT_PUBLIC_SITE_URL; falls back to local dev origin. */
export function siteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (raw) {
    try {
      return new URL(raw).origin;
    } catch {
      /* fall through */
    }
  }
  return "http://localhost:3100";
}

export const isProduction = process.env.NODE_ENV === "production";

export const NAV_LINKS = [
  { href: "/work", label: "أعمالنا" },
  { href: "/services", label: "الخدمات" },
  { href: "/about", label: "من نحن" },
] as const;

/** Core offering shown in the hero service strip. Copy is editable. */
export const CORE_SERVICES = ["تصوير فوتوغرافي", "أفلام أعراس", "DJ"] as const;
