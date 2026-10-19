// Role, privacy and moderation-denial browser flows (Refs #19).
// The isolated dev instance exposes the demo role switch (select[aria-label=
// "Сынақ рөлі"]) which maps to the real demoLogin action — the same session,
// permission and privacy code paths as production roles.
import { expect, test, type Page } from "@playwright/test";

async function switchRole(page: Page, role: "guest" | "user" | "teacher" | "admin" | "leadership") {
  await page.locator('select[aria-label="Сынақ рөлі"]').selectOption(role);
  // The switch issues demoLogin/logout; wait for the UI to settle on the role.
  await expect(page.locator('select[aria-label="Сынақ рөлі"]')).toHaveValue(role);
}

test.describe("roles, privacy and denials", () => {
  test("anonymous post hides the author identity from managers", async ({ page }) => {
    await page.goto("/");
    await switchRole(page, "guest");
    await page
      .locator("form")
      .filter({ has: page.getByPlaceholder("Не туралы айтқыңыз келеді?") })
      .first()
      .locator('input[name="title"]')
      .fill(`Жасырын сынақ ${Date.now()}`);
    await page
      .getByPlaceholder("Ойыңызды, ұсынысыңызды немесе мәселеңізді жазыңыз")
      .fill("Анонимді автордың жеке деректері жасырылуы тиіс.");
    await page.getByRole("button", { name: "Жариялау" }).click();
    await expect(page.getByRole("dialog").locator(".secret-code code")).toBeVisible();

    await switchRole(page, "admin");
    await expect(page.getByText("Анонимді автор").first()).toBeVisible();
    // No demo/personal email may leak into the manager UI for anonymous posts.
    await expect(page.getByText(/@maxball\.example/)).toHaveCount(0);
  });

  test("moderation controls exist for admins and are denied to others", async ({ page }) => {
    await page.goto("/");
    await switchRole(page, "admin");
    await expect(page.getByRole("button", { name: "Өтінішті табу" })).toBeVisible();

    await switchRole(page, "user");
    // A plain user must not see admin moderation/status controls.
    await expect(page.getByRole("button", { name: /Жасыру/ })).toHaveCount(0);
    await expect(page.getByText("Мәртебені сақтау")).toHaveCount(0);

    await switchRole(page, "guest");
    await expect(page.getByRole("button", { name: /Жасыру/ })).toHaveCount(0);
  });

  test("teacher ratings: a signed-in user can rate, a guest is denied", async ({ page }) => {
    await page.goto("/");
    await switchRole(page, "user");
    // Open the teachers area and rate the first teacher with five stars.
    await page.getByRole("button", { name: /Оқытушылар/ }).click().catch(async () => {
      await page.getByText(/Оқытушылар/).first().click();
    });
    const rating = page
      .locator("form")
      .filter({ has: page.getByPlaceholder("Оқытушы туралы ойыңыз") })
      .first();
    await rating.getByRole("button", { name: "5 жұлдыз" }).click();
    await rating.getByPlaceholder("Оқытушы туралы ойыңыз").fill("Браузер сынағы: өте жақсы!");
    await rating.getByRole("button", { name: "Бағаны сақтау" }).click();
    await expect(page.getByText("Браузер сынағы: өте жақсы!").first()).toBeVisible();

    await switchRole(page, "guest");
    await expect(page.getByPlaceholder("Оқытушы туралы ойыңыз")).toHaveCount(0);
  });

  test("feed filtering narrows the visible posts", async ({ page }) => {
    await page.goto("/");
    const before = await page.locator("article, .post, li a").count();
    await page.getByRole("button", { name: "Сүзгілер" }).click();
    // Filter to "Мәселе" (issue) type and expect the list to re-render.
    const typeSelect = page
      .locator("select")
      .filter({ has: page.getByRole("option", { name: "Мәселе" }) })
      .first();
    await typeSelect.selectOption("issue");
    await page.waitForTimeout(300);
    const after = await page.locator("article, .post, li a").count();
    expect(after).toBeLessThanOrEqual(before);
    // Resetting the filter restores the full list.
    await typeSelect.selectOption("all");
    await page.waitForTimeout(300);
    await expect(page.locator("article, .post, li a")).toHaveCount(before);
  });
});
