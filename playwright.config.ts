// Playwright configuration for the isolated browser phase (Refs #19).
// Run through the runner so the application, its data directory and the port
// are isolated per run: `node scripts/verify.mts --phase e2e`.
// TEST_URL is the runner-controlled origin; running Playwright directly
// without it fails here instead of silently testing nothing (issue #19 AC3).
import { defineConfig } from "@playwright/test";

const baseURL = process.env.TEST_URL;
if (!baseURL)
  throw new Error(
    "TEST_URL is required: run the browser suite via scripts/verify.mts so the target server is isolated.",
  );

export default defineConfig({
  testDir: "e2e",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  // One worker: the application's per-IP rate limits (12 posts/600s) are real
  // production behavior and must not be raced into 429s by parallel browsers.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
  ],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 60_000,
  },
  outputDir: "test-results",
  projects: [
    {
      name: "desktop-1280x720",
      use: { viewport: { width: 1280, height: 720 } },
      testIgnore: /responsive\.spec\.ts/,
    },
    {
      name: "mobile-390x844",
      use: { viewport: { width: 390, height: 844 } },
      testMatch: /responsive\.spec\.ts/,
    },
    {
      name: "narrow-320x780",
      use: { viewport: { width: 320, height: 780 } },
      testMatch: /responsive\.spec\.ts/,
    },
  ],
});
