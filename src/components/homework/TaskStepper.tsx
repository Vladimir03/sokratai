/**
 * Task progress indicator for the guided homework workspace.
 * Horizontal scrollable on mobile, compact sidebar on desktop.
 */

import { memo, useRef, useEffect } from 'react';
import { Check, Lock } from 'lucide-react';
import type { TaskStateStatus } from '@/types/homework';

export interface TaskStepItem {
  order_num: number;
  task_text: string;
  status: TaskStateStatus;
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
    <div className="flex gap-2 overflow-x-auto py-2 px-1 scrollbar-none">
      {tasks.map((task, idx) => {
        const style = STATUS_STYLES[task.status];
        const isActive = task.status === 'active';
        const isClickable = task.status === 'active' || task.status === 'completed';
        const isLast = idx === tasks.length - 1;

        return (
          <div key={task.order_num} className="flex items-center shrink-0">
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
              title={`Задача ${task.order_num}: ${task.task_text.slice(0, 50)}`}
            >
              {task.status === 'completed' ? (
                <Check className="w-4 h-4" />
              ) : task.status === 'locked' ? (
                <Lock className="w-3 h-3" />
              ) : (
                task.order_num
              )}
            </button>
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
  );
});

TaskStepper.displayName = 'TaskStepper';

export default TaskStepper;
