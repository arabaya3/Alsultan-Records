import type { MetadataRoute } from "next";
import { getPublishedAlbums, getVideoGallery } from "@/features/public-content/gallery-queries";
import { getPublishedProjects, getPublishedServices } from "@/features/public-content/queries";
import { siteUrl } from "@/features/public-content/site";

const STATIC_PATHS = ["/", "/work", "/services", "/about", "/contact", "/book", "/faq", "/privacy", "/terms"];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const [projects, services, gallery, albums] = await Promise.all([
    getPublishedProjects(),
    getPublishedServices(),
    getVideoGallery(),
    getPublishedAlbums(),
  ]);
  const entries: MetadataRoute.Sitemap = STATIC_PATHS.map((p) => ({ url: new URL(p, base).toString() }));
  if (projects.status === "ok") {
    for (const p of projects.data) entries.push({ url: new URL(`/work/${p.public_slug}`, base).toString() });
  }
  if (services.status === "ok") {
    for (const s of services.data) entries.push({ url: new URL(`/services/${s.slug}`, base).toString() });
  }
  if (gallery.status === "ok") {
    for (const v of gallery.data.videos) entries.push({ url: new URL(`/work/v/${v.youtube_id}`, base).toString() });
  }
  if (albums.status === "ok") {
    for (const a of albums.data) if (a.photoCount > 0) entries.push({ url: new URL(`/work/albums/${a.slug}`, base).toString() });
  }
  return entries;
}
