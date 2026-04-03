import { useState, useEffect, useRef } from "react";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import AuthGuard from "@/components/AuthGuard";
import { User, Zap, Target, Trophy, Edit, Send, CheckCircle, Loader2, Crown, Gift, CreditCard } from "lucide-react";
import { z } from "zod";
import { PageContent } from "@/components/PageContent";
import { useSubscription } from "@/hooks/useSubscription";
import { PaymentModal } from "@/components/PaymentModal";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ConfettiBurst } from "@/components/ConfettiBurst";

interface Profile {
  username: string;
  telegram_user_id: number | null;
  telegram_username: string | null;
  registration_source: string | null;
}

interface UserStats {
  total_xp: number;
  level: number;
  current_streak: number;
}

const BOT_NAME = "sokratai_ru_bot";
const pluralizeDays = (days: number) => {
  const mod10 = days % 10;
  const mod100 = days % 100;
  if (mod10 === 1 && mod100 !== 11) return 'день';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'дня';
  return 'дней';
};

const Profile = () => {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [stats, setStats] = useState<UserStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [linkingTelegram, setLinkingTelegram] = useState(false);
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const [editing, setEditing] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [userId, setUserId] = useState<string | undefined>(undefined);
  const subscription = useSubscription(userId);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [showPaymentSuccess, setShowPaymentSuccess] = useState(false);
  const [isPremiumConfirmed, setIsPremiumConfirmed] = useState(false);
  const [searchParams] = useSearchParams();

  // #region agent log helpers
  const dbg = (hypothesisId: string, location: string, message: string, data: Record<string, unknown>) => {
    // Use no-cors + text/plain to avoid CORS preflight from HTTPS preview environments.
    fetch('http://127.0.0.1:7242/ingest/5a352d39-cd0b-48d9-ba61-990189298ff9',{method:'POST',mode:'no-cors',headers:{'Content-Type':'text/plain'},body:JSON.stringify({sessionId:'debug-session',runId:'run2',hypothesisId,location,message,data,timestamp:Date.now()})}).catch(()=>{});
  };
  // #endregion

  // Check for payment success or openPayment from URL params
  useEffect(() => {
    if (searchParams.get('payment') === 'success') {
      setShowPaymentSuccess(true);
      toast.success("Оплата прошла успешно! Проверяем активацию Premium…");
      subscription.refresh();
      // Clean up URL
      window.history.replaceState({}, '', '/profile');
      // #region agent log
      dbg("H4","Profile.tsx:useEffect(payment)","payment_success_param",{origin:window.location.origin});
      // #endregion
    }
    // Auto-open payment modal when coming from Telegram
    if (searchParams.get('openPayment') === 'true') {
      setIsPaymentModalOpen(true);
      // Clean up URL
      window.history.replaceState({}, '', '/profile');
      // #region agent log
      dbg("H4","Profile.tsx:useEffect(openPayment)","open_payment_param",{});
      // #endregion
    }
  }, [searchParams]);

  // When success dialog is opened, poll subscription until premium is confirmed (webhook can take a few seconds)
  useEffect(() => {
    if (!showPaymentSuccess) return;

    let cancelled = false;
    setIsPremiumConfirmed(false);
    // #region agent log
    dbg("H5","Profile.tsx:pollPremium","poll_start",{});
    // #endregion

    const startedAt = Date.now();
    const interval = setInterval(async () => {
      if (cancelled) return;
      await subscription.refresh();
      const isPremiumNow = Boolean(subscription.isPremium);
      if (isPremiumNow) {
        setIsPremiumConfirmed(true);
        toast.success("Premium активирован!");
        clearInterval(interval);
        // #region agent log
        dbg("H5","Profile.tsx:pollPremium","premium_confirmed",{});
        // #endregion
        return;
      }
      // Stop polling after 45s
      if (Date.now() - startedAt > 45000) {
        clearInterval(interval);
        // #region agent log
        dbg("H5","Profile.tsx:pollPremium","poll_timeout",{});
        // #endregion
      }
    }, 2500);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPaymentSuccess]);

  useEffect(() => {
    fetchProfile();
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, []);

  const fetchProfile = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);

      // Fetch profile
      const { data: profileData, error: profileError } = await supabase
        .from("profiles")
        .select("username, telegram_user_id, telegram_username, registration_source")
        .eq("id", user.id)
        .single();

      if (profileError) throw profileError;

      // Fetch user stats
      const { data: statsData, error: statsError } = await supabase
        .from("user_stats")
        .select("total_xp, level, current_streak")
        .eq("user_id", user.id)
        .single();

      if (statsError && statsError.code !== 'PGRST116') {
        throw statsError;
      }

      setProfile(profileData);
      setStats(statsData || { total_xp: 0, level: 1, current_streak: 0 });
      setNewUsername(profileData.username);
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLinkTelegram = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      setLinkingTelegram(true);

      // Create link token with user_id
      const response = await supabase.functions.invoke("telegram-login-token", {
        body: { action: "link", user_id: user.id },
      });

      if (response.error) throw response.error;

      const { token } = response.data;
      setLinkToken(token);
      
      // Open Telegram bot with link token
      const botUrl = `https://t.me/${BOT_NAME}?start=link_${token}`;
      window.open(botUrl, "_blank");

      // Start polling
      let attempts = 0;
      const maxAttempts = 60; // 5 minutes

      pollingRef.current = setInterval(async () => {
        attempts++;
        
        if (attempts >= maxAttempts) {
          clearInterval(pollingRef.current!);
          pollingRef.current = null;
          setLinkingTelegram(false);
          toast.error("Время ожидания истекло. Попробуйте снова.");
          return;
        }

        try {
          const checkResponse = await supabase.functions.invoke("telegram-login-token", {
            method: "GET",
            body: null,
          });
          
          // Use fetch directly for GET request with query params
          const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID || "vrsseotrfmsxpbciyqzc";
          const checkUrl = `https://${projectId}.supabase.co/functions/v1/telegram-login-token?token=${token}`;
          
          const res = await fetch(checkUrl, {
            headers: {
              "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            },
          });

          const data = await res.json();

          if (data.status === "verified") {
            clearInterval(pollingRef.current!);
            pollingRef.current = null;
            setLinkingTelegram(false);
            
            // Refresh profile to get updated Telegram data
            await fetchProfile();
            toast.success("Telegram успешно связан!");
          } else if (data.status === "expired") {
            clearInterval(pollingRef.current!);
            pollingRef.current = null;
            setLinkingTelegram(false);
            toast.error("Время ожидания истекло. Попробуйте снова.");
          }
        } catch (pollError) {
          console.error("Polling error:", pollError);
        }
      }, 5000);

    } catch (error: any) {
      setLinkingTelegram(false);
      toast.error(error.message || "Ошибка при создании ссылки");
    }
  };

  const handleCancelLink = () => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    setLinkingTelegram(false);
    setLinkToken(null);
  };

  const handleCopyCommand = async () => {
    if (linkToken) {
      await navigator.clipboard.writeText(`/start link_${linkToken}`);
      toast.success("Команда скопирована!");
    }
  };

  const handleOpenTelegram = () => {
    if (linkToken) {
      window.open(`https://t.me/${BOT_NAME}?start=link_${linkToken}`, "_blank");
    }
  };

  const handleUpdateUsername = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Validate username
      const usernameSchema = z.string()
        .trim()
        .min(3, { message: "Минимум 3 символа" })
        .max(30, { message: "Максимум 30 символов" })
        .regex(/^[a-zA-Zа-яА-Я0-9_-]+$/, { 
          message: "Только буквы, цифры, _ и -" 
        });

      const validationResult = usernameSchema.safeParse(newUsername);
      
      if (!validationResult.success) {
        toast.error(validationResult.error.errors[0].message);
        return;
      }

      const validatedUsername = validationResult.data;

      // Check for duplicate usernames
      const { data: existing, error: checkError } = await supabase
        .from('profiles')
        .select('id')
        .eq('username', validatedUsername)
        .neq('id', user.id)
        .maybeSingle();

      if (checkError) throw checkError;

      if (existing) {
        toast.error('Это имя уже занято');
        return;
      }

      // Update username
      const { error } = await supabase
        .from("profiles")
        .update({ username: validatedUsername })
        .eq("id", user.id);

      if (error) throw error;

      toast.success("Имя обновлено!");
      setProfile(prev => prev ? { ...prev, username: validatedUsername } : null);
      setEditing(false);
    } catch (error: any) {
      toast.error(error.message);
    }
  };

  if (loading) {
    return (
      <AuthGuard>
        <div className="container mx-auto px-4 py-6">
          <div className="text-center py-12">
            <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          </div>
        </div>
      </AuthGuard>
    );
  }

  return (
    <AuthGuard>
      <PageContent>
        <div className="container mx-auto px-4 pb-6 max-w-4xl">
        <div className="mb-8">
          <h1 className="text-2xl font-bold mb-2">Профиль</h1>
          <p className="text-muted-foreground">Управление аккаунтом</p>
        </div>

        <div className="space-y-6">
          {/* Main Profile Card */}
          <Card className="bg-slate-800 text-primary-foreground shadow-elegant">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-20 h-20 rounded-full bg-accent flex items-center justify-center">
                    <User className="w-10 h-10 text-accent-foreground" />
                  </div>
                  <div>
                    {editing ? (
                      <div className="flex gap-2 items-center">
                        <Input
                          value={newUsername}
                          onChange={(e) => setNewUsername(e.target.value)}
                          className="bg-background text-foreground"
                        />
                        <Button onClick={handleUpdateUsername} variant="secondary" size="sm">
                          Сохранить
                        </Button>
                        <Button onClick={() => setEditing(false)} variant="outline" size="sm">
                          Отмена
                        </Button>
                      </div>
                    ) : (
                      <>
                        <CardTitle className="text-2xl">{profile?.username}</CardTitle>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={() => setEditing(true)}
                          className="text-primary-foreground hover:text-accent"
                        >
                          <Edit className="w-4 h-4 mr-2" />
                          Изменить имя
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-4xl font-bold">Ур. {stats?.level}</div>
                  <div className="text-sm opacity-90">{stats?.total_xp} XP</div>
                </div>
              </div>
            </CardHeader>
          </Card>

          {/* Subscription status */}
          <Card className="shadow-elegant border border-muted">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Crown className="w-5 h-5 text-amber-500" />
                Подписка
              </CardTitle>
              {subscription.isTrialActive && (
                <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-amber-100 text-amber-700 text-xs font-semibold">
                  <Gift className="w-4 h-4" />
                  Триал
                </div>
              )}
              {subscription.isPremium && (
                <div className="px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-semibold">
                  Premium
                </div>
              )}
            </CardHeader>
            <CardContent className="space-y-3">
              {subscription.isLoading ? (
                <div className="h-16 w-full rounded-lg bg-muted animate-pulse" />
              ) : (
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                  <div className="space-y-1">
                    <div className="text-sm text-muted-foreground">
                      {subscription.isPremium
                        ? "Безлимитные сообщения и доступ ко всем функциям."
                        : subscription.isTrialActive
                          ? `Бесплатный триал: осталось ${subscription.trialDaysLeft} ${pluralizeDays(subscription.trialDaysLeft)}.`
                          : `Бесплатный тариф: ${subscription.dailyLimit} сообщений в день.`}
                    </div>
                    {!subscription.isPremium && (
                      <div className="text-xs text-muted-foreground">
                        Premium — 699₽/мес. Подключите, чтобы сохранить безлимит после триала.
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {!subscription.isPremium && (
                      <Button 
                        size="sm" 
                        className="bg-emerald-600 hover:bg-emerald-700 text-white"
                        onClick={() => setIsPaymentModalOpen(true)}
                      >
                        <CreditCard className="w-4 h-4 mr-2" />
                        Оформить Premium
                      </Button>
                    )}
                    {/* Dev toggle: Premium for VladimirKam only */}
                    {profile?.username === 'VladimirKam' && (
                      <div className="flex items-center gap-2">
                        <Crown className="w-4 h-4 text-amber-500" />
                        <span className="text-sm text-muted-foreground">Premium (dev)</span>
                        <Switch
                          checked={subscription.isPremium}
                          onCheckedChange={async (checked) => {
                            if (!userId) return;
                            const { error } = await supabase
                              .from('profiles')
                              .update({
                                subscription_tier: checked ? 'premium' : 'free',
                                subscription_expires_at: checked
                                  ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
                                  : null,
                              })
                              .eq('id', userId);
                            if (error) {
                              toast.error('Ошибка переключения тарифа');
                            } else {
                              toast.success(checked ? 'Premium активирован' : 'Сброшено на Free');
                              subscription.refresh();
                            }
                          }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Telegram Connection Status */}
          <Card className="shadow-elegant">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Send className="w-5 h-5 text-[#0088cc]" />
                Telegram
              </CardTitle>
            </CardHeader>
            <CardContent>
              {profile?.telegram_user_id ? (
                <div className="flex items-center gap-3 p-4 bg-green-500/10 border border-green-500/30 rounded-lg">
                  <CheckCircle className="w-6 h-6 text-green-500" />
                  <div>
                    <div className="font-medium text-green-700 dark:text-green-400">
                      Аккаунт связан с Telegram
                    </div>
                    {profile.telegram_username && (
                      <div className="text-sm text-muted-foreground">
                        @{profile.telegram_username}
                      </div>
                    )}
                  </div>
                </div>
              ) : linkingTelegram ? (
                <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg space-y-3">
                  <div className="flex items-center gap-3">
                    <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
                    <div className="font-medium text-blue-700 dark:text-blue-400">
                      Ожидание подтверждения...
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Откройте Telegram и подтвердите связку в боте @{BOT_NAME}
                  </p>
                  
                  {/* iOS-friendly instructions */}
                  {linkToken && (
                    <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                      <p className="text-sm text-amber-700 dark:text-amber-400 mb-2">
                        📱 Если бот не отвечает, скопируйте команду и отправьте вручную:
                      </p>
                      <div className="flex gap-2 items-center">
                        <code className="flex-1 bg-muted p-2 rounded text-xs font-mono overflow-x-auto">
                          /start link_{linkToken}
                        </code>
                        <Button size="sm" variant="secondary" onClick={handleCopyCommand}>
                          Копировать
                        </Button>
                      </div>
                      <Button 
                        variant="link" 
                        size="sm" 
                        onClick={handleOpenTelegram}
                        className="mt-2 p-0 h-auto text-blue-600"
                      >
                        Открыть Telegram →
                      </Button>
                    </div>
                  )}
                  
                  <Button variant="outline" size="sm" onClick={handleCancelLink}>
                    Отменить
                  </Button>
                </div>
              ) : (
                <div className="p-4 bg-muted/50 rounded-lg">
                  <div className="text-muted-foreground mb-3">
                    Telegram не подключён
                  </div>
                  <p className="text-sm text-muted-foreground mb-4">
                    Свяжите аккаунт, чтобы отправлять задачи через Telegram
                  </p>
                  <Button onClick={handleLinkTelegram} className="bg-[#0088cc] hover:bg-[#006699]">
                    <Send className="w-4 h-4 mr-2" />
                    Связать Telegram
                  </Button>
                </div>
              )}
              {profile?.registration_source && (
                <div className="mt-3 text-xs text-muted-foreground">
                  Источник регистрации: {
                    profile.registration_source === 'telegram_web' ? 'Telegram (веб)' :
                    profile.registration_source === 'telegram' ? 'Telegram бот' :
                    profile.registration_source === 'web' ? 'Веб' :
                    profile.registration_source
                  }
                </div>
              )}
            </CardContent>
          </Card>

          {/* Stats Grid */}
          <div className="grid md:grid-cols-3 gap-6">
            <Card className="shadow-elegant">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Опыт (XP)
                </CardTitle>
                <Zap className="w-4 h-4 text-accent" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{stats?.total_xp || 0}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  До следующего уровня: {((stats?.level || 1) * 100) - (stats?.total_xp || 0)} XP
                </div>
                <div className="w-full bg-muted rounded-full h-2 mt-2">
                  <div
                    className="bg-accent h-2 rounded-full transition-all duration-500"
                    style={{ width: `${((stats?.total_xp || 0) % 100)}%` }}
                  />
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-elegant">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Текущая серия
                </CardTitle>
                <Target className="w-4 h-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold flex items-center gap-2">
                  🔥 {stats?.current_streak || 0} дней
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {stats?.current_streak ? "Продолжайте в том же духе!" : "Начните новую серию"}
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-elegant">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Уровень
                </CardTitle>
                <Trophy className="w-4 h-4 text-accent" />
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold flex items-center gap-2">
                  ⭐ {stats?.level || 1}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {stats?.level === 1 ? "Новичок" : stats?.level && stats.level < 5 ? "Ученик" : "Мастер"}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Badges */}
          <Card className="shadow-elegant">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trophy className="w-5 h-5 text-accent" />
                Значки
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="text-center p-4 bg-accent/10 rounded-lg border-2 border-accent">
                  <div className="text-4xl mb-2">🎯</div>
                  <div className="text-sm font-medium">Новичок</div>
                  <div className="text-xs text-muted-foreground">Зарегистрирован</div>
                </div>
                <div className="text-center p-4 bg-muted/50 rounded-lg opacity-50">
                  <div className="text-4xl mb-2">📚</div>
                  <div className="text-sm font-medium">Студент</div>
                  <div className="text-xs text-muted-foreground">5 уровень</div>
                </div>
                <div className="text-center p-4 bg-muted/50 rounded-lg opacity-50">
                  <div className="text-4xl mb-2">🎓</div>
                  <div className="text-sm font-medium">Выпускник</div>
                  <div className="text-xs text-muted-foreground">10 уровень</div>
                </div>
                <div className="text-center p-4 bg-muted/50 rounded-lg opacity-50">
                  <div className="text-4xl mb-2">👑</div>
                  <div className="text-sm font-medium">Мастер</div>
                  <div className="text-xs text-muted-foreground">20 уровень</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
      </PageContent>
      
      {/* Payment Modal */}
      <PaymentModal 
        isOpen={isPaymentModalOpen}
        onClose={() => setIsPaymentModalOpen(false)}
        onSuccess={() => {
          subscription.refresh();
          setShowPaymentSuccess(true);
          setIsPremiumConfirmed(true);
          toast.success("Premium активирован!");
        }}
      />

      {/* Success celebration */}
      <ConfettiBurst active={showPaymentSuccess && isPremiumConfirmed} />
      <Dialog open={showPaymentSuccess} onOpenChange={(open) => setShowPaymentSuccess(open)}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>
              {isPremiumConfirmed ? "🎉 Premium подключён!" : "Оплата принята"}
            </DialogTitle>
            <DialogDescription>
              {isPremiumConfirmed
                ? "Теперь у вас безлимитные сообщения и доступ ко всем функциям."
                : "Обычно активация занимает несколько секунд. Мы обновляем статус автоматически."}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-2">
            {isPremiumConfirmed ? (
              <div className="rounded-lg border bg-accent/5 p-4">
                <div className="font-semibold">Готово!</div>
                <div className="text-sm text-muted-foreground mt-1">
                  Спасибо за поддержку — приятной учёбы с Сократ AI.
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3 rounded-lg border p-4">
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
                <div className="text-sm text-muted-foreground">
                  Проверяем активацию Premium…
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-2 justify-end">
            <Button
              variant="outline"
              onClick={() => {
                subscription.refresh();
                if (subscription.isPremium) setIsPremiumConfirmed(true);
              }}
            >
              Обновить статус
            </Button>
            {isPremiumConfirmed && (
              <Button
                variant="secondary"
                onClick={() => {
                  setShowPaymentSuccess(false);
                  navigate("/chat");
                }}
              >
                Перейти в чат
              </Button>
            )}
            <Button onClick={() => setShowPaymentSuccess(false)}>
              {isPremiumConfirmed ? "Круто!" : "Ок"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </AuthGuard>
  );
};

export default Profile;
