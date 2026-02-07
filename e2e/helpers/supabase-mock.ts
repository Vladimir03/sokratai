import { Page } from "@playwright/test";

const SUPABASE_URL = "https://vrsseotrfmsxpbciyqzc.supabase.co";

/** Fake UUIDs for tests */
export const FAKE_USER_ID = "11111111-1111-1111-1111-111111111111";
export const FAKE_TOKEN = "testtoken_abc123def456ghi789jkl012";

/**
 * Fake JWT access token. Must be a valid JWT format (header.payload.signature)
 * because Supabase client calls decodeJWTPayload() on it in setSession().
 * exp=9999999999 so it never expires during tests.
 */
const FAKE_JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMTExMTExMS0xMTExLTExMTEtMTExMS0xMTExMTExMTExMTEiLCJhdWQiOiJhdXRoZW50aWNhdGVkIiwicm9sZSI6ImF1dGhlbnRpY2F0ZWQiLCJleHAiOjk5OTk5OTk5OTksImlhdCI6MTcwMDAwMDAwMCwiZW1haWwiOiJ0ZWxlZ3JhbV85OTlAdGVtcC5zb2tyYXRhaS5ydSJ9.fake_signature_for_tests";

/** Fake Supabase session returned after login */
export function makeFakeSession(overrides?: { userId?: string; email?: string }) {
  return {
    access_token: FAKE_JWT,
    refresh_token: "fake-refresh-token-for-tests",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: overrides?.userId ?? FAKE_USER_ID,
      email: overrides?.email ?? "telegram_999@temp.sokratai.ru",
      aud: "authenticated",
      role: "authenticated",
      user_metadata: { telegram_user_id: 999 },
      app_metadata: { provider: "email" },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  };
}

export const fakeSession = makeFakeSession();

/**
 * Blocks ALL requests to the Supabase domain.
 * Must be called BEFORE any page.goto() to prevent network errors
 * that crash the page in environments where Supabase is unreachable.
 */
export async function blockAllSupabaseRequests(page: Page) {
  await page.route(`${SUPABASE_URL}/**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(null),
    });
  });
}

/**
 * Blocks ALL external HTTPS requests and neutralizes Yandex Metrika.
 *
 * Must be called BEFORE page.goto() to prevent:
 * 1. External script loads (Yandex Metrika) causing DNS failures
 * 2. Any HTTPS request to non-localhost domains crashing the renderer
 *
 * Also strips dns-prefetch/preconnect hints from the HTML response
 * to prevent early DNS lookups that can't be intercepted by page.route().
 */
export async function blockAllExternalRequests(page: Page) {
  // 1) Mock WebSocket + Yandex Metrika before any page JS runs.
  //    WebSocket mock is critical: Supabase realtime tries to open a
  //    wss:// connection that page.route() can't intercept. Failed
  //    WebSocket connections crash the Chromium renderer in sandboxed envs.
  await page.addInitScript(() => {
    // Replace Yandex Metrika
    (window as any).ym = function () {};

    // Mock WebSocket for external connections (keep localhost for Vite HMR)
    const OrigWS = window.WebSocket;
    const MockWS = function (this: any, url: string | URL, protocols?: string | string[]) {
      const urlStr = url.toString();
      // Allow localhost WebSocket connections (Vite HMR)
      if (urlStr.includes("localhost") || urlStr.includes("127.0.0.1")) {
        return new OrigWS(url, protocols);
      }
      // For external WebSocket connections, create a fake that immediately closes
      this.url = urlStr;
      this.readyState = 3; // CLOSED
      this.protocol = "";
      this.extensions = "";
      this.bufferedAmount = 0;
      this.binaryType = "blob";
      this.onopen = null;
      this.onerror = null;
      this.onclose = null;
      this.onmessage = null;
      this.send = function () {};
      this.close = function () { this.readyState = 3; };
      this.addEventListener = function () {};
      this.removeEventListener = function () {};
      this.dispatchEvent = function () { return true; };
      // Fire onclose after a tick
      const self = this;
      setTimeout(function () {
        if (self.onclose) {
          self.onclose({ code: 1006, reason: "test-env", wasClean: false });
        }
      }, 10);
    } as any;
    MockWS.CONNECTING = 0;
    MockWS.OPEN = 1;
    MockWS.CLOSING = 2;
    MockWS.CLOSED = 3;
    (window as any).WebSocket = MockWS;
  });

  // 2) Intercept the HTML page response to strip dns-prefetch/preconnect/metrika
  await page.route(/http:\/\/localhost:\d+\/.*/, async (route) => {
    const request = route.request();
    // Only modify HTML navigation requests, not JS/CSS/etc
    if (
      request.resourceType() === "document" ||
      (request.headers()["accept"] || "").includes("text/html")
    ) {
      const response = await route.fetch();
      let body = await response.text();

      // Strip dns-prefetch and preconnect hints to external domains
      body = body.replace(/<link[^>]*rel=["'](dns-prefetch|preconnect)["'][^>]*>/gi, "");
      // Strip Yandex Metrika script block
      body = body.replace(
        /<!-- Яндекс\.Метрика[\s\S]*?<\/noscript>/gi,
        "<!-- metrika removed for tests -->"
      );

      await route.fulfill({
        response,
        body,
      });
    } else {
      await route.continue();
    }
  });

  // 3) Block all HTTPS requests as a safety net
  await page.route(/^https:\/\//, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(null),
    });
  });
}

/**
 * Injects a fake Supabase session into localStorage so the app
 * thinks the user is already logged in.
 *
 * Uses addInitScript so the session is set before any JS runs on the page.
 * Call BEFORE page.goto('/actual-route').
 */
export async function injectSession(page: Page, session = fakeSession) {
  const supabaseUrl = SUPABASE_URL;
  await page.addInitScript(
    ({ url, sess }) => {
      try {
        const storageKey = `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
        localStorage.setItem(storageKey, JSON.stringify(sess));
      } catch {
        // Ignore if localStorage is not available
      }
    },
    { url: supabaseUrl, sess: session }
  );
}

