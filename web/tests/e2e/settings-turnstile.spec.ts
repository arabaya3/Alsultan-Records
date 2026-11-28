import { expect, test } from "@playwright/test";
import { db, newLoggedIn } from "./qa-helpers";

/**
 * «حماية النماذج العامة» does not control anything (the server's Turnstile keys do): the owner sees it disabled with
 * the reason, and saving the system settings keeps the stored value instead of resetting it. LOCAL STACK ONLY.
 */
test("Turnstile setting is shown disabled with its reason, and saving keeps the stored value", async ({ browser }) => {
  const before = (await db.from("app_settings").select("turnstile_enabled, require_staff_mfa").eq("id", 1).single()).data!;
  try {
    expect((await db.from("app_settings").update({ turnstile_enabled: true }).eq("id", 1)).error).toBeNull();
    const page = await newLoggedIn(browser, "owner", "/admin/settings");
    const box = page.getByTestId("turnstile-setting");
    await expect(box.getByRole("checkbox")).toBeDisabled();
    await expect(box.getByRole("checkbox")).toBeChecked();
    await expect(box).toContainText("مفاتيح Turnstile");
    const form = page.locator("form").filter({ has: page.getByTestId("turnstile-setting") });
    await form.getByRole("button", { name: "حفظ الإعدادات" }).click();
    await page.getByTestId("confirm-yes").click(); // the form asks for confirmation (ActionForm confirm)
    await expect(form.getByTestId("action-msg")).toHaveAttribute("data-ok", "1");
    expect((await db.from("app_settings").select("turnstile_enabled").eq("id", 1).single()).data!.turnstile_enabled).toBe(true);
    await page.context().close();
  } finally {
    await db.from("app_settings").update({ turnstile_enabled: before.turnstile_enabled, require_staff_mfa: before.require_staff_mfa }).eq("id", 1);
  }
});
