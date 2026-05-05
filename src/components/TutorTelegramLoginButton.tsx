import { useState, useRef, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";
import { Send, Loader2, CheckCircle, RefreshCw, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { isIOS } from "@/hooks/use-mobile";

// HARDCODED — see src/lib/supabaseClient.ts for rationale (RU bypass, ignore Lovable auto-env).
const SUPABASE_URL = "https://api.sokratai.ru";

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
  const pollingRef = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const checkToken = useCallback(async (token: string, manual = false): Promise<boolean> => {
    if (manual) setChecking(true);
    try {
      const response = await fetch(
        `${SUPABASE_URL}/functions/v1/telegram-login-token?token=${token}&_=${Date.now()}`,
        { method: "GET", cache: "no-store" }
      );
      
      const data = await response.json();
      console.log("Token check response:", data);

      if (data.status === "verified" && data.session) {
        // Step 1: install session locally. setSession is sync-ish (writes to
        // localStorage + auto-refresh schedule); no network call here.
        await supabase.auth.setSession({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        });

        // Use server-provided user_id — avoid extra network round-trip via
        // supabase.auth.getUser() (which hits /auth/v1/user through the RU
        // proxy and adds latency / failure surface).
        const userId: string | undefined = data.user_id;
        console.log("[telegram-login] session installed, user_id:", userId);

        // Step 2: best-effort is_tutor probe. Bot's `handleWebLogin` ALREADY
        // assigned the tutor role server-side (when `intended_role: "tutor"`
        // was set on the token). This is a single safety check, NOT a retry
        // loop — if it returns false we fall back to client-side
        // assign-tutor-role once and continue regardless. We DO NOT signOut
        // on failure: TutorGuard at /tutor/home will catch a truly missing
        // role and redirect to /register-tutor, which is a graceful next
        // step (not a dead-end like signOut + toast).
        if (userId) {
          try {
            const { data: isTutor, error: rpcError } = await supabase.rpc(
              "is_tutor",
              { _user_id: userId },
            );
            if (rpcError) {
              console.warn("[telegram-login] is_tutor RPC error:", rpcError.message);
            }
            if (!isTutor) {
              console.warn(
                "[telegram-login] is_tutor=false after bot's role assignment; trying client-side fallback",
              );
              const { error: assignError } = await supabase.functions.invoke(
                "assign-tutor-role",
                { body: { user_id: userId } },
              );
              if (assignError) {
                // 400 expected for users created > 5 min ago. Bot should have
                // assigned the role already; if it didn't, TutorGuard handles.
                console.warn(
                  "[telegram-login] assign-tutor-role fallback returned error:",
                  assignError.message,
                );
              }
            }
          } catch (probeError) {
            // Network / unexpected error — log and continue. We've got a
            // valid session; let the user reach /tutor/home and let
            // TutorGuard sort out the role.
            console.warn("[telegram-login] role probe threw:", probeError);
          }
        }

        setStatus("success");
        toast.success("Успешный вход через Telegram!");
        navigate("/tutor/home");
        return true;
      }

      if (data.status === "expired") {
        toast.error("Время авторизации истекло. Попробуйте снова.");
        setLoading(false);
        setStatus("idle");
        setCurrentToken(null);
        return true;
      }

      if (manual) {
        toast.info("Ожидаем подтверждение в Telegram...");
      }

      return false;
    } catch (error) {
      console.error("Error checking token:", error);
      if (manual) toast.error("Ошибка проверки. Попробуйте ещё раз.");
      return false;
    } finally {
      if (manual) setChecking(false);
    }
  }, [navigate]);

  // Resume polling when page becomes visible (for iOS Safari)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && status === 'waiting' && currentToken) {
        console.log("Page visible, checking token...");
        checkToken(currentToken);
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [status, currentToken, checkToken]);

  const startPolling = useCallback((token: string) => {
    let attempts = 0;
    const maxAttempts = 150;

    pollingRef.current = window.setInterval(async () => {
      attempts++;
      
      if (attempts >= maxAttempts) {
        stopPolling();
        setLoading(false);
        setStatus("idle");
        setCurrentToken(null);
        toast.error("Время ожидания истекло. Попробуйте снова.");
        return;
      }

      const shouldStop = await checkToken(token);
      if (shouldStop) {
        stopPolling();
      }
    }, 2000);
  }, [checkToken, stopPolling]);

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
      console.log("Created login token for tutor:", token);
      setCurrentToken(token);

      openTelegram(token);
      startPolling(token);

    } catch (error: any) {
      console.error("Telegram login error:", error);
      toast.error(error.message || "Ошибка авторизации");
      setLoading(false);
      setStatus("idle");
    }
  };

  const handleCancel = () => {
    stopPolling();
    setLoading(false);
    setStatus("idle");
    setCurrentToken(null);
  };

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
        
        <div className="text-sm text-muted-foreground text-center space-y-1">
          <p>1. Нажмите «Старт» в Telegram боте</p>
          <p>2. Вернитесь сюда</p>
        </div>
        
        <div className="flex flex-col gap-2 w-full max-w-xs">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => currentToken && checkToken(currentToken, true)}
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
            onClick={() => currentToken && openTelegram(currentToken)}
            className="w-full text-muted-foreground"
          >
            <ExternalLink className="w-4 h-4 mr-2" />
            Открыть Telegram снова
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
