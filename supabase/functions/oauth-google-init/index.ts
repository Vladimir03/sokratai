/**
 * Custom Google OAuth flow — Phase 1: init.
 *
 * Why this exists: hosted Supabase's `auth.signInWithOAuth({ provider: "google" })`
 * tells Google to redirect_uri back to `<project>.supabase.co/auth/v1/callback`,
 * a domain blocked by RU ISPs. The user can reach Google (whitelisted) but
 * cannot complete the round-trip back to *.supabase.co without VPN.
 *
 * Flow:
 *   Frontend  → GET /functions/v1/oauth-google-init?redirectTo=<absolute URL>
 *             ↓ (302)
 *   Browser   → accounts.google.com/o/oauth2/v2/auth?
 *                   client_id=...&
 *                   redirect_uri=https://api.sokratai.ru/functions/v1/oauth-google-callback&
 *                   response_type=code&
 *                   scope=openid email profile&
 *                   state=<HMAC-signed JSON with redirectTo + nonce + ts>
 *
 * Companion: oauth-google-callback handles the return path.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Cache-Control": "no-store",
};

const PROXY_URL = "https://api.sokratai.ru";

const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID");
const STATE_SECRET = Deno.env.get("OAUTH_STATE_SECRET");

// Allow-list for redirectTo to prevent open-redirect abuse.
// Same origins as Supabase Auth → URL Configuration → Additional Redirect URLs.
const ALLOWED_REDIRECT_ORIGINS = [
  "https://sokratai.ru",
  "https://sokratai.lovable.app",
  "http://localhost:8080",
  "http://localhost:3000",
];

function isAllowedRedirect(target: string): boolean {
  try {
    const u = new URL(target);
    return ALLOWED_REDIRECT_ORIGINS.includes(`${u.protocol}//${u.host}`);
  } catch {
    return false;
  }
}

function base64UrlEncode(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signState(payload: Record<string, unknown>, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const dataBytes = encoder.encode(JSON.stringify(payload));
  const dataB64 = base64UrlEncode(dataBytes);

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, dataBytes);
  const sigB64 = base64UrlEncode(sig);
  return `${dataB64}.${sigB64}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (!GOOGLE_CLIENT_ID || !STATE_SECRET) {
    console.error("[oauth-google-init] missing env vars", {
      hasClientId: !!GOOGLE_CLIENT_ID,
      hasStateSecret: !!STATE_SECRET,
    });
    return new Response(
      "Google OAuth not configured (missing GOOGLE_OAUTH_CLIENT_ID or OAUTH_STATE_SECRET).",
      { status: 500, headers: corsHeaders },
    );
  }

  const url = new URL(req.url);
  const rawRedirectTo = url.searchParams.get("redirectTo") || "https://sokratai.ru/chat";

  if (!isAllowedRedirect(rawRedirectTo)) {
    console.warn("[oauth-google-init] redirectTo not in allow-list", { rawRedirectTo });
    return new Response(
      `redirectTo origin not allowed: ${rawRedirectTo}`,
      { status: 400, headers: corsHeaders },
    );
  }

  const state = await signState(
    {
      redirectTo: rawRedirectTo,
      nonce: crypto.randomUUID(),
      issuedAt: Date.now(),
    },
    STATE_SECRET,
  );

  const googleAuthUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  googleAuthUrl.searchParams.set("client_id", GOOGLE_CLIENT_ID);
  googleAuthUrl.searchParams.set(
    "redirect_uri",
    `${PROXY_URL}/functions/v1/oauth-google-callback`,
  );
  googleAuthUrl.searchParams.set("response_type", "code");
  googleAuthUrl.searchParams.set("scope", "openid email profile");
  googleAuthUrl.searchParams.set("prompt", "select_account");
  googleAuthUrl.searchParams.set("state", state);
  googleAuthUrl.searchParams.set("access_type", "online");
  googleAuthUrl.searchParams.set("include_granted_scopes", "true");

  return Response.redirect(googleAuthUrl.toString(), 302);
});
