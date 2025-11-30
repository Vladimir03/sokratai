import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { MessageCircle, Crown, ExternalLink, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useState } from "react";

interface SubscriptionBannerProps {
  messagesUsed: number;
  dailyLimit: number;
  isPremium: boolean;
  limitReached: boolean;
  showFull?: boolean;
}

const TELEGRAM_CONTACT = "Analyst_Vladimir";

export function SubscriptionBanner({ 
  messagesUsed, 
  dailyLimit, 
  isPremium, 
  limitReached,
  showFull = false 
}: SubscriptionBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  
  // Don't show for premium users
  if (isPremium) return null;
  
  const progressPercent = Math.min((messagesUsed / dailyLimit) * 100, 100);
  const remaining = Math.max(dailyLimit - messagesUsed, 0);
  const isWarning = remaining <= 3 && remaining > 0;

  const handleOpenTelegram = () => {
    window.open(`https://t.me/${TELEGRAM_CONTACT}`, '_blank');
  };

  // Compact counter for chat header
  if (!showFull && !limitReached) {
    return (
      <div className={`flex items-center gap-2 text-sm ${isWarning ? 'text-amber-500' : 'text-muted-foreground'}`}>
        <MessageCircle className="w-4 h-4" />
        <span>{messagesUsed}/{dailyLimit}</span>
        {isWarning && <span className="text-xs">⚠️</span>}
      </div>
    );
  }

  // Full banner when limit is reached or showFull is true
  if (limitReached || showFull) {
    if (dismissed && !limitReached) return null;
    
    return (
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          className="p-4"
        >
          <Card className="relative overflow-hidden border-0 bg-gradient-to-br from-purple-600 via-pink-500 to-orange-400 text-white p-6">
            {!limitReached && (
              <button 
                onClick={() => setDismissed(true)}
                className="absolute top-3 right-3 p-1 hover:bg-white/20 rounded-full transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            )}
            
            <div className="flex items-start gap-4">
              <div className="p-3 bg-white/20 rounded-full">
                <Crown className="w-8 h-8" />
              </div>
              
              <div className="flex-1">
                <h3 className="text-xl font-bold mb-2">
                  {limitReached 
                    ? "🚀 Лимит исчерпан!" 
                    : "🎓 Разблокируй полный доступ!"
                  }
                </h3>
                
                {limitReached && (
                  <p className="text-white/90 mb-3">
                    Ты использовал все {dailyLimit} сообщений на сегодня. 
                    Приходи завтра или оформи подписку!
                  </p>
                )}
                
                <div className="space-y-3">
                  <div className="bg-white/10 rounded-lg p-3">
                    <p className="font-semibold text-lg">✨ Премиум — 699₽/месяц</p>
                    <ul className="text-sm text-white/90 mt-2 space-y-1">
                      <li>• Неограниченное количество сообщений</li>
                      <li>• Приоритетная поддержка</li>
                      <li>• Доступ к новым функциям первым</li>
                    </ul>
                  </div>
                  
                  <Button 
                    onClick={handleOpenTelegram}
                    className="w-full bg-white text-purple-600 hover:bg-white/90 font-bold"
                    size="lg"
                  >
                    <ExternalLink className="w-4 h-4 mr-2" />
                    Написать @{TELEGRAM_CONTACT}
                  </Button>
                  
                  <p className="text-xs text-white/70 text-center">
                    💬 Напиши "СОКРАТ" в Telegram для быстрой активации
                  </p>
                </div>
              </div>
            </div>
            
            {/* Progress bar at bottom */}
            {!limitReached && (
              <div className="mt-4">
                <div className="flex justify-between text-xs text-white/70 mb-1">
                  <span>Использовано сегодня</span>
                  <span>{messagesUsed}/{dailyLimit}</span>
                </div>
                <Progress value={progressPercent} className="h-2 bg-white/20" />
              </div>
            )}
          </Card>
        </motion.div>
      </AnimatePresence>
    );
  }

  return null;
}

// Small inline warning component
export function MessageLimitWarning({ remaining }: { remaining: number }) {
  if (remaining > 3 || remaining <= 0) return null;
  
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex items-center gap-2 px-3 py-2 bg-amber-500/10 border border-amber-500/30 rounded-lg text-sm text-amber-600"
    >
      <span>⚠️</span>
      <span>Осталось {remaining} {remaining === 1 ? 'сообщение' : remaining <= 4 ? 'сообщения' : 'сообщений'}</span>
    </motion.div>
  );
}
