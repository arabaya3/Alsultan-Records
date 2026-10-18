import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { as, BASE, CONTRACT_A, db, EV, QUOTE_A, resetSeedSelections, SHOTS, uiLogin, watchErrors } from "./qa-helpers";

/** Portal deep checks (customer A) against the production build on a fresh local DB + seed:storage. */
test.describe.configure({ mode: "serial" });

async function scrollAllTiles(page: Page) {
  for (let i = 0; i < 60; i++) {
    if (await page.getByTestId("gallery-end").isVisible().catch(() => false)) break;
    await page.mouse.wheel(0, 4000);
    await page.waitForTimeout(200);
  }
}

test("C3: 200-image gallery loads every tile with a real decoded thumbnail", async ({ page }) => {
  const w = watchErrors(page);
  await uiLogin(page, "a", `/portal/events/${EV.A1}/gallery`);
  await scrollAllTiles(page);
  const tiles = page.locator('[data-testid="gallery-tile"] img');
  await expect(tiles).toHaveCount(200);
  // bring every tile into view so lazy images load, then require naturalWidth > 0 for all
  const n = await tiles.count();
  for (let i = 0; i < n; i += 8) await tiles.nth(i).scrollIntoViewIfNeeded();
  await expect
    .poll(async () => tiles.evaluateAll((imgs) => (imgs as HTMLImageElement[]).filter((im) => !(im.complete && im.naturalWidth > 0)).length), { timeout: 60_000 })
    .toBe(0);
  const srcs = await tiles.evaluateAll((imgs) => (imgs as HTMLImageElement[]).map((im) => im.currentSrc));
  expect(srcs.every((s) => s.includes("thumb.webp") && s.includes("token="))).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOTS, "qa-portal-gallery-1440.png") });
  expect(w.errors).toEqual([]);
});

async function pick(page: Page, eventId: string, n: number) {
  await page.goto(`${BASE}/portal/events/${eventId}/selection`);
  const toggles = page.getByTestId("select-toggle");
  await expect(toggles.first()).toBeVisible();
  for (let i = 0; i < n; i++) {
    await toggles.nth(i).click();
    await expect(page.getByTestId("selection-count")).toHaveText(String(i + 1));
  }
  await expect(page.locator("[data-save-state=saving]")).toHaveCount(0);
}

test("C4: selection across two events (3 and 2); submitted snapshot is immutable", async ({ page }) => {
  resetSeedSelections([EV.A1, EV.A2]); // portal.spec locks the same seeded selections
  await uiLogin(page, "a", "/portal");
  await pick(page, EV.A1, 3);
  await pick(page, EV.A2, 2);
  const counts = async (ev: string) => {
    const { data: s } = await db.from("album_selections").select("id, status").eq("event_id", ev).single();
    const { count } = await db.from("album_selection_items").select("id", { count: "exact", head: true }).eq("selection_id", s!.id);
    return { id: s!.id, status: s!.status, count };
  };
  expect((await counts(EV.A1)).count).toBe(3);
  expect((await counts(EV.A2)).count).toBe(2);
  await page.goto(`${BASE}/portal/events/${EV.A1}/selection`);
  await page.getByRole("button", { name: "مراجعة وإرسال" }).click();
  await page.getByRole("button", { name: "إرسال الاختيار" }).click();
  await page.getByRole("button", { name: "تأكيد الإرسال" }).click();
  await expect(page.getByTestId("snapshot-status")).toContainText("3");
  const sel = await counts(EV.A1);
  expect(sel.status).not.toBe("draft");
  expect((await counts(EV.A2)).status).toBe("draft"); // other event untouched

  const a = await as("a");
  const { data: snap } = await a.from("album_selection_snapshots").select("id, item_count").eq("event_id", EV.A1).single();
  expect(snap!.item_count).toBe(3);
  // customer cannot alter the snapshot or the frozen selection
  const u = await a.from("album_selection_snapshots").update({ item_count: 99 }).eq("id", snap!.id).select("id");
  expect(u.error !== null || (u.data ?? []).length === 0).toBe(true);
  const d = await a.from("album_selection_snapshots").delete().eq("id", snap!.id).select("id");
  expect(d.error !== null || (d.data ?? []).length === 0).toBe(true);
  const { data: anyImg } = await a.from("media_assets").select("id").eq("event_id", EV.A1).eq("kind", "image").range(10, 10).single();
  const ins = await a.from("album_selection_items").insert({ selection_id: sel.id, media_asset_id: anyImg!.id });
  expect(ins.error).not.toBeNull();
  // even admin cannot rewrite a snapshot
  const ad = await as("admin");
  const au = await ad.from("album_selection_snapshots").update({ item_count: 1 }).eq("id", snap!.id).select("id");
  expect(au.error !== null || (au.data ?? []).length === 0).toBe(true);
  const { data: after } = await db.from("album_selection_snapshots").select("item_count").eq("id", snap!.id).single();
  expect(after!.item_count).toBe(3);
  expect((await counts(EV.A1)).count).toBe(3);
});

