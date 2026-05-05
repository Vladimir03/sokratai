import { useState, useRef, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";
import { Send, Loader2, CheckCircle, RefreshCw, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { isIOS } from "@/hooks/use-mobile";

// HARDCODED — see src/lib/supabaseClient.ts for rationale (RU bypass, ignore Lovable auto-env).
const SUPABASE_URL = "https://api.sokratai.ru";

/**
 * Multi-token tracking solves the stale-token UX bug:
 * each click of «Войти через Telegram» creates a new token, but Telegram
 * remembers only the most-recent /start the user sent — which may have been
 * for an EARLIER token from a previous click. Without tracking, the frontend
 * polls only the LATEST token (still pending) while the bot verified an
 * older one — page hangs forever despite ✅ in Telegram.
 *
 * We persist every token we create in localStorage (capped at 5 most recent,
 * 5-min TTL to match server-side expiry). The polling loop then checks ALL
 * tracked tokens on each tick — if ANY of them is verified, we install that
 * session. Across page refreshes too: on mount we resume polling stored
 * tokens before opening Telegram again.
 *
 * Safe by design: only tokens this browser created are stored locally; no
 * cross-user contamination possible.
 */
const TOKEN_STORAGE_KEY = "sokrat_tutor_tg_tokens";
const MAX_STORED_TOKENS = 5;
// Match server-side `expires_at` (5 minutes) so we drop dead tokens early.
const TOKEN_TTL_MS = 5 * 60 * 1000;

interface StoredToken {
  token: string;
  createdAt: number;
}

function readStoredTokens(): StoredToken[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return parsed
      .filter(
        (entry): entry is StoredToken =>
          typeof entry === "object" &&
          entry !== null &&
          typeof (entry as StoredToken).token === "string" &&
          typeof (entry as StoredToken).createdAt === "number" &&
          now - (entry as StoredToken).createdAt < TOKEN_TTL_MS,
      )
      .slice(-MAX_STORED_TOKENS);
  } catch {
    return [];
  }
}

function writeStoredTokens(tokens: StoredToken[]) {
  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(tokens));
  } catch {
    // localStorage may throw in private mode / quota — silent ok.
  }
}

function addStoredToken(token: string) {
  const next = readStoredTokens();
  next.push({ token, createdAt: Date.now() });
  writeStoredTokens(next.slice(-MAX_STORED_TOKENS));
}

