import { describe, expect, it } from "vitest";
import { isOfferActive, offerPeriodKey, packageWhatsappText, sortOffers } from "./cms-model";

type O = { title: string; pinned_home: boolean; sort_order: number; target_month: number | null; target_year: number | null; starts_on: string | null };
const o = (title: string, p: Partial<O> = {}): O => ({ title, pinned_home: false, sort_order: 100, target_month: null, target_year: null, starts_on: null, ...p });
const titles = (l: O[]) => sortOffers(l).map((x) => x.title);

describe("offer ordering", () => {
  it("October 2026 above September 2026 when neither is pinned", () => {
    expect(titles([o("sep", { target_month: 9, target_year: 2026, sort_order: 10 }), o("oct", { target_month: 10, target_year: 2026, sort_order: 20 })])).toEqual(["oct", "sep"]);
  });

  it("across years: September 2027 above October 2026, January 2027 above December 2026", () => {
    expect(
      titles([
        o("oct26", { target_month: 10, target_year: 2026 }),
        o("sep27", { target_month: 9, target_year: 2027 }),
        o("dec26", { target_month: 12, target_year: 2026 }),
        o("jan27", { target_month: 1, target_year: 2027 }),
      ]),
    ).toEqual(["sep27", "jan27", "dec26", "oct26"]);
  });

  it("never reads the month from the title", () => {
    // Title says October but the owner targeted September (and vice versa): the target wins.
    expect(titles([o("عرض أكتوبر 2026", { target_month: 9, target_year: 2026 }), o("عرض سبتمبر 2026", { target_month: 10, target_year: 2026 })])).toEqual([
      "عرض سبتمبر 2026",
      "عرض أكتوبر 2026",
    ]);
    // No target and no start date: title is irrelevant, owner order applies.
    expect(titles([o("عرض أكتوبر", { sort_order: 20 }), o("عرض سبتمبر", { sort_order: 10 })])).toEqual(["عرض سبتمبر", "عرض أكتوبر"]);
  });

  it("pinned first in the owner's order, even if older", () => {
    expect(
      titles([
        o("oct", { target_month: 10, target_year: 2026 }),
        o("pinB", { pinned_home: true, sort_order: 20, target_month: 1, target_year: 2025 }),
        o("pinA", { pinned_home: true, sort_order: 10, target_month: 3, target_year: 2024 }),
      ]),
    ).toEqual(["pinA", "pinB", "oct"]);
  });

  it("falls back to the start month, then puts offers without a period last", () => {
    expect(titles([o("none", { sort_order: 1 }), o("startSep", { starts_on: "2026-09-20" }), o("targetAug", { target_month: 8, target_year: 2026 })])).toEqual([
      "startSep",
      "targetAug",
      "none",
    ]);
    expect(offerPeriodKey({ target_month: null, target_year: null, starts_on: "2026-10-01" })).toBe(2026 * 12 + 9);
  });
});

describe("offer validity (Asia/Hebron calendar dates)", () => {
  it("future offers are not active before their start; expired ones are not active after their end", () => {
    expect(isOfferActive({ status: "published", starts_on: "2026-10-19", ends_on: null }, "2026-10-18")).toBe(false);
    expect(isOfferActive({ status: "published", starts_on: "2026-10-18", ends_on: null }, "2026-10-18")).toBe(true);
    expect(isOfferActive({ status: "published", starts_on: null, ends_on: "2026-10-17" }, "2026-10-18")).toBe(false);
    expect(isOfferActive({ status: "published", starts_on: null, ends_on: "2026-10-18" }, "2026-10-18")).toBe(true);
    expect(isOfferActive({ status: "draft", starts_on: null, ends_on: null }, "2026-10-18")).toBe(false);
  });
});

describe("package WhatsApp text", () => {
  it("names the package by default", () => {
    expect(packageWhatsappText({ title: "بكج الذهبي", whatsapp_message: null })).toBe("مرحباً، بدي أستفسر عن بكج: بكج الذهبي");
  });
});
