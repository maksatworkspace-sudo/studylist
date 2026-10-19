// Playwright configuration for the isolated browser phase (Refs #19).
// Run through the runner so the application, its data directory and the port
// are isolated per run: `node scripts/verify.mts --phase e2e`.
// TEST_URL is the runner-controlled origin; running Playwright directly
// without it fails here instead of silently testing nothing (issue #19 AC3).
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { defineConfig } from "@playwright/test";

const baseURL = process.env.TEST_URL;
if (!baseURL)
  throw new Error(
    "TEST_URL is required: run the browser suite via scripts/verify.mts so the target server is isolated.",
  );

// Prefer the pinned Playwright chromium build. When it is not installed
// (the CDN can be unreachable on some networks) fall back to the system
// Google Chrome build; CI installs the pinned build and stays default.
function browserChannel(): string | undefined {
  const base =
    process.platform === "darwin"
      ? path.join(homedir(), "Library", "Caches", "ms-playwright")
      : path.join(homedir(), ".cache", "ms-playwright");
  try {
    for (const entry of readdirSync(base)) {
      if (!entry.startsWith("chromium-")) continue;
      for (const inner of readdirSync(path.join(base, entry)))
        if (existsSync(path.join(base, entry, inner, "INSTALLATION_COMPLETE")))
          return undefined;
    }
  } catch {
    // No playwright cache at all.
  }
  return "chrome";
}
const channel = process.env.PLAYWRIGHT_CHANNEL || browserChannel();

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
    ...(channel ? { channel } : {}),
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
      testIgnore: /responsive\.spec\.ts|mock-mode\.spec\.ts/,
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
    {
      // Invoked selectively by the runner for the #5 zero-API-traffic proof.
      name: "mock-mode",
      use: { viewport: { width: 1280, height: 720 } },
      testMatch: /mock-mode\.spec\.ts/,
    },
  ],
});
