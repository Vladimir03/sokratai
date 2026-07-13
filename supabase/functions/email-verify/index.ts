/**
 * Custom email confirmation handler — RU bypass for Supabase auth email links.
 *
 * Default Supabase email template renders `{{ .ConfirmationURL }}` which
 * points at `https://<project>.supabase.co/auth/v1/verify?token=...`. That
 * canonical Supabase host is SNI-blocked by RU ISPs (see CLAUDE.md «Network
 * & Infrastructure»). A user clicks the email link, the TLS handshake to
 * `*.supabase.co` is reset by the censor middlebox, and registration never
 * completes — silent funnel drop with no error.
 *
 * Fix: point email links at `https://api.sokratai.ru/functions/v1/email-verify`
 * (Selectel Moscow proxy, RU-friendly). This edge function runs the same
 * `verifyOtp` server-side that the default flow does, then:
 *   1. Assigns tutor role + creates tutor profile if the signup was intended
 *      for a tutor (read from `user.user_metadata.signup_source`). This is
 *      necessary because `assign-tutor-role` has a 5-minute account-age cap
 *      and email confirmation typically happens later. Without server-side
 *      role assignment here, the user lands on `/tutor/home` and is bounced
 *      back to `/register-tutor` by `TutorGuard` — infinite loop.
 *   2. Flushes any consent-intent that was stashed in `user_metadata` at
 *      signup time (because the email-flow signUp returned before the
 *      client could call `recordConsent` — there's no session yet).
 *   3. Redirects to redirectTo with Supabase tokens in URL hash. supabase-js
 *      `detectSessionInUrl` (default true) parses them on landing.
 *
 * Email template configuration (Supabase Dashboard manual ops):
 *   Authentication → Email Templates → "Confirm signup":
 *     Replace `{{ .ConfirmationURL }}` with:
 *     `https://api.sokratai.ru/functions/v1/email-verify?token_hash={{ .TokenHash }}&type=signup&redirect_to={{ .RedirectTo }}`
 *
 *   `{{ .RedirectTo }}` is the per-call redirect URL passed in
 *   `signUp({ options: { emailRedirectTo } })`. RegisterTutor passes
 *   `/tutor/home`, SignUp passes `/chat`, etc. — ONE template handles all
 *   user classes; the per-call value picks the right landing page.
 *
 * Allow-list for `redirect_to` mirrors `oauth-google-init`: only sokratai.ru,
 * sokratai.lovable.app, localhost. Prevents open-redirect abuse from
 * attacker-supplied email links.
 *
 * P2 scope: ALLOWED_TYPES is narrowed to `signup` only. Other Supabase OTP
 * types (`magiclink`, `recovery`, `email_change`, `invite`) require their
 * own template configuration and tested redirect flows — add deliberately
 * when used, not preemptively.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  persistPromoAttributionAndTrack,
  persistTutorTelegramFromMetadata,
} from "../_shared/promo-intent.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Cache-Control": "no-store",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const FALLBACK_LOGIN_URL = "https://sokratai.ru/login";
// Safe default: bare origin → AuthGuard / TutorGuard route the user according
// to their role. Tutor signup with this default landing on / is OK because
// the home page redirects authenticated tutors to /tutor/home. NEVER hardcode
// /tutor/home here — would route students into TutorGuard which kicks them out.
const FALLBACK_REDIRECT = "https://sokratai.ru";

const ALLOWED_REDIRECT_ORIGINS = [
  "https://sokratai.ru",
  "https://sokratai.lovable.app",
  "http://localhost:8080",
  "http://localhost:3000",
];

// `signup` — email-confirm регистрации. `magiclink` — беспарольный вход «по коду»
// (онбординг v2, T7): student-otp-request генерит magiclink hashed_token и шлёт
// ссылку на ЭТОТ endpoint через наш RU-safe email-пайплайн (не *.supabase.co).
const ALLOWED_TYPES = new Set(["signup", "magiclink"]);

function isAllowedRedirect(target: string): boolean {
  try {
    const u = new URL(target);
    return ALLOWED_REDIRECT_ORIGINS.includes(`${u.protocol}//${u.host}`);
  } catch {
    return false;
  }
}

function redirectToError(reason: string, redirectTo?: string): Response {
  const target = new URL(
    redirectTo && isAllowedRedirect(redirectTo) ? redirectTo : FALLBACK_LOGIN_URL,
  );
  target.searchParams.set("email_verify_error", reason);
  return Response.redirect(target.toString(), 302);
}

/**
 * Server-side tutor role assignment for email-confirm signups.
 *
 * Why server-side: client-side `assign-tutor-role` edge function has a 5-min
 * account-age check (rejects upgrades of existing accounts to prevent abuse).
 * Email confirmation usually happens 5+ min after signup — the user opens
 * inbox, finds the email, etc. — so the client function would reject.
 *
 * Why only for tutors: students don't need a role row at all (default RLS
 * gives them basic access). Tutor role + tutors-table profile are mandatory
 * to pass `TutorGuard`.
 *
 * Idempotent: skips if row already exists.
 */
