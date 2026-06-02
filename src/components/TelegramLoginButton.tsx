import { useState, useRef, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import QRCode from "react-qr-code";
import { supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";
import { Send, Loader2, CheckCircle, RefreshCw, ExternalLink, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { isIOS } from "@/hooks/use-mobile";
import { claimPendingInvite } from "@/lib/inviteApi";

// HARDCODED — see src/lib/supabaseClient.ts for rationale (RU bypass, ignore Lovable auto-env).
const SUPABASE_URL = "https://api.sokratai.ru";

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

interface TelegramLoginButtonProps {
  botName?: string;
  className?: string;
}

const TelegramLoginButton = ({ 
  botName = "sokratai_ru_bot",
  className
}: TelegramLoginButtonProps) => {
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
        `${SUPABASE_URL}/functions/v1/telegram-login-token?token=${token}`,
        { method: "GET" }
      );
      
      const data = await response.json();
      // P1 telemetry cleanup (2026-05-16): raw `data` includes session tokens
      // and user_id. Replaced with boolean-only status event.
      console.log("[telegram-login] poll response:", {
        status: data.status,
        hasSession: !!data.session,
      });

      if (data.status === "verified" && data.session) {
        await supabase.auth.setSession({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        });
        
        setStatus("success");
        toast.success("Успешный вход через Telegram!");
        
        // Claim pending invite (non-blocking) then redirect
        setTimeout(async () => {
          try {
            try {
              await claimPendingInvite();
            } catch {
              // Claim error does not block Telegram login
            }

            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
              let isTutor = false;
              for (let attempt = 0; attempt < 3; attempt++) {
                const { data, error } = await supabase.rpc("is_tutor", { _user_id: user.id });
                if (!error && data) {
                  isTutor = true;
                  break;
                }
                await wait(300);
              }

              if (isTutor) {
                navigate("/tutor/home");
              } else {
                navigate("/student/schedule");
              }
            } else {
              navigate("/student/schedule");
            }
          } catch {
            navigate("/student/schedule");
          }
        }, 500);
        
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
        console.warn(
          JSON.stringify({
            event: "telegram_polling_timeout",
            flow: "student_telegram_login",
            attempts,
            timestamp: new Date().toISOString(),
          }),
        );
        stopPolling();
        setLoading(false);
        setStatus("idle");
        setCurrentToken(null);
        toast.error(
          "Telegram не подтвердил вход за 5 минут. Если t.me не открывается — попробуйте VPN или регистрацию по email.",
          { duration: 8000 },
        );
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
        { method: "POST" }
      );
      
      if (!response.ok) {
        throw new Error("Не удалось создать токен авторизации");
      }

      const { token } = await response.json();
      // P1 telemetry cleanup (2026-05-16): tokens are short-lived but still
      // grant /start verification — don't log them.
      console.log("[telegram-login] token created");
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

        {/* QR-fallback for Windows / Linux / desktop users without Telegram
            Desktop installed. Phone scan opens the link in NATIVE Telegram
            app → bot receives /start → this tab's polling picks up the
            verified token. Same pattern as TutorTelegramLoginButton. */}
        {currentToken && !isIOS() && (
          <div className="mt-2 flex flex-col items-center gap-2 rounded-md border border-border bg-card p-3 max-w-xs">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Smartphone className="w-3.5 h-3.5" />
              <span>Нет Telegram на компьютере?</span>
            </div>
            <div className="bg-white p-2 rounded">
              <QRCode
                value={`https://t.me/${botName}?start=login_${currentToken}`}
                size={140}
                level="M"
              />
            </div>
            <p className="text-xs text-muted-foreground text-center leading-snug">
              Отсканируйте телефоном — откроется в Telegram, нажмите «Старт»
            </p>
          </div>
        )}
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

export default TelegramLoginButton;
