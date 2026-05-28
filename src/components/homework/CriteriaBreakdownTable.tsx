/**
 * Voice-Speaking MVP TASK-4 (2026-05-27).
 *
 * Shared per-criterion breakdown table for language subjects (DELF / ЕГЭ EN /
 * IELTS / ОГЭ — written + oral). Mounted on:
 *   - Student post-grade view (`src/pages/student/HomeworkProblem.tsx`)
 *   - Tutor thread viewer (`src/components/tutor/GuidedThreadViewer.tsx`)
 *
 * Data source: `homework_tutor_task_states.ai_criteria_json` (validated +
 * normalized by `evaluateStudentAnswer::sanitizeCriteriaBreakdown` —
 * `supabase/functions/homework-api/guided_ai.ts`). Sum of `score` items ==
 * `ai_score` (Σ excluding `tutor_only`, see spec §3).
 *
 * Invariants (spec §6 + .claude/rules/90-design-system.md):
 *   - All on ONE page (single bordered card, no nested scroll containers).
 *   - LaTeX in comments rendered via lazy MathText.
 *   - No emoji in chrome. Lucide icons not needed — pure typography.
 *   - Same component reused by письмо AND голос (TASK-2 templates already
 *     cover both production écrite and production orale variants).
 *   - When the criteria array is empty/null, parent suppresses render.
 *   - `kind: 'tutor_only'` criteria (phonétique, etc.) surface a small
 *     «оценивает репетитор» hint — AI never penalizes these.
 */

import { lazy, memo, Suspense } from "react";

const MathText = lazy(() =>
  import("@/components/kb/ui/MathText").then((m) => ({ default: m.MathText })),
);

export interface CriteriaBreakdownItem {
  label: string;
  score: number;
  max: number;
  comment: string;
  /**
   * Optional marker for criteria the AI deliberately did not grade
   * (phonétique / произношение). Surfaced as a muted hint row beside the
   * score. Backend writes neutral comments for these; UI clarifies the
   * grading owner.
   */
  kind?: "ai" | "tutor_only";
}

interface CriteriaBreakdownTableProps {
  criteria: CriteriaBreakdownItem[];
  /** Optional className for the wrapper (parent layout integration). */
  className?: string;
}

/** Trim trailing zero from values like `2.0` while keeping `2.5`. */
function formatScore(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const rounded = Math.round(value * 10) / 10;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(1).replace(/\.0$/, "");
}

function CriteriaBreakdownTableImpl({
  criteria,
  className,
}: CriteriaBreakdownTableProps) {
  if (!Array.isArray(criteria) || criteria.length === 0) return null;

  // Footer total = Σ over AI-graded criteria only. `tutor_only` rows
  // (phonétique / произношение) are informational — the tutor scores them
  // on listening, so they're excluded from the AI breakdown total and
  // shown with «—» (review fix 2026-05-27, P1 #2). This keeps footer и rows
  // internally consistent on the template scale regardless of task max_score.
  const aiGraded = criteria.filter((c) => c.kind !== 'tutor_only');
  const displayTotal = aiGraded.reduce((sum, c) => sum + (Number(c.score) || 0), 0);
  const displayMax = aiGraded.reduce((sum, c) => sum + (Number(c.max) || 0), 0);

  const wrapperClass = [
    "rounded-md border border-slate-200 bg-white overflow-hidden",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section
      className={wrapperClass}
      aria-label="Разбор по критериям"
    >
      <header className="px-3 py-2 border-b border-slate-200 bg-slate-50">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          Разбор по критериям
        </h3>
      </header>
      <ul className="divide-y divide-slate-100" role="list">
        {criteria.map((c, idx) => {
          const isTutorOnly = c.kind === "tutor_only";
          const comment = (c.comment ?? "").trim();
          return (
            <li
              key={`${c.label}-${idx}`}
              className="px-3 py-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1"
            >
              <span className="text-sm font-medium text-slate-900 break-words">
                {c.label}
              </span>
              <span className="text-sm font-semibold tabular-nums text-slate-900 shrink-0">
                {/* tutor_only criteria show «—» (not graded by AI) instead of
                    an inflated full-mark score; the real mark is the tutor's. */}
                {isTutorOnly ? `—/${formatScore(c.max)}` : `${formatScore(c.score)}/${formatScore(c.max)}`}
              </span>
              {isTutorOnly ? (
                <p className="col-span-2 text-[11px] text-slate-500 italic leading-relaxed">
                  Оценивает репетитор на слух — AI не штрафует.
                </p>
              ) : null}
              {comment ? (
                <div className="col-span-2 text-xs text-slate-600 leading-relaxed">
                  <Suspense fallback={<span>{comment}</span>}>
                    <MathText text={comment} />
                  </Suspense>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      <footer className="px-3 py-2 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-900">Итого</span>
        <span className="text-base font-bold tabular-nums text-accent">
          {formatScore(Number(displayTotal) || 0)}/{formatScore(Number(displayMax) || 0)}
        </span>
      </footer>
    </section>
  );
}

const CriteriaBreakdownTable = memo(CriteriaBreakdownTableImpl);
export default CriteriaBreakdownTable;
