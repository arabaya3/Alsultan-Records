import type { AlbumGraph } from "./album-graph";
import { PHOTO_TIMEOUT_MS } from "./album-graph";
import { GraphError } from "./graph";

/**
 * One run of «نشر على فيسبوك» for a site album (pure apart from the injected deps; see migration 0035).
 *   creating  → (look the album up by name if an earlier create may have reached Meta) → create → store its id
 *   uploading → each selected photo not yet on Facebook → saved one by one
 *   published → the album link is stored
 * Every step is saved before the next request, so a retry never creates a second album and never re-sends a photo
 * already recorded. The run stops before the platform time limit and the owner presses «متابعة».
 */
export type AlbumPost = {
  id: string;
  status: "creating" | "uploading" | "published" | "failed";
  page_id: string;
  title: string;
  message: string | null;
  photo_ids: string[];
  done: Record<string, string>;
  fb_album_id: string | null;
  fb_album_url: string | null;
  attempts: number;
};

export type AlbumPatch = Partial<Pick<AlbumPost, "status" | "done" | "fb_album_id" | "fb_album_url" | "attempts">> & {
  last_error?: string | null;
  published_at?: string;
};

export type AlbumDeps = {
  graph: AlbumGraph;
  /** The photo as JPEG (from its display web copy); null if it is gone or unreadable. */
  photoJpeg: (photoId: string) => Promise<Buffer | null>;
  save: (patch: AlbumPatch) => Promise<void>;
  clock?: () => number;
  /** Wall time this run may use (the server action's limit minus a margin). */
  budgetMs?: number;
};

export type RunResult = { status: AlbumPost["status"]; sent: number; remaining: number; error: string | null; url: string | null };

export function errorText(e: unknown): string {
  if (e instanceof GraphError) {
    if (e.authLost) return `فيسبوك رفض الصلاحية (رمز ${e.code ?? e.status}). أعد ربط الصفحة من الإعدادات.`;
    if (e.transient) return `فيسبوك لم يستجب الآن (رمز ${e.code ?? e.status}). اضغط «متابعة» بعد قليل.`;
    return `رفض فيسبوك الطلب (رمز ${e.code ?? e.status}): ${e.message}`.slice(0, 400);
  }
  return "تعذّر إكمال النشر. اضغط «متابعة» للمحاولة مجدداً.";
}

export async function runAlbumPost(post: AlbumPost, d: AlbumDeps): Promise<RunResult> {
  const clock = d.clock ?? Date.now;
  const started = clock();
  const budget = d.budgetMs ?? 50_000;
  const p = { ...post, done: { ...post.done } };
  const remaining = () => p.photo_ids.filter((id) => !p.done[id]).length;
  let sent = 0;
  try {
    if (p.status === "failed") p.status = p.fb_album_id ? "uploading" : "creating";
    if (p.status === "creating") {
      let albumId: string | null = null;
      // An earlier create may have reached Meta with its answer lost: adopt that album instead of making a second one.
      if (p.attempts > 0) albumId = (await d.graph.findAlbum(p.page_id, p.title))?.id ?? null;
      if (!albumId) {
        p.attempts += 1;
        await d.save({ attempts: p.attempts, status: "creating", last_error: null });
        albumId = (await d.graph.createAlbum(p.page_id, p.title, p.message)).id;
      }
      p.fb_album_id = albumId;
      p.status = "uploading";
      await d.save({ fb_album_id: albumId, status: "uploading", last_error: null });
    }
    if (p.status === "uploading") {
      for (const photoId of p.photo_ids) {
        if (p.done[photoId]) continue;
        if (clock() - started + PHOTO_TIMEOUT_MS > budget) break; // the next photo might not fit: «متابعة»
        const jpeg = await d.photoJpeg(photoId);
        if (!jpeg) throw new MissingPhoto();
        const r = await d.graph.addPhoto(p.fb_album_id!, jpeg, `${photoId}.jpg`);
        p.done[photoId] = r.id;
        sent++;
        await d.save({ done: p.done, last_error: null });
      }
      if (!remaining()) {
        const url = (await d.graph.albumLink(p.fb_album_id!).catch(() => null)) ?? `https://www.facebook.com/${p.fb_album_id}`;
        p.status = "published";
        p.fb_album_url = url;
        await d.save({ status: "published", fb_album_url: url, published_at: new Date(clock()).toISOString(), last_error: null });
      }
    }
    return { status: p.status, sent, remaining: remaining(), error: null, url: p.fb_album_url };
  } catch (e) {
    const msg = e instanceof MissingPhoto ? "صورة مختارة لم تعد متاحة (حُذفت أو لم تجهز). أزلها من الاختيار ثم تابع." : errorText(e);
    await d.save({ status: "failed", last_error: msg }).catch(() => {});
    return { status: "failed", sent, remaining: remaining(), error: msg, url: p.fb_album_url };
  }
}

class MissingPhoto extends Error {}
