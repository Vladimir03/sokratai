import { test, expect } from "@playwright/test";
import {
  mockSupabaseAuth,
  mockTelegramLoginToken,
  blockAllExternalRequests,
  blockAllSupabaseRequests,
  injectSession,
  fakeSession,
} from "./helpers/supabase-mock";

/**
 * E2E tests for Tutor Registration flow.
 *
 * These tests mock Supabase/Telegram APIs via route interception
 * so they run without a live backend — only the Vite dev server is needed.
 *
 * Covers the bugs fixed in Feb 2026:
 * - Bug #1: "Email already registered" with no upgrade path
 * - Bug #2: Telegram login redirects tutor to student chat
 */

// Block all external HTTPS requests and Yandex Metrika for every test
test.beforeEach(async ({ page }) => {
  await blockAllExternalRequests(page);
});

// ─────────────────────────────────────────────────
// Tutor Registration page – basic rendering
// ─────────────────────────────────────────────────
test.describe("Tutor Registration page", () => {
  test("page loads and shows both registration methods", async ({ page }) => {
    await blockAllSupabaseRequests(page);

    await page.goto("/register-tutor");

    await expect(page.getByText("Регистрация репетитора")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Войти через Telegram")).toBeVisible();
    await expect(page.getByPlaceholder("Имя")).toBeVisible();
    await expect(page.getByPlaceholder("Email")).toBeVisible();
    await expect(page.getByPlaceholder("Пароль (минимум 8 символов)")).toBeVisible();
    await expect(page.getByRole("button", { name: "Зарегистрироваться" })).toBeVisible();
  });

  test("redirects existing tutor to dashboard", async ({ page }) => {
    await mockSupabaseAuth(page, { isTutor: true });
    await injectSession(page);

    await page.goto("/register-tutor");

    // Should redirect to tutor dashboard
    await page.waitForURL("**/tutor/dashboard", { timeout: 15_000 });
  });

  test("shows form for logged-in non-tutor user", async ({ page }) => {
    await mockSupabaseAuth(page, { isTutor: false });
    await injectSession(page);

    await page.goto("/register-tutor");

    // Should stay on register page and show the form
    await expect(page.getByText("Регистрация репетитора")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: "Зарегистрироваться" })).toBeVisible();
  });
});

// ─────────────────────────────────────────────────
// Telegram flow → tutor dashboard
// ─────────────────────────────────────────────────
test.describe("Tutor registration via Telegram → dashboard", () => {
  test.beforeEach(async ({ page }) => {
    // Block window.open to prevent Telegram links from opening
    await page.addInitScript(() => {
      window.open = () => null;
    });
  });

  test("successful Telegram login redirects to tutor dashboard", async ({ page }) => {
    // Mock: after 2 polls, token becomes "verified", and is_tutor returns true
    const authControl = await mockSupabaseAuth(page, { isTutor: true, hasSession: false });
    await mockTelegramLoginToken(page, {
      intendedRole: "tutor",
      verifyAfterAttempts: 2,
      authControl,
    });

    await page.goto("/register-tutor");
    await expect(page.getByText("Регистрация репетитора")).toBeVisible({ timeout: 10_000 });

    // Click "Войти через Telegram"
    await page.getByRole("button", { name: "Войти через Telegram" }).click();

    // Should show "Ожидание подтверждения..."
    await expect(page.getByText("Ожидание подтверждения")).toBeVisible({ timeout: 5_000 });

    // After polling detects "verified" → should show "Вход выполнен!"
    await expect(page.getByText("Вход выполнен!")).toBeVisible({ timeout: 20_000 });

    // Should redirect to tutor dashboard (not /chat!)
    await page.waitForURL("**/tutor/dashboard", { timeout: 20_000 });
  });

  test("Telegram login with intended_role=tutor must NOT redirect to /chat", async ({ page }) => {
    // This is the exact bug scenario
    const authControl = await mockSupabaseAuth(page, { isTutor: true, hasSession: false });
    await mockTelegramLoginToken(page, {
      intendedRole: "tutor",
      verifyAfterAttempts: 1,
      authControl,
    });

    await page.goto("/register-tutor");
    await expect(page.getByText("Регистрация репетитора")).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: "Войти через Telegram" }).click();

    // Wait for success
    await expect(page.getByText("Вход выполнен!")).toBeVisible({ timeout: 20_000 });

    // Should redirect to tutor dashboard (not /chat!)
    await page.waitForURL("**/tutor/dashboard", { timeout: 20_000 });

    // CRITICAL: must NOT be /chat
    expect(page.url()).not.toContain("/chat");
  });
});