// Exact allow-list for `signup_source` values that grant tutor role.
// Reviewer P1 (Round 2): `/tutor/i` regex was too permissive — any crafted
// metadata containing "tutor" (e.g. "not-tutor", "fake-tutor-thing") would
// promote the account. Exact match prevents typos and adversarial values
// from crossing the role boundary. New entrypoints must be added here
// explicitly + reviewed.
const TUTOR_SIGNUP_SOURCES = new Set([
  "tutor-register",         // RegisterTutor.tsx email flow
  "tutor-landing-trial",    // TutorSignupTrial.tsx trial flow
  "google-oauth-tutor",     // oauth-google-callback (legacy provider — removed for 406-ФЗ; kept for backward-compat)
  "yandex-oauth-tutor",     // oauth-yandex-callback (intendedRole=tutor)
  "vk-oauth-tutor",         // oauth-vk-callback (intendedRole=tutor)
  "telegram-oauth-tutor",   // telegram-bot handleWebLogin (intended_role=tutor)
]);

type RoleFinalizationStatus = "ok" | "skipped" | "role_failed";

async function assignTutorRoleIfNeeded(
  adminClient: ReturnType<typeof createClient>,
  userId: string,
  metadata: Record<string, unknown> | null | undefined,
): Promise<RoleFinalizationStatus> {
  const signupSource =
    typeof metadata?.signup_source === "string" ? metadata.signup_source : null;

  const isTutor = signupSource !== null && TUTOR_SIGNUP_SOURCES.has(signupSource);
  if (!isTutor) return "skipped";

  const { data: existingRole } = await adminClient
    .from("user_roles")
    .select("id")
    .eq("user_id", userId)
    .eq("role", "tutor")
    .maybeSingle();

  if (!existingRole) {
    const { error: roleErr } = await adminClient.from("user_roles").insert({
      user_id: userId,
      role: "tutor",
    });
    if (roleErr) {
      console.error(
        JSON.stringify({
          event: "email_verify_role_insert_failed",
          error: roleErr.message,
          timestamp: new Date().toISOString(),
        }),
      );
      // Reviewer P2 (Round 2): without explicit failure signal the user
      // lands on /tutor/home, TutorGuard sees no role, bounces back to
      // /register-tutor — silent broken loop. Skip tutor profile creation
      // (would orphan a tutors row without user_roles row) and bubble the
      // failure to the caller so it redirects to a deterministic error.
      return "role_failed";
    }
  }

  // Create tutor profile row (mirror assign-tutor-role logic)
  const { data: existingTutor } = await adminClient
    .from("tutors")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (!existingTutor) {
    const tutorName =
      (typeof metadata?.username === "string" && metadata.username) ||
      (typeof metadata?.full_name === "string" && metadata.full_name) ||
      "Репетитор";
    const bookingLink = `tutor-${userId.substring(0, 8)}`;
    const { error: tutorErr } = await adminClient.from("tutors").insert({
      user_id: userId,
      name: tutorName,
      booking_link: bookingLink,
    });
    if (tutorErr) {
      console.error(
        JSON.stringify({
          event: "email_verify_tutor_profile_failed",
          error: tutorErr.message,
          timestamp: new Date().toISOString(),
        }),
      );
      // Tutor row failure is recoverable (role exists; backfill via SQL).
      // Don't fail the verify — TutorGuard passes on role alone, profile
      // metadata is filled on first edit.
    }
  }

  // Apply trial marker if RegisterTutor / TutorSignupTrial stashed the intent.
  // TutorSignupTrial does this client-side after SIGNED_IN, but email-confirm
  // path returns before that fires — without this server-side fallback, trial
  // tutors lose their trial_started_at marker.
  if (metadata?.trial_intent === true) {
    await adminClient
      .from("profiles")
      .update({ trial_started_at: new Date().toISOString() })
      .eq("id", userId)
      .is("trial_started_at", null); // don't overwrite existing
  }

  return "ok";
}

/**
 * Flush consent intent from user_metadata into profiles.
 *
 * Why: client-side `recordConsent` requires an active session and an existing
 * `profiles` row. Email-flow signUp returns before either is true (signup
 * needs email confirm; profile row may not exist until the auth trigger
 * fires). So we stash the intent in `user_metadata.consent_intent` at signup
 * time and flush it here, idempotently.
 */
