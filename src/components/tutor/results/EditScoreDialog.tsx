import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { setTutorScoreOverride } from '@/lib/tutorHomeworkApi';
import { trackGuidedHomeworkEvent } from '@/lib/homeworkTelemetry';

// ─── EditScoreDialog (Homework Results v2 P0-5 / AC-5) ───────────────────────
//
// Manual score override modal. Tutor enters a value in [0..max_score] (step
// 0.5) and optional comment. Override is the FINAL displayed score — when
// set, it wins over earned_score/ai_score for both tutor and student.
//
// Header explains the spread between AI raw score and current displayed
// value (degradation for hints/wrong attempts) so the tutor understands why
// "AI: 1/1" can sit next to a displayed "0.8/1". Field is prefilled with
// the current displayed value, NOT ai_score — common case is "I want to
// override the displayed value" not "I want to match AI".
//
// On success: invalidate the three React Query keys per AC-5 so HeatmapGrid,
// header metrics and the open thread viewer all refresh without reload.

interface EditScoreDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assignmentId: string;
  studentId: string;
  task: {
    id: string;
    order_num: number;
    max_score: number;
  };
  /** AI-evaluated raw score (read-only). May be null on tasks not yet checked. */
  aiScore: number | null;
  /** AI's comment to its own score. Tutor-facing only (never sent to student). */
  aiScoreComment: string | null;
  /**
   * Currently displayed final_score for this (student, task). Used both for
   * the prefill value and for the "Текущий балл" header. Equals
   * `tutor_score_override ?? earned_score ?? ai_score ?? status fallback`.
   */
  finalScore: number | null;
  /** Current tutor override on the task_state, if any. */
  currentOverride: number | null;
  /** Current tutor override comment, if any. Visible to student. */
  currentComment: string | null;
}

function formatScore(value: number): string {
  // Trim trailing zero so 2.5 stays 2.5 but 2.0 → 2.
  return value.toFixed(1).replace(/\.0$/, '');
}

