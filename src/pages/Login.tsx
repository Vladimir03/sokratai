import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase, getAuthErrorMessage } from "@/lib/supabaseClient";
import { readAuthRedirectError } from "@/lib/authErrors";
import { toast } from "sonner";
import { z } from "zod";
import TelegramLoginButton from "@/components/TelegramLoginButton";
import GoogleAuthButton from "@/components/GoogleAuthButton";
import { claimPendingInvite } from "@/lib/inviteApi";
import { applyPendingConsent } from "@/lib/consent";

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
  const [showTelegramHint, setShowTelegramHint] = useState(false);
  const telegramTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const redirectErrorShown = useRef(false);

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
        const { data: isTutor } = await supabase.rpc("is_tutor", { _user_id: session.user.id });
        if (isTutor) {
          navigate("/tutor/home");
        } else {
          navigate("/student/schedule");
        }
      }
    };
    checkSession();
  }, [navigate]);

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

    try {
      const validation = loginSchema.safeParse({ email, password });
      if (!validation.success) {
        toast.error(validation.error.errors[0].message);
        setLoading(false);
        return;
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email: validation.data.email,
        password: validation.data.password,
      });

      if (error) throw error;

      // Non-blocking: claim pending invite if exists in localStorage
      try {
        await claimPendingInvite();
      } catch {
        // Claim error does not block login
      }

      // Check if user is a tutor and redirect accordingly
      if (data.user) {
        const { data: isTutor } = await supabase.rpc("is_tutor", { _user_id: data.user.id });

        if (isTutor) {
          toast.success("Успешный вход!");
          navigate("/tutor/home");
          return;
        }
      }

      toast.success("Успешный вход!");
      navigate("/student/schedule");
    } catch (error: any) {
      toast.error(getAuthErrorMessage(error, "Ошибка входа"));
    } finally {
      setLoading(false);
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
              {loading ? "Вход..." : "Войти по email"}
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

          {/* OAuth options — Google + Telegram */}
          <div className="flex flex-col items-stretch gap-3">
            <GoogleAuthButton
              redirectPath="/student/schedule"
              consentSource="google-oauth-student"
            />
            <div
              className="flex flex-col items-center"
              onClick={() => {
                // Reset on each click: clear previous timer + hide stale hint
                if (telegramTimeoutRef.current) {
                  clearTimeout(telegramTimeoutRef.current);
                }
                setShowTelegramHint(false);
                telegramTimeoutRef.current = setTimeout(() => {
                  setShowTelegramHint(true);
                  telegramTimeoutRef.current = null;
                }, 30_000);
              }}
            >
              <TelegramLoginButton />
              <p className="text-xs text-muted-foreground mt-2 text-center leading-relaxed">
                Telegram и Google могут не работать в РФ без VPN. Если кнопки
                «зависают» — войдите по email&nbsp;↑
              </p>
              {showTelegramHint && (
                <p className="text-xs text-amber-600 mt-1 text-center">
                  Telegram не отвечает — попробуйте email или VPN
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Login;
