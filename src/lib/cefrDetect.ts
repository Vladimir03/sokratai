/**
 * Frontend CEFR-level explicit-marker detector (Phase 11, 2026-05-31).
 *
 * Mirror of `supabase/functions/_shared/subject-rubrics/cefr-detector.ts`, но
 * **только explicit markers** (DELF/DELE/explicit token) и **БЕЗ B1-default** —
 * возвращает `null` если уровень явно не указан в тексте.
 *
 * Зачем: в конструкторе ДЗ авто-подставлять CEFR-селектор, когда репетитор
 * написал «DELF A2» / «B1» в названии или тексте задания. Это удобство —
 * load-bearing фикс остаётся обязательный селектор (многие задачи у языковых
 * репетиторов — картинками без текстового маркера, см. Эмилия).
 *
 * НЕ дублируем эвристики уровня (IELTS band, ЕГЭ→B2 и т.д.) — для конструктора
 * нужен только явный человекочитаемый маркер, который репетитор сам вписал.
 */

export type CefrLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1';

// Safari < 16.4 не поддерживает lookbehind (.claude/rules/80-cross-browser.md) —
// используем capturing groups, без lookbehind/lookahead на Unicode-границах.
const DELF_DELE_RE = /\b(?:DELF|DELE)\s*(A1|A2|B1|B2|C1)\b/i;
const EXPLICIT_CEFR_RE = /\b(A1|A2|B1|B2|C1)\b/;

function normalize(raw: string): CefrLevel | null {
  const u = raw.toUpperCase();
  return u === 'A1' || u === 'A2' || u === 'B1' || u === 'B2' || u === 'C1' ? u : null;
}

/**
 * Detect an EXPLICIT CEFR marker in free text. Returns `null` when none found
 * (НЕТ B1-default — caller сам решает, что делать с null).
 */
export function detectCefrLevelFromText(text: string | null | undefined): CefrLevel | null {
  const s = (text ?? '').trim();
  if (!s) return null;

  // 1) «DELF A2» / «DELE B1» — exam-bound, наивысший приоритет.
  const examMatch = s.match(DELF_DELE_RE);
  if (examMatch) return normalize(examMatch[1]);

  // 2) Голый токен «A2» / «B1» (case-sensitive — чтобы не цеплять случайные «b1»
  //    в URL/коде; репетитор пишет уровень капсом).
  const tokenMatch = s.match(EXPLICIT_CEFR_RE);
  if (tokenMatch) return normalize(tokenMatch[1]);

  return null;
}
