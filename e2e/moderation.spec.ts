// Moderation system browser flows (Refs #25): reporting, the dashboard,
// comment moderation and destructive-action confirmations. Every step goes
// through the real UI against the SQLite staging server.
import { expect, test, type Page } from "@playwright/test";

const ACCOUNTS = {
  user: "demo1@maxball.example",
  teacher: "demo4@maxball.example",
  boss: "demo6@maxball.example",
};
const PASSWORD = "Maxball2026";

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

test.describe("moderation system", () => {
  test("a user reports a post and the manager works it through the dashboard", async ({ page }) => {
    await page.goto("/");
    // 1. The demo feed carries a seeded reportable post; open the newest card.
    await page.locator(".post-card .post-open").first().click();
    const detail = page.getByRole("dialog");
    await expect(detail.locator("h1")).toBeVisible();
    const title = await detail.locator("h1").innerText();
    // 2. Report it for spam with a note.
    await detail.getByRole("button", { name: "Шағым беру" }).click();
    const reportForm = page
      .locator("form")
      .filter({ has: page.getByRole("radiogroup") });
    await reportForm.getByText("Спам").click();
    await reportForm.getByPlaceholder("Не болғанын жазыңыз").fill("Сынақ: қайталанатын мазмұн.");
    await reportForm.getByRole("button", { name: "Жіберу" }).click();
    await expect(page.getByText("Шағым жіберілді")).toBeVisible();
    await closeOpenDialogs(page);

    // 3. The manager sees the report and walks the workflow.
    await loginAs(page, ACCOUNTS.boss);
    await page.getByRole("button", { name: "Модерация" }).click();
    await expect(page.getByRole("button", { name: "Шолу" })).toBeVisible();
    await page.getByRole("button", { name: /^Шағымдар( \d+)?$/ }).click();
    const row = page.locator(".report-row", { hasText: "Спам" }).first();
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Қарауда" }).click();
    await expect(
      page.locator(".report-row", { hasText: "Қаралуда" }).first(),
    ).toBeVisible();

    // 4. Hide the reported content straight from the report row.
    const hiddenRow = page.locator(".report-row", { hasText: title }).first();
    await expect(hiddenRow.getByText("Қаралуда")).toBeVisible();
    await hiddenRow.getByRole("button", { name: "Жасыру" }).click();
    const hideForm = page
      .locator("form")
      .filter({ has: page.getByLabel("Жасыру себебі") });
    await hideForm.getByLabel("Жасыру себебі").fill("Сынақ себебі: спам");
    await hideForm.getByRole("button", { name: "Жасыру" }).click();
    await expect(page.getByText("Мазмұн жасырылды")).toBeVisible();

    // 5. Resolve the report; history records the decisions.
    await page
      .locator(".report-row", { hasText: title })
      .first()
      .getByRole("button", { name: "Шешілді" })
      .click();
    await page.getByRole("button", { name: /^Тарих( \d+)?$/ }).click();
    await expect(
      page.locator(".log-row", { hasText: "Шағымды шешті" }).first(),
    ).toBeVisible();
    await expect(
      page.locator(".log-row", { hasText: "Жазбаны жасырды" }).first(),
    ).toBeVisible();

    // 6. Hidden content vanishes for the public but is restorable.
    await page.getByRole("button", { name: /^Жасырылғандар( \d+)?$/ }).click();
    const hiddenTarget = page.locator(".hidden-target", { hasText: "Сынақ себебі" }).first();
    await expect(hiddenTarget).toBeVisible();
    await hiddenTarget.getByRole("button", { name: "Қалпына келтіру" }).click();
    await logoutVia(page);
    await expect(page.getByText(title).first()).toBeVisible();
  });

  test("comment moderation masks one comment and leaves the post public", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, ACCOUNTS.user);
    // Leave a fresh comment on the first post.
    await page.locator(".post-card .post-open").first().click();
    const detail = page.getByRole("dialog");
    await detail.getByPlaceholder("Талқылауға қосылыңыз").fill("Сынақ: осы пікір жасырылады.");
    await detail.getByRole("button", { name: "Жіберу" }).click();
    await expect(detail.getByText("Сынақ: осы пікір жасырылады.")).toBeVisible();
    await closeOpenDialogs(page);
    await logoutVia(page);

    await loginAs(page, ACCOUNTS.boss);
    await page.locator(".post-card .post-open").first().click();
    const managerView = page.getByRole("dialog");
    const target = managerView
      .locator(".comment", { hasText: "Сынақ: осы пікір жасырылады" })
      .first();
    await target.getByRole("button", { name: "Жасыру" }).click();
    const reasonForm = page
      .locator("form")
      .filter({ has: page.getByLabel("Жасыру себебі") });
    await reasonForm.getByLabel("Жасыру себебі").fill("Сынақ: пікір ережесі");
    await reasonForm.getByRole("button", { name: "Жасыру" }).click();
    // The manager still sees the content with its reason…
    await expect(
      managerView.getByText("Жасыру себебі: Сынақ: пікір ережесі").first(),
    ).toBeVisible();
    await closeOpenDialogs(page);
    await logoutVia(page);

    // …while the public sees a masked row and the post stays visible.
    await page.locator(".post-card .post-open").first().click();
    const publicView = page.getByRole("dialog");
    await expect(publicView.locator("h1")).toBeVisible();
    await expect(publicView.getByText("Сынақ: осы пікір жасырылады")).toHaveCount(0);
    await expect(publicView.getByText("Жасырылған пікір").first()).toBeVisible();
    await closeOpenDialogs(page);
  });

  test("destructive actions require an explicit confirmation dialog", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, ACCOUNTS.boss);
    await page.getByRole("button", { name: "Модерация" }).click();
    await page.getByRole("button", { name: /^Жасырылғандар( \d+)?$/ }).click();
    // Only hidden POST rows carry the destructive delete action.
    const target = page
      .locator(".hidden-target")
      .filter({ has: page.getByRole("button", { name: "Өшіру" }) })
      .first();
    if (await target.count()) {
      await target.getByRole("button", { name: "Өшіру" }).click();
      const confirm = page.getByRole("dialog", { hasText: "қайтару мүмкін емес" });
      await expect(confirm).toBeVisible();
      // Cancelling keeps the content; nothing disappears without intent.
      await confirm.getByRole("button", { name: "Бас тарту" }).click();
      await expect(page.locator(".hidden-target").first()).toBeVisible();
    }
    await logoutVia(page);
  });

  test("teachers never see the moderation dashboard", async ({ page }) => {
    await page.goto("/");
    await loginAs(page, ACCOUNTS.teacher);
    await expect(page.getByRole("button", { name: "Модерация" })).toHaveCount(0);
    await logoutVia(page);
  });
});
