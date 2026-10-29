/**
 * CONTRACT tests against a SIMULATED Meta Graph API (request shapes from the official reels-publishing docs,
 * read 2026-10-28). This is not a verification against Meta: no app, token or Page was used.
 */
import { describe, expect, it, vi } from "vitest";
import { runJob, type Deps, type Job, type JobPatch } from "./worker";

type Call = { url: string; init: RequestInit };
const TOKEN = "EAAB-test-page-token-0123456789";

function meta(handlers: { start?: () => unknown; upload?: () => unknown; finish?: () => unknown; status?: () => unknown }) {
  const calls: Call[] = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const reply = (v: unknown) => (v instanceof Response ? v : json(v));
  const f = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const body = String(init.body ?? "");
    if (url.includes("rupload.facebook.com")) return reply(handlers.upload?.() ?? { success: true });
    if (url.includes("/video_reels") && body.includes("upload_phase=start")) return reply(handlers.start?.() ?? { video_id: "9001" });
    if (url.includes("/video_reels") && body.includes("upload_phase=finish")) return reply(handlers.finish?.() ?? { success: true, post_id: "9001" });
    if (url.includes("fields=status")) return reply(handlers.status?.() ?? { status: { uploading_phase: { status: "not_started" } } });
    return json({ error: { message: "unexpected", code: 100 } }, 400);
  });
  return { f, calls, json };
}

function deps(f: Deps["fetch"], over: Partial<Deps> = {}) {
  const saved: JobPatch[] = [];
  const d: Deps = {
    fetch: f,
    token: TOKEN,
    pageId: "123456789",
    signedFileUrl: async () => "https://storage.example/reels/a.mp4?token=signed",
    save: async (_id, p) => void saved.push(p),
    connectionLost: vi.fn(async () => {}),
    now: () => new Date("2026-10-28T10:00:00Z"),
    ...over,
  };
  return { d, saved };
}

const job = (o: Partial<Job> = {}): Job => ({ id: "j1", reel_video_id: "r1", caption: "برومو عرس", page_id: "123456789", meta_video_id: null, meta_post_id: null, attempts: 1, ...o });

