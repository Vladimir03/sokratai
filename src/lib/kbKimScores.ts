import type { ExamType } from '@/types/kb';
import { getExamProfile } from '@/lib/examProfiles';

/**
 * Авто-балл по № КИМ (макс. за задание по ФИПИ) — тонкие обёртки над
 * ExamProfile registry (`src/lib/examProfiles.ts`, техдолг 5.6 2026-07-23):
 * карты живут ТАМ, здесь — прежние публичные API (callsites не тронуты).
 *
 * Используется ТОЛЬКО для авто-подстановки балла в формах (Моя база /
 * AI-загрузчик / конструкторы). Поле редактируемо; НЕ источник истины для
 * грейдинга (балл снапшотится в задачу).
 */

/** @deprecated читай через getExamProfile('physics','ege') — оставлено для совместимости. */
export const PHYSICS_EGE_KIM_SCORES: Record<number, number> =
  getExamProfile('physics', 'ege')!.kimPrimaryScores!;
/** @deprecated читай через getExamProfile('physics','oge'). */
export const PHYSICS_OGE_KIM_SCORES: Record<number, number> =
  getExamProfile('physics', 'oge')!.kimPrimaryScores!;
/** @deprecated читай через getExamProfile('social','ege'). */
export const SOCIAL_EGE_KIM_SCORES: Record<number, number> =
  getExamProfile('social', 'ege')!.kimPrimaryScores!;

/**
 * Известный первичный балл по экзамену и № КИМ, либо `null` — тогда форма
 * НЕ авто-подставляет балл (тутор вводит вручную).
 *
 * ⚠️ ФИЗИЧЕСКИЙ путь (номера КИМ пересекаются между предметами) — для
 * не-физики используй `getKimPrimaryScoreForSubject`. Прямой вызов оставлен
 * для физического homework-пути (HWTaskCard).
 */
export function getKimPrimaryScore(
  exam: ExamType | null | undefined,
  kimNumber: number | null | undefined,
): number | null {
  if (!exam || kimNumber == null || !Number.isFinite(kimNumber)) return null;
  return getExamProfile('physics', exam)?.kimPrimaryScores?.[kimNumber] ?? null;
}

/**
 * Subject-aware авто-балл по КИМ (мультипредметный каталог, 2026-07-06).
 * Гейтинг exam-семантики (ревью 5.6 P1): social — строго ЕГЭ; физика лояльна
 * (`subject` null/undefined = физика — homework без предмета). Предмет без
 * профиля в registry → null (балл вручную; честная пометка Ф6 — по этому же
 * null). Новый предмет с картой — заводи профиль в `examProfiles.ts`.
 */
export function getKimPrimaryScoreForSubject(
  subject: string | null | undefined,
  exam: ExamType | null | undefined,
  kimNumber: number | null | undefined,
): number | null {
  if (subject === 'social') {
    if (exam !== 'ege' || kimNumber == null || !Number.isFinite(kimNumber)) return null;
    return getExamProfile('social', 'ege')?.kimPrimaryScores?.[kimNumber] ?? null;
  }
  if (subject != null && subject !== 'physics') return null;
  return getKimPrimaryScore(exam, kimNumber);
}
