import { defineConfig, devices } from "@playwright/test";
import * as fs from "fs";

/**
 * Playwright E2E test configuration for SokratAI.
 *
 * Run tests:
 *   npx playwright test              # all tests, headless
 *   npx playwright test --headed     # with visible browser
 *   npx playwright test --ui         # interactive UI mode
 *   npx playwright test e2e/tutor-registration.spec.ts  # single file
 *
 * First-time setup:
 *   npx playwright install chromium
 */

// Prefer full Chromium binary over headless_shell for better stability
const fullChromiumPath =
  `${process.env.HOME}/.cache/ms-playwright/chromium-1194/chrome-linux/chrome`;
const useFullChromium = fs.existsSync(fullChromiumPath);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 2,
  workers: 1,
  reporter: "html",

  use: {
    baseURL: "http://localhost:8080",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    launchOptions: {
      ...(useFullChromium ? { executablePath: fullChromiumPath } : {}),
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--single-process",
        // Bypass system proxy to prevent ERR_TUNNEL_CONNECTION_FAILED
        "--proxy-server=direct://",
        "--proxy-bypass-list=*",
        // Make external DNS lookups fail immediately (no delayed timeouts)
        "--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE localhost",
        // Disable background networking that can crash in restricted environments
        "--disable-background-networking",
        "--disable-client-side-phishing-detection",
        "--disable-default-apps",
        "--disable-extensions",
        "--disable-sync",
        "--disable-translate",
        "--metrics-recording-only",
        "--no-first-run",
      ],
    },
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "safari",
      use: { ...devices["Desktop Safari"] },
    },
    {
      name: "iphone",
      use: { ...devices["iPhone 14"] },
    },
  ],

  /* Start dev server before tests */
  webServer: {
    command: "npm run dev",
    url: "http://localhost:8080",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
