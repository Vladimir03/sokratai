/**
 * Экран «Подтвердите почту» вместо выброса из приложения (2026-07-08).
 *
 * Раньше после регистрации без сессии (Supabase требует подтверждения email)
 * репетитора «выкидывало» тостом — он покидал продукт и часто не возвращался
 * (тупик #2 CJM активации). Теперь показываем понятный next-step + кнопку
 * «Отправить письмо ещё раз», НЕ уводя из приложения.
 *
 * rule 96: чисто клиентский UX-слой — НЕ трогает email-verify edge / конфиг
 * Supabase / назначение роли. Сессию по-прежнему минтит подтверждение по ссылке.
 * «Не выкидываем уже вошедших»: слушаем SIGNED_IN — если сессия появилась
 * (подтвердил в другой вкладке), сразу впускаем в кабинет (onSignedIn), не
 * держим на экране ожидания.
 */
import { useEffect, useRef, useState } from "react";
import { Mail } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabaseClient";

interface EmailConfirmWaitingProps {
  email: string;
  /** Тот же redirect, что в оригинальном signUp (напр. `${origin}/tutor/home`). */
  emailRedirectTo: string;
  /** Вернуться к форме (сменить почту). */
  onBack: () => void;
  /** Сессия появилась (подтвердил в другой вкладке) → впустить в кабинет. */
  onSignedIn: () => void;
}

export function EmailConfirmWaiting({
  email,
  emailRedirectTo,
  onBack,
  onSignedIn,
}: EmailConfirmWaitingProps) {
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cross-tab: подтвердил в другой вкладке → появилась НОВАЯ сессия → впускаем.
  // КРИТИЧНО (review P1 2026-07-08): НЕ реагируем на INITIAL_SESSION — он на
  // маунте реплеит ТЕКУЩУЮ/устаревшую сессию (напр. пользователь уже залогинен
  // как ученик) и увёл бы на /tutor/home до подтверждения нового email. Ловим
  // только SIGNED_IN с ДРУГИМ user.id, чем baseline на маунте (= реально новый
  // подтверждённый аккаунт). rule 96: не выкидываем уже вошедшего.
  const baselineUserIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "INITIAL_SESSION") {
        baselineUserIdRef.current = session?.user?.id ?? null;
        return; // никогда не навигируем по INITIAL — это текущая сессия, не новая
      }
      if (
        event === "SIGNED_IN" &&
        session?.user &&
        session.user.id !== baselineUserIdRef.current
      ) {
        onSignedIn();
      }
    });
    return () => data.subscription.unsubscribe();
  }, [onSignedIn]);

  const handleResend = async () => {
    setResending(true);
    setError(null);
    try {
      const { error: resendErr } = await supabase.auth.resend({
        type: "signup",
        email,
        options: { emailRedirectTo },
      });
      if (resendErr) throw resendErr;
      setResent(true);
    } catch {
      setError("Не удалось отправить письмо. Подождите минуту и попробуйте снова.");
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-hero p-4">
      <Card className="w-full max-w-md shadow-elegant">
        <CardHeader className="space-y-1">
          <div className="flex justify-center mb-2">
            <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center">
              <Mail className="w-8 h-8 text-primary" aria-hidden="true" />
            </div>
          </div>
          <CardTitle className="text-2xl font-bold text-center">Подтвердите почту</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-center text-sm text-muted-foreground">
            Мы отправили ссылку на{" "}
            <span className="font-medium text-foreground">{email}</span>. Откройте
            письмо и нажмите ссылку — вы сразу попадёте в кабинет.
          </p>
          <p className="text-center text-xs text-muted-foreground">
            Письмо не пришло за пару минут? Проверьте папку «Спам» или отправьте ещё раз.
          </p>
          {error ? (
            <p className="text-center text-sm text-destructive">{error}</p>
          ) : null}
          <Button
            type="button"
            onClick={handleResend}
            disabled={resending || resent}
            className="w-full"
            style={{ touchAction: "manipulation" }}
          >
            {resent ? "Письмо отправлено" : resending ? "Отправляем…" : "Отправить письмо ещё раз"}
          </Button>
          <button
            type="button"
            onClick={onBack}
            className="w-full text-center text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
            style={{ touchAction: "manipulation" }}
          >
            Изменить почту
          </button>
        </CardContent>
      </Card>
    </div>
  );
}

export default EmailConfirmWaiting;
