import { test, expect } from "@playwright/test";
import {
  mockSupabaseAuth,
  mockTelegramLoginToken,
  FAKE_TOKEN,
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

test.describe("Tutor Registration page", () => {
  test.beforeEach(async ({ page }) => {
    // Block window.open to prevent Telegram links from opening
    await page.addInitScript(() => {
      window.open = () => null;
    });
  });

  test("page loads and shows both registration methods", async ({ page }) => {
    await page.goto("/register-tutor");

    await expect(page.getByText("Регистрация репетитора")).toBeVisible();
    await expect(page.getByText("Войти через Telegram")).toBeVisible();
    await expect(page.getByPlaceholder("Имя")).toBeVisible();
    await expect(page.getByPlaceholder("Email")).toBeVisible();
    await expect(page.getByPlaceholder("Пароль (минимум 8 символов)")).toBeVisible();
    await expect(page.getByRole("button", { name: "Зарегистрироваться" })).toBeVisible();
  });

  test("redirects existing tutor to dashboard", async ({ page }) => {
    // User is already logged in AND is a tutor
    await mockSupabaseAuth(page, { isTutor: true });

    await page.goto("/register-tutor");

    // Should redirect to tutor dashboard
    await page.waitForURL("**/tutor/dashboard", { timeout: 10_000 });
  });

  test("shows form for logged-in non-tutor user", async ({ page }) => {
    // User is logged in but NOT a tutor
    await mockSupabaseAuth(page, { isTutor: false });

    await page.goto("/register-tutor");

    // Should stay on register page and show the form
    await expect(page.getByText("Регистрация репетитора")).toBeVisible();
    await expect(page.getByRole("button", { name: "Зарегистрироваться" })).toBeVisible();
  });
});

test.describe("Tutor registration via Telegram → dashboard", () => {
  test.beforeEach(async ({ page }) => {
    // Block window.open / location.href to prevent Telegram navigation
    await page.addInitScript(() => {
      window.open = () => null;
    });
  });

  test("successful Telegram login redirects to tutor dashboard", async ({ page }) => {
    // Mock: after 2 polls, token becomes "verified", and is_tutor returns true
    await mockSupabaseAuth(page, { isTutor: true });
    await mockTelegramLoginToken(page, {
      intendedRole: "tutor",
      verifyAfterAttempts: 2,
    });

    await page.goto("/register-tutor");

    // Click "Войти через Telegram"
    await page.getByRole("button", { name: "Войти через Telegram" }).click();

    // Should show "Ожидание подтверждения..."
    await expect(page.getByText("Ожидание подтверждения")).toBeVisible();

    // After polling detects "verified" → should show "Вход выполнен!"
    await expect(page.getByText("Вход выполнен!")).toBeVisible({ timeout: 15_000 });

    // Should redirect to tutor dashboard (not /chat!)
    await page.waitForURL("**/tutor/dashboard", { timeout: 15_000 });
  });

  test("Telegram login with intended_role=tutor must NOT redirect to /chat", async ({ page }) => {
    // This is the exact bug scenario: Telegram auth succeeds, role is "tutor"
    // but without the fix, is_tutor fails and user ends up in /chat
    await mockTelegramLoginToken(page, {
      intendedRole: "tutor",
      verifyAfterAttempts: 1,
    });
    await mockSupabaseAuth(page, { isTutor: true });

    await page.goto("/register-tutor");
    await page.getByRole("button", { name: "Войти через Telegram" }).click();

    // Wait for success
    await expect(page.getByText("Вход выполнен!")).toBeVisible({ timeout: 15_000 });

    // Wait for navigation to settle
    await page.waitForURL("**/*", { timeout: 15_000 });
    const url = page.url();

    // CRITICAL: must NOT be /chat
    expect(url).not.toContain("/chat");
    // Should be tutor dashboard
    expect(url).toContain("/tutor/dashboard");
  });
});

test.describe("Tutor registration via email", () => {
  test("new email registration → assign role → redirect to dashboard", async ({ page }) => {
    await mockSupabaseAuth(page, { isTutor: true });

    await page.goto("/register-tutor");

    // Fill form
    await page.getByPlaceholder("Имя").fill("Тест Репетитор");
    await page.getByPlaceholder("Email").fill("new-tutor@example.com");
    await page.getByPlaceholder("Пароль (минимум 8 символов)").fill("TestPass1");

    // Submit
    await page.getByRole("button", { name: "Зарегистрироваться" }).click();

    // Should navigate to tutor dashboard
    await page.waitForURL("**/tutor/dashboard", { timeout: 10_000 });
  });

  test("existing email → signIn + upgrade → redirect to dashboard", async ({ page }) => {
    const SUPABASE_URL = "https://vrsseotrfmsxpbciyqzc.supabase.co";

    // Mock signUp to fail with "already registered"
    await page.route(`${SUPABASE_URL}/auth/v1/signup`, async (route) => {
      await route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({
          error: "User already registered",
          message: "User already registered",
        }),
      });
    });

    // Mock signIn to succeed
    await page.route(`${SUPABASE_URL}/auth/v1/token*`, async (route) => {
      const body = route.request().postDataJSON();
      if (body?.grant_type === "password") {
        // signInWithPassword
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            access_token: "fake-access-token",
            refresh_token: "fake-refresh-token",
            token_type: "bearer",
            expires_in: 3600,
            user: {
              id: "22222222-2222-2222-2222-222222222222",
              email: "existing@example.com",
              aud: "authenticated",
              role: "authenticated",
            },
          }),
        });
      } else {
        await route.continue();
      }
    });

    // Mock assign-tutor-role
    await page.route(
      `${SUPABASE_URL}/functions/v1/assign-tutor-role`,
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true }),
        });
      }
    );

    // Mock is_tutor → true (after upgrade)
    await page.route(`${SUPABASE_URL}/rest/v1/rpc/is_tutor`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(true),
      });
    });

    // Mock getUser
    await page.route(`${SUPABASE_URL}/auth/v1/user`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "22222222-2222-2222-2222-222222222222",
          email: "existing@example.com",
        }),
      });
    });

    await page.goto("/register-tutor");

    // Fill form with existing email
    await page.getByPlaceholder("Имя").fill("Существующий Репетитор");
    await page.getByPlaceholder("Email").fill("existing@example.com");
    await page.getByPlaceholder("Пароль (минимум 8 символов)").fill("TestPass1");

    // Submit
    await page.getByRole("button", { name: "Зарегистрироваться" }).click();

    // Should show success toast and redirect (not "уже зарегистрирован" error)
    await page.waitForURL("**/tutor/dashboard", { timeout: 10_000 });
  });

  test("existing email + wrong password → shows clear error", async ({ page }) => {
    const SUPABASE_URL = "https://vrsseotrfmsxpbciyqzc.supabase.co";

    // Mock signUp → fail
    await page.route(`${SUPABASE_URL}/auth/v1/signup`, async (route) => {
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
    await page.route(`${SUPABASE_URL}/auth/v1/token*`, async (route) => {
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

    await page.getByPlaceholder("Имя").fill("Тест");
    await page.getByPlaceholder("Email").fill("existing@example.com");
    await page.getByPlaceholder("Пароль (минимум 8 символов)").fill("WrongPass1");

    await page.getByRole("button", { name: "Зарегистрироваться" }).click();

    // Should show a helpful error message (not just "already registered")
    await expect(
      page.getByText(/уже зарегистрирован.*Проверьте пароль|войдите через страницу входа/i)
    ).toBeVisible({ timeout: 5_000 });

    // Should stay on the page (not redirect)
    expect(page.url()).toContain("/register-tutor");
  });
});

test.describe("TutorGuard", () => {
  test("non-tutor user is redirected to /register-tutor", async ({ page }) => {
    await mockSupabaseAuth(page, { isTutor: false });

    await page.goto("/tutor/dashboard");

    // TutorGuard should redirect non-tutors to registration
    await page.waitForURL("**/register-tutor", { timeout: 15_000 });
  });

  test("tutor user can access dashboard", async ({ page }) => {
    await mockSupabaseAuth(page, { isTutor: true });

    // Also mock the dashboard data queries
    const SUPABASE_URL = "https://vrsseotrfmsxpbciyqzc.supabase.co";
    await page.route(`${SUPABASE_URL}/rest/v1/**`, async (route) => {
      // Return empty arrays for any data queries
      if (route.request().url().includes("rpc/is_tutor")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(true),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([]),
        });
      }
    });

    await page.goto("/tutor/dashboard");

    // Should stay on dashboard (not redirect)
    await page.waitForTimeout(3_000);
    expect(page.url()).toContain("/tutor/dashboard");
  });
});
