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

import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Info,
  Pencil,
  RotateCcw,
  Search,
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
import { MockExamGradingProgressBanner } from '@/components/tutor/mock-exams/MockExamGradingProgressBanner';
import { Part1TaskDrillDownDialog } from '@/components/tutor/mock-exams/Part1TaskDrillDownDialog';
import { useMockExamAssignment } from '@/hooks/useMockExamAssignment';
import { useMockExamAttempt } from '@/hooks/useMockExamAttempt';
import { MOCK_EXAM_ATTEMPT_QUERY_KEY } from '@/hooks/useMockExamAttempt';
import { MOCK_EXAM_ASSIGNMENT_QUERY_KEY } from '@/hooks/useMockExamAssignment';
import { MOCK_EXAM_ASSIGNMENTS_QUERY_KEY } from '@/hooks/useMockExamAssignments';
import {
  approveMockExamAll,
  approveMockExamTask,
  assignMockExamPart2Photos,
  finalizeMockExamPart1,
  regradeMockExamPart2,
  retryMockExamPart1OCR,
  setMockExamPart1ManualScore,
  MockExamApiError,
} from '@/lib/mockExamApi';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type {
  MockExamAttemptDetail,
  MockExamAttemptPart1Answer,
  MockExamAttemptPart2Solution,
  MockExamConfidence,
  MockExamPart1OCRResult,
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

/**
 * Bug fix (2026-06-02): tutor видел «без ответа» по Части 1 несмотря на балл.
 * Резолвит ответ ученика из ДВУХ источников: typed/auto-saved `student_answer`
 * (цифровой ввод) → fallback на OCR-распознанное значение из фото бланка ФИПИ
 * (`ai_part1_ocr_json.cells[kim].value`). Покрывает оба режима + legacy attempts
 * с NULL `answer_method`. 2026-06-07: единственный источник ответа в едином
 * гриде Part1ReviewPanel (form+blank); fromOcr различает «Распознано»/«Ответ».
 */
function resolvePart1StudentAnswer(
  ans: Pick<MockExamAttemptPart1Answer, 'kim_number' | 'student_answer'>,
  ocr: MockExamPart1OCRResult | null | undefined,
): { value: string | null; fromOcr: boolean; confidence: MockExamConfidence | null } {
  if (ans.student_answer != null && ans.student_answer !== '') {
    return { value: ans.student_answer, fromOcr: false, confidence: null };
  }
  const cell = ocr?.cells?.[ans.kim_number];
  if (cell?.value != null && cell.value !== '') {
    return { value: cell.value, fromOcr: true, confidence: cell.confidence ?? null };
  }
  return { value: null, fromOcr: false, confidence: null };
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

// 2026-06-07: единый грид проверки Части 1 для ОБОИХ режимов (цифровой ввод
// `form` + бланк ФИПИ `blank`). Раньше form-режим рендерил отдельную таблицу
// Part1SummaryCard (удалена). OCR-only UI (фото бланка, баннер «AI распознал
// N/20», «Перезапустить AI», low-confidence обводка) гейтится по
// attempt.answer_method === 'blank'. Ответ ученика резолвится через
// resolvePart1StudentAnswer (typed `student_answer` ?? OCR cell).
function Part1ReviewPanel({ attempt, variantPart1Tasks }: {
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

  // TASK-16-R2 fix #3 (ChatGPT-5.5 review): track per-kim save state как Set
  // (раньше single savingKim — parallel onBlur saves возможны на mobile при
  // быстром tab-через-поля). Используется для disable confirm + flush before finalize.
  const [savingKims, setSavingKims] = useState<Set<number>>(new Set());

  // 2026-06-02 (item 6): kims, которые тутор явно правил. Нетронутые kims ВСЕГДА
  // показывают авто-балл (earned_score / OCR-checker) — это убирает race
  // «useState-once: drafts пустые, хотя earned_score уже посчитан» (раньше поля
  // были пустые при «сохранено: 13»). Решение Vladimir = просто авто-подстановка.
  const [touchedKims, setTouchedKims] = useState<Set<number>>(new Set());

  // Sync: для НЕтронутых kims подставляем авто-балл из existingScores (earned_score).
  // OCR завершается в фоне (polling) → existingScores пересчитывается → нетронутые
  // поля синхронизируются. Тронутые тутором kims сохраняют ввод (не перетираем).
  useEffect(() => {
    setDrafts((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const t of variantPart1Tasks) {
        const kim = t.kim_number;
        if (touchedKims.has(kim)) continue; // tutor edited → keep their value
        const dbValue = existingScores.get(kim);
        const dbStr = dbValue !== null && dbValue !== undefined ? String(dbValue) : '';
        if ((next[kim] ?? '') !== dbStr) {
          next[kim] = dbStr;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [existingScores, variantPart1Tasks, touchedKims]);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [confirmFinalizeOpen, setConfirmFinalizeOpen] = useState(false);
  const [isRetryingOCR, setIsRetryingOCR] = useState(false);
  // AC-P11 (2026-05-26): drill-down state для click 🔍 на cell.
  const [drillDownKim, setDrillDownKim] = useState<number | null>(null);

  // 2026-06-02 (item 4): редактирование Часть 1 доступно ПОСЛЕ подтверждения —
  // тутор правит баллы после обсуждения с учеником. Терминален только
  // manually_entered (backend ресинкает total_score при правке approved).
  const isReadOnly = attempt.status === 'manually_entered';

  // TASK-16-R2 fix #3: derive «dirty» kims (local draft ≠ saved value).
  // На finalize click мы их flush'им перед SUM, чтобы избежать stale DB read.
  const dirtyKims = useMemo(() => {
    const set = new Set<number>();
    for (const t of variantPart1Tasks) {
      const raw = drafts[t.kim_number] ?? '';
      if (raw.trim() === '') continue;
      const parsed = Number.parseInt(raw, 10);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > t.max_score) continue;
      if (existingScores.get(t.kim_number) !== parsed) set.add(t.kim_number);
    }
    return set;
  }, [drafts, existingScores, variantPart1Tasks]);

    // 2026-06-02 review fix (P2b): снять «touched» когда правка НЕ сохраняется
    // (пусто / невалидно / no-op) — иначе OCR-авто-балл навсегда заглушён для
    // этого kim (sync пропускает touched). «touched» = тутор владеет СОХРАНЁННЫМ
    // баллом, а не «трогал поле».
    const untouch = (k: number) =>
      setTouchedKims((s) => {
        if (!s.has(k)) return s;
        const next = new Set(s);
        next.delete(k);
        return next;
      });

  const handleScoreBlur = async (kim: number, maxScore: number) => {
    const raw = drafts[kim] ?? '';
    if (raw.trim() === '') { untouch(kim); return; } // пусто — не сохраняем, вернуть авто-fill
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > maxScore) {
      toast.error(`Балл для KIM ${kim}: 0..${maxScore}`);
      // restore previous + untouch (авто-fill восстановится)
      const prev = existingScores.get(kim);
      setDrafts((d) => ({ ...d, [kim]: prev !== null && prev !== undefined ? String(prev) : '' }));
      untouch(kim);
      return;
    }
    if (existingScores.get(kim) === parsed) { untouch(kim); return; } // no change → авто-fill ок
    setSavingKims((prev) => {
      const next = new Set(prev);
      next.add(kim);
      return next;
    });
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
      setSavingKims((prev) => {
        const next = new Set(prev);
        next.delete(kim);
        return next;
      });
    }
  };

  const handleFinalize = async () => {
    setIsFinalizing(true);
    try {
      // TASK-16-R2 fix #3: flush dirty drafts перед finalize. Раньше race:
      //   typed «5» → blur → save start → fast click «Часть 1 проверена» →
      //   confirm → handleFinalize SUM'ит stale DB row (без 5). Tutor видел
      //   preview «5/28», но result page показывал «0/28».
      // Flush flow: для каждого dirty kim параллельно вызываем manual-score API,
      // ждём Promise.all, потом finalize.
      if (dirtyKims.size > 0) {
        const flushPromises: Promise<unknown>[] = [];
        for (const kim of dirtyKims) {
          const t = variantPart1Tasks.find((x) => x.kim_number === kim);
          if (!t) continue;
          const parsed = Number.parseInt(drafts[kim] ?? '', 10);
          if (!Number.isFinite(parsed) || parsed < 0 || parsed > t.max_score) continue;
          flushPromises.push(
            setMockExamPart1ManualScore(attempt.id, {
              kim_number: kim,
              earned_score: parsed,
            }),
          );
        }
        try {
          await Promise.all(flushPromises);
        } catch (flushErr) {
          const msg =
            flushErr instanceof MockExamApiError
              ? flushErr.message
              : 'Не удалось сохранить часть баллов перед финализацией';
          toast.error(msg);
          return; // не идём в finalize — preview и DB не согласованы
        }
      }
      const res = await finalizeMockExamPart1(attempt.id);
      toast.success(`Часть 1 пересчитана: ${res.total_part1_score} баллов`);
      void queryClient.invalidateQueries({
        queryKey: MOCK_EXAM_ATTEMPT_QUERY_KEY(attempt.id),
      });
      setConfirmFinalizeOpen(false);
    } catch (err) {
      const msg =
        err instanceof MockExamApiError ? err.message : 'Не удалось пересчитать';
      toast.error(msg);
    } finally {
      setIsFinalizing(false);
    }
  };

  // TASK-16: force-re-run AI OCR. Server clear'ит ai_part1_ocr_json и
  // запускает mock-exam-grade::runPart1OCR fire-and-forget. Tutor invalidate'ит
  // attempt query → refetch через 5-15 секунд показывает новые OCR values.
  const handleRetryOCR = async () => {
    setIsRetryingOCR(true);
    try {
      await retryMockExamPart1OCR(attempt.id);
      toast.success('AI OCR запущен заново. Обновится через 10–15 секунд.');
      // Через 8 секунд invalidate чтобы pre-fill свежими values.
      setTimeout(() => {
        void queryClient.invalidateQueries({
          queryKey: MOCK_EXAM_ATTEMPT_QUERY_KEY(attempt.id),
        });
      }, 8_000);
    } catch (err) {
      const msg =
        err instanceof MockExamApiError ? err.message : 'Не удалось перезапустить AI OCR';
      toast.error(msg);
    } finally {
      setIsRetryingOCR(false);
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

  // 2026-06-07: единый грид для обоих режимов. isOcrMode гейтит OCR-only UI
  // (фото бланка, баннер «AI распознал N/20», «Перезапустить AI», low-conf
  // обводка) И сам OCR-fallback ответа. `!== 'form'` (а не `=== 'blank'`),
  // чтобы legacy-попытки с NULL answer_method (реальные blank до появления
  // поля) тоже резолвили ответ из OCR + показывали фото; explicit form НИКОГДА
  // не трогает OCR (review fix P2 — иначе stale OCR показал бы «Распознано» без
  // бланк-контекста на цифровой попытке).
  const isOcrMode = attempt.answer_method !== 'form';
  const ocrForResolve = isOcrMode ? attempt.ai_part1_ocr_json : null;

  // Счётчики верно/частично/неверно/без ответа — для обоих режимов, через
  // resolvePart1StudentAnswer (typed ?? OCR). Показываем в шапке.
  const counters = useMemo(() => {
    let correct = 0, partial = 0, wrong = 0, ungraded = 0, noAnswer = 0;
    for (const a of attempt.part1_answers) {
      if (a.max_score <= 0) continue;
      const value = resolvePart1StudentAnswer(a, ocrForResolve).value;
      if (value === null) { noAnswer++; continue; }
      if (a.earned_score === null) { ungraded++; continue; }
      if (a.earned_score === a.max_score) correct++;
      else if (a.earned_score === 0) wrong++;
      else partial++;
    }
    return { correct, partial, wrong, ungraded, noAnswer };
  }, [attempt.part1_answers, ocrForResolve]);

  return (
    <Card animate={false} className="border-amber-200 bg-amber-50/40 dark:bg-amber-950/10 dark:border-amber-900">
      <CardContent className="p-4 sm:p-5 space-y-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Pencil className="h-4 w-4 text-amber-700 dark:text-amber-300" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
              {isOcrMode ? 'Часть 1: проверка по бланку ФИПИ' : 'Часть 1: авто-проверка'}
            </h2>
          </div>
          <p className="text-xs text-amber-800 dark:text-amber-300/90 leading-relaxed">
            {isOcrMode
              ? 'Ученик заполнял бланк от руки. Сверь ответы с фото ниже и при необходимости поправь баллы 1–20.'
              : 'Ученик вводил ответы цифрой — авто-проверены по ФИПИ 2026. Проверь и при необходимости поправь баллы.'}
          </p>
          <p className="text-xs font-medium text-amber-900 dark:text-amber-200">
            Верно {counters.correct} · частично {counters.partial} · неверно {counters.wrong}
            {counters.ungraded > 0 ? ` · не проверено ${counters.ungraded}` : ''}
            {counters.noAnswer > 0 ? ` · без ответа ${counters.noAnswer}` : ''}
          </p>
        </div>

        {isOcrMode && (blankPhotoUrl || fallbackPhotoUrl) && (
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

        {/* Phase 6 + TASK-16-R2 fix #4 (2026-05-16): canonical `{cells, __meta}`.
            Frontend branches на __meta.status:
              - 'failed'                              → rose warning + retry CTA
              - 'success' + recognized_cells === 0    → amber soft warning
              - 'success' + recognized_cells > 0      → emerald success */}
        {isOcrMode && (() => {
          const ocrJson = attempt.ai_part1_ocr_json;
          const meta = ocrJson?.__meta ?? null;
          const isFailed = meta?.status === 'failed';
          const recognizedCount = meta?.status === 'success' ? meta.recognized_cells : 0;
          const isEmpty = meta?.status === 'success' && recognizedCount === 0;

          return (
            <div className="flex flex-wrap items-start gap-3">
              {isFailed && (
                <div className="flex-1 min-w-0 rounded-md bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-900 dark:bg-rose-950/30 dark:border-rose-900 dark:text-rose-200">
                  <strong>AI OCR не сработал.</strong> Нажми «Перезапустить AI»
                  или введи баллы вручную по фото бланка ниже. Причина в логах
                  (для разработчиков): <span className="font-mono opacity-70">{meta && 'error' in meta ? meta.error : 'неизвестно'}</span>
                </div>
              )}
              {isEmpty && (
                <div className="flex-1 min-w-0 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:border-amber-900 dark:text-amber-200">
                  <strong>AI запустился, но ничего не распознал.</strong> Возможно,
                  фото бланка плохого качества. Нажми «Перезапустить AI» или
                  введи баллы вручную.
                </div>
              )}
              {!isFailed && !isEmpty && meta?.status === 'success' && (
                <div className="flex-1 min-w-0 rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-900 dark:bg-emerald-950/30 dark:border-emerald-900 dark:text-emerald-200">
                  <strong>AI распознал бланк</strong> (
                  {recognizedCount}/20 клеток
                  ) и выставил баллы. Цвет карточки = балл: зелёный — полный,
                  жёлтый — частичный, красный — 0. Клетки с amber-обводкой — AI не
                  уверен в распознавании, сверь по фото и при необходимости поправь.
                </div>
              )}
              {!isReadOnly && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void handleRetryOCR()}
                  disabled={isRetryingOCR}
                  className="touch-manipulation text-xs gap-1.5 min-h-9"
                  title="Запустить AI OCR заново"
                >
                  <RotateCcw className={cn('h-3.5 w-3.5', isRetryingOCR && 'animate-spin')} aria-hidden="true" />
                  {isRetryingOCR ? 'Запускаем…' : ocrJson ? 'Перезапустить AI' : 'Запустить AI OCR'}
                </Button>
              )}
              {/* 2026-06-06: кнопка «По критериям ФИПИ» убрана — Часть 1
                  авто-проверяется по ФИПИ 2026 partial credit на сабмите
                  (handleSubmitAttempt). Manual recheck возможен через
                  SQL при необходимости retroactive re-grade pilot-attempts. */}
            </div>
          );
        })()}

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {variantPart1Tasks.map((t) => {
            const answerRow = attempt.part1_answers.find(
              (a) => a.kim_number === t.kim_number,
            );
            // 2026-06-07 (unified form+blank): единый источник ответа ученика —
            // resolvePart1StudentAnswer: typed `student_answer` (цифровой ввод)
            // ?? OCR-распознанное (бланк). fromOcr различает ярлык «Распознано»
            // (бланк) vs «Ответ ученика» (форма). isLowConf — только для OCR.
            const resolved = resolvePart1StudentAnswer(
              answerRow ?? { kim_number: t.kim_number, student_answer: null },
              ocrForResolve,
            );
            const isLowConf = resolved.fromOcr && resolved.confidence === 'low';
            const hasRecognition = resolved.value !== null;
            const correctAnswer = answerRow?.correct_answer ?? null;
            const earnedScore = answerRow?.earned_score ?? null;
            const studentAnswer = resolved.value;
            // 2026-06-06: балл AI (авто) vs ручной балл тутора. Если тутор уже
            // переопределил (score_source==='tutor') — подписываем «Ваш балл».
            const isTutorScore = answerRow?.score_source === 'tutor';

            type CellStatus = 'correct' | 'partial' | 'wrong' | 'no_answer' | 'unknown';
            let status: CellStatus = 'unknown';
            if (earnedScore !== null) {
              if (earnedScore === t.max_score) status = 'correct';
              else if (earnedScore === 0 && studentAnswer === null) status = 'no_answer';
              else if (earnedScore === 0) status = 'wrong';
              else status = 'partial';
            }

            const statusConfig: Record<
              CellStatus,
              { icon: typeof Check; title: string; classes: string }
            > = {
              correct: {
                icon: CheckCircle2,
                title: 'Верно (полный балл)',
                classes: 'text-emerald-600 dark:text-emerald-400',
              },
              partial: {
                icon: Check,
                title: 'Частично верно',
                classes: 'text-amber-600 dark:text-amber-400',
              },
              wrong: {
                icon: X,
                title: 'Неверно',
                classes: 'text-rose-600 dark:text-rose-400',
              },
              no_answer: {
                icon: Clock,
                title: 'Нет ответа от ученика',
                classes: 'text-slate-400 dark:text-slate-500',
              },
              unknown: {
                icon: Clock,
                title: 'Балл не выставлен',
                classes: 'text-slate-300 dark:text-slate-600',
              },
            };
            const StatusIcon = statusConfig[status].icon;

            const borderClass = isLowConf
              ? 'border-amber-400 dark:border-amber-700 ring-1 ring-amber-200 dark:ring-amber-900'
              : status === 'correct'
                ? 'border-emerald-200 dark:border-emerald-900'
                : status === 'wrong'
                  ? 'border-rose-200 dark:border-rose-900'
                  : 'border-amber-200 dark:border-amber-900';

            // 2026-06-06: подсветка ФОНА карточки по верности (фикс «непонятно,
            // сколько назначил ИИ» — балл виден с одного взгляда). Сигнал низкой
            // уверенности OCR остаётся ОТДЕЛЬНО через amber-рамку/ring выше
            // (isLowConf) — не смешиваем «AI не уверен в распознавании» с
            // «ответ неверный». Палитра emerald/amber/rose — waiver rule 90.
            const bgClass =
              status === 'correct'
                ? 'bg-emerald-50 dark:bg-emerald-950/40'
                : status === 'partial'
                  ? 'bg-amber-50 dark:bg-amber-950/40'
                  : status === 'wrong'
                    ? 'bg-rose-50 dark:bg-rose-950/40'
                    : 'bg-white dark:bg-slate-900';
            const scoreLineClass =
              status === 'correct'
                ? 'text-emerald-700 dark:text-emerald-300'
                : status === 'partial'
                  ? 'text-amber-700 dark:text-amber-300'
                  : status === 'wrong'
                    ? 'text-rose-700 dark:text-rose-300'
                    : 'text-slate-500 dark:text-slate-400';

            // TASK-OCR Round 3.1 (2026-05-21): убран отдельный «⚠ AI?» бейдж
            // (визуальный шум рядом со status icon). Состояние «AI не уверен»
            // выражается через amber рамку клетки + tooltip на ячейке. Tutor
            // видит amber-окантовку → hover → понимает что сверить по фото.
            const lowConfTitle = isLowConf
              ? 'AI не уверен в распознавании — сверь по фото бланка'
              : statusConfig[status].title;
            // AC-P11: comment indicator + 🔍 icon → open drill-down.
            const hasComment = (answerRow?.tutor_comment ?? '').trim().length > 0;
            return (
              <label
                key={t.kim_number}
                className={cn(
                  'flex flex-col gap-1 p-2 rounded-md border',
                  bgClass,
                  borderClass,
                )}
                title={lowConfTitle}
              >
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1">
                  <StatusIcon
                    className={cn('h-3.5 w-3.5 flex-shrink-0', statusConfig[status].classes)}
                    aria-hidden="true"
                  />
                  <span className="flex-1">
                    KIM {t.kim_number} <span className="text-slate-400">/ {t.max_score}</span>
                  </span>
                  {/* AC-P11: 💬 indicator если есть comment */}
                  {hasComment && (
                    <span
                      className="text-sky-600 dark:text-sky-400 text-[10px]"
                      title={`Комментарий: «${answerRow?.tutor_comment ?? ''}»`}
                    >
                      💬
                    </span>
                  )}
                  {/* AC-P11 hotfix H7: 🔍 touch target h-5 w-5 → h-9 w-9 для
                       соблюдения min touch target (см. .claude/rules/80-cross-browser.md).
                       h-9 w-9 = 36px (WCAG 2.2 large target 24px+ + закрывает обычные
                       finger taps). Полные 44px iOS HIG ломают grid density. Icon
                       остаётся h-3.5 w-3.5 для визуального баланса в плотной шапке. */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      setDrillDownKim(t.kim_number);
                    }}
                    className="inline-flex items-center justify-center h-9 w-9 rounded hover:bg-slate-100 dark:hover:bg-slate-800 touch-manipulation flex-shrink-0"
                    aria-label={`Открыть детали KIM ${t.kim_number}`}
                    title="Условие задачи + комментарий"
                  >
                    <Search className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
                  </button>
                </span>
                {/* Ответ ученика + верный ответ. Ярлык: «Распознано» (OCR-бланк)
                    vs «Ответ ученика» (цифровой ввод) — fromOcr. Строка «Балл AI»
                    ниже, поэтому не «AI:» (два ярлыка «AI» путали бы). */}
                {(hasRecognition || correctAnswer) && (
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 leading-snug flex flex-wrap gap-x-1.5">
                    {hasRecognition && (
                      <span
                        className="truncate"
                        title={`${resolved.fromOcr ? 'AI распознал' : 'Ученик ввёл'} ответ: «${resolved.value}»`}
                      >
                        {resolved.fromOcr ? 'Распознано' : 'Ответ ученика'}: <strong className="font-medium text-slate-700 dark:text-slate-300">{resolved.value || '—'}</strong>
                      </span>
                    )}
                    {correctAnswer && (
                      <span
                        className="truncate"
                        title={`Правильный ответ: «${correctAnswer}»`}
                      >
                        Верный: <strong className="font-medium text-emerald-700 dark:text-emerald-400">{correctAnswer}</strong>
                      </span>
                    )}
                  </span>
                )}
                {/* 2026-06-06: явная строка балла — тутор видит, сколько назначил
                    ИИ (раньше балл был только в инпуте, который мог быть пуст).
                    «Балл AI» пока авто, «Ваш балл» после ручной правки. */}
                <span className={cn('text-[11px] font-semibold leading-snug', scoreLineClass)}>
                  {isTutorScore ? 'Ваш балл' : 'Балл AI'}:{' '}
                  {earnedScore !== null ? earnedScore : '—'} / {t.max_score}
                </span>
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={t.max_score}
                  step={1}
                  disabled={isReadOnly || savingKims.has(t.kim_number)}
                  value={drafts[t.kim_number] ?? ''}
                  onChange={(e) => {
                    setTouchedKims((s) => (s.has(t.kim_number) ? s : new Set(s).add(t.kim_number)));
                    setDrafts((d) => ({ ...d, [t.kim_number]: e.target.value }));
                  }}
                  onBlur={() => void handleScoreBlur(t.kim_number, t.max_score)}
                  className="text-base"
                  placeholder="—"
                  aria-label={`Баллы за KIM ${t.kim_number}`}
                />
              </label>
            );
          })}
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-amber-200">
          <div className="text-sm text-amber-900 dark:text-amber-200">
            Сумма draft: <strong>{draftSum}</strong> / {part1Max}
            {attempt.total_part1_score !== null && (
              <span className="ml-2 text-amber-700 dark:text-amber-300/80">
                (сохранено: {attempt.total_part1_score})
              </span>
            )}
            {/* TASK-16-R2 fix #3: indicator пока saves в полёте. */}
            {savingKims.size > 0 && (
              <span className="ml-2 text-xs text-slate-500 dark:text-slate-400 italic">
                сохраняем {savingKims.size}…
              </span>
            )}
          </div>
          {/* TASK-OCR Round 3 (2026-05-21): убрали AlertDialog confirm —
              tutor сразу нажимает «Сохранить всё и принять», система flush'ит
              dirty drafts + finalize в одну операцию. Empty cells получают 0
              automatically (см. handleFinalize INSERT-on-missing).
              Vladimir feedback: «не нужно чтобы tutor по каждой задаче
              что-то ставил, если согласен с AI». */}
          <Button
            type="button"
            onClick={() => void handleFinalize()}
            // TASK-16-R2 fix #3: disable пока in-flight saves — иначе finalize
            // читает stale DB (saving = ещё не записанные drafts).
            disabled={isReadOnly || isFinalizing || savingKims.size > 0}
            title={
              savingKims.size > 0
                ? 'Дождись окончания сохранения баллов и повтори'
                : 'Сохранить все баллы Часть 1 (пустые клетки получат 0)'
            }
            className="bg-amber-600 hover:bg-amber-700 text-white"
          >
            {isFinalizing
              ? 'Сохраняем…'
              : savingKims.size > 0
                ? 'Сохраняем баллы…'
                : 'Сохранить всё и принять'}
          </Button>
        </div>
      </CardContent>

      {/* TASK-16 (Vladimir UX): confirm dialog показывает все 20 KIM перед save.
          Пустые KIM подсвечены amber «(не введено)» — backend проставит 0. */}
      <AlertDialog open={confirmFinalizeOpen} onOpenChange={setConfirmFinalizeOpen}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Подтвердить баллы Часть 1</AlertDialogTitle>
            <AlertDialogDescription>
              Проверь баллы по каждой задаче 1–20. Где ничего не введено —
              автоматически поставится <strong>0 баллов</strong>. После сохранения
              ученик и родители увидят результат Части 1.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="max-h-[55vh] overflow-y-auto rounded-md border border-slate-200 dark:border-slate-700">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">KIM</th>
                  <th className="px-3 py-2 text-right font-medium">Балл</th>
                  <th className="px-3 py-2 text-right font-medium">Макс</th>
                </tr>
              </thead>
              <tbody>
                {variantPart1Tasks.map((t) => {
                  const raw = drafts[t.kim_number] ?? '';
                  const parsed = Number.parseInt(raw, 10);
                  const isEntered = raw.trim() !== '' && Number.isFinite(parsed);
                  return (
                    <tr key={t.kim_number} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="px-3 py-1.5 font-medium text-slate-700 dark:text-slate-300">
                        №{t.kim_number}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {isEntered ? (
                          <strong className="text-slate-900 dark:text-slate-100">{parsed}</strong>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
                            <strong>0</strong>
                            <span className="text-[10px]">(не введено)</span>
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-right text-slate-400 tabular-nums">
                        / {t.max_score}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-amber-50 dark:bg-amber-950/30 sticky bottom-0">
                <tr className="border-t-2 border-amber-300">
                  <td className="px-3 py-2 font-semibold text-amber-900 dark:text-amber-200">Итого</td>
                  <td className="px-3 py-2 text-right font-bold text-amber-900 dark:text-amber-200 tabular-nums">
                    {draftSum}
                  </td>
                  <td className="px-3 py-2 text-right text-amber-700 dark:text-amber-300/80 tabular-nums">
                    / {part1Max}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isFinalizing}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleFinalize();
              }}
              // TASK-16-R2 fix #3: disable пока onBlur saves в полёте + пока
              // finalize запущен. handleFinalize сам flush'ит dirty drafts
              // перед SUM, но защита от двойного click обязательна.
              disabled={isFinalizing || savingKims.size > 0}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              {isFinalizing
                ? 'Сохраняем…'
                : savingKims.size > 0
                  ? `Ждём saves (${savingKims.size})…`
                  : 'Сохранить и отправить ученику'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>


      {/* AC-P11 (2026-05-26): drill-down dialog для blank mode panel. */}
      {drillDownKim !== null && (() => {
        const ans = attempt.part1_answers.find((a) => a.kim_number === drillDownKim);
        if (!ans) return null;
        const resolved = resolvePart1StudentAnswer(ans, ocrForResolve);
        return (
          <Part1TaskDrillDownDialog
            open={drillDownKim !== null}
            onOpenChange={(open) => {
              if (!open) setDrillDownKim(null);
            }}
            kimNumber={ans.kim_number}
            maxScore={ans.max_score}
            studentAnswer={resolved.value}
            answerFromOcr={resolved.fromOcr}
            correctAnswer={ans.correct_answer}
            currentScore={ans.earned_score}
            currentComment={ans.tutor_comment ?? null}
            taskText={ans.task_text ?? null}
            taskImageUrl={ans.task_image_url ?? null}
            isReadOnly={isReadOnly}
            onSave={async (payload) => {
              await setMockExamPart1ManualScore(attempt.id, {
                kim_number: ans.kim_number,
                earned_score: payload.score,
                comment: payload.comment,
              });
              // Sync inline grid draft со score из dialog + mark touched
              setTouchedKims((s) => (s.has(ans.kim_number) ? s : new Set(s).add(ans.kim_number)));
              setDrafts((d) => ({
                ...d,
                [ans.kim_number]: String(payload.score),
              }));
              // Recompute totals lazily — non-fatal
              try {
                await finalizeMockExamPart1(attempt.id);
              } catch {
                // Non-fatal — totals lag until next finalize
              }
              void queryClient.invalidateQueries({
                queryKey: MOCK_EXAM_ATTEMPT_QUERY_KEY(attempt.id),
              });
            }}
          />
        );
      })()}
    </Card>
  );
}

// ─── AC-P10 Phase 2 (PAUSE-8) — Mode badge + sessions detail ─────────────────

/**
 * AC-P10 Phase 2 (2026-05-25): отображает execution mode (Simulation/Training)
 * + override indicator если ученик override'нул tutor recommendation
 * + collapsible session breakdown («Solo time: 50+30+70 мин»).
 *
 * Skip render если режим training + 0-1 sessions (т.е. ученик не паузил —
 * нет полезной информации). Simulation всегда рендерится для visibility.
 */
function ExamModeAndSessionsBadge({ attempt }: { attempt: MockExamAttemptDetail }) {
  const examMode = attempt.exam_mode ?? 'training';
  const defaultExamMode = attempt.default_exam_mode ?? 'training';
  const studentOverrode = examMode !== defaultExamMode;
  const sessions = Array.isArray(attempt.sessions) ? attempt.sessions : [];
  const totalActiveMs = attempt.total_active_ms ?? 0;

  // Skip если training + 0-1 sessions — нет paused sessions, ничего показывать.
  if (examMode === 'training' && sessions.length <= 1 && !studentOverrode) {
    return null;
  }

  // Compute per-session durations.
  const closedSessions = sessions.filter(
    (s) => typeof s.ended_at === 'string',
  ) as Array<{ started_at: string; ended_at: string }>;
  const sessionDurations = closedSessions.map((s) => {
    const startMs = Date.parse(s.started_at);
    const endMs = Date.parse(s.ended_at);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 0;
    return Math.max(0, endMs - startMs);
  });
  const totalActiveMin = Math.round(totalActiveMs / 60_000);

  return (
    <Card animate={false} className="border-slate-200 dark:border-slate-700">
      <CardContent className="p-4">
        <div className="flex items-start gap-2 flex-wrap">
          <Badge
            variant="outline"
            className={`text-xs font-medium ${
              examMode === 'simulation'
                ? 'border-rose-300 bg-rose-50 text-rose-800 dark:bg-rose-950/30 dark:text-rose-200'
                : 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200'
            }`}
          >
            {examMode === 'simulation' ? '⚡ Симуляция ЕГЭ' : '📚 Тренировка'}
          </Badge>
          {studentOverrode && (
            <Badge
              variant="outline"
              className="border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200 text-xs"
              title={`Ты рекомендовал: ${
                defaultExamMode === 'simulation' ? '⚡ Симуляция' : '📚 Тренировка'
              }`}
            >
              Ученик выбрал
            </Badge>
          )}
          {sessions.length > 0 && (
            <span className="text-xs text-slate-600 dark:text-slate-400 tabular-nums">
              Solo time:{' '}
              <strong className="text-slate-900 dark:text-slate-100">
                {Math.floor(totalActiveMin / 60)}ч {totalActiveMin % 60}мин
              </strong>
              {sessions.length > 1 && (
                <> в {sessions.length}{' '}
                  {sessions.length === 1
                    ? 'сессию'
                    : sessions.length >= 2 && sessions.length <= 4
                      ? 'сессии'
                      : 'сессий'}
                </>
              )}
            </span>
          )}
        </div>

        {/* Per-session details collapsible — only if 2+ sessions */}
        {sessions.length > 1 && (
          <details className="mt-3 text-xs">
            <summary className="cursor-pointer touch-manipulation text-slate-500 hover:text-slate-900 dark:hover:text-slate-200">
              ▼ Сессии работы
            </summary>
            <ol className="mt-2 space-y-1 pl-4">
              {sessions.map((s, idx) => {
                const startMs = Date.parse(s.started_at);
                const endMs = s.ended_at ? Date.parse(s.ended_at) : null;
                const durationMs =
                  endMs !== null && Number.isFinite(startMs) && Number.isFinite(endMs)
                    ? endMs - startMs
                    : null;
                const durationMin =
                  durationMs !== null ? Math.round(durationMs / 60_000) : null;
                const formattedStart = Number.isFinite(startMs)
                  ? new Date(startMs).toLocaleString('ru-RU', {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : '?';
                const formattedEnd = endMs && Number.isFinite(endMs)
                  ? new Date(endMs).toLocaleTimeString('ru-RU', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : null;
                return (
                  <li
                    key={`${s.started_at}-${idx}`}
                    className="text-slate-600 dark:text-slate-400 tabular-nums"
                  >
                    Сессия {idx + 1}: {formattedStart}
                    {formattedEnd ? ` → ${formattedEnd}` : ' → продолжается'}
                    {durationMin !== null && (
                      <span className="ml-1 text-slate-500">
                        ({durationMin} мин)
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
            {sessionDurations.length > 1 && (
              <p className="mt-2 text-slate-500 text-[11px] leading-relaxed">
                Активное время:{' '}
                {sessionDurations
                  .map((ms) => Math.round(ms / 60_000))
                  .filter((m) => m > 0)
                  .join(' + ')}{' '}
                = {totalActiveMin} мин
              </p>
            )}
          </details>
        )}
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
  // 2026-06-02 (item 4): Часть 2 «Изменить балл» доступно ПОСЛЕ подтверждения
  // (backend resync total_part2_score+total_score). Терминален только manually_entered.
  const isReadOnlyAttempt = attemptStatus === 'manually_entered';

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

        {/* Решение ученика — фото ИЛИ alert.
            TASK-OCR Round 3 (2026-05-21) fix: для bulk attempts `photo_url`
            = null per-kim row, но фото есть в `attempt.part2_bulk_photo_urls`
            и AI привязал через `assigned_photo_indices`. Раньше показывали
            false-error banner — теперь suppress'аем если AI имел фото для
            оценки (suggested_score !== null ИЛИ assigned_photo_indices > 0).
            Banner показывается ТОЛЬКО когда truly нечего показать. */}
        {(() => {
          const hasIndividualPhoto = solution.photo_url !== null;
          const hasBulkAssignment =
            (aiDraft?.assigned_photo_indices?.length ?? 0) > 0;
          const aiActuallyGraded =
            aiDraft?.suggested_score !== null
            && aiDraft?.suggested_score !== undefined;

          if (hasIndividualPhoto && solution.photo_url) {
            return (
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
            );
          }

          if (hasBulkAssignment || aiActuallyGraded) {
            // AI работал с фото из bulk pack — показываем info-chip без
            // паники. Фото уже видно в BulkPhotosAssignmentGallery выше.
            return (
              <div className="text-xs text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
                <Info className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                <span>
                  AI взял фото №
                  {(aiDraft?.assigned_photo_indices ?? [])
                    .map((i) => i + 1)
                    .join(', ') || '—'}
                  {' '}из пакета сверху. Изменить привязку можно через «Перепроверить AI».
                </span>
              </div>
            );
          }

          // Действительно нет фото И AI не оценил — корректный rose alert.
          return (
            <div className="bg-rose-50 border border-rose-200 rounded p-3 flex items-start gap-2 dark:bg-rose-950/30 dark:border-rose-900">
              <AlertCircle
                className="h-4 w-4 text-rose-600 flex-shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <div className="text-sm text-rose-900 dark:text-rose-200">
                Фото решения не загружено. Запроси переснимку у ученика в Telegram
                или поставь оценку вручную через «Изменить балл».
              </div>
            </div>
          );
        })()}

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

        {/* TASK-OCR Round 3 (2026-05-21): эталонное решение в свёрнутом блоке.
            solution_text приходит из mock_exam_variant_tasks (tutor-only,
            не leak'ается ученику до approval). Tutor открывает collapsible
            при необходимости сверить ход решения. По дефолту свёрнуто
            чтобы не загромождать карточку (AI комментарий ниже даёт основу). */}
        {(solution.solution_text || (solution.solution_image_urls?.length ?? 0) > 0) ? (
          <details className="rounded-md border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/50">
            <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1.5 hover:bg-slate-100 dark:hover:bg-slate-800/50 rounded-md transition-colors">
              <Info className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
              Показать эталон решения (видит и ученик)
            </summary>
            <div className="px-3 py-2.5 border-t border-slate-200 dark:border-slate-700 text-sm text-slate-800 dark:text-slate-200 leading-relaxed space-y-2">
              {solution.solution_text ? (
                <Suspense fallback={<div>{solution.solution_text}</div>}>
                  <MathText text={solution.solution_text} />
                </Suspense>
              ) : null}
              {/* 2026-06-05 (item 5): фото эталонного решения */}
              {(solution.solution_image_urls?.length ?? 0) > 0 && (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {(solution.solution_image_urls ?? []).map((url, idx) => (
                    <a key={url} href={url} target="_blank" rel="noreferrer" className="block">
                      <img
                        src={url}
                        alt={`Эталон решения №${solution.kim_number} — фото ${idx + 1}`}
                        loading="lazy"
                        className="aspect-[3/4] w-full rounded-md border border-slate-200 bg-white object-cover dark:border-slate-700"
                      />
                    </a>
                  ))}
                </div>
              )}
            </div>
          </details>
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

        {/* 2026-06-02 (item 2): shared AI разбор — видит И ученик, И ты. Главный фидбэк. */}
        {aiDraft?.feedback ? (
          <div className="rounded-md border border-violet-200 bg-violet-50 p-3 text-sm text-violet-900 dark:border-violet-900 dark:bg-violet-950/30 dark:text-violet-200">
            <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide">
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              Разбор AI · видит ученик
            </p>
            <Suspense fallback={<span>{aiDraft.feedback}</span>}>
              <MathText text={aiDraft.feedback} />
            </Suspense>
          </div>
        ) : null}

        {/* AI операт. заметка — только репетитор (де-эмфасис). */}
        {aiDraft?.comment_for_tutor ? (
          <div className="text-xs text-slate-500 border-l-2 border-amber-300 pl-3 py-1 dark:text-slate-400">
            <span className="font-medium">Заметка AI (только ты): </span>
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

        {/* Phase 6 (2026-05-15) — Action row: убрали quick-approve button.
            Tutor правит только если не согласен с AI. Final approval — через
            global «Подтвердить пробник» в ApproveFooter (одна кнопка на пробник). */}
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

// ─── Phase 6 (2026-05-15): Bulk photo assignment gallery ────────────────────
//
// Заменил Phase 5 simple zoom-to-tab gallery. Tutor видит ленту всех фото
// от ученика + select dropdown под каждым с AI's default assignment
// (берётся из ai_draft_json.assigned_photo_indices). Может переназначить
// → debounce save → click «Перепроверить AI» → mock-exam-grade::handleGrade
// запускается с новой привязкой.

const PART2_KIMS = [21, 22, 23, 24, 25, 26] as const;

function BulkPhotosAssignmentGallery({
  attemptId,
  photoUrls,
  part2Solutions,
  isReadOnly,
}: {
  attemptId: string;
  photoUrls: string[];
  part2Solutions: MockExamAttemptPart2Solution[];
  isReadOnly: boolean;
}) {
  const queryClient = useQueryClient();

  // Compute initial assignment per photo index из ai_draft_json
  // (assigned_photo_indices). Phase 6 TASK-16 (2026-05-15): multi-select —
  // одно фото может быть привязано к нескольким задачам (если ученик
  // сфотографировал лист с решениями 2-3 задач сразу). Каждое фото хранит
  // Set<kim_number> (пустой Set = не привязано).
  const initialAssignments = useMemo(() => {
    const map = new Map<number, Set<number>>();
    for (let i = 0; i < photoUrls.length; i++) map.set(i, new Set<number>());
    for (const solution of part2Solutions) {
      const indices = solution.ai_draft?.assigned_photo_indices ?? [];
      for (const idx of indices) {
        if (idx >= 0 && idx < photoUrls.length) {
          map.get(idx)!.add(solution.kim_number);
        }
      }
    }
    return map;
  }, [photoUrls.length, part2Solutions]);

  const [assignments, setAssignments] = useState<Map<number, Set<number>>>(
    initialAssignments,
  );
  const [dirty, setDirty] = useState(false);

  // Re-sync если AI assignment пришёл server-side update (после regrade).
  useEffect(() => {
    setAssignments(initialAssignments);
    setDirty(false);
  }, [initialAssignments]);

  const saveMutation = useMutation({
    mutationFn: async (newAssignments: Map<number, Set<number>>) => {
      // Сгруппировать фото-индексы по kim_number (server format).
      // Multi-select: одно фото может быть в нескольких kim arrays.
      const grouped: Record<number, number[]> = {};
      for (const kim of PART2_KIMS) grouped[kim] = [];
      for (const [idx, kims] of newAssignments.entries()) {
        for (const kim of kims) {
          if (grouped[kim]) grouped[kim].push(idx);
        }
      }
      return await assignMockExamPart2Photos(attemptId, { assignments: grouped });
    },
    onSuccess: () => {
      // Не invalidate тут — assignment без AI regrade всё ещё dirty. Только
      // local state помечается как сохранённое.
    },
    onError: (err) => {
      toast.error(`Не удалось сохранить привязку: ${err instanceof Error ? err.message : String(err)}`);
    },
  });

  const regradeMutation = useMutation({
    mutationFn: async () => {
      // Phase 6 review-fix P2 #2: flush pending debounced save перед regrade.
      // Иначе 500ms timer ещё не выстрелил → AI пересчитывает по stale
      // assignment, tutor's правка теряется.
      if (dirty) {
        await saveMutation.mutateAsync(assignments);
      }
      return await regradeMockExamPart2(attemptId);
    },
    onSuccess: () => {
      toast.success('AI пересчитал баллы — обнови карточки ниже');
      queryClient.invalidateQueries({ queryKey: MOCK_EXAM_ATTEMPT_QUERY_KEY(attemptId) });
      setDirty(false);
    },
    onError: (err) => {
      toast.error(`AI grader не успел: ${err instanceof Error ? err.message : String(err)}`);
    },
  });

  // Phase 6 TASK-16: chips multi-select. Toggle kim membership в Set
  // per photo. Если photo уже привязано к kim → remove, иначе → add.
  const toggleAssignment = useCallback(
    (photoIdx: number, kim: number) => {
      setAssignments((prev) => {
        const next = new Map(prev);
        const currentSet = new Set(prev.get(photoIdx) ?? []);
        if (currentSet.has(kim)) {
          currentSet.delete(kim);
        } else {
          currentSet.add(kim);
        }
        next.set(photoIdx, currentSet);
        return next;
      });
      setDirty(true);
    },
    [],
  );

  // Clear all kims для photo → «не подошла» state.
  const setNoneAssignment = useCallback(
    (photoIdx: number) => {
      setAssignments((prev) => {
        const current = prev.get(photoIdx);
        // No-op если уже пустой — избегаем лишнего dirty=true.
        if (!current || current.size === 0) return prev;
        const next = new Map(prev);
        next.set(photoIdx, new Set<number>());
        return next;
      });
      setDirty(true);
    },
    [],
  );

  // Debounced save: trigger 500ms после последнего изменения.
  useEffect(() => {
    if (!dirty || isReadOnly) return;
    const timer = window.setTimeout(() => {
      saveMutation.mutate(assignments);
    }, 500);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignments, dirty, isReadOnly]);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight">
          Часть 2 — фото от ученика ({photoUrls.length})
        </h2>
        {!isReadOnly && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => regradeMutation.mutate()}
            disabled={!dirty || regradeMutation.isPending || saveMutation.isPending}
            title={
              !dirty
                ? 'Привязка не менялась — AI пересчитывать нечего'
                : 'Пересчитать баллы Части 2 с новой привязкой фото'
            }
          >
            {regradeMutation.isPending ? 'AI пересчитывает…' : '🔄 Перепроверить AI'}
          </Button>
        )}
      </div>
      <Card>
        <CardContent className="py-4">
          <p className="mb-3 text-sm text-muted-foreground">
            {isReadOnly
              ? 'Пробник подтверждён. Привязка фото к задачам зафиксирована.'
              : 'AI распределил фото по задачам. Если одно фото содержит решения нескольких задач — отметь все нужные номера чипсами под фото. Потом нажми «Перепроверить AI».'}
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {photoUrls.map((url, idx) => {
              const currentSet = assignments.get(idx) ?? new Set<number>();
              const isNone = currentSet.size === 0;
              return (
                <div key={url + idx} className="flex flex-col gap-2">
                  <a
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
                      #{idx + 1}
                    </span>
                  </a>
                  <div
                    className="flex flex-wrap gap-1.5"
                    role="group"
                    aria-label={`Привязка фото ${idx + 1} к задачам`}
                  >
                    {PART2_KIMS.map((kim) => {
                      const active = currentSet.has(kim);
                      return (
                        <button
                          type="button"
                          key={kim}
                          onClick={() => toggleAssignment(idx, kim)}
                          aria-pressed={active}
                          disabled={isReadOnly}
                          className={cn(
                            'min-h-9 touch-manipulation rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
                            active
                              ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                              : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700',
                            isReadOnly && 'opacity-60 pointer-events-none',
                          )}
                        >
                          №{kim}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => setNoneAssignment(idx)}
                      aria-pressed={isNone}
                      disabled={isReadOnly}
                      className={cn(
                        'min-h-9 touch-manipulation rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
                        isNone
                          ? 'bg-slate-700 text-white hover:bg-slate-800'
                          : 'bg-transparent text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800',
                        isReadOnly && 'opacity-60 pointer-events-none',
                      )}
                      title="Фото не относится ни к одной задаче"
                    >
                      — не подошла
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </section>
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
  /**
   * Phase 6 (2026-05-15): список kim, у которых нет ни tutor_score
   * ни ai_draft.suggested_score — approve кнопка blocked если непустой.
   * Vladimir's UX choice: force tutor review missing scores.
   */
  blockedKims?: number[];
}

function ApproveFooter({
  approvedCount: _approvedCount,
  totalCount: _totalCount,
  onApprove,
  isSubmitting,
  isAnonymous,
  isAlreadyApproved,
  blockedKims,
}: ApproveFooterProps) {

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

  // TASK-OCR Round 3 (2026-05-21) — Vladimir UX rewrite: кнопка ВСЕГДА
  // активна когда attempt не approved. Раньше блокировали при missing
  // scores (force tutor review). Теперь: backend auto-zeroes на approve,
  // tutor видит warning какие kim уйдут как 0. Минимум кликов когда tutor
  // согласен с AI ИЛИ когда осознанно решает «закрыть пробел нулями».
  const missingKims = blockedKims ?? [];
  const hasBlocked = missingKims.length > 0;

  return (
    <div className="bg-slate-50 border-2 border-slate-200 rounded-lg p-4 flex items-center justify-between flex-wrap gap-3 dark:bg-slate-900 dark:border-slate-700">
      <div className="text-sm">
        <div className="font-medium text-slate-900 dark:text-slate-100 flex items-center gap-2">
          Готов отправить ученику результаты?
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
          {hasBlocked
            ? `AI не оценил задачи ${missingKims.map((k) => `№${k}`).join(', ')} — будут выставлены 0 баллов при подтверждении. Если хочешь оценить вручную — нажми «Изменить балл» в карточке.`
            : isAnonymous
              ? 'Анонимный лид. Проверь баллы вручную для надёжности.'
              : 'После подтверждения ученик и родители получат результат. Перепроверка возможна.'}
        </div>
      </div>
      <Button
        size="lg"
        onClick={onApprove}
        disabled={isSubmitting}
        title="Подтвердить пробник и показать ученику результаты"
        className={cn(
          hasBlocked && 'bg-amber-600 hover:bg-amber-700',
        )}
      >
        {isSubmitting
          ? 'Отправка…'
          : hasBlocked
            ? 'Согласен с AI — отправить'
            : 'Подтвердить и показать ученику'}
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

  // TASK-OCR-2 Round 2 (2026-05-21): combined "Запустить AI заново" — параллельно
  // зовёт retry-part1-ocr (если blank mode) + regrade-part2. Mirrors stale-lock
  // recovery pattern в обоих endpoint'ах. Используется в
  // MockExamGradingProgressBanner stale CTA (после 5 мин elapsed).
  //
  // Promise.allSettled — partial success acceptable: если только Часть 1 OCR
  // запустился, а regrade-part2 вернул 409 (e.g. status был approved between
  // re-renders), tutor видит частичный progress.
  const retryAllMutation = useMutation({
    mutationFn: async () => {
      if (!attemptId) throw new Error('No attempt ID');
      const tasks: Promise<unknown>[] = [];
      // Always try OCR retry if attempt is blank-mode. Backend сам валидирует
      // что есть blank_photo_url ИЛИ part1_blank_photo_url; если нет — вернёт
      // NO_PART1_PHOTO 400, что мы treat'аем как partial.
      if (attempt?.answer_method === 'blank') {
        tasks.push(retryMockExamPart1OCR(attemptId));
      }
      // Always try Часть 2 regrade. Backend stale-lock guard разрешает после 120s.
      tasks.push(regradeMockExamPart2(attemptId));
      const results = await Promise.allSettled(tasks);
      return results;
    },
    onSuccess: (results) => {
      const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
      const rejected = results.filter((r) => r.status === 'rejected');
      if (fulfilled > 0) {
        toast.success(
          rejected.length > 0
            ? `AI запущен заново (${fulfilled} из ${results.length}). Подожди 30-60 сек.`
            : 'AI запущен заново. Подожди 30-60 сек.',
        );
      } else {
        // Все упали — показываем первую ошибку
        const firstErr = rejected[0]?.status === 'rejected' ? rejected[0].reason : null;
        const msg =
          firstErr instanceof MockExamApiError
            ? firstErr.message
            : 'Не удалось перезапустить AI';
        toast.error(msg);
      }
      void queryClient.invalidateQueries({
        queryKey: MOCK_EXAM_ATTEMPT_QUERY_KEY(attemptId as string),
      });
    },
    onError: (err) => {
      const msg =
        err instanceof MockExamApiError ? err.message : 'Не удалось перезапустить AI';
      toast.error(msg);
    },
  });

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
        criticalError={error}
        isFetching={attemptFetching}
        onRetry={refetchAttempt}
        escalateAfterMs={8000}
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

  // Phase 6 (2026-05-15): compute blockedKims — Часть 2 задачи где нет ни
  // tutor_score (manual edit) ни ai_draft.suggested_score (AI default).
  // Approve button blocked если непустой; tutor должен выставить балл
  // вручную через «Изменить балл» в карточке.
  const blockedKims: number[] = part2Solutions
    .filter(
      (s) =>
        s.tutor_score === null
        && (!s.ai_draft || s.ai_draft.suggested_score === null),
    )
    .map((s) => s.kim_number)
    .sort((a, b) => a - b);

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

      {/* TASK-OCR-2 Round 2 (2026-05-21): grading progress banner —
          mounted ТОЛЬКО для статусов submitted | ai_checking | awaiting_review
          (banner сам возвращает null для terminal статусов). Polling 5s через
          useMockExamAttempt::refetchInterval.
          TASK-OCR Round 3: добавлен top ready-CTA «AI готов — отправить» для
          awaiting_review (mirror footer button для удобства). */}
      <MockExamGradingProgressBanner
        attempt={attempt}
        onRetryAll={() => retryAllMutation.mutate()}
        isRetrying={retryAllMutation.isPending}
        onApproveAll={() => setConfirmOpen(true)}
        isApproving={approveAllMutation.isPending}
        totalDraft={totalDraft}
        totalMax={totalMax}
      />

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

      {/* AC-P10 Phase 2 (PAUSE-8, 2026-05-25): exam mode badge + sessions detail.
          Показываем final mode (attempt.exam_mode) + override indicator если
          ученик выбрал не то что рекомендовал tutor. Collapsible per-session
          breakdown для tutor coaching. */}
      <ExamModeAndSessionsBadge attempt={attempt} />

      {/* Recovery / non-blocking errors */}
      <TutorDataStatus
        degraded={!!attemptError}
        isFetching={attemptFetching}
        onRetry={refetchAttempt}
      />

      {/* Часть 1 — единый редактируемый грид для обоих режимов (2026-06-07):
          цифровой ввод (form) + бланк ФИПИ (blank). OCR-only UI гейтится внутри
          по attempt.answer_method. */}
      <Part1ReviewPanel
        attempt={attempt}
        variantPart1Tasks={attempt.part1_answers.map((a) => ({
          kim_number: a.kim_number,
          max_score: a.max_score,
        }))}
      />

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

      {/* Phase 6 (2026-05-15): bulk-photo pack с AI auto-assignment +
          tutor manual override через select dropdown под каждым фото.
          Tutor click «Перепроверить AI» → mock-exam-grade::handleGrade
          запускается с обновлённым assignment_map. Phase 5 simple gallery
          (zoom-to-tab) заменён interactive grid'ом. */}
      {(attempt.part2_bulk_photo_urls ?? []).length > 0 && (
        <BulkPhotosAssignmentGallery
          attemptId={attempt.id}
          photoUrls={attempt.part2_bulk_photo_urls ?? []}
          part2Solutions={part2Solutions}
          isReadOnly={isAlreadyApproved}
        />
      )}

      {/* Часть 2 cards — per-kim карточки. Для bulk attempts (Phase 6+)
          photo_url обычно null (AI grader пишет в ai_draft_json.assigned_photo_indices),
          tutor выставляет баллы через AI suggested_score (см. карточки выше).
          Для pilot attempts (до Phase 5) photo_url содержит per-kim фото,
          отображается в карточке как legacy fallback. */}
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
        blockedKims={blockedKims}
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
