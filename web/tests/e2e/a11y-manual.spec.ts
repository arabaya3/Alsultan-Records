import { expect, test, type Browser, type Page } from "@playwright/test";
import { BASE, EV, USERS, uiLogin, type Who } from "./qa-helpers";

/**
 * A11y release blocker, part B: "manual" checks automated (keyboard, focus, dialogs, form errors,
 * RTL, zoom, reduced motion). No screen reader is driven here; see docs/a11y/notes.md.
 * LOCAL STACK + PRODUCTION BUILD ONLY. MUTATES customer A's A1 album selection (submits it):
 * run on a fresh `db reset` + `seed:storage`.
 *   BASE_URL=http://localhost:3900 npx playwright test tests/e2e/a11y-manual.spec.ts --project=chromium
 */
test.describe.configure({ mode: "serial" });

/** Every interactive element that receives focus must show an outline or box-shadow. */
function focusLog() {
  const seen: string[] = [];
  const invisible: string[] = [];
  return {
    seen,
    invisible,
    async check(page: Page) {
      const r = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body || el.getAttribute("tabindex") === "-1") return null;
        // Chromium focuses the date input's internal segments (shadow parts), not app CSS.
        if ((el as HTMLInputElement).type === "date") return null;
        const cs = getComputedStyle(el);
        const visible = (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow !== "" && cs.boxShadow !== "none");
        const name = el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 30) ?? "";
        return { id: `${location.pathname} ${el.tagName}${el.id ? "#" + el.id : ""} "${name}"`, visible };
      });
      if (!r) return;
      seen.push(r.id);
      if (!r.visible) invisible.push(r.id);
    },
  };
}

async function tabUntil(page: Page, pred: () => boolean | Promise<boolean>, max: number, log?: ReturnType<typeof focusLog>) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    if (log) await log.check(page);
    if (await pred()) return true;
  }
  return false;
}
const activeIs = (page: Page, fn: string) => () => page.evaluate(fn) as Promise<boolean>;

async function newPage(browser: Browser, width = 1440, opts: Parameters<Browser["newContext"]>[0] = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: width >= 1000 ? 1000 : 844 }, locale: "ar", ...opts });
  return ctx.newPage();
}

async function keyboardLogin(page: Page, who: Who, next: string, log: ReturnType<typeof focusLog>) {
  await page.goto(`${BASE}/login?next=${encodeURIComponent(next)}`);
  expect(await tabUntil(page, activeIs(page, "document.activeElement?.id === 'email'"), 30, log)).toBe(true);
  await page.keyboard.type(USERS[who].email);
  await page.keyboard.press("Tab");
  await log.check(page);
  expect(await page.evaluate(() => document.activeElement?.id)).toBe("password");
  await page.keyboard.type(USERS[who].password);
  await page.keyboard.press("Enter");
  await page.waitForURL((u) => u.pathname.startsWith(next.split("?")[0]), { timeout: 60_000 });
}

test("html is lang=ar dir=rtl on public, portal, admin", async ({ browser }) => {
  const page = await newPage(browser);
  await page.goto(`${BASE}/`);
  expect(await page.evaluate(() => [document.documentElement.lang, document.documentElement.dir])).toEqual(["ar", "rtl"]);
  await uiLogin(page, "owner", "/admin");
  expect(await page.evaluate(() => document.documentElement.dir)).toBe("rtl");
  await page.context().close();
});

test("skip link is the first Tab stop and moves focus to <main> (public, portal, admin)", async ({ browser }) => {
  for (const [who, url] of [[null, "/"], [null, "/book"], ["a", "/portal"], ["owner", "/admin"]] as const) {
    const page = await newPage(browser);
    if (who) await uiLogin(page, who, url);
    await page.goto(`${BASE}${url}`, { waitUntil: "networkidle" });
    await expect(page.locator("main [aria-busy=true]")).toHaveCount(0); // streamed content has arrived
    await page.keyboard.press("Tab");
    const skip = await page.evaluate(() => {
      const el = document.activeElement as HTMLAnchorElement;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return { href: el.getAttribute("href"), text: el.textContent?.trim(), w: r.width, h: r.height, ring: cs.outlineStyle !== "none" || cs.boxShadow !== "none" };
    });
    expect(skip, url).toMatchObject({ href: "#main", text: "تخطَّ إلى المحتوى", ring: true });
    expect(skip.w, `${url} skip link visible when focused`).toBeGreaterThan(20);
    await page.keyboard.press("Enter");
    expect(await page.evaluate(() => document.activeElement?.id), url).toBe("main");
    // The next Tab lands inside main, not back in the header.
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest("main"))), url).toBe(true);
    await page.context().close();
  }
});

