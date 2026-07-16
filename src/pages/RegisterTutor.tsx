import { useState, useEffect } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase, getAuthErrorMessage } from "@/lib/supabaseClient";
import { toast } from "sonner";
import { z } from "zod";
import { GraduationCap } from "lucide-react";
import YandexAuthButton from "@/components/YandexAuthButton";
import VkAuthButton from "@/components/VkAuthButton";
import { EmailConfirmWaiting } from "@/components/auth/EmailConfirmWaiting";
import { capturePromoFromUrl, getStoredPromo } from "@/lib/promoCapture";
import {
  applyPendingConsent,
  recordConsent,
  stashPendingConsent,
} from "@/lib/consent";

const registerSchema = z.object({
  name: z.string()
    .trim()
    .min(2, { message: "Минимум 2 символа" })
    .max(100, { message: "Максимум 100 символов" }),
  email: z.string().trim().email({ message: "Неверный формат email" }).max(255),
  password: z.string()
    .min(8, { message: "Минимум 8 символов" })
    .regex(/[A-Z]/, { message: "Должна быть заглавная буква" })
    .regex(/[0-9]/, { message: "Должна быть цифра" }),
});

function isExistingEmailError(error: unknown): boolean {
  const message = String((error as any)?.message || "").toLowerCase();
  return (
    message.includes("already registered") ||
    message.includes("already been registered") ||
    message.includes("already in use") ||
    message.includes("user already exists")
  );
}

