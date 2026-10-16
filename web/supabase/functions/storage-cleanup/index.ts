// storage-cleanup: durable worker for private.storage_cleanup_queue (migrations 0008 + 0010).
//
// Invoked every minute by pg_cron -> app.invoke_storage_cleanup() -> pg_net, and best-effort right
// after a consent withdrawal / unpublish. Correctness never depends on any single invocation:
//   1. claim_storage_cleanup(limit)   (service role; skips items in backoff, dead or recently claimed)
//   2. delete each object with the service role (bucket allow-list, no "..")
//   3. complete_storage_cleanup(ids)  for successes (removing an absent object counts as success)
//   4. fail_storage_cleanup([id], err) for failures -> attempts+1, exponential backoff, dead-letter at 5
//
// Auth: verify_jwt is off (config.toml); the caller must send `Authorization: Bearer <key>` where key
// equals SUPABASE_SERVICE_ROLE_KEY (injected by the platform) or STORAGE_CLEANUP_SECRET (optional,
// set with `supabase secrets set`). Plain fetch only: no third-party imports.

const BUCKETS = new Set(["public-media", "private-media"]);
const LIMIT = 100;

type Item = { id: string; bucket: string; path: string; reason: string };

function env(name: string): string {
  return Deno.env.get(name) ?? "";
}

function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "method" });
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
  const secret = env("STORAGE_CLEANUP_SECRET");
  if (!safeEqual(bearer, serviceKey) && !safeEqual(bearer, secret)) return json(401, { error: "unauthorized" });

  const base = env("SUPABASE_URL").replace(/\/$/, "");
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
  const rpc = async (fn: string, args: unknown) => {
    const r = await fetch(`${base}/rest/v1/rpc/${fn}`, { method: "POST", headers, body: JSON.stringify(args) });
    if (!r.ok) throw new Error(`${fn}: ${r.status} ${await r.text()}`);
    return r.json();
  };

  let items: Item[];
  try {
    items = (await rpc("claim_storage_cleanup", { p_limit: LIMIT })) as Item[];
  } catch (e) {
    return json(500, { error: "claim", detail: String(e) });
  }

  const done: string[] = [];
  const failed: { id: string; error: string }[] = [];
  for (const it of items) {
    try {
      if (!BUCKETS.has(it.bucket)) throw new Error(`invalid bucket ${it.bucket}`);
      if (!it.path || it.path.includes("..") || it.path.startsWith("/")) throw new Error("invalid path");
      // Same endpoint supabase-js storage.remove() uses; absent objects are not an error.
      const r = await fetch(`${base}/storage/v1/object/${encodeURIComponent(it.bucket)}`, {
        method: "DELETE",
        headers,
        body: JSON.stringify({ prefixes: [it.path] }),
      });
      if (!r.ok) throw new Error(`storage ${r.status} ${(await r.text()).slice(0, 200)}`);
      done.push(it.id);
    } catch (e) {
      failed.push({ id: it.id, error: e instanceof Error ? e.message : String(e) });
    }
  }

  let completed = 0;
  try {
    if (done.length) completed = (await rpc("complete_storage_cleanup", { p_ids: done })) as number;
    for (const f of failed) await rpc("fail_storage_cleanup", { p_ids: [f.id], p_error: f.error });
  } catch (e) {
    // Claimed items that were not completed become claimable again after 15 minutes.
    return json(500, { error: "report", detail: String(e), claimed: items.length });
  }
  console.log(JSON.stringify({ claimed: items.length, completed, failed: failed.length }));
  return json(failed.length ? 207 : 200, { claimed: items.length, completed, failed });
});
