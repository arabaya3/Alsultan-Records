import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** /a active-logo route with a simulated database and storage (no network): revalidation (304) only for the active logo. */
let active = true;
vi.mock("@/features/public-content/client", () => ({
  getPublicClient: () => ({ rpc: async () => ({ data: active ? "logos/l/logo.webp" : null, error: null }) }),
}));

const LOGO = "11111111-2222-4333-8444-555555555555";
const call = async (headers: Record<string, string> = {}) => {
  const { GET } = await import("./route");
  return GET(new Request(`http://x/a/${LOGO}`, { headers }), { params: Promise.resolve({ logoId: LOGO }) });
};

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://supabase.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "anon");
  active = true;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("/a/[logoId]", () => {
  it("200: raster image, private 5 min, never stored by a CDN, ETag passed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1]), { status: 200, headers: { "content-type": "image/webp", etag: '"v1"' } })));
    const r = await call();
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("private, max-age=300");
    expect(r.headers.get("cdn-cache-control")).toBe("no-store");
    expect(r.headers.get("etag")).toBe('"v1"');
  });

  it("304: the browser's ETag is forwarded after the active-logo check, an unchanged logo costs no bytes", async () => {
    const f = vi.fn(async () => new Response(null, { status: 304, headers: { etag: '"v1"' } }));
    vi.stubGlobal("fetch", f);
    const r = await call({ "if-none-match": '"v1"' });
    expect(r.status).toBe(304);
    expect((f.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toMatchObject({ "If-None-Match": '"v1"' });
    expect(r.headers.get("etag")).toBe('"v1"');
    expect(r.headers.get("cache-control")).toBe("private, max-age=300");
    expect(r.headers.get("cdn-cache-control")).toBe("no-store");
  });

  it("a logo that is no longer active → 404 no-store even with the browser's ETag; storage is not asked", async () => {
    active = false;
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const r = await call({ "if-none-match": '"v1"' });
    expect(r.status).toBe(404);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(f).not.toHaveBeenCalled();
  });

  it("SVG or any non-raster type is never served", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<svg/>", { status: 200, headers: { "content-type": "image/svg+xml" } })));
    expect((await call()).status).toBe(404);
  });
});
