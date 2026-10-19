import { z } from "zod";

const HTTPS = /^https:\/\/[^\s<>"']+$/;
const opt = (max: number, msg: string) => z.string().trim().max(max, msg).nullable();

/** Album form: same limits as the photo_albums CHECK constraints (migration 0015). */
export const albumFormSchema = z.object({
  title: z.string().trim().min(2, "العنوان قصير جداً").max(160, "العنوان أطول من 160 حرفاً"),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]{1,79}$/, "المعرّف: أحرف إنجليزية صغيرة وأرقام و - (2–80)، يبدأ بحرف أو رقم"),
  description: opt(2000, "الوصف أطول من 2000 حرف"),
  event_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "تاريخ غير صالح")
    .nullable(),
  source_label: opt(120, "اسم المصدر أطول من 120 حرفاً"),
  source_url: z.string().trim().max(500, "الرابط طويل جداً").regex(HTTPS, "رابط المصدر يجب أن يبدأ بـ https://").nullable(),
  rights_note: opt(2000, "ملاحظة الحقوق أطول من 2000 حرف"),
  sort_order: z.coerce.number({ message: "الترتيب يجب أن يكون رقماً" }).int("الترتيب رقم صحيح").min(-1000).max(100000),
  category_id: z.string().uuid("تصنيف غير صالح").nullable(),
});
export type AlbumForm = z.infer<typeof albumFormSchema>;

export function readAlbumForm(fd: FormData) {
  const s = (k: string) => {
    const v = fd.get(k);
    return typeof v === "string" ? v.trim() : "";
  };
  return albumFormSchema.safeParse({
    title: s("title"),
    slug: s("slug"),
    description: s("description") || null,
    event_date: s("event_date") || null,
    source_label: s("source_label") || null,
    source_url: s("source_url") || null,
    rights_note: s("rights_note") || null,
    sort_order: s("sort_order") || "100",
    category_id: s("category_id") || null,
  });
}

const CATEGORY_SLUG = /^[a-z0-9][a-z0-9-]{1,59}$/;
export const categoryFormSchema = z.object({
  title: z.string().trim().min(2, "العنوان قصير جداً").max(80, "العنوان أطول من 80 حرفاً"),
  slug: z.string().trim().regex(CATEGORY_SLUG, "المعرّف: أحرف إنجليزية صغيرة وأرقام و - (2–60)"),
  sort_order: z.coerce.number({ message: "الترتيب يجب أن يكون رقماً" }).int().min(-1000).max(100000),
  is_published: z.boolean(),
});

export function readCategoryForm(fd: FormData) {
  const s = (k: string) => {
    const v = fd.get(k);
    return typeof v === "string" ? v.trim() : "";
  };
  return categoryFormSchema.safeParse({
    title: s("title"),
    slug: s("slug"),
    sort_order: s("sort_order") || "100",
    is_published: fd.get("is_published") === "on" || fd.get("is_published") === "1",
  });
}

export const altTextSchema = z.string().trim().max(300, "النص البديل أطول من 300 حرف");
