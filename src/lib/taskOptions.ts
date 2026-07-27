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

function normalizeItem(raw: unknown): TaskOptionItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const key = String((raw as { key?: unknown }).key ?? '').trim();
  const text = String((raw as { text?: unknown }).text ?? '').trim();
  if (!key || key.length > 3) return null;
  if (!text) return null;
  return { key, text: text.slice(0, MAX_OPTION_TEXT_CHARS) };
}

function normalizeItemList(raw: unknown, cap: number): TaskOptionItem[] {
  if (!Array.isArray(raw)) return [];
  const out: TaskOptionItem[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const item = normalizeItem(entry);
    if (!item || seen.has(item.key)) continue;
    seen.add(item.key);
    out.push(item);
    if (out.length >= cap) break;
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
    );
    if (options.length < 2) return null;
    return { kind, options };
  }
  if (kind === 'matching') {
    const left = normalizeItemList((value as { left?: unknown }).left, MAX_MATCHING_LEFT);
    const right = normalizeItemList((value as { right?: unknown }).right, MAX_MATCHING_RIGHT);
    if (left.length < 1 || right.length < 2) return null;
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
