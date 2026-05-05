import { useState } from "react";
import { lovable } from "@/integrations/lovable";
import { stashPendingConsent, type ConsentSource } from "@/lib/consent";
import { toast } from "sonner";

interface GoogleAuthButtonProps {
  /** Where to send the user after Google returns. Absolute origin is added automatically. */
  redirectPath: string;
  /** Consent source tag — required so we can record consent after OAuth round-trip. */
  consentSource: ConsentSource;
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
  enabled = true,
  className,
  label = "Продолжить с Google",
}: GoogleAuthButtonProps) {
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    if (!enabled || loading) return;
    setLoading(true);
    try {
      // Stash consent intent BEFORE redirect — applied on SIGNED_IN return.
      stashPendingConsent(consentSource);

      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: `${window.location.origin}${redirectPath}`,
        extraParams: { prompt: "select_account" },
      });

      if (result.error) {
        toast.error("Не удалось войти через Google. Попробуйте ещё раз.");
        console.error("[google-auth] error", result.error);
        setLoading(false);
        return;
      }
      // On `result.redirected` — browser navigates to Google, no further action.
      // On success without redirect — onAuthStateChange in caller handles next steps.
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