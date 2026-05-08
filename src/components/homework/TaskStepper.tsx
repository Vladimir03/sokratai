/**
 * Task progress indicator for the guided homework workspace.
 * Horizontal scrollable on mobile, compact sidebar on desktop.
 */

import { memo, useRef, useEffect } from 'react';
import { Check, Lock } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { TaskStateStatus } from '@/types/homework';

export interface TaskStepItem {
  order_num: number;
  task_text: string;
  status: TaskStateStatus;
  earned_score?: number | null;
  max_score?: number;
  /**
   * AI's raw evaluated score before any degradation. Shown in the tooltip
   * alongside `tutor_score_override` so the student sees both values when
   * the tutor has manually overridden the score (per UX answer C — full
   * grading transparency on the student side).
   */
  ai_score?: number | null;
  /**
   * Tutor's manual override (final score visible to the student). When
   * present, displayed as the primary "Балл репетитора" line in the tooltip.
   */
  tutor_score_override?: number | null;
  /** Public comment from the tutor to the student. Visible to student. */
  tutor_score_override_comment?: string | null;
  /**
   * Resolved final score = override → earned_score → ai_score → status fallback.
   * Mirrors `computeFinalScore` on the backend. Built by the parent so the
   * stepper doesn't need to duplicate the priority chain.
   */
  final_score?: number | null;
}

function formatScore(value: number): string {
  return value.toFixed(1).replace(/\.0$/, '');
}

interface TaskStepperProps {
  tasks: TaskStepItem[];
  currentTaskOrder: number;
  onTaskClick?: (orderNum: number) => void;
  celebratingTaskOrder?: number | null;
}

const STATUS_STYLES: Record<
  TaskStateStatus,
  { bg: string; border: string; text: string; ring?: string }
> = {
  locked: {
    bg: 'bg-muted',
    border: 'border-muted-foreground/30',
    text: 'text-muted-foreground',
  },
  active: {
    bg: 'bg-primary',
    border: 'border-primary',
    text: 'text-primary-foreground',
    ring: 'ring-2 ring-primary/30 ring-offset-2',
  },
  completed: {
    bg: 'bg-green-500',
    border: 'border-green-500',
    text: 'text-white',
  },
  skipped: {
    bg: 'bg-amber-400',
    border: 'border-amber-400',
    text: 'text-white',
  },
};

const STATUS_LABELS: Record<TaskStateStatus, string> = {
  locked: 'Закрыта',
  active: 'Активная',
  completed: 'Завершена',
  skipped: 'Пропущена',
};

const TaskStepper = memo(({ tasks, currentTaskOrder, onTaskClick, celebratingTaskOrder }: TaskStepperProps) => {
  const activeRef = useRef<HTMLButtonElement>(null);

  // Auto-scroll to active task
  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center',
      });
    }
  }, [currentTaskOrder]);

  return (
    <TooltipProvider delayDuration={120}>
      <div className="flex gap-2 overflow-x-auto py-2 px-1 scrollbar-none">
        {tasks.map((task, idx) => {
          const style = STATUS_STYLES[task.status];
          const isActive = task.order_num === currentTaskOrder;
          const isCelebrating = task.order_num === celebratingTaskOrder;
          const isClickable = task.status !== 'locked';
          const isLast = idx === tasks.length - 1;

          return (
            <div key={task.order_num} className="flex items-center shrink-0">
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="relative">
                    <button
                      ref={isActive ? activeRef : undefined}
                      type="button"
                      disabled={!isClickable}
                      onClick={() => isClickable && onTaskClick?.(task.order_num)}
                      className={`
                        flex items-center justify-center
                        w-8 h-8 rounded-full border-2
                        text-xs font-semibold
                        transition-all duration-300
                        ${isCelebrating ? 'bg-green-500 border-green-500 text-white ring-2 ring-green-500/30 ring-offset-2 scale-110' : `${style.bg} ${style.border} ${style.text}`}
                        ${!isCelebrating && isActive ? (style.ring || '') : ''}
                        ${isClickable ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}
                        disabled:cursor-default
                      `}
                    >
                      {isCelebrating ? (
                        <Check className="w-4 h-4" />
                      ) : task.status === 'completed' ? (
                        <Check className="w-4 h-4" />
                      ) : task.status === 'locked' ? (
                        <Lock className="w-3 h-3" />
                      ) : (
                        task.order_num
                      )}
                    </button>
                    {isCelebrating && (
                      <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-green-500 text-white text-[10px] animate-bounce">
                        ✓
                      </span>
                    )}
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[260px] text-xs">
                  <div className="font-medium">Задача {task.order_num}</div>
                  <div className="text-muted-foreground mb-1">{STATUS_LABELS[task.status]}</div>
                  {task.status === 'completed' && task.max_score != null && (
                    <div className="mb-1 space-y-0.5">
                      {task.tutor_score_override != null ? (
                        <>
                          <div className="text-foreground font-medium">
                            Балл репетитора: {formatScore(task.tutor_score_override)} / {task.max_score}
                          </div>
                          {task.ai_score != null && Number(task.ai_score) !== Number(task.tutor_score_override) ? (
                            <div className="text-muted-foreground">
                              AI: {formatScore(Number(task.ai_score))} / {task.max_score}
                            </div>
                          ) : null}
                          {task.tutor_score_override_comment ? (
                            <div className="mt-1 rounded-sm bg-muted/40 px-2 py-1 text-foreground">
                              {task.tutor_score_override_comment}
                            </div>
                          ) : null}
                        </>
                      ) : task.final_score != null ? (
                        <div className="text-muted-foreground">
                          Балл: {formatScore(task.final_score)} / {task.max_score}
                        </div>
                      ) : task.earned_score != null ? (
                        <div className="text-muted-foreground">
                          Балл: {formatScore(Number(task.earned_score))} / {task.max_score}
                        </div>
                      ) : null}
                    </div>
                  )}
                  <div className="max-w-[220px] break-words">{task.task_text}</div>
                </TooltipContent>
              </Tooltip>
              {!isLast && (
                <div
                  className={`w-4 h-0.5 mx-0.5 transition-colors duration-200 ${
                    task.status === 'completed' ? 'bg-green-500' : 'bg-muted-foreground/20'
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>
    </TooltipProvider>
  );
});

TaskStepper.displayName = 'TaskStepper';

export default TaskStepper;
