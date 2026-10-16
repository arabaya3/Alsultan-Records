import { z } from "zod";
import { parseYouTubeId } from "@/lib/youtube";

export const VIDEO_CATEGORIES = ["wedding", "evening", "groom_prep", "folk", "engagement", "graduation", "festival", "dj", "other"] as const;
export type VideoCategory = (typeof VIDEO_CATEGORIES)[number];

export const VIDEO_CATEGORY_LABEL: Record<VideoCategory, string> = {
  wedding: "حفل زفاف",
  evening: "سهرة / تعليلة",
  groom_prep: "حمّام وزينة العريس",
  folk: "فلكلور شعبي",
  engagement: "خطوبة",
  graduation: "تخرّج",
  festival: "مهرجان",
  dj: "دي جي",
  other: "أخرى",
};

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
  title: z.string().trim().min(2, "العنوان قصير جداً (حرفان على الأقل)").max(120, "العنوان أطول من 120 حرفاً"),
  description: z.string().trim().max(500, "الوصف أطول من 500 حرف").nullable(),
  category: z.enum(VIDEO_CATEGORIES, { message: "اختر تصنيفاً صحيحاً" }),
  sort_order: z.coerce.number({ message: "الترتيب يجب أن يكون رقماً" }).int("الترتيب رقم صحيح").min(-1000).max(100000),
  is_published: z.boolean(),
  is_promo: z.boolean(),
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
    category: s("category"),
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
