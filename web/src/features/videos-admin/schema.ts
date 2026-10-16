import { z } from "zod";
import { parseYouTubeId } from "@/lib/youtube";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Admin video form. The pasted value must be a bare 11-char ID or a YouTube URL accepted by
 * parseYouTubeId; anything else (HTML, iframe, other hosts) is rejected. Only the ID is kept.
 */
export const videoFormSchema = z.object({
  youtube_id: z
    .string()
    .max(500, "الرابط طويل جداً")
    .transform((v, ctx) => {
      const id = parseYouTubeId(v);
      if (!id) {
        ctx.addIssue({ code: "custom", message: "ألصق رابط فيديو يوتيوب أو معرّفه (11 حرفاً) فقط." });
        return z.NEVER;
      }
      return id;
    }),
  title: z.string().trim().min(2, "العنوان قصير جداً (حرفان على الأقل)").max(200, "العنوان أطول من 200 حرف"),
  description: z.string().trim().max(500, "الوصف أطول من 500 حرف").nullable(),
  category_ids: z.array(z.string().regex(UUID, "تصنيف غير صالح")).max(20, "تصنيفات كثيرة"),
  primary_category: z.string().regex(UUID, "تصنيف رئيسي غير صالح").nullable(),
  needs_review: z.boolean(),
  review_note: z.string().trim().max(2000, "ملاحظة المراجعة أطول من 2000 حرف").nullable(),
  sort_order: z.coerce.number({ message: "الترتيب يجب أن يكون رقماً" }).int("الترتيب رقم صحيح").min(-1000).max(100000),
  is_published: z.boolean(),
  is_promo: z.boolean(),
}).refine((v) => v.primary_category === null || v.category_ids.includes(v.primary_category), {
  message: "التصنيف الرئيسي يجب أن يكون من التصنيفات المختارة.",
  path: ["primary_category"],
});
export type VideoForm = z.infer<typeof videoFormSchema>;

export function readVideoForm(fd: FormData) {
  const s = (k: string) => {
    const v = fd.get(k);
    return typeof v === "string" ? v.trim() : "";
  };
  return videoFormSchema.safeParse({
    youtube_id: s("youtube"),
    title: s("title"),
    description: s("description") || null,
    category_ids: Array.from(new Set(fd.getAll("category_ids").map(String))),
    primary_category: s("primary_category") || null,
    needs_review: fd.get("needs_review") === "on",
    review_note: s("review_note") || null,
    sort_order: s("sort_order") || "100",
    is_published: fd.get("is_published") === "on",
    is_promo: fd.get("is_promo") === "on",
  });
}

const YT_URL = /^https:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\/[^\s<>"']*$/;
const WA_URL = /^https:\/\/(wa\.me|api\.whatsapp\.com)\/[^\s<>"']*$/;
/** Same rules as the business_settings CHECK constraints (migration 0013). */
export const youtubeChannelUrl = z.string().max(300).regex(YT_URL, "رابط يوتيوب غير صالح (https://www.youtube.com/…)").nullable();
export const whatsappLinkUrl = z.string().max(300).regex(WA_URL, "رابط واتساب غير صالح (https://wa.me/…)").nullable();

/** Video category (admin): slug ^[a-z0-9_]{2,30}$ like the DB CHECK. */
export const categoryFormSchema = z.object({
  slug: z.string().trim().regex(/^[a-z0-9_]{2,30}$/, "المعرّف: أحرف إنجليزية صغيرة وأرقام و _ (2–30)"),
  title: z.string().trim().min(2, "الاسم قصير جداً").max(60, "الاسم أطول من 60 حرفاً"),
  sort_order: z.coerce.number({ message: "الترتيب يجب أن يكون رقماً" }).int("الترتيب رقم صحيح").min(-1000).max(100000),
  is_published: z.boolean(),
});

export function readCategoryForm(fd: FormData) {
  const s = (k: string) => {
    const v = fd.get(k);
    return typeof v === "string" ? v.trim() : "";
  };
  return categoryFormSchema.safeParse({
    slug: s("slug"),
    title: s("title"),
    sort_order: s("sort_order") || "100",
    is_published: fd.get("is_published") === "on",
  });
}
