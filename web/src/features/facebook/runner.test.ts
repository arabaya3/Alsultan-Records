import { afterEach, describe, expect, it, vi } from "vitest";

/** The run loop with a fake database and a simulated Meta: nothing leaves this process. */
const state = vi.hoisted(() => ({ sb: null as unknown }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.sb }));
import { runFacebookJobs } from "./runner";

type Up = { patch: Record<string, unknown>; eqs: [string, unknown][] };
function fakeDb(jobs: unknown[], rowsUpdated: () => number) {
  const updates: Up[] = [];
  const sb = {
    rpc: async (fn: string) => (fn === "claim_facebook_jobs" ? { data: jobs, error: null } : { data: "EAAB-test-token-0123456789", error: null }),
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { page_id: "123456789", status: "connected", storage_path: "reels/a.mp4" }, error: null }) }) }),
      update: (patch: Record<string, unknown>) => {
        const u: Up = { patch, eqs: [] };
        updates.push(u);
        const chain = {
          eq: (k: string, v: unknown) => (u.eqs.push([k, v]), chain),
          select: async () => ({ data: Array.from({ length: rowsUpdated() }, () => ({ id: "x" })), error: null }),
          then: (ok: (v: unknown) => void) => ok({ error: null }),
        };
        return chain;
      },
    }),
    storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: "https://s/a.mp4" } }) }) },
  };
  return { sb, updates };
}
const job = (id: string, lease: string) => ({ id, reel_video_id: "r", caption: null, page_id: "123456789", meta_video_id: null, meta_post_id: null, attempts: 3, lease_token: lease });

afterEach(() => vi.unstubAllGlobals());

describe("runFacebookJobs", () => {
  it("no time left → job handed back, conditioned on its lease, the attempt not counted, nothing sent", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const db = fakeDb([job("a", "L-a")], () => 1);
    state.sb = db.sb;
    const times = [0, 20_000];
    const out = await runFacebookJobs(() => times.shift() ?? 20_000);
    expect(out.deferred).toBe(1);
    expect(f).not.toHaveBeenCalled();
    expect(db.updates[0]!.patch).toMatchObject({ status: "queued", attempts: 2, lease_token: null });
    expect(db.updates[0]!.eqs).toContainEqual(["lease_token", "L-a"]);
  });

  it("the worker lost its lease → the run stops: one request only, the next job is untouched", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ video_id: "9001" }), { status: 200 }));
    vi.stubGlobal("fetch", f);
    const db = fakeDb([job("a", "L-a"), job("b", "L-b")], () => 0);
    state.sb = db.sb;
    const out = await runFacebookJobs(() => 0);
    expect(out.saveErrors).toBe(1);
    expect(f).toHaveBeenCalledTimes(1); // start; its id could not be saved, so no upload and no finish
    expect(db.updates.every((u) => u.eqs.some(([k, v]) => k === "lease_token" && v === "L-a"))).toBe(true);
  });

  it("every write of a full run is conditioned on the job's lease", async () => {
    const replies = [{ video_id: "9001" }, { status: {} }, { success: true }, { success: true, post_id: "9001" }];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(replies.shift()), { status: 200 })));
    const db = fakeDb([job("a", "L-a")], () => 1);
    state.sb = db.sb;
    await runFacebookJobs(() => 0);
    expect(db.updates.length).toBeGreaterThan(3);
    for (const u of db.updates) expect(u.eqs).toContainEqual(["lease_token", "L-a"]);
    expect(db.updates.some((u) => u.patch.status === "processing")).toBe(true);
  });
});
