// Структурные тестовые задачи (options_json) — канонический модуль.
// Deno-зеркало: supabase/functions/_shared/task-options.ts (конвенция «mirror
// locally», как answerAlternatives/checkFormatHelpers). Правишь логику — правь
// ОБА файла + векторы scripts/test-task-options.mjs (smoke-check гоняет оба
// зеркала и падает на дрейфе).
//
// ⚠️ Anti-leak: options_json — student-safe колонка (GRANT). Правильный ответ
// НИКОГДА не кладётся внутрь options_json — он живёт в correct_answer
// (tutor-only) в формате чекеров пробников: single "3", multi "1267",
// matching "35142" (по порядку левого столбца).

export interface TaskOptionItem {
  key: string;
  text: string;
}

export type TaskOptions =
  | { kind: 'single_choice'; options: TaskOptionItem[] }
  | { kind: 'multi_choice'; options: TaskOptionItem[] }
  | { kind: 'matching'; left: TaskOptionItem[]; right: TaskOptionItem[] };

export const MAX_OPTION_TEXT_CHARS = 500;
// Посимвольные чекеры пробников (gradeMultiChoice/gradeOrdered) работают по
// одиночным символам — >9 вариантов ломает сериализацию "1267".
export const MAX_CHOICE_OPTIONS = 9;
export const MAX_MATCHING_LEFT = 9;
export const MAX_MATCHING_RIGHT = 9;

// Ключ, который чекер сравнивает ПОСИМВОЛЬНО (варианты choice, правый столбец
// matching), обязан быть ровно одним буквенно-цифровым символом: «10» или «A)»
// не совпадут с correct_answer никогда, и верный выбор ученика молча оценивался
// бы в ноль (ревью 5.6 P1 #5). Левый столбец matching — только метка («А»,
// «Б»), в сериализацию ответа не входит, поэтому до 3 символов.
const GRADED_KEY_RE = /^[\p{L}\p{N}]$/u;
const LABEL_KEY_RE = /^[\p{L}\p{N}]{1,3}$/u;

function normalizeItem(raw: unknown, keyRe: RegExp): TaskOptionItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const key = String((raw as { key?: unknown }).key ?? '').trim();
  const text = String((raw as { text?: unknown }).text ?? '').trim();
  if (!keyRe.test(key)) return null;
  if (!text) return null;
  return { key, text: text.slice(0, MAX_OPTION_TEXT_CHARS) };
}

// Fail-closed: битый вариант раньше ПРОПУСКАЛСЯ, а список сверх капа резался —
// ученик увидел бы 3 варианта из 4 и не узнал об этом. Любая аномалия → null,
// задача откатывается к обычному текстовому вводу.
function normalizeItemList(
  raw: unknown,
  cap: number,
  keyRe: RegExp,
): TaskOptionItem[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > cap) return null;
  const out: TaskOptionItem[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const item = normalizeItem(entry, keyRe);
    if (!item || seen.has(item.key)) return null;
    seen.add(item.key);
    out.push(item);
  }
  return out;
}

/**
 * Whitelist-проекция options_json: возвращает НОВЫЙ объект только с
 * разрешёнными полями (kind/options/left/right → key/text). Всё лишнее —
 * включая случайно положенный импорт-скриптом `correct` — не доезжает до БД.
 * Невалидная структура → null (клиент откатывается к текстовому вводу).
 */
export function normalizeOptionsJson(value: unknown): TaskOptions | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const kind = (value as { kind?: unknown }).kind;
  if (kind === 'single_choice' || kind === 'multi_choice') {
    const options = normalizeItemList(
      (value as { options?: unknown }).options,
      MAX_CHOICE_OPTIONS,
      GRADED_KEY_RE,
    );
    if (!options || options.length < 2) return null;
    return { kind, options };
  }
  if (kind === 'matching') {
    const left = normalizeItemList(
      (value as { left?: unknown }).left,
      MAX_MATCHING_LEFT,
      LABEL_KEY_RE,
    );
    const right = normalizeItemList(
      (value as { right?: unknown }).right,
      MAX_MATCHING_RIGHT,
      GRADED_KEY_RE,
    );
    if (!left || !right || right.length < 2) return null;
    return { kind: 'matching', left, right };
  }
  return null;
}

/**
 * Ответ ученика из UI-выбора → строка для существующего канала ответа.
 * single: "3"; multi: "1, 2, 6, 7" (сортировка по порядку вариантов);
 * matching: "35142" (по порядку левого столбца). Читаемо в пузыре ученика и
 * парсится детерминированной проверкой.
 */
