/** Arabic labels for enum-like values coming from the database. */
const EVENT_TYPES: Record<string, string> = {
  wedding: "عرس",
  engagement: "خطوبة",
  graduation: "تخرّج",
  festival: "مهرجان",
  commercial: "تصوير تجاري",
  dj: "DJ",
  livestream: "بث مباشر",
  production: "إنتاج",
};

export function eventTypeLabel(v: string | null | undefined): string | null {
  if (!v) return null;
  return EVENT_TYPES[v] ?? v;
}

export const EVENT_TYPE_OPTIONS = Object.entries(EVENT_TYPES).map(([value, label]) => ({
  value,
  label,
}));

export function formatDateAr(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("ar-PS", {
    year: "numeric",
    month: "long",
    timeZone: "Asia/Hebron",
  }).format(d);
}

const VIDEO_CATEGORY: Record<string, string> = {
  wedding: "عرس",
  evening: "سهرة",
  groom_prep: "تجهيز العريس",
  folk: "دبكة وفلكلور",
  engagement: "خطوبة",
  graduation: "تخرّج",
  festival: "مهرجان",
  dj: "DJ",
  other: "مناسبة",
};
export const videoCategoryLabel = (v: string) => VIDEO_CATEGORY[v] ?? VIDEO_CATEGORY.other;

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const toArabicDigits = (n: number) => String(n).replace(/\d/g, (d) => AR_DIGITS[Number(d)]);
/** "٩ د" from seconds (rounded to the nearest minute, min 1). */
export function durationLabel(seconds: number | null | undefined): string | null {
  if (!seconds || seconds <= 0) return null;
  return `${toArabicDigits(Math.max(1, Math.round(seconds / 60)))} د`;
}
