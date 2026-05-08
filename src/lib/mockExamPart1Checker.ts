// Mock Exams v1 — deterministic Part 1 checker (TASK-4 of mock-exams-v1).
//
// Pure functions, NO React / DOM / Supabase imports. Same logic runs on
// student device (preview before submit) и в edge function `mock-exam-public`
// и `mock-exam-student-api` на submit. Detective rule: одна реализация —
// одна формула. Rebuilds в trees/Deno должны импортировать ровно этот файл.
//
// Канонический набор check_mode (соответствует CHECK constraint в
// `mock_exam_variant_tasks.check_mode`, миграция 20260508120000):
//   - strict        — точное совпадение строки (после нормализации)
//   - ordered       — последовательность через запятую, точный порядок
//   - unordered     — множество без порядка (multiset, дубликаты учитываются)
//   - multi_choice  — два-три номера верных вариантов из 5, без порядка
//   - task20        — спец-логика для №20 (число + запас 0.05 для целых, ровное для дробей)
//   - pair          — пара значение/единица: "12.5;м" или "12,5 м";
//                     для измерений также compact бланк-формат "2,70,1"
//   - manual        — Часть 2, сюда не попадает (фильтруется выше)
//
// Spec: docs/delivery/features/mock-exams-v1/spec.md
// AC-3: deterministic checker возвращает корректные баллы для всех 5+ типов.

export type MockExamCheckMode =
  | 'strict'
  | 'ordered'
  | 'unordered'
  | 'multi_choice'
  | 'task20'
  | 'pair'
  | 'manual';

export interface CheckPart1Input {
  /** Эталонный ответ из mock_exam_variant_tasks.correct_answer. */
  correctAnswer: string;
  /** Ответ ученика (может быть null/empty — тогда earned_score = 0). */
  studentAnswer: string | null | undefined;
  /** Режим проверки. */
  checkMode: MockExamCheckMode;
  /** Максимальный балл задачи (для бинарной проверки берём 0 / max). */
  maxScore: number;
}

export interface CheckPart1Result {
  /** 0 или maxScore — Часть 1 binary, без частичного зачёта. */
  earnedScore: number;
  /** true ⟺ earnedScore === maxScore. */
  isCorrect: boolean;
}

// ─── Normalization helpers ──────────────────────────────────────────────────

/**
 * Унификация дробного разделителя + удаление пробелов / неразрывных пробелов /
 * случайных табов. Сохраняем регистр, минус, цифры, латинские/кирилловские
 * буквы. Регистр чувствителен только если check_mode='strict' и correctAnswer
 * содержит uppercase — для multi-choice / ordered регистр игнорируется
 * (поскольку ответы там — цифры).
 */
function normalizeBasic(s: string): string {
  // \s+ matches non-breaking space (U+00A0) too — JS regex spec.
  return s.replace(/\s+/g, '').trim();
}

/**
 * Нормализация числа: запятая → точка, удаление trailing zeros в дроби,
 * удаление leading zeros кроме одного перед точкой. "5,60" → "5.6", "05" → "5",
 * "0.500" → "0.5". Возвращает null для не-числа.
 */
