import { describe, expect, it } from "vitest";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AlbumStore } from "@/lib/album-storage";
import { acceptClientVariants } from "./client-variant-accept";

const webp = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: "#456" } }).webp({ quality: 76 }).toBuffer();
const row = { id: "00000000-0000-4000-8000-000000000001", storage_path_original: "albums/a/00000000-0000-4000-8000-000000000001/original.jpg" };
const original = { width: 6000, height: 4000 };

function fakes(files: Record<string, Buffer | null>, opts: { claimRows?: number; completeOk?: boolean } = {}) {
  const calls: { op: string; args: unknown }[] = [];
  const store = { download: async (p: string) => files[p] ?? null } as unknown as AlbumStore;
  const chain = (op: string, payload: unknown) => {
    const filters: unknown[] = [];
    const c = {
      eq: (...a: unknown[]) => (filters.push(a), c),
      is: (...a: unknown[]) => (filters.push(a), c),
      select: async () => (calls.push({ op, args: { payload, filters } }), { data: Array.from({ length: opts.claimRows ?? 1 }, () => ({ id: row.id })), error: null }),
      then: (r: (v: unknown) => void) => (calls.push({ op, args: { payload, filters } }), r({ data: null, error: null })),
    };
    return c;
  };
  const admin = {
    from: () => ({ update: (payload: unknown) => chain("update", payload) }),
    rpc: async (name: string, args: unknown) => (calls.push({ op: name, args }), { data: opts.completeOk ?? true, error: null }),
  } as unknown as SupabaseClient;
  return { deps: { store, admin }, calls };
}

describe("acceptClientVariants", () => {
  it("valid copies → row claimed from `uploading` and completed with the fixed variant paths", async () => {
    const base = "albums/a/00000000-0000-4000-8000-000000000001/";
    const { deps, calls } = fakes({ [`${base}thumb.webp`]: await webp(480, 320), [`${base}display.webp`]: await webp(1600, 1067) });
    expect(await acceptClientVariants(deps, row, original, "jpeg")).toBe("ready");
    const claim = calls[0].args as { payload: { upload_status: string }; filters: unknown[][] };
    expect(claim.payload.upload_status).toBe("processing");
    expect(claim.filters).toContainEqual(["upload_status", "uploading"]);
    expect(calls[1]).toEqual({
      op: "complete_photo_job",
      args: { p_id: row.id, p_ok: true, p_error: null, p_width: 6000, p_height: 4000, p_variants: { thumb: `${base}thumb.webp`, display: `${base}display.webp` } },
    });
  });

  it("a wrong or missing copy changes nothing (server worker fallback)", async () => {
    const base = "albums/a/00000000-0000-4000-8000-000000000001/";
    const wrong = fakes({ [`${base}thumb.webp`]: await webp(480, 320), [`${base}display.webp`]: await webp(800, 600) });
    expect(await acceptClientVariants(wrong.deps, row, original, "jpeg")).toBe("fallback");
    expect(wrong.calls).toEqual([]);
    const missing = fakes({ [`${base}thumb.webp`]: await webp(480, 320) });
    expect(await acceptClientVariants(missing.deps, row, original, "jpeg")).toBe("fallback");
    expect(missing.calls).toEqual([]);
  });

  it("a row no longer `uploading` (cancelled meanwhile) is not touched", async () => {
    const base = "albums/a/00000000-0000-4000-8000-000000000001/";
    const { deps, calls } = fakes({ [`${base}thumb.webp`]: await webp(480, 320), [`${base}display.webp`]: await webp(1600, 1067) }, { claimRows: 0 });
    expect(await acceptClientVariants(deps, row, original, "jpeg")).toBe("fallback");
    expect(calls.map((c) => c.op)).toEqual(["update"]);
  });

  it("complete refused → handed to the worker as `pending`", async () => {
    const base = "albums/a/00000000-0000-4000-8000-000000000001/";
    const { deps, calls } = fakes({ [`${base}thumb.webp`]: await webp(480, 320), [`${base}display.webp`]: await webp(1600, 1067) }, { completeOk: false });
    expect(await acceptClientVariants(deps, row, original, "jpeg")).toBe("queued");
    expect((calls[2].args as { payload: { upload_status: string } }).payload.upload_status).toBe("pending");
  });
});
