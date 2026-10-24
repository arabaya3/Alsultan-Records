import { describe, expect, it } from "vitest";
import { slugFromTitle } from "./slug";

describe("slugFromTitle", () => {
  it("transliterates Arabic titles into a valid slug", () => {
    expect(slugFromTitle("حفل زفاف 2026")).toBe("hfl-zfaf-2026");
    expect(slugFromTitle("أعراس")).toBe("aaras");
    expect(slugFromTitle("خطوبة ٢٠٢٧")).toBe("khtwbh-2027");
  });
  it("Latin titles: lowercase words joined with single hyphens", () => {
    expect(slugFromTitle("Wedding  Photos — Jenin!")).toBe("wedding-photos-jenin");
  });
  it("matches the album/category slug pattern and respects the length limit", () => {
    const s = slugFromTitle("حفل زفاف العريس داود جهاد نعيرات ميثلون ٢٠٢٦ تصوير كامل للسهرة والحفلة", 60);
    expect(s).toMatch(/^[a-z0-9][a-z0-9-]{1,59}$/);
    expect(s.length).toBeLessThanOrEqual(60);
    expect(s.endsWith("-")).toBe(false);
  });
  it("empty or symbol-only titles give an empty suggestion (the admin types one)", () => {
    expect(slugFromTitle("")).toBe("");
    expect(slugFromTitle("!!!")).toBe("");
  });
});