test("keyboard-only booking via WhatsApp: /book has no form, WhatsApp + tel links reachable with visible focus", async ({ browser }) => {
  const page = await newPage(browser);
  await page.goto(`${BASE}/book`);
  expect(await page.locator("main form").count()).toBe(0);
  const seen: { href: string; focusVisible: boolean }[] = [];
  for (let i = 0; i < 40 && seen.length < 60; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      const ring = (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== "none";
      return { href: (el as HTMLAnchorElement).href ?? "", focusVisible: ring };
    });
    if (info) seen.push(info);
  }
  const wa = seen.find((x) => x.href.startsWith("https://wa.me/970598677477"));
  const tel = seen.find((x) => x.href.startsWith("tel:"));
  expect(wa, "WhatsApp link reachable by Tab").toBeTruthy();
  expect(tel, "tel: link reachable by Tab").toBeTruthy();
  expect(wa!.focusVisible && tel!.focusVisible).toBe(true);
  await page.context().close();
});

test("form errors are announced (login, admin payment)", async ({ browser }) => {
  const page = await newPage(browser);
  await page.goto(`${BASE}/login`);
  await page.locator("#email").fill(USERS.a.email);
  await page.locator("#password").fill("wrong-password-1");
  await page.getByRole("button", { name: "تسجيل الدخول" }).click();
  await expect(page.getByRole("alert")).toBeVisible({ timeout: 30_000 });

  await uiLogin(page, "owner", "/admin/finance");
  const form = page.getByTestId("payment-form");
  await form.locator("select[name=customer_id]").selectOption({ index: 1 });
  await form.locator("input[name=amount]").fill("abc");
  await form.getByRole("button", { name: "تسجيل" }).click();
  await expect(form.getByRole("alert")).toHaveText(/\S/, { timeout: 30_000 });
  await page.context().close();
});

test("portal keyboard: login, lightbox (RTL arrows, Esc, focus return), toggle selection and submit", async ({ browser }) => {
  const page = await newPage(browser);
  const log = focusLog();
  await keyboardLogin(page, "a", `/portal/events/${EV.A1}/gallery`, log);
  const opener = page.getByRole("button", { name: "عرض الصورة 1", exact: true });
  await expect(opener).toBeVisible();
  expect(await tabUntil(page, activeIs(page, "document.activeElement?.getAttribute('aria-label') === 'عرض الصورة 1'"), 60, log)).toBe(true);
  await page.keyboard.press("Enter");
  const lb = page.getByRole("dialog", { name: "عارض الصور" });
  await expect(lb).toBeVisible();
  await expect(lb).toHaveAttribute("aria-modal", "true");
  await expect(lb.getByRole("button", { name: "إغلاق" })).toBeFocused();
  await log.check(page);
  const counter = lb.getByText(/^\d+ من \d+$/);
  await expect(counter).toHaveText(/^1 من/);
  // RTL: ArrowLeft = next, ArrowRight = previous.
  await page.keyboard.press("ArrowLeft");
  await expect(counter).toHaveText(/^2 من/);
  await page.keyboard.press("ArrowRight");
  await expect(counter).toHaveText(/^1 من/);
  // Direction-sensitive icons: "previous" sits on the right (start in RTL) and points right; "next" on the left, points left.
  const prev = lb.getByRole("button", { name: "الصورة السابقة" });
  const next = lb.getByRole("button", { name: "الصورة التالية" });
  const [pb, nb] = [await prev.boundingBox(), await next.boundingBox()];
  expect(pb!.x).toBeGreaterThan(nb!.x);
  expect((await prev.textContent())?.trim()).toBe("→");
  expect((await next.textContent())?.trim()).toBe("←");
  // Focus trap.
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    await log.check(page);
    expect(await lb.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(lb).toBeHidden();
  await expect(opener).toBeFocused();

  // Selection: toggle by keyboard, review, submit.
  await page.goto(`${BASE}/portal/events/${EV.A1}/selection`);
  const count = page.getByTestId("selection-count");
  await expect(count).toBeVisible();
  const before = Number(await count.textContent());
  expect(await tabUntil(page, activeIs(page, "document.activeElement === document.querySelector('[data-testid=select-toggle]')"), 80, log)).toBe(true);
  const toggle = page.getByTestId("select-toggle").first();
  // Accessible name = visible label + photo number (label-in-name), state via aria-pressed.
  await expect(toggle).toHaveAccessibleName(/^(اختيار|✓ مختارة) الصورة 1$/);
  const was = await toggle.getAttribute("aria-pressed");
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-pressed", was === "true" ? "false" : "true");
  await expect(count).toHaveText(String(was === "true" ? before - 1 : before + 1));
  if (was === "true") {
    await page.keyboard.press("Enter"); // keep at least one pick
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
  }
  await expect(page.locator('[data-save-state="saved"]').first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "مراجعة وإرسال" }).focus();
  await page.keyboard.press("Enter");
  expect(await tabUntil(page, activeIs(page, "document.activeElement?.textContent?.trim() === 'إرسال الاختيار'"), 20, log)).toBe(true);
  await page.keyboard.press("Enter");
  // Focus follows the confirm row: "تأكيد الإرسال" replaces the pressed button and receives focus.
  await expect(page.getByRole("button", { name: "تأكيد الإرسال" })).toBeFocused();
  await log.check(page);
  // "تراجع" returns focus to "إرسال الاختيار"; then confirm for real.
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "تراجع" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "إرسال الاختيار" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "تأكيد الإرسال" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("selection-locked").or(page.getByTestId("snapshot-status")).first()).toBeVisible({ timeout: 30_000 });
  expect(log.invisible, `focus not visible on: ${log.invisible.join(", ")}`).toEqual([]);
  test.info().annotations.push({ type: "focus stops checked (portal)", description: String(log.seen.length) });
  await page.context().close();
});

