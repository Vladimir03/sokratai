import { useState } from "react";
import { stashPendingConsent, type ConsentSource } from "@/lib/consent";
import { toast } from "sonner";

/**
 * Custom Google OAuth flow (RU-bypass) — talks to our own edge functions
 * `oauth-google-init` + `oauth-google-callback` on `api.sokratai.ru`,
 * NOT to `oauth.lovable.app` and NOT to Supabase's native
 * `auth.signInWithOAuth({ provider: "google" })`.
 *
 * History of this component:
 *   v1: createLovableAuth({ oauthBrokerUrl: "https://oauth.lovable.app/initiate" })
 *       → 403 Forbidden from Cloudflare edge for RU IPs without VPN.
 *   v2: supabase.auth.signInWithOAuth({ provider: "google" })
 *       → fixes oauth.lovable.app block, but Supabase forces redirect_uri
 *         to `<project>.supabase.co/auth/v1/callback` (RU-blocked) → after
 *         Google consent the browser couldn't reach Supabase's callback.
 *   v3 (this): GET https://api.sokratai.ru/functions/v1/oauth-google-init
 *       → 302 to Google with redirect_uri=api.sokratai.ru/.../callback
 *       → Google → user → Google → 302 to api.sokratai.ru/.../callback
 *       → edge function exchanges code, mints Supabase session via magic-link
 *         + verifyOtp pattern, redirects to redirectTo with tokens in URL
 *         hash. supabase-js auto-detects (`detectSessionInUrl: true`).
 *       Both legs are RU-friendly: user-facing traffic stays on Selectel
 *       Moscow proxy; server-to-server token exchange runs from edge
 *       function host, no RU blockage at all.
 *
 * Required ops setup:
 *   - Google Cloud Console → OAuth client (Web application) → Authorised
 *     redirect URIs: `https://api.sokratai.ru/functions/v1/oauth-google-callback`
 *   - Supabase Edge Function secrets:
 *       GOOGLE_OAUTH_CLIENT_ID
 *       GOOGLE_OAUTH_CLIENT_SECRET
 *       OAUTH_STATE_SECRET   (any 32+ char random string)
 */

const OAUTH_INIT_URL =
  "https://api.sokratai.ru/functions/v1/oauth-google-init";

interface GoogleAuthButtonProps {
  /** Where to send the user after Google returns. Absolute origin is added automatically. */
  redirectPath: string;
  /** Consent source tag — required so we can record consent after OAuth round-trip. */
  consentSource: ConsentSource;
  /**
   * Intended role for the signup. Passed through HMAC-signed OAuth state to
   * the callback, which assigns `tutor` role + creates `tutors` row for
   * newly-created accounts when set to "tutor". Default "student" never
   * auto-assigns elevated roles. Existing accounts keep their current role
   * regardless of this value (privilege escalation guard).
   */
  intendedRole?: "tutor" | "student";
  /** When false, the button is disabled (e.g. consent checkbox not ticked). */
  enabled?: boolean;
  /** Optional className override for the wrapping <button>. */
  className?: string;
  /** Visible label. Defaults to "Продолжить с Google". */
  label?: string;
}

export default function GoogleAuthButton({
  redirectPath,
  consentSource,
  intendedRole = "student",
  enabled = true,
  className,
  label = "Продолжить с Google",
}: GoogleAuthButtonProps) {
  const [loading, setLoading] = useState(false);

  const handleClick = () => {
    if (!enabled || loading) return;
    setLoading(true);
    try {
      console.warn(
        JSON.stringify({
          event: "oauth_google_init_clicked",
          flow: consentSource,
          timestamp: new Date().toISOString(),
        }),
      );

      // Stash consent intent BEFORE redirect — applied on SIGNED_IN return.
      stashPendingConsent(consentSource);

      // Build absolute redirectTo so the edge function's allow-list check
      // can validate the origin (sokratai.ru / sokratai.lovable.app /
      // localhost only — open-redirect protection).
      const absoluteRedirectTo = `${window.location.origin}${redirectPath}`;
      const initUrl = new URL(OAUTH_INIT_URL);
      initUrl.searchParams.set("redirectTo", absoluteRedirectTo);
      initUrl.searchParams.set("intendedRole", intendedRole);

      window.location.href = initUrl.toString();
      // Page will navigate; nothing else to do here.
    } catch (e) {
      console.error("[google-auth] threw", e);
      toast.error("Не удалось войти через Google.");
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={!enabled || loading}
      className={
        className ??
        "inline-flex w-full items-center justify-center gap-2 rounded-md border border-input bg-white px-4 py-3 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
      }
      style={{ minHeight: 48, touchAction: "manipulation" }}
      aria-label={label}
    >
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <path
          fill="#4285F4"
          d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
        />
        <path
          fill="#34A853"
          d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
        />
        <path
          fill="#FBBC05"
          d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z"
        />
        <path
          fill="#EA4335"
          d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.167 6.656 3.58 9 3.58z"
        />
      </svg>
      <span>{loading ? "Перенаправление…" : label}</span>
    </button>
  );
}
