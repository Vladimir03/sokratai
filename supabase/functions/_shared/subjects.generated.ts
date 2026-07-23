// ⚠️ СГЕНЕРИРОВАННЫЙ ФАЙЛ — НЕ РЕДАКТИРОВАТЬ РУКАМИ.
//
// Источник: src/lib/subjects/registry.ts
// Обновить: npm run generate:subjects
//
// Deno-зеркало единого справочника предметов. Deno не импортирует src/, поэтому
// зеркало неизбежно — но оно машинное, а smoke-check §19 падает, если файл
// разошёлся с реестром. Ручная правка будет затёрта следующей генерацией.
//
// Добавляешь предмет → правь РЕЕСТР, потом `npm run generate:subjects`, потом
// миграцию на ОБА CHECK'а (homework_tutor_assignments + homework_tutor_templates),
// иначе ДЗ/шаблоны этого предмета молча не сохранятся (инцидент 2026-07-23).

/** Канонические id в порядке отображения. */
export const SUBJECT_IDS = [
  "maths",
  "physics",
  "informatics",
  "russian",
  "literature",
  "history",
  "social",
  "english",
  "french",
  "spanish",
  "chemistry",
  "biology",
  "geography",
  "other",
] as const;

/** Легаси-id: не предлагаются в UI, но валидны для UPDATE и живут в CHECK'ах БД. */
export const LEGACY_SUBJECT_IDS = [
  "math",
  "rus",
  "cs",
  "algebra",
  "geometry",
] as const;

/** Иностранные языки: требуют уровень CEFR и политику языка фидбэка. */
export const SUBJECTS_REQUIRING_CEFR = new Set<string>([
  "english",
  "french",
  "spanish",
]);

/** Развёрнутый ответ = текст (письмо/сочинение), а не численная задача. */
export const HUMANITIES_WRITING_SUBJECTS = new Set<string>([
  "russian",
  "literature",
  "english",
  "french",
  "spanish",
  "rus",
]);

/** id → русское название (включая легаси). */
export const SUBJECT_LABELS: Record<string, string> = {
  "maths": "Математика",
  "physics": "Физика",
  "informatics": "Информатика",
  "russian": "Русский язык",
  "literature": "Литература",
  "history": "История",
  "social": "Обществознание",
  "english": "Английский язык",
  "french": "Французский язык",
  "spanish": "Испанский язык",
  "chemistry": "Химия",
  "biology": "Биология",
  "geography": "География",
  "other": "Другое",
  "math": "Математика",
  "rus": "Русский язык",
  "cs": "Информатика",
  "algebra": "Алгебра",
  "geometry": "Геометрия",
};

/** id → дательный падеж («по …»). */
export const SUBJECT_DATIVE: Record<string, string> = {
  "maths": "математике",
  "physics": "физике",
  "informatics": "информатике",
  "russian": "русскому языку",
  "literature": "литературе",
  "history": "истории",
  "social": "обществознанию",
  "english": "английскому языку",
  "french": "французскому языку",
  "spanish": "испанскому языку",
  "chemistry": "химии",
  "biology": "биологии",
  "geography": "географии",
  "other": "этому предмету",
};

/** Название предмета; неизвестный id возвращается как есть. */
export function getSubjectLabelDeno(id: string | null | undefined): string {
  if (!id) return "";
  return SUBJECT_LABELS[id.trim().toLowerCase()] ?? id;
}