test("admin keyboard: confirm dialog is a labelled modal, traps focus, Esc and تراجع return focus to trigger", async ({ browser }) => {
  const page = await newPage(browser);
  const log = focusLog();
  await keyboardLogin(page, "owner", `/admin/events/${EV.A1}`, log);
  const trigger = page.getByRole("button", { name: "إزالة" }).first();
  await trigger.focus();
  await log.check(page);
  for (const closeWith of ["Escape", "تراجع"] as const) {
    await page.keyboard.press("Enter");
    const dlg = page.getByRole("dialog", { name: "إزالة من طاقم المناسبة؟" });
    await expect(dlg).toBeVisible();
    const info = await dlg.evaluate((d: HTMLDialogElement) => ({
      modal: d.matches(":modal"),
      label: document.getElementById(d.getAttribute("aria-labelledby") ?? "")?.textContent,
      inside: d.contains(document.activeElement),
    }));
    expect(info).toEqual({ modal: true, label: "إزالة من طاقم المناسبة؟", inside: true });
    await log.check(page);
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("Tab");
      const inside = await dlg.evaluate((d) => d.contains(document.activeElement) || document.activeElement === document.body);
      expect(inside).toBe(true);
      await log.check(page);
    }
    if (closeWith === "Escape") await page.keyboard.press("Escape");
    else {
      await dlg.getByRole("button", { name: "تراجع" }).focus();
      await page.keyboard.press("Enter");
    }
    await expect(dlg).toBeHidden();
    await expect(trigger, `focus returns after ${closeWith}`).toBeFocused();
  }
  // Nothing was removed.
  await page.reload();
  await expect(page.getByRole("button", { name: "إزالة" }).first()).toBeVisible();

  // Mobile admin nav toggle exposes state.
  await page.setViewportSize({ width: 390, height: 844 });
  const menu = page.getByRole("button", { name: "القائمة" });
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await menu.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "إغلاق القائمة" })).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("navigation", { name: "أقسام لوحة الإدارة" })).toBeVisible();
  expect(log.invisible, `focus not visible on: ${log.invisible.join(", ")}`).toEqual([]);
  await page.context().close();
});

test("public mobile menu dialog: role, aria-modal, label, trap, Esc", async ({ browser }) => {
  const page = await newPage(browser, 390);
  await page.goto(`${BASE}/`);
  const opener = page.getByRole("button", { name: "فتح القائمة" });
  await opener.focus();
  await page.keyboard.press("Enter");
  const dlg = page.getByRole("dialog", { name: "القائمة" });
  await expect(dlg).toBeVisible();
  await expect(dlg).toHaveAttribute("aria-modal", "true");
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    expect(await dlg.evaluate((d) => d.contains(document.activeElement) || Boolean(document.activeElement?.getAttribute("aria-controls")))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dlg).toBeHidden();
  expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-controls"))).not.toBeNull();
  await page.context().close();
});

