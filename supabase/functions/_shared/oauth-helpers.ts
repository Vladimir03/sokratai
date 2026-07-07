/**
 * Shared RU-bypass OAuth helpers.
 *
 * Extracted from the original Google flow (oauth-google-init/callback) so the
 * new Russian-provider flows (Yandex ID, VK ID) can reuse the exact same,
 * already-battle-tested mechanics without copy-paste drift. The Google
 * functions themselves are NOT refactored onto this module (they are being
 * decommissioned for legal compliance — rule 96 / law 406-ФЗ); this module is
 * additive and consumed only by oauth-yandex-* and oauth-vk-*.
 *
 * Architecture recap (why custom): hosted Supabase forces OAuth redirect_uri to
 * `<project>.supabase.co/auth/v1/callback`, blocked by RU ISPs. Our init/callback
 * keep all user-facing traffic on `api.sokratai.ru` (Selectel Moscow proxy);
 * the server-to-server token exchange runs from the edge host (no RU block).
 * Session is minted via the magic-link `generateLink` + `verifyOtp` trick, and
 * the browser is redirected to `redirectTo` with the Supabase tokens in the URL
 * hash (`detectSessionInUrl: true` on the client auto-parses them).
 *
 * Security model (preserved verbatim from the Google flow, rule 96 #6/#7/#8):
 *   - State is HMAC-SHA256 signed + TTL-checked. Signing does NOT prove the
 *     request came from a tutor entrypoint — anyone can pass `intendedRole=tutor`.
 *   - Tutor role is auto-assigned ONLY when (a) `intendedRole=tutor` AND
 *     (b) the redirect lands on a `/tutor/*` surface (path guard) AND
 *     (c) the account is NEWLY created (existing accounts keep their role —
 *     privilege-escalation guard).
 *   - Role-row insert failure is FATAL (caller redirects to error); tutors-row
 *     failure is recoverable (backfilled on first profile edit).
 *   - Logs are PII-free: boolean/status events only, never email/tokens.
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

// ─── constants ─────────────────────────────────────────────────────────────

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Cache-Control": "no-store",
};

/** Selectel Moscow proxy — all user-facing OAuth traffic stays here (RU-safe). */
export const PROXY_URL = "https://api.sokratai.ru";

/** Where the browser is sent when the flow fails irrecoverably. */
export const FALLBACK_LOGIN_URL = "https://sokratai.ru/login";

/** State TTL — covers a slow consent screen. */
export const STATE_TTL_MS = 10 * 60 * 1000;

/**
 * Allow-list for `redirectTo` (open-redirect protection). Mirrors Supabase Auth
 * → URL Configuration → Additional Redirect URLs and the Google flow's list.
 */
export const ALLOWED_REDIRECT_ORIGINS = [
  "https://sokratai.ru",
  "https://sokratai.lovable.app",
  "http://localhost:8080",
  "http://localhost:3000",
];

export function isAllowedRedirect(target: string): boolean {
  try {
    const u = new URL(target);
    return ALLOWED_REDIRECT_ORIGINS.includes(`${u.protocol}//${u.host}`);
  } catch {
    return false;
  }
}

// ─── base64url ─────────────────────────────────────────────────────────────

export function base64UrlEncode(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlDecode(input: string): Uint8Array {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (padded.length % 4)) % 4);
  const binary = atob(padded + padding);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ─── HMAC-signed state ─────────────────────────────────────────────────────

/**
 * Sign an arbitrary JSON payload. Returns `base64url(JSON).base64url(HMAC)`.
 * Callers add their own `issuedAt`/`nonce` to the payload (verifyState enforces
 * `issuedAt`). VK adds `codeVerifier` (PKCE) here — safe because the value is
 * integrity-protected and we have no server-side session store.
 */
export async function signState(
  payload: Record<string, unknown>,
  secret: string,
): Promise<string> {
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
  return `${dataB64}.${base64UrlEncode(sig)}`;
}

/**
 * Verify signature + TTL and return the parsed payload, or `null` on any
 * failure. Generic — each provider extracts its own fields (`redirectTo`,
 * `intendedRole`, `codeVerifier`, …).
 */
export async function verifyState(
  state: string,
  secret: string,
  ttlMs: number = STATE_TTL_MS,
): Promise<Record<string, unknown> | null> {
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

    const parsed = JSON.parse(new TextDecoder().decode(dataBytes));
    if (typeof parsed?.issuedAt !== "number") return null;
    if (Date.now() - parsed.issuedAt > ttlMs) return null;
    return parsed as Record<string, unknown>;
  } catch (e) {
    console.warn("[oauth-helpers] verifyState threw", e);
    return null;
  }
}

// ─── intended-role derivation (path-based guard) ───────────────────────────

/**
 * Tutor role only when BOTH the explicit request and the redirect path point at
 * a tutor surface. A typo / hostile embed pointing at `/chat` cannot promote to
 * tutor even with `intendedRole=tutor`.
 */
export function deriveIntendedRole(
  rawIntendedRole: string | null,
  rawRedirectTo: string,
): "tutor" | "student" {
  const requested =
    rawIntendedRole === "tutor" || rawIntendedRole === "student"
      ? rawIntendedRole
      : "student";
  let redirectPath = "";
  try {
    redirectPath = new URL(rawRedirectTo).pathname;
  } catch {
    redirectPath = "";
  }
  return requested === "tutor" && redirectPath.startsWith("/tutor/")
    ? "tutor"
    : "student";
}

