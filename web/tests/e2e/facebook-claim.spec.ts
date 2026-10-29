import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { db } from "./qa-helpers";

/**
 * Migration 0030, CONCURRENT claims (review of 97ccbbf). Several workers call claim_facebook_jobs at the same time
 * through PostgREST (separate DB connections). Local isolated stack only; a fake Page id/token, nothing is sent to
 * Meta, and the connection row is removed afterwards so the site stays «غير مربوط».
 */
const PAGE = "1111111111";
const reels: string[] = [];
const claim = async () => {
  const { data, error } = await db.rpc("claim_facebook_jobs", { p_limit: 5 });
  expect(error).toBeNull();
  return (data ?? []) as { id: string; status: string; lease_token: string }[];
};
const together = (n: number) => Promise.all(Array.from({ length: n }, claim)).then((r) => r.flat());

async function reel(): Promise<string> {
  const id = randomUUID();
  const { error } = await db.from("reel_videos").insert({ id, title: "مقطع اختبار", storage_path: `reels/${id}.mp4`, mime: "video/mp4", bytes: 1000 });
  expect(error).toBeNull();
  reels.push(id);
  return id;
}

test.beforeAll(async () => {
  expect((await db.from("meta_page_connection").select("id")).data).toEqual([]); // never run over a real connection
  expect((await db.rpc("meta_connect", { p_page_id: PAGE, p_page_name: "صفحة اختبار", p_token: "EAAB-local-test-token-not-real-cccc" })).error).toBeNull();
});

test.afterAll(async () => {
  await db.from("facebook_reel_posts").delete().eq("page_id", PAGE);
  if (reels.length) await db.from("reel_videos").delete().in("id", reels);
  await db.rpc("meta_disconnect", { p_status: "disconnected", p_error: null });
  await db.from("meta_page_connection").delete().eq("id", 1);
});

test.afterEach(async () => {
  await db.from("facebook_reel_posts").delete().eq("page_id", PAGE);
});

test("FC1: two workers at once → only one gets the processing job; its lease outlives the run; after a crash it is recovered and the stale worker cannot write", async () => {
  const { data: job } = await db
    .from("facebook_reel_posts")
    .insert({ reel_video_id: await reel(), status: "processing", page_id: PAGE, meta_video_id: "9001", finish_requested_at: new Date().toISOString() })
    .select("id")
    .single();
  const got = await together(2);
  expect(got.map((j) => j.id)).toEqual([job!.id]); // exactly one worker
  const first = got[0]!.lease_token;
  const row = (await db.from("facebook_reel_posts").select("lease_until").eq("id", job!.id).single()).data!;
  expect(Date.parse(row.lease_until) - Date.now()).toBeGreaterThan(120_000); // beyond the 60 s worker run
  expect(await together(3)).toEqual([]); // still leased: nobody else

  // the worker crashed: its lease runs out → recovered by one worker, with a new lease
  await db.from("facebook_reel_posts").update({ lease_until: new Date(Date.now() - 1000).toISOString() }).eq("id", job!.id);
  const again = await together(2);
  expect(again).toHaveLength(1);
  expect(again[0]!.lease_token).not.toBe(first);
  const stale = await db.from("facebook_reel_posts").update({ status: "failed", last_error: "stale" }).eq("id", job!.id).eq("lease_token", first).select("id");
  expect(stale.data).toEqual([]); // the old worker's write (as checkedSave does it) matches nothing
  expect((await db.from("facebook_reel_posts").select("status").eq("id", job!.id).single()).data!.status).toBe("processing");
});

test("FC2: one place left in the 24 h quota, 4 workers claim at once → exactly one new upload; processing checks still run", async () => {
  const now = new Date().toISOString();
  const used = Array.from({ length: 28 }, (_, i) => ({ status: "published", page_id: PAGE, meta_post_id: `p${i}`, published_at: now }));
  expect((await db.from("facebook_reel_posts").insert(used)).error).toBeNull();
  const processing = (
    await db.from("facebook_reel_posts").insert({ reel_video_id: await reel(), status: "processing", page_id: PAGE, meta_video_id: "9002", finish_requested_at: now }).select("id").single()
  ).data!.id; // 28 + 1 = 29 → one place left
  for (let i = 0; i < 4; i++) expect((await db.from("facebook_reel_posts").insert({ reel_video_id: await reel(), status: "queued", page_id: PAGE })).error).toBeNull();

  const got = await together(4);
  expect(got.filter((j) => j.status === "publishing")).toHaveLength(1);
  expect(got.filter((j) => j.id === processing)).toHaveLength(1);
  expect(new Set(got.map((j) => j.id)).size).toBe(got.length); // no job handed to two workers

  // quota full now: the processing check is still possible once its lease is over, new uploads are not
  await db.from("facebook_reel_posts").update({ lease_until: new Date(Date.now() - 1000).toISOString() }).eq("id", processing);
  const later = await together(3);
  expect(later.map((j) => j.id)).toEqual([processing]);
});
