import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeRaw } from "./raw";

/**
 * RAW decoder guards (review item 3) on the CC0 raw.pixls.us samples in .cache/raw-samples (gitignored; the suite
 * is skipped when they are absent). Each decode runs in its own worker thread.
 */
const DIR = ".cache/raw-samples";
const has = existsSync(`${DIR}/sample-a7m3.arw`);
const read = (f: string) => new Uint8Array(readFileSync(`${DIR}/${f}`));

describe.skipIf(!has)("decodeRaw", () => {
  it("decodes the largest samples (NRW 26 MB, ARW 24 MP) to whole-frame RGB it owns", async () => {
    for (const [f, w, h] of [["sample.nrw", 0, 0], ["sample-a7m3.arw", 6024, 4024]] as const) {
      const r = await decodeRaw(read(f));
      expect(r.data.length).toBe(r.width * r.height * 3);
      if (w) expect([r.width, r.height]).toEqual([w, h]);
      // not a view of the (shared) LibRaw heap: its own, exactly-sized, non-shared memory
      expect(r.data.buffer instanceof SharedArrayBuffer).toBe(false);
      expect(r.data.buffer.byteLength).toBe(r.data.length);
    }
  }, 120_000);

  it("rejects an oversize image from the header, before the expensive decode", async () => {
    const input = read("sample-a7m3.arw");
    let t = Date.now();
    await decodeRaw(input);
    const full = Date.now() - t;
    t = Date.now();
    await expect(decodeRaw(input, { maxPixels: 1_000_000 })).rejects.toThrow(/image too large \(6024×4024 px\)/);
    const early = Date.now() - t;
    expect(early).toBeLessThan(full);
  }, 120_000);

  it("corrupt, truncated, unsupported: a readable error, the input is untouched", async () => {
    const nef = read("sample.nef");
    const before = Buffer.from(nef).toString("base64").length;
    await expect(decodeRaw(new Uint8Array(4096).fill(7))).rejects.toThrow(/RAW file could not be read/);
    await expect(decodeRaw(nef.subarray(0, 1_000_000))).rejects.toThrow(/RAW (file could not be read|decode failed|decode returned a truncated)/);
    await expect(decodeRaw(read("sample.arw"))).rejects.toThrow(/RAW (file could not be read|decode failed)/); // Sony «compressed HQ» (ILCE-7M5)
    expect(Buffer.from(nef).toString("base64").length).toBe(before);
  }, 120_000);

  it("a decode that exceeds the timeout is stopped (worker terminated), and the next file still decodes", async () => {
    const t = Date.now();
    await expect(decodeRaw(read("sample.raf"), { timeoutMs: 300 })).rejects.toThrow(/timed out/);
    expect(Date.now() - t).toBeLessThan(5_000);
    const ok = await decodeRaw(read("sample.cr3"));
    expect(ok.width).toBe(5118);
  }, 120_000);

  it("a WebAssembly module that fails to instantiate is an error, not a pending promise", async () => {
    // (module (import "x" "y" (func))) — instantiation rejects with a LinkError
    const bad = new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 2, 7, 1, 1, 120, 1, 121, 0, 0]));
    await expect(decodeRaw(read("sample.cr3"), { wasm: bad, timeoutMs: 20_000 })).rejects.toThrow(/RAW decoder unavailable|RAW decode failed/);
    expect((await decodeRaw(read("sample.cr3"))).height).toBe(3412);
  }, 120_000);
});
