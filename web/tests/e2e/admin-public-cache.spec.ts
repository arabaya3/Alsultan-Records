import { expect, test } from "@playwright/test";
import { BASE, db, newLoggedIn } from "./qa-helpers";

/**
 * Editing a PUBLISHED event in the admin updates its public page at once (updateEvent expires the "projects"
 * cache tag; before the fix the public page kept the old title for the cache lifetime). Restores the title.
 *   BASE_URL=http://localhost:3600 npx playwright test admin-public-cache
 */
const EVENT = "00000000-0000-4000-8000-0000000000e2";
const SLUG = "dev-sample-published-project";

test("PC1: admin edit of a published event is visible on its public page immediately", async ({ browser }) => {
  const original = (await db.from("events").select("title").eq("id", EVENT).single()).data!.title as string;
  const edited = `${original} (تعديل ${Date.now().toString(36)})`;
  const page = await newLoggedIn(browser, "admin", `/admin/events/${EVENT}`);
  try {
    // Warm the public cache with the original title first.
    const pub = await page.context().newPage();
    await pub.goto(`${BASE}/work/${SLUG}`);
    await expect(pub.getByRole("heading", { level: 1 })).toContainText(original);

    const form = page.getByTestId("event-form");
    await form.locator('input[name="title"]').fill(edited);
    await form.getByRole("button", { name: "حفظ التغييرات" }).click();
    await expect(form.getByTestId("action-msg")).toHaveAttribute("data-ok", "1");

    await pub.reload();
    await expect(pub.getByRole("heading", { level: 1 })).toContainText(edited);
  } finally {
    await db.from("events").update({ title: original }).eq("id", EVENT);
    await page.context().close();
  }
});
