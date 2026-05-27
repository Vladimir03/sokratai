// Mock Exams v1 — student result page (TASK-13).
//
// Spec: docs/delivery/features/mock-exams-v1/spec.md AC-5
// Mockup: SokratAI/docs/delivery/features/mock-exams-v1/mockup.html (Screen 6)
//
// Contract:
//   - Часть 1 visible immediately after submit (auto-checked).
//   - Часть 2 visible ONLY when attempt.status === 'approved'. Pre-approval
//     renders amber «ждёт проверки репетитора» card. AI draft is NEVER shown
//     to student.
//   - Manual entry mode: just totals + tutor's manual_comment.
//
// State machine (rendered):
//   in_progress         → redirect to /student/mock-exams/:id (back to taking)
//   submitted | ai_checking | awaiting_review → Часть 1 reveal + amber Часть 2
//   approved            → Часть 1 reveal + Часть 2 reveal + final summary
//   manually_entered    → totals + manual_comment

import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  Hourglass,
  Loader2,
  ShieldCheck,
  Sparkles,
  XCircle,
} from 'lucide-react';
import AuthGuard from '@/components/AuthGuard';
import { PageContent } from '@/components/PageContent';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useStudentMockExamResult } from '@/hooks/useStudentMockExamResult';
import { StudentMockExamApiError } from '@/lib/studentMockExamApi';
import { primaryToSecondary } from '@/lib/mockExamScaleEge2025';
import type {
  StudentMockExamResultPart1Answer,
  StudentMockExamResultPart2Solution,
  StudentMockExamResultView,
} from '@/lib/studentMockExamApi';
import type { MockExamAttemptStatus } from '@/types/mockExam';

const MathText = lazy(() =>
  import('@/components/kb/ui/MathText').then((m) => ({ default: m.MathText })),
);

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(ms);
}

