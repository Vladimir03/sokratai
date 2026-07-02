import { useEffect, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, KeyRound, Loader2, Mail, Send } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getFunctionsErrorMessage, supabase } from '@/lib/supabaseClient';
import { AUTH_IDENTITIES_KEY, useUserIdentities } from '@/hooks/useUserIdentities';

/**
 * SecuritySection — email/password/Telegram block on /tutor/profile.
 *
 * Spec:    docs/delivery/features/tutor-profile/spec.md (v0.4 §3 п.5 + §6)
 * Tasks:   docs/delivery/features/tutor-profile/tasks.md TASK-12 (state A) + TASK-18 (states B, C)
 * Backend: supabase/functions/tutor-account/index.ts (TASK-11 + TASK-18 partial:
 *          set-password-google-only)
 *
 * Three rendering states based on `auth.identities`:
 *   A — email/password only        → email row editable + password row editable
 *   B — google-only                → email row read-only with «Google» pill,
 *                                    password row OMITTED FROM DOM,
 *                                    amber «Установить пароль» CTA renders instead
 *   C — mixed (email + google)     → like A, plus confirm dialog before email change
 *                                    (warning that next Google sign-in will overwrite)
 *
 * Telegram row (read-only) always shown, independent of state — Telegram in this
 * project is a custom flow, not a Supabase identity (see useUserIdentities).
 */

interface SecurityData {
  email: string;
  telegram_username: string | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

type AuthState = 'A' | 'B' | 'C' | 'unknown';

/**
 * `embedded` (2026-07-02): при true рендерится БЕЗ собственной карточки и с
 * подзаголовком h3 «Почта и пароль» — для объединённой карточки «Вход и
 * безопасность» (AccountSecuritySection). Вся auth-логика неизменна.
 */
export function SecuritySection({ embedded = false }: { embedded?: boolean } = {}) {
  const [data, setData] = useState<SecurityData | null>(null);
  const [isLoadingData, setIsLoadingData] = useState(true);

  const {
    hasEmailPassword,
    hasGoogle,
    isLoading: identitiesLoading,
  } = useUserIdentities();
  const queryClient = useQueryClient();

  // Email edit state.
  const [emailEditing, setEmailEditing] = useState(false);
  const [emailDraft, setEmailDraft] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);

