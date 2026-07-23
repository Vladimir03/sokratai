/**
 * ЕДИНЫЙ СПРАВОЧНИК ПРЕДМЕТОВ СОКРАТА — единственный источник правды.
 *
 * ─── Зачем ───────────────────────────────────────────────────────────────────
 * До 2026-07-23 словарь предметов был продублирован ≥9 раз: `SUBJECTS`
 * (types/homework), `KB_SUBJECTS` (types/kb), дательный падеж и
 * humanities-предикат (subjectHelpers), `VALID_SUBJECTS_CREATE/UPDATE` +
 * `LANGUAGE_SUBJECTS_REQUIRING_CEFR` (homework-api), `SUBJECT_LABELS_DENO`
 * ДВАЖДЫ (guided_ai.ts и chat/index.ts), плюс CHECK'и в БД. Расхождение любого
 * из них давало ТИХУЮ поломку: репетитор-химик два месяца не мог сохранить
 * шаблон ДЗ, потому что CHECK в БД отстал от `SUBJECTS` (инцидент Ульяны).
 *
 * ─── Как теперь ──────────────────────────────────────────────────────────────
 * Правится ТОЛЬКО этот файл. Дальше:
 *   • фронт — производные (`SUBJECTS`, `SUBJECT_NAME_MAP`, `getSubjectLabel`,
 *     `getSubjectDative`, `isHumanitiesWritingSubject`, `KB_SUBJECTS`);
 *   • edge/Deno — `supabase/functions/_shared/subjects.generated.ts`,
 *     СГЕНЕРИРОВАННЫЙ из этого файла (`npm run generate:subjects`);
 *     Deno не может импортировать `src/`, поэтому зеркало неизбежно — но оно
 *     машинное, и smoke-гард падает, если оно устарело;
 *   • БД — CHECK'и `homework_tutor_assignments` / `homework_tutor_templates`;
 *     их соответствие реестру проверяет `scripts/check-prod-schema.mjs`.
 *
 * ─── Добавляешь предмет ──────────────────────────────────────────────────────
 *   1. строка в `SUBJECT_REGISTRY` (все поля обязательны — TS не даст забыть);
 *   2. `npm run generate:subjects` (коммитим сгенерированный файл — Lovable
 *      деплоит edge из репо);
 *   3. миграция, расширяющая ОБА CHECK'а (шаблон — `20260723150000`);
 *   4. `npm run smoke-check` — гарды §17/§19 подтвердят, что всё сошлось.
 * Пропуск шага 3 = ДЗ/шаблоны этого предмета молча не сохраняются.
 */

export type SubjectCategory = 'technical' | 'humanities' | 'natural' | 'other';

export interface SubjectDefinition {
  /** Канонический id. Он же значение колонок `subject` в БД. */
  id: string;
  /** Именительный падеж для UI: «Физика». */
  name: string;
  /** Дательный падеж: «по физике». `other` → «этому предмету». */
  dative: string;
  /** Группировка в селекторах. */
  category: SubjectCategory;
  /**
   * Иностранный язык: требует уровень CEFR и политику языка фидбэка
   * (rule 40 → Phase 11). Зеркало `LANGUAGE_SUBJECTS_REQUIRING_CEFR` в edge.
   */
  requiresCefr: boolean;
  /**
   * Канонический развёрнутый ответ — ТЕКСТ (письмо/сочинение), а не численная
   * задача. Управляет UX ученика: скрытый numeric-инпут в SubmitSheet, текст
   * баннера и подписи CTA (rule 40 → `isHumanitiesWritingSubject`).
   */
  isHumanitiesWriting: boolean;
}

/**
 * Порядок ВАЖЕН: в этом порядке предметы рисуются в селекторах и в этом же
 * порядке идут в `VALID_SUBJECTS_CREATE` на бэкенде.
 *
 * Канонический порядок = порядок фронтового `SUBJECTS` (группы: технические →
 * гуманитарные → естественные → другое). Прежний backend-литерал держал
 * `spanish` в конце, после естественных — расхождение чисто косметическое
 * (порядок виден только в тексте ошибки валидации `subject must be one of: …`),
 * и оно устранено намеренно: два разных порядка одного словаря — это ровно тот
 * дрейф, ради которого реестр и заводился. Поведение валидации не изменилось —
 * множество то же.
 */
