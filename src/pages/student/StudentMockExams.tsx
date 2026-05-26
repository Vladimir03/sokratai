// Student-side mock exams list (FIX-5).
//
// Route: /student/mock-exams
// Точка входа в назначенные пробники для ученика.
// Минимальная реализация Phase 1: fetch mock_exam_attempts для текущего user_id,
// показ карточек с переходом на /student/mock-exams/:id (taking) или
// /student/mock-exams/:id/result (если уже подтверждён).
//
// State machine для UI:
//   in_progress + started_at IS NULL → «Не начат» → CTA «Начать пробник»
//   in_progress + started_at NOT NULL → «В процессе» → CTA «Продолжить»
//   submitted | ai_checking | awaiting_review → «На проверке» → CTA «Посмотреть»
//   approved | manually_entered → «Готов» → CTA «Открыть результат»
//
// Как только Phase 2 добавит push для assignment notification, эта страница
// останется главной для повторного открытия пробника.

import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ClipboardCheck, Clock, CheckCircle2, AlertCircle, ChevronRight, Pause } from 'lucide-react';
import AuthGuard from '@/components/AuthGuard';
import Navigation from '@/components/Navigation';
import { PageContent } from '@/components/PageContent';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/lib/supabaseClient';

interface AttemptRow {
  id: string;
  status: string;
  started_at: string | null;
  submitted_at: string | null;
  total_score: number | null;
  assignment_id: string;
  // AC-P10 (2026-05-25): pause/multi-session fields. Optional для backward
  // compat с pre-migration rows (default 0 / [] applied на server side).
  total_active_ms: number | null;
  exam_mode: string | null;
  mock_exam_assignments: {
    id: string;
    title: string;
    deadline: string | null;
    mode: string;
    mock_exam_variants: {
      title: string;
      total_max_score: number;
      task_count: number;
      duration_minutes: number;
    } | null;
  } | null;
}

type DisplayStatus = 'not_started' | 'in_progress' | 'paused' | 'pending_review' | 'approved';

function deriveStatus(row: AttemptRow): DisplayStatus {
  if (row.status === 'approved' || row.status === 'manually_entered') return 'approved';
  if (
    row.status === 'submitted' ||
    row.status === 'ai_checking' ||
    row.status === 'awaiting_review'
  ) {
    return 'pending_review';
  }
  // AC-P10: paused — отдельный display state с amber «На паузе» badge.
  if (row.status === 'paused') return 'paused';
  if (row.status === 'in_progress' && row.started_at !== null) return 'in_progress';
  return 'not_started';
}

/**
 * AC-P10 (2026-05-25): Форматирование остатка времени для paused attempt.
 * Возвращает «осталось 02:34:15» или null если данные incomplete.
 */
function formatRemainingTime(
  totalActiveMs: number | null,
  durationMinutes: number | null,
): string | null {
  if (totalActiveMs === null || durationMinutes === null) return null;
  const totalMs = durationMinutes * 60_000;
  const remainingMs = Math.max(0, totalMs - totalActiveMs);
  if (remainingMs === 0) return 'время вышло';
  const totalSec = Math.floor(remainingMs / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h === 0) return `осталось ${m} мин`;
  return `осталось ${h} ч ${m.toString().padStart(2, '0')} мин`;
}

const STATUS_BADGE: Record<DisplayStatus, { label: string; className: string; icon: typeof Clock }> = {
  not_started: {
    label: 'Не начат',
    className: 'bg-slate-100 text-slate-700',
    icon: Clock,
  },
  in_progress: {
    label: 'В процессе',
    className: 'bg-amber-100 text-amber-900',
    icon: Clock,
  },
  // AC-P10: paused — amber pause icon, similar urgency как in_progress.
  paused: {
    label: 'На паузе',
    className: 'bg-amber-100 text-amber-900',
    icon: Pause,
  },
  pending_review: {
    label: 'На проверке у репетитора',
    className: 'bg-amber-100 text-amber-900',
    icon: AlertCircle,
  },
  approved: {
    label: 'Готов',
    className: 'bg-emerald-100 text-emerald-900',
    icon: CheckCircle2,
  },
};

