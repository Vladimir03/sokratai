/**
 * Валидаторы/нормализаторы write-path'ов ДЗ — вынесены из `index.ts`
 * (2026-08-05, волна 2 тест-покрытия): `index.ts` исполняет `Deno.serve` на
 * верхнем уровне и в vitest не импортируется, а эти функции держат инварианты
 * rule 40 (шаг 0.5 у max_score, task_kind ↔ check_format, CEFR, критерии).
 *
 * Все функции ЧИСТЫЕ (без БД/env). Тесты — `validators.test.ts`.
 */
import type { SubjectCriterionTemplate } from "../_shared/subject-rubrics/index.ts";

export const VALID_CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1"] as const;

// homework-work-modes (Ф1): вид работы. 'independent' = самостоятельная —
// AI-подсказки/чат выключены сервером, одна попытка, разбор после сдачи работы.
export const VALID_WORK_MODES = ["homework", "independent"] as const;
export type HomeworkWorkMode = (typeof VALID_WORK_MODES)[number];

/**
 * Верхний предел отправок по одной задаче самостоятельной (ревью-фикс P1 р.2).
 * Продуктово попытка одна, но технические сбои (Whisper, сеть, CHECK_FAILED)
 * законно позволяют переотправку и НЕ расходуют квоту AI — без капа это
 * безлимитный неквотируемый вызов модели. 10 покрывает реальные сбои с запасом.
 */
export const INDEPENDENT_MAX_ATTEMPTS = 10;

export function normalizeWorkMode(v: unknown): HomeworkWorkMode | null {
  return typeof v === "string" && (VALID_WORK_MODES as readonly string[]).includes(v)
    ? (v as HomeworkWorkMode)
    : null;
}

/**
 * Normalize a client-supplied CEFR level for `homework_tutor_tasks.cefr_level`
 * (CEFR-level fix 2026-05-29). Returns one of A2/B1/B2/C1 or null (= auto-detect).
 * `null` preserves the previous text-heuristic behaviour; an explicit value
 * forces the language rubric level in `resolveSubjectRubric`.
 */
export function normalizeCefrLevel(v: unknown): "A1" | "A2" | "B1" | "B2" | "C1" | null {
  return typeof v === "string" && (VALID_CEFR_LEVELS as readonly string[]).includes(v)
    ? (v as "A1" | "A2" | "B1" | "B2" | "C1")
    : null;
}

/**
 * Normalize a client-supplied КИМ number for `homework_tutor_tasks.kim_number`
 * (Phase 2, 2026-06-21). Переносится из KB-задачи, чтобы AI грейдил по критериям
 * ФИПИ конкретного номера (`resolveSubjectRubric`). Integer 1..40 или null.
 */
export function normalizeKimNumber(v: unknown): number | null {
  const n = typeof v === "number"
    ? v
    : typeof v === "string" && /^\d+$/.test(v.trim())
      ? parseInt(v.trim(), 10)
      : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 40 ? n : null;
}

/** Max criteria per task (defensive cap; ЕГЭ-русский = 10). */
export const MAX_GRADING_CRITERIA = 30;

/**
 * Normalize client-supplied structured grading criteria for
 * `homework_tutor_tasks.grading_criteria_json` (criteria-grading feature, 2026-06).
 * Returns a clean `SubjectCriterionTemplate[]` (ANY subject) or null. Drops
 * malformed entries; clamps `max` to a positive half-step (mirror max_score
 * 0.5-step invariant, rule 40); whitelists `kind`; caps array + string lengths.
 * A bad payload never reaches grading. Written by all task write-paths.
 */
