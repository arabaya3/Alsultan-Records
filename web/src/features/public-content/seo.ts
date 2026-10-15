import type { Metadata } from "next";
import type { BusinessSettings, Project } from "./schema";
import { SITE_NAME_AR, siteUrl } from "./site";

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
      ...(image ? { images: [{ url: image }] } : {}),
    },
  };
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
    url: s.canonical_base_url ?? siteUrl(),
    logo: new URL("/brand/logo-main.webp", siteUrl()).toString(),
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
  if (p.cover) data.image = p.cover.kind === "image" ? p.cover.src : (p.cover.poster ?? undefined);
  return data;
}

export { safeHttp };
