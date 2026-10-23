import { describe, expect, it } from "vitest";
import { mergeOrder } from "./reorder-merge";

const it3 = (ids: string[]) => ids.map((id) => ({ id, thumb: null, label: id }));

describe("mergeOrder (server list refreshed during upload/processing)", () => {
  it("keeps the admin's unsaved order, appends newly uploaded photos at the end", () => {
    expect(mergeOrder(it3(["c", "a", "b"]), it3(["a", "b", "c", "d"])).map((i) => i.id)).toEqual(["c", "a", "b", "d"]);
  });
  it("drops photos that are no longer in the album (trashed elsewhere)", () => {
    expect(mergeOrder(it3(["c", "a", "b"]), it3(["a", "c"])).map((i) => i.id)).toEqual(["c", "a"]);
  });
  it("refreshes thumbs/labels of kept photos", () => {
    const merged = mergeOrder(it3(["a"]), [{ id: "a", thumb: "/t.webp", label: "الصورة 1" }]);
    expect(merged[0].thumb).toBe("/t.webp");
  });
});