  // Password edit state (states A and C).
  const [passwordEditing, setPasswordEditing] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  // Set-password-google-only state (state B → C transition).
  const [establishPwdEditing, setEstablishPwdEditing] = useState(false);
  const [establishPwdNew, setEstablishPwdNew] = useState('');
  const [establishPwdConfirm, setEstablishPwdConfirm] = useState('');
  const [savingEstablishPwd, setSavingEstablishPwd] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        // getSession() reads in-memory cache (no network). performance.md §2a.
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session?.user) {
          if (!cancelled) setIsLoadingData(false);
          return;
        }

        const email = session.user.email ?? '';

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
        if (!cancelled) setIsLoadingData(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Compute UI state from identities. Default to 'A' for the legacy / no-
  // identities edge case so the existing flow keeps working — Google OAuth
  // is opt-in.
  const authState: AuthState = identitiesLoading
    ? 'unknown'
    : hasEmailPassword && !hasGoogle
      ? 'A'
      : !hasEmailPassword && hasGoogle
        ? 'B'
        : hasEmailPassword && hasGoogle
          ? 'C'
          : 'A';

  const isLoading = isLoadingData || identitiesLoading;

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

    // State C: warn that Google sign-in will overwrite the email back. Native
    // window.confirm — pragmatic for an edge case that few mixed-state users
    // will hit; not worth a Radix AlertDialog dependency.
    if (authState === 'C') {
      const confirmed = window.confirm(
        'Email изменится на твой, но при следующем входе через Google он перепишется обратно. Точно изменить?',
      );
      if (!confirmed) return;
    }

    setSavingEmail(true);
    try {
      const { data: response, error } = await supabase.functions.invoke('tutor-account', {
        body: { action: 'update-email', email: normalized },
      });
      if (error) throw error;
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
      if (response && typeof response === 'object' && 'error' in response && response.error) {
        throw new Error(
          typeof response.error === 'string' ? response.error : 'Не удалось обновить пароль',
        );
      }

      toast.success('Пароль обновлён');
      setPasswordEditing(false);
      setNewPassword('');
      setConfirmPassword('');
      // Intentionally NOT invalidating ['auth','identities'] — update-password
      // does not change the identities array (state A/C user already has an
      // `email` identity). See useUserIdentities and TASK-18 guardrails.
    } catch (err) {
      toast.error(await getFunctionsErrorMessage(err, 'Не удалось обновить пароль'));
    } finally {
      setSavingPassword(false);
    }
  };

  const startSetPassword = () => {
    setEstablishPwdEditing(true);
    setEstablishPwdNew('');
    setEstablishPwdConfirm('');
  };

  const cancelSetPassword = () => {
    setEstablishPwdEditing(false);
    setEstablishPwdNew('');
    setEstablishPwdConfirm('');
  };

  const handleSubmitSetPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (establishPwdNew.length < MIN_PASSWORD_LENGTH) {
      toast.error(`Пароль должен содержать минимум ${MIN_PASSWORD_LENGTH} символов`);
      return;
    }
    if (establishPwdNew !== establishPwdConfirm) {
      toast.error('Пароли не совпадают');
      return;
    }

    setSavingEstablishPwd(true);
    try {
      const { data: response, error } = await supabase.functions.invoke('tutor-account', {
        body: { action: 'set-password-google-only', password: establishPwdNew },
      });
      if (error) throw error;
      if (response && typeof response === 'object' && 'error' in response && response.error) {
        throw new Error(
          typeof response.error === 'string' ? response.error : 'Не удалось установить пароль',
        );
      }

      toast.success('Пароль установлен');
      setEstablishPwdEditing(false);
      setEstablishPwdNew('');
      setEstablishPwdConfirm('');
      // set-password-google-only DOES create a new `email` identity
      // server-side → invalidate so the section re-renders in state C.
      await queryClient.invalidateQueries({ queryKey: AUTH_IDENTITIES_KEY });
    } catch (err) {
      toast.error(await getFunctionsErrorMessage(err, 'Не удалось установить пароль'));
    } finally {
      setSavingEstablishPwd(false);
    }
  };

  const renderEmailRowActions = () => {
    if (emailEditing || isLoading) return null;
    if (authState === 'B') return <GoogleProviderPill />;
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={startEditEmail}
        className="min-h-[44px]"
      >
        Изменить
      </Button>
    );
  };

  const Wrapper = embedded ? 'div' : 'section';
  return (
    <Wrapper
      aria-labelledby={embedded ? undefined : 'tutor-security-heading'}
      className={embedded ? undefined : 'rounded-lg border border-border bg-card p-4 sm:p-6'}
    >
      {embedded ? (
        <h3 className="text-sm font-semibold text-slate-900">Почта и пароль</h3>
      ) : (
        <h2 id="tutor-security-heading" className="text-lg font-semibold text-slate-900">
          Безопасность
        </h2>
      )}
      <p className="mt-1 text-sm text-slate-500">
        Email для входа и пароль. Telegram показан, если он привязан к аккаунту.
      </p>

      {isLoading ? (
        <div className="mt-6 flex flex-col gap-6" aria-busy="true" aria-live="polite">
          <div className="h-10 rounded-md bg-slate-100" />
          <div className="h-10 rounded-md bg-slate-100" />
          <div className="h-10 rounded-md bg-slate-100" />
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          {/* Email row — always rendered, but right-side action varies by state. */}
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-start gap-3">
              <Mail className="mt-1 h-5 w-5 shrink-0 text-slate-500" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-700">Email</p>
                <p className="mt-1 break-all text-sm text-slate-900">
                  {data?.email || 'Не задан'}
                </p>
              </div>
              {renderEmailRowActions()}
            </div>

            {emailEditing && authState !== 'B' && (
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

          {/* Password row — states A and C only. In state B this is intentionally
              omitted from the DOM (not rendered hidden) so AT doesn't read an
              empty field. The amber «Установить пароль» CTA below replaces it. */}
          {(authState === 'A' || authState === 'C') && (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-start gap-3">
                <KeyRound
                  className="mt-1 h-5 w-5 shrink-0 text-slate-500"
                  aria-hidden="true"
                />
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
                <form
                  onSubmit={handleSubmitPassword}
                  className="flex flex-col gap-3 sm:pl-8"
                >
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
          )}

          {/* State B only: amber «Установить пароль» CTA. Calls the
              set-password-google-only edge action; on success a new `email`
              identity is created server-side, query invalidates, this branch
              is replaced by the password row above. */}
          {authState === 'B' && (
            <div className="flex flex-col gap-3 rounded-md border border-amber-200 bg-amber-50 p-4">
              <div className="flex flex-wrap items-start gap-3">
                <AlertTriangle
                  className="mt-0.5 h-5 w-5 shrink-0 text-amber-600"
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-amber-900">
                    Пароль не задан
                  </p>
                  <p className="mt-1 text-sm text-amber-800">
                    Без него ты сможешь войти только через Google.
                  </p>
                </div>
                {!establishPwdEditing && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={startSetPassword}
                    className="min-h-[44px] text-amber-900 hover:bg-amber-100 hover:text-amber-900"
                  >
                    Установить пароль
                  </Button>
                )}
              </div>

              {establishPwdEditing && (
                <form
                  onSubmit={handleSubmitSetPassword}
                  className="flex flex-col gap-3 sm:pl-8"
                >
                  <div className="flex flex-col gap-2">
                    <Label
                      htmlFor="tutor-security-set-password-new"
                      className="text-sm font-medium text-amber-900"
                    >
                      Новый пароль
                    </Label>
                    <Input
                      id="tutor-security-set-password-new"
                      type="password"
                      value={establishPwdNew}
                      onChange={(event) => setEstablishPwdNew(event.target.value)}
                      autoComplete="new-password"
                      minLength={MIN_PASSWORD_LENGTH}
                      required
                      disabled={savingEstablishPwd}
                      className="min-h-[44px] text-base"
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label
                      htmlFor="tutor-security-set-password-confirm"
                      className="text-sm font-medium text-amber-900"
                    >
                      Повторите пароль
                    </Label>
                    <Input
                      id="tutor-security-set-password-confirm"
                      type="password"
                      value={establishPwdConfirm}
                      onChange={(event) => setEstablishPwdConfirm(event.target.value)}
                      autoComplete="new-password"
                      minLength={MIN_PASSWORD_LENGTH}
                      required
                      disabled={savingEstablishPwd}
                      className="min-h-[44px] text-base"
                    />
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button
                      type="submit"
                      disabled={savingEstablishPwd}
                      className="min-h-[44px] gap-2 bg-accent text-white hover:bg-accent/90"
                    >
                      {savingEstablishPwd && (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      )}
                      Сохранить
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={cancelSetPassword}
                      disabled={savingEstablishPwd}
                      className="min-h-[44px] text-amber-900 hover:bg-amber-100 hover:text-amber-900"
                    >
                      Отмена
                    </Button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* Telegram row (read-only) — independent of auth state. */}
          <div className="flex items-start gap-3">
            <Send className="mt-1 h-5 w-5 shrink-0 text-slate-500" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-700">Telegram</p>
              <p className="mt-1 text-sm text-slate-900">
                {data?.telegram_username ? `@${data.telegram_username}` : 'Не привязан'}
              </p>
            </div>
          </div>
        </div>
      )}
    </Wrapper>
  );
}

/**
 * Inline 4-color Google G mark + text. Mirrors the `<svg>` in
 * src/components/GoogleAuthButton.tsx so the «провайдер управляет email»
 * signal is visually consistent across login and profile surfaces.
 */
function GoogleProviderPill() {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700"
      aria-label="Email управляется Google"
      title="Email управляется Google"
    >
      <svg width="12" height="12" viewBox="0 0 18 18" aria-hidden="true">
        <path
          fill="#4285F4"
          d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
        />
        <path
          fill="#34A853"
          d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
        />
        <path
          fill="#FBBC05"
          d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z"
        />
        <path
          fill="#EA4335"
          d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.167 6.656 3.58 9 3.58z"
        />
      </svg>
      Google
    </span>
  );
}

export default SecuritySection;
