import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Send, Loader2 } from "lucide-react";

interface TelegramLoginButtonProps {
  botName?: string;
  className?: string;
}

const TelegramLoginButton = ({ 
  botName = "sokratai_ru_bot",
  className
}: TelegramLoginButtonProps) => {
  const [loading, setLoading] = useState(false);

  const handleTelegramLogin = () => {
    setLoading(true);
    // Open Telegram bot in new window
    window.open(`https://t.me/${botName}?start=web_login`, "_blank");
    
    // Reset loading after a short delay
    setTimeout(() => setLoading(false), 1000);
  };

  if (loading) {
    return (
      <Button disabled className={className}>
        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
        Открываем Telegram...
      </Button>
    );
  }

  return (
    <Button 
      onClick={handleTelegramLogin}
      className={`bg-[#0088cc] hover:bg-[#0077b5] text-white ${className}`}
      size="lg"
    >
      <Send className="w-5 h-5 mr-2" />
      Войти через Telegram
    </Button>
  );
};

export default TelegramLoginButton;