function clearStoredTokens() {
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

interface TutorTelegramLoginButtonProps {
  botName?: string;
  className?: string;
}

const TutorTelegramLoginButton = ({
  botName = "sokratai_ru_bot",
  className
}: TutorTelegramLoginButtonProps) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<"idle" | "waiting" | "success">("idle");
  const [currentToken, setCurrentToken] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  // Stale-token signal: when polling has been pending for > STALE_AFTER_MS we
  // assume user pressed /start in Telegram for an OLDER token (typical: they
  // clicked "Войти через Telegram" twice; bot's ✅ confirmation came for
  // token T1, polling now waits on token T2). Promote «Открыть Telegram снова»
  // visually + show actionable copy.
  const [staleHint, setStaleHint] = useState(false);
  const pollingRef = useRef<number | null>(null);
  const staleTimerRef = useRef<number | null>(null);

  const STALE_AFTER_MS = 12_000;

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    if (staleTimerRef.current) {
      clearTimeout(staleTimerRef.current);
      staleTimerRef.current = null;
    }
    setStaleHint(false);
  }, []);

  type CheckOutcome = "verified" | "pending" | "expired" | "used" | "error";

  const checkToken = useCallback(async (token: string, manual = false): Promise<CheckOutcome> => {
    if (manual) setChecking(true);
    try {
      const response = await fetch(
        `${SUPABASE_URL}/functions/v1/telegram-login-token?token=${token}&_=${Date.now()}`,
        { method: "GET", cache: "no-store" }
      );
      
      const data = await response.json();
      console.log(
        "[telegram-login] poll response:",
        { status: data.status, hasSession: !!data.session, user_id: data.user_id, intended_role: data.intended_role, manual },
      );

      if (data.status === "verified" && data.session) {
        await supabase.auth.setSession({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        });

        const userId: string | undefined = data.user_id;
        console.log("[telegram-login] session installed, user_id:", userId);

        // Best-effort is_tutor probe. Bot's handleWebLogin already assigned
        // the role server-side. We do NOT signOut on failure — TutorGuard at
        // /tutor/home handles edge cases gracefully.
        if (userId) {
          try {
            const { data: isTutor } = await supabase.rpc("is_tutor", { _user_id: userId });
            if (!isTutor) {
              console.warn("[telegram-login] is_tutor=false; trying client-side fallback");
              const { error: assignError } = await supabase.functions.invoke(
                "assign-tutor-role",
                { body: { user_id: userId } },
              );
              if (assignError) {
                console.warn("[telegram-login] assign-tutor-role fallback error:", assignError.message);
              }
            }
          } catch (probeError) {
            console.warn("[telegram-login] role probe threw:", probeError);
          }
        }

        clearStoredTokens();
        setStatus("success");
        toast.success("Успешный вход через Telegram!");
        navigate("/tutor/home");
        return "verified";
      }

      if (data.status === "expired") {
        return "expired";
      }

      if (data.status === "used") {
        console.warn("[telegram-login] token already consumed elsewhere");
        return "used";
      }

      return "pending";
    } catch (error) {
      console.error("Error checking token:", error);
      if (manual) toast.error("Ошибка проверки. Попробуйте ещё раз.");
      return "error";
    } finally {
      if (manual) setChecking(false);
    }
  }, [navigate]);

  /**
   * Check ALL tokens we've created in this browser session. Returns true if
   * one was verified (caller should stop polling). Solves the stale-token
   * scenario: when bot verifies an OLDER token because user pressed /start
   * for it, polling on the LATEST token would never find verified — but
   * polling all tracked tokens does.
   */
  const checkAllStoredTokens = useCallback(
    async (manual = false): Promise<boolean> => {
      const stored = readStoredTokens();
      if (stored.length === 0) return false;

      let allFinal = true; // all tokens are expired/used — nothing left to wait on
      for (const entry of stored) {
        const result = await checkToken(entry.token, manual);
        if (result === "verified") return true;
        if (result === "pending" || result === "error") allFinal = false;
      }

      if (allFinal && stored.length > 0) {
        // Every tracked token is dead → reset state so user can start fresh.
        console.warn("[telegram-login] all tracked tokens expired/used — resetting to idle");
        clearStoredTokens();
        setLoading(false);
        setStatus("idle");
        setCurrentToken(null);
        if (manual) {
          toast.error("Этот вход уже завершён или истёк. Войдите заново.");
        }
        return true;
      }

      return false;
    },
    [checkToken],
  );

  // Resume polling when page becomes visible (for iOS Safari).
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && status === "waiting") {
        console.log("[telegram-login] page visible — checking all tracked tokens");
        void checkAllStoredTokens();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [status, checkAllStoredTokens]);

  const startPolling = useCallback(() => {
    let attempts = 0;
    const maxAttempts = 150;

    // After STALE_AFTER_MS without verification, surface a hint that /start
    // wasn't received for any tracked token. Less critical now that we poll
    // ALL stored tokens (the stale-token scenario is auto-resolved), but
    // still useful when bot truly didn't get /start at all.
    setStaleHint(false);
    if (staleTimerRef.current) clearTimeout(staleTimerRef.current);
    staleTimerRef.current = window.setTimeout(() => {
      console.warn("[telegram-login] still pending after 12s");
      setStaleHint(true);
    }, STALE_AFTER_MS);

    pollingRef.current = window.setInterval(async () => {
      attempts++;

      if (attempts >= maxAttempts) {
        stopPolling();
        clearStoredTokens();
        setLoading(false);
        setStatus("idle");
        setCurrentToken(null);
        toast.error("Время ожидания истекло. Попробуйте снова.");
        return;
      }

      const shouldStop = await checkAllStoredTokens();
      if (shouldStop) {
        stopPolling();
      }
    }, 2000);
  }, [checkAllStoredTokens, stopPolling]);

  const openTelegram = useCallback((token: string) => {
    const url = `https://t.me/${botName}?start=login_${token}`;
    if (isIOS()) {
      window.location.href = url;
    } else {
      window.open(url, "_blank");
    }
  }, [botName]);

  const handleTelegramLogin = async () => {
    setLoading(true);
    setStatus("waiting");

    try {
      const response = await fetch(
        `${SUPABASE_URL}/functions/v1/telegram-login-token?action=create`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ intended_role: "tutor" })
        }
      );

      if (!response.ok) {
        throw new Error("Не удалось создать токен авторизации");
      }

      const { token } = await response.json();
      // Track every token we create so the polling loop can find a verified
      // one even if user pressed /start in Telegram for an older attempt.
      addStoredToken(token);
      console.log("[telegram-login] created token:", token);
      setCurrentToken(token);

      openTelegram(token);
      startPolling();

    } catch (error: any) {
      console.error("Telegram login error:", error);
      toast.error(error.message || "Ошибка авторизации");
      setLoading(false);
      setStatus("idle");
    }
  };

  const handleCancel = () => {
    stopPolling();
    clearStoredTokens();
    setLoading(false);
    setStatus("idle");
    setCurrentToken(null);
  };

  // On mount, if we have stored tokens from a previous attempt (e.g. user
  // refreshed the page mid-flow), resume polling immediately. Verified token
  // → navigate without making the user click again.
  useEffect(() => {
    const stored = readStoredTokens();
    if (stored.length > 0 && status === "idle") {
      console.log("[telegram-login] resuming polling from", stored.length, "stored tokens");
      const latest = stored[stored.length - 1].token;
      setCurrentToken(latest);
      setLoading(true);
      setStatus("waiting");
      startPolling();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (status === "success") {
    return (
      <Button disabled className={className}>
        <CheckCircle className="w-5 h-5 mr-2 text-green-500" />
        Вход выполнен!
      </Button>
    );
  }

  if (status === "waiting") {
    return (
      <div className="flex flex-col items-center gap-3">
        <Button disabled className={className}>
          <Loader2 className="w-5 h-5 mr-2 animate-spin" />
          Ожидание подтверждения...
        </Button>

        {staleHint ? (
          <div
            className="rounded-md border-2 px-3 py-2.5 text-sm text-center max-w-xs"
            style={{
              backgroundColor: "#FEF3C7",
              borderColor: "#F59E0B",
              color: "#78350F",
            }}
          >
            <p className="font-semibold mb-1">Бот не получил команду /start для этого входа</p>
            <p className="text-xs">
              Если в Telegram уже было «✅ Авторизация подтверждена» — это для прошлой попытки.
              Кликните кнопку ниже и нажмите «Старт» ещё раз.
            </p>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground text-center space-y-1">
            <p>1. Нажмите «Старт» в Telegram-боте</p>
            <p>2. Вернитесь сюда</p>
          </div>
        )}

        <div className="flex flex-col gap-2 w-full max-w-xs">
          {staleHint ? (
            <Button
              size="sm"
              onClick={() => currentToken && openTelegram(currentToken)}
              className="w-full bg-socrat-telegram hover:bg-socrat-telegram-dark text-white"
            >
              <ExternalLink className="w-4 h-4 mr-2" />
              Открыть Telegram и нажать «Старт»
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => currentToken && openTelegram(currentToken)}
              className="w-full"
            >
              <ExternalLink className="w-4 h-4 mr-2" />
              Открыть Telegram снова
            </Button>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={() => void checkAllStoredTokens(true)}
            disabled={checking}
            className="w-full"
          >
            {checking ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4 mr-2" />
            )}
            Проверить статус
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleCancel}
            className="w-full text-muted-foreground"
          >
            Отменить
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Button 
      onClick={handleTelegramLogin}
      className={`bg-socrat-telegram hover:bg-socrat-telegram-dark text-white ${className}`}
      size="lg"
      disabled={loading}
    >
      <Send className="w-5 h-5 mr-2" />
      Войти через Telegram
    </Button>
  );
};

export default TutorTelegramLoginButton;
