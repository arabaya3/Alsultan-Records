/**
 * Turnstile fail-closed policy (src/features/bookings/public/turnstile-policy.ts), end to end.
 * Skipped unless TURNSTILE_TEST_MODE is set. LOCAL STACK ONLY for the row checks (qa-helpers).
 * Each mode needs its own PRODUCTION build (`next build && next start`) with these env values:
 *
 *  bypass       no Turnstile keys, NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
 *               → "bypass-local-stack": booking succeeds, server logs "[turnstile] bypass-local-stack" once.
 *  unavailable  no Turnstile keys, NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.2:54321 (still the local
 *               stack via Windows loopback, but not a "local" hostname → treated like a cloud project)
 *               → form replaced by data-testid="booking-unavailable"; a direct server-action POST is refused, no row.
 *  pass         NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA, TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
 *               → widget loads from challenges.cloudflare.com, submission succeeds.
 *  fail         same site key, TURNSTILE_SECRET_KEY=2x0000000000000000000000000000000AA
 *               → submission refused with the Arabic verification error, no row.
 * (Cloudflare dummy keys: developers.cloudflare.com/turnstile/troubleshooting/testing/.)
 *
 * For the direct-POST case set NEXT_DIST to the build's .next folder (to read the action id).
 *   TURNSTILE_TEST_MODE=unavailable NEXT_DIST=/path/.next BASE_URL=http://localhost:4101 npx playwright test turnstile
 */
import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { BASE, db } from "./qa-helpers";

const MODE = process.env.TURNSTILE_TEST_MODE as "bypass" | "unavailable" | "pass" | "fail" | undefined;
test.skip(!MODE, "TURNSTILE_TEST_MODE not set");

const VERIFY_ERROR = "تعذّر التحقق من النموذج. أعد المحاولة.";
const UNAVAILABLE_ERROR = "النموذج غير متاح حالياً";

async function rowsFor(key: string): Promise<number> {
  const { count, error } = await db.from("booking_requests").select("id", { count: "exact", head: true }).eq("idempotency_key", key);
  if (error) throw error;
  return count ?? 0;
}

function futureDate() {
  const d = new Date(Date.now() + 90 * 86400_000);
  return d.toISOString().slice(0, 10);
}

// The booking RPC rate-limits 5/hour per IP hash; a fresh X-Forwarded-For per test keeps runs independent.
function freshIp() {
  return `10.${(Math.random() * 255) | 0}.${(Math.random() * 255) | 0}.${(Math.random() * 254 + 1) | 0}`;
}

// ...and 5/day per phone, so each submission uses its own number.
function freshPhone() {
  return `+96279${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
}

async function fillAndSubmit(page: Page, name: string) {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": freshIp() });
  await page.goto("/book");
  await page.locator("#contact_name").fill(name);
  await page.locator("#contact_phone").fill(freshPhone());
  await page.locator("#event_type").selectOption({ index: 1 });
  await page.locator("#event_date").fill(futureDate());
  await page.getByRole("button", { name: "التالي" }).click();
  if (MODE === "pass" || MODE === "fail") {
    // Dummy site key always issues a token; wait for the widget to write it.
    await expect(page.locator('input[name="cf-turnstile-response"]')).toHaveValue(/.+/, { timeout: 30_000 });
  }
  // Capture the idempotency key the client sends, to count rows afterwards.
  const req = page.waitForRequest((r) => r.method() === "POST" && !!r.headers()["next-action"]);
  await page.getByRole("button", { name: "أرسل الطلب" }).click();
  const body = (await req).postData() ?? "";
  const key = /idempotency_key"\r\n\r\n([A-Za-z0-9-]+)/.exec(body)?.[1];
  expect(key, "idempotency key in action payload").toBeTruthy();
  return key!;
}

test.describe(`turnstile policy — ${MODE}`, () => {
  if (MODE === "bypass" || MODE === "pass") {
    test("booking submission succeeds and creates exactly one row", async ({ page }) => {
      const key = await fillAndSubmit(page, `[DEV] turnstile ${MODE}`);
      await expect(page.getByText("رمز المتابعة")).toBeVisible();
      expect(await rowsFor(key)).toBe(1);
    });
  }

  if (MODE === "fail") {
    test("failing secret: submission refused with the Arabic error, no row", async ({ page }) => {
      const key = await fillAndSubmit(page, "[DEV] turnstile fail");
      await expect(page.getByRole("alert").filter({ hasText: VERIFY_ERROR })).toBeVisible();
      expect(await rowsFor(key)).toBe(0);
    });
  }

  if (MODE === "unavailable") {
    test("form is replaced by the unavailable notice", async ({ page }) => {
      await page.goto("/book");
      await expect(page.getByTestId("booking-unavailable")).toBeVisible();
      await expect(page.locator("#contact_name")).toHaveCount(0);
    });
  }

  if (MODE === "unavailable" || MODE === "bypass") {
    // In "bypass" this is the positive control proving the hand-built POST reaches the action.

    test(`direct server-action POST: ${MODE === "unavailable" ? "refused, no row" : "accepted (positive control)"}`, async () => {
      const dist = process.env.NEXT_DIST;
      test.skip(!dist, "NEXT_DIST not set");
      const manifest = JSON.parse(fs.readFileSync(path.join(dist!, "server/server-reference-manifest.json"), "utf8"));
      const id = Object.entries(manifest.node as Record<string, { exportedName?: string }>).find(
        ([, v]) => v.exportedName === "submitBooking",
      )?.[0];
      expect(id, "submitBooking action id").toBeTruthy();
      const key = crypto.randomUUID();
      // React reply encoding of (prevState, formData): FormData is "$K1", its fields are prefixed "_1_".
      // The root "0" must come LAST: Next decodes multipart as a stream, so "$K1" only sees earlier fields.
      const fields: Record<string, string> = {
        "_1_idempotency_key": key,
        "_1_contact_name": "[DEV] turnstile direct",
        "_1_contact_phone": freshPhone(),
        "_1_event_type": "wedding",
        "_1_event_date": futureDate(),
        "0": JSON.stringify([{ status: "idle" }, "$K1"]),
      };
      const fd = new FormData();
      // (Object.entries lists the integer-like key "0" first, so append it explicitly at the end.)
      for (const [k, v] of Object.entries(fields)) if (k !== "0") fd.append(k, v);
      fd.append("0", fields["0"]);
      const res = await fetch(`${BASE}/book`, {
        method: "POST",
        headers: { "Next-Action": id!, Accept: "text/x-component", "x-forwarded-for": freshIp() },
        body: fd,
      });
      const text = await res.text();
      expect(res.status).toBe(200);
      if (MODE === "unavailable") {
        expect(text).toContain(UNAVAILABLE_ERROR);
        expect(await rowsFor(key)).toBe(0);
      } else {
        expect(text).toContain("trackingCode");
        expect(await rowsFor(key)).toBe(1);
      }
    });
  }
});
