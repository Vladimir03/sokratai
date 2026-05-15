// Mock Exams v1 — TASK-11: tutor review surface (per-task approve + global).
//
// Job: R4 — controlled approval AI Часть 2 черновика, главный контракт продукта.
// AC-5: tutor approves → status=approved → push student.
// Spec: docs/delivery/features/mock-exams-v1/spec.md AC-5
// Mockup: SokratAI/docs/delivery/features/mock-exams-v1/mockup.html (Screen 4)
// Product nuances:
//   #1 — AI показывает "почему" (4 элемента I-IV), не только "сколько"
//   #2 — anonymous lead bar выше чем existing student → нет bulk approve
//   #9 — per-task approve, global "Подтвердить и отправить" disabled пока не
//        закрыты все 6 part-2 задач + confirmation modal
//
// Анти-патерны:
//   • Lucide icons вместо emoji в chrome (.claude/rules/90-design-system.md)
//   • shadcn Card / Button / Badge / AlertDialog
//   • action-first: «Подтвердить» / «Изменить» — основные глаголы, не chat
//   • MathText для condition + comment (ЕГЭ задачи содержат LaTeX-формулы)
//   • Score override read-only с явным «Изменить» (nuance #3)

import { lazy, memo, Suspense, useCallback, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  Info,
  Lock,
  Pencil,
  Sparkles,
  X,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { TutorDataStatus } from '@/components/tutor/TutorDataStatus';
import { MockExamFeatureGate } from './MockExamFeatureGate';
import { useMockExamAssignment } from '@/hooks/useMockExamAssignment';
import { useMockExamAttempt } from '@/hooks/useMockExamAttempt';
import { MOCK_EXAM_ATTEMPT_QUERY_KEY } from '@/hooks/useMockExamAttempt';
import { MOCK_EXAM_ASSIGNMENT_QUERY_KEY } from '@/hooks/useMockExamAssignment';
import { MOCK_EXAM_ASSIGNMENTS_QUERY_KEY } from '@/hooks/useMockExamAssignments';
import {
  approveMockExamAll,
  approveMockExamTask,
  finalizeMockExamPart1,
  setMockExamPart1ManualScore,
  MockExamApiError,
} from '@/lib/mockExamApi';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { formatMockScore } from '@/components/tutor/mock-exams/mockHeatmapStyles';
import type {
  MockExamAttemptDetail,
  MockExamAttemptPart2Solution,
  MockExamConfidence,
} from '@/types/mockExam';

// LaTeX рендеринг — lazy, см. .claude/rules/50-kb-module.md
const MathText = lazy(() =>
  import('@/components/kb/ui/MathText').then((m) => ({ default: m.MathText })),
);

// ─── Constants ───────────────────────────────────────────────────────────────

const PART2_KIM_NUMBERS = [21, 22, 23, 24, 25, 26] as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTime(minutes: number | null): string {
  if (minutes === null) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} мин`;
  if (m === 0) return `${h} ч`;
  return `${h} ч ${m} мин`;
}

function isAnonymous(attempt: MockExamAttemptDetail): boolean {
  return attempt.student_id === null && attempt.anonymous_id !== null;
}

function studentNameOrFallback(attempt: MockExamAttemptDetail): string {
  if (attempt.student_display_name?.trim()) return attempt.student_display_name;
  if (attempt.anonymous_id) return 'Анонимный лид';
  return 'Без имени';
}

const CONFIDENCE_CONFIG: Record<
  MockExamConfidence,
  { label: string; className: string; icon: typeof Check }
> = {
  high: {
    label: 'AI уверен',
    className: 'text-emerald-700 dark:text-emerald-300',
    icon: CheckCircle2,
  },
  medium: {
    label: 'AI колеблется',
    className: 'text-amber-700 dark:text-amber-300',
    icon: AlertCircle,
  },
  low: {
    label: 'AI не уверен',
    className: 'text-rose-700 dark:text-rose-300',
    icon: AlertCircle,
  },
};

// ─── Score override dialog ───────────────────────────────────────────────────

interface EditScoreDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kimNumber: number;
  initialScore: number;
  maxScore: number;
  initialComment: string;
  onSubmit: (score: number, comment: string) => void;
  isSubmitting: boolean;
}

function EditScoreDialog({
  open,
  onOpenChange,
  kimNumber,
  initialScore,
  maxScore,
  initialComment,
  onSubmit,
  isSubmitting,
}: EditScoreDialogProps) {
  const [score, setScore] = useState<string>(String(initialScore));
  const [comment, setComment] = useState<string>(initialComment);

  // Reset on open with fresh initial values.
  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (next) {
        setScore(String(initialScore));
        setComment(initialComment);
      }
      onOpenChange(next);
    },
    [initialComment, initialScore, onOpenChange],
  );

  const numeric = Number.parseInt(score, 10);
  const isValid =
    Number.isFinite(numeric) && numeric >= 0 && numeric <= maxScore;

  const handleConfirm = () => {
    if (!isValid) return;
    onSubmit(numeric, comment.trim());
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Изменить балл · №{kimNumber}</DialogTitle>
          <DialogDescription>
            Этот балл попадёт ученику и родителю после общего подтверждения. Можно
            оставить комментарий — он будет виден ученику в разборе.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <label
              htmlFor="score-input"
              className="block text-sm font-medium text-slate-700 mb-1.5"
            >
              Балл (0..{maxScore})
            </label>
            <input
              id="score-input"
              type="number"
              inputMode="numeric"
              min={0}
              max={maxScore}
              value={score}
              onChange={(e) => setScore(e.target.value)}
              className="w-32 px-3 py-2 border border-slate-200 rounded-md text-base font-mono tabular-nums focus:ring-2 focus:ring-accent/20 focus:border-accent"
            />
          </div>
          <div>
            <label
              htmlFor="comment-input"
              className="block text-sm font-medium text-slate-700 mb-1.5"
            >
              Комментарий (опционально)
            </label>
            <textarea
              id="comment-input"
              rows={3}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Например: ход решения верный, но потеряны единицы"
              className="w-full px-3 py-2 border border-slate-200 rounded-md text-base focus:ring-2 focus:ring-accent/20 focus:border-accent"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Отмена
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!isValid || isSubmitting}
          >
            {isSubmitting ? 'Сохранение…' : `Подтвердить: ${score} / ${maxScore}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Element check chip (I/II/III/IV) ────────────────────────────────────────

interface ElementChipProps {
  label: string;
  passed: boolean;
}

const ElementChip = memo(function ElementChip({ label, passed }: ElementChipProps) {
  if (passed) {
    return (
      <div className="flex items-start gap-2 p-2 bg-emerald-50 border border-emerald-100 rounded text-sm dark:bg-emerald-950/30 dark:border-emerald-900">
        <Check className="h-4 w-4 text-emerald-600 flex-shrink-0 mt-0.5" aria-hidden="true" />
        <div className="text-emerald-900 dark:text-emerald-200">{label}</div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2 p-2 bg-red-50 border border-red-100 rounded text-sm dark:bg-red-950/30 dark:border-red-900">
      <X className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" aria-hidden="true" />
      <div className="text-red-900 dark:text-red-200">{label}</div>
    </div>
  );
});

// ─── Part 1 blank-mode manual scoring panel (TASK-11) ───────────────────────
//
// Ученик отвечал на Часть 1 на ФИПИ бланке от руки. Auto-check невозможен,
// tutor вводит earned_score вручную по каждому KIM. Photo бланка показан выше.
// Auto-save per row через `setMockExamPart1ManualScore`. Финализация total —
// `finalizeMockExamPart1` (button «Часть 1 проверена» / on-blur от последнего
// edit'а).

function Part1BlankReviewPanel({ attempt, variantPart1Tasks }: {
  attempt: MockExamAttemptDetail;
  variantPart1Tasks: { kim_number: number; max_score: number }[];
}) {
  const queryClient = useQueryClient();
  const blankPhotoUrl = attempt.blank_photo_url ?? null;
  const fallbackPhotoUrl = attempt.part1_blank_photo_url ?? null;

  // Map existing earned_score by kim_number (from auto-loaded part1_answers).
  const existingScores = useMemo(() => {
    const m = new Map<number, number | null>();
    for (const a of attempt.part1_answers) {
      m.set(a.kim_number, a.earned_score);
    }
    return m;
  }, [attempt.part1_answers]);

  // Local draft state — позволяет редактировать без блокировки на каждый change.
  const [drafts, setDrafts] = useState<Record<number, string>>(() => {
    const initial: Record<number, string> = {};
    for (const t of variantPart1Tasks) {
      const v = existingScores.get(t.kim_number);
      initial[t.kim_number] = v !== null && v !== undefined ? String(v) : '';
    }
    return initial;
  });

  const [savingKim, setSavingKim] = useState<number | null>(null);
  const [isFinalizing, setIsFinalizing] = useState(false);

  const isReadOnly =
    attempt.status === 'approved' || attempt.status === 'manually_entered';

  const handleScoreBlur = async (kim: number, maxScore: number) => {
    const raw = drafts[kim] ?? '';
    if (raw.trim() === '') return; // пусто — не сохраняем
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > maxScore) {
      toast.error(`Балл для KIM ${kim}: 0..${maxScore}`);
      // restore previous
      const prev = existingScores.get(kim);
      setDrafts((d) => ({ ...d, [kim]: prev !== null && prev !== undefined ? String(prev) : '' }));
      return;
    }
    if (existingScores.get(kim) === parsed) return; // no change
    setSavingKim(kim);
    try {
      await setMockExamPart1ManualScore(attempt.id, {
        kim_number: kim,
        earned_score: parsed,
      });
      void queryClient.invalidateQueries({
        queryKey: MOCK_EXAM_ATTEMPT_QUERY_KEY(attempt.id),
      });
    } catch (err) {
      const msg =
        err instanceof MockExamApiError ? err.message : 'Не удалось сохранить балл';
      toast.error(msg);
    } finally {
      setSavingKim(null);
    }
  };

  const handleFinalize = async () => {
    setIsFinalizing(true);
    try {
      const res = await finalizeMockExamPart1(attempt.id);
      toast.success(`Часть 1 пересчитана: ${res.total_part1_score} баллов`);
      void queryClient.invalidateQueries({
        queryKey: MOCK_EXAM_ATTEMPT_QUERY_KEY(attempt.id),
      });
    } catch (err) {
      const msg =
        err instanceof MockExamApiError ? err.message : 'Не удалось пересчитать';
      toast.error(msg);
    } finally {
      setIsFinalizing(false);
    }
  };

  const draftSum = useMemo(() => {
    let sum = 0;
    for (const t of variantPart1Tasks) {
      const v = Number.parseInt(drafts[t.kim_number] ?? '', 10);
      if (Number.isFinite(v)) sum += v;
    }
    return sum;
  }, [drafts, variantPart1Tasks]);
  const part1Max = variantPart1Tasks.reduce((a, t) => a + t.max_score, 0);

  return (
    <Card animate={false} className="border-amber-200 bg-amber-50/40 dark:bg-amber-950/10 dark:border-amber-900">
      <CardContent className="p-4 sm:p-5 space-y-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Pencil className="h-4 w-4 text-amber-700 dark:text-amber-300" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
              Часть 1: ручная проверка по ФИПИ-бланку
            </h2>
          </div>
          <p className="text-xs text-amber-800 dark:text-amber-300/90 leading-relaxed">
            Ученик заполнял бланк от руки (выбран режим «бланк ФИПИ»).
            Сверь ответы с фото ниже и поставь баллы по каждой задаче 1–20.
          </p>
        </div>

        {(blankPhotoUrl || fallbackPhotoUrl) && (
          <div className="grid gap-3 sm:grid-cols-2">
            {blankPhotoUrl && (
              <a href={blankPhotoUrl} target="_blank" rel="noreferrer" className="block">
                <div className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  ФИПИ-бланк (Часть 1)
                </div>
                <img
                  src={blankPhotoUrl}
                  alt="ФИПИ бланк"
                  loading="lazy"
                  className="w-full rounded-md border border-slate-300 bg-white object-contain max-h-[420px]"
                />
              </a>
            )}
            {fallbackPhotoUrl && (
              <a href={fallbackPhotoUrl} target="_blank" rel="noreferrer" className="block">
                <div className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Доп. фото Часть 1 (не на бланке)
                </div>
                <img
                  src={fallbackPhotoUrl}
                  alt="Фото ответов Часть 1"
                  loading="lazy"
                  className="w-full rounded-md border border-slate-300 bg-white object-contain max-h-[420px]"
                />
              </a>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {variantPart1Tasks.map((t) => (
            <label
              key={t.kim_number}
              className="flex flex-col gap-1 p-2 rounded-md bg-white border border-amber-200 dark:bg-slate-900 dark:border-amber-900"
            >
              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                KIM {t.kim_number} <span className="text-slate-400">/ {t.max_score}</span>
              </span>
              <Input
                type="number"
                inputMode="numeric"
                min={0}
                max={t.max_score}
                step={1}
                disabled={isReadOnly || savingKim === t.kim_number}
                value={drafts[t.kim_number] ?? ''}
                onChange={(e) =>
                  setDrafts((d) => ({ ...d, [t.kim_number]: e.target.value }))
                }
                onBlur={() => void handleScoreBlur(t.kim_number, t.max_score)}
                className="text-base"
                placeholder="—"
                aria-label={`Баллы за KIM ${t.kim_number}`}
              />
            </label>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-amber-200">
          <div className="text-sm text-amber-900 dark:text-amber-200">
            Сумма draft: <strong>{draftSum}</strong> / {part1Max}
            {attempt.total_part1_score !== null && (
              <span className="ml-2 text-amber-700 dark:text-amber-300/80">
                (сохранено: {attempt.total_part1_score})
              </span>
            )}
          </div>
          <Button
            type="button"
            onClick={handleFinalize}
            disabled={isReadOnly || isFinalizing}
            className="bg-amber-600 hover:bg-amber-700 text-white"
          >
            {isFinalizing ? 'Пересчитываем…' : 'Часть 1 проверена'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Part 1 summary card ─────────────────────────────────────────────────────

function Part1SummaryCard({ attempt }: { attempt: MockExamAttemptDetail }) {
  const part1Max = attempt.part1_answers.reduce(
    (acc, a) => acc + (a.max_score ?? 0),
    0,
  );
  const part1Score = attempt.total_part1_score ?? 0;
  const correctCount = attempt.part1_answers.filter(
    (a) => (a.earned_score ?? 0) === (a.max_score ?? 0) && a.max_score > 0,
  ).length;
  const partialCount = attempt.part1_answers.filter(
    (a) =>
      (a.earned_score ?? 0) > 0 &&
      (a.earned_score ?? 0) < (a.max_score ?? 0),
  ).length;
  const wrongCount = attempt.part1_answers.filter(
    (a) =>
      a.student_answer !== null &&
      (a.earned_score ?? 0) === 0 &&
      a.max_score > 0,
  ).length;

  return (
    <Card animate={false} className="bg-emerald-50 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-900">
      <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div className="flex items-start gap-3">
          <div
            className="h-9 w-9 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300 flex items-center justify-center flex-shrink-0"
            aria-hidden="true"
          >
            <Lock className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-medium text-emerald-900 dark:text-emerald-200">
              Часть 1: {formatMockScore(part1Score)} из {formatMockScore(part1Max)} баллов
            </p>
            <p className="text-xs text-emerald-800 dark:text-emerald-300/90 mt-0.5">
              Auto-проверено по бланку. Верно {correctCount} · частично {partialCount} · неверно {wrongCount}.
            </p>
          </div>
        </div>
        <Badge
          variant="outline"
          className="border-emerald-300 text-emerald-800 bg-white/60 self-start sm:self-center"
        >
          Не редактируется
        </Badge>
      </CardContent>
    </Card>
  );
}

// ─── Part 2 task card ────────────────────────────────────────────────────────

interface Part2TaskCardProps {
  attemptId: string;
  solution: MockExamAttemptPart2Solution;
  attemptStatus: MockExamAttemptDetail['status'];
}

function Part2TaskCard({ attemptId, solution, attemptStatus }: Part2TaskCardProps) {
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);

  const isApproved =
    solution.status === 'tutor_approved' || solution.status === 'tutor_modified';
  const isReadOnlyAttempt =
    attemptStatus === 'approved' || attemptStatus === 'manually_entered';

  const aiDraft = solution.ai_draft;
  const confidence = aiDraft?.confidence ?? 'low';
  const confCfg = CONFIDENCE_CONFIG[confidence];
  const ConfIcon = confCfg.icon;
  const isLowConf = confidence === 'low' || !aiDraft;
  const aiSuggested = aiDraft?.suggested_score ?? null;

  const elements = aiDraft?.elements_check ?? { I: false, II: false, III: false, IV: false };
  const isQualitative = aiDraft?.flags?.includes('kim21_qualitative');

  // Текущий tutor score: либо подтверждённый, либо AI suggestion как preselect.
  const displayScore =
    solution.tutor_score !== null
      ? solution.tutor_score
      : aiSuggested ?? null;

  const approveMutation = useMutation({
    mutationFn: ({ score, comment }: { score: number; comment: string }) =>
      approveMockExamTask(attemptId, {
        kim_number: solution.kim_number,
        score,
        comment: comment.length > 0 ? comment : null,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: MOCK_EXAM_ATTEMPT_QUERY_KEY(attemptId),
      });
      toast.success(`Задача №${solution.kim_number} подтверждена`);
      setEditOpen(false);
    },
    onError: (err) => {
      const msg =
        err instanceof MockExamApiError ? err.message : 'Не удалось сохранить';
      toast.error(msg);
    },
  });

  const handleQuickApprove = () => {
    if (aiSuggested === null) return;
    approveMutation.mutate({ score: aiSuggested, comment: '' });
  };

  const handleEditSubmit = (score: number, comment: string) => {
    approveMutation.mutate({ score, comment });
  };

  // Card shell — низкая уверенность красная рамка, иначе нейтральная.
  const cardClass = cn(
    'bg-white border rounded-lg overflow-hidden dark:bg-slate-900',
    isLowConf
      ? 'border-2 border-rose-300 dark:border-rose-700'
      : 'border-slate-200 dark:border-slate-800',
    isApproved && 'ring-1 ring-emerald-200',
  );

  const headerClass = cn(
    'px-4 py-3 border-b flex items-center justify-between flex-wrap gap-2',
    isLowConf
      ? 'bg-rose-50 border-rose-200 dark:bg-rose-950/30 dark:border-rose-900'
      : isApproved
        ? 'bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-900'
        : 'bg-slate-50 border-slate-100 dark:bg-slate-950 dark:border-slate-800',
  );

  return (
    <div className={cardClass}>
      {/* Card header: KIM + max score + AI confidence + AI suggested */}
      <div className={headerClass}>
        <div className="flex items-center gap-3 flex-wrap">
          <span
            className={cn(
              'px-2 py-0.5 text-xs font-semibold rounded',
              isQualitative
                ? 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200'
                : 'bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200',
            )}
          >
            №{solution.kim_number}{isQualitative ? ' · Качественная' : ' · Расчётная'}
          </span>
          <span className="text-sm text-slate-500 tabular-nums">
            макс. {solution.max_score} {solution.max_score === 1 ? 'балл' : 'балла'}
          </span>
          {aiDraft ? (
            <span
              className={cn(
                'text-xs font-medium flex items-center gap-1',
                confCfg.className,
              )}
              title="Уверенность AI в оценке"
            >
              <ConfIcon className="h-3.5 w-3.5" aria-hidden="true" />
              {confCfg.label}
            </span>
          ) : null}
        </div>
        <div className="text-sm text-slate-600 tabular-nums">
          {isApproved ? (
            <span className="text-emerald-700 font-medium flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              Подтверждено: <strong>{displayScore} / {solution.max_score}</strong>
            </span>
          ) : aiSuggested !== null ? (
            <>
              AI предлагает: <strong className="text-slate-900">{aiSuggested} / {solution.max_score}</strong>
            </>
          ) : (
            <span className="text-rose-700">AI не смог распознать</span>
          )}
        </div>
      </div>

      {/* Card body */}
      <div className="p-4 space-y-3">
        {/* Условие задачи */}
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500 mb-1.5">
            Условие
          </p>
          <Suspense fallback={<div className="text-sm text-slate-700">{solution.task_text}</div>}>
            <div className="text-sm text-slate-800 dark:text-slate-200 leading-relaxed">
              <MathText text={solution.task_text} />
            </div>
          </Suspense>
        </div>

        {/* Решение ученика — фото или alert */}
        {solution.photo_url ? (
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500 mb-1.5">
              Решение ученика (фото)
            </p>
            <a
              href={solution.photo_url}
              target="_blank"
              rel="noreferrer noopener"
              className="block max-w-md rounded-md border border-slate-200 overflow-hidden hover:border-slate-300 transition-colors"
              title="Открыть фото в новой вкладке"
            >
              <img
                src={solution.photo_url}
                alt={`Фото решения задачи №${solution.kim_number}`}
                loading="lazy"
                className="w-full h-auto object-contain bg-slate-50"
              />
            </a>
          </div>
        ) : (
          <div className="bg-rose-50 border border-rose-200 rounded p-3 flex items-start gap-2 dark:bg-rose-950/30 dark:border-rose-900">
            <AlertCircle
              className="h-4 w-4 text-rose-600 flex-shrink-0 mt-0.5"
              aria-hidden="true"
            />
            <div className="text-sm text-rose-900 dark:text-rose-200">
              Фото решения не загружено или нечитаемо. Запроси переснимку у ученика
              в Telegram или поставь оценку вручную.
            </div>
          </div>
        )}

        {/* Low-confidence явный alert (AC: nuance #5) */}
        {isLowConf && solution.photo_url ? (
          <div className="bg-rose-50 border border-rose-200 rounded p-3 flex items-start gap-2 dark:bg-rose-950/30 dark:border-rose-900">
            <AlertCircle
              className="h-4 w-4 text-rose-600 flex-shrink-0 mt-0.5"
              aria-hidden="true"
            />
            <div className="text-sm text-rose-900 dark:text-rose-200">
              <strong>AI не смог распознать.</strong> Открой фото и поставь оценку самостоятельно.
            </div>
          </div>
        ) : null}

        {/* Карта обоснования AI (4 элемента I-IV) — nuance #1 */}
        {aiDraft && !isQualitative ? (
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500 mb-2">
              AI-оценка по 4 элементам ФИПИ
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <ElementChip label="I. Закон / физическая модель" passed={elements.I} />
              <ElementChip label="II. Обозначения и формулы" passed={elements.II} />
              <ElementChip label="III. Расчёт + подстановка" passed={elements.III} />
              <ElementChip label="IV. Ответ + единицы" passed={elements.IV} />
            </div>
          </div>
        ) : null}

        {/* №21 — качественная: явный hint про 0..3 рубрику */}
        {aiDraft && isQualitative ? (
          <div className="bg-amber-50 border border-amber-200 rounded p-3 dark:bg-amber-950/30 dark:border-amber-900">
            <p className="text-xs text-amber-900 dark:text-amber-200">
              №21 — качественная задача с собственной 0..3 рубрикой (см. блок-схему ФИПИ).
            </p>
          </div>
        ) : null}

        {/* AI комментарий */}
        {aiDraft?.comment_for_tutor ? (
          <div className="text-sm text-slate-700 border-l-2 border-amber-300 pl-3 py-1 dark:text-slate-300">
            <Suspense fallback={<span>{aiDraft.comment_for_tutor}</span>}>
              <MathText text={aiDraft.comment_for_tutor} />
            </Suspense>
          </div>
        ) : null}

        {/* Tutor comment (если был при override) */}
        {solution.tutor_comment ? (
          <div className="bg-slate-50 border border-slate-200 rounded p-3 dark:bg-slate-800 dark:border-slate-700">
            <p className="text-xs text-slate-500 mb-1">Твой комментарий</p>
            <Suspense fallback={<p className="text-sm">{solution.tutor_comment}</p>}>
              <div className="text-sm text-slate-700 dark:text-slate-300">
                <MathText text={solution.tutor_comment} />
              </div>
            </Suspense>
          </div>
        ) : null}

        {/* Action row */}
        {!isReadOnlyAttempt ? (
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditOpen(true)}
              disabled={approveMutation.isPending}
            >
              <Pencil className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
              Изменить балл
            </Button>
            <Button
              size="sm"
              onClick={handleQuickApprove}
              disabled={aiSuggested === null || approveMutation.isPending}
              title={
                aiSuggested === null
                  ? 'AI не предложил балл — поставь вручную'
                  : 'Подтвердить балл, предложенный AI'
              }
            >
              {approveMutation.isPending && !editOpen ? (
                'Сохранение…'
              ) : (
                <>
                  <Check className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
                  Подтвердить: {aiSuggested ?? '?'} / {solution.max_score}
                </>
              )}
            </Button>
          </div>
        ) : null}
      </div>

      {/* Edit dialog */}
      <EditScoreDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        kimNumber={solution.kim_number}
        initialScore={displayScore ?? 0}
        maxScore={solution.max_score}
        initialComment={solution.tutor_comment ?? ''}
        onSubmit={handleEditSubmit}
        isSubmitting={approveMutation.isPending}
      />
    </div>
  );
}

// ─── Sticky-feel global-approve footer ───────────────────────────────────────

interface ApproveFooterProps {
  approvedCount: number;
  totalCount: number;
  onApprove: () => void;
  isSubmitting: boolean;
  isAnonymous: boolean;
  isAlreadyApproved: boolean;
}

function ApproveFooter({
  approvedCount,
  totalCount,
  onApprove,
  isSubmitting,
  isAnonymous,
  isAlreadyApproved,
}: ApproveFooterProps) {
  const allClosed = approvedCount === totalCount && totalCount > 0;

  if (isAlreadyApproved) {
    return (
      <div
        className="bg-emerald-50 border-2 border-emerald-200 rounded-lg p-4 flex items-center justify-between flex-wrap gap-3 dark:bg-emerald-950/30 dark:border-emerald-900"
        role="status"
      >
        <div className="text-sm flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden="true" />
          <div>
            <div className="font-medium text-emerald-900 dark:text-emerald-200">
              Работа подтверждена и отправлена
            </div>
            <div className="text-emerald-800 dark:text-emerald-300/90 text-xs mt-0.5">
              Ученик и родители уже видят результат.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-50 border-2 border-slate-200 rounded-lg p-4 flex items-center justify-between flex-wrap gap-3 dark:bg-slate-900 dark:border-slate-700">
      <div className="text-sm">
        <div className="font-medium text-slate-900 dark:text-slate-100 flex items-center gap-2">
          Подтверждено: {approvedCount} / {totalCount} заданий
          {isAnonymous ? (
            <span
              title="Анонимный лид — каждый пункт твоя репутация"
              className="inline-flex items-center text-rose-700 dark:text-rose-300 text-xs font-medium gap-1"
            >
              <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
              Анонимный лид
            </span>
          ) : null}
        </div>
        <div className="text-slate-500 text-xs mt-0.5">
          {isAnonymous
            ? 'Bulk-approve недоступен. Проверь каждый пункт вручную.'
            : 'После подтверждения ученик и родители получат результат. Перепроверка возможна.'}
        </div>
      </div>
      <Button
        size="lg"
        onClick={onApprove}
        disabled={!allClosed || isSubmitting}
        title={
          !allClosed
            ? `Закрой все ${totalCount} задач, чтобы отправить`
            : 'Подтвердить и отправить ученику'
        }
      >
        {isSubmitting ? 'Отправка…' : 'Подтвердить и отправить'}
      </Button>
    </div>
  );
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

function ReviewSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-7 w-1/2" />
      </div>
      <Skeleton className="h-16 w-full rounded-lg" />
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-72 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}

// ─── Main content ────────────────────────────────────────────────────────────

function TutorMockExamReviewContent() {
  const params = useParams<{ id: string; studentId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const assignmentId = params.id ?? null;
  const studentParam = params.studentId ?? null;

  // Step 1: load assignment to resolve studentId → attemptId.
  const {
    detail,
    loading: assignmentLoading,
    error: assignmentError,
  } = useMockExamAssignment(assignmentId);

  // Match attempt by student_id (auth user) ИЛИ anonymous_id (lead).
  const matchedAttempt = useMemo(() => {
    if (!detail || !studentParam) return null;
    return (
      detail.attempts.find((a) => a.student_id === studentParam) ??
      detail.attempts.find((a) => a.anonymous_id === studentParam) ??
      null
    );
  }, [detail, studentParam]);

  const attemptId = matchedAttempt?.id ?? null;

  // Step 2: load attempt detail.
  const {
    attempt,
    loading: attemptLoading,
    error: attemptError,
    refetch: refetchAttempt,
    isFetching: attemptFetching,
    isRecovering: attemptRecovering,
    failureCount: attemptFailureCount,
  } = useMockExamAttempt(attemptId);

  const [confirmOpen, setConfirmOpen] = useState(false);

  // Stable order of Часть 2 solutions (KIM 21..26 only). Computed before
  // conditional early returns to keep hook order stable.
  const part2Solutions = useMemo<MockExamAttemptPart2Solution[]>(() => {
    if (!attempt) return [];
    const allowedSet = new Set<number>(PART2_KIM_NUMBERS);
    return [...attempt.part2_solutions]
      .filter((s) => allowedSet.has(s.kim_number))
      .sort((a, b) => a.kim_number - b.kim_number);
  }, [attempt]);

  const approveAllMutation = useMutation({
    mutationFn: () => approveMockExamAll(attemptId as string),
    onSuccess: (resp) => {
      void queryClient.invalidateQueries({
        queryKey: MOCK_EXAM_ATTEMPT_QUERY_KEY(attemptId as string),
      });
      if (assignmentId) {
        void queryClient.invalidateQueries({
          queryKey: MOCK_EXAM_ASSIGNMENT_QUERY_KEY(assignmentId),
        });
      }
      void queryClient.invalidateQueries({
        queryKey: MOCK_EXAM_ASSIGNMENTS_QUERY_KEY,
      });
      const channel =
        resp.delivery.channel ?? null;
      if (channel) {
        toast.success(`Отправлено ученику · ${channel}`);
      } else {
        toast.success('Работа подтверждена');
      }
      setConfirmOpen(false);
      // Возврат на overview через короткую задержку, чтобы toast успел.
      setTimeout(() => {
        if (assignmentId) {
          navigate(`/tutor/mock-exams/${encodeURIComponent(assignmentId)}`);
        }
      }, 800);
    },
    onError: (err) => {
      const msg =
        err instanceof MockExamApiError ? err.message : 'Не удалось отправить';
      toast.error(msg);
    },
  });

  // Loading
  if (assignmentLoading || attemptLoading) {
    return <ReviewSkeleton />;
  }

  // Error states
  const error = assignmentError ?? attemptError;
  if (error && !attempt) {
    return (
      <TutorDataStatus
        error={error}
        isFetching={attemptFetching}
        isRecovering={attemptRecovering}
        failureCount={attemptFailureCount}
        onRetry={refetchAttempt}
      />
    );
  }

  // Not found (param mismatch)
  if (!detail || !matchedAttempt || !attempt) {
    return (
      <Card className="bg-muted/30">
        <CardContent className="flex flex-col items-center text-center gap-5 py-12">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
            <Info className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
          </div>
          <div className="space-y-1.5">
            <h3 className="font-semibold tracking-tight text-xl">
              Попытка не найдена
            </h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Возможно, ученик ещё не приступил, либо ссылка повреждена.
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link to={`/tutor/mock-exams/${assignmentId ?? ''}`}>
              К пробнику
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const approvedCount = part2Solutions.filter(
    (s) => s.status === 'tutor_approved' || s.status === 'tutor_modified',
  ).length;

  const studentName = studentNameOrFallback(attempt);
  const anonymous = isAnonymous(attempt);
  const draftPart2 = part2Solutions.reduce(
    (acc, s) =>
      acc +
      (s.status === 'tutor_approved' || s.status === 'tutor_modified'
        ? s.tutor_score ?? 0
        : s.ai_draft?.suggested_score ?? 0),
    0,
  );
  const part1Score = attempt.total_part1_score ?? 0;
  const part2Max = part2Solutions.reduce((acc, s) => acc + s.max_score, 0);
  const totalDraft = part1Score + draftPart2;
  const totalMax = attempt.total_max_score ?? part1Score + part2Max;
  const isAlreadyApproved =
    attempt.status === 'approved' || attempt.status === 'manually_entered';

  return (
    <div className="space-y-6 pb-24">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-slate-500 flex-wrap" aria-label="Хлебные крошки">
        <Link to="/tutor/mock-exams" className="hover:text-slate-900 transition-colors">
          Пробники
        </Link>
        <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        <Link
          to={`/tutor/mock-exams/${assignmentId ?? ''}`}
          className="hover:text-slate-900 transition-colors truncate max-w-[180px] sm:max-w-xs"
        >
          {detail.title}
        </Link>
        <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="text-slate-900 truncate">{studentName}</span>
      </nav>

      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div
            className="h-10 w-10 rounded-full bg-accent text-white flex items-center justify-center font-semibold flex-shrink-0"
            aria-hidden="true"
          >
            {studentName.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100 leading-tight">
                {studentName}
              </h1>
              {anonymous ? (
                <Badge
                  variant="outline"
                  className="border-rose-300 bg-rose-50 text-rose-800"
                >
                  Анонимный лид
                </Badge>
              ) : null}
            </div>
            <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1.5 flex-wrap">
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              Сдал за <span className="font-medium">{formatTime(attempt.total_time_minutes)}</span>
              {attempt.submitted_at ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{new Date(attempt.submitted_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}</span>
                </>
              ) : null}
            </p>
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted-foreground uppercase tracking-wide">
            Первичный балл {isAlreadyApproved ? '' : '(черновик)'}
          </div>
          <div className="text-3xl font-semibold text-accent tabular-nums">
            {totalDraft}{' '}
            <span className="text-base text-slate-500 font-normal">
              / {totalMax}
            </span>
          </div>
          <div className="text-xs text-muted-foreground mt-0.5 tabular-nums">
            Часть 1: {part1Score}/{attempt.part1_answers.reduce((a, x) => a + (x.max_score ?? 0), 0)} · Часть 2: {draftPart2}/{part2Max}
          </div>
        </div>
      </div>

      {/* Recovery / non-blocking errors */}
      <TutorDataStatus
        error={attemptError}
        isFetching={attemptFetching}
        isRecovering={attemptRecovering}
        failureCount={attemptFailureCount}
        onRetry={refetchAttempt}
      />

      {/* Часть 1 — read-only summary (form mode) или manual scoring (blank mode, TASK-11) */}
      {attempt.answer_method === 'blank' ? (
        <Part1BlankReviewPanel
          attempt={attempt}
          variantPart1Tasks={attempt.part1_answers.map((a) => ({
            kim_number: a.kim_number,
            max_score: a.max_score,
          }))}
        />
      ) : (
        <Part1SummaryCard attempt={attempt} />
      )}

      {/* Часть 2 banner — context for AI draft */}
      {!isAlreadyApproved && part2Solutions.length > 0 ? (
        <div
          role="note"
          className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30"
        >
          <Sparkles
            className="h-4 w-4 flex-shrink-0 mt-0.5 text-amber-600 dark:text-amber-400"
            aria-hidden="true"
          />
          <p className="text-sm text-amber-900 dark:text-amber-200">
            <strong>Часть 2: AI-черновик {draftPart2} из {part2Max}.</strong>{' '}
            Подтверди или скорректируй каждое задание. Без подтверждения ученик и родитель ничего не увидят.
          </p>
        </div>
      ) : null}

      {/* Phase 5 (2026-05-15): bulk-photo pack — единая лента всех фото
          Часть 2, которые ученик загрузил пакетом. Заменяет старую модель
          «1 фото на 1 задачу». Tutor видит все фото сразу и сам решает,
          где какая задача (Часть 2 cards ниже остаются для backward compat
          с pilot attempts, где per-kim photo_url ещё заполнен). */}
      {(attempt.part2_bulk_photo_urls ?? []).length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">
            Часть 2 — фото от ученика ({(attempt.part2_bulk_photo_urls ?? []).length})
          </h2>
          <Card>
            <CardContent className="py-4">
              <p className="mb-3 text-sm text-muted-foreground">
                Ученик загрузил решения Части 2 одним пакетом. Пролистай все фото и
                сам реши, какое относится к задаче №21–26. AI grader пока не разносит
                фото по задачам автоматически — выставляй баллы вручную в карточках ниже.
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                {(attempt.part2_bulk_photo_urls ?? []).map((url, idx) => (
                  <a
                    key={url + idx}
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="relative aspect-square overflow-hidden rounded-md border border-slate-200 bg-white transition-shadow hover:shadow-md"
                    aria-label={`Открыть фото ${idx + 1} в новой вкладке`}
                  >
                    <img
                      src={url}
                      alt={`Часть 2 — фото ${idx + 1}`}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                    <span className="absolute bottom-1 right-1 rounded bg-black/55 px-1.5 py-0.5 text-xs font-semibold text-white">
                      {idx + 1}
                    </span>
                  </a>
                ))}
              </div>
            </CardContent>
          </Card>
        </section>
      )}

      {/* Часть 2 cards — per-kim карточки. Для bulk attempts (Phase 5+)
          photo_url обычно null (AI grader пока не assign'ит фото к задачам),
          tutor выставляет баллы из bulk-ленты выше. Для pilot attempts (до
          Phase 5) photo_url содержит per-kim фото, отображается в карточке. */}
      {part2Solutions.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">
            Часть 2 — оценка по задачам ({part2Solutions.length} {part2Solutions.length === 1 ? 'задание' : 'задания'})
          </h2>
          <div className="space-y-3">
            {part2Solutions.map((solution) => (
              <Part2TaskCard
                key={solution.kim_number}
                attemptId={attempt.id}
                solution={solution}
                attemptStatus={attempt.status}
              />
            ))}
          </div>
        </section>
      ) : (
        <Card className="bg-muted/30">
          <CardContent className="py-8 text-center text-muted-foreground">
            <p>Часть 2 пока не загружена</p>
          </CardContent>
        </Card>
      )}

      {/* Sticky-feel global-approve footer */}
      <ApproveFooter
        approvedCount={approvedCount}
        totalCount={part2Solutions.length}
        onApprove={() => setConfirmOpen(true)}
        isSubmitting={approveAllMutation.isPending}
        isAnonymous={anonymous}
        isAlreadyApproved={isAlreadyApproved}
      />

      {/* Confirmation modal — nuance #9 */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Подтвердить и отправить?</AlertDialogTitle>
            <AlertDialogDescription>
              После этого ученик{anonymous ? ' (анонимный лид)' : ''} и родители получат
              результат: первичный балл {totalDraft} из {totalMax}. Перепроверка
              возможна — ты сможешь скорректировать любую задачу позже.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={approveAllMutation.isPending}>
              Отмена
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                approveAllMutation.mutate();
              }}
              disabled={approveAllMutation.isPending}
            >
              {approveAllMutation.isPending ? 'Отправка…' : 'Подтвердить и отправить'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Export ──────────────────────────────────────────────────────────────────

export default function TutorMockExamReview() {
  return (
    <MockExamFeatureGate>
      <TutorMockExamReviewContent />
    </MockExamFeatureGate>
  );
}
