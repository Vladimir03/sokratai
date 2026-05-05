/**
 * Custom Google OAuth flow — Phase 2: callback.
 *
 * Receives Google's authorization code, exchanges server-to-server for an
 * id_token + access_token, derives the user's verified email, finds-or-
 * creates the matching Supabase user, mints a session via the magic-link
 * token-hash + verifyOtp pattern (same trick telegram-bot/handleWebLogin
 * uses), and redirects the browser to the original redirectTo with the
 * Supabase tokens in the URL hash. supabase-js auto-detects them on
 * landing (`detectSessionInUrl: true`).
 *
 * Why custom: hosted Supabase forces redirect_uri to its canonical
 * `*.supabase.co/auth/v1/callback`, which RU ISPs block. With this
 * custom callback the Google round-trip stays inside `api.sokratai.ru`
 * (Selectel Moscow proxy) for user-facing requests, while the
 * server-to-server token exchange to oauth2.googleapis.com runs from
 * the edge function host (US, no RU block).
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Cache-Control": "no-store",
};

const PROXY_URL = "https://api.sokratai.ru";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID");
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET");
const STATE_SECRET = Deno.env.get("OAUTH_STATE_SECRET");

const STATE_TTL_MS = 10 * 60 * 1000; // 10 min — covers slow consent flow.

const FALLBACK_LOGIN_URL = "https://sokratai.ru/login";

// ─── helpers ─────────────────────────────────────────────────────────────

function base64UrlDecode(input: string): Uint8Array {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (padded.length % 4)) % 4);
  const binary = atob(padded + padding);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function verifyState(
  state: string,
  secret: string,
): Promise<{ redirectTo: string; nonce: string; issuedAt: number } | null> {
  const [dataB64, sigB64] = state.split(".");
  if (!dataB64 || !sigB64) return null;

  try {
    const encoder = new TextEncoder();
    const dataBytes = base64UrlDecode(dataB64);
    const sigBytes = base64UrlDecode(sigB64);
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const ok = await crypto.subtle.verify("HMAC", key, sigBytes, dataBytes);
    if (!ok) return null;

    const decoded = new TextDecoder().decode(dataBytes);
    const parsed = JSON.parse(decoded);
    if (
      typeof parsed.redirectTo !== "string" ||
      typeof parsed.nonce !== "string" ||
      typeof parsed.issuedAt !== "number"
    ) {
      return null;
    }
    if (Date.now() - parsed.issuedAt > STATE_TTL_MS) return null;
    return parsed;
  } catch (e) {
    console.warn("[oauth-google-callback] verifyState threw", e);
    return null;
  }
}

function decodeIdToken(
  idToken: string,
): { email: string; email_verified: boolean; name?: string; sub: string; picture?: string } | null {
  try {
    const parts = idToken.split(".");
    if (parts.length !== 3) return null;
    const payloadBytes = base64UrlDecode(parts[1]);
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes));
    if (typeof payload.email !== "string") return null;
    return payload;
  } catch (e) {
    console.warn("[oauth-google-callback] decodeIdToken threw", e);
    return null;
  }
}

function redirectToErrorPage(reason: string): Response {
  const target = new URL(FALLBACK_LOGIN_URL);
  target.searchParams.set("oauth_error", reason);
  return Response.redirect(target.toString(), 302);
}

// ─── main handler ────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !STATE_SECRET) {
    console.error("[oauth-google-callback] missing env vars");
    return redirectToErrorPage("not_configured");
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const googleError = url.searchParams.get("error");

  if (googleError) {
    console.warn("[oauth-google-callback] Google returned error:", googleError);
    return redirectToErrorPage(`google_${googleError}`);
  }

  if (!code || !state) {
    return redirectToErrorPage("missing_code_or_state");
  }

  const stateData = await verifyState(state, STATE_SECRET);
  if (!stateData) {
    return redirectToErrorPage("invalid_state");
  }

  // ─── 1. Exchange code → Google tokens (server-to-server) ───
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: `${PROXY_URL}/functions/v1/oauth-google-callback`,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    console.error("[oauth-google-callback] token exchange failed", {
      status: tokenRes.status,
      body: text.slice(0, 500),
    });
    return redirectToErrorPage("token_exchange_failed");
  }

  const tokenJson = (await tokenRes.json()) as {
    id_token?: string;
    access_token?: string;
  };

  if (!tokenJson.id_token) {
    return redirectToErrorPage("no_id_token");
  }

  const idTokenPayload = decodeIdToken(tokenJson.id_token);
  if (!idTokenPayload || !idTokenPayload.email) {
    return redirectToErrorPage("invalid_id_token");
  }

  // Trust signal: only accept verified Google emails. Unverified email
  // means user added it but didn't confirm — Google won't let us trust it.
  if (idTokenPayload.email_verified === false) {
    return redirectToErrorPage("email_not_verified");
  }

  const email = idTokenPayload.email.trim().toLowerCase();
  console.log("[oauth-google-callback] verified email:", email);

  // ─── 2. Find or create the Supabase user (admin client, never leaked) ───
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // createUser is idempotent-by-error-code: if email already exists we just
  // skip creation and proceed to mint a session.
  const { error: createError } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: {
      username: email.split("@")[0],
      full_name: idTokenPayload.name ?? null,
      google_sub: idTokenPayload.sub,
      avatar_url: idTokenPayload.picture ?? null,
      signup_source: "google-oauth-custom",
    },
  });

  if (createError) {
    const msg = createError.message?.toLowerCase() ?? "";
    const isAlreadyExists =
      msg.includes("already") ||
      msg.includes("exists") ||
      // newer supabase-js exposes a typed code:
      (createError as unknown as { code?: string }).code === "email_exists";

    if (!isAlreadyExists) {
      console.error("[oauth-google-callback] createUser failed", createError);
      return redirectToErrorPage("create_user_failed");
    }
    // existing user — fine, proceed to session mint.
  }

  // ─── 3. Mint a Supabase session via magic-link → verifyOtp ───
  // Same pattern as telegram-bot/handleWebLogin (verified-by-bot path).
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });

  if (linkError || !linkData?.properties?.hashed_token) {
    console.error("[oauth-google-callback] generateLink failed", linkError);
    return redirectToErrorPage("link_failed");
  }

  // verifyOtp must run on a NON-admin client. The admin singleton above
  // would get its in-memory session contaminated by verifyOtp, then
  // subsequent admin.from(...) writes would silently use the user JWT
  // instead of service_role. We don't have any post-verify writes here,
  // but using a separate anon client is the bulletproof default.
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: verifyData, error: verifyError } = await anon.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: "magiclink",
  });

  if (verifyError || !verifyData?.session) {
    console.error("[oauth-google-callback] verifyOtp failed", verifyError);
    return redirectToErrorPage("verify_failed");
  }

  // ─── 4. Redirect browser to redirectTo with tokens in URL hash ───
  const target = new URL(stateData.redirectTo);
  target.hash = new URLSearchParams({
    access_token: verifyData.session.access_token,
    refresh_token: verifyData.session.refresh_token,
    expires_in: String(verifyData.session.expires_in ?? 3600),
    token_type: "bearer",
    type: "signup",
  }).toString();

  console.log("[oauth-google-callback] success, redirecting to", target.origin + target.pathname);
  return Response.redirect(target.toString(), 302);
});
