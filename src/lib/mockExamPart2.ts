/**
 * Номера заданий Части 2 пробника — ЕДИНЫЙ резолвер (репорт Ульяны 2026-08-04).
 *
 * Проблема, которую он закрывает: разбивка на части была захардкожена физикой
 * ЕГЭ (`[21,22,23,24,25,26]`) в пяти местах репетиторских экранов. У химии ОГЭ
 * Часть 2 = 20–23, поэтому письменное задание 20 ПРОПАДАЛО из ленты привязки
 * фото, его фото нельзя было прикрепить, и AI никогда его не проверял
 * («вижу Ким 19, потом 21»).
 *
 * ИНВАРИАНТЫ:
 * - Истина разбивки — `mock_exam_variant_tasks.part` (данные варианта).
 *   `ExamProfile.part2KimRange` — ТОЛЬКО фолбэк отображения, когда данных нет.
 * - Модель — МНОЖЕСТВО номеров, а не диапазон: у DELF части чередуются
 *   (см. `isInterleaved` в `StudentMockExam.tsx`), поэтому `[min..max]`
 *   восстанавливать нельзя.
 * - Порядок источников: задачи варианта ∪ строки решений → профиль → пусто.
 *   Union, а не «только бэкенд»: вариант, отредактированный ПОСЛЕ проверки,
 *   может оставить строку решения, чей номер уже не `part=2`; она обязана
 *   остаться видимой и привязываемой, иначе балл потеряется молча.
 * - Пусто → пусто. Никогда не подставлять чужой предмет: «лучше молчать, чем
 *   врать» (тот же принцип, что в `part2NumbersLabel` ученической поверхности).
 * - Без React — модуль бандлится node-тестами через esbuild.
 */

import { getExamProfile, normalizeExamType, type ExamProfileExam } from '@/lib/examProfiles';

/** Разумные границы № КИМ: отсекают мусор (0, отрицательные, float, 1e9). */
const MIN_KIM = 1;
const MAX_KIM = 99;

function normalizeKims(input: Iterable<number> | null | undefined): number[] {
  if (!input) return [];
  const out = new Set<number>();
  for (const raw of input) {
    if (!Number.isInteger(raw)) continue;
    if (raw < MIN_KIM || raw > MAX_KIM) continue;
    out.add(raw);
  }
  return [...out].sort((a, b) => a - b);
}

/** `[20,23]` → `[20,21,22,23]`; null/битый диапазон → `[]`. */
export function expandKimRange(
  range: readonly [number, number] | null | undefined,
): number[] {
  if (!range) return [];
  const [lo, hi] = range;
  if (!Number.isInteger(lo) || !Number.isInteger(hi) || hi < lo) return [];
  const out: number[] = [];
  for (let n = lo; n <= hi; n += 1) out.push(n);
  return normalizeKims(out);
}

function profilePart2(
  subject: string | null | undefined,
  examType: string | null | undefined,
): number[] {
  // `?? 'physics'` — тот же легаси-дефолт, что на ученической и публичной
  // поверхностях: строка варианта без предмета исторически физическая.
  const exam: ExamProfileExam | null = normalizeExamType(examType);
  return expandKimRange(getExamProfile(subject ?? 'physics', exam)?.part2KimRange);
}

/**
 * Номера заданий Части 2 для репетиторских поверхностей проверки.
 *
 * @example
 *   // физика ЕГЭ — байт-в-байт прежнее поведение
 *   resolvePart2KimNumbers({ variantPart2Kims: [21,22,23,24,25,26] }) // → [21..26]
 *   // химия ОГЭ — задание 20 больше не теряется
 *   resolvePart2KimNumbers({ variantPart2Kims: [20,21,22,23] })       // → [20,21,22,23]
 *   // старый edge без нового поля → добираем из строк решений
 *   resolvePart2KimNumbers({ solutionKims: [20,21,22,23] })           // → [20,21,22,23]
 *   // нет ничего → профиль предмета
 *   resolvePart2KimNumbers({ subject: 'chemistry', examType: 'oge' }) // → [20..23]
 */
export function resolvePart2KimNumbers(input: {
  /** Номера задач варианта с `part === 2` (авторитет). */
  variantPart2Kims?: Iterable<number> | null;
  /** Номера уже существующих строк решений Части 2. */
  solutionKims?: Iterable<number> | null;
  subject?: string | null;
  /** Сырой легаси `exam_type` (`ege_physics` / `oge` / …). */
  examType?: string | null;
}): number[] {
  const fromData = normalizeKims([
    ...normalizeKims(input.variantPart2Kims),
    ...normalizeKims(input.solutionKims),
  ]);
  if (fromData.length > 0) return fromData;
  return profilePart2(input.subject, input.examType);
}

export interface VariantKimLayout {
  part1: number[];
  part2: number[];
  /** № КИМ → max_score задачи варианта. Пусто, когда задач нет. */
  maxByKim: Record<number, number>;
}

/**
 * Полная раскладка варианта для теплокарты. Обе части сразу — иначе у химии
 * КИМ 20 отрисовался бы ДВАЖДЫ (в физическом `1..20` и в химическом `20..23`).
 */
export function resolveVariantKimLayout(input: {
  variantTasks?: Array<{ kim_number: number; part: number; max_score?: number | null }> | null;
  subject?: string | null;
  examType?: string | null;
}): VariantKimLayout {
  const tasks = input.variantTasks ?? [];
  if (tasks.length > 0) {
    const maxByKim: Record<number, number> = {};
    for (const t of tasks) {
      if (!Number.isInteger(t.kim_number)) continue;
      if (typeof t.max_score === 'number' && Number.isFinite(t.max_score)) {
        maxByKim[t.kim_number] = t.max_score;
      }
    }
    return {
      part1: normalizeKims(tasks.filter((t) => t.part === 1).map((t) => t.kim_number)),
      part2: normalizeKims(tasks.filter((t) => t.part === 2).map((t) => t.kim_number)),
      maxByKim,
    };
  }

  // Данных нет (deploy-skew: старый edge не отдаёт `variant_tasks`).
  const part2 = profilePart2(input.subject, input.examType);
  const profile = getExamProfile(input.subject ?? 'physics', normalizeExamType(input.examType));
  const scores = profile?.kimPrimaryScores ?? null;
  // Часть 1 — номера карты ФИПИ до начала Части 2. Без карты честно пусто.
  const part1 = scores
    ? normalizeKims(
      Object.keys(scores)
        .map((k) => Number(k))
        .filter((n) => !part2.includes(n)),
    )
    : [];
  return { part1, part2, maxByKim: scores ? { ...scores } : {} };
}

/**
 * Человеческая подпись набора номеров: `№ 20–23` (непрерывный),
 * `№ 3, 7, 11` (разреженный), `№ 20` (один), `null` (пусто → не подписывать).
 */
export function formatKimNumbersLabel(
  kims: number[],
  opts?: { prefix?: string },
): string | null {
  const list = normalizeKims(kims);
  if (list.length === 0) return null;
  const prefix = opts?.prefix ?? '№ ';
  if (list.length === 1) return `${prefix}${list[0]}`;
  const isContiguous = list[list.length - 1] - list[0] === list.length - 1;
  if (isContiguous) return `${prefix}${list[0]}–${list[list.length - 1]}`;
  if (list.length > 6) return `${prefix}${list.slice(0, 5).join(', ')}…`;
  return `${prefix}${list.join(', ')}`;
}
