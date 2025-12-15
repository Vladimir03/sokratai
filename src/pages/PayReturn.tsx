import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AuthGuard from "@/components/AuthGuard";
import { PageContent } from "@/components/PageContent";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useSubscription } from "@/hooks/useSubscription";
import { CheckCircle, Loader2 } from "lucide-react";

const PayReturn = () => {
  const navigate = useNavigate();
  const [userId, setUserId] = useState<string | undefined>(undefined);
  const subscription = useSubscription(userId);
  const [secondsLeft, setSecondsLeft] = useState(30);

  const startedAt = useMemo(() => Date.now(), []);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id);
    });
  }, []);

  useEffect(() => {
    if (!userId) return;

    const tick = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      const left = Math.max(30 - elapsed, 0);
      setSecondsLeft(left);
    }, 250);

    const poll = setInterval(() => {
      subscription.refresh();
    }, 3000);

    // immediate refresh
    subscription.refresh();

    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [userId, startedAt, subscription]);

  const isDone = subscription.isPremium;

  return (
    <AuthGuard>
      <PageContent>
        <div className="container mx-auto px-4 pb-6 max-w-2xl">
          <div className="mb-6">
            <h1 className="text-3xl font-bold">Возврат после оплаты</h1>
            <p className="text-muted-foreground">Проверяем статус платежа и активируем доступ…</p>
          </div>

          <Card className="shadow-elegant border border-muted">
            <CardHeader>
              <CardTitle>Статус</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {isDone ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-emerald-600">
                    <CheckCircle className="w-5 h-5" />
                    Premium активирован. Приятного обучения!
                  </div>
                  <Button onClick={() => navigate("/chat")} className="w-full">
                    Перейти в чат
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Ожидаем подтверждение от ЮKassa…
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Обычно это занимает несколько секунд. Ещё примерно: {secondsLeft}с
                  </div>
                  <Button variant="outline" onClick={() => subscription.refresh()} className="w-full">
                    Проверить ещё раз
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </PageContent>
    </AuthGuard>
  );
};

export default PayReturn;




