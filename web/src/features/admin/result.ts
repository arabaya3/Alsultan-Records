export type ActionResult = { ok: boolean; message: string; data?: Record<string, unknown> };
export const ok = (message: string, data?: Record<string, unknown>): ActionResult => ({ ok: true, message, data });
export const fail = (message: string, data?: Record<string, unknown>): ActionResult => ({ ok: false, message, data });
export const FORBIDDEN: ActionResult = { ok: false, message: "ليست لديك صلاحية لهذا الإجراء." };
export const INITIAL: ActionResult = { ok: true, message: "" };

type PgError = { code?: string; message?: string } | null | undefined;

/** Map a Postgres/PostgREST error to a calm Arabic message. `overrides` win by code. */
export function dbMessage(error: PgError, overrides: Record<string, string> = {}): string {
  const code = error?.code ?? "";
  if (overrides[code]) return overrides[code];
  switch (code) {
    case "42501":
      return "ليست لديك صلاحية لهذا الإجراء، أو أن الحالة الحالية لا تسمح به.";
    case "23505":
      return "هذه القيمة مستخدمة مسبقاً.";
    case "23503":
      return "لا يمكن الحذف لوجود سجلات مرتبطة.";
    case "23514":
      return "القيم المدخلة لا تحقق شروط النظام.";
    case "23P01":
      return "يوجد تعارض في المواعيد.";
    case "22023":
      return "هذا الإجراء غير مسموح في الحالة الحالية.";
    case "P0002":
      return "السجل غير موجود.";
    default:
      return "تعذّر تنفيذ العملية. حاول مرة أخرى.";
  }
}

export function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}
export function optStr(fd: FormData, key: string): string | null {
  const v = str(fd, key);
  return v === "" ? null : v;
}
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function uuid(fd: FormData, key: string): string | null {
  const v = str(fd, key);
  return UUID_RE.test(v) ? v : null;
}
export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function optDate(fd: FormData, key: string): string | null {
  const v = str(fd, key);
  return DATE_RE.test(v) ? v : null;
}