const CTA_LABEL: Record<DisplayStatus, string> = {
  not_started: 'Начать пробник',
  in_progress: 'Продолжить',
  paused: 'Продолжить', // AC-P10: same CTA, sub-label покажет remaining time
  pending_review: 'Подробнее',
  approved: 'Открыть результат',
};

function formatDeadline(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
  }).format(ms);
}

export default function StudentMockExams() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempts, setAttempts] = useState<AttemptRow[]>([]);
  // AC-P10 hotfix (F8 from code review, 2026-05-25): inline state для resume
  // operation — disabled card + error message при failure (вместо silent navigate).
  const [resumingAttemptId, setResumingAttemptId] = useState<string | null>(null);
  const [resumeError, setResumeError] = useState<{
    attemptId: string;
    message: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const { data: session } = await supabase.auth.getSession();
      const userId = session.session?.user.id;
      if (!userId) {
        if (!cancelled) {
          setError('not_authenticated');
          setLoading(false);
        }
        return;
      }
      const { data, error: fetchError } = await supabase
        .from('mock_exam_attempts')
        .select(
          `
          id,
          status,
          started_at,
          submitted_at,
          total_score,
          assignment_id,
          total_active_ms,
          exam_mode,
          mock_exam_assignments (
            id,
            title,
            deadline,
            mode,
            mock_exam_variants (
              title,
              total_max_score,
              task_count,
              duration_minutes
            )
          )
        `,
        )
        .eq('student_id', userId)
        .order('created_at', { ascending: false });

      if (cancelled) return;
      if (fetchError) {
        // eslint-disable-next-line no-console
        console.error('[StudentMockExams] fetch error:', fetchError);
        setError(`${fetchError.code ?? 'error'}: ${fetchError.message}`);
      } else {
        setAttempts((data as unknown as AttemptRow[]) ?? []);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleClick = async (row: AttemptRow) => {
    // Routes /student/mock-exams/:id and /:id/result expect ASSIGNMENT id,
    // not attempt id (StudentMockExam.tsx → getStudentMockExam(assignmentId)
    // calls /student/:assignmentId on the edge function). Backend имеет
    // defensive fallback и принимает attempt_id тоже, но primary contract —
    // assignment_id, не отступаем от него на фронте.
    const assignmentId = row.assignment_id;
    if (!assignmentId) {
      // eslint-disable-next-line no-console
      console.error(
        '[StudentMockExams] assignment_id missing on row, falling back to attempt id:',
        row,
      );
    }
    const target = assignmentId ?? row.id;
    const status = deriveStatus(row);
    if (status === 'approved') {
      navigate(`/student/mock-exams/${target}/result`);
      return;
    }
    // AC-P10 hotfix (F8 from code review, 2026-05-25): для paused — explicit
    // resume call before navigate. Без этого StudentMockExam useEffect видит
    // status='paused' и redirect'нёт обратно на list → infinite loop.
    //
    // F8 fix: при failure НЕ navigate тихо — показываем toast и оставляем
    // ученика на list. Disabled state защищает от double-click race.
    if (status === 'paused') {
      if (resumingAttemptId !== null) {
        // Click уже обрабатывается — ignore.
        return;
      }
      setResumingAttemptId(row.id);
      try {
        const { resumeMockExamAttempt } = await import('@/lib/studentMockExamApi');
        await resumeMockExamAttempt(row.id);
        navigate(`/student/mock-exams/${target}`);
      } catch (err) {
        console.error('[StudentMockExams] resume failed', err);
        const msg =
          err instanceof Error && err.message
            ? err.message
            : 'Не удалось возобновить пробник. Проверь подключение и попробуй ещё раз.';
        setResumeError({ attemptId: row.id, message: msg });
      } finally {
        setResumingAttemptId(null);
      }
      return;
    }
    navigate(`/student/mock-exams/${target}`);
  };

  return (
    <AuthGuard>
      <Navigation />
      <PageContent>
        <div className="max-w-3xl mx-auto px-4 py-6 sm:px-6 sm:py-8">
          <div className="mb-6">
            <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 flex items-center gap-2">
              <ClipboardCheck className="w-6 h-6 sm:w-7 sm:h-7 text-accent" />
              Пробники
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              Пробные варианты ЕГЭ, назначенные репетитором
            </p>
          </div>

          {loading && (
            <div className="space-y-3">
              {[1, 2].map((i) => (
                <Skeleton key={i} className="h-32 w-full rounded-lg" />
              ))}
            </div>
          )}

          {error && !loading && (
            <Card className="border-rose-200 bg-rose-50">
              <CardContent className="p-4 text-sm text-rose-900">
                <div>Не удалось загрузить пробники. Попробуй обновить страницу.</div>
                <div className="mt-2 font-mono text-xs text-rose-700 break-all">
                  {error}
                </div>
              </CardContent>
            </Card>
          )}

          {!loading && !error && attempts.length === 0 && (
            <Card className="border-dashed">
              <CardContent className="p-8 text-center">
                <ClipboardCheck className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                <p className="text-sm text-slate-600">
                  Пока репетитор не назначил тебе пробник. Когда назначит — появится
                  здесь.
                </p>
              </CardContent>
            </Card>
          )}

          {!loading && !error && attempts.length > 0 && (
            <div className="space-y-3">
              {attempts.map((row) => {
                const status = deriveStatus(row);
                const badge = STATUS_BADGE[status];
                const BadgeIcon = badge.icon;
                const variant = row.mock_exam_assignments?.mock_exam_variants;
                const title =
                  row.mock_exam_assignments?.title ?? variant?.title ?? 'Пробник';
                const deadlineLabel = formatDeadline(
                  row.mock_exam_assignments?.deadline ?? null,
                );

                const isResumingThis = resumingAttemptId === row.id;
                const anyResuming = resumingAttemptId !== null;
                const resumeErrForThis =
                  resumeError?.attemptId === row.id ? resumeError.message : null;

                return (
                  <Card
                    key={row.id}
                    className={`transition-shadow ${
                      anyResuming
                        ? 'cursor-not-allowed opacity-60'
                        : 'cursor-pointer hover:shadow-md'
                    }`}
                    onClick={() => {
                      if (anyResuming) return;
                      void handleClick(row);
                    }}
                    aria-busy={isResumingThis}
                  >
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <h3 className="font-semibold text-slate-900 text-base sm:text-lg">
                              {title}
                            </h3>
                            <span
                              className={`px-2 py-0.5 rounded-full text-xs font-medium inline-flex items-center gap-1 ${badge.className}`}
                            >
                              <BadgeIcon className="w-3 h-3" />
                              {badge.label}
                            </span>
                          </div>
                          {variant && (
                            <p className="text-xs text-slate-500">
                              {variant.task_count} заданий · макс. {variant.total_max_score}{' '}
                              баллов · {Math.floor(variant.duration_minutes / 60)} ч{' '}
                              {variant.duration_minutes % 60} мин
                            </p>
                          )}
                          {deadlineLabel && status !== 'approved' && (
                            <p className="text-xs text-slate-500 mt-0.5">
                              Дедлайн: {deadlineLabel}
                            </p>
                          )}
                          {/* AC-P10 (2026-05-25): для paused показываем оставшееся время */}
                          {status === 'paused' && (
                            <p className="text-xs text-amber-700 mt-0.5 font-medium">
                              {formatRemainingTime(
                                row.total_active_ms,
                                variant?.duration_minutes ?? null,
                              ) ?? 'таймер на паузе'}
                            </p>
                          )}
                          {status === 'approved' && row.total_score !== null && (
                            <p className="text-sm text-accent font-semibold mt-1">
                              Первичный балл: {row.total_score} /{' '}
                              {variant?.total_max_score ?? '—'}
                            </p>
                          )}
                        </div>
                        <ChevronRight className="w-5 h-5 text-slate-400 flex-shrink-0" />
                      </div>
                      <div className="text-sm text-accent font-medium mt-2 flex items-center gap-2">
                        {isResumingThis ? (
                          <>
                            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent" />
                            Возобновляем…
                          </>
                        ) : (
                          <>{CTA_LABEL[status]} →</>
                        )}
                      </div>
                      {/* AC-P10 hotfix (F8): inline error message при resume failure */}
                      {resumeErrForThis && (
                        <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800">
                          {resumeErrForThis}{' '}
                          <button
                            type="button"
                            className="underline font-medium"
                            onClick={(e) => {
                              e.stopPropagation();
                              setResumeError(null);
                            }}
                          >
                            Скрыть
                          </button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </PageContent>
    </AuthGuard>
  );
}
