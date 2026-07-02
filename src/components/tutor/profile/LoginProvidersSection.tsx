import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Send, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { getFunctionsErrorMessage, supabase } from '@/lib/supabaseClient';
import { AUTH_IDENTITIES_KEY, useUserIdentities } from '@/hooks/useUserIdentities';

/**
 * LoginProvidersSection — list of login providers (Google, Telegram) with
 * Привязать / Отвязать affordances on /tutor/profile.
 *
 * Spec:    docs/delivery/features/tutor-profile/spec.md (v0.4 §3 п.5 + §6 + §8 risks)
 * Tasks:   docs/delivery/features/tutor-profile/tasks.md TASK-19
 * Backend: supabase/functions/tutor-account/index.ts (action `unlink-identity`)
 *
 * Last-identity guard is enforced in TWO places:
 *   1. UI — «Отвязать» button is disabled when removing the provider would
 *      leave the user with no other login method.
 *   2. Server — `tutor-account` action `unlink-identity` re-validates and
 *      returns 400 LAST_IDENTITY if the UI guard is bypassed (DevTools fetch).
 *
 * Telegram in this project is a CUSTOM flow (deep-link bot login → Supabase
 * session via verifyOtp magic-link). It does NOT register a Supabase
 * identity — canonical signal for "is Telegram linked" is
 * `profiles.telegram_user_id`. Link/unlink for Telegram from this surface is
 * deferred to Phase 5 (separate spec); rendered as disabled rows with a TODO
 * tooltip below.
 */

type Provider = 'google' | 'telegram';

interface ProfileTelegramRow {
  telegram_user_id: number | null;
  telegram_username: string | null;
}

/**
 * `embedded` (2026-07-02): при true рендерится БЕЗ собственной карточки и с
 * подзаголовком h3 — для объединённой карточки «Вход и безопасность»
 * (AccountSecuritySection). Логика привязки провайдеров неизменна.
 */
