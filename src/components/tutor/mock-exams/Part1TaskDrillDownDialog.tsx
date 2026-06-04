// AC-P11 (2026-05-26): Drill-down modal для конкретной задачи Часть 1.
//
// Trigger: репетитор просит «ткнул в ячейку, провалился в задачу, видишь условие,
// ответ ученика, правильный ответ + комментарий ученику». Mirror Часть 2
// EditScoreDialog pattern (homework results) + UX adjustments для exam context.
//
// Click ячейки в Part1SummaryCard / Part1BlankReviewPanel → open этот dialog
// с pre-filled данными KIM.
//
// Layout (top → bottom):
//   1. Header «KIM N · max_score балла»
//   2. Status badge (Верно / Частично / Неверно / Без ответа)
//   3. Ответ ученика + Правильный ответ
//   4. Input для score override (0..max_score)
//   5. Textarea для tutor_comment (≤ 600 chars)
//   6. Collapsible <details> «Показать условие» → task_text + task_image_url
//   7. Footer: Отмена + Сохранить
//
// Spec: docs/delivery/features/mock-exams-v1-pilot-polish/spec.md AC-P11

import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Check, CheckCircle2, ChevronDown, ImageIcon, X, XCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// MathText lazy — ~400KB KaTeX (rule 90-design-system.md)
const MathText = lazy(() =>
  import('@/components/kb/ui/MathText').then((m) => ({ default: m.MathText })),
);

interface Part1TaskDrillDownDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kimNumber: number;
  maxScore: number;
  studentAnswer: string | null;
  /**
   * Bug fix (2026-06-02): true когда `studentAnswer` пришёл из OCR-распознавания
   * фото бланка ФИПИ (а не из typed/auto-saved). Показываем hint «распознано с
   * фото» чтобы тутор знал что значение машинное и мог сверить с бланком.
   */
  answerFromOcr?: boolean;
  correctAnswer: string | null;
  currentScore: number | null;
  currentComment: string | null;
  /** Условие задачи (task_text). */
  taskText: string | null;
  /** Картинка задачи (storage:// ref). Resolved сразу через signed URL — раньше. */
  taskImageUrl: string | null;
  /** True когда attempt approved/manually_entered — input/textarea disabled. */
  isReadOnly: boolean;
  /** Backend save handler. Возвращает Promise — modal shows loading + closes on success. */
  onSave: (payload: { score: number; comment: string | null }) => Promise<void>;
}

