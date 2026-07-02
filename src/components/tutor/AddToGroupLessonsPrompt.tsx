import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { pluralizeRu } from '@/lib/pluralizeRu';

export interface AddToGroupLessonsPromptProps {
  open: boolean;
  studentName: string;
  groupName: string;
  /** Кол-во будущих booked-занятий группы (prompt показывается только при > 0). */
  futureCount: number;
  isSubmitting?: boolean;
  onConfirm: () => void;
  /** Закрытие без добавления (Отмена / Esc / клик вне). */
  onCancel: () => void;
}

/**
 * Roster-driven подтверждение: ученика добавили в состав учебной группы —
 * предлагаем добавить его и в будущие занятия этой группы (по каждому появится
 * оплата). Общий для всех поверхностей (профиль ученика, AddStudentDialog,
 * расписание), чтобы не дублировать копирайт/логику диалога.
 */
export function AddToGroupLessonsPrompt({
  open,
  studentName,
  groupName,
  futureCount,
  isSubmitting = false,
  onConfirm,
  onCancel,
}: AddToGroupLessonsPromptProps) {
  const countPhrase = `${futureCount} ${pluralizeRu(futureCount, [
    'будущее занятие',
    'будущих занятия',
    'будущих занятий',
  ])}`;

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !isSubmitting) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Добавить в занятия группы?</AlertDialogTitle>
          <AlertDialogDescription>
            У группы «{groupName}» есть {countPhrase}. Добавить ученика{' '}
            {studentName} во все? По каждому занятию появится оплата.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isSubmitting}>Не добавлять</AlertDialogCancel>
          <Button onClick={onConfirm} disabled={isSubmitting}>
            {isSubmitting ? 'Добавление…' : 'Добавить'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
