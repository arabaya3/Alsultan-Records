import { describe, expect, it } from "vitest";
import { detailSections, listPreview, parseTextBlocks } from "./text-blocks";

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

describe("detailSections", () => {
  // Same shape as the live «الباقة الفضية» offer (wording made up): numbered coverage, then a deliveries/gifts list.
  const SILVER = "1. تغطية السهرة\n- مصوّر صور.\n- مصوّر فيديو.\n2. تغطية القاعة\n- مصوّر صور.\n\nالتسليمات والهدايا\n- ألبوم مطبوع.\n- فيديو قصير هدية.";
  const words = (s: string) => s.replace(/^\s*(\d{1,3}[.)]|[-•*])\s+/gm, "").split(/\s+/).filter(Boolean);
  const flat = (secs: ReturnType<typeof detailSections>) => secs.flatMap((s) => [s.title ?? "", ...s.lines, ...s.items].join(" ").split(/\s+/)).filter(Boolean);

  it("groups each numbered item with its details and a heading line with its list", () => {
    expect(detailSections(SILVER)).toEqual([
      { title: "تغطية السهرة", number: 1, lines: [], items: ["مصوّر صور.", "مصوّر فيديو."], accent: false },
      { title: "تغطية القاعة", number: 2, lines: [], items: ["مصوّر صور."], accent: false },
      { title: "التسليمات والهدايا", number: null, lines: [], items: ["ألبوم مطبوع.", "فيديو قصير هدية."], accent: true },
    ]);
  });
  it("never loses, merges or reorders text — whatever the shape", () => {
    const samples = [
      SILVER,
      "فقرة طويلة أولى.\nسطرها الثاني.\n\n• بند\n- بند آخر\n\nملاحظة غير معروفة 🙂 كلمةطويلةجدابلامسافاتكلمةطويلةجدابلامسافات",
      "عنوان قصير\n\n- قائمة بعد سطر فارغ",
      "1. أ\n2. ب\n- تفصيل ب\nنص حر بعد القائمة\n3. ج",
      "",
      "سطر واحد فقط",
    ];
    for (const t of samples) expect(flat(detailSections(t))).toEqual(words(t));
  });
  it("only a short single line right before a list becomes a heading; long paragraphs stay text", () => {
    const long = "هذا سطر طويل جدًا يشرح العرض بالتفصيل ويزيد عن ستين حرفًا بكثير حتى لا يعامل كعنوان.\n- بند";
    expect(detailSections(long).map((s) => s.title)).toEqual([null, null]);
    expect(detailSections("مقدمة\nسطر ثانٍ\n- بند").map((s) => s.title)).toEqual([null, null]);
  });
  it("accent only when the owner's own heading says deliveries/gifts", () => {
    expect(detailSections("الكاميرات\n- هدية مجانية").map((s) => s.accent)).toEqual([false]);
    expect(detailSections("الهدايا\n- ألبوم").map((s) => s.accent)).toEqual([true]);
  });
});
