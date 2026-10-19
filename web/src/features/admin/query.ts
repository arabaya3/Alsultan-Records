export type SP = Promise<Record<string, string | string[] | undefined>>;
export type IdParams = Promise<{ id: string }>;
export const PAGE_SIZE = 25;

export function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? "";
}
export function pageOf(v: string | string[] | undefined): number {
  const n = Number.parseInt(one(v), 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 10000) : 1;
}
export function rangeOf(page: number, size = PAGE_SIZE): [number, number] {
  return [(page - 1) * size, page * size - 1];
}
/** Remove characters that have meaning in PostgREST filter syntax. */
export function cleanSearch(q: string): string {
  return q
    .replace(/[,()*%\\:."'`]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}
export function pick<T extends string>(v: string, allowed: readonly T[]): T | null {
  return (allowed as readonly string[]).includes(v) ? (v as T) : null;
}
