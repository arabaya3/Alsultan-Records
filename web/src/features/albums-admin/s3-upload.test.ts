import { describe, expect, it } from "vitest";
import { PART_MIN, partCount, partLength, partSizeFor, partsProblem } from "@/lib/album-storage/multipart";
import { PART_CONCURRENCY, S3UploadDenied, uploadToS3, type PartSender, type S3UploadDeps } from "./s3-upload";

const file = (parts: number, tail = 100) => new Blob([new Uint8Array(PART_MIN * parts + tail)]);
const noWait = async () => {};

function harness(over: Partial<S3UploadDeps> = {}, sender?: PartSender) {
  const sentParts: number[] = [];
  const signed: number[][] = [];
  const deps: S3UploadDeps = {
    start: async () => ({ ok: true, partSize: PART_MIN, parts: [] }),
    sign: async (_id, ns) => {
      signed.push(ns);
      return { ok: true, urls: ns.map((n) => ({ n, url: `u:${n}` })) };
    },
    send: sender ?? (async (url, body, _s, on) => {
      sentParts.push(Number(url.slice(2)));
      on(body.size);
      return 200;
    }),
    wait: noWait,
    ...over,
  };
  return { deps, sentParts, signed };
}

describe("multipart plan", () => {
  it("parts add up to the file and the last one is the rest", () => {
    const size = PART_MIN * 3 + 5;
    const ps = partSizeFor(size);
    expect(partCount(size, ps)).toBe(4);
    expect(partLength(size, ps, 4)).toBe(5);
    expect(partLength(size, ps, 5)).toBe(0);
    expect(partLength(size, ps, 0)).toBe(0);
    expect(partLength(size, ps, 1.5)).toBe(0);
  });
  it("stays under the part limit for a huge file", () => {
    const size = 200 * 1024 ** 3;
    expect(partCount(size, partSizeFor(size))).toBeLessThanOrEqual(9000);
  });
  it("rejects missing, extra or wrong-sized parts", () => {
    const size = PART_MIN + 10;
    const good = [{ n: 2, size: 10 }, { n: 1, size: PART_MIN }];
    expect(partsProblem(good, size, PART_MIN)).toBeNull();
    expect(partsProblem(good.slice(0, 1), size, PART_MIN)).toBeTruthy();
    expect(partsProblem([{ n: 1, size: PART_MIN }, { n: 2, size: 9 }], size, PART_MIN)).toBeTruthy();
    expect(partsProblem([{ n: 1, size: PART_MIN }, { n: 3, size: 10 }], size, PART_MIN)).toBeTruthy();
  });
});

describe("uploadToS3", () => {
  it("sends every part and reports the full size", async () => {
    const { deps, sentParts } = harness();
    let last = 0;
    await uploadToS3("p", file(3), deps, new AbortController().signal, (s) => (last = s));
    expect([...sentParts].sort()).toEqual([1, 2, 3, 4]);
    expect(last).toBe(file(3).size);
  });

  it("resumes: parts S3 already holds are not sent again, a wrong-sized one is", async () => {
    const { deps, sentParts } = harness({
      start: async () => ({ ok: true, partSize: PART_MIN, parts: [{ n: 1, size: PART_MIN }, { n: 2, size: 5 }] }),
    });
    const progress: number[] = [];
    await uploadToS3("p", file(3), deps, new AbortController().signal, (s) => progress.push(s));
    expect([...sentParts].sort()).toEqual([2, 3, 4]);
    expect(progress[0]).toBe(PART_MIN);
  });

  it("runs parts in parallel, within the limit", async () => {
    let now = 0, peak = 0;
    const { deps } = harness({}, async (_u, b, _s, on) => {
      peak = Math.max(peak, ++now);
      await new Promise((r) => setTimeout(r, 1));
      now--;
      on(b.size);
      return 200;
    });
    await uploadToS3("p", file(9), deps, new AbortController().signal, () => {});
    expect(peak).toBe(PART_CONCURRENCY);
  });

  it("retries a failed part with a fresh URL", async () => {
    let fails = 2;
    const { deps, signed } = harness({}, async (url, b) => {
      if (url === "u:1" && fails-- > 0) return 503;
      return b.size ? 200 : 200;
    });
    await uploadToS3("p", file(0, 10), deps, new AbortController().signal, () => {});
    expect(signed.flat().filter((n) => n === 1).length).toBe(3);
  });

  it("gives up after the retries and stops the other parts", async () => {
    const { deps } = harness({}, async () => 500);
    await expect(uploadToS3("p", file(5), deps, new AbortController().signal, () => {})).rejects.toThrow();
  });

  it("access revoked during the upload: no retry loop, denied error", async () => {
    let calls = 0;
    const { deps } = harness({
      sign: async () => {
        calls++;
        return { ok: false, denied: true, message: "لا صلاحية" };
      },
    });
    await expect(uploadToS3("p", file(5), deps, new AbortController().signal, () => {})).rejects.toBeInstanceOf(S3UploadDenied);
    expect(calls).toBeLessThanOrEqual(PART_CONCURRENCY);
  });

  it("refused at the start: nothing is sent", async () => {
    const { deps, sentParts } = harness({ start: async () => ({ ok: false, denied: true, message: "x" }) });
    await expect(uploadToS3("p", file(1), deps, new AbortController().signal, () => {})).rejects.toBeInstanceOf(S3UploadDenied);
    expect(sentParts).toEqual([]);
  });

  it("cancel stops the upload", async () => {
    const ac = new AbortController();
    const { deps, sentParts } = harness({}, async (url, b, signal) => {
      sentParts.push(Number(url.slice(2)));
      ac.abort();
      signal.throwIfAborted();
      return b.size ? 200 : 200;
    });
    await expect(uploadToS3("p", file(40), deps, ac.signal, () => {})).rejects.toThrow();
    expect(sentParts.length).toBeLessThanOrEqual(PART_CONCURRENCY);
  });
});