function formatDuration(totalMinutes: number | null): string | null {
  if (typeof totalMinutes !== 'number' || !Number.isFinite(totalMinutes)) {
    return null;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} мин`;
  if (minutes === 0) return `${hours} ч`;
  return `${hours} ч ${minutes} мин`;
}

function getDisplayTitle(view: StudentMockExamResultView): string {
  return (
    view.assignment.variant_title ??
    view.variant?.title ??
    view.assignment.title ??
    'Пробник'
  );
}

function getTutorFirstName(name: string | null | undefined): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  return trimmed.split(/\s+/)[0] ?? trimmed;
}

function MathBlock({ text, className }: { text: string; className?: string }) {
  return (
    <Suspense
      fallback={
        <div className={cn('whitespace-pre-wrap', className)}>{text}</div>
      }
    >
      <MathText text={text} className={cn('whitespace-pre-wrap', className)} />
    </Suspense>
  );
}

// ─── Header ─────────────────────────────────────────────────────────────────

function ResultHeader({ view }: { view: StudentMockExamResultView }) {
  const submittedDate = formatDate(view.attempt.submitted_at);
  const manualDate = formatDate(view.attempt.manual_entered_date);
  const date = submittedDate ?? manualDate;
  const duration = formatDuration(view.attempt.total_time_minutes);
  const tutor = view.tutor;

  return (
    <header className="mb-6">
      <p className="text-xs uppercase tracking-wide text-slate-500">
        Результат пробника
      </p>
      <h1 className="mt-1 text-2xl font-semibold text-slate-900 sm:text-3xl">
        {getDisplayTitle(view)}
      </h1>
      <p className="mt-2 text-sm text-slate-500">
        {date ? `Сдан ${date}` : 'Без даты сдачи'}
        {duration ? ` · ${duration}` : ''}
        {tutor?.name ? ` · проверяет ${tutor.name}` : ''}
      </p>
    </header>
  );
}

// ─── Часть 1 ────────────────────────────────────────────────────────────────

function Part1Card({
  answers,
  totalScore,
  part1Max,
  status,
}: {
  answers: StudentMockExamResultPart1Answer[];
  totalScore: number | null;
  part1Max: number | null;
  /** TASK-OCR Round 4 (2026-05-21): chip color/copy varies by attempt status. */
  status: MockExamAttemptStatus;
}) {
  // Chip label + color по статусу attempt.
  // - approved              → «Готово» emerald (final, repetitor подтвердил)
  // - awaiting_review       → «Предварительно» sky (AI оценил, ждём финал tutor)
  // - submitted/ai_checking → «AI считает» blue (если данные уже есть, но
  //                            tutor ещё не открыл — показываем preview)
  const chipConfig = (() => {
    if (status === 'approved' || status === 'manually_entered') {
      return {
        label: 'Готово',
        classes: 'bg-emerald-100 text-emerald-900',
      };
    }
    if (status === 'awaiting_review') {
      return {
        label: 'Предварительно',
        classes: 'bg-sky-100 text-sky-900',
      };
    }
    // submitted | ai_checking — data может уже быть от form-mode auto-check
    // или от blank-mode OCR. В обоих случаях «AI считает» = «оцениваем».
    return {
      label: 'AI оценил',
      classes: 'bg-sky-100 text-sky-900',
    };
  })();
  // Phase 4 (2026-05-15): таблица разбалловки раскрыта по умолчанию.
  // Ученик сразу видит № / Твой ответ / Правильный / Балл + иконки ✓/✗
  // без необходимости кликать toggle. Toggle сохранён для возможности
  // скрыть длинную таблицу при scroll'е, но default = expanded.
  const [open, setOpen] = useState(true);

  const fallbackTotal = useMemo(() => {
    return answers.reduce((acc, row) => acc + (row.earned_score ?? 0), 0);
  }, [answers]);
  const fallbackMax = useMemo(() => {
    return answers.reduce((acc, row) => acc + (row.max_score ?? 0), 0);
  }, [answers]);

  const score = typeof totalScore === 'number' ? totalScore : fallbackTotal;
  const max =
    typeof part1Max === 'number' && part1Max > 0 ? part1Max : fallbackMax;

  const hasAnswers = answers.length > 0;

  return (
    <Card className="mb-3 shadow-none">
      <CardContent className="p-5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-slate-900">
            Часть 1 · авто-проверка
          </h2>
          <span className={cn(
            'rounded px-2 py-0.5 text-xs font-medium',
            chipConfig.classes,
          )}>
            {chipConfig.label}
          </span>
        </div>
        <div className="text-3xl font-semibold text-accent tabular-nums">
          {score}{' '}
          <span className="text-lg font-normal text-slate-500">/ {max}</span>
        </div>
        {hasAnswers && (
          <button
            type="button"
            className="mt-3 inline-flex min-h-11 touch-manipulation items-center gap-1 text-sm text-accent hover:underline"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="mock-exam-part1-table"
          >
            {open
              ? 'Скрыть таблицу'
              : `Показать таблицу ${answers.length} задач`}
            <ChevronDown
              className={cn(
                'h-4 w-4 transition-transform',
                open && 'rotate-180',
              )}
            />
          </button>
        )}
        {open && hasAnswers && (
          <div
            id="mock-exam-part1-table"
            className="mt-4 overflow-x-auto rounded-md border border-slate-200"
          >
            <table className="w-full min-w-[480px] text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-medium">№</th>
                  <th className="px-3 py-2 font-medium">Твой ответ</th>
                  <th className="px-3 py-2 font-medium">Правильный</th>
                  <th className="px-3 py-2 text-right font-medium">Балл</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {answers.map((row) => {
                  const earned = row.earned_score ?? 0;
                  const hasScore = row.earned_score !== null && row.earned_score !== undefined;
                  const isCorrect = hasScore && earned > 0 && earned === row.max_score;
                  // AC-P4 (ФИПИ partial credit, 2026-05-25): 0 < earned < max
                  // → амбер-Check + tooltip. KIM 5/9/14/18 (multi_choice) и
                  // 6/10/15/17 (ordered) могут получить 1 из 2 баллов за
                  // одну ошибку — см. CLAUDE.md §15a.
                  const isPartial = hasScore && earned > 0 && earned < row.max_score;
                  return (
                    <tr key={row.kim_number} className="text-slate-700">
                      <td className="px-3 py-2 font-medium tabular-nums">
                        {row.kim_number}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-start gap-2">
                          {isCorrect ? (
                            <CheckCircle2
                              className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600"
                              aria-label="Верно"
                            />
                          ) : isPartial ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  className="mt-0.5 inline-flex h-4 w-4 flex-shrink-0 cursor-help items-center justify-center rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                                  aria-label={`Частично верно: ${earned} из ${row.max_score}`}
                                >
                                  <Check className="h-4 w-4 text-amber-600" />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-xs">
                                <p className="text-xs leading-snug">
                                  {earned} балл из {row.max_score} — одна ошибка
                                  по критериям ФИПИ 2026. Полный балл — только
                                  при полном совпадении всех символов.
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <XCircle
                              className="mt-0.5 h-4 w-4 flex-shrink-0 text-rose-500"
                              aria-label="Неверно"
                            />
                          )}
                          {row.student_answer ? (
                            <span className="break-all">{row.student_answer}</span>
                          ) : isCorrect && row.correct_answer ? (
                            // TASK-16: blank-mode ученик заполнил бланк, tutor
                            // confirmed full score, но student_answer=null
                            // (нет digital input). Показываем ответ + suffix.
                            <span className="break-all">
                              {row.correct_answer}{' '}
                              <span className="text-xs text-slate-500">
                                (по фото бланка)
                              </span>
                            </span>
                          ) : (
                            <span className="italic text-slate-400">без ответа</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-slate-700">
                        {row.correct_answer ?? '—'}
                      </td>
                      <td
                        className={cn(
                          'px-3 py-2 text-right tabular-nums',
                          isPartial
                            ? 'font-semibold text-amber-700'
                            : 'text-slate-900',
                        )}
                      >
                        {earned}/{row.max_score}
                      </td>
                    </tr>
                  );
                })}
                {/* AC-P11 (2026-05-26): отдельные comment rows под основными rows.
                    Render'им вторую passing над answers чтобы соответствовать
                    React keys without nesting. */}
                {answers
                  .filter((row) => (row.tutor_comment ?? '').trim().length > 0)
                  .map((row) => (
                    <tr key={`comment-${row.kim_number}`} className="text-sky-800 bg-sky-50/40">
                      <td className="px-3 pb-2 pt-0 text-xs font-medium text-sky-700" colSpan={4}>
                        <span className="font-semibold">💬 KIM {row.kim_number} — комментарий репетитора:</span>{' '}
                        <span className="font-normal italic">«{row.tutor_comment}»</span>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Часть 2 ────────────────────────────────────────────────────────────────

/**
 * TASK-15 (ChatGPT-5.5 review): bulk Часть 2 photos на result page —
 * ученик после submit видит что он загрузил (verification) + post-approval
 * для «Твоё решение» reference. Phase 5 ARCH: photos живут в
 * `attempts.part2_bulk_photo_urls`, не в `mock_exam_attempt_part2_solutions.photo_url`.
 */
function Part2BulkPhotosGallery({
  photoUrls,
  collapsedByDefault = false,
}: {
  photoUrls: string[];
  collapsedByDefault?: boolean;
}) {
  if (photoUrls.length === 0) return null;
  return (
    <Card className="mb-3 shadow-none">
      <CardContent className="p-4 sm:p-5">
        <details open={!collapsedByDefault}>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 touch-manipulation">
            <span className="text-sm font-semibold text-slate-900">
              Загруженные фото решений Части 2
            </span>
            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
              {photoUrls.length} фото
            </span>
          </summary>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
            {photoUrls.map((url, idx) => (
              <a
                key={`${idx}-${url}`}
                href={url}
                target="_blank"
                rel="noreferrer"
                className="relative block aspect-square overflow-hidden rounded-md border border-slate-200 bg-white touch-manipulation"
              >
                <img
                  src={url}
                  alt={`Фото решения ${idx + 1}`}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
                <span className="absolute bottom-1 right-1 rounded bg-black/50 px-1.5 py-0.5 text-xs font-semibold text-white">
                  {idx + 1}
                </span>
              </a>
            ))}
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

function Part2PendingCard({ tutorName }: { tutorName: string | null }) {
  return (
    <Card className="mb-3 border-2 border-amber-300 bg-amber-50 shadow-none">
      <CardContent className="p-5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-slate-900">
            Часть 2 · ждёт проверки репетитора
          </h2>
          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
            В обработке
          </span>
        </div>
        <p className="mb-3 text-sm text-slate-700">
          {tutorName
            ? `Репетитор ${tutorName} проверяет твои решения 21–26.`
            : 'Репетитор проверяет твои решения 21–26.'}{' '}
          Результат придёт в Telegram в течение 24 часов.
        </p>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Clock className="h-4 w-4" aria-hidden="true" />
          <span>Обычно занимает 6–24 часа</span>
        </div>
      </CardContent>
    </Card>
  );
}

function Part2SolutionCard({
  solution,
}: {
  solution: StudentMockExamResultPart2Solution;
}) {
  const score = solution.tutor_score ?? null;
  const hasComment = Boolean(
    solution.tutor_comment && solution.tutor_comment.trim().length > 0,
  );
  const hasSolutionText = Boolean(
    solution.solution_text && solution.solution_text.trim().length > 0,
  );

  return (
    <Card className="shadow-none">
      <CardContent className="p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <span className="rounded bg-slate-100 px-2 py-1 text-sm font-semibold text-slate-900">
            №{solution.kim_number}
            {solution.topic ? ` · ${solution.topic}` : ''}
          </span>
          <span className="text-sm tabular-nums text-slate-700">
            {typeof score === 'number' ? `${score}` : '—'}
            <span className="text-slate-400"> / {solution.max_score}</span>
          </span>
        </div>

        {solution.task_text && (
          <MathBlock
            text={solution.task_text}
            className="text-sm leading-6 text-slate-700"
          />
        )}

        {solution.task_image_url && (
          <img
            src={solution.task_image_url}
            alt={`Условие задания №${solution.kim_number}`}
            loading="lazy"
            className="mt-3 max-h-72 w-full rounded-md border border-slate-200 bg-slate-50 object-contain"
          />
        )}

        {solution.photo_url && (
          <div className="mt-3">
            <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">
              Твоё решение
            </p>
            <img
              src={solution.photo_url}
              alt={`Твоё решение задания №${solution.kim_number}`}
              loading="lazy"
              className="max-h-80 w-full rounded-md border border-slate-200 bg-slate-50 object-contain"
            />
          </div>
        )}

        {hasComment && (
          <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide">
              Комментарий репетитора
            </p>
            <p className="whitespace-pre-wrap leading-6">
              {solution.tutor_comment}
            </p>
          </div>
        )}

        {hasSolutionText && (
          <details className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800">
            <summary className="cursor-pointer touch-manipulation font-medium text-slate-900">
              Эталонное решение
            </summary>
            <div className="mt-2 leading-6">
              <MathBlock
                text={solution.solution_text ?? ''}
                className="whitespace-pre-wrap"
              />
            </div>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

function Part2ApprovedSection({
  solutions,
  totalScore,
  part2Max,
}: {
  solutions: StudentMockExamResultPart2Solution[];
  totalScore: number | null;
  part2Max: number | null;
}) {
  const fallbackTotal = useMemo(
    () => solutions.reduce((acc, row) => acc + (row.tutor_score ?? 0), 0),
    [solutions],
  );
  const fallbackMax = useMemo(
    () => solutions.reduce((acc, row) => acc + (row.max_score ?? 0), 0),
    [solutions],
  );
  const score = typeof totalScore === 'number' ? totalScore : fallbackTotal;
  const max =
    typeof part2Max === 'number' && part2Max > 0 ? part2Max : fallbackMax;

  return (
    <section className="mb-3">
      <Card className="mb-3 shadow-none">
        <CardContent className="p-5">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-slate-900">
              Часть 2 · проверено
            </h2>
            <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-900">
              <ShieldCheck className="mr-1 inline h-3 w-3" aria-hidden="true" />
              Готово
            </span>
          </div>
          <div className="text-3xl font-semibold text-accent tabular-nums">
            {score}{' '}
            <span className="text-lg font-normal text-slate-500">/ {max}</span>
          </div>
        </CardContent>
      </Card>
      {solutions.length > 0 && (
        <div className="space-y-3">
          {solutions.map((solution) => (
            <Part2SolutionCard
              key={solution.kim_number}
              solution={solution}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Final summary (only when approved) ─────────────────────────────────────

function FinalSummary({
  totalScore,
  totalMax,
  part1Score,
  part1Max,
  part2Score,
  part2Max,
}: {
  totalScore: number | null;
  totalMax: number | null;
  part1Score: number | null;
  part1Max: number | null;
  part2Score: number | null;
  part2Max: number | null;
}) {
  if (
    typeof totalScore !== 'number' ||
    typeof totalMax !== 'number' ||
    totalMax <= 0
  ) {
    return null;
  }

  const ratio = Math.max(0, Math.min(1, totalScore / totalMax));
  const percent = Math.round(ratio * 100);
  // Pilot benchmark anchors (mockup): 22 порог / 36 «хорошо» / 54 max.
  // We avoid hardcoded test-score conversion (Phase 2) — show только бенчмарк.
  const passThreshold = Math.round(totalMax * 0.4); // 22/54 ≈ 0.4
  const goodThreshold = Math.round(totalMax * 0.66); // 36/54 ≈ 0.66

  // TASK-16: ФИПИ 2025 шкала — primary → secondary. Только для ЕГЭ физика
  // (max primary = 45 в variant1). Phase 2: добавить per-subject lookup.
  const secondaryScore =
    totalMax === 45 ? primaryToSecondary(totalScore) : null;

  return (
    <Card className="mb-3 shadow-none">
      <CardContent className="p-5 text-center">
        <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">
          Итоговый балл
        </p>
        <div className="mb-2 text-5xl font-semibold text-accent tabular-nums sm:text-6xl">
          {totalScore}{' '}
          <span className="text-2xl font-normal text-slate-500 sm:text-3xl">
            / {totalMax}
          </span>
        </div>
        {secondaryScore !== null ? (
          <p className="mb-1 text-base font-medium text-slate-700">
            ≈ {secondaryScore} тестовых баллов
          </p>
        ) : null}
        <p className="mb-4 text-sm text-slate-500">
          {secondaryScore !== null
            ? 'Ориентировочная оценка по шкале ФИПИ 2025. Точная — после публикации шкалы 2026.'
            : 'Тестовый балл будет известен после публикации шкалы ЕГЭ-2026'}
        </p>

        <div className="mb-4 mt-5">
          <div className="relative h-3 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-emerald-500 transition-[width]"
              style={{ width: `${percent}%` }}
              aria-label={`Прогресс ${percent}%`}
            />
          </div>
          <div className="mt-1.5 flex justify-between text-xs tabular-nums text-slate-400">
            <span>0</span>
            <span className="text-amber-600">{passThreshold} порог</span>
            <span className="text-emerald-700">{goodThreshold} хорошо</span>
            <span>{totalMax}</span>
          </div>
        </div>

        <div className="flex justify-center gap-6 text-sm">
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">
              Часть 1
            </div>
            <div className="font-semibold tabular-nums text-slate-900">
              {part1Score ?? 0}
              <span className="text-slate-400">
                {' '}
                / {part1Max ?? 0}
              </span>
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">
              Часть 2
            </div>
            <div className="font-semibold tabular-nums text-slate-900">
              {part2Score ?? 0}
              <span className="text-slate-400">
                {' '}
                / {part2Max ?? 0}
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Manual entry view ──────────────────────────────────────────────────────

function ManualEntryView({ view }: { view: StudentMockExamResultView }) {
  const score = view.attempt.total_score ?? 0;
  const max = view.variant?.total_max_score ?? null;
  const date = formatDate(view.attempt.manual_entered_date);
  const comment = view.attempt.manual_comment;

  return (
    <Card className="mb-3 shadow-none">
      <CardContent className="p-5 text-center">
        <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">
          Результат прошлого пробника
        </p>
        <div className="mb-2 text-4xl font-semibold text-accent tabular-nums sm:text-5xl">
          {score}
          {typeof max === 'number' && (
            <span className="text-xl font-normal text-slate-500 sm:text-2xl">
              {' '}
              / {max}
            </span>
          )}
        </div>
        {date && <p className="mb-3 text-sm text-slate-500">Сдан {date}</p>}
        {comment && (
          <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-left text-sm text-slate-700">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Комментарий репетитора
            </p>
            <p className="whitespace-pre-wrap leading-6">{comment}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Status helpers ─────────────────────────────────────────────────────────

function isPart2PendingStatus(status: MockExamAttemptStatus): boolean {
  return (
    status === 'submitted' ||
    status === 'ai_checking' ||
    status === 'awaiting_review'
  );
}

// ─── Часть 1 banners (TASK-OCR Round 4, 2026-05-21) ─────────────────────────
//
// Vladimir UX request: ученик в blank mode должен видеть Часть 1 сразу после
// OCR (~30-60 сек), не дожидаясь tutor approve. С 2 banners:
//   - Pending: «Давай проверим твой бланк» (status=submitted/ai_checking, нет данных)
//   - Preliminary: «Предварительный результат — репетитор может скорректировать»
//                  (status=awaiting_review ИЛИ pre-approval с данными)
//
// Form-mode студенты после submit сразу попадают в awaiting_review с
// заполненной частью 1 → видят preliminary банер пока tutor не approve.

function Part1WaitingForOCRBanner() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="mb-3 rounded-lg border border-sky-200 bg-sky-50 p-4"
    >
      <div className="flex items-center gap-3">
        <Loader2
          className="h-5 w-5 flex-shrink-0 animate-spin text-sky-600"
          aria-hidden="true"
        />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-sky-900">
            Давай проверим твой бланк ответов
          </p>
          <p className="mt-0.5 text-xs text-sky-800">
            AI распознаёт фото бланка и считает баллы Часть 1. Обычно занимает
            30-60 секунд. Эта страница обновится автоматически.
          </p>
        </div>
      </div>
    </div>
  );
}

function Part1PreliminaryBanner() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="mb-3 rounded-lg border border-sky-200 bg-sky-50 p-4"
    >
      <div className="flex items-start gap-3">
        <Sparkles
          className="h-5 w-5 flex-shrink-0 text-sky-600"
          aria-hidden="true"
        />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-sky-900">
            Предварительный результат Часть 1
          </p>
          <p className="mt-0.5 text-xs text-sky-800">
            AI распознал бланк и посчитал предварительный балл. Репетитор
            проверит вручную и пришлёт обновление в течение суток. Часть 2 ещё
            в проверке.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

function ResultContent({ view }: { view: StudentMockExamResultView }) {
  const status = view.attempt.status;
  const tutorFirstName = getTutorFirstName(view.tutor?.name);
  const isApproved = status === 'approved';
  const isManualEntered = status === 'manually_entered';
  const isPending = isPart2PendingStatus(status);

  const part1Max = view.variant?.part1_max ?? null;
  const part2Max = view.variant?.part2_max ?? null;
  const totalMax = view.variant?.total_max_score ?? null;

  // TASK-OCR Round 4 (2026-05-21): derive Часть 1 reveal state.
  // - hasPart1Data:    backend вернул per-KIM rows ИЛИ total_part1_score
  //                    (form-mode auto-check ИЛИ blank-mode OCR done).
  // - isWaitingForOCR: ученик сдал, но AI ещё считает (нет rows + статус pre-approval).
  // - isPreliminary:   данные есть, но tutor ещё не подтвердил.
  const hasPart1Data =
    view.part1_answers.length > 0
    || (view.attempt.total_part1_score !== null && view.attempt.total_part1_score !== undefined);
  const isPreApproval = status === 'submitted' || status === 'ai_checking' || status === 'awaiting_review';
  const isWaitingForOCR = isPreApproval && !hasPart1Data;
  const isPreliminary = isPreApproval && hasPart1Data;

  return (
    <div className="sokrat min-h-[100dvh] bg-slate-50" data-sokrat-mode="student">
      <PageContent>
        <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
          <ResultHeader view={view} />

          {isManualEntered ? (
            <ManualEntryView view={view} />
          ) : (
            <>
              {/* TASK-OCR Round 4: Часть 1 reveal banners. Order:
                  1. Waiting banner — пока OCR работает (нет данных)
                  2. Preliminary banner — данные есть, ждём финального approve
                  3. Part1Card с chip («Предварительно» / «Готово») */}
              {isWaitingForOCR && <Part1WaitingForOCRBanner />}
              {isPreliminary && <Part1PreliminaryBanner />}

              {hasPart1Data && (
                <Part1Card
                  answers={view.part1_answers}
                  totalScore={view.attempt.total_part1_score}
                  part1Max={part1Max}
                  status={status}
                />
              )}

              {isPending && <Part2PendingCard tutorName={tutorFirstName} />}

              {/* TASK-15: bulk Часть 2 photos. Pending — collapsed (ученик
                  knows what он uploaded, не нужно занимать viewport).
                  Approved — expanded под итоговым «Часть 2 проверено». */}
              {(isPending || isApproved) && (
                <Part2BulkPhotosGallery
                  photoUrls={view.attempt.part2_bulk_photo_urls ?? []}
                  collapsedByDefault={isPending}
                />
              )}

              {isApproved && (
                <Part2ApprovedSection
                  solutions={view.part2_solutions}
                  totalScore={view.attempt.total_part2_score}
                  part2Max={part2Max}
                />
              )}

              {isApproved ? (
                <FinalSummary
                  totalScore={view.attempt.total_score}
                  totalMax={totalMax}
                  part1Score={view.attempt.total_part1_score}
                  part1Max={part1Max}
                  part2Score={view.attempt.total_part2_score}
                  part2Max={part2Max}
                />
              ) : isPending ? (
                <Card className="mb-3 bg-slate-100 shadow-none">
                  <CardContent className="p-5 text-center text-sm text-slate-500">
                    После проверки репетитора здесь появится итоговый балл
                    (Часть 1 + Часть 2), сравнение со шкалой ЕГЭ и
                    комментарий репетитора.
                  </CardContent>
                </Card>
              ) : null}
            </>
          )}
        </main>
      </PageContent>
    </div>
  );
}

export default function StudentMockExamResult() {
  const { id } = useParams<{ id: string }>();
  const assignmentId = id ?? '';
  const navigate = useNavigate();

  const result = useStudentMockExamResult(assignmentId);

  // If still in_progress, redirect back to taking surface.
  useEffect(() => {
    if (result.isStillInProgress && assignmentId) {
      navigate(`/student/mock-exams/${assignmentId}`, { replace: true });
    }
  }, [result.isStillInProgress, assignmentId, navigate]);

  return (
    <AuthGuard>
      {result.isLoading && (
        <div
          className="sokrat grid min-h-[60dvh] place-items-center bg-slate-50 px-4"
          data-sokrat-mode="student"
        >
          <div className="flex items-center gap-3 text-slate-600">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            Загружаю результат...
          </div>
        </div>
      )}

      {!result.isLoading && result.isStillInProgress && (
        <div
          className="sokrat grid min-h-[60dvh] place-items-center bg-slate-50 px-4"
          data-sokrat-mode="student"
        >
          <div className="flex items-center gap-3 text-slate-600">
            <Hourglass className="h-5 w-5 animate-pulse" aria-hidden="true" />
            Возвращаемся к работе...
          </div>
        </div>
      )}

      {!result.isLoading &&
        !result.isStillInProgress &&
        (result.error || result.isNotFound) && (
          <div
            className="sokrat min-h-[60dvh] bg-slate-50 px-4 py-8"
            data-sokrat-mode="student"
          >
            <Card className="mx-auto max-w-xl border-rose-200 shadow-none">
              <CardContent className="p-5">
                <div className="mb-2 flex items-center gap-2 text-base font-semibold text-rose-800">
                  <AlertCircle className="h-5 w-5" aria-hidden="true" />
                  {result.isNotFound
                    ? 'Результат не найден'
                    : 'Не удалось открыть результат'}
                </div>
                <p className="mb-3 text-sm text-slate-600">
                  {result.isNotFound
                    ? 'Похоже, этот пробник тебе не назначен или был удалён.'
                    : result.error instanceof StudentMockExamApiError
                      ? result.error.message
                      : 'Проверь подключение и попробуй ещё раз.'}
                </p>
                <div className="flex flex-wrap gap-2">
                  {!result.isNotFound && (
                    <Button
                      type="button"
                      variant="outline"
                      className="touch-manipulation"
                      onClick={() => result.refetch()}
                    >
                      Обновить
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    className="touch-manipulation"
                    onClick={() => navigate('/student')}
                  >
                    К списку заданий
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

      {!result.isLoading &&
        !result.isStillInProgress &&
        !result.error &&
        !result.isNotFound &&
        result.data && <ResultContent view={result.data} />}
    </AuthGuard>
  );
}

