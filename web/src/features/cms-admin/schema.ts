import { z } from "zod";
import { PAGE_TARGETS, SECTION_KEYS } from "./targets";
import { LONG_TEXT } from "@/lib/text-limits";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TAG = /<\s*\/?\s*[a-z!][^>]*>/i;
const CONTROL = /[\u0000-\u0009\u000B-\u001F\u007F]/g;

/** Plain text: trimmed, length-capped, no HTML tags, no control chars except newlines. */
export const text = (max: number, label = "النص") =>
  z
    .string()
    .trim()
    .max(max, `${label} أطول من ${max} حرف`)
    .refine((v) => !TAG.test(v), `${label}: نص عادي فقط بدون وسوم HTML`)
    .transform((v) => v.replace(CONTROL, ""));
export const reqText = (max: number, label: string, min = 1) =>
  text(max, label).refine((v) => v.length >= min, min > 1 ? `${label} قصير جداً` : `${label} مطلوب`);
export const optText = (max: number, label?: string) => text(max, label).transform((v) => (v === "" ? null : v));

export const optUuid = z
  .string()
  .trim()
  .transform((v, ctx) => {
    if (v === "") return null;
    if (!UUID.test(v)) {
      ctx.addIssue({ code: "custom", message: "اختيار غير صالح" });
      return z.NEVER;
    }
    return v;
  });
export const uuidList = z.array(z.string().regex(UUID, "اختيار غير صالح")).max(50);
export const optDate = z
  .string()
  .trim()
  .transform((v, ctx) => {
    if (v === "") return null;
    if (!DATE.test(v) || Number.isNaN(Date.parse(v))) {
      ctx.addIssue({ code: "custom", message: "تاريخ غير صالح" });
      return z.NEVER;
    }
    return v;
  });
/** Optional whole number in [min, max]; "" → null. */
export const optInt = (min: number, max: number, label: string) =>
  z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (v === "") return null;
      const n = Number(v);
      if (!Number.isInteger(n) || n < min || n > max) {
        ctx.addIssue({ code: "custom", message: `${label} غير صالح` });
        return z.NEVER;
      }
      return n;
    });
export const defaultPackageMessage = (title: string) => `مرحباً، بدي أستفسر عن بكج: ${title}`;

export const slug = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, "الرابط المختصر قصير")
  .max(60, "الرابط المختصر أطول من 60 حرفاً")
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "الرابط المختصر: أحرف إنجليزية صغيرة وأرقام وشرطة (-) فقط");

/** https-only URL on an allowed host; null when empty. */
export const socialUrl = (hosts: RegExp, label: string) =>
  z
    .string()
    .trim()
    .max(300, `${label} طويل جداً`)
    .transform((v, ctx) => {
      if (v === "") return null;
      let u: URL;
      try {
        u = new URL(v);
      } catch {
        ctx.addIssue({ code: "custom", message: `${label}: رابط غير صالح` });
        return z.NEVER;
      }
      if (u.protocol !== "https:" || !hosts.test(u.hostname) || u.username || u.password) {
        ctx.addIssue({ code: "custom", message: `${label}: يجب أن يبدأ بـ https:// ويكون على الموقع الصحيح` });
        return z.NEVER;
      }
      return u.toString();
    });
const FB = /^(www\.|m\.|web\.)?(facebook\.com|fb\.com|fb\.me)$/i;
const YT = /^(www\.|m\.)?(youtube\.com|youtu\.be)$/i;
const IG = /^(www\.)?instagram\.com$/i;
const WA = /^(wa\.me|api\.whatsapp\.com)$/i;
const phone = z
  .string()
  .trim()
  .max(32, "الرقم طويل جداً")
  .regex(/^[+\d\s()-]*$/, "رقم غير صالح (أرقام و + فقط)")
  .transform((v) => (v === "" ? null : v));

