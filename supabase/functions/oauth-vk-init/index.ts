/**
 * Custom VK ID OAuth flow — Phase 1: init (RU-bypass).
 *
 * Russian-law-compliant login provider (law 406-ФЗ / rule 96): VK is a Russian
 * information system, so VK ID authorization is allowed.
 *
 * VK ID uses OAuth 2.1 with mandatory PKCE (id.vk.com). We generate a
 * code_verifier and carry it INSIDE the HMAC-signed state — there is no
 * server-side session store, and the state is integrity-protected + TTL-bound,
 * so the single-use verifier is safe there. The companion callback reads it
 * back to complete the token exchange.
 *
 * Flow:
 *   Frontend → GET /functions/v1/oauth-vk-init?redirectTo=<abs URL>&intendedRole=<role>
 *            ↓ (302)
 *   Browser  → id.vk.com/authorize?response_type=code&client_id=...
 *                &redirect_uri=https://api.sokratai.ru/functions/v1/oauth-vk-callback
 *                &state=<HMAC-signed JSON incl. codeVerifier>
 *                &scope=email&code_challenge=<S256>&code_challenge_method=S256
 *
 * Required ops setup:
 *   - VK ID app (id.vk.com / vk.com/apps): email scope enabled; Redirect URI =
 *     https://api.sokratai.ru/functions/v1/oauth-vk-callback
 *   - Supabase Edge secrets: VK_OAUTH_CLIENT_ID, OAUTH_STATE_SECRET (reused).
 *     (VK_OAUTH_CLIENT_SECRET is not needed for the PKCE public-client flow.)
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  corsHeaders,
  PROXY_URL,
  isAllowedRedirect,
  deriveIntendedRole,
  newStateHandle,
  storeOAuthState,
  buildNonceCookie,
  randomCodeVerifier,
  codeChallengeS256,
} from "../_shared/oauth-helpers.ts";

const VK_CLIENT_ID = Deno.env.get("VK_OAUTH_CLIENT_ID");
const STATE_SECRET = Deno.env.get("OAUTH_STATE_SECRET");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (!VK_CLIENT_ID || !STATE_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("[oauth-vk-init] missing env vars", {
      hasClientId: !!VK_CLIENT_ID,
      hasStateSecret: !!STATE_SECRET,
      hasSupabaseUrl: !!SUPABASE_URL,
      hasServiceKey: !!SUPABASE_SERVICE_ROLE_KEY,
    });
    return new Response(
      "VK OAuth not configured.",
      { status: 500, headers: corsHeaders },
    );
  }

  const url = new URL(req.url);
  const rawRedirectTo =
    url.searchParams.get("redirectTo") || "https://sokratai.ru/chat";

  if (!isAllowedRedirect(rawRedirectTo)) {
    console.warn("[oauth-vk-init] redirectTo not in allow-list", { rawRedirectTo });
    return new Response(`redirectTo origin not allowed: ${rawRedirectTo}`, {
      status: 400,
      headers: corsHeaders,
    });
  }

  const intendedRole = deriveIntendedRole(
    url.searchParams.get("intendedRole"),
    rawRedirectTo,
  );

  // QR/referral attribution (egor-qr-onboarding) — carried in the signed state
  // so the callback can persist it after the redirect. Additive.
  const promo = url.searchParams.get("promo");
  const ref = url.searchParams.get("ref");

  // PKCE — verifier is kept SERVER-SIDE (see below); only the challenge goes to VK.
  const codeVerifier = randomCodeVerifier();
  const codeChallenge = await codeChallengeS256(codeVerifier);

  // VK ID corrupts an OAuth `state` longer than ~128 chars, and our compact
  // state with the inline PKCE verifier is ~195 → invalid_state on every VK
  // login (2026-07-14). Store the full payload server-side keyed by a short
  // random handle; VK only ever round-trips that ~32-char handle.
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const handle = newStateHandle();
  const stored = await storeOAuthState(admin, handle, {
    redirectTo: rawRedirectTo,
    intendedRole,
    codeVerifier,
    ...(promo ? { promo } : {}),
    ...(ref ? { ref } : {}),
  });
  if (!stored) {
    return new Response("Не удалось начать вход. Попробуйте ещё раз.", {
      status: 503,
      headers: corsHeaders,
    });
  }
  const state = handle;

  const authUrl = new URL("https://id.vk.com/authorize");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", VK_CLIENT_ID);
  authUrl.searchParams.set(
    "redirect_uri",
    `${PROXY_URL}/functions/v1/oauth-vk-callback`,
  );
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("scope", "email");
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  // Manual 302 (Response.redirect forbids extra headers): bind the flow to
  // this browser via the nonce cookie (= the store handle) — login-CSRF guard,
  // verified in callback (cookie must equal the returned state handle).
  return new Response(null, {
    status: 302,
    headers: {
      Location: authUrl.toString(),
      "Set-Cookie": buildNonceCookie("vk", handle),
      "Cache-Control": "no-store",
    },
  });
});
