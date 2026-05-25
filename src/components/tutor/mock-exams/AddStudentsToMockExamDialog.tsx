/**
 * Mock Exams v1 — Add Students dialog (TASK-17 «Recipient Management»).
 *
 * Tutor добавляет дополнительных учеников в existing активный пробник
 * без создания дубликата. Решает root cause «не плодить сущности»
 * (Egor's screenshot: 3 duplicate "Пробник Тренировочный 1" rows).
 *
 * Re-uses canonical `HWAssignSection` (groups + individuals + locked existing)
 * для consistency cross-product. Backend endpoint
 * `POST /assignments/:id/assign-students` (mock-exam-tutor-api).
 *
 * UX decisions (Vladimir 2026-05-17):
 *   - Entry point: «+ Добавить учеников» в шапке TutorMockExamDetail
 *   - Picker: HWAssignSection целиком (для парирности с ДЗ)
 *   - Просроченный deadline: add + amber warning toast
 *   - Notify: checkbox «Отправить уведомление сейчас» default ON
 *   - Notify scope: push + telegram (без email)
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { HWAssignSection } from '@/components/tutor/homework-create/HWAssignSection';

// AssignTab — local type in HWAssignSection (not exported). Inline for type safety.
type AssignTab = 'groups' | 'students';
import { useTutor, useTutorGroups } from '@/hooks/useTutor';
import { getTutorInviteWebLink } from '@/utils/telegramLinks';
import { assignMockExamStudents, MockExamApiError } from '@/lib/mockExamApi';
import { MOCK_EXAM_ASSIGNMENT_QUERY_KEY } from '@/hooks/useMockExamAssignment';
import { MOCK_EXAM_ASSIGNMENTS_QUERY_KEY } from '@/hooks/useMockExamAssignments';

interface AddStudentsToMockExamDialogProps {
  assignmentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** student_id of attempts already in assignment (locked в picker). */
  existingStudentIds: string[];
  /** ISO timestamp или null. Если < now() — amber warning chip в footer. */
  deadline: string | null;
}

function getAppOrigin(): string {
  if (typeof window !== 'undefined') return window.location.origin;
  return 'https://sokratai.ru';
}

