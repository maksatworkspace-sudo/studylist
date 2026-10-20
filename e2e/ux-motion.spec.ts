import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { Boot, Post } from "../src/lib/types";

// Independent #21/#24 acceptance. Run only against the isolated CI/verify app.
const email = `qa-motion-${randomUUID()}@example.invalid`;
const password = "Maxball2026";
async function navigation(page: Page, name: string) {
  const button = page.locator(".sidebar").getByRole("button", {
    name: name === "Кері байланыс" ? /^Кері байланыс(?:\s+\d+)?$/ : name,
    exact: true,
  });
  if (!(await button.isVisible()))
    await page.getByRole("button", { name: "Мәзір", exact: true }).click();
  await button.click();
}
async function openLogin(page: Page) {
  await page.getByRole("button", { name: "Кіру", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator('input[name="email"]').fill(email);
  await dialog.locator('input[name="password"]').fill(password);
  return dialog;
}
async function login(page: Page) {
  const dialog = await openLogin(page);
  await dialog.locator('input[name="password"]').press("Enter");
  await expect(dialog).toBeHidden();
  await expect(page.locator(".profile-button")).toBeVisible();
}
async function state(page: Page): Promise<Boot> {
  const response = await page.request.get("/api/state");
  expect(response.ok()).toBe(true);
  return response.json();
}
async function send(page: Page, action: string, id: string) {
  const response = await page.request.post("/api/actions", {
    headers: { origin: new URL(page.url()).origin }, data: { action, id },
  });
  expect(response.ok()).toBe(true);
}
async function counts(page: Page, posts: Post[]) {
  await expect(page.locator(".overview-strip strong")).toHaveText([
    String(posts.length), String(posts.filter((p) => p.status === "resolved").length),
    String(posts.filter((p) => p.status === "reviewing" || p.status === "in_progress").length),
  ]);
  await expect(page.locator(".feed-tabs button span")).toHaveText([
    String(posts.length), ...["opinion", "suggestion", "issue"].map((type) =>
      String(posts.filter((p) => p.type === type).length)),
  ]);
  await expect(page.locator(".list-meta").first()).toContainText(`${posts.length} жазба`);
}

test.describe("independent counts and motion acceptance", () => {
  test.beforeAll(async ({ playwright, baseURL }) => {
    if (!baseURL) throw new Error("An isolated TEST_URL is required for QA fixtures.");
    const api = await playwright.request.newContext({
      baseURL, extraHTTPHeaders: { origin: baseURL },
    });
    try {
      expect((await api.get("/api/state")).ok()).toBe(true);
      const registered = await api.post("/api/actions", { data: {
        action: "register", email, password, name: "QA Motion Fixture", phone: "+70000009999",
      } });
      expect(registered.ok()).toBe(true);
      const receipt = await registered.json();
      expect(receipt.localToken).toBeTruthy();
      expect((await api.post("/api/actions", { data: {
        action: "confirmEmail", token: receipt.localToken,
      } })).ok()).toBe(true);
      expect((await api.post("/api/actions", { data: { action: "logout" } })).ok()).toBe(true);
    } finally { await api.dispose(); }
  });

  test("dialog and shell remain usable at all required normal/reduced-motion sizes", async ({ page }) => {
    for (const reducedMotion of ["no-preference", "reduce"] as const) {
      await page.emulateMedia({ reducedMotion });
      for (const viewport of [
        { width: 1280, height: 720 }, { width: 390, height: 844 },
        { width: 320, height: 780 },
      ]) {
        await page.setViewportSize(viewport);
        await page.goto("/");
        const trigger = page.getByRole("button", { name: "Кіру", exact: true });
        await trigger.click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        await expect(dialog.locator('input[name="email"]')).toBeVisible();
        await page.keyboard.press("Tab");
        expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
        const bounds = await dialog.boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1);
        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
        await expect(trigger).toBeFocused();
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      }
    }
  });

  test("empty saved, last removal, mixed filters and navigation have consistent counts", async ({ page }) => {
    await page.goto("/");
    await login(page);
    const initial = await state(page);
    expect(initial.posts.length).toBeGreaterThan(0);
    for (const post of initial.posts.filter((p) => p.saved))
      await send(page, "toggleBookmark", post.id);
    await page.reload();
    await navigation(page, "Сақталғандар");
    await counts(page, []);
    await expect(page.locator(".post-card")).toHaveCount(0);

    const selected = initial.posts.find((p) => !p.hidden)!;
    await send(page, "toggleBookmark", selected.id);
    await page.reload();
    await navigation(page, "Сақталғандар");
    await counts(page, [selected]);
    await page.getByRole("button", { name: "Сақтау", exact: true }).click();
    await counts(page, []);

    await navigation(page, "Кері байланыс");
    const publicPosts = (await state(page)).posts.filter((p) => !p.hidden);
    await page.locator(".feed-tabs button").nth(1).click();
    await counts(page, publicPosts.filter((p) => p.type === "opinion"));
    await page.getByRole("button", { name: "Сүзгілер", exact: true }).click();
    await page.getByLabel("Мәртебе бойынша сүзгі").selectOption("resolved");
    await counts(page, publicPosts.filter((p) => p.type === "opinion" && p.status === "resolved"));
    await page.getByLabel("Жазбалардан іздеу", { exact: true }).fill("qa-no-match-999999");
    await counts(page, []);
    await navigation(page, "Сақталғандар");
    await expect(page.getByLabel("Жазбалардан іздеу", { exact: true })).toHaveValue("");
    await counts(page, []);
    await navigation(page, "Кері байланыс");
    await counts(page, publicPosts);
  });

  test("failed keyboard login preserves values, errors and focus without success feedback", async ({ page }) => {
    await page.goto("/");
    const dialog = await openLogin(page);
    await page.route("**/api/actions", async (route) => {
      if (route.request().postDataJSON().action !== "login") return route.continue();
      await route.fulfill({ status: 401, json: { error: "QA: аккаунт деректерін тексеріңіз." } });
    });
    await dialog.locator('input[name="password"]').press("Enter");
    const alert = dialog.getByRole("alert");
    await expect(alert).toContainText("QA:");
    await expect(alert).toBeFocused();
    await expect(dialog.locator('input[name="email"]')).toHaveValue(email);
    await expect(dialog.locator('input[name="password"]')).toHaveValue(password);
    await expect(page.locator(".session-feedback")).toHaveCount(0);
    await expect(page.locator(".profile-button")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("button", { name: "Кіру", exact: true })).toBeFocused();
  });

  test("one pending auth mutation, confirmed welcome and farewell, no stale private page", async ({ page }) => {
    await page.goto("/");
    const dialog = await openLogin(page);
    let mutations = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    await page.route("**/api/actions", async (route) => {
      if (route.request().postDataJSON().action !== "login") return route.continue();
      mutations++;
      await gate;
      await route.continue();
    });
    await dialog.locator('input[name="password"]').press("Enter");
    try {
      await expect.poll(() => mutations).toBe(1);
      await expect(dialog.locator('button[type="submit"]').first()).toBeDisabled();
      await dialog.locator("form").first().evaluate((form) => {
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      });
      expect(mutations).toBe(1);
      await expect(page.locator(".session-feedback")).toHaveCount(0);
    } finally { release(); }
    await expect(page.getByRole("status").filter({ hasText: "Қош келдіңіз!" })).toBeVisible();
    await expect(dialog).toBeHidden();
    await navigation(page, "Менің жазбаларым");
    await counts(page, (await state(page)).posts.filter((p) => p.isAccountOwner));
    await navigation(page, "Шығу");
    await expect(page.getByRole("status").filter({ hasText: "Кездескенше!" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Кері байланыс", exact: true })).toBeVisible();
    await expect(page.locator(".profile-button")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Кіру", exact: true })).toBeVisible();
  });

  test("dialog motion retains keyboard containment and restores focus after exit", async ({ page }) => {
    await page.goto("/");
    const trigger = page.getByRole("button", { name: "Кіру", exact: true });
    await trigger.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toHaveAccessibleName(/.+/);
    await expect.poll(() => dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    }
    const durations = await dialog.evaluate((node) => getComputedStyle(node).animationDuration.split(",").map((v) => parseFloat(v) * (v.trim().endsWith("ms") ? 1 : 1000)));
    expect(durations.some((duration) => duration >= 250 && duration <= 450)).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  });

  test("reduced motion keeps immediate usable auth and static feedback", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
    const dialog = await openLogin(page);
    const movement = await dialog.evaluate((node) => ({
      duration: getComputedStyle(node).animationDuration,
      transform: getComputedStyle(node).transform,
    }));
    expect(movement.duration.split(",").every((value) => parseFloat(value) <= 0.01)).toBe(true);
    expect(movement.transform).toBe("none");
    await dialog.locator('input[name="password"]').press("Enter");
    await expect(page.getByRole("status").filter({ hasText: "Қош келдіңіз!" })).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(page.locator(".profile-button")).toBeVisible();
    await navigation(page, "Шығу");
    await expect(page.getByRole("button", { name: "Кіру", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  });

  test("rejected bookmark preserves server state, dismissible toast and correct saved counts", async ({ page }) => {
    await page.goto("/");
    await login(page);
    const before = await state(page);
    const card = page.locator(".post-card").first();
    const save = card.getByRole("button", { name: "Сақтау", exact: true });
    const selectedBefore = (await save.getAttribute("class")) || "";
    await page.route("**/api/actions", async (route) => {
      if (route.request().postDataJSON().action !== "toggleBookmark") return route.continue();
      await route.fulfill({ status: 503, json: { error: "QA: сақтау уақытша қолжетімсіз." } });
    });
    await save.click();
    await expect(page.getByRole("status").filter({ hasText: "QA:" })).toBeVisible();
    await expect(save).toBeEnabled();
    expect((await save.getAttribute("class")) || "").toBe(selectedBefore);
    expect((await state(page)).posts.filter((p) => p.saved).map((p) => p.id).sort())
      .toEqual(before.posts.filter((p) => p.saved).map((p) => p.id).sort());
    await page.getByRole("button", { name: "Хабарды жабу", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "QA:" })).toHaveCount(0);
    await navigation(page, "Сақталғандар");
    await counts(page, before.posts.filter((p) => p.saved));
  });
});
