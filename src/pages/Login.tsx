import { useState, useEffect, useRef } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase, getAuthErrorMessage } from "@/lib/supabaseClient";
import { toast } from "sonner";
import { z } from "zod";
import TelegramLoginButton from "@/components/TelegramLoginButton";
import { claimPendingInvite } from "@/lib/inviteApi";

const loginSchema = z.object({
  email: z.string().trim().email({ message: "Неверный формат email" }).max(255),
  password: z.string().min(4, { message: "Минимум 4 символа" }),
});

const Login = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [showTelegramHint, setShowTelegramHint] = useState(false);
  const telegramTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup telegram timeout on unmount
  useEffect(() => {
    return () => {
      if (telegramTimeoutRef.current) clearTimeout(telegramTimeoutRef.current);
    };
  }, []);

  // Redirect authenticated users to product
  useEffect(() => {
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const { data: isTutor } = await supabase.rpc("is_tutor", { _user_id: session.user.id });
        if (isTutor) {
          navigate("/tutor/dashboard");
        } else {
          navigate("/chat");
        }
      }
    };
    checkSession();
  }, [navigate]);

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
          navigate("/tutor/dashboard");
          return;
        }
      }

      toast.success("Успешный вход!");
      navigate("/chat");
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

          {/* Telegram Login - Secondary */}
          <div className="flex flex-col items-center">
            <div
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
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Или войдите через Telegram (нужен VPN)
            </p>
            {showTelegramHint && (
              <p className="text-xs text-amber-600 mt-1">
                Telegram может быть недоступен. Попробуйте войти по email&nbsp;↑
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Login;