export const identitySchema = z.object({
  name: reqText(200, "اسم النشاط"),
  tagline: optText(300, "الشعار"),
  phone,
  whatsapp: phone,
  whatsapp_url: socialUrl(WA, "رابط واتساب"),
  address: optText(300, "العنوان"),
  facebook: socialUrl(FB, "رابط فيسبوك"),
  youtube_url: socialUrl(YT, "رابط يوتيوب"),
  instagram: socialUrl(IG, "رابط إنستغرام"),
  email: z
    .string()
    .trim()
    .max(200)
    .transform((v, ctx) => {
      if (v === "") return null;
      if (!z.email().safeParse(v).success) {
        ctx.addIssue({ code: "custom", message: "بريد غير صالح" });
        return z.NEVER;
      }
      return v;
    }),
});

export const homeSchema = z
  .object({
    hero_title: optText(120, "عنوان الواجهة"),
    hero_subtitle: optText(LONG_TEXT, "النص التعريفي"),
    hero_primary_label: optText(40, "نص الزر الأساسي"),
    hero_secondary_label: optText(40, "نص الزر الثاني"),
    booking_message: optText(LONG_TEXT, "رسالة واتساب"),
    hero_cover_photo_id: optUuid,
    hero_promo_source: z.enum(["site", "youtube"], { message: "مصدر الفيديو غير صالح" }),
    hero_promo_video_id: optUuid,
  })
  .refine((v) => v.hero_promo_source !== "youtube" || v.hero_promo_video_id, {
    message: "اختر فيديو يوتيوب للبرومو أو اختر ملف الموقع.",
  });

export const sectionIntroSchema = z.object({
  key: z.enum(SECTION_KEYS),
  title: optText(120, "العنوان"),
  intro: optText(LONG_TEXT, "المقدمة"),
});

export const serviceSchema = z.object({
  title: reqText(120, "عنوان الخدمة", 2),
  slug,
  summary: optText(LONG_TEXT, "الملخص"),
  body: optText(LONG_TEXT, "التفاصيل"),
  cover_photo_id: optUuid,
  is_published: z.boolean(),
  video_ids: uuidList,
  album_ids: uuidList,
});

export const stepSchema = z.object({
  title: reqText(80, "عنوان الخطوة", 2),
  description: optText(LONG_TEXT, "الوصف"),
  photo_id: optUuid,
  is_published: z.boolean(),
});

const money = z
  .string()
  .trim()
  .transform((v, ctx) => {
    if (v === "") return null;
    if (!/^\d{1,9}(\.\d{1,2})?$/.test(v)) {
      ctx.addIssue({ code: "custom", message: "السعر رقم موجب (حتى منزلتين عشريتين)" });
      return z.NEVER;
    }
    return Math.round(Number(v) * 100);
  });

export const offerSchema = z
  .object({
    title: reqText(120, "عنوان العرض", 2),
    slug,
    description: optText(LONG_TEXT, "الوصف"),
    image_photo_id: optUuid,
    price_minor: money,
    currency: z.enum(["ILS", "USD", "JOD"], { message: "عملة غير مدعومة" }),
    show_price: z.boolean(),
    starts_on: optDate,
    ends_on: optDate,
    terms: optText(LONG_TEXT, "الشروط"),
    whatsapp_message: optText(LONG_TEXT, "رسالة واتساب"),
    status: z.enum(["draft", "published", "archived"]),
    pinned_home: z.boolean(),
    target_month: optInt(1, 12, "الشهر المستهدف"),
    target_year: optInt(2000, 2100, "السنة المستهدفة"),
    package_id: optUuid,
    items: z.array(reqText(LONG_TEXT, "بند العرض")).max(20, "بنود كثيرة (20 حداً أقصى)"),
  })
  .refine((v) => (v.target_month === null) === (v.target_year === null), { message: "اختر الشهر والسنة المستهدفين معاً، أو اتركهما فارغين." })
  .refine((v) => !v.starts_on || !v.ends_on || v.ends_on >= v.starts_on, { message: "تاريخ النهاية يجب أن يكون بعد البداية أو مساوياً لها." })
  .refine((v) => !v.show_price || v.price_minor !== null, { message: "أدخل السعر أو ألغِ «إظهار السعر»." });

