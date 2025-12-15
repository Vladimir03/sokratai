import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AuthGuard from "@/components/AuthGuard";
import { PageContent } from "@/components/PageContent";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useSubscription } from "@/hooks/useSubscription";
import { Crown, Loader2, ShieldCheck } from "lucide-react";

const PLAN = {
  id: "premium" as const,
  title: "Premium",
  price: 699,
  currency: "₽",
  period: "мес",
};

const Pay = () => {
  const navigate = useNavigate();
  const [userId, setUserId] = useState<string | undefined>(undefined);
  const [creating, setCreating] = useState(false);
  const subscription = useSubscription(userId);

  const returnUrl = useMemo(() => `${window.location.origin}/pay/return`, []);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id);
    });
  }, []);

  const startPayment = async () => {
    setCreating(true);
    try {
      const { data, error } = await supabase.functions.invoke("yookassa-create-payment", {
        body: { plan: PLAN.id, return_url: returnUrl },
      });

      if (error) throw error;
      const confirmationUrl = (data as any)?.confirmation_url as string | undefined;
      if (!confirmationUrl) throw new Error("Не удалось получить ссылку на оплату");

      window.location.href = confirmationUrl;
    } catch (e: any) {
      console.error("Failed to start payment:", e);
      toast.error(e?.message || "Не удалось начать оплату");
      setCreating(false);
    }
  };

  return (
    <AuthGuard>
      <PageContent>
        <div className="container mx-auto px-4 pb-6 max-w-2xl">
          <div className="mb-6">
            <h1 className="text-3xl font-bold">Оплата</h1>
            <p className="text-muted-foreground">Оформление подписки {PLAN.title}</p>
          </div>

          <Card className="shadow-elegant border border-muted">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Crown className="w-5 h-5 text-amber-500" />
                {PLAN.title} — {PLAN.price}
                {PLAN.currency}/{PLAN.period}
              </CardTitle>
              <CardDescription>
                Оплата через ЮKassa. Вы сможете выбрать удобный способ (включая СБП, если подключено в магазине).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {subscription.isLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Проверяем статус подписки…
                </div>
              ) : subscription.isPremium ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-emerald-600">
                    <ShieldCheck className="w-5 h-5" />
                    Premium уже активен.
                  </div>
                  <Button onClick={() => navigate("/chat")} className="w-full">
                    Перейти в чат
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <ul className="text-sm text-muted-foreground space-y-1">
                    <li>• Безлимитные сообщения</li>
                    <li>• Приоритетная поддержка</li>
                    <li>• Ранний доступ к функциям</li>
                  </ul>

                  <Button onClick={startPayment} disabled={creating} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white">
                    {creating ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Переходим к оплате…
                      </>
                    ) : (
                      `Перейти к оплате — ${PLAN.price}${PLAN.currency}/${PLAN.period}`
                    )}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    После оплаты вы вернётесь на эту страницу, а доступ активируется автоматически.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </PageContent>
    </AuthGuard>
  );
};

export default Pay;




