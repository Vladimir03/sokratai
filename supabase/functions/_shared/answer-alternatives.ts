/**
 * Несколько допустимых верных ответов + числовой диапазон (#61, Егор, 2026-07-11).
 *
 * Канонический формат хранения — существующее ТЕКСТОВОЕ поле ответа
 * (`kb_tasks.answer` / `homework_tutor_tasks.correct_answer`), ноль миграций:
 *   - альтернативы разделяются словом « или »:  `1248 или 1250`
 *   - числовой диапазон «от–до» (вкл.):          `2,1–2,3`  (en-dash / em-dash / `..`
 *     без пробелов, либо дефис СТРОГО с пробелами: `2,1 - 2,3`)
 *
 * ⚠️ Разделитель — « или », НЕ «;» (ревью ChatGPT-5.6, P1). Составной ответ
 * («нужны ОБА»: `x=1; y=2`) пишется через «;»/«и»/«,» → НЕ коллидирует; « или »
 * означает «любой из» = ровно альтернативы (легаси `1248 или 1250` уже это
 * значило). Значит любую legacy-строку без « или » и без range-маркера парсер
 * трактует как ОДИН exact-ответ → поведение byte-identical прежнему.
 *
 * Компактный дефис БЕЗ пробелов («1941-1945», «-5») диапазоном НЕ считается —
 * это литеральный ответ (даты, отриц. числа, коды). UI сериализует en-dash.
 *
 * ЗЕРКАЛО: `src/lib/answerAlternatives.ts` — правки вносить в ОБА файла
 * (Deno не импортирует src/, фронт не тянет functions/ — конвенция репо,
 * как `attachment-refs` / `score-scales`). Дрейф ловит
 * `scripts/test-answer-alternatives.mjs` (smoke-check): оба зеркала гоняются
 * по одному набору векторов.
 *
 * Потребители (Deno): `homework-api/guided_ai.ts` —
 * `tryDeterministicShortAnswerMatch` (детерминированная сверка) +
 * `buildCheckPrompt` (строка «Допустимые варианты…» для AI).
 * Mock-exams и тренажёр НЕ используют (свои чекеры) — намеренно.
 */

export type AnswerAlternative =
  | { type: "exact"; value: string }
  | { type: "range"; min: number; max: number; label: string };

export interface ParsedAnswerSpec {
  /** true — есть ≥2 вариантов И/ИЛИ хотя бы один диапазон. false — обычный одиночный ответ. */
  isMulti: boolean;
  alternatives: AnswerAlternative[];
  raw: string;
}

/** Разделитель альтернатив: слово «или» с пробелами (case-insensitive). */
export const ANSWER_ALT_SPLIT_RE = /\s+или\s+/iu;
/** Соединитель для сериализации (UI пишет именно так). */
export const ANSWER_ALT_JOIN = " или ";

const NUMBER_SRC = "-?\\d+(?:[.,]\\d+)?";
// Диапазон: en-dash/em-dash/«..» (пробелы опциональны) ИЛИ дефис с пробелами
// с обеих сторон. Компактный дефис — НЕ диапазон (см. заголовок файла).
const RANGE_RE = new RegExp(
  `^(${NUMBER_SRC})(?:\\s*(?:–|—|\\.\\.)\\s*|\\s+-\\s+)(${NUMBER_SRC})$`,
  "u",
);

/** «2,5» / «2.5» / «-3» → число; иначе null. */
export function parseAnswerNumber(raw: string): number | null {
  const compact = raw.trim().replace(/\s+/g, "").replace(",", ".");
  if (!/^-?\d+(?:\.\d+)?$/.test(compact)) return null;
  const n = Number(compact);
  return Number.isFinite(n) ? n : null;
}

/**
 * Разобрать поле ответа на допустимые варианты. Пустая/нулевая строка → null.
 * Невалидный «диапазон» (не числа / min ≥ max) деградирует в exact-вариант —
 * поведение одиночного ответа не меняется ни для какой существующей строки
 * без «;» и без явного диапазон-маркера.
 */
export function parseAnswerSpec(raw: string | null | undefined): ParsedAnswerSpec | null {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return null;
  const parts = trimmed
    .split(ANSWER_ALT_SPLIT_RE)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;

  const alternatives: AnswerAlternative[] = parts.map((part) => {
    const m = part.match(RANGE_RE);
    if (m) {
      const min = parseAnswerNumber(m[1]);
      const max = parseAnswerNumber(m[2]);
      if (min != null && max != null && min < max) {
        return { type: "range", min, max, label: part };
      }
    }
    return { type: "exact", value: part };
  });

  const isMulti = alternatives.length > 1 || alternatives.some((a) => a.type === "range");
  return { isMulti, alternatives, raw: trimmed };
}

/** Число → строка с десятичной запятой (русская запись для UI/промпта). */
export function formatAnswerNumber(n: number): string {
  return String(n).replace(".", ",");
}

/** Каноническая сериализация диапазона (en-dash, запятая-десятичная). */
export function formatRangeLabel(min: number, max: number): string {
  return `${formatAnswerNumber(min)}–${formatAnswerNumber(max)}`;
}

/**
 * Человекочитаемая строка для AI-промпта проверки. null — когда спец не multi
 * (обычный одиночный ответ, ничего добавлять не нужно).
 */
export function describeAnswerSpecForPrompt(spec: ParsedAnswerSpec | null): string | null {
  if (!spec || !spec.isMulti) return null;
  const parts = spec.alternatives.map((a) =>
    a.type === "exact"
      ? `«${a.value}»`
      : `любое число от ${formatAnswerNumber(a.min)} до ${formatAnswerNumber(a.max)} включительно`
  );
  return `Допустимые варианты правильного ответа — засчитывай КАК ВЕРНЫЙ любой из них: ${parts.join("; ")}.`;
}
