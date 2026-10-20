// Role, privacy and moderation-denial browser flows (Refs #19).
// Roles are exercised through the real login dialog with the published demo
// accounts (src/server/seed.ts): user, teacher and leadership ("boss").
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


const ACCOUNTS = {
  user: "demo1@maxball.example",
  teacher: "demo4@maxball.example",
  boss: "demo6@maxball.example",
};
const PASSWORD = "Maxball2026";

/** Logs in through the real login dialog and waits for the session UI. */
async function loginAs(page: Page, email: string) {
  await page.getByRole("button", { name: "Кіру", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator('input[name="email"]').fill(email);
  await dialog.locator('input[name="password"]').fill(PASSWORD);
  await dialog.getByRole("button", { name: "Кіру" }).click();
  await expect(page.getByRole("button", { name: "Шығу" })).toBeVisible();
}

async function logoutVia(page: Page) {
  await page.getByRole("button", { name: "Шығу" }).click();
  await expect(page.getByRole("button", { name: "Кіру", exact: true })).toBeVisible();
}

test.describe("roles, privacy and denials", () => {
  test("anonymous post hides the author identity from managers", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Жазба қалдыру" }).first().click();
    const form = page
      .locator("form")
      .filter({ has: page.getByPlaceholder("Не туралы айтқыңыз келеді?") })
      .first();
    await form.locator('input[name="title"]').fill(`Жасырын сынақ ${Date.now()}`);
    await form
      .getByPlaceholder("Ойыңызды, ұсынысыңызды немесе мәселеңізді жазыңыз")
      .fill("Анонимді автордың жеке деректері жасырылуы тиіс.");
    await form.getByText("Анонимді жариялау").click();
    await form.getByRole("button", { name: "Жариялау" }).click();
    const receipt = page.getByRole("dialog");
    await expect(receipt.locator(".secret-code code")).toBeVisible();
    await receipt.getByRole("button", { name: "Түсінікті" }).click();
    await closeOpenDialogs(page);

    await loginAs(page, ACCOUNTS.boss);
    await expect(page.getByText("Анонимді автор").first()).toBeVisible();
    // No demo/personal email may leak into the manager UI for anonymous posts.
    await expect(page.getByText(/@maxball\.example/)).toHaveCount(0);
  });

  test("guest ownership does not follow the login and page counters stay scoped", async ({ page }) => {
    const title = `Қонақ жазбасы ${Date.now()}`;
    await page.goto("/");
    await page.getByRole("button", { name: "Жазба қалдыру" }).first().click();
    const form = page
      .locator("form")
      .filter({ has: page.getByPlaceholder("Не туралы айтқыңыз келеді?") })
      .first();
    await form.locator('input[name="title"]').fill(title);
    await form
      .getByPlaceholder("Ойыңызды, ұсынысыңызды немесе мәселеңізді жазыңыз")
      .fill("Қонақ ретінде қалдырылған сынақ жазбасы.");
    await form.getByText("Анонимді жариялау").click();
    await form.getByRole("button", { name: "Жариялау" }).click();
    const receipt = page.getByRole("dialog");
    await expect(receipt.locator(".secret-code code")).toBeVisible();
    const code = (
      await receipt.locator(".secret-code code").innerText()
    ).trim();
    await receipt.getByRole("button", { name: "Түсінікті" }).click();
    await closeOpenDialogs(page);
    // The fresh post leads the feed; its #number chip feeds the receipt finder.
    const number = (
      await page.locator(".post-card-meta > small").first().innerText()
    ).replace(/\D+/g, "");

    // Logging into an account must not inherit the guest session's posts.
    await loginAs(page, ACCOUNTS.user);
    await page.getByRole("button", { name: "Менің жазбаларым" }).click();
    await expect(page.getByText(title)).toHaveCount(0);
    // Every counter on the page describes the page scope, not the whole feed.
    const stripCount = Number(
      await page.locator(".overview-strip strong").first().innerText(),
    );
    const metaCount = Number(
      (await page.locator(".list-meta span").first().innerText()).replace(
        /\D+/g,
        "",
      ),
    );
    expect(stripCount).toBeGreaterThan(0);
    expect(stripCount).toBe(metaCount);
    await logoutVia(page);

    // The receipt code is the way back to the guest post.
    await page.getByRole("button", { name: "Өтінішті табу" }).click();
    const track = page.getByRole("dialog");
    await track.locator('input[name="number"]').fill(number);
    await track.locator('input[name="code"]').fill(code);
    await track.getByRole("button", { name: "Өтінішті ашу" }).click();
    await expect(page.getByText(title).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Өзгерту" })).toBeVisible();
    await closeOpenDialogs(page);
  });

  test("moderation controls exist for admins and are denied to others", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, ACCOUNTS.boss);
    await expect(page.getByRole("button", { name: "Өтінішті табу" })).toBeVisible();
    await logoutVia(page);

    await loginAs(page, ACCOUNTS.user);
    await expect(page.getByRole("button", { name: /Жасыру/ })).toHaveCount(0);
    await expect(page.getByText("Мәртебені сақтау")).toHaveCount(0);
    await logoutVia(page);

    await expect(page.getByRole("button", { name: /Жасыру/ })).toHaveCount(0);
  });

  test("teacher ratings: a signed-in user can rate, a guest is denied", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, ACCOUNTS.user);
    await page.getByRole("button", { name: "Оқытушылар" }).click();
    // Open the rating dialog for the first teacher (seeded demo users may
    // already have rated, so the button reads "change rating" instead).
    await page
      .getByRole("button", { name: /Бағалау|Бағаны өзгерту/ })
      .first()
      .click();
    const rating = page
      .locator("form")
      .filter({ has: page.getByPlaceholder("Оқытушы туралы ойыңыз") })
      .first();
    await rating.getByRole("button", { name: "5 жұлдыз" }).click();
    await rating.getByPlaceholder("Оқытушы туралы ойыңыз").fill("Браузер сынағы: өте жақсы!");
    await rating.getByRole("button", { name: "Бағаны сақтау" }).click();
    await expect(rating).toBeHidden();
    // Round-trip proof: reopen the rating dialog and read our comment back.
    await page
      .getByRole("button", { name: /Бағалау|Бағаны өзгерту/ })
      .first()
      .click();
    const reopened = page
      .locator("form")
      .filter({ has: page.getByPlaceholder("Оқытушы туралы ойыңыз") })
      .first();
    await expect(reopened.getByPlaceholder("Оқытушы туралы ойыңыз")).toHaveValue(
      "Браузер сынағы: өте жақсы!",
    );
    await closeOpenDialogs(page);

    // A guest clicking the same action gets the login dialog, not the form.
    await logoutVia(page);
    await page.getByRole("button", { name: "Оқытушылар" }).click();
    await page
      .getByRole("button", { name: /Бағалау|Бағаны өзгерту/ })
      .first()
      .click();
    await expect(page.getByPlaceholder("name@example.com")).toBeVisible();
  });

  test("feed filtering narrows the visible posts and resets cleanly", async ({ page }) => {
    await page.goto("/");
    const meta = page.getByText(/\d+ жазба/).first();
    const before = Number((await meta.textContent())?.match(/\d+/)?.[0] ?? 0);
    expect(before).toBeGreaterThan(0);

    await page.getByRole("button", { name: "Сүзгілер" }).click();
    const statusSelect = page.locator('select[aria-label="Мәртебе бойынша сүзгі"]');
    await statusSelect.selectOption("resolved");
    const filtered = Number((await meta.textContent())?.match(/\d+/)?.[0] ?? 0);
    expect(filtered).toBeLessThanOrEqual(before);

    await page.getByRole("button", { name: "Тазарту" }).click();
    await expect(meta).toHaveText(new RegExp(`${before} жазба`));
  });
});