function daysAgo(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

export function AddStudentsToMockExamDialog({
  assignmentId,
  open,
  onOpenChange,
  existingStudentIds,
  deadline,
}: AddStudentsToMockExamDialogProps) {
  const queryClient = useQueryClient();
  const { tutor } = useTutor();
  const miniGroupsEnabled = Boolean(tutor?.mini_groups_enabled);
  const { groups, loading: groupsLoading, error: groupsError, refetch: refetchGroups, isFetching: groupsIsFetching, isRecovering: groupsIsRecovering, failureCount: groupsFailureCount } =
    useTutorGroups(miniGroupsEnabled);

  // Phase 9 (2026-05-25): canonical claim URL sokratai.ru/invite/{code} вместо preview
  // edge function (последний показывал mojibake при прямом визите репетитора в браузере).
  const inviteWebLink = tutor?.invite_code
    ? getTutorInviteWebLink(tutor.invite_code)
    : '';
  const appOrigin = getAppOrigin();
  const studentLoginLink = `${appOrigin}/login`;
  const studentSignupLink = `${appOrigin}/signup`;

  // Local dialog state — reset при open=true (mirror create flow baseline).
  const existingSet = useMemo(
    () => new Set(existingStudentIds),
    [existingStudentIds],
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(existingStudentIds),
  );
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set());
  const [manuallyRemovedIds, setManuallyRemovedIds] = useState<Set<string>>(new Set());
  const [manuallyAddedIds, setManuallyAddedIds] = useState<Set<string>>(new Set());
  const [assignTab, setAssignTab] = useState<AssignTab>('students');
  const [notify, setNotify] = useState(true);
  // HWAssignSection demands these but we hide via hideNotify.
  const [notifyTemplate, setNotifyTemplate] = useState('');

  // Reset state on open transition (so reopening dialog не keeps stale selection).
  useEffect(() => {
    if (open) {
      setSelectedIds(new Set(existingStudentIds));
      setSelectedGroupIds(new Set());
      setManuallyRemovedIds(new Set());
      setManuallyAddedIds(new Set());
      setAssignTab('students');
      setNotify(true);
      setNotifyTemplate('');
    }
  }, [open, existingStudentIds]);

  // Compute "new" selection — то что ученики добавили сверху existing.
  const newStudentIds = useMemo(() => {
    const result: string[] = [];
    for (const id of selectedIds) {
      if (!existingSet.has(id)) result.push(id);
    }
    return result;
  }, [selectedIds, existingSet]);

  const deadlineWarning = useMemo(() => {
    if (!deadline) return null;
    const passed = new Date(deadline) < new Date();
    if (!passed) return null;
    const days = daysAgo(deadline);
    return days === 0
      ? 'Дедлайн истекает сегодня.'
      : `Дедлайн прошёл ${days} ${days === 1 ? 'день' : days < 5 ? 'дня' : 'дней'} назад. Продли через Edit, чтобы ученики успели.`;
  }, [deadline]);

  const mutation = useMutation({
    mutationFn: async () => {
      return await assignMockExamStudents(assignmentId, {
        student_ids: newStudentIds,
        notify,
      });
    },
    onSuccess: (data) => {
      const parts: string[] = [];
      parts.push(
        `Добавлено ${data.added} ${data.added === 1 ? 'ученик' : data.added < 5 ? 'ученика' : 'учеников'}`,
      );
      if (data.skipped_existing > 0) {
        parts.push(`пропущено ${data.skipped_existing} уже назначены`);
      }
      if (notify) {
        const totalSent = data.notify.sent_push + data.notify.sent_telegram;
        if (totalSent > 0) {
          parts.push(`уведомлено ${totalSent}`);
        }
        if (data.notify.failed_no_channel > 0) {
          parts.push(
            `${data.notify.failed_no_channel} без канала (нет Telegram/push)`,
          );
        }
      }
      toast.success(parts.join(' · '));

      if (data.deadline_passed && data.added > 0) {
        toast.warning(
          'Дедлайн пробника прошёл. Продли его через Edit, чтобы новые ученики успели.',
          { duration: 8000 },
        );
      }

      // Invalidate detail + list queries.
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
            : 'Не удалось добавить учеников';
      toast.error(msg);
    },
  });

  const handleSubmit = useCallback(() => {
    if (newStudentIds.length === 0) {
      toast.error('Выбери хотя бы одного нового ученика');
      return;
    }
    mutation.mutate();
  }, [newStudentIds.length, mutation]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Добавить учеников в пробник</DialogTitle>
          <DialogDescription>
            Уже назначенные ученики будут заблокированы — добавь только новых.
            После сохранения они получат пробник в свой кабинет.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <HWAssignSection
            selectedIds={selectedIds}
            onChangeSelected={setSelectedIds}
            notifyEnabled={notify}
            onNotifyChange={setNotify}
            notifyTemplate={notifyTemplate}
            onTemplateChange={setNotifyTemplate}
            errors={{}}
            miniGroupsEnabled={miniGroupsEnabled}
            assignTab={assignTab}
            onAssignTabChange={setAssignTab}
            groups={groups}
            groupsLoading={groupsLoading}
            groupsError={groupsError}
            onGroupsRetry={refetchGroups}
            groupsIsFetching={groupsIsFetching}
            groupsIsRecovering={groupsIsRecovering}
            groupsFailureCount={groupsFailureCount}
            selectedGroupIds={selectedGroupIds}
            onSelectedGroupIdsChange={setSelectedGroupIds}
            manuallyRemovedIds={manuallyRemovedIds}
            onManuallyRemovedIdsChange={setManuallyRemovedIds}
            manuallyAddedIds={manuallyAddedIds}
            onManuallyAddedIdsChange={setManuallyAddedIds}
            inviteWebLink={inviteWebLink}
            studentLoginLink={studentLoginLink}
            studentSignupLink={studentSignupLink}
            existingStudentIds={existingSet}
            // Hide HWAssignSection's own notify UI — мы делаем свой checkbox в footer
            // для compact mock-exams flow (без template input).
            hideNotify
          />
        </div>

        <div className="flex flex-col gap-3 pt-3 border-t">
          {deadlineWarning && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:border-amber-900 dark:text-amber-200"
            >
              <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
              <span>{deadlineWarning}</span>
            </div>
          )}

          <div className="flex items-start gap-2">
            <Checkbox
              id="mock-exam-assign-notify"
              checked={notify}
              onCheckedChange={(v) => setNotify(v === true)}
              className="mt-0.5"
            />
            <Label
              htmlFor="mock-exam-assign-notify"
              className="text-sm leading-relaxed cursor-pointer"
            >
              Отправить уведомление сейчас{' '}
              <span className="text-muted-foreground">(push + Telegram)</span>
              <span className="block text-xs text-muted-foreground mt-0.5">
                Ученики без push-подписки и без Telegram увидят пробник при следующем заходе.
              </span>
            </Label>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            Отмена
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={newStudentIds.length === 0 || mutation.isPending}
            className={cn(newStudentIds.length === 0 && 'opacity-50')}
          >
            {mutation.isPending
              ? 'Добавляем…'
              : newStudentIds.length === 0
                ? 'Выбери ученика'
                : `Добавить (${newStudentIds.length})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
