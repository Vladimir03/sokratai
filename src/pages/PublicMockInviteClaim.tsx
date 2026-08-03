// PublicMockInviteClaim — шаг между лид-формой приглашения и самим пробником.
//
// Route: /p/mock-invite/:slug/start  (App.tsx)
// Смонтирован ВНЕ AppFrame / AuthGuard — сюда приходит человек ещё без аккаунта.
//
// ЗАЧЕМ ОН ЕСТЬ (решение владельца 2026-08-02, вариант «б»).
// Публичная ссылка создавала попытку с `student_id = NULL` и вела прямо на
// `/student/mock-exams/:assignment_id`. Но `mock-exam-student-api` ищет попытку
// по `student_id = auth.uid()`, поэтому КАЖДЫЙ, кто заполнил форму, упирался в
// «Пробник не найден или не назначен этому ученику». Анонимное прохождение
// (TASK-12) не реализовано и в этот раунд не входит — вместо него ученик
// заводит аккаунт, и анонимная попытка привязывается к нему (эндпоинт
// `POST /share/mock-invite/:slug/claim`).
//
// Порядок здесь принципиален:
//   1. ЖДЁМ `INITIAL_SESSION` — синхронный getSession() возвращает null до того,
//      как supabase-js распарсит `#access_token=…` из редиректа Yandex/VK
//      (rule 96 §1). Без ожидания вошедший ученик увидел бы экран «войди».
//   2. Нет сессии → вход/регистрация с `?next=` обратно СЮДА.
//   3. Есть сессия → привязка → уходим в пробник.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, FileQuestion, Loader2, LogIn, UserPlus } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/button';
import {
  claimMockInviteAttempt,
  clearPendingMockInviteClaim,
  readPendingMockInviteClaim,
  type PendingMockInviteClaim,
} from '@/lib/mockExamPublicApi';

type Phase =
  | { kind: 'checking' }
  | { kind: 'need_auth' }
  | { kind: 'claiming' }
  | { kind: 'no_claim' }
  | { kind: 'error'; message: string; canRetry: boolean };

function Shell({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    // `min-h-screen` (100vh) — базовый слой для Safari 15.0–15.3, где `dvh`
    // ещё нет (rule 80): без него экран перестаёт быть полноэкранным ровно на
    // нашем baseline. `100dvh` идёт следом как прогрессивное улучшение.
    <div className="min-h-screen bg-slate-50 px-4 py-10 text-slate-900 [@supports(height:100dvh)]:min-h-[100dvh]">
      <div className="mx-auto flex max-w-[560px] flex-col items-center text-center">
        <div className="mb-4 rounded-full bg-slate-100 p-4 text-slate-500" aria-hidden="true">
          {icon}
        </div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="mt-2 text-base text-slate-600">{description}</p>
        {children ? <div className="mt-6 w-full">{children}</div> : null}
        <p className="mt-8 text-center text-xs text-slate-500">
          Через платформу <strong className="text-slate-700">Сократ AI</strong>
        </p>
      </div>
    </div>
  );
}

