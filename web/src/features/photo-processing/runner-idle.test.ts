import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * runPhotoJobsIfIdle (the per-file upload hand-off): while a run is active, further calls do not queue a second run;
 * they leave a note and the active caller runs once more. Database simulated: the claim RPC finds no job after a delay.
 */
const claims: number[] = [];
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async (name: string) => {
      if (name === "claim_photo_jobs") {
        claims.push(Date.now());
        await new Promise((r) => setTimeout(r, 30));
      }
      return { data: [], error: null };
    },
    from: () => ({ select: () => ({ eq: () => ({ lt: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) }),
  }),
}));
vi.mock("@/lib/album-storage", () => ({ albumStore: () => ({}) }));
vi.mock("@/lib/album-storage/s3", () => ({ s3MultipartAbort: async () => {} }));
vi.mock("next/cache", () => ({ revalidateTag: () => {} }));

beforeEach(() => {
  claims.length = 0;
});

describe("runPhotoJobsIfIdle", () => {
  it("a call during an active run does not start a second run; the active caller runs once more for it", async () => {
    const { runPhotoJobsIfIdle } = await import("./runner");
    const first = runPhotoJobsIfIdle({ limit: 1 });
    await new Promise((r) => setTimeout(r, 5));
    const second = await runPhotoJobsIfIdle({ limit: 1 });
    expect(second).toBeNull(); // returned at once, nothing queued behind the active run
    const r = await first;
    expect(r).not.toBeNull();
    expect(claims.length).toBe(2); // the first run, then one coalesced re-run for the second call
  });

  it("no call during the run → exactly one run", async () => {
    const { runPhotoJobsIfIdle } = await import("./runner");
    await runPhotoJobsIfIdle({ limit: 1 });
    expect(claims.length).toBe(1);
  });
});