export function Part1TaskDrillDownDialog({
  open,
  onOpenChange,
  kimNumber,
  maxScore,
  studentAnswer,
  answerFromOcr = false,
  correctAnswer,
  currentScore,
  currentComment,
  taskText,
  taskImageUrl,
  isReadOnly,
  onSave,
}: Part1TaskDrillDownDialogProps) {
  const [scoreText, setScoreText] = useState<string>(() =>
    currentScore !== null ? String(currentScore) : '',
  );
  const [commentText, setCommentText] = useState<string>(() => currentComment ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Sync from outside when KIM changes (different cell opened).
  useEffect(() => {
    setScoreText(currentScore !== null ? String(currentScore) : '');
    setCommentText(currentComment ?? '');
    setErrorMsg(null);
  }, [kimNumber, currentScore, currentComment]);

  // Derived status (visual badge).
  const status = useMemo(() => {
    if (currentScore === null) return 'no_answer';
    if (currentScore === 0 && studentAnswer === null) return 'no_answer';
    if (currentScore === 0) return 'wrong';
    if (currentScore === maxScore) return 'correct';
    return 'partial';
  }, [currentScore, maxScore, studentAnswer]);

  // Score input validation.
  const parsedScore = useMemo(() => {
    const trimmed = scoreText.trim();
    if (trimmed === '') return null;
    const v = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(v)) return null;
    return v;
  }, [scoreText]);
  const scoreInvalid =
    parsedScore === null ||
    parsedScore < 0 ||
    parsedScore > maxScore;
  const commentTooLong = commentText.trim().length > 600;
  const commentChanged = (currentComment ?? '') !== commentText.trim();
  const scoreChanged = currentScore !== parsedScore;
  const hasChanges = scoreChanged || commentChanged;
  const canSave = !isReadOnly && !scoreInvalid && !commentTooLong && hasChanges && !isSaving;

  const handleSubmit = async () => {
    if (!canSave || parsedScore === null) return;
    setIsSaving(true);
    setErrorMsg(null);
    try {
      const trimmedComment = commentText.trim();
      await onSave({
        score: parsedScore,
        comment: trimmedComment === '' ? null : trimmedComment,
      });
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Не удалось сохранить';
      setErrorMsg(msg);
    } finally {
      setIsSaving(false);
    }
  };

  const statusConfig: Record<
    typeof status,
    { label: string; icon: typeof Check; className: string }
  > = {
    correct: {
      label: 'Верно',
      icon: CheckCircle2,
      className: 'border-emerald-300 bg-emerald-50 text-emerald-800',
    },
    partial: {
      label: 'Частично',
      icon: Check,
      className: 'border-amber-300 bg-amber-50 text-amber-800',
    },
    wrong: {
      label: 'Неверно',
      icon: XCircle,
      className: 'border-rose-300 bg-rose-50 text-rose-800',
    },
    no_answer: {
      label: 'Без ответа',
      icon: X,
      className: 'border-slate-300 bg-slate-50 text-slate-700',
    },
  };
  const cfg = statusConfig[status];
  const StatusIcon = cfg.icon;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <span>KIM {kimNumber}</span>
            <span className="text-sm font-normal text-muted-foreground">
              · максимум {maxScore} {maxScore === 1 ? 'балл' : 'балла'}
            </span>
            <Badge
              variant="outline"
              className={cn('text-xs font-medium gap-1', cfg.className)}
            >
              <StatusIcon className="h-3 w-3" aria-hidden="true" />
              {cfg.label}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            Ответ ученика, правильный ответ и редактирование балла + комментарий.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Answers row */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                Ответ ученика
              </div>
              <div className="font-medium text-slate-900 dark:text-slate-100 break-words">
                {studentAnswer !== null ? (
                  studentAnswer
                ) : (
                  <span className="italic text-slate-400">не введён</span>
                )}
              </div>
              {studentAnswer !== null && answerFromOcr && (
                <div className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">
                  распознано с фото бланка — сверь с оригиналом
                </div>
              )}
            </div>
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 dark:border-emerald-900 dark:bg-emerald-950/30">
              <div className="text-xs uppercase tracking-wide text-emerald-700 dark:text-emerald-300 mb-1">
                Правильный ответ
              </div>
              <div className="font-medium text-emerald-900 dark:text-emerald-100 break-words">
                {correctAnswer ?? '—'}
              </div>
            </div>
          </div>

          {/* Score input */}
          <div className="space-y-1.5">
            <Label htmlFor="part1-score-input">
              Балл (0–{maxScore})
            </Label>
            <Input
              id="part1-score-input"
              type="number"
              inputMode="numeric"
              min={0}
              max={maxScore}
              step={1}
              value={scoreText}
              onChange={(e) => setScoreText(e.target.value)}
              disabled={isReadOnly || isSaving}
              className="text-base sm:max-w-[120px]"
            />
            {scoreInvalid && scoreText.trim() !== '' && (
              <p className="text-xs text-rose-700 dark:text-rose-300">
                Балл должен быть от 0 до {maxScore}
              </p>
            )}
          </div>

          {/* Comment textarea */}
          <div className="space-y-1.5">
            <Label htmlFor="part1-comment-input">
              Комментарий ученику (опционально)
            </Label>
            <Textarea
              id="part1-comment-input"
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              disabled={isReadOnly || isSaving}
              placeholder="Например: одна цифра лишняя, в остальном верно"
              maxLength={650}
              className="text-base resize-none"
              rows={3}
            />
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Ученик видит комментарий в результате пробника.
              </p>
              {commentTooLong && (
                <p className="text-xs text-rose-700 dark:text-rose-300">
                  Слишком длинный (макс. 600)
                </p>
              )}
            </div>
          </div>

          {/* Task condition collapsible */}
          {(taskText || taskImageUrl) && (
            <details className="rounded-md border border-slate-200 dark:border-slate-700">
              <summary className="cursor-pointer touch-manipulation px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-900 flex items-center gap-1.5">
                <ChevronDown className="h-3.5 w-3.5 transition-transform" aria-hidden="true" />
                Показать условие задачи
              </summary>
              <div className="px-3 py-3 border-t border-slate-200 dark:border-slate-700 space-y-3 text-sm">
                {taskText && (
                  <Suspense
                    fallback={
                      <div className="whitespace-pre-wrap text-slate-800 dark:text-slate-200">
                        {taskText}
                      </div>
                    }
                  >
                    <MathText
                      text={taskText}
                      className="whitespace-pre-wrap text-slate-800 dark:text-slate-200"
                    />
                  </Suspense>
                )}
                {taskImageUrl && (
                  <a
                    href={taskImageUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="block"
                    aria-label="Открыть картинку задачи в новой вкладке"
                  >
                    <img
                      src={taskImageUrl}
                      alt={`Задача KIM ${kimNumber}`}
                      loading="lazy"
                      className="max-h-[400px] w-auto rounded-md border border-slate-200 dark:border-slate-700"
                    />
                  </a>
                )}
                {!taskText && !taskImageUrl && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />
                    Условие задачи недоступно (отсутствует в variant).
                  </p>
                )}
              </div>
            </details>
          )}

          {errorMsg && (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
              {errorMsg}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
            className="touch-manipulation"
          >
            Отмена
          </Button>
          <Button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!canSave}
            className="touch-manipulation bg-accent text-white hover:bg-accent/90"
          >
            {isSaving ? 'Сохраняем…' : 'Сохранить'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
