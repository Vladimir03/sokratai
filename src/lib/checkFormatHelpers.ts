/**
 * Shared helpers for `check_format` / `task_kind` resolution.
 *
 * Mirrors the backend `deriveTaskKind` in
 * `supabase/functions/homework-api/index.ts` and the legacy
 * `mapAnswerFormatToCheckFormat` / `inferCheckFormat` in
 * `src/components/tutor/homework-create/HWTasksSection.tsx`.
 *
 * Used by:
 *   - HWDrawer client-side insert path (KB → ДЗ shortcut bypassing the
 *     edge function), which needs to write both `check_format` AND
 *     `task_kind` consistently. Phase 3.1 hotfix 2026-05-13.
 *   - hwDraftStore.addTask snapshot resolution.
 */

export type CheckFormat = 'short_answer' | 'detailed_solution';

/** Map legacy KB `answer_format` value → canonical `check_format`. */
export function mapAnswerFormatToCheckFormat(
  af: string | null | undefined,
): CheckFormat | null {
  if (!af) return null;
  if (af === 'short_answer' || af === 'detailed_solution') return af;
  if (af === 'detailed') return 'detailed_solution';
  // number, text, choice, matching → short answer
  return 'short_answer';
}

/**
 * Infer `check_format` from KIM number (ЕГЭ физика):
 * KIM 21-26 = Часть 2 (развёрнутое решение); else краткий ответ.
 */
export function inferCheckFormatFromKim(
  kimNumber: number | null | undefined,
): CheckFormat {
  if (kimNumber && kimNumber >= 21 && kimNumber <= 26) {
    return 'detailed_solution';
  }
  return 'short_answer';
}

/**
 * Resolve `check_format` from a KB task in priority:
 *   1. Explicit `check_format` field if valid
 *   2. Legacy `answer_format` mapping
 *   3. KIM-number heuristic — ТОЛЬКО физика (номера Части 2 предметно-специфичны;
 *      физическая эвристика 21-26 неверна для обществознания — review P2 2026-07-06)
 *   4. Safe default `'short_answer'`
 * `subject` null/undefined → физика (обратная совместимость: homework path B без предмета).
 */
export function resolveCheckFormatFromKb(input: {
  check_format?: string | null;
  answer_format?: string | null;
  kim_number?: number | null;
  subject?: string | null;
}): CheckFormat {
  if (input.check_format === 'short_answer' || input.check_format === 'detailed_solution') {
    return input.check_format;
  }
  const fromAnswerFormat = mapAnswerFormatToCheckFormat(input.answer_format);
  if (fromAnswerFormat) return fromAnswerFormat;
  // № КИМ-эвристика физики применима только к физике; иначе безопасный дефолт.
  if (input.subject != null && input.subject !== 'physics') return 'short_answer';
  return inferCheckFormatFromKim(input.kim_number);
}

/**
 * Map `check_format` → `task_kind` (Phase 1 student-screen enum).
 * Mirrors the backend `deriveTaskKind` in `homework-api/index.ts`.
 *
 * Mapping:
 *   - `short_answer`      → `numeric`
 *   - `detailed_solution` → `extended`
 *   - any other / null    → `extended` (safe DB default)
 */
export function deriveTaskKindFromCheckFormat(
  checkFormat: string | null | undefined,
): 'numeric' | 'extended' {
  if (checkFormat === 'short_answer') return 'numeric';
  return 'extended';
}
