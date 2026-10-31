import { describe, expect, it } from "vitest";
import { bookingSchema } from "./schema";

const valid = { contact_name: "اسم تجريبي", contact_phone: "0590000000", event_type: "wedding", event_date: "2030-01-15" };

describe("bookingSchema services (GHSA-mrhx-c7xc-m3w5)", () => {
  it("oversized invalid input is rejected with a bounded error list, not one issue per element", () => {
    const r = bookingSchema.safeParse({ ...valid, services: Array.from({ length: 200_000 }, () => "x") });
    expect(r.success).toBe(false);
    expect(r.error!.issues.length).toBeLessThan(100); // zod before 4.6.6: 200,001, about 230 MB of heap
  });

  it("too many valid values are still rejected", () => {
    const r = bookingSchema.safeParse({ ...valid, services: Array.from({ length: 11 }, () => "photo") });
    expect(r.success).toBe(false);
  });

  it("a normal booking still passes; services stay optional", () => {
    expect(bookingSchema.safeParse(valid).success).toBe(true);
  });
});