export function LoginProvidersSection({ embedded = false }: { embedded?: boolean } = {}) {
  const { hasEmailPassword, hasGoogle, identities, isLoading: identitiesLoading } =
    useUserIdentities();
  const queryClient = useQueryClient();

  // Telegram presence — read from profiles since it isn't a Supabase identity.
  const [telegramRow, setTelegramRow] = useState<ProfileTelegramRow | null>(null);
  const [isLoadingTelegram, setIsLoadingTelegram] = useState(true);

  // Confirm dialog + in-flight state.
  const [unlinkConfirm, setUnlinkConfirm] = useState<Provider | null>(null);
  const [unlinking, setUnlinking] = useState(false);
  const [linkingGoogle, setLinkingGoogle] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session?.user) {
          if (!cancelled) setIsLoadingTelegram(false);
          return;
        }
        const { data: row } = await supabase
          .from('profiles')
          .select('telegram_user_id, telegram_username')
          .eq('id', session.user.id)
          .maybeSingle();
        if (cancelled) return;
        setTelegramRow({
          telegram_user_id: row?.telegram_user_id ?? null,
          telegram_username: row?.telegram_username ?? null,
        });
      } finally {
        if (!cancelled) setIsLoadingTelegram(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-fetch identities after auth state changes — covers the case where the
  // user just returned from a `linkIdentity` OAuth round-trip and Supabase
  // emitted USER_UPDATED. Without this the section would show stale state
  // until staleTime (60s) expires.
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'USER_UPDATED' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        void queryClient.invalidateQueries({ queryKey: AUTH_IDENTITIES_KEY });
      }
    });
    return () => data.subscription.unsubscribe();
  }, [queryClient]);

  const isLoading = identitiesLoading || isLoadingTelegram;

  const telegramLinked = Boolean(telegramRow?.telegram_user_id);
  // Total login methods include Supabase identities + Telegram custom flow.
  // Used by the UI last-identity guard. Server re-validates independently.
  const totalLoginMethods = identities.length + (telegramLinked ? 1 : 0);

  // Email/password is treated as a permanent fallback for the unlink guard:
  // even if the user has only google+email and unlinks google, email
  // identity remains and login by email/password works. Same on the server.
  const canUnlinkGoogle = hasGoogle && (totalLoginMethods > 1 || hasEmailPassword);

  // Email displayed under the Google row when linked, for clarity (so the
  // user can tell which Google account is wired in). identity_data is typed
  // as Record<string, any> on Supabase identities; narrow defensively.
  const googleIdentity = identities.find((identity) => identity.provider === 'google');
  const googleIdentityEmail =
    googleIdentity && typeof googleIdentity.identity_data?.email === 'string'
      ? (googleIdentity.identity_data.email as string)
      : null;

  const handleLinkGoogle = async () => {
    if (linkingGoogle) return;
    setLinkingGoogle(true);
    // Stash return path — the same convention used elsewhere in the codebase
    // (TASK-17, GoogleAuthButton). Some landing pages read this on mount.
    try {
      localStorage.setItem('oauth_return_to', '/tutor/profile');
    } catch {
      // Private mode / disabled storage — best-effort, don't block.
    }
    try {
      const { error } = await supabase.auth.linkIdentity({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/tutor/profile`,
        },
      });
      if (error) throw error;
      // Browser is now navigating to Google; nothing more to do.
    } catch (err) {
      // KNOWN LIMITATION: native `linkIdentity` forces redirect_uri to
      // `<project>.supabase.co/auth/v1/callback`, which is RU-blocked. For RU
      // users this flow fails at the Supabase callback step. Custom RU-bypass
      // (extending `oauth-google-init` with `mode=link`) is deferred work —
      // see docs/delivery/features/tutor-profile/tasks.md TASK-19 ⚠️.
      console.error('linkIdentity google failed', err);
      toast.error('Не удалось войти через Google. Попробуй позже.');
      setLinkingGoogle(false);
    }
  };

  const requestUnlink = (provider: Provider) => {
    setUnlinkConfirm(provider);
  };

  const cancelUnlink = () => {
    if (unlinking) return;
    setUnlinkConfirm(null);
  };

  const handleConfirmUnlink = async () => {
    if (!unlinkConfirm) return;
    if (unlinkConfirm !== 'google') {
      // Telegram unlink is Phase 5 — UI shouldn't allow this branch.
      setUnlinkConfirm(null);
      return;
    }
    setUnlinking(true);
    try {
      const { data: response, error } = await supabase.functions.invoke('tutor-account', {
        body: { action: 'unlink-identity', provider: unlinkConfirm },
      });
      if (error) throw error;
      if (response && typeof response === 'object' && 'error' in response && response.error) {
        throw new Error(
          typeof response.error === 'string' ? response.error : 'Не удалось отвязать',
        );
      }
      toast.success('Google отвязан');
      await queryClient.invalidateQueries({ queryKey: AUTH_IDENTITIES_KEY });
      setUnlinkConfirm(null);
    } catch (err) {
      toast.error(await getFunctionsErrorMessage(err, 'Не удалось отвязать'));
    } finally {
      setUnlinking(false);
    }
  };

  const Wrapper = embedded ? 'div' : 'section';
  return (
    <Wrapper
      aria-labelledby={embedded ? undefined : 'tutor-login-providers-heading'}
      className={embedded ? undefined : 'rounded-lg border border-border bg-card p-4 sm:p-6'}
    >
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-slate-500" aria-hidden="true" />
        {embedded ? (
          <h3 className="text-sm font-semibold text-slate-900">Способы входа</h3>
        ) : (
          <h2
            id="tutor-login-providers-heading"
            className="text-[14px] font-semibold text-slate-900"
          >
            Способы входа
          </h2>
        )}
      </div>
      <p className="mt-1 text-sm text-slate-500">
        Привяжи Google или Telegram, чтобы заходить без email и пароля.
      </p>

      {isLoading ? (
        <div className="mt-6 flex flex-col gap-3" aria-busy="true" aria-live="polite">
          <div className="h-12 rounded-md bg-slate-100" />
          <div className="h-12 rounded-md bg-slate-100" />
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-3">
          <ProviderRow
            icon={<GoogleIcon />}
            name="Google"
            subtitle={googleIdentityEmail ?? undefined}
            linked={hasGoogle}
            renderAction={() => {
              if (hasGoogle) {
                if (!canUnlinkGoogle) {
                  return (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled
                      className="min-h-[44px]"
                      title="Сначала установи пароль или привяжи другой способ входа."
                      aria-label="Отвязать Google недоступно — нет другого способа войти"
                    >
                      Отвязать
                    </Button>
                  );
                }
                return (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => requestUnlink('google')}
                    className="min-h-[44px] text-red-700 hover:bg-red-50 hover:text-red-800"
                  >
                    Отвязать
                  </Button>
                );
              }
              return (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleLinkGoogle}
                  disabled={linkingGoogle}
                  className="min-h-[44px] gap-2"
                >
                  {linkingGoogle && (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  )}
                  Привязать
                </Button>
              );
            }}
          />

          {/*
            Telegram row — read-only status today. Linking and unlinking from
            the profile surface is Phase 5 work (separate spec). Reasons:
              - Telegram is not a Supabase identity in this project; current
                TelegramLoginButton flow targets login pages, not in-profile
                linking. Wiring it here would duplicate the deep-link plumbing
                in a non-trivial way (token, polling, /tutor/profile return).
              - Unlinking would mean clearing profiles.telegram_user_id and
                potentially revoking bot-side state — needs deliberate spec.
            Show the row so the section is informative; both buttons disabled
            with a TODO tooltip pointing at Phase 5.
          */}
          <ProviderRow
            icon={<TelegramIcon />}
            name="Telegram"
            subtitle={
              telegramRow?.telegram_username ? `@${telegramRow.telegram_username}` : undefined
            }
            linked={telegramLinked}
            renderAction={() => (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled
                className="min-h-[44px]"
                title="Скоро будет доступно"
                aria-label={
                  telegramLinked
                    ? 'Отвязать Telegram — скоро будет доступно'
                    : 'Привязать Telegram — скоро будет доступно'
                }
              >
                {telegramLinked ? 'Отвязать' : 'Привязать'}
              </Button>
            )}
          />
        </div>
      )}

      <AlertDialog
        open={unlinkConfirm !== null}
        onOpenChange={(open) => {
          if (!open) cancelUnlink();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Отвязать {unlinkConfirm === 'google' ? 'Google' : 'Telegram'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {buildUnlinkDescription({
                provider: unlinkConfirm,
                hasEmailPassword,
                telegramLinked,
                hasGoogle,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={unlinking}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleConfirmUnlink();
              }}
              disabled={unlinking}
              className="gap-2 bg-red-600 text-white hover:bg-red-700"
            >
              {unlinking && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Отвязать
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Wrapper>
  );
}

interface ProviderRowProps {
  icon: React.ReactNode;
  name: string;
  subtitle?: string;
  linked: boolean;
  renderAction: () => React.ReactNode;
}

function ProviderRow({ icon, name, subtitle, linked, renderAction }: ProviderRowProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-white p-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-50">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-900">{name}</span>
          {linked && (
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
              Привязан
            </span>
          )}
        </div>
        {subtitle && <p className="mt-0.5 truncate text-xs text-slate-500">{subtitle}</p>}
      </div>
      {renderAction()}
    </div>
  );
}

interface BuildUnlinkDescriptionInput {
  provider: Provider | null;
  hasEmailPassword: boolean;
  telegramLinked: boolean;
  hasGoogle: boolean;
}

function buildUnlinkDescription(input: BuildUnlinkDescriptionInput): string {
  if (input.provider === 'google') {
    const remainingMethods: string[] = [];
    if (input.hasEmailPassword) remainingMethods.push('email и пароль');
    if (input.telegramLinked) remainingMethods.push('Telegram');
    if (remainingMethods.length === 0) {
      return 'У тебя не останется других способов входа. Сначала установи пароль или привяжи Telegram.';
    }
    return `Ты сможешь войти только через ${remainingMethods.join(' или ')}.`;
  }
  return 'Скоро будет доступно.';
}

/**
 * Inline 4-color Google G mark — mirrors src/components/GoogleAuthButton.tsx
 * and src/components/tutor/profile/SecuritySection.tsx::GoogleProviderPill so
 * the Google identity affordance is visually consistent across surfaces.
 */
function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 18 18" aria-hidden="true">
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
  );
}

function TelegramIcon() {
  return (
    <Send className="h-5 w-5 text-socrat-telegram" aria-hidden="true" />
  );
}

export default LoginProvidersSection;
