import { memo, useMemo } from 'react';
import {
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  XCircle,
  AlertCircle,
  WifiOff,
  Bell,
  Send,
  Mail,
  Lightbulb,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { hintOveruseThreshold } from '@/lib/homeworkResultsConstants';
import {
  getCellStyle,
  formatScore,
  formatTotalTime,
  type StudentDisplayStatus,
} from './heatmapStyles';
import type {
  TutorHomeworkAssignmentDetails,
  TutorHomeworkResultsResponse,
  TutorHomeworkResultsPerStudent,
  DeliveryStatus,
} from '@/lib/tutorHomeworkApi';

// ─── DeliveryBadge (local) ───────────────────────────────────────────────────
// Moved here from TutorHomeworkDetail.tsx — only HeatmapGrid needs it now
// that StudentsList has been merged in. Kept structurally identical so Detail
// stays simple.

function DeliveryBadge({ status }: { status: DeliveryStatus | undefined }) {
  if (!status || status === 'pending') return null;

  if (status === 'delivered_push') {
    return (
      <span className="text-xs text-green-600 flex items-center gap-0.5">
        <Bell className="h-3 w-3" /> Push
      </span>
    );
  }
  if (status === 'delivered_telegram') {
    return (
      <span className="text-xs text-green-600 flex items-center gap-0.5">
        <Send className="h-3 w-3" /> Telegram
      </span>
    );
  }
  if (status === 'delivered_email') {
    return (
      <span className="text-xs text-green-600 flex items-center gap-0.5">
        <Mail className="h-3 w-3" /> Email
      </span>
    );
  }
  if (status === 'delivered') {
    return (
      <span className="text-xs text-green-600 flex items-center gap-0.5">
        <CheckCircle2 className="h-3 w-3" /> Доставлено
      </span>
    );
  }
  if (status === 'failed_no_channel') {
    return (
      <span
        className="text-xs text-red-500 flex items-center gap-0.5"
        title="Попросите ученика включить уведомления или добавить email"
      >
        <XCircle className="h-3 w-3" /> Нет каналов
      </span>
    );
  }
  if (status === 'failed_all_channels') {
    return (
      <span
        className="text-xs text-red-500 flex items-center gap-0.5"
        title="Попытки push, Telegram и email не удались"
      >
        <XCircle className="h-3 w-3" /> Все каналы failed
      </span>
    );
  }
  if (status === 'failed_not_connected') {
    return (
      <span className="text-xs text-amber-500 flex items-center gap-0.5">
        <WifiOff className="h-3 w-3" /> Нет Telegram
      </span>
    );
  }
  return (
    <span className="text-xs text-red-500 flex items-center gap-0.5">
      <XCircle className="h-3 w-3" /> Ошибка доставки
    </span>
  );
}

// ─── HeatmapCell ─────────────────────────────────────────────────────────────
// Memoized cell. With 26×10 grids this cuts re-render cost on expand/collapse.

interface HeatmapCellProps {
  score: number | null;
  maxScore: number;
  studentId: string;
  taskId: string;
  isSelected: boolean;
  onCellClick?: (studentId: string, taskId: string) => void;
}

const HeatmapCell = memo(function HeatmapCell({
  score,
  maxScore,
  studentId,
  taskId,
  isSelected,
  onCellClick,
}: HeatmapCellProps) {
  const { className, text } = getCellStyle(score, maxScore);
  const clickable = Boolean(onCellClick);
  const handleClick = clickable
    ? (e: React.MouseEvent<HTMLTableCellElement>) => {
        // Prevent row onClick from re-toggling expand/collapse.
        e.stopPropagation();
        onCellClick!(studentId, taskId);
      }
    : undefined;
  return (
    <td
      className={cn(
        'h-11 px-1 text-center text-sm font-semibold tabular-nums border border-white transition-colors',
        className,
        clickable && 'cursor-pointer touch-manipulation',
        isSelected && 'ring-2 ring-slate-800 ring-inset',
      )}
      onClick={handleClick}
    >
      {text}
    </td>
  );
});

// ─── HeatmapRow ──────────────────────────────────────────────────────────────

interface HeatmapRowProps {
  student: TutorHomeworkAssignmentDetails['assigned_students'][number];
  tasks: TutorHomeworkAssignmentDetails['tasks'];
  taskScoresById: Map<string, { final_score: number; hint_count: number }>;
  expanded: boolean;
  showHintOveruse: boolean;
  hintTotal: number;
  /**
   * homework-student-totals TASK-2 — right-side Балл / Подсказки / Время.
   * All scalars so React.memo shallow comparison stays cheap on 10×26 grids.
   */
  totalScore: number;
  totalMax: number;
  totalTimeMinutes: number | null;
  displayStatus: StudentDisplayStatus;
  onToggle: (studentId: string) => void;
  onCellClick?: (studentId: string, taskId: string) => void;
  selectedTaskId: string | null;
}

const HeatmapRow = memo(function HeatmapRow({
  student,
  tasks,
  taskScoresById,
  expanded,
  showHintOveruse,
  hintTotal,
  totalScore,
  totalMax,
  totalTimeMinutes,
  displayStatus,
  onToggle,
  onCellClick,
  selectedTaskId,
}: HeatmapRowProps) {
  const rowClass = cn(
    'cursor-pointer transition-colors hover:bg-slate-50',
    expanded && 'bg-slate-50',
  );

  const handleClick = () => onToggle(student.student_id);
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTableRowElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onToggle(student.student_id);
    }
  };

  return (
    <tr
      className={rowClass}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      aria-expanded={expanded}
      aria-label={`Ученик ${student.name || 'Без имени'}`}
    >
      {/* Sticky name column. z-10 so cells scroll under it. Uses a flat
          background so sticky content never shows through. Width comes from
          <colgroup> in HeatmapGrid so iOS Safari + table-layout fixed honor
          it (min-w on td is ignored by table layout).
          The right-edge inset shadow is a quiet depth cue: when the table
          scrolls horizontally, the sticky column reads as elevated above
          the scrolling cells instead of floating flat. */}
      <td
        className={cn(
          'sticky left-0 z-10 px-3 py-2 align-middle border-b border-slate-200',
          'shadow-[4px_0_8px_-6px_rgba(15,23,42,0.12)]',
          expanded ? 'bg-slate-50' : 'bg-white',
        )}
      >
        <div className="flex items-center gap-2">
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <p className="font-medium text-sm truncate">
              {student.name || 'Без имени'}
            </p>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              {student.notified ? (
                <span className="text-xs text-green-600 flex items-center gap-0.5">
                  <CheckCircle2 className="h-3 w-3" /> Уведомлён
                </span>
              ) : (
                <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                  <AlertCircle className="h-3 w-3" /> Не уведомлён
                </span>
              )}
              <DeliveryBadge status={student.delivery_status} />
              {/* Hint overuse signal moved to the new "Подсказки" column
                  (homework-student-totals TASK-2). Single source of truth so
                  the same student is not flagged twice on one row. */}
            </div>
          </div>
        </div>
      </td>

      {tasks.map((task) => {
        const cell = taskScoresById.get(task.id);
        return (
          <HeatmapCell
            key={task.id}
            score={cell ? cell.final_score : null}
            maxScore={task.max_score}
            studentId={student.student_id}
            taskId={task.id}
            isSelected={expanded && selectedTaskId === task.id}
            onCellClick={onCellClick}
          />
        );
      })}

      {/* ─── homework-student-totals TASK-2 — right-side totals ───────────
          Three additive columns: Балл / Подсказки / Время.
          - First (Балл) carries `border-l-2` to visually separate task cells
            from the totals block.
          - Status-aware rendering per spec AC-2/AC-3/AC-4 + UX decision Q1
            (in_progress shows «—» for score+hints to avoid the literal "0/Y"
            being indistinguishable from not_started).
          - text-sm (14px) on every cell — task guardrail. */}

      {/* Балл */}
      <td className="border-b border-l-2 border-slate-200 px-3 py-2 align-middle text-right text-sm tabular-nums">
        {displayStatus === 'completed' && totalMax > 0 ? (
          <span className="font-semibold text-slate-900">
            {formatScore(totalScore)}/{formatScore(totalMax)}
          </span>
        ) : (
          <span className="text-slate-400">—</span>
        )}
      </td>

      {/* Подсказки */}
      <td className="border-b border-slate-200 px-2 py-2 align-middle text-right text-sm">
        {displayStatus === 'completed' ? (
          showHintOveruse ? (
            <span
              title={`Подсказок: ${hintTotal}`}
              className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-900 px-2 py-0.5 text-sm font-semibold tabular-nums"
            >
              <Lightbulb className="h-3 w-3" aria-hidden="true" />
              {hintTotal}
            </span>
          ) : (
            <span className="text-slate-500 tabular-nums">{hintTotal}</span>
          )
        ) : (
          <span className="text-slate-400">—</span>
        )}
      </td>

      {/* Время */}
      <td className="border-b border-slate-200 px-3 py-2 align-middle text-right text-sm">
        <span
          className={cn(
            displayStatus === 'completed'
              ? 'text-slate-700 tabular-nums'
              : 'text-slate-400',
          )}
        >
          {formatTotalTime(totalTimeMinutes, displayStatus)}
        </span>
      </td>
    </tr>
  );
});