// ─── PKCE (VK ID OAuth 2.1) ────────────────────────────────────────────────

/** RFC 7636 code_verifier — 48 random bytes → 64 base64url chars (43–128 range). */
export function randomCodeVerifier(): string {
  const bytes = new Uint8Array(48);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/** code_challenge = base64url(SHA-256(code_verifier)). */
export async function codeChallengeS256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return base64UrlEncode(digest);
}

// ─── Supabase user create / session mint / role assign ─────────────────────

export type UserMetadata = Record<string, unknown>;

/**
 * Idempotent find-or-create. Returns `{ isNewUser }` (true = freshly created)
 * or `{ error }` for a genuine create failure (not an "already exists").
 */
export async function findOrCreateUser(
  admin: SupabaseClient,
  email: string,
  metadata: UserMetadata,
): Promise<{ isNewUser: boolean } | { error: string }> {
  const { error: createError } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: metadata,
  });

  if (!createError) return { isNewUser: true };

  const msg = createError.message?.toLowerCase() ?? "";
  const isAlreadyExists =
    msg.includes("already") ||
    msg.includes("exists") ||
    (createError as unknown as { code?: string }).code === "email_exists";

  if (!isAlreadyExists) {
    console.error("[oauth-helpers] createUser failed", createError.message);
    return { error: "create_user_failed" };
  }
  return { isNewUser: false };
}

type SessionTokens = {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
};

/**
 * Mint a Supabase session for `email` via the magic-link → verifyOtp pattern.
 * `generateLink` runs on the passed `admin` client; `verifyOtp` runs on a fresh
 * anon client (so the admin singleton's in-memory session is never contaminated
 * — subsequent admin writes must stay service_role).
 */
export async function mintSession(
  admin: SupabaseClient,
  supabaseUrl: string,
  anonKey: string,
  email: string,
): Promise<{ session: SessionTokens; userId: string } | { error: string }> {
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkError || !linkData?.properties?.hashed_token) {
    console.error("[oauth-helpers] generateLink failed", linkError?.message);
    return { error: "link_failed" };
  }

  const anon = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: verifyData, error: verifyError } = await anon.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: "magiclink",
  });
  if (verifyError || !verifyData?.session || !verifyData?.user) {
    console.error("[oauth-helpers] verifyOtp failed", verifyError?.message);
    return { error: "verify_failed" };
  }

  return {
    session: {
      access_token: verifyData.session.access_token,
      refresh_token: verifyData.session.refresh_token,
      expires_in: verifyData.session.expires_in,
    },
    userId: verifyData.user.id,
  };
}

export type RoleFinalizationStatus = "ok" | "skipped" | "role_failed";

/**
 * Server-side tutor role finalization. No-op unless `isNewUser && intendedRole
 * === "tutor"` (privilege-escalation guard — existing accounts keep their role).
 * Role-row insert failure → "role_failed" (caller MUST redirect to error, else
 * TutorGuard bounces to /register-tutor in a loop). Tutors-row failure is
 * non-fatal (backfilled on first edit).
 */
export async function assignTutorRoleIfNeeded(
  admin: SupabaseClient,
  userId: string,
  intendedRole: "tutor" | "student",
  isNewUser: boolean,
  name: string | null,
  email: string,
): Promise<RoleFinalizationStatus> {
  if (!isNewUser || intendedRole !== "tutor") return "skipped";

  const { data: existingRole } = await admin
    .from("user_roles")
    .select("id")
    .eq("user_id", userId)
    .eq("role", "tutor")
    .maybeSingle();

  if (!existingRole) {
    const { error: roleErr } = await admin
      .from("user_roles")
      .insert({ user_id: userId, role: "tutor" });
    if (roleErr) {
      console.error(
        JSON.stringify({
          event: "oauth_role_insert_failed",
          error: roleErr.message,
          timestamp: new Date().toISOString(),
        }),
      );
      return "role_failed";
    }
  }

  const { data: existingTutor } = await admin
    .from("tutors")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (!existingTutor) {
    const tutorName = name || email.split("@")[0] || "Репетитор";
    const bookingLink = `tutor-${userId.substring(0, 8)}`;
    const { error: tutorErr } = await admin
      .from("tutors")
      .insert({ user_id: userId, name: tutorName, booking_link: bookingLink });
    if (tutorErr) {
      console.error(
        JSON.stringify({
          event: "oauth_tutor_profile_failed",
          error: tutorErr.message,
          timestamp: new Date().toISOString(),
        }),
      );
      // non-fatal — role exists, TutorGuard passes on role alone.
    }
  }

  return "ok";
}

// ─── terminal redirects ────────────────────────────────────────────────────

/** Redirect the browser to `redirectTo` with Supabase tokens in the URL hash. */
export function redirectWithSessionHash(
  redirectTo: string,
  session: SessionTokens,
): Response {
  const target = new URL(redirectTo);
  target.hash = new URLSearchParams({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: String(session.expires_in ?? 3600),
    token_type: "bearer",
    type: "signup",
  }).toString();
  return Response.redirect(target.toString(), 302);
}

/** Redirect to the login page with an `oauth_error` reason. PII-free log. */
export function redirectToError(reason: string, eventName: string): Response {
  console.warn(
    JSON.stringify({ event: eventName, reason, timestamp: new Date().toISOString() }),
  );
  const target = new URL(FALLBACK_LOGIN_URL);
  target.searchParams.set("oauth_error", reason);
  return Response.redirect(target.toString(), 302);
}
