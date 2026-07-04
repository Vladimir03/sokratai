/**
 * strict-criteria-grading Phase C (2026-07-04).
 *
 * Shared visual TRACE of the physics Часть 2 ФИПИ block-schema grading. Mounted
 * on the same two surfaces as `CriteriaBreakdownTable`:
 *   - Student post-grade view (`src/pages/student/HomeworkProblem.tsx`)
 *   - Tutor thread viewer (`src/components/tutor/GuidedThreadViewer.tsx`)
 *
 * Data source: `homework_tutor_task_states.ai_nodes_json` (produced by the
 * deterministic walker `walkPhysicsFlowchart` — the AI only judges the nodes,
 * the CODE computes the score). This is a DECISION PATH, not a sum-table:
 * the ФИПИ score is a tree outcome, so we do NOT sum node scores (contrast
 * `CriteriaBreakdownTable`). Every node is positive-polarity — `verdict='yes'`
 * always means "criterion satisfied" — so ✓/⚠/✗ read uniformly.
 *
 * Invariants:
 *   - No emoji in chrome (rule 90). Lucide icons + status colours reuse the
 *     emerald/amber/rose status semantics already waivered for grading cells
 *     (.claude/rules/90-design-system.md waivers table).
 *   - `shrink-0` on the wrapper: it sets `overflow-hidden`, and as a direct
 *     child of a `flex flex-col` scroll container flex-shrink would otherwise
 *     collapse it to ~2px (rule 80; same bug fixed in CriteriaBreakdownTable).
 *   - Parent suppresses render when `trace`/`steps` is empty.
 *   - `showConfidence` (tutor) surfaces a low-confidence hint; students never
 *     see it (grade is deterministic — confidence is about the node judgments).
 */

import { memo } from "react";
import { Check, Minus, X } from "lucide-react";
import type { HomeworkFlowchartTrace } from "@/types/homework";

interface PhysicsFlowchartTraceProps {
  trace: HomeworkFlowchartTrace;
  /** Optional wrapper className for parent layout integration. */
  className?: string;
  /**
   * Tutor-only: when the node-judgment confidence is low, show a muted hint
   * that the AI was unsure and the tutor should double-check. Students never
   * get this (the score is deterministic; confidence is about the judgments).
   */
  showConfidence?: boolean;
}

/** Below this the node judgments are shaky — tutor should double-check. */
const LOW_CONFIDENCE_THRESHOLD = 0.7;

/** Trim trailing zero from values like `2.0` while keeping `2.5`. */
function formatScore(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const rounded = Math.round(value * 10) / 10;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(1).replace(/\.0$/, "");
}

const VERDICT_META: Record<
  HomeworkFlowchartTrace["steps"][number]["verdict"],
  { Icon: typeof Check; iconClass: string; word: string }
> = {
  yes: { Icon: Check, iconClass: "text-emerald-600", word: "выполнено" },
  partial: { Icon: Minus, iconClass: "text-amber-500", word: "частично" },
  no: { Icon: X, iconClass: "text-rose-500", word: "не выполнено" },
};

function PhysicsFlowchartTraceImpl({
  trace,
  className,
  showConfidence = false,
}: PhysicsFlowchartTraceProps) {
  const steps = Array.isArray(trace?.steps) ? trace.steps : [];
  if (steps.length === 0) return null;

  const lowConfidence = showConfidence && Number(trace.confidence) < LOW_CONFIDENCE_THRESHOLD;

  const wrapperClass = [
    // `shrink-0` REQUIRED — see file header + CriteriaBreakdownTable (rule 80).
    "rounded-md border border-slate-200 bg-white overflow-hidden shrink-0",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={wrapperClass} aria-label="Разбор по блок-схеме ФИПИ">
      <header className="px-3 py-2 border-b border-slate-200 bg-slate-50">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          Разбор по блок-схеме ФИПИ
        </h3>
      </header>
      <ul className="divide-y divide-slate-100" role="list">
        {steps.map((s, idx) => {
          const meta = VERDICT_META[s.verdict] ?? VERDICT_META.no;
          const Icon = meta.Icon;
          const note = (s.note ?? "").trim();
          return (
            <li
              key={`${s.node}-${idx}`}
              className="px-3 py-2 grid grid-cols-[auto_1fr] gap-x-2.5 items-start"
            >
              <Icon
                className={`h-[18px] w-[18px] mt-0.5 shrink-0 ${meta.iconClass}`}
                aria-hidden="true"
              />
              <div className="min-w-0">
                <span className="text-sm font-medium text-slate-900 break-words">
                  <span className="sr-only">{meta.word}: </span>
                  {s.node}
                </span>
                {note ? (
                  <p className="text-xs text-slate-600 leading-relaxed mt-0.5 break-words">
                    {note}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {lowConfidence ? (
        <p className="px-3 py-2 border-t border-slate-200 bg-amber-50 text-[11px] text-amber-800 leading-relaxed">
          AI не уверен в разборе этой работы — проверьте вручную.
        </p>
      ) : null}
      <footer className="px-3 py-2 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-900">Балл по блок-схеме</span>
        <span className="text-base font-bold tabular-nums text-accent">
          {formatScore(Number(trace.score) || 0)}/{formatScore(Number(trace.max_score) || 0)}
        </span>
      </footer>
    </section>
  );
}

const PhysicsFlowchartTrace = memo(PhysicsFlowchartTraceImpl);
export default PhysicsFlowchartTrace;
