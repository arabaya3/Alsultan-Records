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
