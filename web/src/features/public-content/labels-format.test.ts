import { describe, expect, it } from "vitest";
import { arNum, cleanVideoTitle, durationLabel } from "./labels";

describe("durationLabel", () => {
  it("minutes under an hour, hours + minutes from an hour on (Arabic-Indic digits)", () => {
    expect(durationLabel(545)).toBe("٩ د");
    expect(durationLabel(59 * 60)).toBe("٥٩ د");
    expect(durationLabel(3600)).toBe("١ س");
    expect(durationLabel(75 * 60)).toBe("١ س ١٥ د");
    expect(durationLabel(2 * 3600 + 5 * 60 + 20)).toBe("٢ س ٥ د");
    expect(durationLabel(10)).toBe("١ د");
    expect(durationLabel(0)).toBeNull();
    expect(durationLabel(null)).toBeNull();
  });
  it("arNum is the single digits helper", () => {
    expect(arNum(2027)).toBe("٢٠٢٧");
  });
});

describe("cleanVideoTitle (display only)", () => {
  it("removes trailing and doubled separators from real YouTube titles", () => {
    expect(cleanVideoTitle("استقبال العريس أحمد رشدي قلالوة | تعليلة العريس 2026 | الجديدة | ")).toBe("استقبال العريس أحمد رشدي قلالوة | تعليلة العريس 2026 | الجديدة");
    expect(cleanVideoTitle("سهرة | | ميثلون")).toBe("سهرة | ميثلون");
    expect(cleanVideoTitle("حفل زفاف - ميثلون - 2026 -")).toBe("حفل زفاف - ميثلون - 2026");
  });
  it("keeps a normal title and its numbers untouched", () => {
    const t = "حفل زفاف العريس داود جهاد نعيرات - ميثلون - 2026";
    expect(cleanVideoTitle(t)).toBe(t);
    expect(cleanVideoTitle("سهرة العريس احمد ماجد نعيرات 🎤 ميثلون 🔥 2026")).toBe("سهرة العريس احمد ماجد نعيرات 🎤 ميثلون 🔥 2026");
  });
});
