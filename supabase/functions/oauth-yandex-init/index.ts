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
  signState,
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

  const state = await signState(
    {
      redirectTo: rawRedirectTo,
      intendedRole,
      nonce: crypto.randomUUID(),
      issuedAt: Date.now(),
    },
    STATE_SECRET,
  );

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

  return Response.redirect(authUrl.toString(), 302);
});
