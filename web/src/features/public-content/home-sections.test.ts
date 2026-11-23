import { describe, expect, it } from "vitest";
import { SECTION_FEATURE, SECTION_FIELDS, SECTION_KEYS as ADMIN_KEYS } from "@/features/cms-admin/targets";
import { resolveSections, SECTION_KEYS, siteSectionRow } from "./cms-model";

const row = (r: Record<string, unknown>) => siteSectionRow.parse(r);

describe("home sections: saved rows decide, the poster is only the fallback", () => {
  it("with nothing saved, the home page is the poster's four sections in its order", () => {
    const visible = resolveSections(null).filter((s) => s.visible);
    expect(visible.map((s) => s.key)).toEqual(["about", "services", "works", "contact"]);
    expect(visible.map((s) => s.title)).toEqual(["من نحن", "كيف نوثّق مناسبتكم", "من أعمالنا", "تواصل معنا"]);
  });

  it("saved order, visibility, title, intro and limit always win over the poster defaults", () => {
    const out = resolveSections([
      row({ key: "offers", title: "عروضنا", is_visible: true, sort_order: 10, item_limit: 4 }),
      row({ key: "albums", title: null, is_visible: true, sort_order: 20, item_limit: 4 }),
      row({ key: "works", title: "أحدث الأعمال", intro: "مقدمة", is_visible: true, sort_order: 40, item_limit: 3 }),
      row({ key: "services", title: "الخدمات", is_visible: true, sort_order: 50 }),
      row({ key: "about", is_visible: false, sort_order: 80 }),
      row({ key: "contact", is_visible: false, sort_order: 90 }),
    ]);
    expect(out.filter((s) => s.visible).map((s) => s.key)).toEqual(["offers", "albums", "works", "services"]);
    expect(out.find((s) => s.key === "works")).toMatchObject({ title: "أحدث الأعمال", intro: "مقدمة", limit: 3 });
    expect(out.find((s) => s.key === "services")!.title).toBe("الخدمات");
    expect(out.find((s) => s.key === "albums")!.title).toBe("ألبومات الصور"); // no saved title → the default name
    expect(out.find((s) => s.key === "about")!.visible).toBe(false); // a saved «hidden» beats the poster default
  });

  it("every section is resolved exactly once, whatever is saved", () => {
    for (const rows of [null, [], [row({ key: "stats", is_visible: true, sort_order: 1, stat_value: 1250 })]]) {
      expect([...resolveSections(rows).map((s) => s.key)].sort()).toEqual([...SECTION_KEYS].sort());
    }
  });
});

describe("admin: which section controls the home page uses", () => {
  it("covers every section key", () => {
    expect(Object.keys(SECTION_FIELDS).sort()).toEqual([...ADMIN_KEYS].sort());
  });
  it("offers a featured picker only where the section has one, and explains every control it withholds on the poster's sections", () => {
    for (const k of ADMIN_KEYS) {
      if (SECTION_FIELDS[k].featured) expect(SECTION_FEATURE[k], k).not.toBeNull();
    }
    for (const k of ["services", "contact", "about"] as const) expect(SECTION_FIELDS[k].why, k).toBeTruthy();
    expect(SECTION_FIELDS.services).toMatchObject({ title: true, intro: true, limit: false, featured: false });
    expect(SECTION_FIELDS.contact).toMatchObject({ title: false, intro: false, limit: false, featured: false });
    expect(SECTION_FIELDS.works).toMatchObject({ title: true, intro: true, limit: true, featured: true });
  });
});