test("C5: real video plays/seeks; comment at non-zero timecode saved on the selected revision", async ({ page }) => {
  const w = watchErrors(page);
  await uiLogin(page, "a", `/portal/events/${EV.A1}/videos`);
  await page.getByTestId("video-deliverable").first().click();
  const rev2 = page.getByRole("button", { name: /النسخة 2/ });
  await expect(rev2).toHaveAttribute("aria-pressed", "true");
  const video = page.getByTestId("review-video");
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
  const duration = await video.evaluate((v: HTMLVideoElement) => v.duration);
  expect(duration).toBeGreaterThan(1);
  await video.evaluate(async (v: HTMLVideoElement) => {
    v.muted = true;
    await v.play();
  });
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 10_000 }).toBeGreaterThan(0.2);
  await video.evaluate((v: HTMLVideoElement) => {
    v.pause();
    v.currentTime = 2.5;
  });
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => (v.seeking ? -1 : v.currentTime))).toBeCloseTo(2.5, 1);
  const body = `[QA] timecode ${Date.now()}`;
  await page.getByLabel("أضف ملاحظة عند اللحظة الحالية من الفيديو").fill(body);
  await page.getByRole("button", { name: "حفظ الملاحظة" }).click();
  await expect(page.getByTestId("comments").getByText(body)).toBeVisible();
  await expect.poll(async () => (await db.from("video_comments").select("id").eq("body", body)).data?.length).toBe(1);
  const { data } = await db.from("video_comments").select("timecode_ms, deliverable_revisions!inner(revision_no)").eq("body", body);
  expect(data).toHaveLength(1);
  expect(data![0].timecode_ms).toBeGreaterThanOrEqual(2400);
  expect(data![0].timecode_ms).toBeLessThanOrEqual(2600);
  expect((data![0] as unknown as { deliverable_revisions: { revision_no: number } }).deliverable_revisions.revision_no).toBe(2);
  await page.screenshot({ path: path.join(SHOTS, "qa-portal-video-1440.png") });

  // C5: rapid switching never shows stale comments
  const rev1 = page.getByRole("button", { name: /النسخة 1/ });
  for (let i = 0; i < 6; i++) {
    await rev1.click();
    await rev2.click();
  }
  await rev1.click(); // final: revision 1
  await expect(rev1).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("[DEV] Please trim this part")).toBeVisible();
  await page.waitForTimeout(2500); // let any late response for revision 2 arrive
  await expect(page.getByTestId("comments").getByText(body)).toHaveCount(0);
  await expect(page.getByText("[DEV] Please trim this part")).toBeVisible();
  // throttle and switch again: slow responses for rev1 must not overwrite rev2
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 800, downloadThroughput: 200_000, uploadThroughput: 200_000 });
  await rev2.click();
  await rev1.click();
  await rev2.click();
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await expect(page.getByTestId("comments").getByText(body)).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(3000);
  await expect(page.getByText("[DEV] Please trim this part")).toHaveCount(0);
  expect(w.errors).toEqual([]);
});