export function EditScoreDialog({
  open,
  onOpenChange,
  assignmentId,
  studentId,
  task,
  aiScore,
  aiScoreComment,
  finalScore,
  currentOverride,
  currentComment,
}: EditScoreDialogProps) {
  const queryClient = useQueryClient();
  // Prefill priority: existing override → current displayed final_score → AI
  // raw score → 0. We deliberately prefer finalScore over aiScore: tutor
  // usually wants to "fix what the student sees", not "set to AI's value".
  const initialValue = currentOverride ?? finalScore ?? aiScore ?? 0;
  const [valueText, setValueText] = useState<string>(String(initialValue));
  const [comment, setComment] = useState<string>(currentComment ?? '');

  // Reset form whenever the dialog is (re)opened for a new task.
  useEffect(() => {
    if (open) {
      setValueText(String(currentOverride ?? finalScore ?? aiScore ?? 0));
      setComment(currentComment ?? '');
    }
  }, [open, currentOverride, finalScore, aiScore, currentComment]);

  const numericValue = useMemo(() => {
    const n = Number(valueText.replace(',', '.'));
    return Number.isFinite(n) ? n : NaN;
  }, [valueText]);

  const validationError = useMemo(() => {
    if (Number.isNaN(numericValue)) return 'Введите число';
    if (numericValue < 0) return 'Минимум 0';
    if (numericValue > task.max_score) return `Максимум ${task.max_score}`;
    // Step 0.1 (post-pilot 2026-05-09 — parity with AI prompt). Tolerance
    // 1e-9 защищает от floating-point junk типа `1.7 * 10 = 16.999...` в
    // некоторых JS-движках.
    const scaled = numericValue * 10;
    if (Math.abs(scaled - Math.round(scaled)) > 1e-9) return 'Шаг 0.1';
    return null;
  }, [numericValue, task.max_score]);

  // "Unchanged" relative to the persisted override only. When no override
  // exists yet, ANY submit is a real change (even if the value happens to
  // equal AI/finalScore — it still creates the override row, which fixes
  // the displayed score from earned/ai chain to a sticky tutor value).
  const trimmedComment = comment.trim();
  const isUnchanged =
    !validationError &&
    currentOverride !== null &&
    numericValue === currentOverride &&
    trimmedComment === (currentComment ?? '');

  // Difference between current displayed score and AI raw score — if any,
  // explain it in the header. earned_score-driven degradation is the only
  // reason for the spread today (override is exposed separately).
  const aiDegradationText = useMemo(() => {
    if (currentOverride !== null) return null; // already a manual override
    if (aiScore == null || finalScore == null) return null;
    const drop = Math.round((aiScore - finalScore) * 100) / 100;
    if (drop <= 0) return null;
    const dropText = formatScore(drop);
    return `снижено на ${dropText} за подсказки/неверные попытки`;
  }, [aiScore, finalScore, currentOverride]);

  const saveMutation = useMutation({
    mutationFn: async (mode: 'save' | 'reset') => {
      return setTutorScoreOverride({
        assignmentId,
        studentId,
        taskId: task.id,
        tutorScoreOverride: mode === 'reset' ? null : numericValue,
        comment: mode === 'reset' ? null : trimmedComment || null,
      });
    },
    onSuccess: (_data, mode) => {
      const isReset = mode === 'reset';
      trackGuidedHomeworkEvent('manual_score_override_saved', {
        assignmentId,
        taskId: task.id,
        aiScore: aiScore ?? null,
        tutorScore: mode === 'reset' ? null : numericValue,
        hadComment: mode !== 'reset' && trimmedComment.length > 0,
      });

      // Invalidate the three React Query keys required by AC-5.
      queryClient.invalidateQueries({
        queryKey: ['tutor', 'homework', 'results', assignmentId],
      });
      queryClient.invalidateQueries({
        queryKey: ['tutor', 'homework', 'detail', assignmentId],
      });
      // Precise key — GuidedThreadViewer keys its query by
      // [..., assignmentId, studentId] (see GuidedThreadViewer.tsx).
      queryClient.invalidateQueries({
        queryKey: ['tutor', 'homework', 'thread', assignmentId, studentId],
      });

      toast.success(isReset ? 'Правка сброшена' : 'Балл обновлён');
      onOpenChange(false);
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'Не удалось сохранить';
      toast.error(message);
    },
  });

  const isPending = saveMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(next) => (!isPending ? onOpenChange(next) : null)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Задача №{task.order_num} — изменить балл</DialogTitle>
          <DialogDescription>
            Балл репетитора — итоговый балл, который видит ученик. AI-оценка не перезаписывается.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700 space-y-1">
            <div>
              Текущий балл:{' '}
              <span className="font-semibold">
                {finalScore != null ? `${formatScore(finalScore)}/${task.max_score}` : '—'}
              </span>
              {aiScore != null && (currentOverride !== null || aiDegradationText) ? (
                <>
                  {' '}
                  (AI: {formatScore(aiScore)}/{task.max_score}
                  {aiDegradationText ? `, ${aiDegradationText}` : null}
                  {currentOverride !== null ? ', ручная правка' : null})
                </>
              ) : aiScore != null ? (
                <span className="text-slate-500"> · AI: {formatScore(aiScore)}/{task.max_score}</span>
              ) : null}
            </div>
            {aiScoreComment ? (
              <div className="text-xs text-slate-500">
                <span className="font-medium">AI:</span> {aiScoreComment}
              </div>
            ) : null}
          </div>

          <div className="space-y-1">
            <label htmlFor="edit-score-value" className="text-sm font-medium text-slate-700">
              Балл репетитора (итог)
            </label>
            <input
              id="edit-score-value"
              type="number"
              inputMode="decimal"
              step={0.1}
              min={0}
              max={task.max_score}
              value={valueText}
              onChange={(e) => setValueText(e.target.value)}
              disabled={isPending}
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
            />
            <p className="text-xs text-slate-500">
              {validationError
                ? validationError
                : `0..${task.max_score}, шаг 0.1`}
            </p>
          </div>

          <div className="space-y-1">
            <label htmlFor="edit-score-comment" className="text-sm font-medium text-slate-700">
              Комментарий (опционально, увидит ученик)
            </label>
            <textarea
              id="edit-score-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              disabled={isPending}
              maxLength={1000}
              rows={3}
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
              placeholder="Например: засчитал полный балл — ход решения правильный"
            />
          </div>
        </div>

        <DialogFooter className="flex-col gap-2 md:flex-row md:justify-between">
          <div>
            {currentOverride != null ? (
              <Button
                type="button"
                variant="ghost"
                disabled={isPending}
                onClick={() => saveMutation.mutate('reset')}
              >
                Сбросить правку
              </Button>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={() => onOpenChange(false)}
            >
              Отмена
            </Button>
            <Button
              type="button"
              disabled={isPending || validationError !== null || isUnchanged}
              onClick={() => saveMutation.mutate('save')}
            >
              {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Сохранить
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
