import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft, Eye, EyeOff } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { claimInvite } from '@/lib/inviteApi';
import YandexAuthButton from '@/components/YandexAuthButton';
import VkAuthButton from '@/components/VkAuthButton';
import { z } from 'zod';

interface TutorInfo {
  id: string;
  name: string;
  invite_code: string;
}

const signupSchema = z.object({
  studentName: z.string().trim().min(2, { message: 'Минимум 2 символа' }),
  email: z.string().trim().email({ message: 'Неверный формат email' }).max(255),
  password: z.string()
    .min(8, { message: 'Минимум 8 символов' })
    .regex(/[A-Z]/, { message: 'Нужна хотя бы одна заглавная буква' })
    .regex(/[0-9]/, { message: 'Нужна хотя бы одна цифра' }),
});

const loginSchema = z.object({
  email: z.string().trim().email({ message: 'Неверный формат email' }).max(255),
  password: z.string().min(1, { message: 'Введите пароль' }),
});

export default function InvitePage() {
  const { inviteCode } = useParams<{ inviteCode: string }>();
  const navigate = useNavigate();

  const [tutor, setTutor] = useState<TutorInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [isLogin, setIsLogin] = useState(false);
  const [studentName, setStudentName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Success state
  const [authSuccess, setAuthSuccess] = useState(false);
  const [claimedTutorName, setClaimedTutorName] = useState<string | null>(null);
  const [needsEmailConfirm, setNeedsEmailConfirm] = useState(false);

  // Existing-session state (one-click claim for already-logged-in students).
  // Without this a registered student scanning a tutor's QR saw only the
  // signup form and was never linked (bug 2026-07-14).
  const [session, setSession] = useState<Session | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [isTutorAccount, setIsTutorAccount] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function checkSession() {
      try {
        const { data: { session: existing } } = await supabase.auth.getSession();
        if (cancelled) return;
        if (existing) {
          setSession(existing);
          // Role check for UX only (hide the claim button from tutors). The
          // authoritative gate is server-side: claim-invite returns 403
          // TUTOR_ACCOUNT for tutor accounts. NB: supabase.rpc returns
          // { data, error } — it does NOT throw, so check error explicitly
          // (P1 review 2026-07-14: silent error read as "student").
          const { data: isTutor, error: roleError } = await supabase.rpc('is_tutor', {
            _user_id: existing.user.id,
          });
          if (!cancelled && !roleError) setIsTutorAccount(Boolean(isTutor));
          // roleError → leave isTutorAccount=false; a tutor clicking the
          // button gets the server's 403 with the same message.
        }
      } catch {
        // getSession failure → fall through to the anonymous form
      } finally {
        if (!cancelled) setSessionChecked(true);
      }
    }

    checkSession();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function fetchTutor() {
      // Reset for param-only navigation (component not remounted).
      setLoading(true);
      setError(null);
      setTutor(null);

      if (!inviteCode) {
        setError('Неверная ссылка');
        setLoading(false);
        return;
      }

      try {
        const { data, error: fetchError } = await supabase
          .from('tutors')
          .select('id, name, invite_code')
          .eq('invite_code', inviteCode)
          .single();

        if (cancelled) return;

        if (fetchError || !data) {
          setError('Ссылка недействительна или устарела');
          setLoading(false);
          return;
        }

        setTutor(data);
      } catch {
        if (!cancelled) setError('Ошибка при загрузке');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchTutor();
    return () => { cancelled = true; };
  }, [inviteCode]);

  // №79 (2026-07-20): персист инвайта ДО OAuth-редиректа. Кнопки Яндекс/VK
  // уводят через window.location.href — inline-claim не успевает; после возврата
  // (#access_token → /student/schedule) AuthGuard зовёт claimPendingInvite() из
  // localStorage. Идемпотентно: успешный inline-claim/деферред-пути сами чистят
  // ключ; claim-invite при повторе отвечает already_linked (успех).
  useEffect(() => {
    if (sessionChecked && !session && tutor && inviteCode) {
      localStorage.setItem('pending_invite_code', inviteCode);
    }
  }, [sessionChecked, session, tutor, inviteCode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);

    try {
      if (isLogin) {
        // Login flow
        const validation = loginSchema.safeParse({ email, password });
        if (!validation.success) {
          setFormError(validation.error.errors[0].message);
          setSubmitting(false);
          return;
        }

        const { data: loginData, error: authError } = await supabase.auth.signInWithPassword({
          email: validation.data.email,
          password: validation.data.password,
        });

        if (authError) {
          if (authError.message === 'Invalid login credentials') {
            setFormError('Неверный email или пароль');
          } else {
            setFormError(authError.message);
          }
          setSubmitting(false);
          return;
        }

        if (!loginData.session) {
          setFormError('Не удалось войти. Попробуйте ещё раз.');
          setSubmitting(false);
          return;
        }
      } else {
        // Signup flow
        const validation = signupSchema.safeParse({ studentName, email, password });
        if (!validation.success) {
          setFormError(validation.error.errors[0].message);
          setSubmitting(false);
          return;
        }

        const { data: signUpData, error: authError } = await supabase.auth.signUp({
          email: validation.data.email,
          password: validation.data.password,
          options: {
            emailRedirectTo: `${window.location.origin}/homework`,
            data: { username: validation.data.studentName, full_name: validation.data.studentName },
          },
        });

        if (authError) {
          if (authError.message.includes('already registered')) {
            // Keep the invite for the deferred claim (AuthGuard/Login run
            // claimPendingInvite after auth) and steer to the login form.
            if (inviteCode) localStorage.setItem('pending_invite_code', inviteCode);
            setIsLogin(true);
            setFormError('Этот email уже зарегистрирован. Войдите — репетитор подключится автоматически.');
          } else {
            setFormError(authError.message);
          }
          setSubmitting(false);
          return;
        }

        // Supabase may return user but no session if email confirmation is on,
        // or if the email is already taken (masked as success for security).
        // Detect fake signup: identities array is empty → email already exists.
        if (signUpData.user && (!signUpData.user.identities || signUpData.user.identities.length === 0)) {
          if (inviteCode) localStorage.setItem('pending_invite_code', inviteCode);
          setIsLogin(true);
          setFormError('Этот email уже зарегистрирован. Войдите — репетитор подключится автоматически.');
          setSubmitting(false);
          return;
        }

        if (!signUpData.session) {
          // Email confirmation required — save invite code and show confirmation message
          if (inviteCode) {
            localStorage.setItem('pending_invite_code', inviteCode);
          }
          setNeedsEmailConfirm(true);
          setSubmitting(false);
          return;
        }
      }

      // Auth succeeded — claim invite immediately
      if (inviteCode) {
        try {
          const result = await claimInvite(inviteCode);
          setClaimedTutorName(result.tutor_name);
          localStorage.removeItem('pending_invite_code');
        } catch {
          // Claim failed — save to localStorage as fallback for next login
          localStorage.setItem('pending_invite_code', inviteCode);
        }
      }

      setAuthSuccess(true);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Произошла ошибка');
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoToHomework = () => {
    navigate('/homework');
  };

  // One-click claim for an already-logged-in (non-tutor) account.
  const handleClaimWithSession = async () => {
    if (!inviteCode) return;
    setClaimError(null);
    setClaiming(true);
    try {
      const result = await claimInvite(inviteCode); // 'linked' | 'already_linked' — both success
      localStorage.removeItem('pending_invite_code');
      setClaimedTutorName(result.tutor_name);
      setAuthSuccess(true);
    } catch (err: unknown) {
      const status = (err as { context?: { status?: number } })?.context?.status;
      if (status === 401) {
        // Stale session — fall back to the login/signup form.
        setSession(null);
        return;
      }
      if (status === 403) {
        // Server-side tutor gate (claim-invite TUTOR_ACCOUNT) — the client
        // role check is best-effort, this is the authoritative answer.
        setIsTutorAccount(true);
        setClaimError(null);
        return;
      }
      if (status === 400) {
        setClaimError('Не удалось подключиться по этой ссылке. Проверьте, что это ссылка вашего репетитора.');
      } else if (status === 404) {
        setClaimError('Ссылка недействительна или устарела. Попросите у репетитора новую.');
      } else {
        setClaimError('Не удалось подключиться. Проверьте интернет и попробуйте ещё раз.');
      }
    } finally {
      setClaiming(false);
    }
  };

  const handleSignOutToForm = async () => {
    try {
      await supabase.auth.signOut();
    } catch {
      // best-effort
    }
    setSession(null);
    setIsTutorAccount(false);
    setClaimError(null);
  };

  // Loading state
  if (loading || !sessionChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-background to-muted/30 p-4">
        <Card className="w-full max-w-md" animate={false}>
          <CardHeader className="text-center">
            <Skeleton className="h-8 w-48 mx-auto mb-2" />
            <Skeleton className="h-4 w-64 mx-auto" />
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-12 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  // Error state
  if (error || !tutor) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-background to-muted/30 p-4">
        <Card className="w-full max-w-md text-center" animate={false}>
          <CardHeader>
            <CardTitle className="text-destructive">Ошибка</CardTitle>
            <CardDescription>{error || 'Репетитор не найден'}</CardDescription>
          </CardHeader>
          <CardContent>
            <Link to="/students">
              <Button variant="outline" style={{ touchAction: 'manipulation' }}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                На главную
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Email confirmation required state
  if (needsEmailConfirm) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-background to-muted/30 p-4">
        <Card className="w-full max-w-md text-center" animate={false}>
          <CardHeader>
            <CardTitle className="text-xl">Проверьте почту</CardTitle>
            <CardDescription>
              Мы отправили письмо на <strong>{email}</strong>.
              Перейдите по ссылке в письме, чтобы завершить регистрацию.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Репетитор {tutor.name} будет подключён после входа в систему
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Success state — auth completed with session
  if (authSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-background to-muted/30 p-4">
        <Card className="w-full max-w-md text-center" animate={false}>
          <CardHeader>
            <div className="text-4xl mb-3">&#10003;</div>
            <CardTitle className="text-xl">
              {claimedTutorName
                ? `Вы привязаны к репетитору ${claimedTutorName}`
                : isLogin ? 'Вы вошли в систему' : 'Регистрация прошла успешно'
              }
            </CardTitle>
            {!claimedTutorName && (
              <CardDescription>
                Подключение к репетитору {tutor.name} произойдёт автоматически
              </CardDescription>
            )}
          </CardHeader>
          <CardContent>
            <Button
              onClick={handleGoToHomework}
              className="w-full"
              size="lg"
              style={{ touchAction: 'manipulation' }}
            >
              Перейти к домашним заданиям
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Logged-in variant — one-click claim (no re-registration).
  if (session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-background to-muted/30 p-4">
        <Card className="w-full max-w-md text-center" animate={false}>
          <CardHeader>
            <CardTitle className="text-xl">
              Вас пригласил репетитор {tutor.name}
            </CardTitle>
            <CardDescription>
              Вы вошли как <strong>{session.user.email ?? 'ваш аккаунт'}</strong>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isTutorAccount ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Вы вошли как репетитор. Чтобы принять приглашение, войдите в
                  аккаунт ученика.
                </p>
                <Button
                  onClick={handleSignOutToForm}
                  className="w-full"
                  size="lg"
                  style={{ touchAction: 'manipulation' }}
                >
                  Выйти и войти как ученик
                </Button>
              </>
            ) : (
              <>
                <Button
                  onClick={handleClaimWithSession}
                  className="w-full"
                  size="lg"
                  disabled={claiming}
                  style={{ touchAction: 'manipulation' }}
                >
                  {claiming ? 'Подключение...' : `Присоединиться к репетитору ${tutor.name}`}
                </Button>
                {claimError && (
                  <p className="text-sm text-destructive">{claimError}</p>
                )}
                <button
                  type="button"
                  onClick={handleSignOutToForm}
                  className="text-sm text-muted-foreground hover:underline"
                  style={{ touchAction: 'manipulation' }}
                >
                  Это не мой аккаунт — выйти
                </button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-background to-muted/30 p-4">
      <Card className="w-full max-w-md" animate={false}>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">
            Вас пригласил репетитор {tutor.name}
          </CardTitle>
          <CardDescription>
            {isLogin
              ? 'Войдите, чтобы подключиться к репетитору'
              : 'Зарегистрируйтесь, чтобы получать домашние задания'}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-5">
          {/* Auth form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {!isLogin && (
              <Input
                type="text"
                placeholder="Ваше имя"
                value={studentName}
                onChange={(e) => setStudentName(e.target.value)}
                required
                disabled={submitting}
                autoComplete="name"
              />
            )}
            <Input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={submitting}
              autoComplete="email"
            />
            <div className="relative">
              <Input
                type={showPassword ? 'text' : 'password'}
                placeholder={isLogin ? 'Пароль' : 'Пароль (мин. 8 символов, заглавная, цифра)'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={submitting}
                autoComplete={isLogin ? 'current-password' : 'new-password'}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                tabIndex={-1}
                style={{ touchAction: 'manipulation' }}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>

            {formError && (
              <div className="text-sm text-destructive">
                <p>{formError}</p>
                {formError.includes('уже зарегистрирован') && (
                  <a href="/forgot-password" className="underline text-primary mt-1 inline-block">
                    Восстановить пароль
                  </a>
                )}
              </div>
            )}

            <Button
              type="submit"
              className="w-full"
              size="lg"
              disabled={submitting}
              style={{ touchAction: 'manipulation' }}
            >
              {submitting
                ? (isLogin ? 'Вход...' : 'Регистрация...')
                : (isLogin ? 'Войти' : 'Зарегистрироваться')
              }
            </Button>
          </form>

          {/* Toggle login/signup */}
          <p className="text-center text-sm text-muted-foreground">
            {isLogin ? (
              <>
                Нет аккаунта?{' '}
                <button
                  type="button"
                  onClick={() => { setIsLogin(false); setFormError(null); }}
                  className="text-primary hover:underline"
                  style={{ touchAction: 'manipulation' }}
                >
                  Зарегистрироваться
                </button>
              </>
            ) : (
              <>
                Уже есть аккаунт?{' '}
                <button
                  type="button"
                  onClick={() => { setIsLogin(true); setFormError(null); }}
                  className="text-primary hover:underline"
                  style={{ touchAction: 'manipulation' }}
                >
                  Войти
                </button>
              </>
            )}
          </p>

          {/* Divider */}
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">или</span>
            </div>
          </div>

          {/* №79 (Егор): вход/регистрация через российские сервисы прямо с
              инвайта. Инвайт-код уже в localStorage (persist-эффект выше) —
              после OAuth-возврата AuthGuard дозабирает привязку. */}
          <div className="flex flex-col items-stretch gap-3">
            <YandexAuthButton
              redirectPath="/student/schedule"
              consentSource="yandex-oauth-student"
            />
            <VkAuthButton
              redirectPath="/student/schedule"
              consentSource="vk-oauth-student"
            />
            <p className="text-xs text-center text-muted-foreground leading-relaxed">
              Продолжая, вы соглашаетесь с{' '}
              <Link to="/offer" className="underline hover:text-primary">офертой</Link> и{' '}
              <Link to="/privacy-policy" className="underline hover:text-primary">политикой конфиденциальности</Link>.
            </p>
          </div>

          {/* Footer */}
          <p className="text-xs text-center text-muted-foreground">
            Сократ AI — AI-помощник для подготовки к ЕГЭ и ОГЭ
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