test("C7: accept quote, approve contract with exact hash; payments totals match event_financials", async ({ page }) => {
  await uiLogin(page, "a", `/portal/events/${EV.A1}/quotes`);
  await page.getByRole("button", { name: "الموافقة على العرض" }).click();
  await page.getByRole("button", { name: "تأكيد" }).click();
  await expect(page.getByRole("status").filter({ hasText: /./ }).first()).toBeVisible();
  await expect.poll(async () => (await db.from("quotes").select("status").eq("id", QUOTE_A).single()).data!.status).toBe("accepted");

  await page.goto(`${BASE}/portal/events/${EV.A1}/contracts`);
  const { data: c0 } = await db.from("contracts").select("current_version_id").eq("id", CONTRACT_A).single();
  await page.getByRole("button", { name: "اعتماد العقد" }).click();
  await page.getByRole("button", { name: "تأكيد" }).click();
  await expect(page.getByText("تم اعتماد العقد")).toBeVisible();
  const { data: c1 } = await db.from("contracts").select("status, approved_version_id").eq("id", CONTRACT_A).single();
  expect(c1).toEqual({ status: "approved", approved_version_id: c0!.current_version_id });

  await page.goto(`${BASE}/portal/events/${EV.A1}/payments`);
  const a = await as("a");
  const { data: fin } = await a.rpc("event_financials", { p_event_id: EV.A1 });
  const t = fin![0];
  const fmt = (minor: number) => new Intl.NumberFormat("ar-PS", { style: "currency", currency: t.currency.trim() }).format(minor / 100);
  const dds = await page.getByTestId("financials").locator("dd").allInnerTexts();
  const norm = (s: string) => s.replace(/\s/g, "");
  expect(dds.map(norm)).toEqual([t.contracted, t.paid, t.refunded, t.balance].map((v: number) => norm(fmt(v))));
  test.info().annotations.push({ type: "event_financials A1", description: JSON.stringify(t) });
  expect(t.contracted).toBe(1250000);
  expect(t.paid).toBeGreaterThanOrEqual(300000); // seeded deposit (+ any payments other specs recorded)
  expect(t.balance).toBe(t.contracted - t.paid + t.refunded);
  await page.screenshot({ path: path.join(SHOTS, "qa-portal-payments-1440.png") });
});

test("C1: deleting the auth cookie redirects to /login?next=; logout clears session", async ({ page }) => {
  await uiLogin(page, "a", `/portal/events/${EV.A1}/files`);
  const ctx = page.context();
  const sb = (await ctx.cookies()).filter((c) => c.name.startsWith("sb-"));
  expect(sb.length).toBeGreaterThan(0);
  await ctx.clearCookies();
  await page.goto(`${BASE}/portal/events/${EV.A1}/files`);
  await page.waitForURL(/\/login\?next=/);
  expect(decodeURIComponent(page.url())).toContain(`/portal/events/${EV.A1}/files`);
  // logout
  await uiLogin(page, "a", "/portal");
  await page.getByRole("button", { name: "تسجيل الخروج" }).click();
  await page.waitForURL(/\/login/);
  expect((await ctx.cookies()).filter((c) => c.name.startsWith("sb-") && c.value)).toHaveLength(0);
  await page.goBack();
  await page.reload();
  await expect(page).toHaveURL(/\/login/);
});

test("C1: corrupted/expired access token is refreshed or redirected, never shows data", async ({ page }) => {
  await uiLogin(page, "a", "/portal");
  const ctx = page.context();
  const cookies = await ctx.cookies();
  // Replace the session cookie value with garbage (simulates a tampered/expired token without a valid refresh).
  await ctx.clearCookies();
  await ctx.addCookies(cookies.filter((c) => c.name.startsWith("sb-")).map((c) => ({ ...c, value: "base64-eyJhY2Nlc3NfdG9rZW4iOiJ4In0" })));
  await page.goto(`${BASE}/portal`);
  await page.waitForURL(/\/login\?next=/);
});

test("C1: access token past expiry with valid refresh token is refreshed transparently", async ({ page }) => {
  await uiLogin(page, "a", "/portal");
  const ctx = page.context();
  const all = await ctx.cookies();
  const parts = all.filter((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name)).sort((x, y) => x.name.localeCompare(y.name));
  const raw = parts.map((c) => c.value).join("");
  const session = JSON.parse(Buffer.from(raw.replace(/^base64-/, ""), "base64url").toString("utf8"));
  const oldAccess = session.access_token;
  session.expires_at = Math.floor(Date.now() / 1000) - 60;
  const value = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
  await ctx.clearCookies();
  await ctx.addCookies([{ ...parts[0], name: parts[0].name.replace(/\.\d+$/, ""), value }]);
  await page.goto(`${BASE}/portal`);
  await expect(page).toHaveURL(/\/portal$/);
  await expect(page.getByTestId("event-card")).toHaveCount(2);
  const after = (await ctx.cookies()).filter((c) => c.name.startsWith("sb-")).map((c) => c.value).join("");
  const s2 = JSON.parse(Buffer.from(after.replace(/^base64-/, ""), "base64url").toString("utf8"));
  expect(s2.access_token).not.toBe(oldAccess);
});
