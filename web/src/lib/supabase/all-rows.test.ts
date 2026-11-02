import { describe, expect, it } from "vitest";
import { allRows, PAGE_ROWS } from "./all-rows";

describe("allRows", () => {
  it("reads past the 1000-row limit, page by page, with no gap or overlap", async () => {
    const total = PAGE_ROWS * 2 + 15;
    const asked: [number, number][] = [];
    const rows = await allRows(async (from, to) => {
      asked.push([from, to]);
      return { data: Array.from({ length: Math.max(0, Math.min(to, total - 1) - from + 1) }, (_, i) => from + i), error: null };
    });
    expect(rows).toHaveLength(total);
    expect(new Set(rows).size).toBe(total);
    expect(asked).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });
  it("an error on any page fails the whole read", async () => {
    await expect(allRows(async (from) => (from ? { data: null, error: new Error("x") } : { data: Array(PAGE_ROWS).fill(0), error: null }))).rejects.toThrow("x");
  });
});
