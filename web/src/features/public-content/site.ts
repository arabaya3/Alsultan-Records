export const SITE_NAME_AR = "ستوديو وتسجيلات السلطان";
export const SITE_NAME_EN = "Sultan Records";

/** Canonical origin — the single source for canonical, Open Graph, sitemap and JSON-LD URLs.
 *  NEXT_PUBLIC_SITE_URL first; on Vercel without it, the project's production domain (never a preview URL);
 *  local dev origin last. */
export function siteUrl(): string {
  for (const raw of [process.env.NEXT_PUBLIC_SITE_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`]) {
    const v = raw?.trim();
    if (!v) continue;
    try {
      return new URL(v).origin;
    } catch {
      /* next candidate */
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
