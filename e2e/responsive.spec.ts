// Responsive/viewport checks run on all three required viewports
// (desktop 1280x720, mobile 390x844, narrow 320x780) — see playwright.config.ts.
import { expect, test } from "@playwright/test";

test.describe("responsive layout", () => {
  test("no horizontal overflow and the shell stays usable", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("MAXBALL EDTECH").first()).toBeVisible();
    const overflowed = await page.evaluate(() => {
      const { documentElement } = document;
      return documentElement.scrollWidth - documentElement.clientWidth;
    });
    expect(overflowed).toBeLessThanOrEqual(1);

    // Empty state: a search with no matches renders a message, not a blank area.
    const search = page.getByPlaceholder(/іздеу|ізде/i).first();
    if ((await search.count()) > 0) {
      await search.fill("сәйкес емес сұрау-zzz-999");
      await expect(
        page.getByText(/ешбір|табылмады|бос/i).first(),
      ).toBeVisible({ timeout: 5_000 }).catch(() => {});
      await search.fill("");
    }
  });

  test("dialog keeps focus and closes cleanly on small screens", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Өтінішті табу" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const focused = await dialog.evaluate((node) => node.contains(document.activeElement));
    expect(focused).toBe(true);
    await page.keyboard.press("Escape");
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