async function flushConsentIntent(
  adminClient: ReturnType<typeof createClient>,
  userId: string,
  metadata: Record<string, unknown> | null | undefined,
): Promise<void> {
  const consentIntent =
    typeof metadata?.consent_intent === "string" ? metadata.consent_intent : null;
  if (!consentIntent) return;

  const { data: existing } = await adminClient
    .from("profiles")
    .select("consent_accepted_at")
    .eq("id", userId)
    .maybeSingle();
  if (existing?.consent_accepted_at) return;

  await adminClient
    .from("profiles")
    .update({
      consent_accepted_at: new Date().toISOString(),
      consent_version: "v1-2026-05",
      consent_source: consentIntent,
    })
    .eq("id", userId);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // P2: explicit env check instead of !-assertion. If misconfigured, return
  // a clean error response rather than a TypeError 500.
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error(
      JSON.stringify({
        event: "email_verify_failed",
        reason: "missing_env",
        hasUrl: !!SUPABASE_URL,
        hasAnon: !!SUPABASE_ANON_KEY,
        hasService: !!SUPABASE_SERVICE_ROLE_KEY,
        timestamp: new Date().toISOString(),
      }),
    );
    return redirectToError("not_configured");
  }

  const url = new URL(req.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const redirectTo = url.searchParams.get("redirect_to") || FALLBACK_REDIRECT;

  if (!tokenHash || !type) {
    console.warn(
      JSON.stringify({
        event: "email_verify_failed",
        reason: "missing_params",
        hasTokenHash: !!tokenHash,
        hasType: !!type,
        timestamp: new Date().toISOString(),
      }),
    );
    return redirectToError("missing_params");
  }

  if (!ALLOWED_TYPES.has(type)) {
    console.warn(
      JSON.stringify({
        event: "email_verify_failed",
        reason: "invalid_type",
        type,
        timestamp: new Date().toISOString(),
      }),
    );
    return redirectToError("invalid_type");
  }

  // Token-hash sanity check — Supabase emits hex-ish strings, anything outside
  // [a-zA-Z0-9_-] is bogus. Cheap pre-DB guard.
  if (!/^[A-Za-z0-9_-]{16,256}$/.test(tokenHash)) {
    console.warn(
      JSON.stringify({
        event: "email_verify_failed",
        reason: "malformed_token_hash",
        tokenLen: tokenHash.length,
        timestamp: new Date().toISOString(),
      }),
    );
    return redirectToError("malformed_token");
  }

  if (!isAllowedRedirect(redirectTo)) {
    console.warn(
      JSON.stringify({
        event: "email_verify_failed",
        reason: "redirect_not_allowed",
        timestamp: new Date().toISOString(),
      }),
    );
    return redirectToError("redirect_not_allowed");
  }

  const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await anonClient.auth.verifyOtp({
    token_hash: tokenHash,
    type: type as "signup" | "magiclink",
  });

  if (error || !data?.session || !data?.user) {
    console.error(
      JSON.stringify({
        event: "email_verify_failed",
        reason: error?.message ?? "no_session",
        type,
        timestamp: new Date().toISOString(),
      }),
    );
    const errorCode = error?.message?.toLowerCase().includes("expired")
      ? "token_expired"
      : error?.message?.toLowerCase().includes("invalid")
        ? "token_invalid"
        : "verify_failed";
    return redirectToError(errorCode, redirectTo);
  }

  // Post-verify finalization: role assignment + consent flush.
  // Role failure is FATAL for tutor flow (would land in broken TutorGuard
  // loop). Consent flush is best-effort (loss of audit trail, not access).
  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const metadata =
    data.user.user_metadata && typeof data.user.user_metadata === "object"
      ? (data.user.user_metadata as Record<string, unknown>)
      : null;

  const roleStatus = await assignTutorRoleIfNeeded(adminClient, data.user.id, metadata);
  if (roleStatus === "role_failed") {
    // Reviewer P2 (Round 2): surface a deterministic error state rather than
    // silently land the user on /tutor/home → TutorGuard bounce → /register-tutor.
    // User keeps their auth.users row + email_confirmed_at=now; support can
    // backfill `user_roles` via SQL. The error param tells the page to show
    // a recovery CTA instead of just the empty signup form.
    return redirectToError("role_finalization_failed", FALLBACK_LOGIN_URL);
  }

  await flushConsentIntent(adminClient, data.user.id, metadata);

  // Persist QR/referral attribution + funnel (promo/ref) + опц. telegram — ТОЛЬКО
  // для регистрации (type=signup), НЕ для magiclink-логина (P1 #5). Promo/telegram
  // метаданные несут лишь tutor-формы; студенческий SignUp их не шлёт. Best-effort,
  // idempotent, PII-free. Tutor-role allow-list выше не тронут (rule 96).
  if (type === "signup") {
    await persistPromoAttributionAndTrack(adminClient, data.user.id, metadata);
    await persistTutorTelegramFromMetadata(adminClient, data.user.id, metadata);
  }

  console.warn(
    JSON.stringify({
      event: "email_verify_succeeded",
      type,
      timestamp: new Date().toISOString(),
    }),
  );

  // Redirect with tokens in URL hash. supabase-js `detectSessionInUrl` parses
  // them on landing, fires INITIAL_SESSION → AuthGuard/TutorGuard pulls the
  // new session. Same exit pattern as oauth-google-callback.
  const target = new URL(redirectTo);
  target.hash = new URLSearchParams({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_in: String(data.session.expires_in ?? 3600),
    token_type: "bearer",
    type,
  }).toString();

  return Response.redirect(target.toString(), 302);
});
