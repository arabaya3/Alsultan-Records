/** Multipart plan, shared by the browser and the server. Pure: both sides must compute the same parts. */
const MIB = 1024 * 1024;
export const PART_MIN = 8 * MIB;
export const PARTS_MAX = 9000; // S3 allows 10,000; keep a margin
export const PARTS_PER_SIGN = 8;

export function partSizeFor(size: number): number {
  return Math.max(PART_MIN, Math.ceil(size / PARTS_MAX));
}
export function partCount(size: number, partSize: number): number {
  return Math.max(1, Math.ceil(size / partSize));
}
/** Exact length of a part (1-based). 0 when the number is outside the file. */
export function partLength(size: number, partSize: number, n: number): number {
  if (!Number.isInteger(n) || n < 1 || n > partCount(size, partSize)) return 0;
  return n < partCount(size, partSize) ? partSize : size - partSize * (n - 1);
}
export type StoredPart = { n: number; size: number };
/** Null when the stored parts make up exactly this file, otherwise why not. Part lists come from S3, never the browser. */
export function partsProblem(parts: StoredPart[], size: number, partSize: number): string | null {
  const count = partCount(size, partSize);
  if (parts.length !== count) return "missing parts";
  const sorted = [...parts].sort((a, b) => a.n - b.n);
  for (let i = 0; i < count; i++) {
    if (sorted[i].n !== i + 1 || sorted[i].size !== partLength(size, partSize, i + 1)) return "wrong part";
  }
  return null;
}
