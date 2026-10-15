/**
 * Post-login redirect allowlist: same-origin relative paths only.
 * Rejects absolute URLs, protocol-relative ("//x"), backslash tricks ("/\x"), and control chars.
 * Staff may only land in /admin; customers only in /portal.
 */
export function safeNext(next: unknown, role: "staff" | "customer" | null): string {
  const fallback = role === "staff" ? "/admin" : "/portal";
  if (typeof next !== "string" || next.length > 512) return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f\\]/.test(next)) return fallback;
  const area = role === "staff" ? "/admin" : "/portal";
  if (role && !(next === area || next.startsWith(`${area}/`) || next.startsWith(`${area}?`))) return fallback;
  return next;
}
