import type { Database } from "@/types/database";
type E = Database["public"]["Enums"];

export const BOOKING_STATUS: Record<E["booking_status"], string> = {
  new: "جديد",
  contacted: "تم التواصل",
  quoted: "أُرسل عرض",
  confirmed: "مؤكد",
  cancelled: "ملغي",
  declined: "مرفوض",
};
/** Mirror of app.booking_transition_allowed, used only to decide which buttons to show. The database is the authority. */
export const BOOKING_TRANSITIONS: Record<E["booking_status"], E["booking_status"][]> = {
  new: ["contacted", "declined", "cancelled"],
  contacted: ["quoted", "declined", "cancelled"],
  quoted: ["confirmed", "declined", "cancelled", "contacted"],
  confirmed: ["cancelled"],
  cancelled: [],
  declined: [],
};
export const EVENT_STATUS: Record<E["event_status"], string> = {
  planned: "مخطط",
  shooting: "تصوير",
  editing: "مونتاج",
  delivered: "تم التسليم",
  archived: "مؤرشف",
};
export const CONSENT_STATUS: Record<E["consent_status"], string> = {
  none: "لم تُطلب",
  requested: "مطلوبة من العميل",
  granted: "موافقة ممنوحة",
  revoked: "سُحبت الموافقة",
};
export const DELIVERABLE_KIND: Record<E["deliverable_kind"], string> = {
  gallery: "معرض صور",
  video: "فيديو",
  album: "ألبوم",
  files: "ملفات",
};
export const DELIVERABLE_STATUS: Record<E["deliverable_status"], string> = {
  in_progress: "قيد العمل",
  review: "بانتظار مراجعة العميل",
  revision_requested: "طُلب تعديل",
  approved: "معتمد",
  delivered: "مُسلّم",
};
export const QUOTE_STATUS: Record<E["quote_status"], string> = {
  draft: "مسودة",
  sent: "مُرسل",
  accepted: "مقبول",
  rejected: "مرفوض",
  expired: "منتهي",
};
export const CONTRACT_STATUS: Record<E["contract_status"], string> = {
  draft: "مسودة",
  sent: "بانتظار موافقة العميل",
  approved: "معتمد",
  void: "ملغى",
};
export const EQUIPMENT_STATUS: Record<E["equipment_status"], string> = {
  available: "متاح",
  assigned: "مع مناسبة",
  maintenance: "صيانة",
  retired: "خارج الخدمة",
};
export const SUPPORT_STATUS: Record<E["support_status"], string> = {
  open: "مفتوح",
  pending: "بانتظار العميل",
  resolved: "تم الحل",
  closed: "مغلق",
};
export const REVIEW_STATUS: Record<E["review_status"], string> = {
  pending: "بانتظار المراجعة",
  approved: "منشور",
  rejected: "مرفوض",
};
export const ROLE_LABEL: Record<E["app_role"], string> = {
  owner: "المالك",
  admin: "مدير",
  staff: "طاقم",
  customer: "عميل",
};
export const SELECTION_STATUS: Record<E["selection_status"], string> = {
  draft: "مسودة",
  submitted: "مُرسلة",
  locked: "مقفلة",
};
export const BACKUP_STATUS: Record<E["backup_status"], string> = {
  running: "قيد التنفيذ",
  completed: "مكتمل",
  partial: "جزئي",
  failed: "فشل",
};
export const UPLOAD_STATUS: Record<E["upload_status"], string> = {
  pending: "قيد الرفع",
  ready: "جاهز",
  failed: "فشل",
};
export const EVENT_TYPES: Record<string, string> = {
  wedding: "عرس",
  engagement: "خطوبة",
  graduation: "تخرج",
  festival: "مهرجان",
  commercial: "تجاري",
  dj: "دي جي",
  livestream: "بث مباشر",
  production: "إنتاج",
  other: "أخرى",
};
export function label<T extends string>(map: Record<T, string>, v: T | null | undefined): string {
  return v ? (map[v] ?? v) : "—";
}
export function eventTypeLabel(v: string | null | undefined): string {
  return v ? (EVENT_TYPES[v] ?? v) : "—";
}
