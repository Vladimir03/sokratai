import { ChevronDown, ChevronUp, Info } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { StepIndicator } from './StepIndicator';
import type { ProblemTaskFixture } from '@/pages/student/HomeworkProblem.fixtures';

const MathText = lazy(() =>
  import('@/components/kb/ui/MathText').then((m) => ({ default: m.MathText })),
);

interface ProblemContextProps {
  task: ProblemTaskFixture;
  collapsed: boolean;
  onToggle: () => void;
  /** Compact = mobile peek mode (smaller padding/radii). */
  compact?: boolean;
}

/**
 * Task context card with peek (collapsed) and expanded variants.
 * Mirrors design `.pc` rules from `design_handoff_homework_chat`:
 *
 * **Peek (collapsed):** step indicator + "Задача N из M" + score chip +
 * toggle button. Used as the always-visible header on mobile chat.
 *
 * **Expanded:** adds task body, question, "Дано / Найти" math block, and
 * a warm-up warn banner about taskKind. KaTeX inline math via
 * `<MathText>` (lazy).
 *
 * The container uses `<section aria-labelledby>` semantics so screen
 * readers announce "Условие задачи 3 из 9" before the content.
 */
export function ProblemContext({
  task,
  collapsed,
  onToggle,
  compact = false,
}: ProblemContextProps) {
  const headerId = `problem-context-${task.task_id}`;
  const panelId = `problem-context-panel-${task.task_id}`;
  return (
    <section
      aria-labelledby={headerId}
      className={[
        'flex flex-col gap-2.5 bg-white border border-socrat-border-light rounded-[14px]',
        compact ? 'p-3 gap-2 rounded-xl' : 'p-4',
      ].join(' ')}
    >
      <StepIndicator
        total={task.task_total}
        currentNo={task.task_no}
        doneIndices={task.done_task_indices}
      />

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-baseline gap-2.5">
          <span
            id={headerId}
            className="text-[13px] font-semibold text-slate-700"
          >
            Задача {task.task_no} из {task.task_total}
          </span>
          <span className="text-[13px] font-bold text-socrat-primary tabular-nums">
            {task.task_score} / {task.task_score_max} баллов
          </span>
        </div>
        <button
          type="button"
          onClick={onToggle}
          className="inline-flex items-center gap-1 px-1.5 py-1 text-xs font-semibold text-slate-500 hover:text-slate-900 transition-colors touch-manipulation"
          aria-expanded={!collapsed}
          aria-controls={panelId}
        >
          {collapsed ? 'Показать задачу' : 'Свернуть'}
          {collapsed ? (
            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </button>
      </div>

      {!collapsed ? (
        <div id={panelId} className="flex flex-col gap-2.5">
          {/* Body */}
          <p className="text-[14.5px] leading-[1.5] text-slate-900 m-0">
            {task.body}
          </p>

          {/* Question — emphasized, dark green */}
          <p className="text-[14.5px] leading-[1.5] font-bold text-socrat-primary-dark m-0">
            {task.question}
          </p>

          {/* Дано / Найти math block */}
          <div className="grid grid-cols-[1fr_auto] gap-3.5 p-3 bg-socrat-surface rounded-[10px]">
            <div className="flex flex-col gap-1">
              <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-slate-500">
                Дано
              </div>
              <div className="flex flex-col gap-0.5">
                {task.given.map((g) => (
                  <div
                    key={g.sym}
                    className="flex items-center gap-1.5 text-sm tabular-nums"
                  >
                    <Suspense fallback={<span>{g.sym}</span>}>
                      <MathText text={`$${g.sym}$`} className="inline" />
                    </Suspense>
                    <span>=</span>
                    <Suspense fallback={<span>{g.val}</span>}>
                      <MathText text={`$${g.val}$`} className="inline" />
                    </Suspense>
                    <span className="text-slate-500 ml-0.5">{g.unit}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1 items-end justify-center">
              <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-slate-500">
                Найти
              </div>
              <Suspense fallback={<span>{task.find} - ?</span>}>
                <MathText text={`$${task.find} - ?$`} className="inline" />
              </Suspense>
            </div>
          </div>

          {/* Warn banner — task kind hint */}
          {task.task_kind === 'extended' || task.task_kind === 'proof' ? (
            <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border-l-[3px] border-socrat-accent rounded-r-[8px] text-[12.5px] leading-snug text-amber-900">
              <Info
                className="h-3.5 w-3.5 shrink-0"
                aria-hidden="true"
              />
              <span>
                {task.task_kind === 'extended'
                  ? 'Это задача с развёрнутым решением — покажи ход рассуждений.'
                  : 'Доказательство — нужны фото с подробным выводом.'}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