/** Control object returned by mockSupabaseAuth */
export interface AuthMockControl {
  /** Activate session (call after external login like Telegram) */
  activateSession: () => void;
}

/**
 * Mocks the Supabase auth & RPC endpoints so E2E tests
 * can run without a live backend.
 *
 * IMPORTANT: Call BEFORE page.goto() so routes are intercepted from the start.
 *
 * Returns a control object to activate the session externally
 * (e.g. after Telegram token verification).
 *
 * @param hasSession - whether to simulate a logged-in user
 * @param isTutor - whether is_tutor() RPC should return true
 */
export async function mockSupabaseAuth(
  page: Page,
  opts: { isTutor: boolean; hasSession?: boolean }
): Promise<AuthMockControl> {
  const { isTutor, hasSession = true } = opts;

  // Mutable state: starts as `hasSession`, flips to true after signup/signin
  let sessionActive = hasSession;

  const control: AuthMockControl = {
    activateSession: () => { sessionActive = true; },
  };

  // Catch-all: block everything to Supabase first
  await blockAllSupabaseRequests(page);

  // --- Supabase Auth: token refresh / signIn ---
  await page.route(`${SUPABASE_URL}/auth/v1/token**`, async (route) => {
    if (sessionActive) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(fakeSession),
      });
    } else {
      await route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: "invalid_grant", error_description: "Invalid Refresh Token" }),
      });
    }
  });

  // --- Supabase Auth: getUser ---
  await page.route(`${SUPABASE_URL}/auth/v1/user**`, async (route) => {
    if (sessionActive) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(fakeSession.user),
      });
    } else {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "not_authenticated" }),
      });
    }
  });

  // --- Supabase Auth: signup (activates session) ---
  await page.route(`${SUPABASE_URL}/auth/v1/signup**`, async (route) => {
    sessionActive = true;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(fakeSession),
    });
  });

  // --- Supabase Auth: signout ---
  await page.route(`${SUPABASE_URL}/auth/v1/logout**`, async (route) => {
    sessionActive = false;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({}),
    });
  });

  // --- Supabase RPC: is_tutor ---
  await page.route(`${SUPABASE_URL}/rest/v1/rpc/is_tutor`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(isTutor),
    });
  });

  // --- Edge function: assign-tutor-role ---
  await page.route(`${SUPABASE_URL}/functions/v1/assign-tutor-role`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true }),
    });
  });

  return control;
}

/**
 * Mocks the telegram-login-token edge function.
 *
 * Simulates the full flow:
 * 1. POST (create token) → returns token
 * 2. First few GETs → "pending" (simulates waiting for bot)
 * 3. After `verifyAfterAttempts` GETs → "verified" with session
 *
 * If `authControl` is provided, activates the session when token becomes "verified"
 * so that subsequent setSession → /auth/v1/token calls succeed.
 */
export async function mockTelegramLoginToken(
  page: Page,
  opts: {
    intendedRole?: string;
    verifyAfterAttempts?: number;
    authControl?: AuthMockControl;
  } = {}
) {
  const { intendedRole = null, verifyAfterAttempts = 2, authControl } = opts;
  let pollCount = 0;

  await page.route(
    `${SUPABASE_URL}/functions/v1/telegram-login-token**`,
    async (route) => {
      const url = route.request().url();
      const method = route.request().method();

      // POST: create token
      if (method === "POST" && url.includes("action=create")) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            token: FAKE_TOKEN,
            action_type: "login",
            intended_role: intendedRole,
          }),
        });
        return;
      }

      // GET: check token status (polling)
      if (method === "GET" && url.includes(`token=${FAKE_TOKEN}`)) {
        pollCount++;

        if (pollCount > verifyAfterAttempts) {
          // Activate session BEFORE returning "verified" so that
          // setSession() → /auth/v1/token?grant_type=refresh_token succeeds
          if (authControl) {
            authControl.activateSession();
          }

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
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              status: "pending",
              action_type: "login",
            }),
          });
        }
        return;
      }

      // Fallback for other telegram-login-token requests
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "pending" }),
      });
    }
  );
}
