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
// 0.5) and optional comment. ai_score is read-only and never overwritten —
// override lives in `tutor_score_override*` only. Reset clears all four
// override fields.
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
  /** AI-evaluated score (read-only). May be null on tasks not yet checked. */
  aiScore: number | null;
  /** Current tutor override on the task_state, if any. */
  currentOverride: number | null;
  /** Current tutor override comment, if any. */
  currentComment: string | null;
}

export function EditScoreDialog({
  open,
  onOpenChange,
  assignmentId,
  studentId,
  task,
  aiScore,
  currentOverride,
  currentComment,
}: EditScoreDialogProps) {
  const queryClient = useQueryClient();
  const initialValue = currentOverride ?? aiScore ?? 0;
  const [valueText, setValueText] = useState<string>(String(initialValue));
  const [comment, setComment] = useState<string>(currentComment ?? '');

  // Reset form whenever the dialog is (re)opened for a new task.
  useEffect(() => {
    if (open) {
      setValueText(String(currentOverride ?? aiScore ?? 0));
      setComment(currentComment ?? '');
    }
  }, [open, currentOverride, aiScore, currentComment]);

  const numericValue = useMemo(() => {
    const n = Number(valueText.replace(',', '.'));
    return Number.isFinite(n) ? n : NaN;
  }, [valueText]);

  const validationError = useMemo(() => {
    if (Number.isNaN(numericValue)) return 'Введите число';
    if (numericValue < 0) return 'Минимум 0';
    if (numericValue > task.max_score) return `Максимум ${task.max_score}`;
    if (Math.round(numericValue * 2) !== numericValue * 2) return 'Шаг 0.5';
    return null;
  }, [numericValue, task.max_score]);

  const isUnchanged =
    !validationError &&
    numericValue === (currentOverride ?? aiScore ?? 0) &&
    (comment ?? '') === (currentComment ?? '');

  const saveMutation = useMutation({
    mutationFn: async (mode: 'save' | 'reset') => {
      return setTutorScoreOverride({
        assignmentId,
        studentId,
        taskId: task.id,
        tutorScoreOverride: mode === 'reset' ? null : numericValue,
        comment: mode === 'reset' ? null : comment.trim() || null,
      });
    },
    onSuccess: (data, mode) => {
      const isReset = mode === 'reset';
      trackGuidedHomeworkEvent('manual_score_override_saved', {
        assignmentId,
        studentId,
        taskId: task.id,
        aiScore: aiScore ?? null,
        tutorScore: isReset ? null : numericValue,
        isReset,
        hadComment: !isReset && comment.trim().length > 0,
      });

      // Invalidate the three React Query keys required by AC-5.
      queryClient.invalidateQueries({
        queryKey: ['tutor', 'homework', 'results', assignmentId],
      });
      queryClient.invalidateQueries({
        queryKey: ['tutor', 'homework', 'detail', assignmentId],
      });
      // Partial key prefix — invalidates `['tutor','homework','thread', *]`
      // for any open GuidedThreadViewer (we don't need the threadId here).
      queryClient.invalidateQueries({
        queryKey: ['tutor', 'homework', 'thread'],
      });

      toast.success(isReset ? 'Override сброшен' : 'Балл обновлён');
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
            Ручная правка балла репетитором. AI-оценка не перезаписывается.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">
            AI: {aiScore != null ? aiScore : '—'}/{task.max_score}
          </div>

          <div className="space-y-1">
            <label htmlFor="edit-score-value" className="text-sm font-medium text-slate-700">
              Балл репетитора
            </label>
            <input
              id="edit-score-value"
              type="number"
              inputMode="decimal"
              step={0.5}
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
                : `0..${task.max_score}, шаг 0.5`}
            </p>
          </div>

          <div className="space-y-1">
            <label htmlFor="edit-score-comment" className="text-sm font-medium text-slate-700">
              Комментарий (опционально)
            </label>
            <textarea
              id="edit-score-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              disabled={isPending}
              maxLength={1000}
              rows={3}
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
              placeholder="Что учесть в правке"
            />
          </div>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          <div>
            {currentOverride != null ? (
              <Button
                type="button"
                variant="ghost"
                disabled={isPending}
                onClick={() => saveMutation.mutate('reset')}
              >
                Сбросить override
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
