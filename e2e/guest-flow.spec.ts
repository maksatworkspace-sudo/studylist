// Guest-facing browser flows against the isolated server (Refs #19).
// Receipt codes are treated as secrets: they are proven present/usable but
// never asserted by value, logged, or screenshotted unmasked.
import { expect, test, type Page } from "@playwright/test";
/** Closes any open native modal dialog (Escape cancels; X is the fallback). */
async function closeOpenDialogs(page: Page) {
  for (let i = 0; i < 3; i++) {
    const dialog = page.getByRole("dialog");
    if (!(await dialog.isVisible())) return;
    await page.keyboard.press("Escape");
    try {
      await expect(dialog).toBeHidden({ timeout: 2_000 });
    } catch {
      await dialog.locator(".dialog-header button").first().click();
      await expect(dialog).toBeHidden();
    }
  }
}


/** Opens the compose dialog (the form lives behind the Жазба қалдыру CTA). */
async function openComposer(page: Page) {
  await page.getByRole("button", { name: "Жазба қалдыру" }).first().click();
}

/** Submits feedback as a named guest and leaves the receipt dialog open. */
async function submitGuestFeedback(page: Page, title: string, body: string) {
  await page.goto("/");
  await openComposer(page);
  const form = page
    .locator("form")
    .filter({ has: page.getByPlaceholder("Не туралы айтқыңыз келеді?") })
    .first();
  await form.locator('input[name="title"]').fill(title);
  await form
    .getByPlaceholder("Ойыңызды, ұсынысыңызды немесе мәселеңізді жазыңыз")
    .fill(body);
  await form.locator('input[name="authorName"]').fill("Браузер Тексеруші");
  await form.getByRole("button", { name: "Жариялау" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".secret-code code")).toBeVisible();
  return dialog;
}

// The header brand button is viewport-independent; the text "MAXBALL EDTECH"
// also appears in the sidebar copyright, which is hidden on narrow layouts.
const brand = (page: import("@playwright/test").Page) => page.getByRole("button", { name: "MAXBALL EDTECH басты беті" });

test.describe("guest flow", () => {
  test("public feed renders seeded content and non-blank assets", async ({ page }) => {
    await page.goto("/");
    await expect(brand(page)).toBeVisible();
    // Seeded demo posts must render as real content, not a blank shell.
    await expect(
      page.locator("article, .post, li").filter({ hasText: /./ }).first(),
    ).toBeVisible();
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
    await expect(dialog).toContainText(/№\s*\d+/);
    const focused = await dialog.evaluate((node) => node.contains(document.activeElement));
    expect(focused).toBe(true);
    // Close exactly via the receipt's own button; the dialog X also matches
    // generic close names, so an exact name avoids strict-mode ambiguity.
    await dialog.getByRole("button", { name: "Түсінікті" }).click();
    // The app then opens the new post's detail dialog automatically.
    const detail = page.getByRole("dialog");
    await expect(detail.getByText(title).first()).toBeVisible();
    await closeOpenDialogs(page);
    // The new post appears in the public feed for everyone.
    await expect(page.getByText(title).first()).toBeVisible();
  });

  test("guest shares a post link without registration", async ({ page, context }) => {
    // Force the clipboard share path: headless Chrome exposes navigator.share,
    // but cannot render its picker; the clipboard fallback is deterministic.
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "share", { value: undefined });
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Жазба қалдыру" }).first().click();
    const form = page
      .locator("form")
      .filter({ has: page.getByPlaceholder("Не туралы айтқыңыз келеді?") })
      .first();
    await form.locator('input[name="title"]').fill(`Бөлісу сынағы ${Date.now()}`);
    await form
      .getByPlaceholder("Ойыңызды, ұсынысыңызды немесе мәселеңізді жазыңыз")
      .fill("Сілтемені бөлісу мүмкіндігін тексеру.");
    await form.locator('input[name="authorName"]').fill("Тексеруші");
    await form.getByRole("button", { name: "Жариялау" }).click();
    const receipt = page.getByRole("dialog");
    await expect(receipt.locator(".secret-code code")).toBeVisible();
    await receipt.getByRole("button", { name: "Түсінікті" }).click();
    // The post detail opens automatically; sharing copies the public link.
    const detail = page.getByRole("dialog");
    await detail.getByRole("button", { name: "Бөлісу" }).click();
    await expect(page.getByText("Сілтеме көшірілді.").first()).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain("?post=");
    await closeOpenDialogs(page);
  });

  test("validation failure preserves typed input", async ({ page }) => {
    await page.goto("/");
    await openComposer(page);
    const form = page
      .locator("form")
      .filter({ has: page.getByPlaceholder("Не туралы айтқыңыз келеді?") })
      .first();
    await form.locator('input[name="title"]').fill("аб");
    await form
      .getByPlaceholder("Ойыңызды, ұсынысыңызды немесе мәселеңізді жазыңыз")
      .fill("т");
    await form.getByRole("button", { name: "Жариялау" }).click();
    // Native/app validation surfaces and the typed title survives.
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
    await dialog.getByRole("button", { name: "Түсінікті" }).click();
    await closeOpenDialogs(page);

    // Wait for native modal exit, then retain Playwright's hit-target checks.
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    await page.getByRole("button", { name: "Өтінішті табу" }).click();
    const finder = page.getByRole("dialog");
    await expect(finder).toBeVisible();

    // A wrong code must be denied; the dialog stays open with the error.
    await finder.locator('input[name="number"]').fill(numberText);
    await finder.locator('input[name="code"]').fill("definitely-wrong-code");
    await finder.locator('button[type="submit"]').click();
    await expect(page.locator(".error, [role=alert]").first()).toBeVisible();

    // The real receipt reopens the guest's own post (same dialog, refill).
    await finder.locator('input[name="number"]').fill(numberText);
    await finder.locator('input[name="code"]').fill(receipt!);
    await finder.locator('button[type="submit"]').click();
    await expect(page.getByText(title).first()).toBeVisible();
  });
});
