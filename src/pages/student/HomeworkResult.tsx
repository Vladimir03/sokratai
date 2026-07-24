import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ChevronLeft, Loader2, RefreshCw } from 'lucide-react';
import AuthGuard from '@/components/AuthGuard';
import Navigation from '@/components/Navigation';
import { PageContent } from '@/components/PageContent';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TutorOverallCommentCard } from '@/components/student/homework-problem/TutorOverallCommentCard';
import {
  getStudentHomeworkResult,
  type StudentHomeworkResultTask,
} from '@/lib/studentHomeworkApi';
import { getSubjectLabel } from '@/types/homework';

/**
 * homework-work-modes (Т6): экран ученика «Результат работы».
 *
 * Показывается ПОСЛЕ завершения работы (оба вида: домашка — когда все задачи
 * закрыты; самостоятельная — после «Сдать работу» / автозавершения). Данные —
 * один round-trip `GET /assignments/:id/student/result` (state-aware: до
 * завершения сервер баллов не отдаёт вовсе).
 *
 * Экран ТЕРМИНАЛЬНЫЙ: никогда не редиректит сам (loop-guard инвариант —
 * StudentHomeworkDetail и HomeworkProblem редиректят СЮДА).
 */

const NUM = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });

function verdictBucket(t: StudentHomeworkResultTask): { label: string; className: string } {
  // «Без ответа» — задача занулена «Сдать работу» (или закрыта без сдачи).
  if (!t.answered && t.final_score <= 0) {
    return { label: 'Без ответа', className: 'bg-slate-100 text-slate-500 border border-slate-200' };
  }
  if (t.max_score > 0 && t.final_score >= t.max_score) {
    return { label: 'Верно', className: 'bg-emerald-100 text-emerald-900 border border-emerald-200' };
  }
  if (t.final_score <= 0) {
    return { label: 'Неверно', className: 'bg-red-100 text-red-900 border border-red-200' };
  }
  return { label: 'Частично', className: 'bg-amber-100 text-amber-900 border border-amber-200' };
}

/**
 * Короткое превью условия для плотной строки. LaTeX-исходник (`$…$`, `\frac`)
 * в raw-виде нечитаем, а KaTeX в dense-списке — overhead; формульные тексты
 * просто опускаем (клик по строке ведёт в задачу с полным рендером).
 * stripLatex из kb/ui намеренно НЕ импортируем — tutor-домен (module isolation).
 */
function plainPreview(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed === '[Задача на фото]') return null;
  if (/[\\$]/.test(trimmed)) return null;
  return trimmed;
}

const HomeworkResult = () => {
  const { hwId } = useParams<{ hwId: string }>();
  const { data, isPending, isError, refetch } = useQuery({
    // Префикс ['student','homework',hwId] — инвалидируется fan-out'ом
    // useSubmitSolution → свежие баллы после сдачи последней задачи.
    queryKey: ['student', 'homework', hwId, 'result'],
    queryFn: () => getStudentHomeworkResult(hwId as string),
    enabled: Boolean(hwId),
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  return (
    <AuthGuard>
      <div className="min-h-screen bg-background">
        <Navigation />
        <PageContent>
          <main className="container mx-auto px-4 pb-8">
            <div className="max-w-2xl mx-auto space-y-4">
              <div className="flex items-center gap-2 pt-2">
                <Link
                  to="/homework"
                  aria-label="К списку ДЗ"
                  className="grid place-items-center w-10 h-10 rounded-full text-slate-700 hover:bg-socrat-surface hover:text-slate-900 shrink-0 touch-manipulation"
                >
                  <ChevronLeft className="h-[22px] w-[22px] stroke-2" aria-hidden="true" />
                </Link>
                <h1 className="text-xl font-bold m-0">Результат работы</h1>
              </div>

              {isPending && (
                <div className="flex justify-center py-12" role="status" aria-label="Загружаем результат">
                  <Loader2 className="h-7 w-7 text-socrat-primary animate-spin" aria-hidden="true" />
                </div>
              )}

              {isError && (
                <Card>
                  <CardContent className="py-8 flex flex-col items-center gap-3 text-center">
                    <p className="text-sm text-slate-600 m-0">
                      Не удалось загрузить результат. Проверь соединение и попробуй ещё раз.
                    </p>
                    <Button variant="outline" onClick={() => refetch()}>
                      <RefreshCw className="h-4 w-4 mr-1.5" aria-hidden="true" />
                      Повторить
                    </Button>
                  </CardContent>
                </Card>
              )}

              {data && !data.completed && (
                <Card>
                  <CardContent className="py-8 flex flex-col items-center gap-3 text-center">
                    <p className="text-sm text-slate-600 m-0">
                      Работа «{data.assignment.title}» ещё не завершена — результат появится
                      после сдачи{data.work_mode === 'independent' ? ' всей работы' : ' всех задач'}.
                    </p>
                    <Button asChild>
                      <Link to={`/homework/${data.assignment.id}`}>Продолжить работу</Link>
                    </Button>
                  </CardContent>
                </Card>
              )}

              {data && data.completed && (
                <>
                  {/* Hero: «X из Y баллов» */}
                  <Card>
                    <CardContent className="py-6 flex flex-col items-center gap-1 text-center">
                      <span className="text-[11px] font-bold uppercase tracking-[0.05em] text-socrat-primary">
                        {getSubjectLabel(data.assignment.subject)} · {data.assignment.title}
                      </span>
                      <span className="text-4xl font-bold tabular-nums text-slate-900">
                        {NUM.format(data.total_score)}
                        <span className="text-2xl font-semibold text-slate-500">
                          {' '}из {NUM.format(data.total_max)}
                        </span>
                      </span>
                      <span className="text-sm text-slate-500">баллов за работу</span>
                    </CardContent>
                  </Card>

                  {/* Phase 12: общий комментарий репетитора к ДЗ. */}
                  <TutorOverallCommentCard comment={data.assignment.tutor_overall_comment} />

                  {/* Список задач: вердикт + балл, клик → разбор задачи. */}
                  <Card>
                    <CardContent className="p-0 divide-y divide-slate-100">
                      {data.tasks.map((t) => {
                        const bucket = verdictBucket(t);
                        const preview = plainPreview(t.task_text);
                        return (
                          <Link
                            key={t.task_id}
                            to={`/student/homework/${data.assignment.id}/problem/${t.task_id}`}
                            className="flex items-center gap-3 px-4 py-3 min-h-[44px] hover:bg-socrat-surface transition-colors touch-manipulation"
                          >
                            <span className="grid place-items-center w-8 h-8 rounded-full bg-slate-100 text-sm font-bold text-slate-700 shrink-0 tabular-nums">
                              {t.order_num}
                            </span>
                            <span className="flex-1 min-w-0">
                              <span
                                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${bucket.className}`}
                              >
                                {bucket.label}
                              </span>
                              {preview ? (
                                <span className="block text-[13px] text-slate-500 truncate mt-0.5">
                                  {preview}
                                </span>
                              ) : null}
                            </span>
                            <span className="text-sm font-bold tabular-nums text-slate-700 shrink-0">
                              {NUM.format(t.final_score)}/{NUM.format(t.max_score)}
                            </span>
                          </Link>
                        );
                      })}
                    </CardContent>
                  </Card>

                  <p className="text-xs text-slate-500 text-center">
                    Нажми на задачу, чтобы посмотреть разбор и правильное решение.
                  </p>
                </>
              )}
            </div>
          </main>
        </PageContent>
      </div>
    </AuthGuard>
  );
};

export default HomeworkResult;
