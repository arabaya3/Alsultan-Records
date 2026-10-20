import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { ALBUM_MAX_PIXELS } from "@/features/albums-admin/rules";

/**
 * RAW decoding (CR2, CR3, NEF, NRW, ARW, DNG, RAF, ORF, RW2, PEF, SRW) with LibRaw compiled to WebAssembly
 * (npm `libraw-wasm` 1.6.0 — bindings ISC; LibRaw itself LGPL-2.1 / CDDL-1.0). No native binaries, no external
 * service; client files never leave our infrastructure.
 *
 * Library behaviour (measured, docs/album-upload-release.md §3): `open()` only parses the header (≈ 5–20 ms) and
 * `metadata()` then reports the output width/height — so the pixel limit is enforced BEFORE `imageData()`, which
 * does the expensive demosaic (1–2 s, RAF/X-Trans ≈ 16 s). The module is a pthreads build with a fixed 256 MB
 * SharedArrayBuffer heap; `imageData().data` is returned as its own ArrayBuffer, and is copied anyway if it ever
 * is a view of that heap, so the result never points at memory LibRaw reuses or frees.
 *
 * Each decode runs in its own short-lived worker thread: a synchronous WebAssembly decode cannot be interrupted
 * from the same thread, so the timeout terminates the worker (and frees its whole heap). The .wasm is compiled
 * once per server instance and handed to each worker. Any failure — WebAssembly instantiation included — is
 * reported as an error, never a pending promise. The original is only read here; callers keep it on failure.
 */
export type DecodedRaw = { data: Buffer; width: number; height: number; channels: 3 };

export const RAW_DECODE_TIMEOUT_MS = Number(process.env.ALBUM_RAW_DECODE_TIMEOUT_MS) || 40_000;

function libDir(): string {
  // Shipped with the function via outputFileTracingIncludes (next.config.ts); libraw-wasm is a server external.
  return path.join(process.cwd(), "node_modules", "libraw-wasm", "dist");
}

let compiled: Promise<WebAssembly.Module> | null = null;
function wasmModule(): Promise<WebAssembly.Module> {
  compiled ??= readFile(path.join(libDir(), "libraw.wasm"))
    .then((bytes) => WebAssembly.compile(bytes))
    .catch((e) => {
      compiled = null; // allow a later retry
      throw new Error(`RAW decoder unavailable (${e instanceof Error ? e.message : e})`);
    });
  return compiled;
}

// Runs inside the worker (CommonJS eval context; the ESM module is loaded with import()).
const WORKER = String.raw`
const { parentPort, workerData } = require("node:worker_threads");
const { libUrl, wasm, input, maxPixels } = workerData;
const fail = (message) => { parentPort.postMessage({ error: message }); };
(async () => {
  let M;
  try {
    const factory = (await import(libUrl)).default;
    M = await new Promise((resolve, reject) => {
      factory({
        instantiateWasm: (imports, done) => {
          WebAssembly.instantiate(wasm, imports).then((inst) => done(inst, wasm), reject);
          return {};
        },
        print: () => {},
        printErr: () => {},
      }).then(resolve, reject);
    });
  } catch (e) {
    return fail("RAW decoder unavailable (" + (e && e.message ? e.message : String(e)) + ")");
  }
  const lr = new M.LibRaw();
  try {
    try {
      lr.open(new Uint8Array(input), { useCameraWb: true, outputBps: 8, outputColor: 1, userQual: 3, userFlip: -1 });
    } catch {
      return fail("RAW file could not be read (unsupported camera/compression or corrupt file)");
    }
    let md;
    try {
      md = lr.metadata(false) || {};
    } catch {
      return fail("RAW file could not be read (unsupported camera/compression or corrupt file)");
    }
    const w = Number(md.width) || 0, h = Number(md.height) || 0;
    const rw = Number(md.raw_width) || 0, rh = Number(md.raw_height) || 0;
    if (!w || !h) return fail("RAW file could not be read (no image size in the header)");
    // before the expensive decode: the output size, and the sensor size as a sanity bound for odd headers
    if (w * h > maxPixels || rw * rh > maxPixels * 1.5) return fail("image too large (" + w + "×" + h + " px)");
    let img;
    try {
      img = lr.imageData();
    } catch {
      return fail("RAW decode failed (unsupported compression or corrupt data)");
    }
    if (!img || !img.width || !img.height || img.colors !== 3 || img.bits !== 8) return fail("RAW decode produced an unexpected pixel format");
    if (img.width * img.height > maxPixels) return fail("image too large (" + img.width + "×" + img.height + " px)");
    if (img.data.byteLength !== img.width * img.height * 3) return fail("RAW decode returned a truncated image");
    // own the pixels: copy unless the array is already a standalone, non-shared buffer
    const own = img.data.byteOffset === 0 && img.data.buffer.byteLength === img.data.byteLength && !(img.data.buffer instanceof SharedArrayBuffer);
    const data = own ? img.data : new Uint8Array(img.data);
    parentPort.postMessage({ width: img.width, height: img.height, data }, [data.buffer]);
  } finally {
    try { lr.delete && lr.delete(); } catch {}
  }
})().catch((e) => fail("RAW decode failed (" + (e && e.message ? e.message : String(e)) + ")"));
`;

/** Full decode to 8-bit sRGB RGB. Rejects with a readable error for unsupported/corrupt files, oversize images,
 *  an unavailable decoder or a decode that exceeds `timeoutMs` (the worker is terminated). */
export async function decodeRaw(input: Uint8Array, opts: { timeoutMs?: number; maxPixels?: number; wasm?: WebAssembly.Module } = {}): Promise<DecodedRaw> {
  const timeoutMs = Math.max(1, opts.timeoutMs ?? RAW_DECODE_TIMEOUT_MS);
  const maxPixels = opts.maxPixels ?? ALBUM_MAX_PIXELS;
  const wasm = opts.wasm ?? (await wasmModule()); // `wasm`: tests only (a module that fails to instantiate)
  const copy = new Uint8Array(input); // the worker gets its own copy (transferred); the caller's buffer is untouched
  const libUrl = pathToFileURL(path.join(libDir(), "libraw.js")).href;
  return new Promise<DecodedRaw>((resolve, reject) => {
    let settled = false;
    const worker = new Worker(WORKER, { eval: true, workerData: { libUrl, wasm, input: copy, maxPixels }, transferList: [copy.buffer] });
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      fn();
    };
    const timer = setTimeout(() => finish(() => reject(new Error(`RAW decode timed out after ${Math.round(timeoutMs / 1000)} s`))), timeoutMs);
    worker.once("message", (m: { error?: string; width?: number; height?: number; data?: Uint8Array }) =>
      finish(() => {
        if (m.error || !m.data || !m.width || !m.height) return reject(new Error(m.error ?? "RAW decode failed"));
        resolve({ data: Buffer.from(m.data.buffer, m.data.byteOffset, m.data.byteLength), width: m.width, height: m.height, channels: 3 });
      }),
    );
    worker.once("error", (e) => finish(() => reject(new Error(`RAW decode failed (${e.message})`))));
    worker.once("exit", (code) => finish(() => reject(new Error(`RAW decode failed (worker exited ${code})`))));
  });
}
