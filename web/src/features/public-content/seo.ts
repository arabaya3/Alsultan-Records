import type { Metadata } from "next";
import type { GalleryVideo } from "./gallery-model";
import type { BusinessSettings, Project } from "./schema";
import { SITE_NAME_AR, siteUrl } from "./site";

/** Default share image: the studio logo (published brand asset). Pages with their own image override it. */
const DEFAULT_SHARE_IMAGE = { url: "/brand/logo-main.webp", width: 900, height: 748, alt: SITE_NAME_AR };

/** A meta description from editor text: one line, no list markers, cut at a word boundary (≈160 chars). */
export function metaDescription(text: string | null | undefined, fallback: string, max = 160): string {
  const clean = (text ?? "")
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return fallback;
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 20)).replace(/[\s،,.:;|—-]+$/, "")}…`;
}

export function pageMetadata({
  title,
  description,
  path,
  image,
}: {
  title?: string;
  description: string;
  path: string;
  image?: string | null;
}): Metadata {
  const url = new URL(path, siteUrl()).toString();
  return {
    ...(title ? { title } : {}),
    description,
    alternates: { canonical: url },
    openGraph: {
      title: title ? `${title} | ${SITE_NAME_AR}` : SITE_NAME_AR,
      description,
      url,
      locale: "ar_PS",
      siteName: SITE_NAME_AR,
      type: "website",
      // A page that sets openGraph replaces the layout's whole object, so the default image is repeated here.
      images: image ? [{ url: image }] : [DEFAULT_SHARE_IMAGE],
    },
    twitter: { card: image ? "summary_large_image" : "summary" },
  };
}

/** schema.org BreadcrumbList (absolute URLs). The last item is the current page. */
export function breadcrumbJsonLd(items: { name: string; path: string }[]): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: new URL(it.path, siteUrl()).toString() })),
  };
}

/** schema.org VideoObject for a published YouTube video, ONLY from stored fields: no date or duration is
 *  invented — uploadDate is the YouTube publish date when the admin data has it, otherwise the object is not
 *  emitted (uploadDate is required for video rich results). */
export function youTubeVideoJsonLd(v: Pick<GalleryVideo, "youtube_id" | "title" | "description" | "published_at" | "duration_seconds">): Record<string, unknown> | null {
  if (!v.published_at) return null;
  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: v.title,
    description: metaDescription(v.description, v.title, 500),
    thumbnailUrl: [`https://i.ytimg.com/vi/${v.youtube_id}/hqdefault.jpg`],
    uploadDate: v.published_at,
    embedUrl: `https://www.youtube.com/embed/${v.youtube_id}`,
    url: new URL(`/work/v/${v.youtube_id}`, siteUrl()).toString(),
    inLanguage: "ar",
    publisher: { "@type": "Organization", name: SITE_NAME_AR, logo: { "@type": "ImageObject", url: new URL("/brand/logo-main.webp", siteUrl()).toString() } },
  };
  if (v.duration_seconds && v.duration_seconds > 0) data.duration = `PT${Math.round(v.duration_seconds)}S`;
  return data;
}

function safeHttp(v: string | null): string | null {
  return v && /^https?:\/\//i.test(v) ? v : null;
}

/** LocalBusiness built ONLY from real business_settings fields; omits anything missing. */
export function localBusinessJsonLd(s: BusinessSettings): Record<string, unknown> {
  const sameAs = [safeHttp(s.instagram), safeHttp(s.facebook)].filter(Boolean);
  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: s.name ?? SITE_NAME_AR,
    // The site origin is the single source (NEXT_PUBLIC_SITE_URL), not a separately stored URL.
    url: siteUrl(),
    logo: new URL("/brand/logo-main.webp", siteUrl()).toString(),
    image: new URL("/brand/logo-main.webp", siteUrl()).toString(),
  };
  if (s.tagline) data.description = s.tagline;
  if (s.phone) data.telephone = s.phone;
  if (s.email) data.email = s.email;
  if (s.address) data.address = s.address;
  if (sameAs.length) data.sameAs = sameAs;
  return data;
}

export function projectJsonLd(p: Project): Record<string, unknown> {
  const data: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "CreativeWork",
    name: p.seo_title ?? p.title,
    url: new URL(`/work/${p.public_slug}`, siteUrl()).toString(),
    creator: { "@type": "Organization", name: SITE_NAME_AR },
  };
  if (p.seo_description ?? p.highlight) data.description = p.seo_description ?? p.highlight;
  if (p.event_date) data.dateCreated = p.event_date;
  const img = p.cover ? (p.cover.kind === "image" ? p.cover.src : p.cover.poster) : null;
  if (img) data.image = new URL(img, siteUrl()).toString(); // /m/... is same-origin; JSON-LD needs absolute
  return data;
}

export { safeHttp };
