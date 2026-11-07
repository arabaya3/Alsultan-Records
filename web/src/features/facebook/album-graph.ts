import { callWithin, GRAPH_VERSION, REQUEST_TIMEOUT_MS, type Fetch } from "./graph";

/**
 * Graph calls for a Page photo ALBUM (docs read 2026-11-07, Graph API reference v27.0):
 *   - POST /{page-id}/albums {name, message}       → { id }   (kept, not deprecated: changelog 2020-02-03 «Corrections»)
 *   - POST /{album-id}/photos  multipart `source`  → { id, post_id }   (Album › Photos › Creating; < 10 MB, no animation)
 *   - GET  /{page-id}/albums?fields=id,name,link    (finds an album whose create response was lost)
 *   - GET  /{album-id}?fields=link
 * Same Page token and permissions as the reels (pages_manage_posts on a Page the person may CREATE_CONTENT on).
 * Never a multi-photo feed post in place of an album. The token is passed per call and never logged or returned.
 *
 * `base` is graph.facebook.com; tests point it at a local mock (only a localhost base is accepted, see graphBase).
 */
export type FbAlbum = { id: string; name?: string; link?: string };

/** Uploading a photo takes longer than a JSON call. */
export const PHOTO_TIMEOUT_MS = 25_000;

export function graphBase(env: Record<string, string | undefined> = process.env): string {
  const o = env.META_GRAPH_BASE;
  if (o && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(o)) return o;
  return "https://graph.facebook.com";
}

export function albumGraph(f: Fetch, token: string, base = graphBase(), version = GRAPH_VERSION) {
  const g = `${base}/${version}`;
  const q = (o: Record<string, string>) => new URLSearchParams({ ...o, access_token: token });
  return {
    createAlbum: (pageId: string, name: string, message: string | null) =>
      callWithin<{ id: string }>(f, `${g}/${pageId}/albums`, { method: "POST", body: q({ name, ...(message ? { message } : {}) }) }, REQUEST_TIMEOUT_MS),
    findAlbum: async (pageId: string, name: string): Promise<FbAlbum | null> => {
      const r = await callWithin<{ data?: FbAlbum[] }>(f, `${g}/${pageId}/albums?${q({ fields: "id,name,link", limit: "100" })}`, { method: "GET" }, REQUEST_TIMEOUT_MS);
      return (r.data ?? []).find((a) => a.name === name) ?? null;
    },
    albumLink: async (albumId: string): Promise<string | null> => {
      const r = await callWithin<{ link?: string }>(f, `${g}/${albumId}?${q({ fields: "link" })}`, { method: "GET" }, REQUEST_TIMEOUT_MS);
      return typeof r.link === "string" ? r.link : null;
    },
    addPhoto: (albumId: string, jpeg: Buffer, filename: string) => {
      const body = new FormData();
      body.set("access_token", token);
      body.set("source", new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" }), filename);
      return callWithin<{ id: string; post_id?: string }>(f, `${g}/${albumId}/photos`, { method: "POST", body }, PHOTO_TIMEOUT_MS);
    },
  };
}

export type AlbumGraph = ReturnType<typeof albumGraph>;
