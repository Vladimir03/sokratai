import { useMemo, useState } from 'react';
import { AlertCircle, Bell, Loader2, Mail, MailX } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatScore } from './heatmapStyles';
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

interface InProgressRow {
  student_id: string;
  name: string;
  solvedTasks: number;
  totalTasks: number;
  totalScore: number;
  totalMax: number;
}

/**
 * Action block for Homework Results v2 (TASK-4 of P0-2).
 *
 * Two sections:
 * 1. "Не приступали" — danger rows for students with no thread at all,
 *    each with a "Напомнить" CTA.
 * 2. "В процессе" — info rows for students with active threads showing
 *    partial progress (solved tasks count + partial score).
 *
 * Both sections hide when empty. The block hides entirely when neither
 * section has rows so the page stays calm in the happy path.
 */
export function ResultsActionBlock({
  assignmentId,
  assignmentTitle,
  assignedStudents,
  perStudent,
}: ResultsActionBlockProps) {
  const [selected, setSelected] = useState<NotStartedRow | null>(null);

  const { notStarted, inProgress } = useMemo(() => {
    // perStudent / assignedStudents may transiently be undefined while the
    // results query is still hydrating — guard so we never crash the page.
    const safePerStudent = perStudent ?? [];
    const safeAssigned = assignedStudents ?? [];

    // Build lookup: student_id → per_student entry.
    const psMap = new Map(safePerStudent.map((s) => [s.student_id, s]));

    const notStartedRows: NotStartedRow[] = [];
    const inProgressRows: InProgressRow[] = [];

    for (const s of safeAssigned) {
      const ps = psMap.get(s.student_id);
      if (ps?.submitted) continue; // completed — no action needed

      const isInProgress = ps != null && ps.total_time_minutes != null;
      if (isInProgress) {
        inProgressRows.push({
          student_id: s.student_id,
          name: s.name ?? 'Без имени',
          solvedTasks: ps.task_scores.length,
          totalTasks: ps.total_max > 0
            ? Math.round(ps.total_max / (ps.total_max / (ps.task_scores.length || 1)))
            : 0,
          totalScore: ps.total_score,
          totalMax: ps.total_max,
        });
      } else {
        notStartedRows.push({
          student_id: s.student_id,
          name: s.name ?? 'Без имени',
          hasTelegram: Boolean(s.has_telegram_link),
          hasEmail: Boolean(s.has_email),
        });
      }
    }

    return { notStarted: notStartedRows, inProgress: inProgressRows };
  }, [assignedStudents, perStudent]);

  if (notStarted.length === 0 && inProgress.length === 0) return null;

  return (
    <>
      {/* In-progress students — lighter info block */}
      {inProgress.length > 0 && (
        <Card className="border-blue-200 bg-blue-50/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2 text-slate-900">
              <Loader2 className="h-4 w-4 text-blue-600" />
              В процессе ({inProgress.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-blue-200/60">
              {inProgress.map((row) => (
                <li
                  key={row.student_id}
                  className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-900 truncate">
                      {row.name}
                    </p>
                    <p className="text-xs text-slate-500">
                      Решено задач: {row.solvedTasks}
                      {row.totalMax > 0 && (
                        <> · Балл: {formatScore(row.totalScore)}/{formatScore(row.totalMax)}</>
                      )}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs font-medium text-blue-700 bg-blue-100 px-2.5 py-1 rounded-full">
                    Решает ДЗ
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Not-started students — danger rows with reminder CTA */}
      {notStarted.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2 text-slate-900">
              <AlertCircle className="h-4 w-4 text-amber-600" />
              Не приступали ({notStarted.length})
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
                    className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
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
      )}

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