// ─── HeatmapGrid ─────────────────────────────────────────────────────────────

interface HeatmapGridProps {
  details: TutorHomeworkAssignmentDetails;
  results: TutorHomeworkResultsResponse;
  expandedStudentId: string | null;
  onToggleExpand: (studentId: string) => void;
  /**
   * TASK-6 (AC-4). Cell click selects a task inside the drill-down and expands
   * the student if collapsed. Row onClick still toggles expand independently.
   * Parent must `e.stopPropagation()` — handled inside HeatmapCell.
   */
  onCellClick?: (studentId: string, taskId: string) => void;
  /** Highlight a specific cell with ring-2 ring-slate-800 when a student row is expanded. */
  selectedTaskId?: string | null;
}

/**
 * Students × Tasks heatmap (TASK-5, AC-2).
 *
 * Replaces the previous simple StudentsList with a visual score matrix.
 * Each row is one student with a sticky name column on the left and a
 * horizontally scrollable set of task cells on the right. Cells are colored
 * by `final_score / max_score` per the thresholds in `getCellStyle`.
 *
 * Clicking a row toggles `expandedStudentId` in the parent so the parent
 * can render a separate "Разбор ученика" section with `GuidedThreadViewer`
 * below the grid (AC-3 drill-down is out of scope — TASK-6 will filter by
 * task cell).
 */
