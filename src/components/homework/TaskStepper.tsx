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
}

interface TaskStepperProps {
  tasks: TaskStepItem[];
  currentTaskOrder: number;
  onTaskClick?: (orderNum: number) => void;
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

const TaskStepper = memo(({ tasks, currentTaskOrder, onTaskClick }: TaskStepperProps) => {
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
          const isActive = task.status === 'active' || task.order_num === currentTaskOrder;
          const isClickable = task.status !== 'locked';
          const isLast = idx === tasks.length - 1;

          return (
            <div key={task.order_num} className="flex items-center shrink-0">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    ref={isActive ? activeRef : undefined}
                    type="button"
                    disabled={!isClickable}
                    onClick={() => isClickable && onTaskClick?.(task.order_num)}
                    className={`
                      flex items-center justify-center
                      w-8 h-8 rounded-full border-2
                      text-xs font-semibold
                      transition-all duration-200
                      ${style.bg} ${style.border} ${style.text}
                      ${style.ring || ''}
                      ${isClickable ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}
                      disabled:cursor-default
                    `}
                  >
                    {task.status === 'completed' ? (
                      <Check className="w-4 h-4" />
                    ) : task.status === 'locked' ? (
                      <Lock className="w-3 h-3" />
                    ) : (
                      task.order_num
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[260px] text-xs">
                  <div className="font-medium">Задача {task.order_num}</div>
                  <div className="text-muted-foreground mb-1">{STATUS_LABELS[task.status]}</div>
                  {task.status === 'completed' && task.earned_score != null && task.max_score != null && (
                    <div className="text-muted-foreground mb-1">
                      Баллы: {task.earned_score} / {task.max_score}
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