test("RTL: directional chevrons and bidi isolation of Latin user content", async ({ browser }) => {
  const page = await newPage(browser);
  await page.goto(`${BASE}/`);
  // "See all" chevrons on the home page point left (forward in RTL): path starts at x=15 and goes to x=9.
  const chevrons = await page.locator('main svg path[d="M15 6l-6 6 6 6"]').count();
  expect(chevrons).toBeGreaterThan(0);
  // The published project title is LTR seed text: it must be isolated (<bdi>/dir=auto) wherever shown.
  for (const url of ["/", "/work", "/work/dev-sample-published-project"]) {
    await page.goto(`${BASE}${url}`);
    const nodes = page.getByText("[DEV] Sample published project", { exact: true });
    const n = await nodes.count();
    for (let i = 0; i < n; i++) {
      const iso = await nodes.nth(i).evaluate((e) => {
        for (let el: Element | null = e; el && el !== document.body; el = el.parentElement) {
          if (el.tagName === "BDI" || el.getAttribute("dir") === "auto" || el.getAttribute("dir") === "ltr") return true;
          if (el.tagName === "TITLE") return true;
        }
        return false;
      });
      expect(iso, `${url} #${i}`).toBe(true);
    }
  }
  // Portal + admin titles.
  await uiLogin(page, "a", "/portal");
  await expect(page.locator("main h2 bdi[dir=auto]").first()).toBeVisible();
  await page.goto(`${BASE}/portal/events/${EV.A1}`);
  expect(await page.getByTestId("event-title").locator("bdi[dir=auto]").count()).toBe(1);
  // Phone numbers shown publicly read left-to-right (tel: links on /book and in the footer).
  await page.goto(`${BASE}/book`);
  const tels = page.locator('a[href^="tel:"]');
  expect(await tels.count()).toBeGreaterThan(0);
  for (let i = 0; i < (await tels.count()); i++) {
    const ltr = await tels.nth(i).evaluate((e) => e.getAttribute("dir") === "ltr" || !!e.querySelector('[dir="ltr"]') || !!e.closest('[dir="ltr"]'));
    expect(ltr, `tel link #${i} is LTR`).toBe(true);
  }
  await page.context().close();
});

test("200% zoom (half-width viewport, DPR 2): no horizontal scroll or clipped text on / and /book", async ({ browser }) => {
  for (const [w, h] of [[720, 500], [640, 400]] as const) {
    const page = await newPage(browser, w, { viewport: { width: w, height: h }, deviceScaleFactor: 2, reducedMotion: "reduce" });
    for (const url of ["/", "/book"]) {
      await page.goto(`${BASE}${url}`, { waitUntil: "load" });
      await page.waitForTimeout(500);
      const res = await page.evaluate(() => {
        const overflow = document.documentElement.scrollWidth - window.innerWidth;
        const clipped: string[] = [];
        for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
          if (el.closest(".sr-only,[aria-hidden=true],script,style,svg")) continue;
          const hasText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent!.trim());
          if (!hasText) continue;
          const cs = getComputedStyle(el);
          if (cs.display === "none" || cs.visibility === "hidden") continue;
          const clipsX = /hidden|clip/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1;
          const clipsY = /hidden|clip/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1;
          const r = el.getBoundingClientRect();
          const offscreen = r.right > window.innerWidth + 1 || r.left < -1;
          if (clipsX || clipsY || offscreen) clipped.push(`${el.tagName}.${String(el.className).slice(0, 40)} "${el.textContent!.trim().slice(0, 30)}"`);
        }
        return { overflow, clipped };
      });
      expect(res.overflow, `${url} @${w}`).toBeLessThanOrEqual(0);
      expect(res.clipped, `${url} @${w}`).toEqual([]);
    }
    await page.context().close();
  }
});

test("reduced motion: no transform animations or transitions run", async ({ browser }) => {
  const page = await newPage(browser, 1440, { reducedMotion: "reduce" });
  for (const url of ["/", "/work", "/services", "/book"]) {
    await page.goto(`${BASE}${url}`, { waitUntil: "load" });
    const h = await page.evaluate(() => document.body.scrollHeight);
    for (let y = 0; y < h; y += 400) await page.mouse.wheel(0, 400);
    await page.waitForTimeout(400);
    const res = await page.evaluate(() => {
      const anims = document
        .getAnimations()
        .filter((a) => a.playState === "running")
        .map((a) => {
          const eff = a.effect as KeyframeEffect | null;
          const kf = eff?.getKeyframes?.() ?? [];
          const timing = eff?.getComputedTiming?.();
          return { transform: kf.some((k) => "transform" in k || "translate" in k || "scale" in k || "rotate" in k), dur: Number(timing?.duration ?? 0) };
        })
        .filter((a) => a.transform && a.dur > 1);
      const moved = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal], main h1, main [style*=transform]"))
        .filter((e) => {
          const t = getComputedStyle(e).transform;
          return t !== "none" && t !== "matrix(1, 0, 0, 1, 0, 0)";
        })
        .map((e) => `${e.tagName} ${getComputedStyle(e).transform}`);
      return { anims: anims.length, moved };
    });
    expect(res.anims, url).toBe(0);
    expect(res.moved, url).toEqual([]);
  }
  await page.context().close();
});
