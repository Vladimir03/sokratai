import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { z } from "zod";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";

import { supabase, getAuthErrorMessage } from "@/lib/supabaseClient";
import { claimPendingInvite } from "@/lib/inviteApi";
import { trackTutorLandingGoal } from "@/lib/tutorLandingAnalytics";
import TutorTelegramLoginButton from "@/components/TutorTelegramLoginButton";
import GoogleAuthButton from "@/components/GoogleAuthButton";
import {
  applyPendingConsent,
  recordConsent,
  stashPendingConsent,
} from "@/lib/consent";

// Job: B0.1 «Активироваться, не вкладываясь» — repackages signup as a 7-day,
// no-card trial so a new tutor can reach P0.1 (own first AI-checked homework).

function isExistingEmailError(error: unknown): boolean {
  const message = String((error as { message?: string })?.message || "")
    .toLowerCase();
  return (
    message.includes("already registered") ||
    message.includes("already been registered") ||
    message.includes("already in use") ||
    message.includes("user already exists")
  );
}

const SUBJECT_OPTIONS = [
  { value: "physics", label: "Физика" },
  { value: "maths", label: "Математика" },
  { value: "informatics", label: "Информатика" },
  { value: "multiple", label: "Несколько предметов" },
  { value: "other", label: "Другое" },
] as const;

type SubjectValue = (typeof SUBJECT_OPTIONS)[number]["value"];

const trialSignupSchema = z.object({
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
  subject: z.enum(["physics", "maths", "informatics", "multiple", "other"]),
  oferta: z.literal(true, {
    errorMap: () => ({ message: "Нужно принять оферту" }),
  }),
});

type FieldErrors = Partial<Record<"email" | "password" | "subject" | "oferta", string>>;

function generateUsernameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  return local.toLowerCase().replace(/[^a-z0-9_-]/g, "") || "user";
}

