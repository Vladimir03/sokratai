/**
 * Verbatim span leak detector — для humanities subjects (Phase 7 round 2,
 * 2026-05-20, code review by ChatGPT-5.5).
 *
 * Context:
 *   Phase 7 (commit 985a36c) полностью SKIPPED token-based leak detector
 *   для humanities subjects (russian / literature / english / french / spanish)
 *   — `extractSignificantTokensForLeak` имел high false-positive rate на
 *   естественном языке (любое латинское слово ≥5 chars считалось
 *   significant, а на French это **каждое** слово).
 *
 *   Но это открыло реальную утечку: репетитор может написать в
 *   `tutor_tasks.solution_text` идеальный пример письма (DELF B1 model
 *   letter), а AI скопировать его дословно в feedback студенту. System
 *   prompt инструкция «не цитируй дословно» — НЕ access boundary (jailbreak
 *   обходится — см. plan wild-swinging-nova.md P0-1 comment в chat/index.ts).
 *
 * Этот detector — **span-level**, не token-level:
 *   - Token-overlap ловит «French слова повторяются» → false positive.
 *   - Verbatim span ловит «8+ слов подряд скопированы» → catches copy-paste
 *     attack, allows normal feedback с общей лексикой.
 *
 * Algorithm (sliding window по словам, не по символам):
 *   1. Normalize: lowercase + strip punctuation + collapse whitespace.
 *   2. Split на word tokens.
 *   3. Subtract task text tokens (как `containsSolutionLeak`) чтобы не
 *      ловить words которые AI правомерно повторяет из условия.
 *   4. For each (start, end=start+N) window of AI output where N = MIN_SPAN_WORDS:
 *      check если этот span встречается в solution. Если да → leak.
 *   5. Threshold: N=8 (баланс — типичное French предложение 10-15 слов,
 *      copy-paste половины — 8+ слов; "tu as bien écrit" — 4 слова, не leak).
 *
 * Performance: O(n*m) для n=AI output words, m=solution words. На typical
 * sizes (200-500 слов в каждом) = 100k-250k operations = sub-ms.
 *
 * Use sites:
 *   - `homework-api/guided_ai.ts::evaluateStudentAnswer` (check path retry)
 *   - `homework-api/guided_ai.ts::generateHint` (hint path retry)
 *   - `chat/index.ts::processAIRequest` (buffered SSE path)
 *
 * Non-humanities subjects (math/physics/etc.) продолжают использовать
 * existing token-based `outputContainsSolutionLeak` / `containsSolutionLeak`
 * — там детектор работает корректно (числа + формулы — unique tokens).
 */

const MIN_VERBATIM_SPAN_WORDS = 8;

/**
 * Normalize text для span comparison:
 *   - lowercase
 *   - replace punctuation/special chars на whitespace
 *   - collapse multiple whitespace → single space
 *   - trim
 *
 * Returns array of word tokens. Empty array if text is null/empty.
 */
function normalizeToWords(text: string | null | undefined): string[] {
  if (!text) return [];
  const cleaned = text
    .toLowerCase()
    // Replace common punctuation, math symbols, brackets с whitespace.
    // Keep Unicode letters (Cyrillic, Latin extended) — split только по
    // non-letter/digit chars. Apostrophes (l', d') split: «l'accord» →
    // ["l", "accord"] (acceptable; both короткие, не попадут в span).
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return [];
  return cleaned.split(" ").filter((w) => w.length > 0);
}

/**
 * Returns true if `output` contains a contiguous verbatim span of
 * `minSpanWords` or more words from `solutionText`, excluding spans that
 * are entirely contained in `taskText` (legitimate quotes from the prompt).
 *
 * Detector is **case-insensitive** and **punctuation-agnostic** (normalizes
 * both inputs the same way).
 *
 * Returns false if:
 *   - solutionText < minSpanWords words (cannot have meaningful copy-paste).
 *   - output < minSpanWords words.
 *   - No matching span found.
 */
export function containsVerbatimSpan(
  output: string | null | undefined,
  solutionText: string | null | undefined,
  taskText: string | null | undefined = null,
  minSpanWords = MIN_VERBATIM_SPAN_WORDS,
): boolean {
  const outputWords = normalizeToWords(output);
  const solutionWords = normalizeToWords(solutionText);
  const taskWords = normalizeToWords(taskText);

  if (outputWords.length < minSpanWords) return false;
  if (solutionWords.length < minSpanWords) return false;

  // Build set of "forbidden" spans (joined string keys) from solution
  // that are NOT entirely present in task text. We compare spans
  // verbatim — join with space → exact string match.
  const taskSpansToExclude = new Set<string>();
  if (taskWords.length >= minSpanWords) {
    for (let i = 0; i <= taskWords.length - minSpanWords; i++) {
      taskSpansToExclude.add(taskWords.slice(i, i + minSpanWords).join(" "));
    }
  }

  const solutionSpans = new Set<string>();
  for (let i = 0; i <= solutionWords.length - minSpanWords; i++) {
    const span = solutionWords.slice(i, i + minSpanWords).join(" ");
    if (!taskSpansToExclude.has(span)) {
      solutionSpans.add(span);
    }
  }

  if (solutionSpans.size === 0) return false;

  // Sliding window по AI output: check каждое minSpanWords-окно против set.
  for (let i = 0; i <= outputWords.length - minSpanWords; i++) {
    const window = outputWords.slice(i, i + minSpanWords).join(" ");
    if (solutionSpans.has(window)) {
      return true;
    }
  }

  return false;
}

/** Export для unit tests / debugging. */
export const _internals = {
  MIN_VERBATIM_SPAN_WORDS,
  normalizeToWords,
};
