/**
 * Mock Exams v1 — Delete Assignment dialog (TASK-17 «Recipient Management»).
 *
 * Tutor удаляет пробник целиком (cascade attempts + part1_answers +
 * part2_solutions + public_links + storage). Context-aware copy в зависимости
 * от того, есть ли submitted/approved attempts — strong red warning vs neutral.
 *
 * UX decision (Vladimir 2026-05-17): «никогда не блокировать, strong
 * confirmation для submitted/approved». Backend не делает status guard —
 * полагается на эту dialog confirmation.
 */

import { useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertTriangle, Trash2 } from 'lucide-react';
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
import { deleteMockExamAssignment, MockExamApiError } from '@/lib/mockExamApi';
import { MOCK_EXAM_ASSIGNMENTS_QUERY_KEY } from '@/hooks/useMockExamAssignments';
import { MOCK_EXAM_ASSIGNMENT_QUERY_KEY } from '@/hooks/useMockExamAssignment';
import type { MockExamAttemptListItem, MockExamAttemptStatus } from '@/types/mockExam';

/**
 * Minimal shape для severity derivation — позволяет list-card передавать
 * synthetic attempts из counters (`attempts_approved`, etc.) без полного
 * MockExamAttemptListItem. Detail-page передаёт реальные attempts.
 */
export interface DeleteSeveritySource {
  status: MockExamAttemptStatus;
  started_at: string | null;
}

interface DeleteMockExamDialogProps {
  assignmentId: string;
  assignmentTitle: string;
  /** Все attempts пробника — для context-aware warning. */
  attempts: DeleteSeveritySource[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Если true — после успешного delete navigate('/tutor/mock-exams').
   * Используется на detail page; на list page false (stay на list).
   */
  navigateBackOnSuccess?: boolean;
}

interface SeverityState {
  level: 'neutral' | 'amber' | 'red';
  title: string;
  body: string;
  approvedCount: number;
  submittedCount: number;
  inProgressCount: number;
}

function deriveSeverity(
  attempts: DeleteSeveritySource[],
): SeverityState {
  let approvedCount = 0;
  let submittedCount = 0;
  let inProgressCount = 0;
  for (const a of attempts) {
    if (a.status === 'approved' || a.status === 'manually_entered') {
      approvedCount += 1;
    } else if (
      a.status === 'submitted' ||
      a.status === 'ai_checking' ||
      a.status === 'awaiting_review'
    ) {
      submittedCount += 1;
    } else if (a.status === 'in_progress' && a.started_at !== null) {
      inProgressCount += 1;
    }
  }

  if (approvedCount > 0) {
    return {
      level: 'red',
      title: 'Удалить пробник с подтверждёнными результатами?',
      body:
        `У ${approvedCount} ${approvedCount === 1 ? 'ученика' : 'учеников'} есть подтверждённые работы. ` +
        `Их баллы пропадут навсегда из истории, фото из бланков удалятся.`,
      approvedCount,
      submittedCount,
      inProgressCount,
    };
  }
  if (submittedCount > 0 || inProgressCount > 0) {
    return {
      level: 'amber',
      title: 'Удалить пробник с активными работами?',
      body:
        `${submittedCount + inProgressCount} ${(submittedCount + inProgressCount) === 1 ? 'ученик' : 'учеников'} ` +
        (submittedCount > 0
          ? 'сдали или решают пробник'
          : 'начали решать пробник') +
        '. Все данные пропадут.',
      approvedCount,
      submittedCount,
      inProgressCount,
    };
  }
  return {
    level: 'neutral',
    title: 'Удалить пробник?',
    body:
      attempts.length === 0
        ? 'Никто не назначен — пустой пробник.'
        : 'Никто ещё не приступил. Безопасно удалить.',
    approvedCount,
    submittedCount,
    inProgressCount,
  };
}

export function DeleteMockExamDialog({
  assignmentId,
  assignmentTitle,
  attempts,
  open,
  onOpenChange,
  navigateBackOnSuccess = false,
}: DeleteMockExamDialogProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const severity = useMemo(() => deriveSeverity(attempts), [attempts]);

  const mutation = useMutation({
    mutationFn: async () => {
      return await deleteMockExamAssignment(assignmentId);
    },
    onSuccess: (data) => {
      const parts: string[] = ['Пробник удалён'];
      if (data.attempts_removed > 0) {
        parts.push(`${data.attempts_removed} попыток`);
      }
      if (data.storage_objects_removed > 0) {
        parts.push(`${data.storage_objects_removed} файлов из storage`);
      }
      toast.success(parts.join(' · '));

      // Invalidate list + remove cached detail.
      void queryClient.invalidateQueries({
        queryKey: MOCK_EXAM_ASSIGNMENTS_QUERY_KEY,
      });
      queryClient.removeQueries({
        queryKey: MOCK_EXAM_ASSIGNMENT_QUERY_KEY(assignmentId),
      });

      onOpenChange(false);
      if (navigateBackOnSuccess) {
        navigate('/tutor/mock-exams');
      }
    },
    onError: (err) => {
      const msg =
        err instanceof MockExamApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Не удалось удалить пробник';
      toast.error(msg);
    },
  });

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
            <span className="block font-medium text-slate-900 dark:text-slate-100">
              «{assignmentTitle}»
            </span>
            <span className="block">{severity.body}</span>
            {isRed && (
              <span className="block rounded-md bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-900 dark:bg-rose-950/30 dark:border-rose-900 dark:text-rose-200">
                Это действие нельзя отменить. Если хочешь сохранить данные —
                закрой пробник вместо удаления.
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
            <Trash2 className="h-4 w-4 mr-1.5" aria-hidden="true" />
            {mutation.isPending ? 'Удаляем…' : 'Удалить пробник'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
