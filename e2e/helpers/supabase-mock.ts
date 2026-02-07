import { Page } from "@playwright/test";

const SUPABASE_URL = "https://vrsseotrfmsxpbciyqzc.supabase.co";

/** Fake UUIDs for tests */
export const FAKE_USER_ID = "11111111-1111-1111-1111-111111111111";
export const FAKE_TOKEN = "testtoken_abc123def456ghi789jkl012";

/** Fake Supabase session returned after login */
export const fakeSession = {
  access_token: "fake-access-token-for-tests",
  refresh_token: "fake-refresh-token-for-tests",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: {
    id: FAKE_USER_ID,
    email: "telegram_999@temp.sokratai.ru",
    aud: "authenticated",
    role: "authenticated",
    user_metadata: { telegram_user_id: 999 },
    app_metadata: { provider: "email" },
    created_at: new Date().toISOString(),
  },
};

/**
 * Mocks the Supabase auth & RPC endpoints so E2E tests
 * can run without a live backend.
 *
 * @param isTutor - whether is_tutor() RPC should return true
 */
export async function mockSupabaseAuth(page: Page, opts: { isTutor: boolean }) {
  // --- Supabase Auth: getSession / getUser / setSession ---
  await page.route(`${SUPABASE_URL}/auth/v1/token*`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(fakeSession),
    });
  });

  await page.route(`${SUPABASE_URL}/auth/v1/user`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(fakeSession.user),
    });
  });

  await page.route(`${SUPABASE_URL}/auth/v1/signup`, async (route) => {
    const body = await route.request().postDataJSON();
    // Simulate successful signup
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ...fakeSession,
        user: {
          ...fakeSession.user,
          email: body.email || fakeSession.user.email,
        },
      }),
    });
  });

  // --- Supabase RPC: is_tutor ---
  await page.route(`${SUPABASE_URL}/rest/v1/rpc/is_tutor`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(opts.isTutor),
    });
  });

  // --- Supabase RPC: other RPCs (fallback) ---
  await page.route(`${SUPABASE_URL}/rest/v1/rpc/*`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(null),
    });
  });

  // --- Edge function: assign-tutor-role ---
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
}

/**
 * Mocks the telegram-login-token edge function.
 *
 * Simulates the full flow:
 * 1. POST (create token) → returns token
 * 2. First few GETs → "pending" (simulates waiting for bot)
 * 3. After `verifyAfterAttempts` GETs → "verified" with session
 *
 * @param intendedRole - "tutor" or null
 * @param verifyAfterAttempts - how many GET polls before token becomes "verified"
 */
export async function mockTelegramLoginToken(
  page: Page,
  opts: {
    intendedRole?: string;
    verifyAfterAttempts?: number;
  } = {}
) {
  const { intendedRole = null, verifyAfterAttempts = 2 } = opts;
  let pollCount = 0;

  // POST: create token
  await page.route(
    `${SUPABASE_URL}/functions/v1/telegram-login-token?action=create`,
    async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            token: FAKE_TOKEN,
            action_type: "login",
            intended_role: intendedRole,
          }),
        });
      } else {
        await route.continue();
      }
    }
  );

  // GET: check token status (polling)
  await page.route(
    `${SUPABASE_URL}/functions/v1/telegram-login-token?token=${FAKE_TOKEN}`,
    async (route) => {
      pollCount++;

      if (pollCount > verifyAfterAttempts) {
        // Token verified — return session
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            status: "verified",
            action_type: "login",
            session: {
              access_token: fakeSession.access_token,
              refresh_token: fakeSession.refresh_token,
            },
            user_id: FAKE_USER_ID,
            intended_role: intendedRole,
          }),
        });
      } else {
        // Still pending
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            status: "pending",
            action_type: "login",
          }),
        });
      }
    }
  );
}

/**
 * Injects a fake Supabase session into localStorage so the app
 * thinks the user is already logged in.
 */
export async function injectSession(page: Page) {
  await page.evaluate(
    ({ url, session }) => {
      const storageKey = `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
      localStorage.setItem(storageKey, JSON.stringify(session));
    },
    { url: SUPABASE_URL, session: fakeSession }
  );
}
