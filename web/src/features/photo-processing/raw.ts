import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ALBUM_MAX_PIXELS } from "@/features/albums-admin/rules";

/**
 * RAW decoding (CR2, CR3, NEF, NRW, ARW, DNG, RAF, ORF, RW2, PEF, SRW) with LibRaw compiled to WebAssembly
 * (npm `libraw-wasm` 1.6.0 — bindings ISC; LibRaw itself LGPL-2.1 / CDDL-1.0). Runs inside the Node.js worker
 * (no native binaries, no external service; client files never leave our infrastructure).
 *
 * Output: full-size, demosaiced, camera white balance, sRGB, 8-bit RGB, orientation applied (LibRaw uses the
 * file's flip). Measured in Node 22 on the CC0 raw.pixls.us samples: 0.5–2.3 s per file (RAF/X-Trans ≈ 16 s),
 * peak RSS ≈ 600 MB — inside the 60 s / 2 GB worker budget. See docs/album-upload-release.md for the format table
 * (one known gap: Sony «compressed HQ» ARW from the newest bodies).
 *
 * The package targets browsers (Web Worker + fetch for the .wasm); here the Emscripten module is instantiated
 * directly from the .wasm bytes on disk (`instantiateWasm`), single-threaded.
 */
type LibRawImage = { width: number; height: number; colors: number; bits: number; data: Uint8Array };
type LibRawInstance = {
  open(buf: Uint8Array, settings?: Record<string, unknown>): unknown;
  metadata(full?: boolean): Record<string, unknown>;
  imageData(): LibRawImage;
  delete?(): void;
};
type LibRawModule = { LibRaw: new () => LibRawInstance };
type Factory = (opts: Record<string, unknown>) => Promise<LibRawModule>;

let modulePromise: Promise<LibRawModule> | null = null;

function wasmPath(): string {
  // Shipped with the function via outputFileTracingIncludes (next.config.ts); libraw-wasm is a server external.
  return path.join(process.cwd(), "node_modules", "libraw-wasm", "dist", "libraw.wasm");
}

async function libraw(): Promise<LibRawModule> {
  modulePromise ??= (async () => {
    const wasm = await readFile(wasmPath());
    const factory = (await import(/* webpackIgnore: true */ "libraw-wasm/dist/libraw.js")).default as Factory;
    return factory({
      instantiateWasm: (imports: WebAssembly.Imports, done: (i: WebAssembly.Instance, m: WebAssembly.Module) => void) => {
        WebAssembly.instantiate(wasm, imports).then((r) => done(r.instance, r.module));
        return {};
      },
      print: () => {},
      printErr: () => {},
    });
  })().catch((e) => {
    modulePromise = null; // allow a later retry
    throw e;
  });
  return modulePromise;
}

export type DecodedRaw = { data: Buffer; width: number; height: number; channels: 3 };

/** Full decode to 8-bit sRGB RGB. Throws a readable error for unsupported/corrupt files or oversize images. */
export async function decodeRaw(input: Uint8Array): Promise<DecodedRaw> {
  const M = await libraw();
  const lr = new M.LibRaw();
  try {
    try {
      lr.open(new Uint8Array(input), { useCameraWb: true, outputBps: 8, outputColor: 1, userQual: 3, userFlip: -1 });
    } catch {
      throw new Error("RAW file could not be read (unsupported camera/compression or corrupt file)");
    }
    let img: LibRawImage;
    try {
      img = lr.imageData();
    } catch {
      throw new Error("RAW decode failed (unsupported compression or corrupt data)");
    }
    if (!img?.width || !img?.height || img.colors !== 3 || img.bits !== 8) throw new Error("RAW decode produced an unexpected pixel format");
    if (img.width * img.height > ALBUM_MAX_PIXELS) throw new Error(`image too large (${img.width}×${img.height} px)`);
    const data = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength);
    if (data.length !== img.width * img.height * 3) throw new Error("RAW decode returned a truncated image");
    return { data, width: img.width, height: img.height, channels: 3 };
  } finally {
    try {
      lr.delete?.();
    } catch {
      /* freed with the module */
    }
  }
}
