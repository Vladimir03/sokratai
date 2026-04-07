import { useMemo, useState } from 'react';
import { AlertCircle, Bell, Mail, MailX } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type {
  TutorHomeworkAssignmentDetails,
  TutorHomeworkResultsResponse,
} from '@/lib/tutorHomeworkApi';
import { RemindStudentDialog } from './RemindStudentDialog';

interface ResultsActionBlockProps {
  assignmentId: string;
  assignmentTitle: string;
  assignedStudents: TutorHomeworkAssignmentDetails['assigned_students'];
  perStudent: TutorHomeworkResultsResponse['per_student'];
}

interface NotStartedRow {
  student_id: string;
  name: string;
  hasTelegram: boolean;
  hasEmail: boolean;
}

/**
 * Action block for Homework Results v2 (TASK-4 of P0-2).
 *
 * Renders one danger row per student who has NOT started the assignment, each
 * with a per-student "Напомнить" CTA. Hint-overuse is surfaced as a chip on
 * the student row itself, not as an action item here. The block hides itself
 * entirely when no students need attention so the page stays calm in the
 * happy path.
 *
 * Channel selection lives in the dialog itself as tabs; the row button just
 * opens the dialog with a sensible default (Telegram if linked, else Email).
 * If a student has neither channel, the button is disabled with a tooltip.
 */
export function ResultsActionBlock({
  assignmentId,
  assignmentTitle,
  assignedStudents,
  perStudent,
}: ResultsActionBlockProps) {
  const [selected, setSelected] = useState<NotStartedRow | null>(null);

  const notStarted = useMemo<NotStartedRow[]>(() => {
    // perStudent / assignedStudents may transiently be undefined while the
    // results query is still hydrating — guard so we never crash the page.
    const safePerStudent = perStudent ?? [];
    const safeAssigned = assignedStudents ?? [];
    const submittedSet = new Set(
      safePerStudent.filter((s) => s.submitted).map((s) => s.student_id),
    );
    return safeAssigned
      .filter((s) => !submittedSet.has(s.student_id))
      .map((s) => ({
        student_id: s.student_id,
        name: s.name ?? 'Без имени',
        hasTelegram: Boolean(s.has_telegram_link),
        hasEmail: Boolean(s.has_email),
      }));
  }, [assignedStudents, perStudent]);

  if (notStarted.length === 0) return null;

  return (
    <>
      <Card className="border-amber-200 bg-amber-50/40">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2 text-slate-900">
            <AlertCircle className="h-4 w-4 text-amber-600" />
            Требует внимания
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-amber-200/60">
            {notStarted.map((row) => {
              const hasAnyChannel = row.hasTelegram || row.hasEmail;
              const buttonLabel = row.hasTelegram
                ? 'Напомнить'
                : row.hasEmail
                  ? 'Напомнить на email'
                  : 'Нет каналов';
              const Icon = !hasAnyChannel
                ? MailX
                : row.hasTelegram
                  ? Bell
                  : Mail;

              return (
                <li
                  key={row.student_id}
                  className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-900 truncate">
                      {row.name}
                    </p>
                    <p className="text-xs text-slate-500">Не приступал к ДЗ</p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="shrink-0 gap-2"
                    disabled={!hasAnyChannel}
                    title={
                      hasAnyChannel
                        ? undefined
                        : 'Нет каналов для уведомления'
                    }
                    onClick={() => hasAnyChannel && setSelected(row)}
                  >
                    <Icon className="h-4 w-4" />
                    {buttonLabel}
                  </Button>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      {selected && (
        <RemindStudentDialog
          open={selected !== null}
          onOpenChange={(next) => {
            if (!next) setSelected(null);
          }}
          assignmentId={assignmentId}
          studentId={selected.student_id}
          studentName={selected.name}
          assignmentTitle={assignmentTitle}
          hasTelegram={selected.hasTelegram}
          hasEmail={selected.hasEmail}
        />
      )}
    </>
  );
}
