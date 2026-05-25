/**
 * Add Students to Homework dialog (2026-05-25).
 *
 * Решает pain point: репетитор уже создал ДЗ на 3 учеников, а через день
 * ещё один ученик просит то же задание. Раньше — Edit → scroll до
 * HWAssignSection → отметить → scroll через 15 задач → Save (~10 кликов).
 * Теперь — Detail → «+ Добавить учеников» → отметить → «Добавить» (~3 клика).
 *
 * UX (Vladimir 2026-05-25, mirror mock-exams TASK-17 решений):
 *  - Entry point: кнопка в шапке TutorHomeworkDetail
 *  - Picker: HWAssignSection с `existingStudentIds` (уже-assigned locked)
 *  - Notify: auto push + telegram (БЕЗ email), checkbox default ON
 *  - Status gates: НИКАКИХ (draft/active/closed/archived все OK)
 *  - Идемпотентно: уже-assigned silently skipped, отдаются в counter
 *
 * Backend contract: POST /assignments/:id/assign-students
 * (см. supabase/functions/homework-api/index.ts::handleQuickAssignStudentsWithNotify)
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
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
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { HWAssignSection } from '@/components/tutor/homework-create/HWAssignSection';
import { useTutor, useTutorGroups } from '@/hooks/useTutor';
import { getTutorInviteWebLink } from '@/utils/telegramLinks';
import {
  quickAssignHomeworkStudents,
  type QuickAssignHomeworkStudentsResponse,
} from '@/lib/tutorHomeworkApi';

// AssignTab — local type in HWAssignSection (not exported). Inline for type safety.
type AssignTab = 'groups' | 'students';

interface AddStudentsToHomeworkDialogProps {
  assignmentId: string;
  assignmentTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** student_id of students already assigned (locked в picker). */
  existingStudentIds: string[];
}

function getAppOrigin(): string {
  if (typeof window !== 'undefined') return window.location.origin;
  return 'https://sokratai.ru';
}

function pluralizeStudents(n: number): string {
  // Russian noun pluralization for 1/few/many.
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return 'учеников';
  if (mod10 === 1) return 'ученик';
  if (mod10 >= 2 && mod10 <= 4) return 'ученика';
  return 'учеников';
}

export function AddStudentsToHomeworkDialog({
  assignmentId,
  assignmentTitle,
  open,
  onOpenChange,
  existingStudentIds,
}: AddStudentsToHomeworkDialogProps) {
  const queryClient = useQueryClient();
  const { tutor } = useTutor();
  const miniGroupsEnabled = Boolean(tutor?.mini_groups_enabled);
  const {
    groups,
    loading: groupsLoading,
    error: groupsError,
    refetch: refetchGroups,
    isFetching: groupsIsFetching,
    isRecovering: groupsIsRecovering,
    failureCount: groupsFailureCount,
  } = useTutorGroups(miniGroupsEnabled);

  // Phase 9 (2026-05-25): canonical claim URL sokratai.ru/invite/{code}.
  const inviteWebLink = tutor?.invite_code
    ? getTutorInviteWebLink(tutor.invite_code)
    : '';
  const appOrigin = getAppOrigin();
  const studentLoginLink = `${appOrigin}/login`;
  const studentSignupLink = `${appOrigin}/signup`;

  // Local dialog state — reset при open=true.
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

  // Compute "new" selection — что репетитор добавил сверху existing.
  const newStudentIds = useMemo(() => {
    const result: string[] = [];
    for (const id of selectedIds) {
      if (!existingSet.has(id)) result.push(id);
    }
    return result;
  }, [selectedIds, existingSet]);

  const mutation = useMutation<QuickAssignHomeworkStudentsResponse, Error, void>({
    mutationFn: async () =>
      quickAssignHomeworkStudents(assignmentId, newStudentIds, { notify }),
    onSuccess: (data) => {
      const parts: string[] = [];
      parts.push(`Добавлен${data.added === 1 ? '' : data.added < 5 && data.added > 1 ? 'о' : 'о'} ${data.added} ${pluralizeStudents(data.added)}`);
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

      // Invalidate detail + results queries + list.
      void queryClient.invalidateQueries({
        queryKey: ['tutor', 'homework', 'detail', assignmentId],
      });
      void queryClient.invalidateQueries({
        queryKey: ['tutor', 'homework', 'results', assignmentId],
      });
      void queryClient.invalidateQueries({
        queryKey: ['tutor', 'homework', 'assignments'],
      });

      onOpenChange(false);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Не удалось добавить учеников');
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
          <DialogTitle>Добавить учеников в ДЗ</DialogTitle>
          <DialogDescription>
            «{assignmentTitle}» — уже назначенные ученики заблокированы. После
            сохранения новые ученики получат ДЗ в кабинет.
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
            // для compact quick-add flow (без template input).
            hideNotify
          />
        </div>

        <div className="flex flex-col gap-3 pt-3 border-t">
          <div className="flex items-start gap-2">
            <Checkbox
              id="homework-quick-assign-notify"
              checked={notify}
              onCheckedChange={(v) => setNotify(v === true)}
              className="mt-0.5"
            />
            <Label
              htmlFor="homework-quick-assign-notify"
              className="text-sm leading-relaxed cursor-pointer"
            >
              Отправить уведомление сейчас{' '}
              <span className="text-muted-foreground">(push + Telegram)</span>
              <span className="block text-xs text-muted-foreground mt-0.5">
                Ученики без push-подписки и без Telegram увидят ДЗ при следующем заходе.
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
