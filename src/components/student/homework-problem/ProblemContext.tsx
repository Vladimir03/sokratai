import { ChevronDown, ChevronUp, Info, Lightbulb } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { StepIndicator } from './StepIndicator';
import { TaskImagesGallery } from './TaskImagesGallery';

const MathText = lazy(() =>
  import('@/components/kb/ui/MathText').then((m) => ({ default: m.MathText })),
);

/**
 * Format score for the chip — drop trailing zeroes (1.5 → "1.5", 2.0 →
 * "2", 0.333… → "0.33"). Mirrors the convention from heatmap helpers.
 */
function formatScoreNumber(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (Number.isInteger(n)) return String(n);
  return Math.round(n * 100) / 100 + '';
}

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
  /**
   * Score chip value (B2 hybrid, 2026-05-10):
   *   - while `score_state='active'` → expected `available_score` (live,
   *     degrades on hint/wrong)
   *   - while `score_state='completed'` → final earned (override > earned
   *     > ai > status)
   * Parent (`HomeworkProblem`) computes the hybrid value and passes it.
   */
  task_score: number;
  /** Max score for this task. */
  task_score_max: number;
  /**
   * Active vs completed task — drives chip styling. `'completed'` makes
   * the score green to telegraph «зафиксировано». Default `'active'`.
   */
  score_state?: 'active' | 'completed';
  /**
   * Hint counter (B3, 2026-05-10): visible in the chip area only when
   * `> 0` so an unused state stays clean. From `task_state.hint_count`.
   */
  hint_count?: number;
  /** Drives the warn-banner copy at the bottom of expanded view. */
  task_kind: 'numeric' | 'extended' | 'proof';
  /** Plain task text (may contain inline `$…$` KaTeX). */
  body: string;
  /**
   * Dual-format `task_image_url` (single `storage://...` ref OR JSON-array).
   * Resolved through `parseAttachmentUrls` inside `TaskImagesGallery`.
   * Phase 1.x preview-QA #1 fix (Q9, 2026-05-10).
   */
  image_url?: string | null;
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
  /**
   * Required when `task.image_url` is non-null — used as the cache key for
   * the batched signed-URL endpoint (`useStudentTaskImagesSignedUrls`) +
   * the per-student namespace check on the backend.
   */
  assignmentId?: string;
  /**
   * Step-indicator click handler. When provided, the row of circles
   * becomes interactive (mobile auto-redirect Q7 — clicking a step
   * navigates to that task's per-task screen). When omitted, the
   * stepper stays read-only (legacy callsite or read-only previews).
   */
  onStepClick?: (taskNo: number) => void;
  /**
   * Hide the «Показать задачу / Свернуть» toggle button. Phase 3
   * (2026-05-12): on tablet/desktop the ProblemContext lives in the left
   * sidebar and is always expanded — collapsing makes no sense there.
   * Mobile (default `false`) keeps the toggle for peek/expand UX.
   */
  hideToggle?: boolean;
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
  assignmentId,
  onStepClick,
  hideToggle = false,
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
        onStepClick={onStepClick}
      />

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-baseline gap-2.5 flex-wrap">
          <span
            id={headerId}
            className="text-[13px] font-semibold text-slate-700"
          >
            Задача {task.task_no} из {task.task_total}
          </span>
          {/* Score chip — hybrid (B2):
                - active: показываем available_score (live)
                - completed: финальный earned (зелёный, фиксированный) */}
          <span
            className={[
              'text-[13px] font-bold tabular-nums',
              task.score_state === 'completed'
                ? 'text-emerald-700'
                : 'text-socrat-primary',
            ].join(' ')}
            aria-label={
              task.score_state === 'completed'
                ? `Финальный балл: ${task.task_score} из ${task.task_score_max}`
                : `Доступно баллов: ${task.task_score} из ${task.task_score_max}`
            }
          >
            {formatScoreNumber(task.task_score)} / {task.task_score_max}{' '}
            {task.score_state === 'completed' ? 'баллов' : 'баллов'}
          </span>
          {/* Hint counter (B3) — visible only when > 0 to keep clean state. */}
          {(task.hint_count ?? 0) > 0 ? (
            <span
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 tabular-nums"
              title="Запрошено подсказок"
              aria-label={`Запрошено подсказок: ${task.hint_count}`}
            >
              <Lightbulb className="h-3 w-3" aria-hidden="true" />
              {task.hint_count}
            </span>
          ) : null}
        </div>
        {!hideToggle ? (
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
        ) : null}
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

          {/* Task images gallery — multi-photo (≤5), under body so the text
              stays the leading element. Q9 + Q10 from preview QA #1
              (2026-05-10). Renders nothing when image_url is null/empty. */}
          {task.image_url && assignmentId ? (
            <TaskImagesGallery
              assignmentId={assignmentId}
              taskId={task.task_id}
              taskImageUrl={task.image_url}
            />
          ) : null}

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