export function HeatmapGrid({
  details,
  results,
  expandedStudentId,
  onToggleExpand,
  onCellClick,
  selectedTaskId = null,
}: HeatmapGridProps) {
  const { tasks, assigned_students } = details;
  const { per_student } = results;

  // Precompute lookups once per results/details update. These are shallow and
  // cheap but memoizing keeps HeatmapRow memo stable across re-renders.
  const taskScoresByStudent = useMemo(() => {
    const map = new Map<string, Map<string, { final_score: number; hint_count: number }>>();
    for (const entry of per_student ?? []) {
      const inner = new Map<string, { final_score: number; hint_count: number }>();
      for (const ts of entry.task_scores ?? []) {
        inner.set(ts.task_id, {
          final_score: ts.final_score,
          hint_count: ts.hint_count,
        });
      }
      map.set(entry.student_id, inner);
    }
    return map;
  }, [per_student]);

  const hintTotalByStudent = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of per_student ?? []) {
      map.set(entry.student_id, entry.hint_total);
    }
    return map;
  }, [per_student]);

  // homework-student-totals TASK-2: full per_student lookup so each row can
  // pull `total_score`, `total_max`, `total_time_minutes`, `submitted` in one
  // hop. Kept separate from `taskScoresByStudent` / `hintTotalByStudent` to
  // minimize the diff against TASK-5/6 — those two memoized maps stay
  // referentially stable when only totals change.
  const perStudentByStudent = useMemo(() => {
    const map = new Map<string, TutorHomeworkResultsPerStudent>();
    for (const entry of per_student ?? []) {
      map.set(entry.student_id, entry);
    }
    return map;
  }, [per_student]);

  const taskCount = tasks.length;
  const threshold = taskCount > 0 ? hintOveruseThreshold(taskCount) : Infinity;

  if (assigned_students.length === 0) {
    return (
      <Card animate={false} className="bg-muted/30">
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground">Ученики ещё не назначены</p>
        </CardContent>
      </Card>
    );
  }

  if (taskCount === 0) {
    return (
      <Card animate={false} className="bg-muted/30">
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground">В задании нет задач</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card animate={false}>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          Ученики и задачи
          <Badge variant="outline" className="font-medium tabular-nums">
            {assigned_students.length} × {taskCount}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {/* `touch-pan-x` allows native horizontal swipe on iOS Safari even
            when the row has an onClick handler — without it, the click
            target can swallow the touchstart and prevent panning. */}
        <div className="overflow-x-auto touch-pan-x">
          {/* `border-separate` is REQUIRED — `border-collapse` breaks
              `position: sticky` on <td> in Safari/iOS (WebKit bug). With
              `table-layout: fixed` + explicit <colgroup> widths, the table
              grows to its intrinsic width (220 + 56*N) and the parent
              `overflow-x-auto` actually scrolls instead of squishing
              columns to fit. */}
          <table
            className="border-separate border-spacing-0"
            style={{ tableLayout: 'fixed', width: 'max-content' }}
          >
            <colgroup>
              <col style={{ width: '220px' }} />
              {tasks.map((task) => (
                <col key={task.id} style={{ width: '56px' }} />
              ))}
              {/* homework-student-totals TASK-2 — Балл / Подсказки / Время */}
              <col style={{ width: '90px' }} />
              <col style={{ width: '60px' }} />
              <col style={{ width: '90px' }} />
            </colgroup>
            <thead>
              <tr>
                <th
                  scope="col"
                  className="sticky left-0 z-20 bg-white border-b border-slate-200 text-left px-3 py-2 text-[11px] font-semibold text-slate-600 uppercase tracking-wider shadow-[4px_0_8px_-6px_rgba(15,23,42,0.12)]"
                >
                  Ученик
                </th>
                {tasks.map((task) => (
                  <th
                    key={task.id}
                    scope="col"
                    className="border-b border-slate-200 text-center px-1 py-2 text-[11px] font-semibold tabular-nums text-slate-600 uppercase tracking-wider"
                    title={`Макс. баллов: ${task.max_score}`}
                  >
                    №{task.order_num}
                  </th>
                ))}

                {/* ─── homework-student-totals TASK-2 — totals headers ───
                    Not sticky (right edge of the table). The first one
                    (Балл) carries `border-l-2` to separate the totals
                    block from the task cells. Lightbulb header is
                    icon-only — `aria-label` provides the screen-reader
                    name, `title` provides the desktop hover hint. */}
                <th
                  scope="col"
                  className="border-b border-l-2 border-slate-200 text-right px-3 py-2 text-[11px] font-semibold tabular-nums text-slate-600 uppercase tracking-wider"
                >
                  Балл
                </th>
                <th
                  scope="col"
                  aria-label="Подсказки"
                  title="Подсказки"
                  className="border-b border-slate-200 text-right px-3 py-2 text-slate-600"
                >
                  <Lightbulb className="h-3.5 w-3.5 inline" aria-hidden="true" />
                </th>
                <th
                  scope="col"
                  className="border-b border-slate-200 text-right px-3 py-2 text-[11px] font-semibold text-slate-600 uppercase tracking-wider"
                >
                  Время
                </th>
              </tr>
            </thead>
            <tbody>
              {assigned_students.map((student) => {
                const taskScoresById =
                  taskScoresByStudent.get(student.student_id) ??
                  (EMPTY_TASK_SCORES_MAP as Map<string, { final_score: number; hint_count: number }>);
                const hintTotal = hintTotalByStudent.get(student.student_id) ?? 0;
                const showHintOveruse = hintTotal >= threshold;

                // homework-student-totals TASK-2 — derive scalar props for the
                // right-side Балл / Подсказки / Время columns. All values are
                // primitives so React.memo on HeatmapRow stays cheap.
                const summary = perStudentByStudent.get(student.student_id);
                const totalScore = summary?.total_score ?? 0;
                const totalMax = summary?.total_max ?? 0;
                const totalTimeMinutes = summary?.total_time_minutes ?? null;
                const submitted = summary?.submitted ?? false;
                const displayStatus: StudentDisplayStatus = submitted
                  ? 'completed'
                  : totalTimeMinutes !== null
                    ? 'in_progress'
                    : 'not_started';

                return (
                  <HeatmapRow
                    key={student.student_id}
                    student={student}
                    tasks={tasks}
                    taskScoresById={taskScoresById}
                    expanded={expandedStudentId === student.student_id}
                    showHintOveruse={showHintOveruse}
                    hintTotal={hintTotal}
                    totalScore={totalScore}
                    totalMax={totalMax}
                    totalTimeMinutes={totalTimeMinutes}
                    displayStatus={displayStatus}
                    onToggle={onToggleExpand}
                    onCellClick={onCellClick}
                    selectedTaskId={
                      expandedStudentId === student.student_id ? selectedTaskId : null
                    }
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// Shared empty map so students with no scores do not invalidate the
// HeatmapRow memo on every parent re-render.
const EMPTY_TASK_SCORES_MAP: ReadonlyMap<string, { final_score: number; hint_count: number }> =
  new Map();
