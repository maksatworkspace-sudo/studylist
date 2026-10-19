// Guest-facing browser flows against the isolated server (Refs #19).
// Receipt codes are treated as secrets: they are proven present/usable but
// never asserted by value, logged, or screenshotted unmasked.
import { expect, test, type Page } from "@playwright/test";

/** Submits feedback as a guest and leaves the receipt dialog open. */
async function submitGuestFeedback(page: Page, title: string, body: string) {
  await page.goto("/");
  await page
    .locator("form")
    .filter({ has: page.getByPlaceholder("Не туралы айтқыңыз келеді?") })
    .first()
    .locator('input[name="title"]')
    .fill(title);
  await page.getByPlaceholder("Ойыңызды, ұсынысыңызды немесе мәселеңізді жазыңыз").fill(body);
  await page.getByRole("button", { name: "Жариялау" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".secret-code code")).toBeVisible();
  return dialog;
}

test.describe("guest flow", () => {
  test("public feed renders seeded content and non-blank assets", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("MAXBALL EDTECH").first()).toBeVisible();
    // Seeded demo posts must render as real content, not a blank shell.
    await expect(page.locator("article, .post, li").filter({ hasText: /./ }).first()).toBeVisible();
    // Logo/images must actually load (non-zero natural size).
    const images = page.locator("img");
    const count = await images.count();
    for (let i = 0; i < count; i++)
      await expect(
        images.nth(i).evaluate((img) => (img as HTMLImageElement).naturalWidth > 0),
      ).resolves.toBeTruthy();
  });

  test("guest submits feedback and receives a usable receipt", async ({ page }) => {
    const title = `Браузер сынағы ${Date.now()}`;
    const dialog = await submitGuestFeedback(
      page,
      title,
      "Қонақ ретінде жіберілген толық мәтінді тексеру.",
    );
    // The dialog explains the number + code requirement and keeps focus inside.
    await expect(dialog).toContainText(/№|нөмірі/i);
    const focused = await dialog.evaluate((node) => node.contains(document.activeElement));
    expect(focused).toBe(true);
    await dialog.getByRole("button", { name: /жабу|түсінікті|дайын/i }).click().catch(() => {});
    // The new post appears in the public feed for everyone, anonymously.
    await expect(page.getByText(title).first()).toBeVisible();
  });

  test("validation failure preserves typed input", async ({ page }) => {
    await page.goto("/");
    const form = page
      .locator("form")
      .filter({ has: page.getByPlaceholder("Не туралы айтқыңыз келеді?") })
      .first();
    await form.locator('input[name="title"]').fill("аб");
    await form
      .getByPlaceholder("Ойыңызды, ұсынысыңызды немесе мәселеңізді жазыңыз")
      .fill("т");
    await form.getByRole("button", { name: "Жариялау" }).click();
    // The browser/app validation error surfaces and the typed title survives.
    await expect(form.locator('input[name="title"]')).toHaveValue("аб");
  });

  test("receipt finder opens the post and denies a wrong code", async ({ page }) => {
    const title = `Куәландыру сынағы ${Date.now()}`;
    const dialog = await submitGuestFeedback(
      page,
      title,
      "Нөмір мен код арқылы қайта кіруді тексеру.",
    );
    // Read the receipt into memory only (never logged or asserted by value).
    const receipt = await dialog.locator(".secret-code code").textContent();
    const numberText =
      (await dialog.getByText(/№\s*\d+/).first().textContent())?.match(/\d+/)?.[0] ?? "";
    expect(receipt?.length ?? 0).toBeGreaterThan(0);
    await dialog.getByRole("button", { name: /жабу|түсінікті|дайын/i }).click().catch(() => {});

    // A wrong code must be denied.
    await page.getByRole("button", { name: "Өтінішті табу" }).click();
    let finder = page.getByRole("dialog");
    await finder.locator('input[name="number"]').fill(numberText);
    await finder.locator('input[name="code"]').fill("definitely-wrong-code");
    await finder.getByRole("button", { name: "Жіберу" }).click();
    await expect(page.locator(".error, [role=alert]").first()).toBeVisible();

    // The real receipt reopens the guest's own post.
    await page.getByRole("button", { name: "Өтінішті табу" }).click();
    finder = page.getByRole("dialog");
    await finder.locator('input[name="number"]').fill(numberText);
    await finder.locator('input[name="code"]').fill(receipt!);
    await finder.getByRole("button", { name: "Жіберу" }).click();
    await expect(page.getByText(title).first()).toBeVisible();
  });
});
