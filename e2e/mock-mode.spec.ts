// Browser proof that the replaceable mockService (#5) runs the full UI with
// ZERO application API traffic. Runs via: node scripts/verify.mts --phase e2e --mode mock
import { expect, test } from "@playwright/test";

/** Opens the compose dialog (the form lives behind the Жазба қалдыру CTA). */
async function openComposer(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Жазба қалдыру" }).first().click();
}

// The header brand button is viewport-independent; the text "MAXBALL EDTECH"
// also appears in the sidebar copyright, which is hidden on narrow layouts.
const brand = (page: import("@playwright/test").Page) => page.getByRole("button", { name: "MAXBALL EDTECH басты беті" });

test.describe("mockService mode", () => {
  test("saved counts and account isolation agree with the real-service contract", async ({ page }) => {
    const requests: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/")) requests.push(request.url());
    });
    const login = async (email: string) => {
      await page.getByRole("button", { name: "Кіру", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await dialog.locator('input[name="email"]').fill(email);
      await dialog.locator('input[name="password"]').fill("Mock-Only-2026");
      await dialog.locator('input[name="password"]').press("Enter");
      await expect(dialog).toBeHidden();
      await expect(page.locator(".profile-button")).toBeVisible();
    };
    const empty = async () => {
      await expect(page.locator(".overview-strip strong")).toHaveText(["0", "0", "0"]);
      await expect(page.locator(".feed-tabs button span")).toHaveText(["0", "0", "0", "0"]);
      await expect(page.locator(".list-meta")).toContainText("0 жазба");
    };
    await page.goto("/");
    await login("user@maxball.example");
    await page.getByRole("button", { name: "Сақталғандар", exact: true }).click();
    await empty();
    await brand(page).click();
    await page.locator(".post-card").first().getByRole("button", { name: "Сақтау", exact: true }).click();
    await page.getByRole("button", { name: "Сақталғандар", exact: true }).click();
    await expect(page.locator(".overview-strip strong").first()).toHaveText("1");
    await page.getByLabel("Жазбалардан іздеу", { exact: true }).fill("qa-no-matching-mock-post");
    await empty();
    await page.getByRole("button", { name: "Шығу", exact: true }).click();
    await login("teacher@maxball.example");
    await page.getByRole("button", { name: "Сақталғандар", exact: true }).click();
    await empty();
    expect(requests).toEqual([]);
  });

  test("the full UI works with zero /api requests", async ({ page }) => {
    const apiRequests: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/"))
        apiRequests.push(request.url());
    });
    await page.goto("/");
    await expect(brand(page)).toBeVisible();
    // Seeded mock content renders.
    await expect(page.locator("article, .post, li").filter({ hasText: /./ }).first()).toBeVisible();

    // Guest can submit feedback and receive a mock receipt — still no API calls.
    await openComposer(page);
    await page
      .locator("form")
      .filter({ has: page.getByPlaceholder("Не туралы айтқыңыз келеді?") })
      .first()
      .locator('input[name="title"]')
      .fill(`Мок сынақ ${Date.now()}`);
    await page.locator('input[name="authorName"]').fill("Тексеру Жүйесі");
    await page
      .getByPlaceholder("Ойыңызды, ұсынысыңызды немесе мәселеңізді жазыңыз")
      .fill("Мок қызметі арқылы жіберілген хабарлама.");
    await page.getByRole("button", { name: "Жариялау" }).click();
    await expect(page.getByRole("dialog").locator(".secret-code code")).toBeVisible();

    expect(apiRequests, "mock mode must not touch the application API").toEqual([]);
  });
});
