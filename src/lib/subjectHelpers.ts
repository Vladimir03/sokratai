/**
 * Subject UX helpers.
 *
 * ⚠️ ТОНКИЕ ОБЁРТКИ над `@/lib/subjects/registry` — единственным справочником
 * предметов (2026-07-23). Раньше здесь жили СВОИ копии множества письменных
 * гуманитарных предметов и словаря дательного падежа; расхождение таких копий
 * с `SUBJECTS`/CHECK'ами БД и было классом бага «предмет добавили, а половина
 * сервисов о нём не знает». Новый предмет заводится в реестре — эти функции
 * подхватывают его сами.
 *
 * Имена и сигнатуры сохранены: у обеих функций много вызывающих.
 */

import {
  getSubjectDativeName,
  subjectIsHumanitiesWriting,
} from '@/lib/subjects/registry';

/**
 * Returns true for subjects where the canonical extended task is a piece of
 * **writing** — letter, essay, composition — rather than a numeric problem
 * with computed answer.
 *
 * UX implications when true (only in combination with `task_kind === 'extended'`):
 * - Numeric input row in SubmitSheet is hidden (no «числовой ответ» для письма).
 * - Big-CTA subtitle says «Текст или фото готового решения» instead of
 *   «Ответ + фото решения от руки».
 * - amber-banner in ProblemContext says «Это письменная задача — напиши
 *   развёрнутый ответ с ходом рассуждений» instead of physics-flavoured
 *   «покажи ход рассуждений».
 *
 * Defensive: accepts unknown/empty subjects (returns false) — non-humanities
 * subjects keep existing physics/maths-oriented UX. Легаси-id (`rus`)
 * резолвятся реестром через alias; нормализация case — там же (Deno-зеркало
 * `_shared/subject-rubrics/index.ts::isHumanitiesSubject` ведёт себя так же).
 */
export function isHumanitiesWritingSubject(subject: string | null | undefined): boolean {
  return subjectIsHumanitiesWriting(subject);
}

/**
 * Дательный падеж предмета («по физике», «по обществознанию»). Общий для
 * витрины Каталога (empty-state) и заголовка пробника («Пробник ЕГЭ по …»).
 * Неизвестный/пустой предмет → «этому предмету».
 */
export function getSubjectDative(subject: string | null | undefined): string {
  return getSubjectDativeName(subject);
}
