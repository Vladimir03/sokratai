/**
 * Наследование классификации задачи между добавлениями (запрос Егора:
 * «серия задач на одну тему/КИМ» — пусть новая задача по умолчанию берёт
 * тип/КИМ/тему/подтему/источник/формат от последней добавленной).
 *
 * Храним в localStorage (per-browser). Контент (условие/ответ/решение/фото)
 * НЕ наследуется. Первичный балл НЕ храним — он выводится из № КИМ.
 */
const KEY = 'sokrat-kb-last-classification';

export interface KbLastClassification {
  subject: string;
  taskType: string;
  kimNumber: string;
  difficulty: string;
  topicId: string;
  subtopicId: string;
  sourceLabel: string;
  /** @deprecated #60 (2026-07-11): «Формат ответа» удалён из UI — поле больше не пишется, старые значения игнорируются. */
  answerFormat?: string;
  folderId: string;
}

export function loadLastClassification(): Partial<KbLastClassification> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Partial<KbLastClassification>) : {};
  } catch {
    return {};
  }
}

export function saveLastClassification(value: KbLastClassification): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    /* localStorage unavailable (private mode) — silently skip */
  }
}

/**
 * Merge-сохранение ТОЛЬКО предмета (review P2 2026-07-07): AI-загрузчик после
 * успешного распознавания персистит выбранный предмет (иначе химик каждый заход
 * заново переключал «Химия», а холодный direct-load уходил physics-промптом).
 * Остальная классификация серии не трогается.
 */
export function saveLastSubject(subject: string): void {
  try {
    const current = loadLastClassification();
    localStorage.setItem(KEY, JSON.stringify({ ...current, subject }));
  } catch {
    /* localStorage unavailable — silently skip */
  }
}
