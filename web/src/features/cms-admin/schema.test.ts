import { describe, expect, it } from "vitest";
import { announcementSchema, identitySchema, offerSchema, sectionSchema, suggestSlug } from "./schema";
import { offerBadge } from "./status";

const offer = (o: Record<string, unknown> = {}) => ({
  title: "عرض الصيف", slug: "summer", description: "", image_photo_id: "", price_minor: "", currency: "ILS", show_price: false,
  starts_on: "", ends_on: "", terms: "", whatsapp_message: "", status: "draft", pinned_home: false, target_month: "", target_year: "", package_id: "", items: [], ...o,
});
const ident = (o: Record<string, string> = {}) => ({
  name: "السلطان", tagline: "", phone: "", whatsapp: "", whatsapp_url: "", address: "", facebook: "", youtube_url: "", instagram: "", email: "", ...o,
});

describe("cms schema", () => {
  it("rejects HTML in plain text fields", () => {
    expect(identitySchema.safeParse(ident({ tagline: "<script>alert(1)</script>" })).success).toBe(false);
    expect(identitySchema.safeParse(ident({ tagline: "أفراح > مناسبات" })).success).toBe(true);
  });
  it("social links: https only on the right host", () => {
    expect(identitySchema.safeParse(ident({ facebook: "http://facebook.com/x" })).success).toBe(false);
    expect(identitySchema.safeParse(ident({ facebook: "https://evil.com/facebook.com" })).success).toBe(false);
    expect(identitySchema.safeParse(ident({ facebook: "javascript:alert(1)" })).success).toBe(false);
    const ok = identitySchema.safeParse(ident({ facebook: "https://www.facebook.com/studio", instagram: "" }));
    expect(ok.success && ok.data.instagram).toBe(null);
  });
  it("offer price, dates and show_price rules", () => {
    expect(offerSchema.safeParse(offer({ price_minor: "1499.50" })).data?.price_minor).toBe(149950);
    expect(offerSchema.safeParse(offer({ starts_on: "2026-10-10", ends_on: "2026-10-01" })).success).toBe(false);
    expect(offerSchema.safeParse(offer({ show_price: true })).success).toBe(false);
    expect(offerSchema.safeParse(offer({ slug: "عربي" })).success).toBe(false);
  });
  it("announcement link must be allow-listed", () => {
    const base = { template: "bar", text: "خصم", link_kind: "page", link_offer_id: "", starts_on: "", ends_on: "", is_visible: true, dismissible: true };
    expect(announcementSchema.safeParse({ ...base, link_page: "admin" }).success).toBe(false);
    expect(announcementSchema.safeParse({ ...base, link_page: "offers" }).success).toBe(true);
  });
  it("section item_limit 1..12", () => {
    const s = { key: "works", title: "", intro: "", is_visible: true, featured_ids: [] };
    expect(sectionSchema.safeParse({ ...s, item_limit: "13" }).success).toBe(false);
    expect(sectionSchema.safeParse({ ...s, item_limit: "0" }).success).toBe(false);
    expect(sectionSchema.safeParse({ ...s, item_limit: "12" }).success).toBe(true);
  });
  it("slug suggestion and Hebron status", () => {
    expect(suggestSlug("Wedding  Photography!")).toBe("wedding-photography");
    const t = "2026-10-18";
    expect(offerBadge({ status: "published", starts_on: null, ends_on: "2026-10-18" }, t).label).toBe("ساري");
    expect(offerBadge({ status: "published", starts_on: null, ends_on: "2026-10-17" }, t).label).toBe("منتهي");
    expect(offerBadge({ status: "published", starts_on: "2026-10-19", ends_on: null }, t).label).toBe("مجدول");
    expect(offerBadge({ status: "draft", starts_on: null, ends_on: null }, t).label).toBe("مسودة");
  });
});

describe("offer target period + package link", () => {
  it("month and year together or neither; package id must be a uuid", () => {
    expect(offerSchema.safeParse(offer({ target_month: "10", target_year: "2026" })).success).toBe(true);
    expect(offerSchema.safeParse(offer({ target_month: "10" })).success).toBe(false);
    expect(offerSchema.safeParse(offer({ target_month: "13", target_year: "2026" })).success).toBe(false);
    expect(offerSchema.safeParse(offer({ package_id: "not-a-uuid" })).success).toBe(false);
    const ok = offerSchema.safeParse(offer({ target_month: "9", target_year: "2027" }));
    expect(ok.success && [ok.data.target_month, ok.data.target_year, ok.data.package_id]).toEqual([9, 2027, null]);
  });
});