export default function TutorSignupTrial() {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [subject, setSubject] = useState<SubjectValue>("physics");
  const [oferta, setOferta] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [touched, setTouched] = useState<Record<keyof FieldErrors, boolean>>({
    email: false,
    password: false,
    subject: false,
    oferta: false,
  });

  const trialMarkerAppliedRef = useRef(false);
  const isTrialIntent = params.get("trial") === "7";

  /**
   * Apply profiles.trial_started_at = NOW() once per mount.
   * Returns true on success (or no-op when trial param absent), false on DB error.
   * `signup_completed` goal is intentionally NOT fired here — caller fires it
   * only after BOTH role assignment AND marker apply succeed.
   */
  const applyTrialMarker = useCallback(
    async (userId: string): Promise<boolean> => {
      if (trialMarkerAppliedRef.current) return true;
      trialMarkerAppliedRef.current = true;

      if (!isTrialIntent) return true;

      try {
        const { error } = await supabase
          .from("profiles")
          .update({ trial_started_at: new Date().toISOString() })
          .eq("id", userId);

        if (error) {
          console.warn("[trial-flow] update trial_started_at failed", error);
          return false;
        }
        return true;
      } catch (e) {
        console.warn("[trial-flow] update trial_started_at threw", e);
        return false;
      }
    },
    [isTrialIntent],
  );

  // Redirect already-authenticated users (no signup_started fire on mount).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;
      if (session) {
        navigate("/tutor/home", { replace: true });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  // TG OAuth path: TutorTelegramLoginButton handles role assignment server-side
  // (intended_role: "tutor") and own navigation. We piggyback on SIGNED_IN to
  // apply trial marker; goal fires only if marker succeeds.
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session?.user.id) {
        const userId = session.user.id;
        // Apply consent stashed before OAuth redirect (Google / Telegram).
        void applyPendingConsent(userId);
        // Ensure tutor role is assigned for OAuth returns (email flow does this inline).
        void supabase
          .rpc("is_tutor", { _user_id: userId })
          .then(({ data: isTutor }) => {
            if (isTutor) return;
            return supabase.functions
              .invoke("assign-tutor-role", { body: { user_id: userId } })
              .then(({ error }) => {
                if (error) {
                  console.warn("[trial-flow] OAuth role assignment failed", error);
                }
              });
          });
        void applyTrialMarker(session.user.id).then((ok) => {
          if (ok) {
            trackTutorLandingGoal("tutor_landing_trial_signup_completed");
          }
        });
      }
    });
    return () => data.subscription.unsubscribe();
  }, [applyTrialMarker]);

  const validateField = useCallback(
    (next: { email: string; password: string; subject: SubjectValue; oferta: boolean }) => {
      const result = trialSignupSchema.safeParse(next);
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
    validateField({ email, password, subject, oferta });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    setTouched({ email: true, password: true, subject: true, oferta: true });
    const validation = trialSignupSchema.safeParse({
      email,
      password,
      subject,
      oferta,
    });
    if (!validation.success) {
      validateField({ email, password, subject, oferta });
      toast.error(validation.error.errors[0]?.message ?? "Проверьте поля формы");
      setLoading(false);
      return;
    }

    // Fire signup_started AFTER validation passes — funnel measures intent to
    // submit, not idle landings on the form.
    trackTutorLandingGoal("tutor_landing_trial_signup_started");

    try {
      const username = generateUsernameFromEmail(validation.data.email);

      const { data, error: authError } = await supabase.auth.signUp({
        email: validation.data.email,
        password: validation.data.password,
        options: {
          data: {
            username,
            subject: validation.data.subject,
            signup_source: "tutor-landing-trial",
          },
          emailRedirectTo: `${window.location.origin}/tutor/home`,
        },
      });

      if (authError && isExistingEmailError(authError)) {
        toast.error(
          "Email уже занят. Войдите в аккаунт или используйте другой email.",
        );
        return;
      }
      if (authError) throw authError;

      if (!data.session || !data.user) {
        toast.info("Подтвердите email — мы отправили письмо.");
        return;
      }

      // Step 2: assign tutor role — same path as RegisterTutor.
      // Without this TutorGuard bounces user to /register-tutor.
      const { error: roleError } = await supabase.functions.invoke(
        "assign-tutor-role",
        { body: { user_id: data.user.id } },
      );

      if (roleError) {
        console.error("[trial-flow] role assignment failed", {
          user_id: data.user.id,
          error: roleError.message,
        });
        toast.error(
          "Аккаунт создан, но не удалось назначить роль репетитора. Напишите нам в поддержку.",
        );
        return;
      }

      try {
        await claimPendingInvite();
      } catch {
        // Non-blocking — invite claim retry happens on next auth surface.
      }

      const markerOk = await applyTrialMarker(data.user.id);

      // Persist consent for email-flow signup (OAuth handled via stash + onAuthStateChange).
      await recordConsent(data.user.id, "web-signup-tutor");

      // Goal fires only when role assignment AND marker apply both succeeded.
      // (Marker apply returns true also when ?trial=7 absent — non-trial signup
      // through this surface still counts as completed conversion.)
      if (markerOk) {
        trackTutorLandingGoal("tutor_landing_trial_signup_completed");
      }

      toast.success(
        isTrialIntent
          ? "Готово! Trial на 7 дней активирован."
          : "Регистрация успешна!",
      );
      navigate("/tutor/home", { replace: true });
    } catch (error) {
      toast.error(getAuthErrorMessage(error, "Ошибка регистрации"));
    } finally {
      setLoading(false);
    }
  };

  const showError = (field: keyof FieldErrors) =>
    touched[field] && errors[field];

  const oauthEnabled = oferta;
  const handleTelegramGate = () => {
    if (!oferta) {
      toast.error("Сначала отметьте согласие с офертой и политикой");
      setTouched((t) => ({ ...t, oferta: true }));
      validateField({ email, password, subject, oferta: false });
      return false;
    }
    stashPendingConsent("telegram-oauth-tutor");
    return true;
  };

  const inputBaseStyle = {
    fontSize: 16,
    touchAction: "manipulation",
  } as const;

  return (
    <div
      className="sokrat sokrat-marketing"
      data-sokrat-mode="marketing"
      style={{
        // 100dvh = dynamic viewport unit; avoids iOS Safari bottom-bar jump.
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
        .tst-trial-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 10px;
          margin-bottom: 16px;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          background: var(--sokrat-green-100);
          color: var(--sokrat-green-800);
          border-radius: var(--sokrat-radius-full);
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
          appearance: auto;
          -webkit-appearance: checkbox;
          border: 2px solid var(--sokrat-green-700);
          border-radius: 4px;
          background: #fff;
          cursor: pointer;
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
        <section className="tst-card" aria-labelledby="tst-form-heading">
          {isTrialIntent && (
            <span className="tst-trial-pill">🎁 7 дней бесплатно</span>
          )}
          <h1 id="tst-form-heading" className="tst-h1">
            Создайте аккаунт репетитора
          </h1>
          <p className="tst-sub">
            Без карты. Через 7 дней спросим, продолжать ли — не списываем сами.
          </p>

          {/*
            Consent FIRST — user must check it before OAuth becomes active.
            Surfacing it at the top makes the gating obvious; the alternative
            (consent buried below the email form) led to confused «почему
            Google не нажимается?» reports.
          */}
          <div className="tst-checkbox-row">
            <input
              id="tst-oferta"
              type="checkbox"
              checked={oferta}
              onChange={(e) => {
                setOferta(e.target.checked);
                if (touched.oferta) {
                  validateField({
                    email,
                    password,
                    subject,
                    oferta: e.target.checked,
                  });
                }
              }}
              onBlur={() => handleBlur("oferta")}
              disabled={loading}
              className="tst-checkbox"
              aria-invalid={Boolean(showError("oferta"))}
            />
            <label className="tst-checkbox-label" htmlFor="tst-oferta">
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
          {showError("oferta") && (
            <span
              className="tst-error"
              style={{ display: "block", marginTop: -12, marginBottom: 12 }}
            >
              {errors.oferta}
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
                opacity: oauthEnabled ? 1 : 0.5,
                pointerEvents: oauthEnabled ? "auto" : "none",
              }}
              aria-disabled={!oauthEnabled}
            >
              <TutorTelegramLoginButton className="w-full" />
            </div>
            <GoogleAuthButton
              redirectPath="/tutor/home"
              consentSource="google-oauth-tutor"
              enabled={oauthEnabled}
            />
            {!oferta && (
              <p className="tst-tg-hint" style={{ color: "var(--sokrat-fg3)" }}>
                Отметьте согласие выше, чтобы войти через Telegram или Google
              </p>
            )}
            {oferta && (
              <p className="tst-tg-hint">
                Telegram: нужен VPN, если заблокирован
              </p>
            )}
          </div>

          <div className="tst-divider">или по email</div>

          <form onSubmit={handleSubmit} noValidate>
            <div className="tst-field">
              <label className="tst-label" htmlFor="tst-email">
                Email
              </label>
              <input
                id="tst-email"
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
                      subject,
                      oferta,
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
                  showError("email") ? "tst-email-error" : undefined
                }
              />
              {showError("email") && (
                <span id="tst-email-error" className="tst-error">
                  {errors.email}
                </span>
              )}
            </div>

            <div className="tst-field">
              <label className="tst-label" htmlFor="tst-password">
                Пароль
              </label>
              <input
                id="tst-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (touched.password) {
                    validateField({
                      email,
                      password: e.target.value,
                      subject,
                      oferta,
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
                  showError("password") ? "tst-password-error" : "tst-password-hint"
                }
              />
              {showError("password") ? (
                <span id="tst-password-error" className="tst-error">
                  {errors.password}
                </span>
              ) : (
                <span
                  id="tst-password-hint"
                  className="tst-error"
                  style={{ color: "var(--sokrat-fg3)" }}
                >
                  Минимум 8 символов, заглавная буква и цифра
                </span>
              )}
            </div>

            <div className="tst-field">
              <label className="tst-label" htmlFor="tst-subject">
                Какой предмет вы преподаёте?
              </label>
              <select
                id="tst-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value as SubjectValue)}
                onBlur={() => handleBlur("subject")}
                disabled={loading}
                style={inputBaseStyle}
                className="tst-select"
              >
                {SUBJECT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="submit"
              className="tst-cta"
              disabled={loading || !oferta}
            >
              {loading
                ? "Создаём аккаунт..."
                : isTrialIntent
                  ? "Создать аккаунт и начать trial"
                  : "Создать аккаунт"}
            </button>
          </form>

          <p className="tst-login-link">
            Уже есть аккаунт? <Link to="/login">Войти</Link>
          </p>
        </section>

        {/* Right: value prop */}
        <aside aria-labelledby="tst-value-heading">
          <div className="tst-value-eyebrow">Что включено в trial</div>
          <h2 id="tst-value-heading" className="tst-value-headline">
            Полный AI-доступ — как у платных тарифов. Никаких лимитов.
          </h2>

          <ul className="tst-perks">
            <li className="tst-perk">
              <CheckCircle2 className="tst-perk-icon" size={20} aria-hidden="true" />
              <span>
                <strong>AI-проверка ДЗ</strong> — рукопись, фото, текст
              </span>
            </li>
            <li className="tst-perk">
              <CheckCircle2 className="tst-perk-icon" size={20} aria-hidden="true" />
              <span>
                <strong>Сократовский AI-чат</strong> ведёт ученика без готовых
                ответов
              </span>
            </li>
            <li className="tst-perk">
              <CheckCircle2 className="tst-perk-icon" size={20} aria-hidden="true" />
              <span>
                <strong>Конструктор ДЗ</strong> с привязкой к ФИПИ за 5 минут
              </span>
            </li>
            <li className="tst-perk">
              <CheckCircle2 className="tst-perk-icon" size={20} aria-hidden="true" />
              <span>
                <strong>Отчёты родителям</strong> — авто-генерация по итогам
                недели
              </span>
            </li>
          </ul>

          <div className="tst-after-box">
            <strong>После 7 дней</strong>
            <p>
              Покажем, что вы получили: сколько ДЗ AI проверил, сколько часов
              сэкономили — и спросим, продолжать ли. Не списываем сами.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
