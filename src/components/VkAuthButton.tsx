import { useState } from "react";
import { stashPendingConsent, type ConsentSource } from "@/lib/consent";
import { getStoredPromo } from "@/lib/promoCapture";
import { toast } from "sonner";

/**
 * Custom VK ID OAuth flow (RU-bypass) — talks to our own edge functions
 * `oauth-vk-init` + `oauth-vk-callback` on `api.sokratai.ru`.
 *
 * Mirror of GoogleAuthButton. VK is a Russian information system, so VK ID is a
 * legal authorization method under law 406-ФЗ (rule 96). The backend handles
 * OAuth 2.1 + PKCE and an email-absent fallback (synthesized placeholder email);
 * the frontend contract is identical to the other providers.
 */

const OAUTH_INIT_URL = "https://api.sokratai.ru/functions/v1/oauth-vk-init";

interface VkAuthButtonProps {
  /** Where to send the user after VK returns. Absolute origin added automatically. */
  redirectPath: string;
  /** Consent source tag — required so we can record consent after the OAuth round-trip. */
  consentSource: ConsentSource;
  /** Intended role; only newly-created accounts on a `/tutor/*` redirect get tutor role. */
  intendedRole?: "tutor" | "student";
  /** When false, the button is disabled (e.g. consent checkbox not ticked). */
  enabled?: boolean;
  /** Optional className override for the wrapping <button>. */
  className?: string;
  /** Visible label. Defaults to "Продолжить с VK ID". */
  label?: string;
}

export default function VkAuthButton({
  redirectPath,
  consentSource,
  intendedRole = "student",
  enabled = true,
  className,
  label = "Продолжить с VK ID",
}: VkAuthButtonProps) {
  const [loading, setLoading] = useState(false);

  const handleClick = () => {
    if (!enabled || loading) return;
    setLoading(true);
    try {
      console.warn(
        JSON.stringify({
          event: "oauth_vk_init_clicked",
          flow: consentSource,
          timestamp: new Date().toISOString(),
        }),
      );

      stashPendingConsent(consentSource);

      const absoluteRedirectTo = `${window.location.origin}${redirectPath}`;
      const initUrl = new URL(OAUTH_INIT_URL);
      initUrl.searchParams.set("redirectTo", absoluteRedirectTo);
      initUrl.searchParams.set("intendedRole", intendedRole);

      // QR/referral промо (Егор) → signed state OAuth ТОЛЬКО в tutor-контексте
      // (P1 #5: не ученический вход). Callback пишет promo_code новым репетиторам.
      if (intendedRole === "tutor") {
        const { promo, ref, rc } = getStoredPromo();
        if (promo) initUrl.searchParams.set("promo", promo);
        if (ref) initUrl.searchParams.set("ref", ref);
        if (rc) initUrl.searchParams.set("rc", rc);
      }

      window.location.href = initUrl.toString();
    } catch (e) {
      console.error("[vk-auth] threw", e);
      toast.error("Не удалось войти через VK.");
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
        <rect width="18" height="18" rx="5" fill="#0077FF" />
        <text
          x="9"
          y="12.5"
          textAnchor="middle"
          fontSize="8"
          fontWeight="700"
          fill="#ffffff"
          fontFamily="Arial, Helvetica, sans-serif"
        >
          VK
        </text>
      </svg>
      <span>{loading ? "Перенаправление…" : label}</span>
    </button>
  );
}
