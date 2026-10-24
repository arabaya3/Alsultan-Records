import { describe, expect, it } from "vitest";
import { bidiDir } from "./bidi";

describe("bidiDir", () => {
  it("Arabic text that starts with a Latin word stays RTL («DJ وتنسيق الصوت»)", () => {
    expect(bidiDir("DJ وتنسيق الصوت")).toBe("rtl");
    expect(bidiDir("حفل زفاف 2026")).toBe("rtl");
  });
  it("text without Arabic keeps auto; non-strings are auto", () => {
    expect(bidiDir("Sultan Records")).toBe("auto");
    expect(bidiDir(null)).toBe("auto");
    expect(bidiDir(42)).toBe("auto");
  });
});
