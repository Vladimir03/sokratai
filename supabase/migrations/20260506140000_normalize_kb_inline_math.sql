-- Normalize $$short$$ → $short$ across all text-heavy tutor / KB columns.
--
-- Why: KB import pipeline + manual entry wrapped trivial variable assignments
-- (`$$v = 72$$`, `$$H = 45$$`) in block-math delimiters. Render-time fix in
-- preprocessLatex.ts handles the visual side (commit 5815902), but AI prompts
-- in the chat / homework-api / guided_ai paths read raw column values — the
-- model still saw `$$v = 72$$ км/ч`, which is messy LaTeX from its viewpoint
-- and reduces understanding quality. This migration applies the same heuristic
-- in-place.
--
-- Heuristic (mirrors preprocessLatex.ts):
--   1) `$$X$$` where X is single-line and length 1..40 → `$X$`
--   2) Newlines hugging the now-inline `$X$` collapse to a single space, so
--      "высотой\n$H = 45$\nметров" reads "высотой $H = 45$ метров".
--   3) Long / multiline `$$...$$` (matrices, sums, derivations) untouched —
--      block layout preserved when it actually matters.
--
-- Idempotent: running twice does nothing extra. `$X$` (single-dollar) doesn't
-- match the `$$...$$` pattern, and the newline-collapse step only fires when
-- there's an adjacent `\n`.
--
-- Reversible: pure regex transforms over text columns. No column dropped,
-- no constraint changed, no row deleted. Worst case: we revert by hand-
-- editing rows back to `$$...$$` if a tutor really wanted display math for
-- some reason. (Rare — the few real cases (multiline derivations) stay
-- untouched by the length cap.)

BEGIN;

-- ─── helper functions ─────────────────────────────────────────────

-- Promote short single-line $$...$$ to $...$. PostgreSQL POSIX regex with
-- `g` flag does the substitution globally per row. The `[^$\n]{1,40}` capture
-- enforces the same length + no-newline guard as the JS heuristic.
CREATE OR REPLACE FUNCTION public.normalize_inline_math(input TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $fn$
DECLARE
  result TEXT := input;
BEGIN
  IF input IS NULL THEN
    RETURN NULL;
  END IF;

  -- Step 1: $$X$$ (X has 1..40 non-$, non-newline chars) → $X$
  result := regexp_replace(
    result,
    E'\\$\\$([^$\n]{1,40})\\$\\$',
    E'$\\1$',
    'g'
  );

  -- Step 2a: collapse \n before $...$ (when preceded by non-whitespace)
  result := regexp_replace(
    result,
    E'(\\S)[ \\t]*\n+[ \\t]*(\\$[^$\n]+\\$)',
    E'\\1 \\2',
    'g'
  );

  -- Step 2b: collapse \n after $...$ (when followed by non-whitespace)
  result := regexp_replace(
    result,
    E'(\\$[^$\n]+\\$)[ \\t]*\n+[ \\t]*(\\S)',
    E'\\1 \\2',
    'g'
  );

  RETURN result;
END;
$fn$;

-- ─── normalize kb_tasks (catalog source of truth) ─────────────────

UPDATE public.kb_tasks
SET
  text = public.normalize_inline_math(text),
  answer = public.normalize_inline_math(answer),
  solution = public.normalize_inline_math(solution)
WHERE
  -- LIKE filter avoids touching rows without any block math (cheap pre-check)
  text     LIKE '%$$%'
  OR answer   LIKE '%$$%'
  OR solution LIKE '%$$%';

-- ─── normalize homework_kb_tasks snapshots ────────────────────────
-- Snapshots were taken at "В ДЗ" click time, so they have the same
-- pre-fix `$$short$$` content. Normalize to keep them in sync with
-- their (now-normalized) source rows.

UPDATE public.homework_kb_tasks
SET
  task_text_snapshot      = public.normalize_inline_math(task_text_snapshot),
  task_answer_snapshot    = public.normalize_inline_math(task_answer_snapshot),
  task_solution_snapshot  = public.normalize_inline_math(task_solution_snapshot)
WHERE
  task_text_snapshot      LIKE '%$$%'
  OR task_answer_snapshot   LIKE '%$$%'
  OR task_solution_snapshot LIKE '%$$%';

-- ─── normalize homework_tutor_tasks (tutor-authored ДЗ rows) ──────
-- These either come from KB ("В ДЗ" copy) or hand-typed by the tutor in
-- TutorHomeworkCreate. Either way the same `$$short$$` pattern exists.
-- Both `task_text` (visible to student) and `solution_text` / `rubric_text`
-- (AI-only) need normalization so the AI prompt is clean too.

UPDATE public.homework_tutor_tasks
SET
  task_text       = public.normalize_inline_math(task_text),
  correct_answer  = public.normalize_inline_math(correct_answer),
  solution_text   = public.normalize_inline_math(solution_text),
  solution_steps  = public.normalize_inline_math(solution_steps),
  rubric_text     = public.normalize_inline_math(rubric_text)
WHERE
  task_text       LIKE '%$$%'
  OR correct_answer LIKE '%$$%'
  OR solution_text  LIKE '%$$%'
  OR solution_steps LIKE '%$$%'
  OR rubric_text    LIKE '%$$%';

-- ─── cleanup helper ───────────────────────────────────────────────
-- The function is one-off for this migration. Drop it so it doesn't
-- linger in the schema. Future imports should normalize in-app via
-- preprocessLatex (single source of truth).
DROP FUNCTION public.normalize_inline_math(TEXT);

COMMIT;
