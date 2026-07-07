import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase, getAuthErrorMessage } from "@/lib/supabaseClient";
import { callAuthWithRetry, isAuthNetworkFailure } from "@/lib/authRetry";
import { readAuthRedirectError } from "@/lib/authErrors";
import { toast } from "sonner";
import { z } from "zod";
import YandexAuthButton from "@/components/YandexAuthButton";
import VkAuthButton from "@/components/VkAuthButton";
import { applyPendingConsent } from "@/lib/consent";

const loginSchema = z.object({
  email: z.string().trim().email({ message: "Неверный формат email" }).max(255),
  password: z.string().min(6, { message: "Минимум 6 символов" }),
});

const TutorLogin = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  // Под РФ-DPI первый запрос логина может «упасть» → авто-ретрай (authRetry).
  // Флаг показывает на кнопке «сеть медленная, ещё раз», чтобы кнопка не казалась
  // зависшей.
  const [retrying, setRetrying] = useState(false);
  const redirectErrorShown = useRef(false);

  // Surface auth errors returned from edge function redirects (see Login.tsx
  // for full rationale). Round 4 reviewer P2 fix.
  useEffect(() => {
    if (redirectErrorShown.current) return;
    const err = readAuthRedirectError(searchParams);
    if (!err) return;
    redirectErrorShown.current = true;
    console.warn(
      JSON.stringify({
        event: "auth_redirect_error_displayed",
        flow: "tutor_login",
        code: err.code,
        timestamp: new Date().toISOString(),
      }),
    );
    toast.error(err.message, { duration: 10000 });
    const next = new URLSearchParams(searchParams);
    next.delete("email_verify_error");
    next.delete("oauth_error");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const { data: isTutor } = await supabase.rpc("is_tutor", { _user_id: session.user.id });
      if (isTutor) {
        const nextParam = searchParams.get("next");
        if (nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//")) {
          window.location.replace(nextParam);
          return;
        }
        navigate("/tutor/home");
      } else {
        await supabase.auth.signOut();
      }
    };

    checkSession();
  }, [navigate, searchParams]);

  // Apply consent stashed before Google OAuth redirect (first-login case).
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session?.user.id) {
        void applyPendingConsent(session.user.id);
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setRetrying(false);

    try {
      const validation = loginSchema.safeParse({ email, password });
      if (!validation.success) {
        toast.error(validation.error.errors[0].message);
        setLoading(false);
        return;
      }

      // Таймаут+ретрай ТОЛЬКО на сетевой сбой/таймаут (РФ-DPI роняет запрос).
      // Неверный пароль резолвится в `{ error }` — возвращается сразу, без ретрая.
      const { data, error } = await callAuthWithRetry(
        () => supabase.auth.signInWithPassword({
          email: validation.data.email,
          password: validation.data.password,
        }),
        { onRetry: () => setRetrying(true) },
      );

      if (error) throw error;

      if (!data.user) {
        throw new Error("Не удалось получить пользователя");
      }

      const userId = data.user.id;
      const { data: isTutor, error: roleError } = await callAuthWithRetry(
        () => Promise.resolve(supabase.rpc("is_tutor", { _user_id: userId })) as Promise<any>,
        { onRetry: () => setRetrying(true) },
      );
      if (roleError) throw roleError;

      if (!isTutor) {
        console.warn("auth_event:not_tutor_account", { user_id: userId });
        await supabase.auth.signOut();
        toast.error("Этот аккаунт не репетиторский. Используйте отдельный tutor-аккаунт.");
        return;
      }

      toast.success("Успешный вход!");
      const nextParam = searchParams.get("next");
      if (nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//")) {
        window.location.replace(nextParam);
        return;
      }
      navigate("/tutor/home");
    } catch (error: any) {
      // Сетевой сбой/таймаут под DPI — честное сообщение вместо вечного спиннера
      // (и подсказка про VPN), а не generic «Ошибка входа».
      if (isAuthNetworkFailure(error)) {
        toast.error(
          "Сеть не отвечает — запрос не дошёл. Попробуйте ещё раз; в РФ часто помогает вход с VPN.",
          { duration: 8000 },
        );
      } else {
        toast.error(getAuthErrorMessage(error, "Ошибка входа"));
      }
    } finally {
      setLoading(false);
      setRetrying(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-hero p-4">
      <Card className="w-full max-w-md shadow-elegant">
        <CardHeader className="space-y-1">
          <CardTitle className="text-3xl font-bold text-center">Вход для репетитора</CardTitle>
          <CardDescription className="text-center">
            Войдите в репетиторский кабинет
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Email-first redesign (2026-05-16, RU bypass): email-form primary,
              OAuth fallback below. See RegisterTutor.tsx for rationale. */}
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Input
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loading}
                style={{ fontSize: 16, touchAction: "manipulation" }}
              />
            </div>
            <div className="space-y-2">
              <Input
                type="password"
                autoComplete="current-password"
                placeholder="Пароль"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loading}
                style={{ fontSize: 16, touchAction: "manipulation" }}
              />
            </div>
            <div className="flex justify-end">
              <Link to="/forgot-password" className="text-xs text-muted-foreground hover:underline">
                Забыли пароль?
              </Link>
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={loading}
              style={{ minHeight: 48 }}
            >
              {loading ? (retrying ? "Сеть медленная, ещё раз…" : "Вход...") : "Войти по email"}
            </Button>
          </form>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">
                или альтернативно
              </span>
            </div>
          </div>

          <div className="flex flex-col items-center gap-3">
            {/* Reviewer P1 (Round 2): NO `intendedRole="tutor"` here. This
                is a LOGIN page (no offer/privacy consent gate). A brand-new
                account clicking here would otherwise become a tutor
                automatically, bypassing the consent checkbox required on
                /register-tutor. Existing tutors pass through because their
                role is already assigned (TutorGuard reads it cached);
                default `intendedRole="student"` on the OAuth buttons
                doesn't downgrade them. New users get a student account and
                must explicitly go to /register-tutor for tutor signup. */}
            <YandexAuthButton
              redirectPath="/tutor/home"
              consentSource="yandex-oauth-tutor"
            />
            <VkAuthButton
              redirectPath="/tutor/home"
              consentSource="vk-oauth-tutor"
            />
            <p className="text-xs text-muted-foreground text-center leading-relaxed">
              Вход через Яндекс или VK. Можно также войти по email наверху.
            </p>
          </div>

          <div className="space-y-3 text-center text-sm">
            <p className="text-muted-foreground">
              Нет репетиторского аккаунта?{" "}
              <Link to="/register-tutor" className="text-primary hover:underline">
                Зарегистрироваться
              </Link>
            </p>
            <p className="text-muted-foreground">
              Вы ученик?{" "}
              <Link to="/login" className="text-primary hover:underline">
                Вход ученика
              </Link>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default TutorLogin;
