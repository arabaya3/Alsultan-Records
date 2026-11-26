import { SLUG } from "@/features/public-content/gallery-model";
import { getAlbumBySlug, getPublishedAlbums } from "@/features/public-content/gallery-queries";

/**
 * GET /api/hero-slides — what the home hero slideshow plays, read through the same cached public queries as the album
 * pages (anon RLS: published albums and their visible photos only; every image still goes through /p, which re-checks
 * publication on each request).
 *   no params        → { albums: [{ slug, title }] } newest published first, albums with at least one photo;
 *   ?album=<slug>    → { ids: [...] } that album's photo ids in album order (fetched one album at a time, so a large
 *                       album never rides along with the page).
 * Short browser cache only; the slideshow asks for the album list again at the start of each round, so a newly
 * published album joins the next round.
 */
const HEADERS = { "Cache-Control": "public, max-age=60" };

export async function GET(req: Request): Promise<Response> {
  const album = new URL(req.url).searchParams.get("album");
  if (album !== null) {
    if (!SLUG.test(album)) return Response.json({ ids: [] }, { status: 400, headers: HEADERS });
    const res = await getAlbumBySlug(album);
    const ids = res.status === "ok" && res.data ? res.data.photos.map((p) => p.id) : [];
    return Response.json({ ids }, { headers: HEADERS });
  }
  const res = await getPublishedAlbums();
  const albums = res.status === "ok" ? res.data.filter((a) => a.photoCount > 0).map((a) => ({ slug: a.slug, title: a.title })) : [];
  return Response.json({ albums }, { headers: HEADERS });
}
