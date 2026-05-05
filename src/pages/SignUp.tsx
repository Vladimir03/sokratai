import { useState, useEffect, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import { z } from "zod";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";

import { supabase, getAuthErrorMessage } from "@/lib/supabaseClient";
import { claimPendingInvite } from "@/lib/inviteApi";
import TelegramLoginButton from "@/components/TelegramLoginButton";
import GoogleAuthButton from "@/components/GoogleAuthButton";
import {
  applyPendingConsent,
  recordConsent,
  stashPendingConsent,
} from "@/lib/consent";

// Visual parity with TutorSignupTrial.tsx: same 2-column grid, same scoped
// `tst-*` styles. Different audience (students preparing for ЕГЭ/ОГЭ),
// different fields (no subject; username instead).

const signupSchema = z.object({
  email: z
    .string()
    .trim()
    .email({ message: "Неверный формат email" })
    .max(255),
  password: z
    .string()
    .min(8, { message: "Минимум 8 символов" })
    .regex(/[A-Z]/, { message: "Должна быть заглавная буква" })
    .regex(/[0-9]/, { message: "Должна быть цифра" }),
  username: z
    .string()
    .trim()
    .min(3, { message: "Минимум 3 символа" })
    .max(30, { message: "Максимум 30 символов" })
    .regex(/^[a-zA-Zа-яА-Я0-9_-]+$/, { message: "Только буквы, цифры, _ и -" }),
  consent: z.literal(true, {
    errorMap: () => ({ message: "Нужно принять оферту" }),
  }),
});

type FieldErrors = Partial<
  Record<"email" | "password" | "username" | "consent", string>
>;

const SignUp = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [consent, setConsent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [touched, setTouched] = useState<Record<keyof FieldErrors, boolean>>({
    email: false,
    password: false,
    username: false,
    consent: false,
  });

  // Redirect authenticated users to chat
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;
      if (session) {
        navigate("/chat", { replace: true });
      }
    })();
    return () => {
      cancelled = true;
    };
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

  const validateField = useCallback(
    (next: {
      email: string;
      password: string;
      username: string;
      consent: boolean;
    }) => {
      const result = signupSchema.safeParse(next);
      if (result.success) {
        setErrors({});
        return;
      }
      const fieldErrors: FieldErrors = {};
      for (const issue of result.error.errors) {
        const key = issue.path[0] as keyof FieldErrors | undefined;
        if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      setErrors(fieldErrors);
    },
    [],
  );

  const handleBlur = (field: keyof FieldErrors) => {
    setTouched((t) => ({ ...t, [field]: true }));
    validateField({ email, password, username, consent });
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    setTouched({
      email: true,
      password: true,
      username: true,
      consent: true,
    });
    const validation = signupSchema.safeParse({
      email,
      password,
      username,
      consent,
    });
    if (!validation.success) {
      validateField({ email, password, username, consent });
      toast.error(validation.error.errors[0]?.message ?? "Проверьте поля формы");
      setLoading(false);
      return;
    }

    try {
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
    } catch (error) {
      toast.error(getAuthErrorMessage(error, "Ошибка регистрации"));
    } finally {
      setLoading(false);
    }
  };

  const showError = (field: keyof FieldErrors) =>
    touched[field] && errors[field];

  const inputBaseStyle = {
    fontSize: 16,
    touchAction: "manipulation",
  } as const;

  const handleTelegramGate = () => {
    if (!consent) {
      toast.error("Сначала отметьте согласие с офертой и политикой");
      setTouched((t) => ({ ...t, consent: true }));
      validateField({ email, password, username, consent: false });
      return false;
    }
    stashPendingConsent("telegram-oauth-student");
    return true;
  };

  return (
    <div
      className="sokrat sokrat-marketing"
      data-sokrat-mode="marketing"
      style={{
        minHeight: "100dvh",
        backgroundColor: "var(--sokrat-surface)",
        color: "var(--sokrat-fg1)",
      }}
    >
      <style>{`
        .tst-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 32px;
          max-width: 1100px;
          margin: 0 auto;
          padding: 32px 20px 64px;
        }
        @media (min-width: 768px) {
          .tst-grid {
            grid-template-columns: 1fr 1fr;
            gap: 56px;
            padding: 64px 32px 96px;
            align-items: start;
          }
        }
        .tst-card {
          background: var(--sokrat-card);
          border: 1px solid var(--sokrat-border);
          border-radius: var(--sokrat-radius-lg);
          padding: 28px 24px;
          box-shadow: var(--sokrat-shadow-sm);
        }
        @media (min-width: 768px) {
          .tst-card { padding: 36px 32px; }
        }
        .tst-h1 {
          font-size: 26px;
          font-weight: 700;
          line-height: 1.2;
          color: var(--sokrat-fg1);
          margin-bottom: 8px;
        }
        .tst-sub {
          font-size: 14px;
          color: var(--sokrat-fg3);
          margin-bottom: 24px;
          line-height: 1.5;
        }
        .tst-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
        .tst-label {
          font-size: 13px;
          font-weight: 600;
          color: var(--sokrat-fg2);
        }
        .tst-input, .tst-select {
          width: 100%;
          padding: 12px 14px;
          font-size: 16px;
          line-height: 1.4;
          border: 1px solid var(--sokrat-border);
          border-radius: var(--sokrat-radius-md);
          background: var(--sokrat-card);
          color: var(--sokrat-fg1);
          transition: border-color 150ms, box-shadow 150ms;
          touch-action: manipulation;
        }
        .tst-input:focus, .tst-select:focus {
          outline: none;
          border-color: var(--sokrat-green-700);
          box-shadow: 0 0 0 3px rgba(27, 107, 74, 0.12);
        }
        .tst-input--error, .tst-select--error {
          border-color: #DC2626;
        }
        .tst-error {
          font-size: 12px;
          color: #DC2626;
          line-height: 1.4;
        }
        .tst-checkbox-row {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          margin: 8px 0 20px;
        }
        .tst-checkbox {
          margin-top: 2px;
          width: 18px;
          height: 18px;
          accent-color: var(--sokrat-green-700);
          flex-shrink: 0;
          touch-action: manipulation;
        }
        .tst-checkbox-label {
          font-size: 13px;
          color: var(--sokrat-fg2);
          line-height: 1.5;
        }
        .tst-checkbox-label a {
          color: var(--sokrat-green-700);
          text-decoration: underline;
        }
        .tst-cta {
          width: 100%;
          min-height: 52px;
          padding: 0 20px;
          font-size: 16px;
          font-weight: 600;
          color: var(--sokrat-fg-on-dark);
          background: var(--sokrat-green-700);
          border: none;
          border-radius: var(--sokrat-radius-md);
          cursor: pointer;
          transition: background-color 150ms;
          touch-action: manipulation;
        }
        .tst-cta:hover:not(:disabled) { background: var(--sokrat-green-800); }
        .tst-cta:disabled { opacity: 0.6; cursor: not-allowed; }
        .tst-divider {
          display: flex;
          align-items: center;
          gap: 12px;
          margin: 24px 0;
          color: var(--sokrat-fg3);
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }
        .tst-divider::before, .tst-divider::after {
          content: "";
          flex: 1;
          height: 1px;
          background: var(--sokrat-border);
        }
        .tst-tg-wrap {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
        }
        .tst-tg-hint {
          font-size: 12px;
          color: var(--sokrat-fg3);
          text-align: center;
        }
        .tst-login-link {
          font-size: 13px;
          color: var(--sokrat-fg3);
          text-align: center;
          margin-top: 16px;
        }
        .tst-login-link a {
          color: var(--sokrat-green-700);
          text-decoration: underline;
        }

        /* Right column — value prop */
        .tst-value-eyebrow {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--sokrat-ochre-700);
          margin-bottom: 12px;
        }
        .tst-value-headline {
          font-size: 22px;
          font-weight: 700;
          line-height: 1.3;
          color: var(--sokrat-fg1);
          margin-bottom: 20px;
        }
        @media (min-width: 768px) {
          .tst-value-headline { font-size: 26px; }
        }
        .tst-perks {
          display: flex;
          flex-direction: column;
          gap: 12px;
          margin-bottom: 24px;
          list-style: none;
          padding: 0;
        }
        .tst-perk {
          display: flex;
          gap: 10px;
          align-items: flex-start;
          font-size: 15px;
          line-height: 1.45;
          color: var(--sokrat-fg2);
        }
        .tst-perk-icon {
          flex-shrink: 0;
          color: var(--sokrat-green-700);
          margin-top: 2px;
        }
        .tst-perk strong {
          color: var(--sokrat-fg1);
          font-weight: 600;
        }
        .tst-after-box {
          background: var(--sokrat-green-50);
          border: 1px solid var(--sokrat-green-100);
          border-radius: var(--sokrat-radius-md);
          padding: 16px 18px;
        }
        .tst-after-box strong {
          color: var(--sokrat-green-800);
          font-weight: 700;
          display: block;
          margin-bottom: 4px;
          font-size: 13px;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        .tst-after-box p {
          font-size: 14px;
          color: var(--sokrat-fg2);
          line-height: 1.5;
          margin: 0;
        }
      `}</style>

      <div className="tst-grid">
        {/* Left: form */}
        <section className="tst-card" aria-labelledby="signup-form-heading">
          <h1 id="signup-form-heading" className="tst-h1">
            Создайте аккаунт
          </h1>
          <p className="tst-sub">
            Начни готовиться к ЕГЭ и ОГЭ с AI-репетитором. Бесплатно.
          </p>

          {/* Consent FIRST — gates OAuth + email submit. Surfacing it at the
              top makes the gating obvious instead of buried below the form. */}
          <div className="tst-checkbox-row">
            <input
              id="signup-consent"
              type="checkbox"
              checked={consent}
              onChange={(e) => {
                setConsent(e.target.checked);
                if (touched.consent) {
                  validateField({
                    email,
                    password,
                    username,
                    consent: e.target.checked,
                  });
                }
              }}
              onBlur={() => handleBlur("consent")}
              disabled={loading}
              className="tst-checkbox"
              aria-invalid={Boolean(showError("consent"))}
            />
            <label className="tst-checkbox-label" htmlFor="signup-consent">
              Я согласен с{" "}
              <a href="/offer" target="_blank" rel="noopener noreferrer">
                публичной офертой
              </a>{" "}
              и{" "}
              <a
                href="/privacy-policy"
                target="_blank"
                rel="noopener noreferrer"
              >
                политикой конфиденциальности
              </a>
            </label>
          </div>
          {showError("consent") && (
            <span
              className="tst-error"
              style={{ display: "block", marginTop: -12, marginBottom: 12 }}
            >
              {errors.consent}
            </span>
          )}

          {/* OAuth — Telegram + Google, both gated by consent */}
          <div className="flex flex-col gap-3" style={{ marginBottom: 8 }}>
            <div
              onClickCapture={(e) => {
                if (!handleTelegramGate()) {
                  e.preventDefault();
                  e.stopPropagation();
                }
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
            <GoogleAuthButton
              redirectPath="/chat"
              consentSource="google-oauth-student"
              enabled={consent}
            />
            {!consent && (
              <p className="tst-tg-hint" style={{ color: "var(--sokrat-fg3)" }}>
                Отметьте согласие выше, чтобы войти через Telegram или Google
              </p>
            )}
            {consent && (
              <p className="tst-tg-hint">
                Telegram: нужен VPN, если заблокирован
              </p>
            )}
          </div>

          <div className="tst-divider">или по email</div>

          <form onSubmit={handleSignUp} noValidate>
            <div className="tst-field">
              <label className="tst-label" htmlFor="signup-username">
                Имя пользователя
              </label>
              <input
                id="signup-username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => {
                  setUsername(e.target.value);
                  if (touched.username) {
                    validateField({
                      email,
                      password,
                      username: e.target.value,
                      consent,
                    });
                  }
                }}
                onBlur={() => handleBlur("username")}
                disabled={loading}
                required
                style={inputBaseStyle}
                className={`tst-input ${
                  showError("username") ? "tst-input--error" : ""
                }`}
                aria-invalid={Boolean(showError("username"))}
                aria-describedby={
                  showError("username") ? "signup-username-error" : undefined
                }
              />
              {showError("username") && (
                <span id="signup-username-error" className="tst-error">
                  {errors.username}
                </span>
              )}
            </div>

            <div className="tst-field">
              <label className="tst-label" htmlFor="signup-email">
                Email
              </label>
              <input
                id="signup-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (touched.email) {
                    validateField({
                      email: e.target.value,
                      password,
                      username,
                      consent,
                    });
                  }
                }}
                onBlur={() => handleBlur("email")}
                disabled={loading}
                required
                style={inputBaseStyle}
                className={`tst-input ${
                  showError("email") ? "tst-input--error" : ""
                }`}
                aria-invalid={Boolean(showError("email"))}
                aria-describedby={
                  showError("email") ? "signup-email-error" : undefined
                }
              />
              {showError("email") && (
                <span id="signup-email-error" className="tst-error">
                  {errors.email}
                </span>
              )}
            </div>

            <div className="tst-field">
              <label className="tst-label" htmlFor="signup-password">
                Пароль
              </label>
              <input
                id="signup-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (touched.password) {
                    validateField({
                      email,
                      password: e.target.value,
                      username,
                      consent,
                    });
                  }
                }}
                onBlur={() => handleBlur("password")}
                disabled={loading}
                required
                minLength={8}
                style={inputBaseStyle}
                className={`tst-input ${
                  showError("password") ? "tst-input--error" : ""
                }`}
                aria-invalid={Boolean(showError("password"))}
                aria-describedby={
                  showError("password")
                    ? "signup-password-error"
                    : "signup-password-hint"
                }
              />
              {showError("password") ? (
                <span id="signup-password-error" className="tst-error">
                  {errors.password}
                </span>
              ) : (
                <span
                  id="signup-password-hint"
                  className="tst-error"
                  style={{ color: "var(--sokrat-fg3)" }}
                >
                  Минимум 8 символов, заглавная буква и цифра
                </span>
              )}
            </div>

            <button
              type="submit"
              className="tst-cta"
              disabled={loading || !consent}
            >
              {loading ? "Регистрация..." : "Создать аккаунт"}
            </button>
          </form>

          <p className="tst-login-link">
            Уже есть аккаунт? <Link to="/login">Войти</Link>
          </p>
        </section>

        {/* Right: value prop */}
        <aside aria-labelledby="signup-value-heading">
          <div className="tst-value-eyebrow">Что внутри</div>
          <h2 id="signup-value-heading" className="tst-value-headline">
            AI-репетитор для подготовки к ЕГЭ и ОГЭ. Без готовых ответов.
          </h2>

          <ul className="tst-perks">
            <li className="tst-perk">
              <CheckCircle2 className="tst-perk-icon" size={20} aria-hidden="true" />
              <span>
                <strong>Сократовский AI-чат</strong> — задаёт наводящие вопросы,
                ведёт к ответу, а не выдаёт его
              </span>
            </li>
            <li className="tst-perk">
              <CheckCircle2 className="tst-perk-icon" size={20} aria-hidden="true" />
              <span>
                <strong>Разбор задач ЕГЭ и ОГЭ</strong> по физике, математике,
                информатике
              </span>
            </li>
            <li className="tst-perk">
              <CheckCircle2 className="tst-perk-icon" size={20} aria-hidden="true" />
              <span>
                <strong>Проверка решений</strong> — пришли фото, AI скажет где
                ошибка и почему
              </span>
            </li>
            <li className="tst-perk">
              <CheckCircle2 className="tst-perk-icon" size={20} aria-hidden="true" />
              <span>
                <strong>Тренажёр формул</strong> по разделам — собирай и
                запоминай через игру
              </span>
            </li>
          </ul>

          <div className="tst-after-box">
            <strong>Бесплатно</strong>
            <p>
              Базовые функции бесплатны. Никаких подписок и карты — заводи
              аккаунт и начинай учиться.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
};

export default SignUp;
