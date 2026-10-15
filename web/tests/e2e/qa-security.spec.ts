import { expect, test } from "@playwright/test";
import { anon, as, db, DOC_B, EV, psql, QUOTE_A } from "./qa-helpers";

/**
 * Security via DIRECT API (supabase-js + publishable key + real user sessions). No UI.
 * Run on a fresh `supabase db reset && npm run seed:storage`. Does not need the Next server.
 */
test.describe.configure({ mode: "serial" });

const B_SEL = "00000000-0000-4000-8000-00000000f0b1";
const B_QUOTE = "00000000-0000-4000-8000-00000000f0b2";
const B_PAY_KEY = "qa-b-payment-0001";
let custA = "";
let custB = "";

test.beforeAll(async () => {
  const { data: cs } = await db.from("customers").select("id, user_id").in("user_id", [
    "00000000-0000-4000-8000-0000000000b1",
    "00000000-0000-4000-8000-0000000000b2",
  ]);
  custA = cs!.find((c) => c.user_id.endsWith("b1"))!.id;
  custB = cs!.find((c) => c.user_id.endsWith("b2"))!.id;
  // Customer B fixtures so isolation checks have something to (not) see.
  await db.from("album_selections").upsert({ id: B_SEL, event_id: EV.B1, customer_id: custB }, { onConflict: "id" });
  // Inserted as postgres: API roles cannot insert quotes (BUG: app.random_code not granted, see verification.md).
  psql(`insert into public.quotes (id, customer_id, event_id, status) values ('${B_QUOTE}', '${custB}', '${EV.B1}', 'draft') on conflict do nothing;
    insert into public.quote_items (quote_id, description, qty, unit_price, sort_order)
      select '${B_QUOTE}', '[QA] B item', 1, 1000, 1 where not exists (select 1 from public.quote_items where quote_id = '${B_QUOTE}');
    update public.quotes set status = 'sent' where id = '${B_QUOTE}' and status = 'draft';`);
  const owner = await as("owner");
  await owner.rpc("record_payment", { p_customer_id: custB, p_amount: 5000, p_method: "cash", p_idempotency_key: B_PAY_KEY, p_event_id: EV.B1 });
});

test("S2: customer A cannot read customer B rows (events, media, selections, quotes, contracts, payments)", async () => {
  const a = await as("a");
  // sanity: B fixtures exist (seen by the verification client)
  expect((await db.from("payments").select("id").eq("idempotency_key", B_PAY_KEY)).data).toHaveLength(1);

  const ev = await a.from("events").select("id, customer_id");
  expect(ev.error).toBeNull();
  expect(ev.data!.every((e) => e.customer_id === custA)).toBe(true);
  expect(ev.data!.map((e) => e.id).sort()).toEqual([EV.A1, EV.A2].sort());
  expect((await a.from("events").select("id").in("id", [EV.B1, EV.B2])).data).toHaveLength(0);
  expect((await a.from("media_assets").select("id").in("event_id", [EV.B1, EV.B2])).data).toHaveLength(0);
  expect((await a.from("media_assets").select("id").eq("id", DOC_B)).data).toHaveLength(0);
  expect((await a.from("album_selections").select("id").eq("id", B_SEL)).data).toHaveLength(0);
  expect((await a.from("quotes").select("id").eq("customer_id", custB)).data).toHaveLength(0);
  expect((await a.from("quote_items").select("id").eq("quote_id", B_QUOTE)).data).toHaveLength(0);
  expect((await a.from("contracts").select("id").neq("customer_id", custA)).data).toHaveLength(0);
  expect((await a.from("payments").select("id").neq("customer_id", custA)).data).toHaveLength(0);
  // positive controls
  expect((await a.from("payments").select("id")).data!.length).toBeGreaterThan(0);
  expect((await a.from("quotes").select("id").eq("id", QUOTE_A)).data).toHaveLength(1);
});

test("S2: customer A cannot write customer B rows", async () => {
  const a = await as("a");
  // update B quote -> 0 rows affected (RLS) or error
  const up = await a.from("quotes").update({ discount: 1 }).eq("id", B_QUOTE).select("id");
  expect(up.data ?? []).toHaveLength(0);
  // add item to B selection
  const ins = await a.from("album_selection_items").insert({ selection_id: B_SEL, media_asset_id: DOC_B });
  expect(ins.error).not.toBeNull();
  // accept B's quote via RPC
  const acc = await a.rpc("customer_accept_quote", { p_quote_id: B_QUOTE });
  expect(acc.error).not.toBeNull();
  const { data: bq } = await db.from("quotes").select("status").eq("id", B_QUOTE).single();
  expect(bq!.status).toBe("sent");
  // event_financials for B's event
  const fin = await a.rpc("event_financials", { p_event_id: EV.B1 });
  expect(fin.error?.code).toBe("42501");
});

