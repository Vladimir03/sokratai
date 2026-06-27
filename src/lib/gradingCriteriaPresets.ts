import type { GradingCriterion } from '@/lib/tutorHomeworkApi';

/**
 * Готовые пресеты критериев оценки для конструктора ДЗ (criteria-grading, 2026-06).
 *
 * Кнопка «Загрузить критерии …» в `HWTaskCard` заполняет задачу одним из этих
 * шаблонов (название + макс. балл + опц. описание/зависимость). Frontend-зеркало
 * backend-пресетов (`supabase/functions/_shared/subject-rubrics/*-ege.ts`).
 *
 * ⚠ Точные max-баллы и band-описания валидирует репетитор-предметник (как Егор —
 * физику, Эмилия — DELF). Структуру (Σ, cascade) — из официальных критериев ФИПИ.
 */

const K1_LABEL = 'К1: Отражение позиции автора (рассказчика)';

/**
 * ЕГЭ русский язык — сочинение задание 27 (реформа 2024+). Σ = 22.
 * К1–К6 — содержание (AI оценивает уверенно); К7–К10 — грамотность (AI даёт
 * предварительный балл, репетитор перепроверяет). Cascade: К1=0 ⇒ К2,К3=0.
 */
export const RUSSIAN_EGE_27_PRESET: GradingCriterion[] = [
  { label: K1_LABEL, max: 1 },
  { label: 'К2: Комментарий к позиции автора', max: 3, depends_on_zero: [K1_LABEL] },
  { label: 'К3: Собственное отношение экзаменуемого', max: 2, depends_on_zero: [K1_LABEL] },
  { label: 'К4: Фактическая точность речи', max: 1 },
  { label: 'К5: Логичность речи', max: 2 },
  { label: 'К6: Соблюдение этических норм', max: 1 },
  { label: 'К7: Соблюдение орфографических норм', max: 3 },
  { label: 'К8: Соблюдение пунктуационных норм', max: 3 },
  { label: 'К9: Соблюдение грамматических норм', max: 3 },
  { label: 'К10: Соблюдение речевых норм', max: 3 },
];

export interface GradingCriteriaPreset {
  id: string;
  label: string;
  /** Авто-устанавливаемый max_score задачи (= Σ max критериев). */
  totalMax: number;
  criteria: GradingCriterion[];
}

/**
 * Реестр пресетов (forward-extensible). v1 — один пресет (ЕГЭ-русский).
 * Новый предмет/экзамен → добавь сюда + frontend-константу + backend `*-ege.ts`.
 */
export const GRADING_CRITERIA_PRESETS: GradingCriteriaPreset[] = [
  {
    id: 'russian-ege-27',
    label: 'ЕГЭ русский — сочинение (К1–К10)',
    totalMax: 22,
    criteria: RUSSIAN_EGE_27_PRESET,
  },
];

/** Σ max по всем критериям (человеко-читаемый полный итог, напр. ЕГЭ Σ=22). */
export function sumCriteriaMax(criteria: GradingCriterion[] | null | undefined): number {
  if (!Array.isArray(criteria)) return 0;
  return criteria.reduce((sum, c) => sum + (Number.isFinite(c.max) ? c.max : 0), 0);
}

/**
 * Σ max ТОЛЬКО по AI-оцениваемым критериям (исключает `tutor_only`). Зеркало
 * backend `sumAiGradableMax` (guided_ai.ts). Движок грейдинга требует
 * `max_score == aiGradableMax` (иначе `mapAiScoreToTemplateScale` делает
 * пропорциональный ремап и искажает покритериальный балл), поэтому авто-`max_score`
 * редактора и сверка Σ-бейджа считаются по ЭТОЙ сумме, а не по `sumCriteriaMax`.
 * Для русского пресета (все К1–К10 = `ai`) обе суммы равны 22 → поведение то же.
 */
export function sumAiGradableCriteriaMax(criteria: GradingCriterion[] | null | undefined): number {
  if (!Array.isArray(criteria)) return 0;
  return criteria
    .filter((c) => c.kind !== 'tutor_only')
    .reduce((sum, c) => sum + (Number.isFinite(c.max) ? c.max : 0), 0);
}
