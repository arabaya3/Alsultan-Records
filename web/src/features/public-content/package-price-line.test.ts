import { describe, expect, it } from "vitest";
import { packagePriceLine } from "./cms-model";

describe("packagePriceLine", () => {
  it("shows a real price in shekels", () => {
    expect(packagePriceLine({ show_price: true, display_price_minor: 130000, currency: "ILS" })).toEqual({ kind: "price", label: "1,300 شيكل" });
  });
  it("never shows «0 شيكل»: a stored 0 asks for the price", () => {
    expect(packagePriceLine({ show_price: true, display_price_minor: 0, currency: "ILS" })).toEqual({ kind: "ask" });
  });
  it("a hidden or missing price shows nothing", () => {
    expect(packagePriceLine({ show_price: false, display_price_minor: 0, currency: "ILS" })).toBeNull();
    expect(packagePriceLine({ show_price: true, display_price_minor: null, currency: "ILS" })).toBeNull();
  });
});
