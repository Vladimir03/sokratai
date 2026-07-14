/**
 * Custom Yandex ID OAuth flow — Phase 2: callback (RU-bypass).
 *
 * Receives Yandex's authorization code, exchanges it server-to-server for an
 * access_token, reads the verified profile from login.yandex.ru/info, finds-or-
 * creates the matching Supabase user, mints a session via the magic-link +
 * verifyOtp pattern, and redirects the browser to redirectTo with the Supabase
 * tokens in the URL hash (detectSessionInUrl auto-parses them).
 *
 * Difference from Google: Yandex's token endpoint returns no id_token, so the
 * verified email/name/avatar come from the login.yandex.ru/info endpoint
 * (Authorization: OAuth <access_token>), not from a decoded JWT.
 *
 * Companion: oauth-yandex-init. Shared mechanics: _shared/oauth-helpers.ts.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  PROXY_URL,
  corsHeaders,
  verifyStateDetailed,
  normalizeStatePayload,
  findOrCreateUser,
  mintSession,
  assignTutorRoleIfNeeded,
  redirectWithSessionHash,
  redirectToError,
} from "../_shared/oauth-helpers.ts";
import { persistPromoAttributionAndTrack } from "../_shared/promo-intent.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const YANDEX_CLIENT_ID = Deno.env.get("YANDEX_OAUTH_CLIENT_ID");
const YANDEX_CLIENT_SECRET = Deno.env.get("YANDEX_OAUTH_CLIENT_SECRET");
const STATE_SECRET = Deno.env.get("OAUTH_STATE_SECRET");

const ERR_EVENT = "oauth_yandex_callback_failed";

type YandexInfo = {
  id?: string;
  login?: string;
  default_email?: string;
  emails?: string[];
  display_name?: string;
  real_name?: string;
  default_avatar_id?: string;
  is_avatar_empty?: boolean;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (!YANDEX_CLIENT_ID || !YANDEX_CLIENT_SECRET || !STATE_SECRET) {
    console.error("[oauth-yandex-callback] missing env vars");
    return redirectToError("not_configured", ERR_EVENT);
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const providerError = url.searchParams.get("error");

  if (providerError) {
    console.warn("[oauth-yandex-callback] Yandex returned error:", providerError);
    return redirectToError(`yandex_${providerError}`, ERR_EVENT);
  }
  if (!code || !state) {
    return redirectToError("missing_code_or_state", ERR_EVENT);
  }

  // Detailed verify + PII-free diagnostics (mirror of the VK callback).
  const stateRes = await verifyStateDetailed(state, STATE_SECRET);
  if (!stateRes.ok) {
    return redirectToError("invalid_state", ERR_EVENT, {
      why: stateRes.failure,
      len: String(state.length),
    });
  }
  const norm = normalizeStatePayload(stateRes.payload);
  if (!norm.redirectTo) {
    return redirectToError("invalid_state", ERR_EVENT, {
      why: "missing_fields",
      len: String(state.length),
    });
  }
  const redirectTo = norm.redirectTo;
  const intendedRole = norm.intendedRole;
  // QR/referral attribution (egor-qr-onboarding), threaded through the state.
  const promo = norm.promo;
  const ref = norm.ref;

  // ─── 1. Exchange code → Yandex access_token (server-to-server) ───
  const tokenRes = await fetch("https://oauth.yandex.ru/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: YANDEX_CLIENT_ID,
      client_secret: YANDEX_CLIENT_SECRET,
    }),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    console.error("[oauth-yandex-callback] token exchange failed", {
      status: tokenRes.status,
      body: text.slice(0, 500),
    });
    return redirectToError("token_exchange_failed", ERR_EVENT);
  }

  const tokenJson = (await tokenRes.json()) as { access_token?: string };
  if (!tokenJson.access_token) {
    return redirectToError("no_access_token", ERR_EVENT);
  }

  // ─── 2. Read verified profile from login.yandex.ru/info ───
  const infoRes = await fetch("https://login.yandex.ru/info?format=json", {
    headers: { Authorization: `OAuth ${tokenJson.access_token}` },
  });
  if (!infoRes.ok) {
    console.error("[oauth-yandex-callback] userinfo failed", infoRes.status);
    return redirectToError("userinfo_failed", ERR_EVENT);
  }
  const info = (await infoRes.json()) as YandexInfo;

  const rawEmail =
    info.default_email ||
    (Array.isArray(info.emails) && info.emails.length > 0 ? info.emails[0] : undefined);
  if (!rawEmail) {
    // login:email scope not granted / no confirmed email — can't key a user.
    return redirectToError("no_email", ERR_EVENT);
  }
  const email = rawEmail.trim().toLowerCase();
  const fullName = info.display_name || info.real_name || info.login || null;
  const avatarUrl =
    info.default_avatar_id && !info.is_avatar_empty
      ? `https://avatars.yandex.net/get-yapic/${info.default_avatar_id}/islands-200`
      : null;

  // ─── 3. Find or create the Supabase user (admin client) ───
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const signupSource =
    intendedRole === "tutor" ? "yandex-oauth-tutor" : "yandex-oauth-student";

  const created = await findOrCreateUser(admin, email, {
    username: email.split("@")[0],
    full_name: fullName,
    yandex_id: info.id ?? null,
    avatar_url: avatarUrl,
    signup_source: signupSource,
    ...(promo ? { promo } : {}),
    ...(ref ? { ref } : {}),
  });
  if ("error" in created) {
    return redirectToError(created.error, ERR_EVENT);
  }

  // ─── 4. Mint a Supabase session ───
  const minted = await mintSession(admin, SUPABASE_URL, SUPABASE_ANON_KEY, email);
  if ("error" in minted) {
    return redirectToError(minted.error, ERR_EVENT);
  }

  // ─── 5. Server-side tutor role finalization (new tutors only) ───
  const roleStatus = await assignTutorRoleIfNeeded(
    admin,
    minted.userId,
    intendedRole,
    created.isNewUser,
    fullName,
    email,
  );
  if (roleStatus === "role_failed") {
    return redirectToError("role_finalization_failed", ERR_EVENT);
  }

  // Persist QR/referral attribution — ONLY for a newly-created TUTOR account
  // (P1 #5: attribution belongs to tutor registration, not to logins nor to
  // student OAuth signups — else 'egor' would land on a student profile).
  // Idempotent, best-effort, PII-free. Does not touch role/session logic (rule 96).
  if (created.isNewUser && intendedRole === "tutor") {
    await persistPromoAttributionAndTrack(admin, minted.userId, { promo, ref });
  }

  // ─── 6. Redirect browser with tokens in URL hash ───
  console.warn(
    JSON.stringify({
      event: "oauth_yandex_callback_succeeded",
      timestamp: new Date().toISOString(),
    }),
  );
  return redirectWithSessionHash(redirectTo, minted.session);
});
