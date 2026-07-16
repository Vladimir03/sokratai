import { useState } from "react";
import { stashPendingConsent, type ConsentSource } from "@/lib/consent";
import { getStoredPromo } from "@/lib/promoCapture";
import { toast } from "sonner";

/**
 * Custom Yandex ID OAuth flow (RU-bypass) — talks to our own edge functions
 * `oauth-yandex-init` + `oauth-yandex-callback` on `api.sokratai.ru`.
 *
 * Direct mirror of GoogleAuthButton. Yandex ID is a Russian information system,
 * so it is a legal authorization method under law 406-ФЗ (rule 96) — unlike
 * Google, which was removed. Both legs of the round-trip stay on the Selectel
 * Moscow proxy; the callback mints a Supabase session via the magic-link +
 * verifyOtp pattern and returns tokens in the URL hash
 * (`detectSessionInUrl: true`).
 */

const OAUTH_INIT_URL =
  "https://api.sokratai.ru/functions/v1/oauth-yandex-init";

interface YandexAuthButtonProps {
  /** Where to send the user after Yandex returns. Absolute origin added automatically. */
  redirectPath: string;
  /** Consent source tag — required so we can record consent after the OAuth round-trip. */
  consentSource: ConsentSource;
  /** Intended role; only newly-created accounts on a `/tutor/*` redirect get tutor role. */
  intendedRole?: "tutor" | "student";
  /** When false, the button is disabled (e.g. consent checkbox not ticked). */
  enabled?: boolean;
  /** Optional className override for the wrapping <button>. */
  className?: string;
  /** Visible label. Defaults to "Продолжить с Яндекс ID". */
  label?: string;
}

export default function YandexAuthButton({
  redirectPath,
  consentSource,
  intendedRole = "student",
  enabled = true,
  className,
  label = "Продолжить с Яндекс ID",
}: YandexAuthButtonProps) {
  const [loading, setLoading] = useState(false);

  const handleClick = () => {
    if (!enabled || loading) return;
    setLoading(true);
    try {
      console.warn(
        JSON.stringify({
          event: "oauth_yandex_init_clicked",
          flow: consentSource,
          timestamp: new Date().toISOString(),
        }),
      );

      stashPendingConsent(consentSource);

      const absoluteRedirectTo = `${window.location.origin}${redirectPath}`;
      const initUrl = new URL(OAUTH_INIT_URL);
      initUrl.searchParams.set("redirectTo", absoluteRedirectTo);
      initUrl.searchParams.set("intendedRole", intendedRole);

      // QR/referral промо (Егор) — пробрасываем в signed state OAuth ТОЛЬКО в
      // tutor-контексте (P1 #5: атрибуция принадлежит регистрации репетитора, не
      // ученическому входу). localStorage теряется за редиректом → несём в state.
      if (intendedRole === "tutor") {
        const { promo, ref, rc } = getStoredPromo();
        if (promo) initUrl.searchParams.set("promo", promo);
        if (ref) initUrl.searchParams.set("ref", ref);
        if (rc) initUrl.searchParams.set("rc", rc);
      }

      window.location.href = initUrl.toString();
    } catch (e) {
      console.error("[yandex-auth] threw", e);
      toast.error("Не удалось войти через Яндекс.");
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
        <circle cx="9" cy="9" r="9" fill="#FC3F1D" />
        <text
          x="9"
          y="13.5"
          textAnchor="middle"
          fontSize="12"
          fontWeight="700"
          fill="#ffffff"
          fontFamily="Arial, Helvetica, sans-serif"
        >
          Я
        </text>
      </svg>
      <span>{loading ? "Перенаправление…" : label}</span>
    </button>
  );
}
