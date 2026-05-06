import { useEffect, useState, type FormEvent } from 'react';
import { KeyRound, Loader2, Mail, Send } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getFunctionsErrorMessage, supabase } from '@/lib/supabaseClient';

/**
 * SecuritySection — email/password/Telegram block on /tutor/profile.
 *
 * Spec:    docs/delivery/features/tutor-profile/spec.md (v0.3 §6)
 * Tasks:   docs/delivery/features/tutor-profile/tasks.md TASK-12
 * Backend: supabase/functions/tutor-account/index.ts (TASK-11)
 *
 * Email: read-only display + inline form behind «Изменить».
 * Password: collapsed «Изменить пароль» button + 2-input form (new + confirm).
 * Telegram: read-only @username (linking is a separate flow elsewhere).
 *
 * Phase 1 of the spec (v0.3 §3-A). Phase 4 (Google OAuth) will replace this
 * with a 3-state SecuritySection driven by useUserIdentities — see TASK-18.
 */

interface SecurityData {
  email: string;
  telegram_username: string | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

export function SecuritySection() {
  const [data, setData] = useState<SecurityData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Email edit state.
  const [emailEditing, setEmailEditing] = useState(false);
  const [emailDraft, setEmailDraft] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);

  // Password edit state.
  const [passwordEditing, setPasswordEditing] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        // getSession() reads in-memory cache (no network). performance.md §2a.
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session?.user) {
          if (!cancelled) setIsLoading(false);
          return;
        }

        const email = session.user.email ?? '';

        // profiles.telegram_username is the canonical surface for tutor
        // identity in Telegram (mirrors Profile.tsx student variant).
        const { data: profileRow } = await supabase
          .from('profiles')
          .select('telegram_username')
          .eq('id', session.user.id)
          .maybeSingle();

        if (cancelled) return;
        setData({
          email,
          telegram_username: profileRow?.telegram_username ?? null,
        });
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const startEditEmail = () => {
    setEmailDraft(data?.email ?? '');
    setEmailEditing(true);
  };

  const cancelEditEmail = () => {
    setEmailEditing(false);
    setEmailDraft('');
  };

  const handleSubmitEmail = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalized = emailDraft.trim().toLowerCase();

    if (!normalized) {
      toast.error('Введите email');
      return;
    }
    if (!EMAIL_RE.test(normalized)) {
      toast.error('Введите корректный email');
      return;
    }
    if (normalized === (data?.email ?? '').trim().toLowerCase()) {
      toast.info('Этот email уже используется для входа');
      cancelEditEmail();
      return;
    }

    setSavingEmail(true);
    try {
      const { data: response, error } = await supabase.functions.invoke('tutor-account', {
        body: { action: 'update-email', email: normalized },
      });
      if (error) throw error;
      // Supabase Functions sometimes wraps non-2xx errors in `data` (e.g. when the
      // edge function returns 4xx with a JSON body) instead of `error`. Guard
      // against accidentally treating that as success.
      if (response && typeof response === 'object' && 'error' in response && response.error) {
        throw new Error(
          typeof response.error === 'string' ? response.error : 'Не удалось обновить email',
        );
      }

      const updatedEmail = typeof response?.email === 'string' ? response.email : normalized;
      await supabase.auth.refreshSession();
      setData((prev) =>
        prev
          ? { ...prev, email: updatedEmail }
          : { email: updatedEmail, telegram_username: null },
      );
      toast.success('Email обновлён');
      setEmailEditing(false);
      setEmailDraft('');
    } catch (err) {
      toast.error(await getFunctionsErrorMessage(err, 'Не удалось обновить email'));
    } finally {
      setSavingEmail(false);
    }
  };

  const startEditPassword = () => {
    setPasswordEditing(true);
    setNewPassword('');
    setConfirmPassword('');
  };

  const cancelEditPassword = () => {
    setPasswordEditing(false);
    setNewPassword('');
    setConfirmPassword('');
  };

  const handleSubmitPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      toast.error(`Пароль должен содержать минимум ${MIN_PASSWORD_LENGTH} символов`);
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('Пароли не совпадают');
      return;
    }

    setSavingPassword(true);
    try {
      const { data: response, error } = await supabase.functions.invoke('tutor-account', {
        body: { action: 'update-password', password: newPassword },
      });
      if (error) throw error;
      // Same wrapped-error guard as in handleSubmitEmail above. Don't include
      // any password material in error messages — only the server's reason.
      if (response && typeof response === 'object' && 'error' in response && response.error) {
        throw new Error(
          typeof response.error === 'string' ? response.error : 'Не удалось обновить пароль',
        );
      }

      toast.success('Пароль обновлён');
      setPasswordEditing(false);
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      toast.error(await getFunctionsErrorMessage(err, 'Не удалось обновить пароль'));
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <section
      aria-labelledby="tutor-security-heading"
      className="rounded-lg border border-border bg-card p-4 sm:p-6"
    >
      <h2 id="tutor-security-heading" className="text-lg font-semibold text-slate-900">
        Безопасность
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        Email для входа и пароль. Telegram показан, если он привязан к аккаунту.
      </p>

      <div className="mt-6 flex flex-col gap-6">
        {/* Email row */}
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-start gap-3">
            <Mail className="mt-1 h-5 w-5 shrink-0 text-slate-500" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-700">Email</p>
              <p className="mt-1 break-all text-sm text-slate-900">
                {isLoading ? '—' : data?.email || 'Не задан'}
              </p>
            </div>
            {!emailEditing && !isLoading && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={startEditEmail}
                className="min-h-[44px]"
              >
                Изменить
              </Button>
            )}
          </div>

          {emailEditing && (
            <form onSubmit={handleSubmitEmail} className="flex flex-col gap-3 sm:pl-8">
              <div className="flex flex-col gap-2">
                <Label
                  htmlFor="tutor-security-email"
                  className="text-sm font-medium text-slate-700"
                >
                  Новый email
                </Label>
                <Input
                  id="tutor-security-email"
                  type="email"
                  inputMode="email"
                  value={emailDraft}
                  onChange={(event) => setEmailDraft(event.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  required
                  disabled={savingEmail}
                  className="min-h-[44px] text-base"
                />
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  type="submit"
                  disabled={savingEmail}
                  className="min-h-[44px] gap-2 bg-accent text-white hover:bg-accent/90"
                >
                  {savingEmail && (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  )}
                  Сохранить
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={cancelEditEmail}
                  disabled={savingEmail}
                  className="min-h-[44px]"
                >
                  Отмена
                </Button>
              </div>
            </form>
          )}
        </div>

        {/* Password row */}
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-start gap-3">
            <KeyRound className="mt-1 h-5 w-5 shrink-0 text-slate-500" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-700">Пароль</p>
              <p className="mt-1 text-sm text-slate-500">
                Минимум {MIN_PASSWORD_LENGTH} символов.
              </p>
            </div>
            {!passwordEditing && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={startEditPassword}
                className="min-h-[44px]"
              >
                Изменить пароль
              </Button>
            )}
          </div>

          {passwordEditing && (
            <form onSubmit={handleSubmitPassword} className="flex flex-col gap-3 sm:pl-8">
              <div className="flex flex-col gap-2">
                <Label
                  htmlFor="tutor-security-password-new"
                  className="text-sm font-medium text-slate-700"
                >
                  Новый пароль
                </Label>
                <Input
                  id="tutor-security-password-new"
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  autoComplete="new-password"
                  minLength={MIN_PASSWORD_LENGTH}
                  required
                  disabled={savingPassword}
                  className="min-h-[44px] text-base"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label
                  htmlFor="tutor-security-password-confirm"
                  className="text-sm font-medium text-slate-700"
                >
                  Повторите пароль
                </Label>
                <Input
                  id="tutor-security-password-confirm"
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  autoComplete="new-password"
                  minLength={MIN_PASSWORD_LENGTH}
                  required
                  disabled={savingPassword}
                  className="min-h-[44px] text-base"
                />
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  type="submit"
                  disabled={savingPassword}
                  className="min-h-[44px] gap-2 bg-accent text-white hover:bg-accent/90"
                >
                  {savingPassword && (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  )}
                  Сохранить
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={cancelEditPassword}
                  disabled={savingPassword}
                  className="min-h-[44px]"
                >
                  Отмена
                </Button>
              </div>
            </form>
          )}
        </div>

        {/* Telegram row (read-only) */}
        <div className="flex items-start gap-3">
          <Send className="mt-1 h-5 w-5 shrink-0 text-slate-500" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-slate-700">Telegram</p>
            <p className="mt-1 text-sm text-slate-900">
              {isLoading
                ? '—'
                : data?.telegram_username
                  ? `@${data.telegram_username}`
                  : 'Не привязан'}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

export default SecuritySection;
