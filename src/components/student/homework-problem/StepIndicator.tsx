import { Check } from 'lucide-react';

interface StepIndicatorProps {
  /** Total number of tasks in the homework. */
  total: number;
  /** Current task position (1-based). */
  currentNo: number;
  /** Indices (1-based) of tasks the student already completed. */
  doneIndices: number[];
  /**
   * Click handler. When provided, every circle becomes a real button —
   * Phase 1 free-order navigation (Q7 + Q8 from preview QA #1, 2026-05-10):
   * any task is clickable, including not-yet-visited ones, mirroring
   * legacy `GuidedHomeworkWorkspace`'s «Свободный порядок задач» rule.
   * Clicking the current task is a no-op (handler called but no nav).
   */
  onStepClick?: (taskNo: number) => void;
}

/**
 * Horizontal row of N circles representing task progress in the homework.
 * Mirrors design `.pc__steps` from `design_handoff_homework_chat`:
 *
 * - `done`:    bg green-700, white check icon
 * - `current`: bg green-100, 2px green-700 border, dark green digit, halo ring
 * - `pending`: white bg, light border, muted digit
 *
 * Connector dashes between circles render via the parent's flex `gap` —
 * the original CSS used absolute pseudo-elements but flex+gap is simpler
 * and mobile-scrollable. Horizontal scroll on overflow (`overflow-x-auto
 * touch-pan-x`) — keeps iOS Safari swipe working alongside row-onClick.
 *
 * Used by `ProblemContext` (peek and expanded) on mobile + tablet/desktop
 * surfaces in Phase 2-3.
 */
export function StepIndicator({
  total,
  currentNo,
  doneIndices,
  onStepClick,
}: StepIndicatorProps) {
  const doneSet = new Set(doneIndices);
  const isInteractive = typeof onStepClick === 'function';
  return (
    <div
      className="flex items-center gap-1 overflow-x-auto touch-pan-x py-0.5 -mx-1 px-1 [&::-webkit-scrollbar]:hidden"
      role="list"
      aria-label={`Прогресс: задача ${currentNo} из ${total}`}
    >
      {Array.from({ length: total }).map((_, i) => {
        const taskNo = i + 1;
        const isDone = doneSet.has(taskNo);
        const isCurrent = taskNo === currentNo;
        const isLast = i === total - 1;
        const circleClass = [
          'grid h-[26px] w-[26px] place-items-center rounded-full text-[12px] font-bold tabular-nums shrink-0',
          isDone &&
            'bg-socrat-primary text-white border-[1.5px] border-socrat-primary',
          isCurrent &&
            // Token-based focus ring instead of hardcoded rgba.
            // `ring-socrat-primary/15` resolves to brand green @ 15%
            // through Tailwind's color-with-opacity syntax — same
            // visual as the previous rgba(27,107,74,0.15) but routes
            // through the design-system token (per .claude/rules/
            // 90-design-system.md anti-pattern «Hard-coded hex»).
            'bg-socrat-primary-light text-socrat-primary-dark border-2 border-socrat-primary ring-[3px] ring-socrat-primary/15',
          !isDone && !isCurrent &&
            'bg-white text-slate-500 border-[1.5px] border-slate-300',
          isInteractive && !isCurrent &&
            'cursor-pointer hover:border-socrat-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-socrat-primary/40 transition-colors touch-manipulation',
        ]
          .filter(Boolean)
          .join(' ');

        const ariaLabel = `Задача ${taskNo}${
          isCurrent ? ' (текущая)' : isDone ? ' (выполнена)' : ''
        }`;

        // Two render paths: interactive (clickable button) when parent
        // wires `onStepClick`, read-only (`<div role=listitem>`) otherwise.
        // Buttons are debounced via the parent's navigate guard — clicking
        // the same task as `currentNo` is a no-op upstream.
        const inner = isInteractive ? (
          <button
            type="button"
            role="listitem"
            aria-current={isCurrent ? 'step' : undefined}
            aria-label={ariaLabel}
            onClick={() => onStepClick?.(taskNo)}
            className={circleClass}
          >
            {isDone ? (
              <Check className="h-3 w-3 stroke-[3]" aria-hidden="true" />
            ) : (
              taskNo
            )}
          </button>
        ) : (
          <div
            role="listitem"
            aria-current={isCurrent ? 'step' : undefined}
            aria-label={ariaLabel}
            className={circleClass}
          >
            {isDone ? (
              <Check className="h-3 w-3 stroke-[3]" aria-hidden="true" />
            ) : (
              taskNo
            )}
          </div>
        );

        return (
          <div key={taskNo} className="flex items-center gap-1 shrink-0">
            {inner}
            {!isLast ? (
              <span
                className="block h-[1.5px] w-1 bg-slate-300"
                aria-hidden="true"
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