function normalizeNumber(s: string): number | null {
  const cleaned = s.replace(/\s+/g, '').replace(/,/g, '.');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Сравнение чисел с учётом ЕГЭ-правил округления для Части 1:
 * целые числа сверяются точно; дроби — с относительной погрешностью 1%
 * ИЛИ абсолютной 0.01, что больше. Это покрывает кейс «ответ 5.6 vs 5.60»
 * + защита от floating point shenanigans.
 */
function numbersEqual(expected: number, actual: number): boolean {
  if (Number.isInteger(expected) && Number.isInteger(actual)) {
    return expected === actual;
  }
  const tolerance = Math.max(0.01, Math.abs(expected) * 0.01);
  return Math.abs(expected - actual) <= tolerance;
}

// ─── Per-mode pure checks ────────────────────────────────────────────────────

export function checkStrict(correct: string, student: string): boolean {
  const normCorrect = normalizeBasic(correct);
  const normStudent = normalizeBasic(student);
  if (!normCorrect || !normStudent) return false;

  // Try numeric path first (handles "5,6" === "5.6" === "5.60").
  const a = normalizeNumber(normCorrect);
  const b = normalizeNumber(normStudent);
  if (a !== null && b !== null) {
    return numbersEqual(a, b);
  }

  // Fallback: case-insensitive string match.
  return normCorrect.toLowerCase() === normStudent.toLowerCase();
}

export function checkOrdered(correct: string, student: string): boolean {
  // "1,3,2" → ["1","3","2"]. Pure exact-order match.
  const c = normalizeBasic(correct).split(',').map((x) => x.toLowerCase()).filter(Boolean);
  const s = normalizeBasic(student).split(',').map((x) => x.toLowerCase()).filter(Boolean);
  if (c.length === 0 || s.length === 0) return false;
  if (c.length !== s.length) return false;
  for (let i = 0; i < c.length; i += 1) {
    if (c[i] !== s[i]) return false;
  }
  return true;
}

export function checkUnordered(correct: string, student: string): boolean {
  // Multiset equality — порядок не важен, дубликаты учитываются.
  const c = normalizeBasic(correct).split(',').map((x) => x.toLowerCase()).filter(Boolean);
  const s = normalizeBasic(student).split(',').map((x) => x.toLowerCase()).filter(Boolean);
  if (c.length === 0 || s.length === 0) return false;
  if (c.length !== s.length) return false;
  const sortedC = [...c].sort();
  const sortedS = [...s].sort();
  for (let i = 0; i < sortedC.length; i += 1) {
    if (sortedC[i] !== sortedS[i]) return false;
  }
  return true;
}

export function checkMultiChoice(correct: string, student: string): boolean {
  // Multiple correct options (typically 2 of 5). Set equality, ученик может
  // ввести "13" или "1,3" или "1 3" — приводим к {1,3}. Дубликаты игнорируем
  // (multi_choice не может выбрать опцию дважды).
  const toSet = (raw: string): Set<string> => {
    const tokens = normalizeBasic(raw)
      .split(/[,;]/)
      .flatMap((part) => (part.includes('') && /^\d+$/.test(part) ? part.split('') : [part]))
      .map((x) => x.toLowerCase())
      .filter(Boolean);
    return new Set(tokens);
  };
  const c = toSet(correct);
  const s = toSet(student);
  if (c.size === 0 || s.size === 0) return false;
  if (c.size !== s.size) return false;
  for (const item of c) {
    if (!s.has(item)) return false;
  }
  return true;
}

/**
 * ЕГЭ физика №20 — установление соответствия. correct_answer — строка из
 * digits, по позиции = столбец Б. Например "31" значит «А → 3, Б → 1».
 * Принимаем строки без разделителей ("31") и с разделителями ("3,1" / "3 1").
 * Tolerance к whitespace, требуется точное совпадение after digits-only.
 */
export function checkTask20(correct: string, student: string): boolean {
  const digitsOnly = (raw: string): string =>
    normalizeBasic(raw).replace(/[,;.\s]/g, '').toLowerCase();
  const c = digitsOnly(correct);
  const s = digitsOnly(student);
  if (!c || !s) return false;
  if (!/^\d+$/.test(c) || !/^\d+$/.test(s)) return false;
  return c === s;
}

/**
 * Pair:
 * - value + unit: "12.5;м" или "12,5 м" или "12.5 м/с";
 * - measurement value + absolute error in ЕГЭ blank format: "2,70,1".
 *
 * For value+unit, numeric tolerance applies to the value. For blank-format
 * measurement answers, compare the normalized compact string because the exam
 * explicitly asks to write only numbers without separators.
 *
 * Принимаем как разделитель для value+unit: ";", whitespace. Если ученик ввёл
 * только число — unit фейлит (= неверно).
 */
export function checkPair(correct: string, student: string): boolean {
  const compactMeasurement = (raw: string): string =>
    raw
      .replace(/\s+/g, '')
      .replace(/[()±;]/g, '')
      .replace(/[^\d,.-]/g, '')
      .replace(/\./g, ',');

  const compactCorrect = compactMeasurement(correct);
  if (/^-?\d+,\d+,\d+$/.test(compactCorrect)) {
    return compactMeasurement(student) === compactCorrect;
  }

  const splitPair = (raw: string): { value: string; unit: string } | null => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    // Split on first `;` or first whitespace cluster between number and rest.
    if (trimmed.includes(';')) {
      const [v, u] = trimmed.split(';', 2);
      return { value: v.trim(), unit: u.trim() };
    }
    const m = trimmed.match(/^(-?\d+(?:[.,]\d+)?)\s*(.+)$/);
    if (!m) return null;
    return { value: m[1].trim(), unit: m[2].trim() };
  };
  const c = splitPair(correct);
  const s = splitPair(student);
  if (!c || !s) return false;
  // Compare value numerically.
  const cn = normalizeNumber(c.value);
  const sn = normalizeNumber(s.value);
  if (cn === null || sn === null) return false;
  if (!numbersEqual(cn, sn)) return false;
  // Compare unit — case/whitespace-insensitive, dash/slash preserved.
  const normUnit = (u: string) => u.replace(/\s+/g, '').toLowerCase();
  return normUnit(c.unit) === normUnit(s.unit);
}

// ─── Public dispatch ─────────────────────────────────────────────────────────

export function checkPart1Answer(input: CheckPart1Input): CheckPart1Result {
  const { correctAnswer, studentAnswer, checkMode, maxScore } = input;

  // No student answer → 0. Manual mode — Часть 2, no auto-check.
  if (
    !studentAnswer ||
    typeof studentAnswer !== 'string' ||
    studentAnswer.trim().length === 0 ||
    !correctAnswer ||
    checkMode === 'manual'
  ) {
    return { earnedScore: 0, isCorrect: false };
  }

  let isCorrect = false;
  switch (checkMode) {
    case 'strict':
      isCorrect = checkStrict(correctAnswer, studentAnswer);
      break;
    case 'ordered':
      isCorrect = checkOrdered(correctAnswer, studentAnswer);
      break;
    case 'unordered':
      isCorrect = checkUnordered(correctAnswer, studentAnswer);
      break;
    case 'multi_choice':
      isCorrect = checkMultiChoice(correctAnswer, studentAnswer);
      break;
    case 'task20':
      isCorrect = checkTask20(correctAnswer, studentAnswer);
      break;
    case 'pair':
      isCorrect = checkPair(correctAnswer, studentAnswer);
      break;
    default:
      // Unknown mode — fail closed.
      isCorrect = false;
  }

  return {
    earnedScore: isCorrect ? maxScore : 0,
    isCorrect,
  };
}