export function serializeChoiceSelection(
  options: TaskOptions,
  selection: string[],
): string {
  if (options.kind === 'matching') {
    return selection.join('');
  }
  const order = new Map(options.options.map((o, i) => [o.key, i] as const));
  const sorted = [...selection].sort(
    (a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99),
  );
  return options.kind === 'single_choice' ? (sorted[0] ?? '') : sorted.join(', ');
}

/**
 * Строка ответа (ученика или correct_answer) → компактная форма для
 * посимвольных чекеров: убирает пробелы/запятые/точки с запятой/дефисы.
 * «1, 2, 6, 7» → «1267»; «А-3 Б-5» → «А3Б5» (для matching ученик шлёт только
 * правые ключи, но терпим мусор).
 */
export function compactChoiceAnswer(raw: string): string {
  return raw.replace(/[\s,;.\-–—()]+/g, '');
}

/** Дословная цитата формулировки верного варианта — та же утечка, что и его номер. */
const MIN_QUOTED_OPTION_CHARS = 12;

/**
 * Ключи и тексты ВЕРНЫХ вариантов по correct_answer.
 * single/multi: символы ответа = ключи вариантов.
 * matching: символы = ключи ПРАВОГО столбца (в порядке левого), поэтому
 * раскрытие любого из них выдаёт часть соответствия.
 */
function correctChoiceParts(
  options: TaskOptions,
  correctAnswer: string,
): { keys: string[]; texts: string[] } {
  const chars = Array.from(new Set(compactChoiceAnswer(correctAnswer).split('')))
    .filter((c) => c.trim().length > 0);
  const pool = options.kind === 'matching' ? options.right : options.options;
  const keys: string[] = [];
  const texts: string[] = [];
  for (const ch of chars) {
    keys.push(ch);
    const item = pool.find((o) => o.key.toLowerCase() === ch.toLowerCase());
    if (item) texts.push(item.text);
  }
  return { keys, texts };
}

/**
 * Детерминированный anti-leak для AI-объяснения структурного теста: текст
 * называет ключ верного варианта отдельным токеном ИЛИ дословно цитирует его
 * формулировку. Промпт-запрет «не называй варианты» — инструкция модели, а не
 * гарантия; sanitizeFeedback тоже не спасает (сравнивает эталон целиком и
 * игнорирует ответы короче 2 символов, т.е. любой single_choice).
 *
 * Границы слова — через группы `(^|[^\p{L}\p{N}])`, НЕ lookbehind: этот модуль
 * исполняется в браузере, где lookbehind запрещён (Safari < 16.4, rule 80).
 * Цифра внутри числа («1861») не считается.
 */
export function feedbackLeaksCorrectChoice(
  text: string | null | undefined,
  options: TaskOptions,
  correctAnswer: string,
): boolean {
  const value = (text ?? '').trim();
  if (!value) return false;
  const { keys, texts } = correctChoiceParts(options, correctAnswer);
  const boundary = '[^\\p{L}\\p{N}]';
  for (const key of keys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(?:^|${boundary})${escaped}(?:${boundary}|$)`, 'iu').test(value)) return true;
  }
  const lower = value.toLowerCase();
  return texts.some((t) => {
    const optionText = t.trim().toLowerCase();
    return optionText.length >= MIN_QUOTED_OPTION_CHARS && lower.includes(optionText);
  });
}

/** Текстовый блок вариантов для AI-промптов (check/hint/chat/bootstrap). */
export function renderOptionsForPrompt(options: TaskOptions): string {
  if (options.kind === 'matching') {
    const left = options.left.map((o) => `${o.key}) ${o.text}`).join('\n');
    const right = options.right.map((o) => `${o.key}) ${o.text}`).join('\n');
    return `ЗАДАНИЕ НА СООТВЕТСТВИЕ.\nЛевый столбец:\n${left}\nПравый столбец (вариантов больше, чем нужно):\n${right}\nОтвет — последовательность номеров правого столбца по порядку левого.`;
  }
  const list = options.options.map((o) => `${o.key}) ${o.text}`).join('\n');
  const mode =
    options.kind === 'single_choice'
      ? 'Выбери ОДИН правильный вариант.'
      : 'Выбери ВСЕ правильные варианты.';
  return `Варианты ответа (${mode}):\n${list}`;
}

/** Короткий лейбл для бейджа в конструкторе. */
export function describeTaskOptions(options: TaskOptions): string {
  if (options.kind === 'matching') {
    return `Соответствие ${options.left.length}×${options.right.length}`;
  }
  const n = options.options.length;
  return options.kind === 'single_choice'
    ? `Тест: ${n} вариантов, один ответ`
    : `Тест: ${n} вариантов, несколько ответов`;
}
