import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Send, Loader2 } from "lucide-react";

interface TelegramAuthData {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

interface TelegramLoginButtonProps {
  botName?: string;
  className?: string;
  onSuccess?: () => void;
}

declare global {
  interface Window {
    onTelegramAuth: (user: TelegramAuthData) => void;
  }
}

const TelegramLoginButton = ({ 
  botName = "sokratai_ru_bot",
  className,
  onSuccess 
}: TelegramLoginButtonProps) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const widgetRef = useRef<HTMLDivElement>(null);
  const scriptLoadedRef = useRef(false);

  useEffect(() => {
    // Define global callback
    window.onTelegramAuth = async (user: TelegramAuthData) => {
      console.log("Telegram auth callback received:", user.id);
      setLoading(true);

      try {
        const response = await fetch(
          `https://vrsseotrfmsxpbciyqzc.supabase.co/functions/v1/telegram-auth`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(user),
          }
        );

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Ошибка авторизации");
        }

        if (data.session) {
          // Set the session in Supabase client
          await supabase.auth.setSession({
            access_token: data.session.access_token,
            refresh_token: data.session.refresh_token,
          });

          toast.success("Успешный вход через Telegram!");
          onSuccess?.();
          navigate("/chat");
        } else {
          throw new Error("Не удалось создать сессию");
        }
      } catch (error: any) {
        console.error("Telegram auth error:", error);
        toast.error(error.message || "Ошибка входа через Telegram");
      } finally {
        setLoading(false);
      }
    };

    // Load Telegram widget script
    if (!scriptLoadedRef.current && widgetRef.current) {
      const script = document.createElement("script");
      script.src = "https://telegram.org/js/telegram-widget.js?22";
      script.setAttribute("data-telegram-login", botName);
      script.setAttribute("data-size", "large");
      script.setAttribute("data-radius", "8");
      script.setAttribute("data-onauth", "onTelegramAuth(user)");
      script.setAttribute("data-request-access", "write");
      script.async = true;
      
      widgetRef.current.appendChild(script);
      scriptLoadedRef.current = true;
    }

    return () => {
      // Cleanup
      delete window.onTelegramAuth;
    };
  }, [botName, navigate, onSuccess]);

  if (loading) {
    return (
      <Button disabled className={className}>
        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
        Вход через Telegram...
      </Button>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3">
      {/* Telegram Widget Container */}
      <div ref={widgetRef} className="telegram-widget-container" />
      
      {/* Fallback button that shows while widget loads */}
      <noscript>
        <Button className={className}>
          <Send className="w-5 h-5 mr-2" />
          Войти через Telegram
        </Button>
      </noscript>
    </div>
  );
};

export default TelegramLoginButton;
