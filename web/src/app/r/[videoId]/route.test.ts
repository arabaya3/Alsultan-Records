import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** /r reel-file route with a simulated database and stores (no network): launch gate, publication, link lifetime. */
let published = true;
const rpc = vi.fn(async () => ({ data: published ? [{ provider: "s3", path: "reels/x.mp4" }] : [], error: null }));
vi.mock("@/features/public-content/client", () => ({ getPublicClient: () => ({ rpc }) }));
const s3SignedGet = vi.fn<(path: string, seconds: number) => Promise<string>>(async () => "https://store.test/reels/x.mp4?sig=1");
vi.mock("@/lib/album-storage/s3", () => ({ s3SignedGet: (p: string, s: number) => s3SignedGet(p, s) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => null }));

const VIDEO = "11111111-2222-4333-8444-555555555555";
const call = async () => {
  const { GET } = await import("./route");
  return GET(new Request(`http://x/r/${VIDEO}`), { params: Promise.resolve({ videoId: VIDEO }) });
};

beforeEach(() => {
  published = true;
  rpc.mockClear();
  s3SignedGet.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe("/r/[videoId]", () => {
  it("viewer off (REELS_VIEWER unset): 404 no-store, the database and the store are not asked", async () => {
    const r = await call();
    expect(r.status).toBe(404);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(rpc).not.toHaveBeenCalled();
    expect(s3SignedGet).not.toHaveBeenCalled();
  });

  it("viewer on: a published reel redirects to a signed link that lasts 10 minutes, never cached", async () => {
    vi.stubEnv("REELS_VIEWER", "1");
    const r = await call();
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("https://store.test/reels/x.mp4?sig=1");
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(s3SignedGet.mock.calls[0][1]).toBe(600);
  });

  it("viewer on: an unpublished reel → 404, no link minted", async () => {
    vi.stubEnv("REELS_VIEWER", "1");
    published = false;
    expect((await call()).status).toBe(404);
    expect(s3SignedGet).not.toHaveBeenCalled();
  });
});
