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
import { claimPendingInvite } from "@/lib/inviteApi";
import { applyPendingConsent } from "@/lib/consent";
import { requestStudentOtp } from "@/lib/studentClaimApi";
import { InAppBrowserNudge } from "@/components/InAppBrowserNudge";

const loginSchema = z.object({
  email: z.string().trim().email({ message: "Неверный формат email" }).max(255),
  password: z.string().min(6, { message: "Минимум 6 символов" }),
});

const Login = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  // Под РФ-DPI первый запрос логина может «упасть» → авто-ретрай (authRetry),
  // флаг показывает «сеть медленная, ещё раз» на кнопке (зеркало TutorLogin).
  const [retrying, setRetrying] = useState(false);
  const [showTelegramHint, setShowTelegramHint] = useState(false);
  const telegramTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const redirectErrorShown = useRef(false);
  // Онбординг v2 (T7) — «войти по коду» (RU-safe magic-link на email).
  const [otpOpen, setOtpOpen] = useState(false);
  const [otpEmail, setOtpEmail] = useState("");
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpSent, setOtpSent] = useState(false);

  // Cleanup telegram timeout on unmount
  useEffect(() => {
    return () => {
      if (telegramTimeoutRef.current) clearTimeout(telegramTimeoutRef.current);
    };
  }, []);

  // Surface auth errors returned from edge function redirects
  // (oauth-google-callback → ?oauth_error=..., email-verify → ?email_verify_error=...).
  // Without this the user lands on /login with no explanation of what went
  // wrong during OAuth round-trip or email confirmation click.
  useEffect(() => {
    if (redirectErrorShown.current) return;
    const err = readAuthRedirectError(searchParams);
    if (!err) return;
    redirectErrorShown.current = true;
    console.warn(
      JSON.stringify({
        event: "auth_redirect_error_displayed",
        flow: "student_login",
        code: err.code,
        timestamp: new Date().toISOString(),
      }),
    );
    toast.error(err.message, { duration: 10000 });
    // Strip error params from URL so refresh / back-button doesn't re-toast.
    const next = new URLSearchParams(searchParams);
    next.delete("email_verify_error");
    next.delete("oauth_error");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  // Redirect authenticated users to product
  useEffect(() => {
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const nextParam = searchParams.get("next");
        if (nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//")) {
          window.location.replace(nextParam);
          return;
        }
        const { data: isTutor } = await supabase.rpc("is_tutor", { _user_id: session.user.id });
        if (isTutor) {
          navigate("/tutor/home");
        } else {
          navigate("/student/schedule");
        }
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
      // Неверный пароль резолвится в `{ error }` → сразу, без ретрая.
      const { data, error } = await callAuthWithRetry(
        () => supabase.auth.signInWithPassword({
          email: validation.data.email,
          password: validation.data.password,
        }),
        { onRetry: () => setRetrying(true) },
      );

      if (error) throw error;

      // Non-blocking: claim pending invite if exists in localStorage. Забаундено
      // тем же таймаутом (claim идемпотентен, rule 60) — чтобы обрыв не завесил
      // вход после успешной авторизации; ошибка/таймаут проглатывается.
      try {
        await callAuthWithRetry(() => claimPendingInvite());
      } catch {
        // Claim error/timeout does not block login
      }

      // Check if user is a tutor and redirect accordingly
      if (data.user) {
        const nextParam = searchParams.get("next");
        if (nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//")) {
          toast.success("Успешный вход!");
          window.location.replace(nextParam);
          return;
        }
        const userId = data.user.id;
        // is_tutor здесь НЕ критичен (лишь выбор редиректа tutor↔student). Сбой
        // сети НЕ должен блокировать вход — бунтуем таймаутом и по-умолчанию ведём
        // как ученика (сохраняет прежнее поведение «isTutor undefined → student»).
        let isTutor = false;
        try {
          const roleRes = await callAuthWithRetry(
            () => Promise.resolve(supabase.rpc("is_tutor", { _user_id: userId })) as Promise<any>,
            { onRetry: () => setRetrying(true) },
          );
          isTutor = !!roleRes.data;
        } catch {
          isTutor = false;
        }

        if (isTutor) {
          toast.success("Успешный вход!");
          navigate("/tutor/home");
          return;
        }
      }

      toast.success("Успешный вход!");
      navigate("/student/schedule");
    } catch (error: any) {
      // Сетевой сбой/таймаут под DPI — честное сообщение + подсказка про VPN,
      // а не вечный спиннер и не generic «Ошибка входа».
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

  const handleOtpRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = otpEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      toast.error("Введите корректный email");
      return;
    }
    setOtpLoading(true);
    try {
      await requestStudentOtp(value);
      setOtpSent(true);
      toast.success("Если аккаунт есть — мы прислали ссылку для входа на почту");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось отправить ссылку");
    } finally {
      setOtpLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-hero p-4">
      <Card className="w-full max-w-md shadow-elegant">
        <CardHeader className="space-y-1">
          <CardTitle className="text-3xl font-bold text-center">Вход</CardTitle>
          <CardDescription className="text-center">
            Войдите в свой аккаунт, чтобы продолжить обучение
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <InAppBrowserNudge />
          {/* Email/Password Login - Primary */}
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <Input
                type="password"
                placeholder="Пароль"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loading}
              />
              <div className="text-right">
                <Link to="/forgot-password" className="text-sm text-muted-foreground hover:text-primary">
                  Забыли пароль?
                </Link>
              </div>
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={loading}
            >
              {loading ? (retrying ? "Сеть медленная, ещё раз…" : "Вход...") : "Войти по email"}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              Нет аккаунта?{" "}
              <Link to="/signup" className="text-primary hover:underline">
                Зарегистрироваться
              </Link>
            </p>
            <p className="text-center text-sm text-muted-foreground mt-2">
              Вы репетитор?{" "}
              <Link to="/tutor/login" className="text-primary hover:underline">
                Вход для репетиторов
              </Link>
            </p>
          </form>

          {/* Онбординг v2 (T7) — вход по коду (magic-link на почту) */}
          <div className="rounded-lg border border-border p-3">
            {!otpOpen ? (
              <button
                type="button"
                className="w-full text-sm font-medium text-primary"
                onClick={() => {
                  setOtpOpen(true);
                  setOtpSent(false);
                  if (!otpEmail && email) setOtpEmail(email);
                }}
                style={{ touchAction: "manipulation" }}
              >
                Войти по коду на почту
              </button>
            ) : otpSent ? (
              <p className="text-sm text-muted-foreground text-center">
                Проверь почту — мы прислали ссылку для входа. Перейди по ней с этого устройства.
              </p>
            ) : (
              <form onSubmit={handleOtpRequest} className="space-y-2">
                <p className="text-sm text-muted-foreground">Пришлём ссылку для входа на почту — без пароля.</p>
                <Input
                  type="email"
                  inputMode="email"
                  placeholder="Email"
                  value={otpEmail}
                  onChange={(e) => setOtpEmail(e.target.value)}
                  className="text-base"
                  disabled={otpLoading}
                  required
                />
                <Button type="submit" variant="outline" className="w-full" disabled={otpLoading}>
                  {otpLoading ? "Отправляем…" : "Прислать ссылку"}
                </Button>
              </form>
            )}
            <p className="mt-2 text-center text-xs text-muted-foreground">
              Нет пароля и почты? Попроси у репетитора новую ссылку для входа.
            </p>
          </div>

          {/* Divider */}
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">
                или
              </span>
            </div>
          </div>

          {/* OAuth options — Yandex ID + VK ID (российские сервисы, 406-ФЗ) */}
          <div className="flex flex-col items-stretch gap-3">
            <YandexAuthButton
              redirectPath="/student/schedule"
              consentSource="yandex-oauth-student"
            />
            <VkAuthButton
              redirectPath="/student/schedule"
              consentSource="vk-oauth-student"
            />
            <p className="text-xs text-muted-foreground mt-1 text-center leading-relaxed">
              Вход через Яндекс или VK. Можно также войти по email&nbsp;↑
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Login;
