/**
 * Mock Exams v1 — Remove Individual Student dialog (TASK-17 «Recipient Management»).
 *
 * Tutor убирает одного ученика из пробника. Use case Egor 2026-05-17:
 * «если по ошибке я пробник влепил 9-класснику — надо чтоб убрать можно
 * было его из пробника».
 *
 * Context-aware copy в зависимости от `attempt.status`:
 *   - not_started (in_progress + started_at=null) → neutral «потерь нет»
 *   - in_progress (started_at set) → amber «прогресс пропадёт»
 *   - submitted/ai_checking/awaiting_review → strong «работа пропадёт»
 *   - approved/manually_entered → red «{score} баллов пропадут навсегда»
 */

import { useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, UserMinus } from 'lucide-react';
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
import { deleteMockExamAttempt, MockExamApiError } from '@/lib/mockExamApi';
import { MOCK_EXAM_ASSIGNMENT_QUERY_KEY } from '@/hooks/useMockExamAssignment';
import { MOCK_EXAM_ASSIGNMENTS_QUERY_KEY } from '@/hooks/useMockExamAssignments';
import type { MockExamAttemptListItem } from '@/types/mockExam';

interface RemoveStudentFromMockExamDialogProps {
  assignmentId: string;
  attempt: MockExamAttemptListItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface SeverityState {
  level: 'neutral' | 'amber' | 'red';
  title: string;
  body: string;
}

function deriveSeverity(attempt: MockExamAttemptListItem): SeverityState {
  const name = attempt.student_display_name?.trim() ||
    (attempt.anonymous_id ? 'анонимного участника' : 'ученика');

  if (attempt.status === 'approved' || attempt.status === 'manually_entered') {
    const score = attempt.total_score;
    const max = attempt.total_score !== null ? attempt.total_score : null;
    const scoreText = attempt.total_score !== null
      ? ` (${attempt.total_score} баллов)`
      : '';
    return {
      level: 'red',
      title: `Убрать ${name} из пробника?`,
      body:
        `Подтверждённый результат${scoreText} пропадёт навсегда. ` +
        `Восстановить нельзя.`,
    };
  }

  if (
    attempt.status === 'submitted' ||
    attempt.status === 'ai_checking' ||
    attempt.status === 'awaiting_review'
  ) {
    return {
      level: 'red',
      title: `Убрать ${name} из пробника?`,
      body:
        'Ученик уже сдал работу. Все ответы Части 1, фото Части 2 и AI-черновик ' +
        'оценки пропадут навсегда.',
    };
  }

  if (attempt.status === 'in_progress' && attempt.started_at !== null) {
    return {
      level: 'amber',
      title: `Убрать ${name} из пробника?`,
      body: 'Ученик уже начал решать. Введённые ответы и загруженные фото пропадут.',
    };
  }

  return {
    level: 'neutral',
    title: `Убрать ${name} из пробника?`,
    body: 'Ученик ещё не приступил — потерь нет.',
  };
}

export function RemoveStudentFromMockExamDialog({
  assignmentId,
  attempt,
  open,
  onOpenChange,
}: RemoveStudentFromMockExamDialogProps) {
  const queryClient = useQueryClient();

  const severity = useMemo(
    () => (attempt ? deriveSeverity(attempt) : null),
    [attempt],
  );

  const mutation = useMutation({
    mutationFn: async () => {
      if (!attempt) throw new Error('No attempt selected');
      return await deleteMockExamAttempt(attempt.id);
    },
    onSuccess: () => {
      toast.success('Ученик убран из пробника');
      void queryClient.invalidateQueries({
        queryKey: MOCK_EXAM_ASSIGNMENT_QUERY_KEY(assignmentId),
      });
      void queryClient.invalidateQueries({
        queryKey: MOCK_EXAM_ASSIGNMENTS_QUERY_KEY,
      });
      onOpenChange(false);
    },
    onError: (err) => {
      const msg =
        err instanceof MockExamApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Не удалось убрать ученика';
      toast.error(msg);
    },
  });

  if (!attempt || !severity) return null;

  const isRed = severity.level === 'red';
  const isAmber = severity.level === 'amber';

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            {(isRed || isAmber) && (
              <AlertTriangle
                className={
                  isRed
                    ? 'h-5 w-5 text-rose-600 dark:text-rose-400'
                    : 'h-5 w-5 text-amber-600 dark:text-amber-400'
                }
                aria-hidden="true"
              />
            )}
            {severity.title}
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-2">
            <span className="block">{severity.body}</span>
            {isRed && (
              <span className="block rounded-md bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-900 dark:bg-rose-950/30 dark:border-rose-900 dark:text-rose-200">
                Это действие нельзя отменить.
              </span>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:gap-2">
          <AlertDialogCancel disabled={mutation.isPending}>Отмена</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              mutation.mutate();
            }}
            disabled={mutation.isPending}
            className={
              isRed
                ? 'bg-rose-600 hover:bg-rose-700 text-white focus:ring-rose-500'
                : isAmber
                  ? 'bg-amber-600 hover:bg-amber-700 text-white focus:ring-amber-500'
                  : 'bg-slate-900 hover:bg-slate-800 text-white'
            }
          >
            <UserMinus className="h-4 w-4 mr-1.5" aria-hidden="true" />
            {mutation.isPending ? 'Убираем…' : 'Убрать'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