describe("Facebook reel job (simulated Meta)", () => {
  it("happy path: start → hosted upload → finish (PUBLISHED); stores the Meta id before uploading", async () => {
    const m = meta({});
    const { d, saved } = deps(m.f);
    const r = await runJob(job(), d);
    expect(r).toMatchObject({ status: "published", meta_post_id: "9001" });
    expect(saved[0]).toEqual({ status: "publishing", meta_video_id: "9001" }); // persisted first
    const kinds = m.calls.map((c) => (c.url.includes("rupload") ? "upload" : String(c.init.body ?? "").match(/upload_phase=(\w+)/)?.[1] ?? "status"));
    expect(kinds).toEqual(["start", "status", "upload", "finish"]);
    const up = m.calls.find((c) => c.url.includes("rupload"))!;
    expect(up.url).toContain("/video-upload/v26.0/9001");
    expect((up.init.headers as Record<string, string>).file_url).toMatch(/^https:\/\//);
    expect(String(m.calls.at(-1)!.init.body)).toContain("video_state=PUBLISHED");
  });

  it("a retry with a stored meta_video_id never calls start again (no second Facebook post)", async () => {
    const m = meta({ status: () => ({ status: { uploading_phase: { status: "complete" } } }) });
    const { d } = deps(m.f);
    await runJob(job({ meta_video_id: "9001", attempts: 2 }), d);
    expect(m.calls.some((c) => String(c.init.body ?? "").includes("upload_phase=start"))).toBe(false);
    expect(m.calls.some((c) => c.url.includes("rupload"))).toBe(false); // already uploaded
  });

  it("finish succeeded but the response was lost → next run sees publishing complete and records it, without finishing again", async () => {
    const m = meta({ status: () => ({ status: { uploading_phase: { status: "complete" }, publishing_phase: { status: "complete" } } }) });
    const { d } = deps(m.f);
    const r = await runJob(job({ meta_video_id: "9001", attempts: 2 }), d);
    expect(r).toMatchObject({ status: "published", meta_post_id: "9001" });
    expect(m.calls.some((c) => String(c.init.body ?? "").includes("upload_phase=finish"))).toBe(false);
  });

  it("an already published job is a no-op (double click / duplicate worker)", async () => {
    const m = meta({});
    const { d } = deps(m.f);
    expect(await runJob(job({ meta_post_id: "777" }), d)).toMatchObject({ status: "published", meta_post_id: "777" });
    expect(m.f).not.toHaveBeenCalled();
  });

  it("expired token (code 190) → connection marked lost, job waits for reconnection (not failed), Meta id kept", async () => {
    const m = meta({ status: () => m.json({ error: { message: "Error validating access token: Session has expired access_token=EAAB-secret", code: 190 } }, 400) });
    const { d, saved } = deps(m.f);
    const r = await runJob(job({ meta_video_id: "9001" }), d);
    expect(r.status).toBe("awaiting_connection");
    expect(d.connectionLost).toHaveBeenCalledTimes(1);
    expect(saved.at(-1)).not.toHaveProperty("meta_video_id"); // the stored id is not cleared
    expect(JSON.stringify(saved)).not.toContain(TOKEN);
    expect(String((d.connectionLost as ReturnType<typeof vi.fn>).mock.calls[0]![0])).not.toContain("EAAB-secret");
  });

  it("permission removed (code 200) is treated like a lost connection", async () => {
    const m = meta({ start: () => m.json({ error: { message: "Permissions error", code: 200 } }, 403) });
    const { d } = deps(m.f);
    expect((await runJob(job(), d)).status).toBe("awaiting_connection");
  });

  it("partial failure: upload ok, finish hits a Meta 500 → requeued with backoff, keeps the Meta id; site untouched", async () => {
    const m = meta({ finish: () => m.json({ error: { message: "An unexpected error has occurred", code: 2 } }, 500) });
    const { d, saved } = deps(m.f);
    const r = await runJob(job({ attempts: 1 }), d);
    expect(r).toMatchObject({ status: "queued", next_attempt_at: "2026-10-28T10:01:00.000Z" });
    expect(saved[0]).toMatchObject({ meta_video_id: "9001" });
  });

  it("rate limit after MAX attempts → failed with a reason", async () => {
    const m = meta({ start: () => m.json({ error: { message: "Application request limit reached", code: 4 } }, 400) });
    const { d } = deps(m.f);
    expect(await runJob(job({ attempts: 5 }), d)).toMatchObject({ status: "failed" });
  });

  it("not connected → awaiting_connection, no request to Meta", async () => {
    const m = meta({});
    const { d } = deps(m.f, { token: null });
    expect((await runJob(job(), d)).status).toBe("awaiting_connection");
    expect(m.f).not.toHaveBeenCalled();
  });

  it("clip deleted locally / file missing → failed, nothing sent", async () => {
    const m = meta({});
    expect((await runJob(job({ reel_video_id: null }), deps(m.f).d)).status).toBe("failed");
    const { d } = deps(m.f, { signedFileUrl: async () => null });
    expect(await runJob(job(), d)).toMatchObject({ status: "failed" });
    expect(m.calls.some((c) => c.url.includes("rupload"))).toBe(false);
  });

  it("network error is transient", async () => {
    const f = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const { d } = deps(f);
    expect((await runJob(job(), d)).status).toBe("queued");
  });

  it("Meta accepted finish but the reply was lost (network drop) → the retry NEVER sends finish again, only reads status", async () => {
    // Run 1: start + upload ok, finish request leaves but the connection drops before the reply.
    let finishes = 0;
    const m1 = meta({ finish: () => { finishes++; throw new TypeError("socket hang up"); } });
    const { d: d1, saved: s1 } = deps(async (u, i) => {
      if (String(i.body ?? "").includes("upload_phase=finish")) { finishes++; throw new TypeError("socket hang up"); }
      return m1.f(u, i);
    });
    const r1 = await runJob(job({ attempts: 1 }), d1);
    expect(r1.status).toBe("queued");
    const marked = s1.find((p) => p.finish_requested_at);
    expect(marked).toBeTruthy(); // stored BEFORE finish was sent
    expect(s1.indexOf(marked!)).toBeLessThan(s1.length - 1);

    // Run 2: Meta still processing → wait, no finish.
    const m2 = meta({ status: () => ({ status: { uploading_phase: { status: "complete" }, processing_phase: { status: "in_progress" } } }) });
    const r2 = await runJob(job({ attempts: 2, meta_video_id: "9001", finish_requested_at: marked!.finish_requested_at }), deps(m2.f).d);
    expect(r2.status).toBe("queued");
    expect(m2.calls.some((c) => String(c.init.body ?? "").includes("upload_phase=finish"))).toBe(false);

    // Run 3: Meta reports it published → recorded once.
    const m3 = meta({ status: () => ({ status: { uploading_phase: { status: "complete" }, publishing_phase: { status: "complete" } } }) });
    const r3 = await runJob(job({ attempts: 3, meta_video_id: "9001", finish_requested_at: marked!.finish_requested_at }), deps(m3.f).d);
    expect(r3).toMatchObject({ status: "published", meta_post_id: "9001" });
    expect(m3.calls.some((c) => String(c.init.body ?? "").includes("upload_phase=finish"))).toBe(false);
    expect(finishes).toBe(1); // exactly one finish across all runs
  });

  it("after a sent finish, Meta reports an error, or it never confirms within MAX attempts → failed for the owner to check; still no second finish", async () => {
    const m = meta({ status: () => ({ status: { video_status: "error" } }) });
    const r = await runJob(job({ meta_video_id: "9001", finish_requested_at: "2026-10-28T09:00:00Z" }), deps(m.f).d);
    expect(r.status).toBe("failed");
    const m2 = meta({ status: () => ({ status: { uploading_phase: { status: "complete" } } }) });
    const r2 = await runJob(job({ attempts: 5, meta_video_id: "9001", finish_requested_at: "2026-10-28T09:00:00Z" }), deps(m2.f).d);
    expect(r2.status).toBe("failed");
    for (const c of [...m.calls, ...m2.calls]) expect(String(c.init.body ?? "")).not.toContain("upload_phase=finish");
  });
});
