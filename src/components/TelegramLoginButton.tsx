import { useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Send, Loader2, CheckCircle } from "lucide-react";
import { toast } from "sonner";

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
  const pollingRef = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const checkToken = useCallback(async (token: string): Promise<boolean> => {
    try {
      const response = await fetch(
        `https://vrsseotrfmsxpbciyqzc.supabase.co/functions/v1/telegram-login-token?token=${token}`,
        { method: "GET" }
      );
      
      const data = await response.json();
      console.log("Token check response:", data);

      if (data.status === "verified" && data.session) {
        // Set session in Supabase
        await supabase.auth.setSession({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        });
        
        setStatus("success");
        toast.success("Успешный вход через Telegram!");
        
        // Navigate after short delay
        setTimeout(() => {
          navigate("/chat");
        }, 500);
        
        return true;
      }

      if (data.status === "expired") {
        toast.error("Время авторизации истекло. Попробуйте снова.");
        setLoading(false);
        setStatus("idle");
        return true; // Stop polling
      }

      return false; // Continue polling
    } catch (error) {
      console.error("Error checking token:", error);
      return false;
    }
  }, [navigate]);

  const startPolling = useCallback((token: string) => {
    let attempts = 0;
    const maxAttempts = 150; // 5 minutes at 2 second intervals

    pollingRef.current = window.setInterval(async () => {
      attempts++;
      
      if (attempts >= maxAttempts) {
        stopPolling();
        setLoading(false);
        setStatus("idle");
        toast.error("Время ожидания истекло. Попробуйте снова.");
        return;
      }

      const shouldStop = await checkToken(token);
      if (shouldStop) {
        stopPolling();
      }
    }, 2000);
  }, [checkToken, stopPolling]);

  const handleTelegramLogin = async () => {
    setLoading(true);
    setStatus("waiting");

    try {
      // Create login token
      const response = await fetch(
        "https://vrsseotrfmsxpbciyqzc.supabase.co/functions/v1/telegram-login-token?action=create",
        { method: "POST" }
      );
      
      if (!response.ok) {
        throw new Error("Не удалось создать токен авторизации");
      }

      const { token } = await response.json();
      console.log("Created login token:", token);

      // Open Telegram bot with login token
      window.open(`https://t.me/${botName}?start=login_${token}`, "_blank");

      // Start polling for verification
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
        <p className="text-sm text-muted-foreground text-center">
          Подтвердите вход в Telegram и вернитесь сюда
        </p>
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={handleCancel}
          className="text-muted-foreground"
        >
          Отменить
        </Button>
      </div>
    );
  }

  return (
    <Button 
      onClick={handleTelegramLogin}
      className={`bg-[#0088cc] hover:bg-[#0077b5] text-white ${className}`}
      size="lg"
      disabled={loading}
    >
      <Send className="w-5 h-5 mr-2" />
      Войти через Telegram
    </Button>
  );
};

export default TelegramLoginButton;
