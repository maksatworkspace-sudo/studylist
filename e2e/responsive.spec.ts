// Responsive/viewport checks run on all three required viewports
// (desktop 1280x720, mobile 390x844, narrow 320x780) — see playwright.config.ts.
import { expect, test } from "@playwright/test";

// The header brand button is viewport-independent; the text "MAXBALL EDTECH"
// also appears in the sidebar copyright, which is hidden on narrow layouts.
const brand = (page: import("@playwright/test").Page) => page.getByRole("button", { name: "MAXBALL EDTECH басты беті" });

test.describe("responsive layout", () => {
  test("no horizontal overflow, usable shell, meaningful empty state", async ({ page }) => {
    await page.goto("/");
    await expect(brand(page)).toBeVisible();
    const overflowed = await page.evaluate(() => {
      const { documentElement } = document;
      return documentElement.scrollWidth - documentElement.clientWidth;
    });
    expect(overflowed).toBeLessThanOrEqual(1);

    // Empty state: a search with no matches renders a message, not a blank area.
    const search = page.getByPlaceholder("Жазбалардан іздеу...").first();
    await search.fill("сәйкес емес сұрау-zzz-999");
    await expect(page.getByText(/0 жазба/).first()).toBeVisible();
    await search.fill("");
  });

  test("dialog keeps focus and closes cleanly on small screens", async ({ page }) => {
    await page.goto("/");
    // The header login button is available on every viewport (the sidebar
    // receipt finder is not, on narrow layouts).
    await page.getByRole("button", { name: "Кіру", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(page.getByPlaceholder("name@example.com")).toBeVisible();
    await expect
      .poll(() => dialog.evaluate((node) => node.contains(document.activeElement)))
      .toBe(true);
    await dialog.getByRole("button", { name: "Жабу" }).click();
    await expect(dialog).toBeHidden();
  });

  test("images render non-blank at this viewport", async ({ page }) => {
    await page.goto("/");
    const images = page.locator("img");
    const count = await images.count();
    for (let i = 0; i < count; i++)
      await expect(
        images.nth(i).evaluate((img) => (img as HTMLImageElement).naturalWidth > 0),
      ).resolves.toBeTruthy();
  });
});