test("S5: storage isolation — download + createSignedUrl on B's object fails for A; own succeeds", async () => {
  const a = await as("a");
  const { data: bDoc } = await db.from("media_assets").select("path").eq("id", DOC_B).single();
  const bucket = a.storage.from("private-media");
  const dl = await bucket.download(bDoc!.path);
  expect(dl.data).toBeNull();
  expect(dl.error).not.toBeNull();
  const signed = await bucket.createSignedUrl(bDoc!.path, 60);
  expect(signed.data?.signedUrl ?? null).toBeNull();
  const list = await bucket.list(`events/${EV.B1}`);
  expect(list.data ?? []).toHaveLength(0);
  // B can, positive control
  const b = await as("b");
  const bOwn = await b.storage.from("private-media").download(bDoc!.path);
  expect(bOwn.error).toBeNull();
  expect(bOwn.data!.size).toBeGreaterThan(0);
  // anon: no access at all
  const an = anon();
  expect((await an.storage.from("private-media").download(bDoc!.path)).data).toBeNull();
  // public URL of a private bucket is not readable
  const pub = an.storage.from("private-media").getPublicUrl(bDoc!.path).data.publicUrl;
  expect((await fetch(pub)).status).toBeGreaterThanOrEqual(400);
});

test("S5: signed URL expires (TTL 2s)", async () => {
  const a = await as("a");
  const { data: m } = await a.from("media_assets").select("variants").eq("event_id", EV.A1).eq("kind", "image").limit(1).single();
  const p = (m!.variants as { thumb: string }).thumb;
  const { data } = await a.storage.from("private-media").createSignedUrl(p, 2);
  const first = await fetch(data!.signedUrl);
  expect(first.status).toBe(200);
  await new Promise((r) => setTimeout(r, 4000));
  const later = await fetch(data!.signedUrl);
  expect(later.status).toBeGreaterThanOrEqual(400);
});

test("S3: customer cannot change own role / disabled / customer link", async () => {
  const a = await as("a");
  const uid = (await a.auth.getUser()).data.user!.id;
  const r1 = await a.from("profiles").update({ role: "owner" }).eq("id", uid).select("role");
  const r2 = await a.from("profiles").update({ disabled: true }).eq("id", uid).select("id");
  const r3 = await a.rpc("admin_set_user_role", { p_user_id: uid, p_role: "admin" });
  const r4 = await a.from("customers").update({ user_id: "00000000-0000-4000-8000-0000000000b2" }).eq("id", custA).select("id");
  expect(r1.error).not.toBeNull();
  expect(r2.error).not.toBeNull();
  expect(r3.error).not.toBeNull();
  expect(r4.error !== null || (r4.data ?? []).length === 0).toBe(true);
  const { data: p } = await db.from("profiles").select("role, disabled").eq("id", uid).single();
  expect(p).toEqual({ role: "customer", disabled: false });
  const { data: c } = await db.from("customers").select("user_id").eq("id", custA).single();
  expect(c!.user_id).toBe(uid);
  // own allowed columns still work (positive control)
  expect((await a.from("profiles").update({ full_name: "[DEV] Customer A" }).eq("id", uid)).error).toBeNull();
});

test("A6: staff cannot call admin_financial_summary or read payments; admin can", async () => {
  const s = await as("staff");
  const sum = await s.rpc("admin_financial_summary", { p_from: "2020-01-01", p_to: "2030-12-31" });
  expect(sum.error).not.toBeNull();
  const pay = await s.from("payments").select("id");
  expect(pay.error !== null || (pay.data ?? []).length === 0).toBe(true);
  const ad = await as("admin");
  const asum = await ad.rpc("admin_financial_summary", { p_from: "2020-01-01", p_to: "2030-12-31" });
  expect(asum.error).toBeNull();
  // admin may not record payments (owner only)
  const rp = await ad.rpc("record_payment", { p_customer_id: custA, p_amount: 100, p_method: "cash", p_idempotency_key: "qa-admin-denied" });
  expect(rp.error).not.toBeNull();
});