export function normalizeGradingCriteria(v: unknown): SubjectCriterionTemplate[] | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  const out: SubjectCriterionTemplate[] = [];
  const seenLabels = new Set<string>();
  for (const raw of v.slice(0, MAX_GRADING_CRITERIA)) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const label = typeof o.label === "string" ? o.label.trim().slice(0, 200) : "";
    if (!label) continue;
    // Dedupe by label — the cascade keys depends_on_zero / scoreByLabel on label
    // (guided_ai.ts::applyCriteriaCascade), so duplicate labels would collapse to
    // one Map entry and silently misroute a dependency. First label wins.
    const labelKey = label.toLowerCase();
    if (seenLabels.has(labelKey)) continue;
    const maxNum = typeof o.max === "number"
      ? o.max
      : typeof o.max === "string" && o.max.trim() !== ""
        ? Number(o.max)
        : NaN;
    if (!Number.isFinite(maxNum) || maxNum <= 0) continue;
    const max = Math.round(maxNum * 2) / 2; // snap to 0.5 step
    if (max <= 0) continue;
    seenLabels.add(labelKey);
    const entry: SubjectCriterionTemplate = { label, max };
    if (o.kind === "tutor_only") entry.kind = "tutor_only";
    if (typeof o.description === "string" && o.description.trim()) {
      entry.description = o.description.trim().slice(0, 1000);
    }
    if (Array.isArray(o.depends_on_zero)) {
      const deps = o.depends_on_zero
        .filter((d): d is string => typeof d === "string" && d.trim().length > 0)
        .map((d) => d.trim().slice(0, 200))
        .slice(0, MAX_GRADING_CRITERIA);
      if (deps.length > 0) entry.depends_on_zero = deps;
    }
    out.push(entry);
  }
  if (out.length === 0) return null;
  // Second pass: drop depends_on_zero refs that don't resolve to a real label in
  // THIS set (stale ref after a label rename → cascade would no-op anyway; this
  // keeps the data clean and the cascade deterministic). Self-refs dropped too.
  const validLabels = new Set(out.map((e) => e.label.toLowerCase()));
  for (const e of out) {
    if (!e.depends_on_zero) continue;
    const selfKey = e.label.toLowerCase();
    const resolved = e.depends_on_zero.filter(
      (d) => validLabels.has(d.toLowerCase()) && d.toLowerCase() !== selfKey,
    );
    if (resolved.length > 0) e.depends_on_zero = resolved;
    else delete e.depends_on_zero;
  }
  return out;
}

export const VALID_FEEDBACK_LANGUAGES = ["auto", "russian", "target"] as const;

/**
 * Phase 11 (2026-05-31): normalize assignment-level `feedback_language`.
 * Persist path returns 'auto'/'russian'/'target' or null (→ DB default 'auto').
 * Read path (passed to AI resolver) coerces null/invalid → 'auto'.
 */
export function normalizeFeedbackLanguage(v: unknown): "auto" | "russian" | "target" | null {
  return typeof v === "string" && (VALID_FEEDBACK_LANGUAGES as readonly string[]).includes(v)
    ? (v as "auto" | "russian" | "target")
    : null;
}

/**
 * Derive `task_kind` (Phase 1 student-screen enum) from `check_format`.
 *
 * Mapping (mirrors backfill in migration `20260509120000_add_task_kind_to_homework_tasks.sql`):
 *   - `short_answer`       → `numeric`
 *   - `detailed_solution`  → `extended`
 *   - any other / null     → `extended` (safe DB default)
 *
 * Bug 2026-05-12: tutor save paths (`handleCreateAssignment`,
 * `handleUpdateAssignment`) wrote `check_format` but not `task_kind`, leaving
 * rows with the DB default `'extended'` even when tutor selected
 * «Краткий ответ». Frontend `ProblemContext.tsx` reads `task_kind` for the
 * warn banner → all numeric tasks looked like extended on student-side.
 *
 * Call this at EVERY write-path that touches `check_format` so the two
 * columns stay in sync. Backfill migration `20260513120000` resyncs existing
 * rows; this helper keeps new writes consistent going forward.
 */
export function deriveTaskKind(
  checkFormat: string | null | undefined,
): "numeric" | "extended" {
  if (checkFormat === "short_answer") return "numeric";
  return "extended"; // detailed_solution | unknown | null
}

/**
 * Resolve the persisted `task_kind` for a write-path (voice-speaking-mvp,
 * 2026-05-29).
 *
 * `'speaking'` (устный монолог) is an explicit tutor choice — it is NOT
 * derivable from `check_format`. When the client sends `task_kind='speaking'`
 * verbatim, persist it as-is; otherwise fall back to
 * `deriveTaskKind(check_format)`.
 *
 * Keeps the §0 dual-derive invariant: speaking must be set explicitly at EVERY
 * write-path and never overwritten by check_format-based derivation. Only
 * `'speaking'` is special-cased — numeric/extended stay derived (the tutor UI
 * controls them via `check_format`).
 */
export function resolveWriteTaskKind(
  clientTaskKind: unknown,
  checkFormat: string | null | undefined,
): "numeric" | "extended" | "speaking" {
  if (clientTaskKind === "speaking") return "speaking";
  return deriveTaskKind(checkFormat);
}

// max_score теперь допускает шаг 0.5 (см. миграцию
// 20260523120000_homework_tutor_tasks_max_score_halfstep.sql + .claude/rules/40-homework-system.md
// "Score step invariant 0.5 для max_score"). Tolerance 1e-9 защищает от
// floating-point junk (12.5 * 2 = 25.000000...01 в некоторых браузерах).
export function isPositiveHalfStepNumber(v: unknown): v is number {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return false;
  const scaled = v * 2;
  return Math.abs(scaled - Math.round(scaled)) < 1e-9;
}