const RegisterTutor = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Мягкий дозвон-канал (item 7): необязательно, не блокирует регистрацию.
  const [telegram, setTelegram] = useState("");
  // Реферальный код коллеги (Stage 3 рефералки): prefill из ?rc= (localStorage),
  // редактируем, опционален — НЕ блокирует регистрацию.
  const [referralCode, setReferralCode] = useState(() => getStoredPromo().rc ?? "");
  const [consent, setConsent] = useState(false);
  const [loading, setLoading] = useState(false);
  // Экран «подтвердите почту» вместо выброса (тупик #2). null → показываем форму.
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);

  // Захват ?ref/?promo/?utm из ссылки Егора → localStorage (идемпотентно).
  // Только чтение URL — auth/signUp/redirect-логику не трогаем (rule 96).
  useEffect(() => {
    capturePromoFromUrl(searchParams);
  }, [searchParams]);

  // Redirect only if user is already a tutor
  useEffect(() => {
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        // Check if user is already a tutor
        const { data: isTutor } = await supabase.rpc("is_tutor", { 
          _user_id: session.user.id 
        });
        
        if (isTutor) {
          navigate("/tutor/home");
        }
        // If not a tutor, show registration form
      }
    };
    checkSession();
  }, [navigate]);

  // Apply consent stashed before OAuth redirect.
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session?.user.id) {
        void applyPendingConsent(session.user.id);
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!consent) {
      toast.error("Сначала отметьте согласие с офертой и политикой");
      return;
    }
    setLoading(true);

    try {
      const validation = registerSchema.safeParse({ name, email, password });
      if (!validation.success) {
        toast.error(validation.error.errors[0].message);
        setLoading(false);
        return;
      }

      console.warn(
        JSON.stringify({
          event: "tutor_signup_started",
          flow: "tutor_register",
          timestamp: new Date().toISOString(),
        }),
      );

      // Промо/ref из ссылки Егора (localStorage, P0) → метаданные signUp, чтобы
      // email-verify/assign-tutor-role записали profiles.promo_code (fast-follow).
      const { promo, ref } = getStoredPromo();

      // Step 1: Register the user.
      // user_metadata carries server-side finalization intent for email-verify
      // edge function: it reads `signup_source` to decide whether to assign
      // tutor role + create tutors-row, and `consent_intent` to flush consent
      // (both happen after email confirmation, where the client cannot run).
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: validation.data.email,
        password: validation.data.password,
        options: {
          data: {
            username: validation.data.name,
            signup_source: "tutor-register",
            consent_intent: "web-signup-tutor",
            ...(promo ? { promo } : {}),
            ...(ref ? { ref } : {}),
            ...(referralCode.trim() ? { rc: referralCode.trim() } : {}),
            ...(telegram.trim() ? { telegram: telegram.trim() } : {}),
          },
          emailRedirectTo: `${window.location.origin}/tutor/home`,
        },
      });

      if (authError && isExistingEmailError(authError)) {
        console.warn(
          JSON.stringify({
            event: "tutor_signup_existing_email",
            flow: "tutor_register",
            timestamp: new Date().toISOString(),
          }),
        );
        toast.error("Email уже зарегистрирован. Войдите в существующий аккаунт.", {
          duration: 10000,
          action: {
            label: "Войти",
            onClick: () => navigate("/tutor/login"),
          },
        });
        return;
      }

      if (authError) throw authError;

      if (!authData.user) {
        throw new Error("Не удалось создать пользователя");
      }

      // Email confirmation gate (Phase 1, fix RU silent-fail 2026-05-16):
      // When Supabase requires email confirm, signUp() returns user but no
      // session. Without this guard, the next line (functions.invoke without
      // user JWT) returns 401 → user sees confused «Не удалось назначить
      // роль» error and abandons. Mirror TutorSignupTrial.tsx behaviour:
      // surface explicit toast.info, exit cleanly. Account exists; tutor
      // role assignment happens on confirm-link return.
      if (!authData.session) {
        console.warn(
          JSON.stringify({
            event: "tutor_signup_email_pending",
            flow: "tutor_register",
            timestamp: new Date().toISOString(),
          }),
        );
        // Экран ожидания вместо выброса из приложения (тупик #2).
        setPendingEmail(email);
        return;
      }

      // Step 2: Assign tutor role via edge function
      const { error: roleError } = await supabase.functions.invoke("assign-tutor-role", {
        body: { user_id: authData.user.id },
      });

      if (roleError) {
        console.error(
          JSON.stringify({
            event: "tutor_signup_role_assign_failed",
            flow: "tutor_register",
            error: roleError.message,
            timestamp: new Date().toISOString(),
          }),
        );
        toast.error("Не удалось назначить роль репетитора. Попробуйте снова.");
        return;
      }

      await recordConsent(authData.user.id, "web-signup-tutor");

      console.warn(
        JSON.stringify({
          event: "tutor_signup_succeeded",
          flow: "tutor_register",
          timestamp: new Date().toISOString(),
        }),
      );

      toast.success("Регистрация успешна!");
      navigate("/tutor/home");
    } catch (error: any) {
      console.error("Registration error:", error);
      toast.error(getAuthErrorMessage(error, "Ошибка регистрации"));
    } finally {
      setLoading(false);
    }
  };

  if (pendingEmail) {
    return (
      <EmailConfirmWaiting
        email={pendingEmail}
        emailRedirectTo={`${window.location.origin}/tutor/home`}
        onBack={() => setPendingEmail(null)}
        onSignedIn={() => navigate("/tutor/home")}
      />
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-hero p-4">
      <Card className="w-full max-w-md shadow-elegant">
        <CardHeader className="space-y-1">
          <div className="flex justify-center mb-2">
            <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center">
              <GraduationCap className="w-8 h-8 text-primary" />
            </div>
          </div>
          <CardTitle className="text-3xl font-bold text-center">Регистрация репетитора</CardTitle>
          <CardDescription className="text-center">
            Создайте аккаунт для управления учениками
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Email-first redesign (2026-05-16, RU bypass): email/password — primary
              path, OAuth — fallback below. Reason: in РФ без VPN Google can hit
              CF throttling (16-KB), Telegram t.me deep-link doesn't work on
              Windows без TG Desktop, but api.sokratai.ru → email works reliably
              (Selectel Moscow direct, no CF, no SNI блокировки). */}
          <form onSubmit={handleRegister} className="space-y-4">
            <div className="space-y-2">
              <Input
                type="text"
                placeholder="Имя"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                disabled={loading}
                style={{ fontSize: 16, touchAction: "manipulation" }}
              />
            </div>
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
                autoComplete="new-password"
                placeholder="Пароль (минимум 8 символов)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                disabled={loading}
                style={{ fontSize: 16, touchAction: "manipulation" }}
              />
            </div>
            {/* Мягкий дозвон-канал (item 7): опционально, НЕ блокирует
                регистрацию (нет required/валидации-гейта). Email уже собран. */}
            <div className="space-y-1">
              <Input
                type="text"
                autoComplete="off"
                placeholder="Telegram (по желанию)"
                value={telegram}
                onChange={(e) => setTelegram(e.target.value)}
                disabled={loading}
                style={{ fontSize: 16, touchAction: "manipulation" }}
              />
              <p className="text-xs text-muted-foreground leading-snug">
                По желанию — будем напоминать про ДЗ и присылать важное. Можно
                добавить позже в профиле.
              </p>
            </div>
            {/* Реферальный код КОЛЛЕГИ-репетитора (Stage 3): опционально, без
                валидации-гейта — невалидный код молча не прикрепится на сервере. */}
            <div className="space-y-1">
              <Input
                type="text"
                autoComplete="off"
                placeholder="Код приглашения от коллеги (по желанию)"
                value={referralCode}
                onChange={(e) => setReferralCode(e.target.value)}
                disabled={loading}
                style={{ fontSize: 16, touchAction: "manipulation" }}
              />
              <p className="text-xs text-muted-foreground leading-snug">
                Есть код от коллеги-репетитора? Укажите — можно и позже в профиле.
              </p>
            </div>
            {/* Custom-rendered consent checkbox (same `.rtc-consent-checkbox`
                pattern as TutorSignupTrial.tsx `.tst-checkbox`). Replaced
                native `<input type="checkbox" accent-primary>` because the
                latter rendered invisibly on Chrome/Windows (white-on-white
                when unchecked). Replaced shadcn Checkbox because
                `data-[state=checked]:bg-primary` modifier wasn't generating
                in this project's Tailwind build. Inline `<style>` block is
                self-contained, proven pattern, default state: unchecked. */}
            <style>{`
              .rtc-consent-row {
                display: flex;
                align-items: flex-start;
                gap: 10px;
                margin: 8px 0 16px;
              }
              .rtc-consent-checkbox {
                appearance: none;
                -webkit-appearance: none;
                margin-top: 2px;
                width: 22px;
                height: 22px;
                flex-shrink: 0;
                background: #fff;
                border: 2px solid hsl(var(--primary));
                border-radius: 4px;
                cursor: pointer;
                position: relative;
                transition: background-color 150ms;
                touch-action: manipulation;
              }
              /* Note: Chrome treats input[type=checkbox] background-color
                 specially even with appearance:none — neither CSS nor inline
                 !important applies a filled background. Instead we render a
                 thick green checkmark via ::after, which clearly indicates
                 the checked state on the white field with green border.
                 Tested in Chrome 130+ / Windows. */
              .rtc-consent-checkbox:checked::after {
                content: "";
                position: absolute;
                inset: 0;
                background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='%231B6948' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M3 8.5l3.5 3.5L13 5'/%3E%3C/svg%3E");
                background-repeat: no-repeat;
                background-position: center;
                background-size: 16px 16px;
              }
              .rtc-consent-checkbox:focus-visible {
                outline: 2px solid hsl(var(--primary));
                outline-offset: 2px;
              }
              .rtc-consent-checkbox:disabled {
                opacity: 0.5;
                cursor: not-allowed;
              }
            `}</style>
            <div className="rtc-consent-row">
              <input
                id="register-tutor-consent"
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                disabled={loading}
                className="rtc-consent-checkbox"
              />
              <label
                htmlFor="register-tutor-consent"
                className="text-sm text-muted-foreground leading-snug cursor-pointer select-none"
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
              style={{ minHeight: 48 }}
            >
              {loading ? "Регистрация..." : "Зарегистрироваться"}
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

          <div className="flex flex-col items-center space-y-3">
            <div className="w-full">
              <YandexAuthButton
                redirectPath="/tutor/home"
                consentSource="yandex-oauth-tutor"
                intendedRole="tutor"
                enabled={consent}
              />
            </div>
            <div className="w-full">
              <VkAuthButton
                redirectPath="/tutor/home"
                consentSource="vk-oauth-tutor"
                intendedRole="tutor"
                enabled={consent}
              />
            </div>
            <p className="text-xs text-muted-foreground text-center leading-relaxed">
              Вход через Яндекс или VK. Можно также зарегистрироваться по email
              (форма наверху).
            </p>
          </div>

          <div className="space-y-3 text-center text-sm">
            <p className="text-muted-foreground">
              Уже есть аккаунт?{" "}
              <Link to="/tutor/login" className="text-primary hover:underline">
                Войти
              </Link>
            </p>
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
            <p className="text-muted-foreground">
              Вы ученик?{" "}
              <Link to="/signup" className="text-primary hover:underline">
                Регистрация ученика
              </Link>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default RegisterTutor;
