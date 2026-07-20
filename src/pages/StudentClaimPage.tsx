import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, AlertCircle, Loader2, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/lib/supabaseClient';
import { claimStudentByToken, registerStudent, type ClaimResult } from '@/lib/studentClaimApi';
import { pluralizeRu } from '@/lib/pluralizeRu';
import { InAppBrowserNudge } from '@/components/InAppBrowserNudge';

const TEMP_EMAIL_SUFFIX = '@temp.sokratai.ru';

type Step = 'loading' | 'connected' | 'register' | 'error';

function initials(name: string | null): string {
  if (!name) return 'Р';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const second = parts[1]?.[0] ?? '';
  return (first + second).toUpperCase() || 'Р';
}

/**
 * Онбординг-активация v2 — экран claim ученика (`/c/:token`).
 * Self-contained вне AuthGuard: сам минтит сессию через student-claim, затем
 * проводит две стадии — «подключён» (A) → регистрация (B) → задача.
 */
export default function StudentClaimPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>('loading');
  const [result, setResult] = useState<ClaimResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    (async () => {
      if (!token) {
        setErrorMsg('Код или ссылка недействительны. Попроси у репетитора новый код.');
        setStep('error');
        return;
      }
      try {
        const claim = await claimStudentByToken(token);
        await supabase.auth.setSession({
          access_token: claim.access_token,
          refresh_token: claim.refresh_token,
        });
        setResult(claim);
        // Prefill реального email (temp/фейк → пусто, ученик вводит свой).
        try {
          const { data } = await supabase.auth.getUser();
          const userEmail = data.user?.email ?? '';
          setEmail(userEmail && !userEmail.toLowerCase().endsWith(TEMP_EMAIL_SUFFIX) ? userEmail : '');
        } catch {
          /* prefill best-effort */
        }
        setStep('connected');
      } catch (e) {
        // Токен использован/истёк: если persistent-сессия уже есть — ведём дальше,
        // иначе честная ошибка с фолбэком на новую ссылку.
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          try {
            const { data: u } = await supabase.auth.getUser();
            const userEmail = u.user?.email ?? '';
            setEmail(userEmail && !userEmail.toLowerCase().endsWith(TEMP_EMAIL_SUFFIX) ? userEmail : '');
            const needsRegister = !userEmail || userEmail.toLowerCase().endsWith(TEMP_EMAIL_SUFFIX);
            if (needsRegister) {
              setStep('register');
            } else {
              navigate('/student/schedule', { replace: true });
            }
            return;
          } catch {
            navigate('/student/schedule', { replace: true });
            return;
          }
        }
        setErrorMsg(e instanceof Error ? e.message : 'Не удалось открыть ссылку.');
        setStep('error');
      }
    })();
  }, [token, navigate]);

  const goToTask = () => {
    const p = result?.preview;
    if (p?.entry_task_id) {
      navigate(`/student/homework/${p.assignment_id}/problem/${p.entry_task_id}`, { replace: true });
    } else if (p?.assignment_id) {
      navigate(`/homework/${p.assignment_id}`, { replace: true });
    } else {
      navigate('/student/schedule', { replace: true });
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setErrorMsg('Укажи свою почту.');
      return;
    }
    if (password.length < 6) {
      setErrorMsg('Пароль должен быть не короче 6 символов.');
      return;
    }
    setErrorMsg('');
    setSubmitting(true);
    try {
      await registerStudent(email.trim(), password);
      goToTask();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Не удалось сохранить доступ.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      data-sokrat-mode="student"
      className="flex min-h-screen flex-col items-center justify-center bg-socrat-surface px-4 py-10"
    >
      <div className="mb-6 text-lg font-semibold text-accent">Сократ</div>

      {/* empty:hidden — при null-надже wrapper не оставляет фантомный отступ */}
      <div className="mb-4 w-full max-w-sm empty:hidden">
        <InAppBrowserNudge />
      </div>

      <div className="w-full max-w-sm rounded-xl border border-border bg-white p-6 shadow-sm">
        {step === 'loading' && (
          <div className="flex flex-col items-center gap-3 py-8 text-center text-muted-foreground">
            <Loader2 className="h-7 w-7 animate-spin text-accent" aria-hidden="true" />
            <span className="text-sm">Подключаем тебя…</span>
          </div>
        )}

        {step === 'connected' && (
          <div className="flex flex-col gap-5">
            <div className="flex flex-col items-center gap-2 text-center">
              <CheckCircle2 className="h-10 w-10 text-accent" aria-hidden="true" />
              <div className="text-lg font-semibold">Ты на связи с репетитором</div>
              <div className="flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/10 text-sm font-semibold text-accent">
                  {initials(result?.tutor_name ?? null)}
                </span>
                <span className="font-medium">{result?.tutor_name ?? 'Твой репетитор'}</span>
              </div>
            </div>

            {result?.preview ? (
              <div className="rounded-lg border border-border bg-socrat-surface px-4 py-3 text-center">
                <div className="font-semibold">{result.preview.title}</div>
                <div className="text-sm text-muted-foreground">
                  {result.preview.task_count}{' '}
                  {pluralizeRu(result.preview.task_count, ['задача', 'задачи', 'задач'])}
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-border bg-socrat-surface px-4 py-3 text-center text-sm text-muted-foreground">
                Ты подключён. Задания появятся здесь, как только репетитор их пришлёт.
              </div>
            )}

            <Button className="w-full" onClick={() => setStep('register')} style={{ touchAction: 'manipulation' }}>
              Продолжить
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Остался один шаг — задать пароль, чтобы не потерять прогресс.
            </p>
          </div>
        )}

        {step === 'register' && (
          <form onSubmit={handleRegister} className="flex flex-col gap-4">
            <div className="text-center">
              <div className="text-lg font-semibold">Ещё один шаг</div>
              <p className="mt-1 text-sm text-muted-foreground">
                Задай доступ, чтобы не потерять прогресс и заходить с любого устройства.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="claim_email">Почта</Label>
              <Input
                id="claim_email"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ivan@mail.ru"
                className="text-base"
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="claim_password">Придумай пароль</Label>
              <Input
                id="claim_password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="не короче 6 символов"
                className="text-base"
                required
              />
            </div>

            {errorMsg && <p className="text-sm text-destructive">{errorMsg}</p>}

            <Button type="submit" className="w-full" disabled={submitting} style={{ touchAction: 'manipulation' }}>
              {submitting ? 'Сохраняем…' : 'Сохранить и продолжить'}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Без подтверждения почты — сразу к задаче.
            </p>
            {/* №43 (решение владельца 2026-07-20): шаг пропускаемый — код
                многоразовый, доступ не теряется; надж повторится при следующем
                заходе по коду. */}
            <Button
              type="button"
              variant="ghost"
              className="w-full text-muted-foreground"
              disabled={submitting}
              onClick={goToTask}
              style={{ touchAction: 'manipulation' }}
            >
              Позже — сначала к заданию
            </Button>
          </form>
        )}

        {step === 'error' && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <AlertCircle className="h-9 w-9 text-amber-500" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">{errorMsg}</p>
            <Button variant="outline" className="w-full" onClick={() => navigate('/login', { replace: true })}>
              Войти
            </Button>
            <p className="text-xs text-muted-foreground">
              Нет доступа? Попроси у репетитора код для входа.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
