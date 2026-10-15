import type { MetadataRoute } from "next";
import { getPublishedProjects, getPublishedServices } from "@/features/public-content/queries";
import { siteUrl } from "@/features/public-content/site";

const STATIC_PATHS = ["/", "/work", "/services", "/about", "/contact", "/book", "/faq", "/privacy", "/terms"];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const [projects, services] = await Promise.all([getPublishedProjects(), getPublishedServices()]);
  const entries: MetadataRoute.Sitemap = STATIC_PATHS.map((p) => ({ url: new URL(p, base).toString() }));
  if (projects.status === "ok") {
    for (const p of projects.data) entries.push({ url: new URL(`/work/${p.public_slug}`, base).toString() });
  }
  if (services.status === "ok") {
    for (const s of services.data) entries.push({ url: new URL(`/services/${s.slug}`, base).toString() });
  }
  return entries;
}