export const packageSchema = z
  .object({
    title: reqText(120, "اسم البكج", 2),
    slug,
    description: optText(LONG_TEXT, "الوصف"),
    image_photo_id: optUuid,
    price_minor: money,
    currency: z.enum(["ILS", "USD", "JOD"], { message: "عملة غير مدعومة" }),
    show_price: z.boolean(),
    whatsapp_message: optText(LONG_TEXT, "رسالة واتساب"),
    status: z.enum(["draft", "published", "hidden"]),
    featured: z.boolean(),
    group_label: optText(40, "المجموعة"),
    gift: optText(LONG_TEXT, "الهدية"),
    internal_note: optText(LONG_TEXT, "الملاحظة الداخلية"),
    items: z.array(reqText(LONG_TEXT, "خدمة مشمولة")).max(30, "خدمات كثيرة (30 حداً أقصى)"),
  })
  .refine((v) => !v.show_price || v.price_minor !== null, { message: "أدخل السعر أو ألغِ «إظهار السعر»." });

export const announcementSchema = z
  .object({
    template: z.enum(["bar", "banner"], { message: "قالب غير صالح" }),
    text: reqText(140, "نص الإعلان", 2),
    link_kind: z.enum(["none", "offer", "page"]),
    link_offer_id: optUuid,
    link_page: z.union([z.enum(PAGE_TARGETS), z.literal("")]).transform((v) => (v === "" ? null : v)),
    starts_on: optDate,
    ends_on: optDate,
    is_visible: z.boolean(),
    dismissible: z.boolean(),
  })
  .refine((v) => !v.starts_on || !v.ends_on || v.ends_on >= v.starts_on, { message: "تاريخ النهاية يجب أن يكون بعد البداية أو مساوياً لها." })
  .refine((v) => v.link_kind !== "offer" || v.link_offer_id, { message: "اختر العرض المرتبط." })
  .refine((v) => v.link_kind !== "page" || v.link_page, { message: "اختر الصفحة المرتبطة." })
  .transform((v) => ({
    ...v,
    link_offer_id: v.link_kind === "offer" ? v.link_offer_id : null,
    link_page: v.link_kind === "page" ? v.link_page : null,
  }));

export const navItemSchema = z.object({ label: reqText(30, "اسم الرابط"), is_visible: z.boolean() });

export const sectionSchema = z.object({
  key: z.enum(SECTION_KEYS),
  title: optText(120, "العنوان"),
  intro: optText(LONG_TEXT, "المقدمة"),
  is_visible: z.boolean(),
  stat_value: optInt(1, 10_000_000, "الرقم").optional(), // only the stats section sends it
  item_limit: z.coerce.number({ message: "عدد العناصر رقم" }).int("عدد صحيح").min(1, "1 على الأقل").max(12, "12 كحد أقصى"),
  featured_ids: uuidList.max(12, "12 عنصراً مميزاً كحد أقصى"),
});

export const orderSchema = z.array(z.string().regex(UUID)).min(1).max(500);
export const keyOrderSchema = z.array(z.enum(SECTION_KEYS)).min(1).max(SECTION_KEYS.length);

/** Latin -> slug suggestion (Arabic letters are dropped; the owner types a Latin hint or edits manually). */
export function suggestSlug(input: string): string {
  return input
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .trim()
    .replace(/[\s-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export const defaultOfferMessage = (title: string) => `مرحباً، بدي أستفسر عن عرض: ${title}`;
export const firstIssue = (e: z.ZodError) => e.issues[0]?.message ?? "راجع الحقول.";