export const SUBJECT_REGISTRY: readonly SubjectDefinition[] = [
  // Технические (приоритет)
  { id: 'maths', name: 'Математика', dative: 'математике', category: 'technical', requiresCefr: false, isHumanitiesWriting: false },
  { id: 'physics', name: 'Физика', dative: 'физике', category: 'technical', requiresCefr: false, isHumanitiesWriting: false },
  { id: 'informatics', name: 'Информатика', dative: 'информатике', category: 'technical', requiresCefr: false, isHumanitiesWriting: false },

  // Гуманитарные
  { id: 'russian', name: 'Русский язык', dative: 'русскому языку', category: 'humanities', requiresCefr: false, isHumanitiesWriting: true },
  { id: 'literature', name: 'Литература', dative: 'литературе', category: 'humanities', requiresCefr: false, isHumanitiesWriting: true },
  { id: 'history', name: 'История', dative: 'истории', category: 'humanities', requiresCefr: false, isHumanitiesWriting: false },
  { id: 'social', name: 'Обществознание', dative: 'обществознанию', category: 'humanities', requiresCefr: false, isHumanitiesWriting: false },
  { id: 'english', name: 'Английский язык', dative: 'английскому языку', category: 'humanities', requiresCefr: true, isHumanitiesWriting: true },
  { id: 'french', name: 'Французский язык', dative: 'французскому языку', category: 'humanities', requiresCefr: true, isHumanitiesWriting: true },
  { id: 'spanish', name: 'Испанский язык', dative: 'испанскому языку', category: 'humanities', requiresCefr: true, isHumanitiesWriting: true },

  // Естественные
  { id: 'chemistry', name: 'Химия', dative: 'химии', category: 'natural', requiresCefr: false, isHumanitiesWriting: false },
  { id: 'biology', name: 'Биология', dative: 'биологии', category: 'natural', requiresCefr: false, isHumanitiesWriting: false },
  { id: 'geography', name: 'География', dative: 'географии', category: 'natural', requiresCefr: false, isHumanitiesWriting: false },

  // Другое
  { id: 'other', name: 'Другое', dative: 'этому предмету', category: 'other', requiresCefr: false, isHumanitiesWriting: false },
];

/**
 * Легаси-id из строк, созданных до разделения словаря. НЕ предлагаются в UI,
 * но обязаны рендериться по-русски и проходить UPDATE-валидацию бэкенда
 * (`VALID_SUBJECTS_UPDATE`) и CHECK'и БД.
 *
 * `alias` — канонический предмет, чьё поведение (CEFR / письменность)
 * наследуется; `null` = поведение по умолчанию (как `other`).
 */
export interface LegacySubjectDefinition {
  id: string;
  name: string;
  alias: string | null;
}

export const LEGACY_SUBJECTS: readonly LegacySubjectDefinition[] = [
  { id: 'math', name: 'Математика', alias: 'maths' },
  { id: 'rus', name: 'Русский язык', alias: 'russian' },
  { id: 'cs', name: 'Информатика', alias: 'informatics' },
  { id: 'algebra', name: 'Алгебра', alias: 'maths' },
  { id: 'geometry', name: 'Геометрия', alias: 'maths' },
];

// ─── Производные (не редактировать вручную) ──────────────────────────────────

export const SUBJECT_IDS: readonly string[] = SUBJECT_REGISTRY.map((s) => s.id);
export const LEGACY_SUBJECT_IDS: readonly string[] = LEGACY_SUBJECTS.map((s) => s.id);

const BY_ID = new Map<string, SubjectDefinition>(SUBJECT_REGISTRY.map((s) => [s.id, s]));
const LEGACY_BY_ID = new Map<string, LegacySubjectDefinition>(LEGACY_SUBJECTS.map((s) => [s.id, s]));

/** Нормализация ввода: trim + lowercase (в БД предметы хранятся lowercase). */
function normalizeId(subject: string | null | undefined): string | null {
  if (!subject) return null;
  const trimmed = subject.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

/** Определение канонического предмета; легаси-id резолвится через alias. */
export function getSubjectDefinition(subject: string | null | undefined): SubjectDefinition | null {
  const id = normalizeId(subject);
  if (!id) return null;
  const direct = BY_ID.get(id);
  if (direct) return direct;
  const legacyAlias = LEGACY_BY_ID.get(id)?.alias;
  return legacyAlias ? (BY_ID.get(legacyAlias) ?? null) : null;
}

/** Человекочитаемое название; неизвестный id возвращается как есть. */
export function getSubjectName(subject: string | null | undefined): string {
  const id = normalizeId(subject);
  if (!id) return '';
  return BY_ID.get(id)?.name ?? LEGACY_BY_ID.get(id)?.name ?? id;
}

/** Дательный падеж («по …»). Неизвестный/пустой → «этому предмету». */
export function getSubjectDativeName(subject: string | null | undefined): string {
  return getSubjectDefinition(subject)?.dative ?? 'этому предмету';
}

/** Иностранный язык (CEFR + политика языка фидбэка). */
export function subjectRequiresCefr(subject: string | null | undefined): boolean {
  return getSubjectDefinition(subject)?.requiresCefr === true;
}

/** Развёрнутый ответ = текст (письмо/сочинение), а не численная задача. */
export function subjectIsHumanitiesWriting(subject: string | null | undefined): boolean {
  return getSubjectDefinition(subject)?.isHumanitiesWriting === true;
}

/** Канонический id (легаси → современный). Неизвестный → null. */
export function canonicalSubjectId(subject: string | null | undefined): string | null {
  return getSubjectDefinition(subject)?.id ?? null;
}
