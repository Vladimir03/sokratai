import { ChevronDown, ChevronUp, Info } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { StepIndicator } from './StepIndicator';

const MathText = lazy(() =>
  import('@/components/kb/ui/MathText').then((m) => ({ default: m.MathText })),
);

/**
 * Shape consumed by ProblemContext. Canonical home for the type — kept
 * here (not in fixtures) so the component is decoupled from any one data
 * source. Real data adapter in `HomeworkProblem.tsx` maps the
 * `StudentProblemResponse` from `useStudentProblemTask` into this shape.
 *
 * `given` / `find` / `question` are optional because the API
 * (`StudentProblemTask`) currently returns only raw `task_text`; the
 * "Дано / Найти" KaTeX block is rendered only when the adapter populates
 * these fields (per spec §5: "given (parsed из task_text при наличии)").
 */
export interface ProblemContextTask {
  /** UUID of the task — used as a stable id for ARIA labelledby/controls. */
  task_id: string;
  /** 1-based position within the assignment. */
  task_no: number;
  /** Total tasks in the assignment — for step indicator + caption. */
  task_total: number;
  /** Computed final score for this task (override > earned > ai > status). */
  task_score: number;
  /** Max score for this task. */
  task_score_max: number;
  /** Drives the warn-banner copy at the bottom of expanded view. */
  task_kind: 'numeric' | 'extended' | 'proof';
  /** Plain task text (may contain inline `$…$` KaTeX). */
  body: string;
  /** Optional emphasised question line (separate `<p>` in expanded view). */
  question?: string;
  /** Optional structured "Дано" rows. */
  given?: { sym: string; val: string; unit: string }[];
  /** Optional "Найти" target (LaTeX, rendered with " - ?" suffix). */
  find?: string;
  /** 1-based indices of completed tasks (other than the current one). */
  done_task_indices: number[];
}

interface ProblemContextProps {
  task: ProblemContextTask;
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
          {/* Body — render through lazy MathText so inline LaTeX (\frac,
              \sqrt, indexes) renders as KaTeX. Phase 1 backend returns
              raw `task_text` which often contains physics ЕГЭ formulas;
              raw rendering broke condition readability (see codex review
              finding #5 + .claude/rules/90-design-system.md «Math»
              invariant). Suspense fallback = plain text — no flash of
              missing content while KaTeX bundle loads (~400KB gzipped). */}
          <div className="text-[14.5px] leading-[1.5] text-slate-900">
            <Suspense
              fallback={
                <p className="m-0 whitespace-pre-wrap">{task.body}</p>
              }
            >
              <MathText text={task.body} className="block whitespace-pre-wrap" />
            </Suspense>
          </div>

          {/* Question — emphasized, dark green. Optional: real API doesn't
              currently return a parsed question separately from `body`. */}
          {task.question ? (
            <p className="text-[14.5px] leading-[1.5] font-bold text-socrat-primary-dark m-0">
              {task.question}
            </p>
          ) : null}

          {/* Дано / Найти math block. Rendered only when the adapter
              populated structured fields (spec §5: "parsed из task_text при
              наличии"). Phase 1 backend returns raw text — block hidden. */}
          {(task.given && task.given.length > 0) || task.find ? (
            <div className="grid grid-cols-[1fr_auto] gap-3.5 p-3 bg-socrat-surface rounded-[10px]">
              {task.given && task.given.length > 0 ? (
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
              ) : (
                <div />
              )}
              {task.find ? (
                <div className="flex flex-col gap-1 items-end justify-center">
                  <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-slate-500">
                    Найти
                  </div>
                  <Suspense fallback={<span>{task.find} - ?</span>}>
                    <MathText text={`$${task.find} - ?$`} className="inline" />
                  </Suspense>
                </div>
              ) : null}
            </div>
          ) : null}

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
