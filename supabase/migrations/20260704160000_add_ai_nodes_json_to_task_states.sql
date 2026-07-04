-- strict-criteria-grading Phase 3 / Phase C (2026-07-04) — `ai_nodes_json` on task_states
--
-- Adds nullable JSONB column storing the physics Часть 2 flowchart TRACE
-- (ФИПИ block-schema walk) for visual display to student + tutor. Format:
--   { "score": 2, "max_score": 3, "confidence": 0.9,
--     "steps": [ { "node": "Все формулы/законы", "verdict": "yes" },
--                { "node": "Обозначения, преобразования, вычисления", "verdict": "no" } ] }
--
-- Distinct from `ai_criteria_json` (languages sum-table): this is a DECISION
-- PATH, not a sum of per-criterion scores. The score is computed
-- deterministically by `walkPhysicsFlowchart` (physics-flowcharts.ts) — the
-- model only judges nodes, the code walks the ФИПИ tree. Each `verdict` uses
-- POSITIVE polarity (yes = criterion satisfied), so a UI trace renders ✓/⚠/✗
-- uniformly. Written by `runStudentAnswerGrading` from
-- `GuidedCheckResult.flowchart_trace` (populated in `evaluatePhysicsPart2`).
--
-- Visibility contract (mirror ai_criteria_json, 20260527180000):
--   - VISIBLE to student post-submit — it's a feedback layer alongside
--     `ai_score` / `last_ai_feedback`. NOT added to
--     `stripStudentSensitiveTaskStateFields` (that strip covers the tutor-only
--     `ai_score_comment` + audit UUIDs; the spread keeps every other column).
--   - Column-level GRANT extended below so authenticated PostgREST
--     `.select('ai_nodes_json')` does not trip the REVOKE from 20260516120100
--     (.claude/rules/40-homework-system.md column-GRANT anti-leak invariant:
--      a new student-safe column MUST be granted explicitly).
--
-- Anti-leak: the trace holds ONLY fixed node labels (from the walker, not the
-- model) + a yes/no/partial verdict + optional confidence — no free-text from
-- the AI, no reference-solution content. The student-facing prose lives in
-- `last_ai_feedback` (already anti-spoiler-checked). Zero new leak surface.
-- NULL for every non-physics-Часть-2 grading (languages / numeric / other).
--
-- Backward compat: additive, nullable, idempotent (IF NOT EXISTS). Reapply-safe.

ALTER TABLE public.homework_tutor_task_states
  ADD COLUMN IF NOT EXISTS ai_nodes_json JSONB NULL;

COMMENT ON COLUMN public.homework_tutor_task_states.ai_nodes_json IS
  'Physics Часть 2 ФИПИ flowchart trace for deterministic grading (walkPhysicsFlowchart). Format: { score, max_score, confidence, steps: Array<{node, verdict: yes|no|partial, note?}> }. Positive-polarity nodes (yes = satisfied) for ✓/⚠/✗ UI. NULL for languages (see ai_criteria_json) / numeric / other. Visible to student post-submit (feedback layer). Added 2026-07-04 (strict-criteria-grading Phase C).';

-- Extend column-GRANT whitelist (mirror 20260527180000). Per-column GRANT is
-- additive — the pre-existing whitelist (20260516120100) is preserved.
GRANT SELECT (ai_nodes_json)
  ON public.homework_tutor_task_states
  TO authenticated;
