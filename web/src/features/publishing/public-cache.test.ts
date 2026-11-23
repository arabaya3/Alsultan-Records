import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const updateTag = vi.hoisted(() => vi.fn());
const revalidateTag = vi.hoisted(() => vi.fn());
const afterCallbacks = vi.hoisted(() => [] as (() => Promise<void>)[]);
vi.mock("next/cache", () => ({ updateTag, revalidateTag }));
vi.mock("next/server", () => ({ after: (fn: () => Promise<void>) => void afterCallbacks.push(fn) }));

describe("expirePublicProjects", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    updateTag.mockClear();
    revalidateTag.mockClear();
    afterCallbacks.length = 0;
  });
  afterEach(() => vi.useRealTimers());

  it("expires the project and media reads now, and once more after renders in flight have settled", async () => {
    const { expirePublicProjects } = await import("./public-cache");
    expirePublicProjects();

    // now: the next request re-reads
    expect(updateTag.mock.calls.map((c) => c[0]).sort()).toEqual(["media", "projects"]);
    expect(revalidateTag).not.toHaveBeenCalled();

    // later, inside the request's after(): not before the settle time…
    expect(afterCallbacks).toHaveLength(1);
    const later = afterCallbacks[0]();
    await vi.advanceTimersByTimeAsync(4_900);
    expect(revalidateTag).not.toHaveBeenCalled();
    // …then both tags again, with no stale page allowed (expire: 0), so a page stored by an older render is dropped
    await vi.advanceTimersByTimeAsync(200);
    await later;
    expect(revalidateTag.mock.calls.map((c) => c[0]).sort()).toEqual(["media", "projects"]);
    for (const c of revalidateTag.mock.calls) expect(c[1]).toEqual({ expire: 0 });
    expect(updateTag).toHaveBeenCalledTimes(2); // nothing extra
  });
});
