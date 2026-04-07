import { memo } from 'react';
import { Lightbulb, Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getCellStyle, formatScore } from './heatmapStyles';

// ─── TaskMiniCard (TASK-6) ───────────────────────────────────────────────────
// Horizontal row of these replaces the row of pill-buttons inside the viewer
// for drill-down navigation. Clicking selects a task — parent force-remounts
// GuidedThreadViewer via `key={selectedTaskId}`. See StudentDrillDown.
//
// Color logic shares getCellStyle with HeatmapGrid so a cell and its matching
// mini-card look identical. Selected ring: `ring-2 ring-slate-800` per AC-4.

interface TaskMiniCardProps {
  /** 1-based task number displayed in the header. */
  taskOrder: number;
  /** Task id used as selection value. For the "Все задачи" card pass null. */
  taskId: string | null;
  /** final_score for this student/task, or null if not attempted. */
  score: number | null;
  /** max_score for this task. Ignored when label is "Все задачи". */
  maxScore: number;
  /** Used to render a lightbulb indicator in the corner. */
  hintCount: number;
  isSelected: boolean;
  /** "Все задачи" card renders differently (neutral bg, no score row). */
  isAllTasks?: boolean;
  /** True if `tutor_score_override` is set — renders a small indicator dot. */
  hasOverride?: boolean;
  /** Optional pencil button → opens EditScoreDialog. Hidden on "Все задачи". */
  onEdit?: () => void;
  onSelect: (taskId: string | null) => void;
}

export const TaskMiniCard = memo(function TaskMiniCard({
  taskOrder,
  taskId,
  score,
  maxScore,
  hintCount,
  isSelected,
  isAllTasks = false,
  hasOverride = false,
  onEdit,
  onSelect,
}: TaskMiniCardProps) {
  const { className: cellClassName } = isAllTasks
    ? { className: 'bg-slate-50 text-slate-700' }
    : getCellStyle(score, maxScore);

  const scoreText = isAllTasks
    ? null
    : score === null
      ? '—'
      : `${formatScore(score)}/${formatScore(maxScore)}`;

  const handleClick = () => onSelect(taskId);
  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(taskId);
    }
  };

  return (
    <div className="relative flex-shrink-0">
      <button
        type="button"
        aria-pressed={isSelected}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        className={cn(
          'relative flex h-16 w-16 flex-col items-center justify-center rounded-md border border-slate-200 text-xs font-medium transition-colors touch-manipulation md:h-20 md:w-20',
          cellClassName,
          isSelected && 'ring-2 ring-slate-800 ring-offset-1 ring-offset-white',
        )}
      >
        <span className="text-[11px] leading-tight text-slate-600 md:text-xs">
          {isAllTasks ? 'Все' : `№${taskOrder}`}
        </span>
        {scoreText !== null ? (
          <span className="mt-0.5 text-sm font-semibold leading-tight md:text-base">
            {scoreText}
          </span>
        ) : null}
        {!isAllTasks && hintCount >= 1 ? (
          <Lightbulb
            className="absolute right-1 top-1 h-3 w-3 text-amber-600"
            aria-label={`Подсказок: ${hintCount}`}
          />
        ) : null}
        {!isAllTasks && hasOverride ? (
          <span
            className="absolute left-1 top-1 h-1.5 w-1.5 rounded-full bg-slate-800"
            aria-label="Балл правлен репетитором"
          />
        ) : null}
      </button>
      {!isAllTasks && onEdit ? (
        <button
          type="button"
          aria-label="Изменить балл"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          className="absolute bottom-0.5 right-0.5 inline-flex h-5 w-5 items-center justify-center rounded bg-white/70 text-slate-700 hover:bg-white hover:text-slate-900 touch-manipulation"
        >
          <Pencil className="h-3 w-3" />
        </button>
      ) : null}
    </div>
  );
});
