import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase, getAuthErrorMessage } from "@/lib/supabaseClient";
import { toast } from "sonner";
import { z } from "zod";
import TelegramLoginButton from "@/components/TelegramLoginButton";
import { claimPendingInvite } from "@/lib/inviteApi";
import GoogleAuthButton from "@/components/GoogleAuthButton";
import {
  applyPendingConsent,
  recordConsent,
  stashPendingConsent,
} from "@/lib/consent";

const signupSchema = z.object({
  email: z.string().trim().email({ message: "Неверный формат email" }).max(255),
  password: z.string()
    .min(8, { message: "Минимум 8 символов" })
    .regex(/[A-Z]/, { message: "Должна быть заглавная буква" })
    .regex(/[0-9]/, { message: "Должна быть цифра" }),
  username: z.string()
    .trim()
    .min(3, { message: "Минимум 3 символа" })
    .max(30, { message: "Максимум 30 символов" })
    .regex(/^[a-zA-Zа-яА-Я0-9_-]+$/, { message: "Только буквы, цифры, _ и -" }),
});

const SignUp = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [consent, setConsent] = useState(false);
  const [loading, setLoading] = useState(false);

  // Redirect authenticated users to chat
  useEffect(() => {
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        navigate("/chat");
      }
    };
    checkSession();
  }, [navigate]);

  // Apply consent stashed before OAuth redirect (Google / Telegram).
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session?.user.id) {
        void applyPendingConsent(session.user.id);
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!consent) {
      toast.error("Сначала отметьте согласие с офертой и политикой");
      return;
    }
    setLoading(true);

    try {
      const validation = signupSchema.safeParse({ email, password, username });
      if (!validation.success) {
        toast.error(validation.error.errors[0].message);
        setLoading(false);
        return;
      }

      const { data, error } = await supabase.auth.signUp({
        email: validation.data.email,
        password: validation.data.password,
        options: {
          data: {
            username: validation.data.username,
          },
          emailRedirectTo: `${window.location.origin}/chat`,
        },
      });

      if (error) throw error;

      if (data.user) {
        await recordConsent(data.user.id, "web-signup-student");
      }

      // Only claim if session is established (no email confirmation pending)
      if (data.session) {
        try {
          await claimPendingInvite();
        } catch {
          // Claim error does not block signup
        }
      }

      toast.success("Регистрация успешна! Входим в систему...");
      navigate("/chat");
    } catch (error: any) {
      toast.error(getAuthErrorMessage(error, "Ошибка регистрации"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-hero p-4">
      <Card className="w-full max-w-md shadow-elegant">
        <CardHeader className="space-y-1">
          <CardTitle className="text-3xl font-bold text-center">Регистрация</CardTitle>
          <CardDescription className="text-center">
            Создайте аккаунт, чтобы начать подготовку к ЕГЭ
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Email/Password Signup - Primary */}
          <form onSubmit={handleSignUp} className="space-y-4">
            <div className="space-y-2">
              <Input
                type="text"
                placeholder="Имя пользователя"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                disabled={loading}
              />
            </div>
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
                placeholder="Пароль (минимум 8 символов)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                disabled={loading}
              />
            </div>
            <div className="flex items-start gap-2">
              <input
                id="signup-consent"
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                disabled={loading}
                className="mt-1 h-4 w-4 cursor-pointer accent-primary"
                style={{ touchAction: "manipulation" }}
              />
              <label
                htmlFor="signup-consent"
                className="text-sm text-muted-foreground leading-snug cursor-pointer"
              >
                Я согласен с{" "}
                <a
                  href="/offer"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  публичной офертой
                </a>{" "}
                и{" "}
                <a
                  href="/privacy-policy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  политикой конфиденциальности
                </a>
              </label>
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={loading || !consent}
            >
              {loading ? "Регистрация..." : "Зарегистрироваться по email"}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              Уже есть аккаунт?{" "}
              <Link to="/login" className="text-primary hover:underline">
                Войти
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

          {/* Google OAuth */}
          <GoogleAuthButton
            redirectPath="/chat"
            consentSource="google-oauth-student"
            enabled={consent}
          />

          {/* Telegram Login - Secondary */}
          <div className="flex flex-col items-center">
            <div
              onClickCapture={(e) => {
                if (!consent) {
                  e.preventDefault();
                  e.stopPropagation();
                  toast.error("Сначала отметьте согласие с офертой и политикой");
                  return;
                }
                stashPendingConsent("telegram-oauth-student");
              }}
              style={{
                width: "100%",
                opacity: consent ? 1 : 0.5,
                pointerEvents: consent ? "auto" : "none",
              }}
              aria-disabled={!consent}
            >
              <TelegramLoginButton />
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Или зарегистрируйтесь через Telegram (нужен VPN)
            </p>
            {!consent && (
              <p className="text-xs text-muted-foreground mt-1">
                Отметьте согласие, чтобы войти через Google или Telegram
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default SignUp;
