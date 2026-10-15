/** Arabic labels and formatters for portal UI (safe on client and server). */
export const EVENT_STATUS: Record<string, string> = {
  planned: "قيد التحضير",
  shooting: "التصوير",
  editing: "المونتاج والتحرير",
  delivered: "تم التسليم",
  archived: "مؤرشفة",
};
export const EVENT_STEPS = ["planned", "shooting", "editing", "delivered"] as const;

export const DELIVERABLE_STATUS: Record<string, string> = {
  in_progress: "قيد العمل",
  review: "بانتظار مراجعتك",
  revision_requested: "طلبت تعديلات",
  approved: "معتمد",
  delivered: "تم التسليم",
};
export const DELIVERABLE_KIND: Record<string, string> = {
  gallery: "معرض الصور",
  video: "فيلم",
  album: "ألبوم",
  files: "ملفات",
};
export const QUOTE_STATUS: Record<string, string> = {
  sent: "بانتظار موافقتك",
  accepted: "مقبول",
  rejected: "مرفوض",
  expired: "منتهي الصلاحية",
  draft: "مسودة",
};
export const CONTRACT_STATUS: Record<string, string> = {
  sent: "بانتظار اعتمادك",
  approved: "معتمد",
  void: "ملغى",
  draft: "مسودة",
};

export function money(minor: number | null | undefined, currency = "ILS") {
  const v = (minor ?? 0) / 100;
  try {
    return new Intl.NumberFormat("ar-PS", { style: "currency", currency: currency.trim() || "ILS" }).format(v);
  } catch {
    return `${v.toFixed(2)} ${currency}`;
  }
}

export function dateAr(iso: string | null | undefined, withDay = true) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("ar-PS", {
    year: "numeric",
    month: "long",
    ...(withDay ? { day: "numeric" } : {}),
    timeZone: "Asia/Hebron",
  }).format(d);
}

export function timecode(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}
