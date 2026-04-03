import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { MessageCircle, Crown, CreditCard, X, Gift } from "lucide-react";
import { useState } from "react";

interface SubscriptionBannerProps {
  messagesUsed: number;
  dailyLimit: number;
  isPremium: boolean;
  limitReached: boolean;
  showFull?: boolean;
  isTrialActive?: boolean;
  trialDaysLeft?: number;
  onOpenPayment?: () => void;
}

const pluralizeDays = (days: number) => {
  const mod10 = days % 10;
  const mod100 = days % 100;
  if (mod10 === 1 && mod100 !== 11) return 'день';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'дня';
  return 'дней';
};

export function SubscriptionBanner({ 
  messagesUsed, 
  dailyLimit, 
  isPremium, 
  limitReached,
  showFull = false,
  isTrialActive = false,
  trialDaysLeft = 0,
  onOpenPayment
}: SubscriptionBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  
  // Don't show for premium users
  if (isPremium) return null;

  const handleOpenPayment = () => {
    if (onOpenPayment) {
      onOpenPayment();
    }
  };

  // Trial badge for chat header
  if (isTrialActive && !showFull && !limitReached) {
    const isTrialEnding = trialDaysLeft <= 2;
    return (
      <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
        isTrialEnding 
          ? 'bg-amber-500/10 text-amber-600 border border-amber-500/20' 
          : 'bg-emerald-500/10 text-emerald-700 border border-emerald-500/20'
      }`}>
        <Gift className="w-3.5 h-3.5" />
        <span>
          {isTrialEnding ? '⏰' : '🎁'} Триал: {trialDaysLeft} {pluralizeDays(trialDaysLeft)}
        </span>
      </div>
    );
  }
  
  const progressPercent = Math.min((messagesUsed / dailyLimit) * 100, 100);
  const remaining = Math.max(dailyLimit - messagesUsed, 0);
  const isWarning = remaining <= 3 && remaining > 0;

  // Compact counter for chat header (only for non-trial users)
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
    
    const trialHighlight = isTrialActive && !limitReached;

    return (
        <div className="p-2 sm:p-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <Card className={`relative overflow-hidden border-0 p-3 sm:p-6 text-white ${
            trialHighlight
              ? 'bg-gradient-to-br from-emerald-600 via-teal-500 to-cyan-600'
              : 'bg-gradient-to-br from-slate-800 via-slate-700 to-emerald-800'
          }`}>
            {!limitReached && (
              <button
                onClick={() => setDismissed(true)}
                className="absolute top-2 right-2 sm:top-3 sm:right-3 p-1 hover:bg-white/20 rounded-full transition-colors"
                aria-label="Закрыть"
              >
                <X className="w-4 h-4" />
              </button>
            )}
            
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="p-1.5 sm:p-2 bg-white/20 rounded-full shrink-0">
                  <Crown className="w-5 h-5 sm:w-6 sm:h-6" />
                </div>
                <h3 className="text-sm sm:text-lg font-bold leading-tight">
                  {trialHighlight
                    ? `🎁 Триал: ${trialDaysLeft} ${pluralizeDays(trialDaysLeft)}`
                    : limitReached 
                      ? "🚀 Лимит исчерпан" 
                      : "🎓 Полный доступ"
                  }
                </h3>
              </div>
              
              {trialHighlight ? (
                <p className="text-xs sm:text-sm text-white/90 leading-snug">
                  Безлимитные сообщения. {trialDaysLeft === 0
                    ? 'Заканчивается сегодня!'
                    : 'Подключи подписку заранее.'}
                </p>
              ) : limitReached && (
                <p className="text-xs sm:text-sm text-white/90 leading-snug">
                  Использовано {dailyLimit} сообщений. Приходи завтра или оформи подписку!
                </p>
              )}
              
              <div className="space-y-2 sm:space-y-3">
                <div className="bg-white/10 rounded-lg p-2 sm:p-3">
                  <p className="font-semibold text-sm sm:text-base">✨ Премиум — 699₽/мес</p>
                  <ul className="text-xs sm:text-sm text-white/90 mt-1.5 space-y-0.5">
                    <li>• Безлимитные сообщения</li>
                    <li>• Приоритетная поддержка</li>
                    <li>• Ранний доступ к функциям</li>
                  </ul>
                </div>
                
                <Button 
                  onClick={handleOpenPayment}
                  className="w-full bg-white text-emerald-700 hover:bg-white/90 font-bold text-sm sm:text-base py-2 sm:py-2.5"
                  size="default"
                >
                  <CreditCard className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-1.5 sm:mr-2" />
                  Оформить Premium — 699₽/мес
                </Button>
              </div>
            </div>
            
            {/* Progress bar at bottom */}
            {!limitReached && !trialHighlight && (
              <div className="mt-3 sm:mt-4">
                <div className="flex justify-between text-[10px] sm:text-xs text-white/70 mb-1">
                  <span>Использовано</span>
                  <span>{messagesUsed}/{dailyLimit}</span>
                </div>
                <Progress value={progressPercent} className="h-1.5 sm:h-2 bg-white/20" />
              </div>
            )}
          </Card>
        </div>
    );
  }

  return null;
}

// Small inline warning component
export function MessageLimitWarning({ remaining }: { remaining: number }) {
  if (remaining > 3 || remaining <= 0) return null;
  
  return (
    <div
      className="flex items-center gap-2 px-3 py-2 bg-amber-500/10 border border-amber-500/30 rounded-lg text-sm text-amber-600 animate-in fade-in zoom-in-95 duration-200"
    >
      <span>⚠️</span>
      <span>Осталось {remaining} {remaining === 1 ? 'сообщение' : remaining <= 4 ? 'сообщения' : 'сообщений'}</span>
    </div>
  );
}

// Trial expiry reminder component
export function TrialExpiryReminder({ 
  trialDaysLeft, 
  onDismiss,
  onOpenPayment
}: { 
  trialDaysLeft: number; 
  onDismiss: () => void;
  onOpenPayment?: () => void;
}) {
  if (trialDaysLeft > 2 || trialDaysLeft < 0) return null;

  const isLastDay = trialDaysLeft <= 1;
  
  const handleOpenPayment = () => {
    if (onOpenPayment) {
      onOpenPayment();
    }
  };
  
  return (
      <div
        className={`mx-4 mb-3 p-4 rounded-xl border animate-in fade-in slide-in-from-top-4 duration-300 ${
          isLastDay 
            ? 'bg-gradient-to-r from-red-500/10 to-orange-500/10 border-red-500/30' 
            : 'bg-gradient-to-r from-amber-500/10 to-yellow-500/10 border-amber-500/30'
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="text-2xl">{isLastDay ? '⏰' : '⚠️'}</span>
            <div>
              <p className="font-semibold text-foreground">
                {isLastDay 
                  ? 'Триал заканчивается сегодня!' 
                  : `До окончания триала: ${trialDaysLeft} ${pluralizeDays(trialDaysLeft)}`
                }
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {isLastDay
                  ? 'Оформи подписку, чтобы продолжить пользоваться Сократ AI без ограничений'
                  : 'Не забудь оформить подписку, чтобы сохранить безлимитный доступ'
                }
              </p>
            </div>
          </div>
          <button 
            onClick={onDismiss} 
            className="p-1 hover:bg-foreground/5 rounded transition-colors"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>
        
        <Button 
          onClick={handleOpenPayment}
          className={`w-full mt-3 ${
            isLastDay 
              ? 'bg-gradient-to-r from-red-500 to-orange-500 hover:from-red-600 hover:to-orange-600' 
              : 'bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-600 hover:to-yellow-600'
          } text-white font-medium`}
          size="lg"
        >
          <Crown className="w-4 h-4 mr-2" />
          Оформить подписку — 699₽/мес
        </Button>
      </div>
  );
}
