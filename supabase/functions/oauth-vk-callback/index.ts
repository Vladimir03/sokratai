/**
 * Custom VK ID OAuth flow — Phase 2: callback (RU-bypass).
 *
 * VK ID (id.vk.com) returns code + state + device_id. We complete the OAuth 2.1
 * PKCE token exchange (code_verifier read back from the signed state), read the
 * profile from id.vk.com/oauth2/user_info, find-or-create the Supabase user,
 * mint a session (magic-link + verifyOtp), and redirect with tokens in the hash.
 *
 * Key difference from Google/Yandex: VK does NOT reliably return an email
 * (depends on scope grant + a confirmed VK email). When absent we synthesize a
 * stable placeholder `vk_<vk_user_id>@vk.sokratai.ru` (mirror of the Telegram
 * `@temp.sokratai.ru` pattern) so the email-keyed user model still works; the
 * real VK id is stored in user_metadata.vk_user_id.
 *
 * Companion: oauth-vk-init. Shared mechanics: _shared/oauth-helpers.ts.
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

const VK_CLIENT_ID = Deno.env.get("VK_OAUTH_CLIENT_ID");
const STATE_SECRET = Deno.env.get("OAUTH_STATE_SECRET");

const ERR_EVENT = "oauth_vk_callback_failed";

type VkUser = {
  user_id?: string | number;
  first_name?: string;
  last_name?: string;
  email?: string;
  avatar?: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (!VK_CLIENT_ID || !STATE_SECRET) {
    console.error("[oauth-vk-callback] missing env vars");
    return redirectToError("not_configured", ERR_EVENT);
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const deviceId = url.searchParams.get("device_id");
  const providerError = url.searchParams.get("error");

  if (providerError) {
    console.warn("[oauth-vk-callback] VK returned error:", providerError);
    return redirectToError(`vk_${providerError}`, ERR_EVENT);
  }
  if (!code || !state || !deviceId) {
    return redirectToError("missing_code_state_or_device", ERR_EVENT);
  }

  // Detailed verify: on failure the redirect carries a PII-free diagnostic
  // (`why` = sig|ttl|malformed|missing_fields, `len` = received state length)
  // so a single real login attempt pinpoints how VK mangled the state.
  const stateRes = await verifyStateDetailed(state, STATE_SECRET);
  if (!stateRes.ok) {
    return redirectToError("invalid_state", ERR_EVENT, {
      why: stateRes.failure,
      len: String(state.length),
    });
  }
  const norm = normalizeStatePayload(stateRes.payload);
  if (!norm.redirectTo || !norm.codeVerifier) {
    return redirectToError("invalid_state", ERR_EVENT, {
      why: "missing_fields",
      len: String(state.length),
    });
  }
  const redirectTo = norm.redirectTo;
  const intendedRole = norm.intendedRole;
  const codeVerifier = norm.codeVerifier;
  // QR/referral attribution (egor-qr-onboarding), threaded through the state.
  const promo = norm.promo;
  const ref = norm.ref;

  // ─── 1. Exchange code → VK tokens (OAuth 2.1 PKCE, public client) ───
  const tokenRes = await fetch("https://id.vk.com/oauth2/auth", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      code_verifier: codeVerifier,
      client_id: VK_CLIENT_ID,
      device_id: deviceId,
      redirect_uri: `${PROXY_URL}/functions/v1/oauth-vk-callback`,
    }),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    console.error("[oauth-vk-callback] token exchange failed", {
      status: tokenRes.status,
      body: text.slice(0, 500),
    });
    return redirectToError("token_exchange_failed", ERR_EVENT);
  }

  const tokenJson = (await tokenRes.json()) as {
    access_token?: string;
    user_id?: number;
  };
  if (!tokenJson.access_token) {
    return redirectToError("no_access_token", ERR_EVENT);
  }

  // ─── 2. Read profile from id.vk.com/oauth2/user_info ───
  const infoRes = await fetch("https://id.vk.com/oauth2/user_info", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      access_token: tokenJson.access_token,
      client_id: VK_CLIENT_ID,
    }),
  });
  if (!infoRes.ok) {
    console.error("[oauth-vk-callback] userinfo failed", infoRes.status);
    return redirectToError("userinfo_failed", ERR_EVENT);
  }
  const infoJson = (await infoRes.json()) as { user?: VkUser };
  const vkUser: VkUser = infoJson.user ?? {};
  const vkUserId = String(vkUser.user_id ?? tokenJson.user_id ?? "").trim();
  if (!vkUserId) {
    return redirectToError("no_user_id", ERR_EVENT);
  }

  const rawEmail =
    typeof vkUser.email === "string" && vkUser.email.includes("@")
      ? vkUser.email.trim().toLowerCase()
      : null;
  // Email-absent fallback — stable placeholder keyed on VK user id.
  const email = rawEmail ?? `vk_${vkUserId}@vk.sokratai.ru`;
  const fullName =
    [vkUser.first_name, vkUser.last_name].filter(Boolean).join(" ").trim() || null;
  const avatarUrl = typeof vkUser.avatar === "string" ? vkUser.avatar : null;

  // ─── 3. Find or create the Supabase user ───
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const signupSource =
    intendedRole === "tutor" ? "vk-oauth-tutor" : "vk-oauth-student";

  const created = await findOrCreateUser(admin, email, {
    username: email.split("@")[0],
    full_name: fullName,
    vk_user_id: vkUserId,
    avatar_url: avatarUrl,
    signup_source: signupSource,
    email_synthesized: rawEmail === null,
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
  // (P1 #5: not logins nor student OAuth signups — else 'egor' lands on a student
  // profile). Rule 96: additive, does not touch role/session logic. Best-effort.
  if (created.isNewUser && intendedRole === "tutor") {
    await persistPromoAttributionAndTrack(admin, minted.userId, { promo, ref });
  }

  // ─── 6. Redirect browser with tokens in URL hash ───
  console.warn(
    JSON.stringify({
      event: "oauth_vk_callback_succeeded",
      email_synthesized: rawEmail === null,
      timestamp: new Date().toISOString(),
    }),
  );
  return redirectWithSessionHash(redirectTo, minted.session);
});
