import { describe, expect, it } from "vitest";
import { paymentMethodLabel } from "./method-label";

describe("paymentMethodLabel", () => {
  it("translates stored methods to the admin form wording", () => {
    expect(paymentMethodLabel("bank_transfer")).toBe("تحويل بنكي");
    expect(paymentMethodLabel("cash")).toBe("نقداً");
  });
  it("passes unknown values through and blanks empty ones", () => {
    expect(paymentMethodLabel("crypto")).toBe("crypto");
    expect(paymentMethodLabel(null)).toBe("");
  });
});
