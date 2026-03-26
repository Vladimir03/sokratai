import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import QRCode from 'react-qr-code';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft, ChevronDown, ChevronUp, Eye, EyeOff } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { getTutorInviteTelegramLink } from '@/utils/telegramLinks';
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
  const [needsEmailConfirm, setNeedsEmailConfirm] = useState(false);

  // Telegram collapsed section
  const [showTelegram, setShowTelegram] = useState(false);

  useEffect(() => {
    async function fetchTutor() {
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

        if (fetchError || !data) {
          setError('Ссылка недействительна или устарела');
          setLoading(false);
          return;
        }

        setTutor(data);
      } catch {
        setError('Ошибка при загрузке');
      } finally {
        setLoading(false);
      }
    }

    fetchTutor();
  }, [inviteCode]);

  const telegramLink = inviteCode ? getTutorInviteTelegramLink(inviteCode) : '';

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
            data: { full_name: validation.data.studentName },
          },
        });

        if (authError) {
          if (authError.message.includes('already registered')) {
            setFormError('Этот email уже зарегистрирован. Попробуйте войти.');
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
          setFormError('Этот email уже зарегистрирован. Попробуйте войти.');
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

      // Auth succeeded — save invite code for Phase 3 claim
      if (inviteCode) {
        localStorage.setItem('pending_invite_code', inviteCode);
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

  // Loading state
  if (loading) {
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
            <Link to="/">
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
              {isLogin ? 'Вы вошли в систему' : 'Регистрация прошла успешно'}
            </CardTitle>
            <CardDescription>
              Подключение к репетитору {tutor.name} произойдёт автоматически
            </CardDescription>
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
              <p className="text-sm text-destructive">{formError}</p>
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

          {/* Telegram collapsed section */}
          <div>
            <button
              type="button"
              onClick={() => setShowTelegram(!showTelegram)}
              className="w-full flex items-center justify-between text-sm text-muted-foreground hover:text-foreground transition-colors py-2"
              style={{ touchAction: 'manipulation' }}
            >
              <span>
                Подключиться через Telegram{' '}
                <span className="text-xs text-amber-600">(нужен VPN)</span>
              </span>
              {showTelegram ? (
                <ChevronUp className="h-4 w-4 shrink-0" />
              ) : (
                <ChevronDown className="h-4 w-4 shrink-0" />
              )}
            </button>

            <div
              className={`overflow-hidden transition-all duration-200 ${
                showTelegram ? 'max-h-96 opacity-100 mt-3' : 'max-h-0 opacity-0'
              }`}
            >
              <div className="space-y-4">
                <p className="text-xs text-amber-600 text-center">
                  Telegram может быть недоступен без VPN в России
                </p>
                <div className="flex justify-center">
                  <div className="bg-white p-3 rounded-lg shadow-sm">
                    <QRCode value={telegramLink} size={150} level="M" />
                  </div>
                </div>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => window.open(telegramLink, '_blank')}
                  style={{ touchAction: 'manipulation' }}
                >
                  Открыть Telegram
                </Button>
              </div>
            </div>
          </div>

          {/* Footer */}
          <p className="text-xs text-center text-muted-foreground">
            Сократ — AI-помощник для подготовки к ЕГЭ и ОГЭ
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
