import { defineConfig, devices } from "@playwright/test";

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
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",

  use: {
    baseURL: "http://localhost:8080",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
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
