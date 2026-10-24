import { describe, expect, it } from "vitest";
import { activeHref } from "./nav-active";

// The live CMS header nav.
const NAV = ["/work", "/work?tab=photos", "/work?tab=promos", "/services", "/packages", "/offers", "/about", "/contact"];
const at = (path: string, q = "") => activeHref(path, new URLSearchParams(q), NAV);

describe("activeHref", () => {
  it("/work?tab=photos marks «الألبومات», not «أعمالنا» too", () => {
    expect(at("/work", "tab=photos")).toBe("/work?tab=photos");
    expect(at("/work", "tab=promos")).toBe("/work?tab=promos");
  });
  it("/work (videos tab, any category/page) marks «أعمالنا»", () => {
    expect(at("/work")).toBe("/work");
    expect(at("/work", "tab=videos&cat=weddings&page=2")).toBe("/work");
  });
  it("sub-pages keep their section active; unknown pages none", () => {
    expect(at("/work/v/abc")).toBe("/work");
    expect(at("/offers/wedding-complete")).toBe("/offers");
    expect(at("/privacy")).toBeNull();
  });
  it("without query links in the nav, behaves like a path match", () => {
    expect(activeHref("/work", new URLSearchParams("tab=photos"), ["/work", "/about"])).toBe("/work");
  });
});