export default function PublicMockInviteClaim() {
  const { slug = '' } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>({ kind: 'checking' });
  // Привязку запускаем ровно один раз на сессию экрана: `INITIAL_SESSION` и
  // `SIGNED_IN` могут прийти оба (возврат вкладки переэмитит SIGNED_IN,
  // rule 96 §5), а повторный claim — лишний round-trip.
  const claimStartedRef = useRef(false);

  const nextPath = `/p/mock-invite/${encodeURIComponent(slug)}/start`;

  const runClaim = useCallback(
    async (claim: PendingMockInviteClaim, accessToken: string) => {
      setPhase({ kind: 'claiming' });
      const result = await claimMockInviteAttempt(claim, accessToken);

      // Неуспехи разбираем ПЕРВЫМИ: успешная ветка несёт три значения `status`
      // в одном члене union, и TS не сузил бы её из `||`-проверки — `message`
      // тогда «не существует» на объединении.
      if (result.status === 'unauthorized') {
        claimStartedRef.current = false;
        setPhase({ kind: 'need_auth' });
        return;
      }

      if (result.status === 'not_found') {
        // Токен не подошёл / попытку уже забрали. Повтор не поможет —
        // единственный рабочий путь — открыть приглашение заново.
        clearPendingMockInviteClaim();
        setPhase({
          kind: 'error',
          message:
            'Эта заявка больше не действует. Открой ссылку от репетитора заново и заполни форму ещё раз.',
          canRetry: false,
        });
        return;
      }

      if (result.status === 'error') {
        claimStartedRef.current = false;
        setPhase({ kind: 'error', message: result.message, canRetry: true });
        return;
      }

      clearPendingMockInviteClaim();
      navigate(`/student/mock-exams/${encodeURIComponent(result.assignment_id)}`, {
        replace: true,
      });
    },
    [navigate],
  );

  useEffect(() => {
    let cancelled = false;

    const handleSession = (accessToken: string | null) => {
      if (cancelled) return;
      const claim = readPendingMockInviteClaim(slug);
      if (!claim) {
        setPhase({ kind: 'no_claim' });
        return;
      }
      if (!accessToken) {
        setPhase({ kind: 'need_auth' });
        return;
      }
      if (claimStartedRef.current) return;
      claimStartedRef.current = true;
      void runClaim(claim, accessToken);
    };

    // rule 96 §1 — ждём INITIAL_SESSION, а не читаем getSession() синхронно.
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        handleSession(session?.access_token ?? null);
      }
    });

    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, [slug, runClaim]);

  const retry = useCallback(async () => {
    const claim = readPendingMockInviteClaim(slug);
    if (!claim) {
      setPhase({ kind: 'no_claim' });
      return;
    }
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token ?? null;
    if (!token) {
      setPhase({ kind: 'need_auth' });
      return;
    }
    claimStartedRef.current = true;
    void runClaim(claim, token);
  }, [slug, runClaim]);

  if (phase.kind === 'checking' || phase.kind === 'claiming') {
    return (
      <Shell
        icon={<Loader2 className="h-6 w-6 animate-spin" />}
        title={phase.kind === 'claiming' ? 'Готовим пробник…' : 'Секунду…'}
        description="Связываем твою заявку с аккаунтом — это займёт пару секунд."
      />
    );
  }

  if (phase.kind === 'no_claim') {
    return (
      <Shell
        icon={<FileQuestion className="h-6 w-6" />}
        title="Заявка не найдена"
        description="Похоже, форму заполняли в другом браузере или данные уже очищены. Открой ссылку от репетитора и заполни форму ещё раз."
      >
        <Button asChild className="min-h-[48px] w-full bg-accent text-base text-white hover:bg-accent/90">
          <Link to={`/p/mock-invite/${encodeURIComponent(slug)}`}>
            Вернуться к приглашению
          </Link>
        </Button>
      </Shell>
    );
  }

  if (phase.kind === 'error') {
    return (
      <Shell
        icon={<AlertCircle className="h-6 w-6" />}
        title="Не получилось открыть пробник"
        description={phase.message}
      >
        <div className="flex flex-col gap-2">
          {phase.canRetry && (
            <Button
              onClick={() => void retry()}
              className="min-h-[48px] w-full bg-accent text-base text-white hover:bg-accent/90"
              style={{ touchAction: 'manipulation' }}
            >
              Повторить
            </Button>
          )}
          <Button asChild variant="outline" className="min-h-[48px] w-full text-base">
            <Link to={`/p/mock-invite/${encodeURIComponent(slug)}`}>
              Вернуться к приглашению
            </Link>
          </Button>
        </div>
      </Shell>
    );
  }

  // need_auth
  return (
    <Shell
      icon={<LogIn className="h-6 w-6" />}
      title="Остался один шаг"
      description="Заявка сохранена, репетитор её уже видит. Чтобы решать пробник и получить разбор, нужен аккаунт — он же хранит твои ответы, если придётся прерваться."
    >
      <div className="flex flex-col gap-2">
        <Button
          asChild
          className="min-h-[48px] w-full bg-accent text-base font-medium text-white hover:bg-accent/90"
        >
          <Link to={`/signup?next=${encodeURIComponent(nextPath)}`}>
            <UserPlus className="mr-2 h-4 w-4" aria-hidden="true" />
            Создать аккаунт
          </Link>
        </Button>
        <Button asChild variant="outline" className="min-h-[48px] w-full text-base">
          <Link to={`/login?next=${encodeURIComponent(nextPath)}`}>
            <LogIn className="mr-2 h-4 w-4" aria-hidden="true" />
            У меня уже есть аккаунт
          </Link>
        </Button>
      </div>
    </Shell>
  );
}