test("B1: admin cannot read the backups bucket; owner can list it", async () => {
  // put a probe object as service role
  await db.storage.from("backups").upload("qa-probe/probe.json", Buffer.from("{}"), { contentType: "application/json", upsert: true });
  const ad = await as("admin");
  const dl = await ad.storage.from("backups").download("qa-probe/probe.json");
  expect(dl.data).toBeNull();
  expect((await ad.storage.from("backups").list("qa-probe")).data ?? []).toHaveLength(0);
  expect((await ad.storage.from("backups").createSignedUrl("qa-probe/probe.json", 60)).data?.signedUrl ?? null).toBeNull();
  const ow = await as("owner");
  const odl = await ow.storage.from("backups").download("qa-probe/probe.json");
  expect(odl.error).toBeNull();
  await db.storage.from("backups").remove(["qa-probe/probe.json"]);
});

test("P4/P5: anon and customers cannot call public_* RPCs", async () => {
  const an = anon();
  const a = await as("a");
  for (const c of [an, a]) {
    const sb = await c.rpc("public_submit_booking", {
      p_contact_name: "QA", p_contact_phone: "0599999999", p_event_type: "wedding", p_idempotency_key: `qa-anon-${Date.now()}`, p_ip_hash: "x",
    });
    expect(sb.error).not.toBeNull();
    const tr = await c.rpc("public_track_booking", { p_tracking_code: "AAAAAAAAAA", p_phone_last4: "0000", p_ip_hash: "x" });
    expect(tr.error).not.toBeNull();
    const ss = await c.rpc("public_submit_support", {
      p_contact_name: "QA", p_contact_phone: "0599999999", p_subject: "x", p_message: "x", p_idempotency_key: `qa-sup-${Date.now()}`, p_ip_hash: "x",
    });
    expect(ss.error).not.toBeNull();
  }
  // anon cannot read booking_requests directly
  expect((await an.from("booking_requests").select("id")).data ?? []).toHaveLength(0);
});

test("S6: anon sees only the consented published event; publishing without consent is rejected", async () => {
  const an = anon();
  const { data } = await an.from("events").select("id, public_slug");
  expect(data!.map((e) => e.public_slug)).toEqual(["dev-sample-published-project"]);
  // private columns are not selectable by anon
  expect((await an.from("events").select("customer_id")).error).not.toBeNull();
  const ad = await as("admin");
  const pub = await ad.rpc("set_event_publication", { p_event_id: EV.B2, p_publish: true });
  expect(pub.error).not.toBeNull();
  // direct column update of publication fields is refused
  const direct = await ad.from("events").update({ is_published: true }).eq("id", EV.B2).select("id");
  expect(direct.error).not.toBeNull();
  const { data: b2 } = await db.from("events").select("is_published").eq("id", EV.B2).single();
  expect(b2!.is_published).toBe(false);
});

test("C7/A4: tampered contract hash is rejected; customer B cannot approve A's contract", async () => {
  // own fresh sent contract (the seeded one may already be approved by qa-portal in the same run)
  const cid = crypto.randomUUID();
  psql(`insert into public.contracts (id, customer_id, event_id) values ('${cid}', '${custA}', '${EV.A2}');
    insert into public.contract_versions (contract_id, body, total, deposit_required) values ('${cid}', '[QA] tamper test', 5000, 0);
    update public.contracts set status = 'sent' where id = '${cid}';`);
  const a = await as("a");
  const { data: c } = await a.from("contracts").select("current_version_id").eq("id", cid).single();
  const { data: v } = await a.from("contract_versions").select("id, content_hash").eq("id", c!.current_version_id!).single();
  const tampered = v!.content_hash.replace(/^./, (ch: string) => (ch === "a" ? "b" : "a"));
  const r = await a.rpc("customer_approve_contract", { p_version_id: v!.id, p_content_hash: tampered });
  expect(r.error).not.toBeNull();
  const b = await as("b");
  const rb = await b.rpc("customer_approve_contract", { p_version_id: v!.id, p_content_hash: v!.content_hash });
  expect(rb.error).not.toBeNull();
  const { data: after } = await db.from("contracts").select("status").eq("id", cid).single();
  expect(after!.status).toBe("sent");
});