// ─────────────────────────────────────────────────
// Email registration flows
// ─────────────────────────────────────────────────
test.describe("Tutor registration via email", () => {
  test("new email registration → assign role → redirect to dashboard", async ({ page }) => {
    await mockSupabaseAuth(page, { isTutor: true, hasSession: false });

    await page.goto("/register-tutor");
    await expect(page.getByText("Регистрация репетитора")).toBeVisible({ timeout: 10_000 });

    // Fill form
    await page.getByPlaceholder("Имя").fill("Тест Репетитор");
    await page.getByPlaceholder("Email").fill("new-tutor@example.com");
    await page.getByPlaceholder("Пароль (минимум 8 символов)").fill("TestPass1");

    // Submit
    await page.getByRole("button", { name: "Зарегистрироваться" }).click();

    // Should navigate to tutor dashboard
    await page.waitForURL("**/tutor/dashboard", { timeout: 15_000 });
  });

  test("existing email → signIn + upgrade → redirect to dashboard", async ({ page }) => {
    const SUPABASE = "https://vrsseotrfmsxpbciyqzc.supabase.co";

    // 1) Block all Supabase first
    await blockAllSupabaseRequests(page);

    // 2) Mock signUp to fail with "already registered"
    await page.route(`${SUPABASE}/auth/v1/signup**`, async (route) => {
      await route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({
          error: "User already registered",
          message: "User already registered",
        }),
      });
    });

    // 3) Mock signIn to succeed
    await page.route(`${SUPABASE}/auth/v1/token**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(fakeSession),
      });
    });

    // 4) Mock getUser
    await page.route(`${SUPABASE}/auth/v1/user**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(fakeSession.user),
      });
    });

    // 5) Mock assign-tutor-role
    await page.route(`${SUPABASE}/functions/v1/assign-tutor-role`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      });
    });

    // 6) Mock is_tutor → true (after upgrade)
    await page.route(`${SUPABASE}/rest/v1/rpc/is_tutor`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(true),
      });
    });

    await page.goto("/register-tutor");
    await expect(page.getByText("Регистрация репетитора")).toBeVisible({ timeout: 10_000 });

    // Fill form with existing email
    await page.getByPlaceholder("Имя").fill("Существующий Репетитор");
    await page.getByPlaceholder("Email").fill("existing@example.com");
    await page.getByPlaceholder("Пароль (минимум 8 символов)").fill("TestPass1");

    // Submit
    await page.getByRole("button", { name: "Зарегистрироваться" }).click();

    // Should show success toast and redirect (not "уже зарегистрирован" error)
    await page.waitForURL("**/tutor/dashboard", { timeout: 15_000 });
  });

  test("existing email + wrong password → shows clear error", async ({ page }) => {
    const SUPABASE = "https://vrsseotrfmsxpbciyqzc.supabase.co";

    await blockAllSupabaseRequests(page);

    // Mock signUp → fail
    await page.route(`${SUPABASE}/auth/v1/signup**`, async (route) => {
      await route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({
          error: "User already registered",
          message: "User already registered",
        }),
      });
    });

    // Mock signIn → fail (wrong password)
    await page.route(`${SUPABASE}/auth/v1/token**`, async (route) => {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          error: "invalid_grant",
          error_description: "Invalid login credentials",
        }),
      });
    });

    await page.goto("/register-tutor");
    await expect(page.getByText("Регистрация репетитора")).toBeVisible({ timeout: 10_000 });

    await page.getByPlaceholder("Имя").fill("Тест");
    await page.getByPlaceholder("Email").fill("existing@example.com");
    await page.getByPlaceholder("Пароль (минимум 8 символов)").fill("WrongPass1");

    await page.getByRole("button", { name: "Зарегистрироваться" }).click();

    // Should show a helpful error message
    await expect(
      page.getByText(/уже зарегистрирован|Проверьте пароль|войдите через страницу входа/i)
    ).toBeVisible({ timeout: 10_000 });

    // Should stay on the page (not redirect)
    expect(page.url()).toContain("/register-tutor");
  });
});

// ─────────────────────────────────────────────────
// TutorGuard
// ─────────────────────────────────────────────────
test.describe("TutorGuard", () => {
  test("non-tutor user is redirected away from dashboard", async ({ page }) => {
    await mockSupabaseAuth(page, { isTutor: false });
    await injectSession(page);

    await page.goto("/tutor/dashboard");

    // TutorGuard should redirect non-tutors
    await page.waitForURL("**/register-tutor", { timeout: 20_000 });
  });

  test("tutor user can access dashboard", async ({ page }) => {
    await mockSupabaseAuth(page, { isTutor: true });
    await injectSession(page);

    await page.goto("/tutor/dashboard");

    // Should stay on dashboard (not redirect)
    await page.waitForTimeout(3_000);
    expect(page.url()).toContain("/tutor/dashboard");
  });
});
