"use server";

import { signMediaUrls } from "@/features/media/sign";
import { customerForAction, isUuid, MSG, type ActionResult } from "@/features/portal/session";
import { fetchGalleryPage, type GalleryPage } from "./data";

export async function loadGalleryPage(
  eventId: string,
  offset: number,
  selectedOnly: boolean,
): Promise<ActionResult<GalleryPage>> {
  const ctx = await customerForAction();
  if (!ctx) return { ok: false, error: MSG.auth, code: "auth" };
  if (!isUuid(eventId) || !Number.isFinite(offset)) return { ok: false, error: MSG.forbidden, code: "invalid" };
  const page = await fetchGalleryPage(ctx.supabase, eventId, offset, Boolean(selectedOnly));
  if (!page) return { ok: false, error: "تعذّر تحميل الصور الآن.", code: "unavailable" };
  return { ok: true, data: page };
}

/** Fresh signed URLs (display or thumb) for the lightbox / expired tiles. */
export async function signGalleryUrls(
  assetIds: string[],
  variant: "thumb" | "display",
): Promise<ActionResult<{ id: string; url: string | null; expiresAt: number | null }[]>> {
  const ctx = await customerForAction();
  if (!ctx) return { ok: false, error: MSG.auth, code: "auth" };
  const ids = (Array.isArray(assetIds) ? assetIds : []).filter(isUuid).slice(0, 60);
  const res = await signMediaUrls({ assetIds: ids, variant: variant === "thumb" ? "thumb" : "display", ttlSeconds: 600 });
  return { ok: true, data: res.map((r) => ({ id: r.key, url: r.url, expiresAt: r.expiresAt })) };
}
