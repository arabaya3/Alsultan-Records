import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /m published-media route with a simulated database and storage (no network): revalidation (304) only after the
 * publication check, Range still forwarded, withdrawn media never reaches storage. The real stack is covered by the
 * consent-revocation and photos e2e specs.
 */
let published = true;
vi.mock("@/features/public-content/client", async (orig) => {
  const real = await orig<typeof import("@/features/public-content/client")>();
  const b = {
    select: () => b,
    eq: () => b,
    maybeSingle: async () => ({
      data: published ? { bucket: "public-media", path: "events/e/a/display.webp", variants: { display: "events/e/a/display.webp", thumb: "events/e/a/thumb.webp" } } : null,
      error: null,
    }),
  };
  return { ...real, getPublicClient: () => ({ from: () => b }) };
});

const ASSET = "11111111-2222-4333-8444-555555555555";
const call = async (headers: Record<string, string> = {}) => {
  const { GET } = await import("./route");
  return GET(new Request(`http://x/m/${ASSET}/display`, { headers }), { params: Promise.resolve({ assetId: ASSET, variant: "display" }) });
};
const sent = (f: ReturnType<typeof vi.fn>) => (f.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>;

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://supabase.test");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "anon");
  published = true;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("/m/[assetId]/[variant]", () => {
  it("200 keeps its private 60 s cache, never stored by a CDN, and passes the ETag", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1]), { status: 200, headers: { "content-type": "image/webp", etag: '"v1"' } })));
    const r = await call();
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toMatch(/^private, max-age=60\b/);
    expect(r.headers.get("cdn-cache-control")).toBe("no-store");
    expect(r.headers.get("etag")).toBe('"v1"');
  });

  it("304: the browser's ETag is forwarded after the publication check, and an unchanged file costs no bytes", async () => {
    const f = vi.fn(async () => new Response(null, { status: 304, headers: { etag: '"v1"' } }));
    vi.stubGlobal("fetch", f);
    const r = await call({ "if-none-match": '"v1"' });
    expect(r.status).toBe(304);
    expect(sent(f)).toMatchObject({ "If-None-Match": '"v1"' });
    expect(r.headers.get("etag")).toBe('"v1"');
    expect(r.headers.get("cache-control")).toMatch(/^private, max-age=60\b/);
    expect(r.headers.get("cdn-cache-control")).toBe("no-store");
  });

  it("withdrawn media → 404 no-store even with the browser's ETag; storage is not asked", async () => {
    published = false;
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const r = await call({ "if-none-match": '"v1"' });
    expect(r.status).toBe(404);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(f).not.toHaveBeenCalled();
  });

  it("Range is still forwarded and a 206 passes through", async () => {
    const f = vi.fn(async () => new Response(new Uint8Array([1]), { status: 206, headers: { "content-type": "video/mp4", "content-range": "bytes 0-0/9" } }));
    vi.stubGlobal("fetch", f);
    const r = await call({ range: "bytes=0-0" });
    expect(r.status).toBe(206);
    expect(sent(f)).toMatchObject({ Range: "bytes=0-0" });
    expect(sent(f)).not.toHaveProperty("If-None-Match");
  });
});
