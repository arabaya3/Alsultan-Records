import { describe, expect, it } from "vitest";
import { offerPriceLabel } from "./cms-model";

// Prices are out of scope of the UI audit follow-up: this pins the display rules so a refactor can't change them.
describe("offerPriceLabel (unchanged)", () => {
  it("shekels read «1,300 شيكل»; hidden or missing price → nothing", () => {
    expect(offerPriceLabel({ show_price: true, display_price_minor: 130000, currency: "ILS" })).toBe("1,300 شيكل");
    expect(offerPriceLabel({ show_price: true, display_price_minor: 149950, currency: "ILS" })).toBe("1,499.5 شيكل");
    expect(offerPriceLabel({ show_price: false, display_price_minor: 130000, currency: "ILS" })).toBeNull();
    expect(offerPriceLabel({ show_price: true, display_price_minor: null, currency: "ILS" })).toBeNull();
  });
  it("a shown price of 0 still displays 0 (the stored value is shown as is — not changed by this task)", () => {
    expect(offerPriceLabel({ show_price: true, display_price_minor: 0, currency: "ILS" })).toBe("0 شيكل");
  });
});
