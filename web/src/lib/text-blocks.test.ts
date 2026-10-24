import { describe, expect, it } from "vitest";
import { listPreview, parseTextBlocks } from "./text-blocks";

// Shape of the real owner text on /offers (numbered services, each with «- » details).
const OFFER = "1. تصوير سهرة العريس\n- كاميرا صور لتوثيق النقوط.\n- كاميرا فيديو لتوثيق النقوط.\n2. تصوير حمّام العريس\n- جلسة مع الأهل\n3. فيديو الحفلة";

describe("parseTextBlocks", () => {
  it("numbered lines become an ordered list; following «- » lines become their sub-items", () => {
    expect(parseTextBlocks(OFFER)).toEqual([
      {
        kind: "ol",
        items: [
          { text: "تصوير سهرة العريس", children: ["كاميرا صور لتوثيق النقوط.", "كاميرا فيديو لتوثيق النقوط."] },
          { text: "تصوير حمّام العريس", children: ["جلسة مع الأهل"] },
          { text: "فيديو الحفلة", children: [] },
        ],
      },
    ]);
  });
  it("keeps every line of text and its order (only list markers are removed)", () => {
    const text = "مقدمة العرض\nسطر ثانٍ\n\n- بند أ\n• بند ب\n\nملاحظة أخيرة";
    const blocks = parseTextBlocks(text);
    expect(blocks).toEqual([
      { kind: "p", lines: ["مقدمة العرض", "سطر ثانٍ"] },
      { kind: "ul", items: ["بند أ", "بند ب"] },
      { kind: "p", lines: ["ملاحظة أخيرة"] },
    ]);
  });
  it("plain text without lists stays paragraphs; empty text gives nothing", () => {
    expect(parseTextBlocks("نص واحد بسيط")).toEqual([{ kind: "p", lines: ["نص واحد بسيط"] }]);
    expect(parseTextBlocks("")).toEqual([]);
    expect(parseTextBlocks(null)).toEqual([]);
  });
  it("does not treat a year or a number inside a sentence as a list", () => {
    expect(parseTextBlocks("عرض 2027 للأعراس")[0].kind).toBe("p");
  });
});

describe("listPreview", () => {
  it("the first items and the count of the rest", () => {
    expect(listPreview(OFFER, 2)).toEqual({ items: ["تصوير سهرة العريس", "تصوير حمّام العريس"], more: 1 });
    expect(listPreview(OFFER, 4)).toEqual({ items: ["تصوير سهرة العريس", "تصوير حمّام العريس", "فيديو الحفلة"], more: 0 });
  });
  it("null for text without a list", () => {
    expect(listPreview("وصف قصير")).toBeNull();
  });
});
