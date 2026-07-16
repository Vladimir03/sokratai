/**
 * Custom Yandex ID OAuth flow — Phase 1: init (RU-bypass).
 *
 * Russian-law-compliant replacement for Google (law 406-ФЗ / rule 96): Yandex is
 * a Russian information system, so Yandex ID authorization is allowed.
 *
 * Mirrors the proven oauth-google-init mechanics via _shared/oauth-helpers.ts.
 * Keeps user-facing traffic on api.sokratai.ru (Selectel Moscow proxy).
 *
 * Flow:
 *   Frontend → GET /functions/v1/oauth-yandex-init?redirectTo=<abs URL>&intendedRole=<role>
 *            ↓ (302)
 *   Browser  → oauth.yandex.ru/authorize?response_type=code&client_id=...
 *                &redirect_uri=https://api.sokratai.ru/functions/v1/oauth-yandex-callback
 *                &state=<HMAC-signed JSON>&force_confirm=yes
 *
 * Required ops setup:
 *   - Yandex OAuth app (oauth.yandex.ru): permissions login:email, login:info,
 *     login:avatar; Callback URI = https://api.sokratai.ru/functions/v1/oauth-yandex-callback
 *   - Supabase Edge secrets: YANDEX_OAUTH_CLIENT_ID, YANDEX_OAUTH_CLIENT_SECRET,
 *     OAUTH_STATE_SECRET (reused from the Google flow).
 */

import {
  corsHeaders,
  PROXY_URL,
  isAllowedRedirect,
  deriveIntendedRole,
  signStateBounded,
  buildCompactStatePayload,
  buildNonceCookie,
} from "../_shared/oauth-helpers.ts";

const YANDEX_CLIENT_ID = Deno.env.get("YANDEX_OAUTH_CLIENT_ID");
const STATE_SECRET = Deno.env.get("OAUTH_STATE_SECRET");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (!YANDEX_CLIENT_ID || !STATE_SECRET) {
    console.error("[oauth-yandex-init] missing env vars", {
      hasClientId: !!YANDEX_CLIENT_ID,
      hasStateSecret: !!STATE_SECRET,
    });
    return new Response(
      "Yandex OAuth not configured (missing YANDEX_OAUTH_CLIENT_ID or OAUTH_STATE_SECRET).",
      { status: 500, headers: corsHeaders },
    );
  }

  const url = new URL(req.url);
  const rawRedirectTo =
    url.searchParams.get("redirectTo") || "https://sokratai.ru/chat";

  if (!isAllowedRedirect(rawRedirectTo)) {
    console.warn("[oauth-yandex-init] redirectTo not in allow-list", { rawRedirectTo });
    return new Response(`redirectTo origin not allowed: ${rawRedirectTo}`, {
      status: 400,
      headers: corsHeaders,
    });
  }

  // Path-based tutor-intent guard (rule 96 #6) lives in the shared helper.
  const intendedRole = deriveIntendedRole(
    url.searchParams.get("intendedRole"),
    rawRedirectTo,
  );

  // QR/referral attribution (egor-qr-onboarding) — carried in the HMAC-signed
  // state so the callback can persist it after the OAuth round-trip (localStorage
  // is lost across the provider redirect). Additive: does NOT affect role/redirect
  // derivation. Absent for non-referral logins.
  const promo = url.searchParams.get("promo");
  const ref = url.searchParams.get("ref");
  const rc = url.searchParams.get("rc"); // реферальный код коллеги (Stage 3)

  // Compact payload (short keys, path-only redirect) — mirrors the VK flow;
  // providers may mangle long state values (see oauth-helpers 2026-07-14).
  const statePayload = buildCompactStatePayload({
    redirectTo: rawRedirectTo,
    intendedRole,
    promo,
    ref,
    rc,
  });

  // Budget-enforced signing (≤ MAX_STATE_CHARS) — providers mangle longer states.
  const state = await signStateBounded(statePayload, STATE_SECRET);

  const authUrl = new URL("https://oauth.yandex.ru/authorize");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", YANDEX_CLIENT_ID);
  authUrl.searchParams.set(
    "redirect_uri",
    `${PROXY_URL}/functions/v1/oauth-yandex-callback`,
  );
  authUrl.searchParams.set("state", state);
  // Force the account picker every time (Yandex equivalent of Google's
  // prompt=select_account). Scopes are configured on the Yandex app itself.
  authUrl.searchParams.set("force_confirm", "yes");

  // Manual 302 (Response.redirect forbids extra headers): bind the flow to
  // this browser via the nonce cookie — login-CSRF guard, verified in callback.
  return new Response(null, {
    status: 302,
    headers: {
      Location: authUrl.toString(),
      "Set-Cookie": buildNonceCookie("yandex", String(statePayload.n)),
      "Cache-Control": "no-store",
    },
  });
});

// deploy-touch 2026-07-14: re-deploy via Lovable sync so verify_jwt=false from config.toml is honored (agent deploy tool flips it to true — rule 96 §11a)
