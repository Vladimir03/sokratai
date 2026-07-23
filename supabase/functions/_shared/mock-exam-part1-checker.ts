/**
 * Mock-exams Часть 1 deterministic checker — Deno mirror of
 * `src/lib/mockExamPart1Checker.ts`.
 *
 * Phase 1 (2026-05-07) — canonical TS checker для Часть 1 авточекеров
 * (strict/multi_choice/ordered/unordered/task20/pair). Phase 6 (2026-05-15)
 * вынес inline mirror из `mock-exam-student-api/index.ts` в `_shared/`,
 * чтобы переиспользовать в `mock-exam-grade/index.ts` для OCR result
 * grading (blank-mode attempts).
 *
 * Deno-mirror invariant (.claude/rules/45-mock-exams.md): этот файл — single source of
 * truth для Часть 1 checker'а на стороне edge functions. ОБА consumer'а
 * (`mock-exam-student-api` + `mock-exam-grade`) импортируют отсюда.
 * Логика идентична `src/lib/mockExamPart1Checker.ts` (frontend canonical).
 * Любое изменение логики ОБЯЗАНО синхронно править frontend canonical +
 * этот mirror (см. инструкции в .claude/rules/45-mock-exams.md).
 *
 * F3 invariant (mock-exams-v1-pilot-polish AC-P3, 2026-05-14):
 * `numericRoundingMatch` fallback применяется ТОЛЬКО в `check_mode='strict'`
 * ветке. НЕ трогать `multi_choice` / `ordered` / `unordered` / `pair` / `task20`.
 */

/**
 * Реестр режимов — зеркало `src/lib/mockExamPart1Checker.ts::MOCK_EXAM_CHECK_MODES`
 * (parity-тест scripts/test-mockexam-checkmode-parity.mjs сверяет наборы).
 */
export const CHECK_MODES = [
  "strict", "ordered", "ordered_lenient", "unordered", "multi_choice",
  "multi_choice_strict", "task20", "pair", "manual",
] as const;

export type CheckMode = (typeof CHECK_MODES)[number];

export function normalizeBasic(s: string): string {
  // \s+ matches non-breaking space (U+00A0) too — JS regex spec.
  return s.replace(/\s+/g, "").trim();
}

export function normalizeNumber(s: string): number | null {
  const cleaned = s.replace(/\s+/g, "").replace(/,/g, ".");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function numbersEqual(expected: number, actual: number): boolean {
  if (Number.isInteger(expected) && Number.isInteger(actual)) return expected === actual;
  const tol = Math.max(0.01, Math.abs(expected) * 0.01);
  return Math.abs(expected - actual) <= tol;
}

/**
 * F3 (mock-exams-v1-pilot-polish AC-P3) — numeric tolerance for strict mode.
 * Counts decimals in `correct`, rounds `student` to that scale, compares.
 * Returns `null` если either не числовое; caller остаётся на строковом FAIL.
 */
export function countDecimals(s: string): number {
  const m = s.trim().match(/[.,](\d+)/);
  return m ? m[1].length : 0;
}

export function numericRoundingMatch(student: string, correct: string): boolean | null {
  const studentNum = normalizeNumber(student);
  const correctNum = normalizeNumber(correct);
  if (studentNum === null || correctNum === null) return null;
  const scale = countDecimals(correct);
  const factor = 10 ** scale;
  const studentRounded = Math.round(studentNum * factor) / factor;
  return Math.abs(studentRounded - correctNum) < 1e-9;
}

export function checkStrict(c: string, s: string): boolean {
  const a = normalizeBasic(c), b = normalizeBasic(s);
  if (!a || !b) return false;
  const na = normalizeNumber(a), nb = normalizeNumber(b);
  if (na !== null && nb !== null) return numbersEqual(na, nb);
  return a.toLowerCase() === b.toLowerCase();
}

export function checkOrdered(c: string, s: string): boolean {
  const ac = normalizeBasic(c).split(",").map((x) => x.toLowerCase()).filter(Boolean);
  const as = normalizeBasic(s).split(",").map((x) => x.toLowerCase()).filter(Boolean);
  if (ac.length === 0 || ac.length !== as.length) return false;
  for (let i = 0; i < ac.length; i++) if (ac[i] !== as[i]) return false;
  return true;
}

export function checkUnordered(c: string, s: string): boolean {
  const ac = normalizeBasic(c).split(",").map((x) => x.toLowerCase()).filter(Boolean);
  const as = normalizeBasic(s).split(",").map((x) => x.toLowerCase()).filter(Boolean);
  if (ac.length === 0 || ac.length !== as.length) return false;
  const sc = [...ac].sort(), ss = [...as].sort();
  for (let i = 0; i < sc.length; i++) if (sc[i] !== ss[i]) return false;
  return true;
}

/**
 * Парсит ответ multi_choice в Set цифр. Mirror frontend canonical
 * `toMultiChoiceSet` из `src/lib/mockExamPart1Checker.ts`.
 */
function toMultiChoiceSet(raw: string): Set<string> {
  const tokens = normalizeBasic(raw)
    .split(/[,;]/)
    .flatMap((part) => (/^\d+$/.test(part) ? part.split("") : [part]))
    .map((x) => x.toLowerCase())
    .filter(Boolean);
  return new Set(tokens);
}

export function checkMultiChoice(c: string, s: string): boolean {
  const setC = toMultiChoiceSet(c), setS = toMultiChoiceSet(s);
  if (setC.size === 0 || setC.size !== setS.size) return false;
  for (const item of setC) if (!setS.has(item)) return false;
  return true;
}

/**
 * Partial credit для multi_choice (KIM 5/9/14/18). ФИПИ 2026 AC-P4.
 * Mirror `gradeMultiChoice` из frontend canonical. См. JSDoc там.
 *
 * Hard invariant (.claude/rules/45-mock-exams.md): любое изменение этой функции ОБЯЗАНО
 * синхронно править `src/lib/mockExamPart1Checker.ts::gradeMultiChoice`.
 */
export function gradeMultiChoice(
  correct: string,
  student: string,
  maxScore: number,
): number {
  const correctSet = toMultiChoiceSet(correct);
  const studentSet = toMultiChoiceSet(student);
  if (correctSet.size === 0) return 0;
  if (studentSet.size === 0) return 0;
  let matches = 0;
  for (const item of studentSet) {
    if (correctSet.has(item)) matches += 1;
  }
  const errors = Math.max(correctSet.size, studentSet.size) - matches;
  if (errors === 0) return maxScore;
  if (errors === 1 && maxScore >= 2) return 1;
  return 0;
}

/**
 * Partial credit для multi_choice_strict (обществознание ЕГЭ Ч1, критерии
 * Милады 2026-07-23). 1 балл ТОЛЬКО за один лишний ИЛИ один недостающий;
 * ЗАМЕНА цифры (и лишний, и недостающий) → 0. Физический `multi_choice`
 * замену засчитывает — у каждого предмета СВОИ критерии, не путать.
 *
 * Hard invariant (.claude/rules/45-mock-exams.md): любое изменение этой функции
 * ОБЯЗАНО синхронно править `src/lib/mockExamPart1Checker.ts::gradeMultiChoiceStrict`.
 */
export function gradeMultiChoiceStrict(
  correct: string,
  student: string,
  maxScore: number,
): number {
  const correctSet = toMultiChoiceSet(correct);
  const studentSet = toMultiChoiceSet(student);
  if (correctSet.size === 0) return 0;
  if (studentSet.size === 0) return 0;
  let missing = 0;
  for (const item of correctSet) {
    if (!studentSet.has(item)) missing += 1;
  }
  let extra = 0;
  for (const item of studentSet) {
    if (!correctSet.has(item)) extra += 1;
  }
  if (missing === 0 && extra === 0) return maxScore;
  if (maxScore >= 2 && ((missing === 1 && extra === 0) || (missing === 0 && extra === 1))) {
    return 1;
  }
  return 0;
}

/**
 * Partial credit для ordered (KIM 6/10/15/17). ФИПИ 2026 AC-P4.
 * Hamming distance после нормализации разделителей. См. JSDoc frontend.
 *
 * Hard invariant (.claude/rules/45-mock-exams.md): mirror frontend `gradeOrdered`.
 */
export function gradeOrdered(
  correct: string,
  student: string,
  maxScore: number,
): number {
  const correctClean = normalizeBasic(correct).toLowerCase().replace(/[,;]+/g, "");
  const studentClean = normalizeBasic(student).toLowerCase().replace(/[,;]+/g, "");
  if (correctClean.length === 0) return 0;
  if (studentClean.length === 0) return 0;
  if (studentClean.length !== correctClean.length) return 0;
  let errors = 0;
  for (let i = 0; i < correctClean.length; i += 1) {
    if (studentClean[i] !== correctClean[i]) errors += 1;
  }
  if (errors === 0) return maxScore;
  if (errors === 1 && maxScore >= 2) return 1;
  return 0;
}

/**
 * Расстояние Левенштейна (вставка/удаление/замена = 1). Строки коротки
 * (последовательности цифр ≤ ~10 символов) — простой DP без оптимизаций.
 * Mirror frontend canonical `levenshteinDistance`.
 */
function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i += 1) {
    const curr = new Array<number>(n + 1);
    curr[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const substCost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + substCost);
    }
    prev = curr;
  }
  return prev[n];
}

/**
 * Partial credit для ordered_lenient (обществознание ЕГЭ № 6/13/15, критерии
 * ФИПИ по таблице Милады 2026-07-22): 1 ошибка = неверный символ ИЛИ лишняя/
 * недостающая позиция → 1 балл; транспозиция (dist 2) → 0. НЕ физический
 * `ordered` (там «символов больше требуемого → 0», Hamming).
 *
 * Hard invariant (.claude/rules/45-mock-exams.md): mirror frontend `gradeOrderedLenient`.
 */
export function gradeOrderedLenient(
  correct: string,
  student: string,
  maxScore: number,
): number {
  const correctClean = normalizeBasic(correct).toLowerCase().replace(/[,;]+/g, "");
  const studentClean = normalizeBasic(student).toLowerCase().replace(/[,;]+/g, "");
  if (correctClean.length === 0) return 0;
  if (studentClean.length === 0) return 0;
  const dist = levenshteinDistance(correctClean, studentClean);
  if (dist === 0) return maxScore;
  if (dist === 1 && maxScore >= 2) return 1;
  return 0;
}

// ЕГЭ физика №20 — «выберите два номера» (множество индексов, порядок НЕ важен):
// «13»=«31» → полный балл; любой промах хотя бы по одной цифре → 0 (binary).
// Чувствительно к длине/дубликатам («133»≠«13»). 2026-06-07: было строковое
// равенство (`ac === as`), из-за чего «31» при верном «13» считалось неверным.
// ВСЕ task20-задачи в сидах — «номера выбранных …», поэтому порядок-независимо.
export function checkTask20(c: string, s: string): boolean {
  const onlyDigits = (r: string) => normalizeBasic(r).replace(/[,;.\s]/g, "").toLowerCase();
  const ac = onlyDigits(c), as = onlyDigits(s);
  if (!ac || !as) return false;
  if (!/^\d+$/.test(ac) || !/^\d+$/.test(as)) return false;
  const sortDigits = (x: string) => [...x].sort().join("");
  return sortDigits(ac) === sortDigits(as);
}

export function checkPair(c: string, s: string): boolean {
  const compactMeasurement = (r: string): string =>
    r
      .replace(/\s+/g, "")
      .replace(/[()±;]/g, "")
      .replace(/[^\d,.-]/g, "")
      .replace(/\./g, ",");

  const compactCorrect = compactMeasurement(c);
  if (/^-?\d+,\d+,\d+$/.test(compactCorrect)) {
    return compactMeasurement(s) === compactCorrect;
  }

  const split = (r: string): { value: string; unit: string } | null => {
    const t = r.trim();
    if (!t) return null;
    if (t.includes(";")) {
      const [v, u] = t.split(";", 2);
      return { value: v.trim(), unit: u.trim() };
    }
    const m = t.match(/^(-?\d+(?:[.,]\d+)?)\s*(.+)$/);
    if (!m) return null;
    return { value: m[1].trim(), unit: m[2].trim() };
  };
  const pc = split(c), ps = split(s);
  if (!pc || !ps) return false;
  const cn = normalizeNumber(pc.value), sn = normalizeNumber(ps.value);
  if (cn === null || sn === null) return false;
  if (!numbersEqual(cn, sn)) return false;
  const norm = (u: string) => u.replace(/\s+/g, "").toLowerCase();
  return norm(pc.unit) === norm(ps.unit);
}

/**
 * Главная entry-point функция. Возвращает earned (0 или maxScore) +
 * correct flag.
 *
 * @param correctAnswer Эталон из `mock_exam_variant_tasks.correct_answer`
 * @param studentAnswer Что прислал ученик (или AI OCR result)
 * @param checkMode `mock_exam_variant_tasks.check_mode`
 * @param maxScore Часть 1 max_score (обычно 1 или 2)
 * @param kimNumber Для telemetry F3 numeric rounding match
 */
export function checkPart1(
  correctAnswer: string | null | undefined,
  studentAnswer: string | null | undefined,
  checkMode: CheckMode | null | undefined,
  maxScore: number,
  kimNumber?: number,
): { earned: number; correct: boolean } {
  if (!studentAnswer || !correctAnswer || !checkMode || checkMode === "manual") {
    return { earned: 0, correct: false };
  }

  // ФИПИ 2026 partial credit (AC-P4) для multi_choice и ordered.
  if (checkMode === "multi_choice") {
    const earned = gradeMultiChoice(correctAnswer, studentAnswer, maxScore);
    return { earned, correct: earned === maxScore };
  }
  if (checkMode === "multi_choice_strict") {
    const earned = gradeMultiChoiceStrict(correctAnswer, studentAnswer, maxScore);
    return { earned, correct: earned === maxScore };
  }
  if (checkMode === "ordered") {
    const earned = gradeOrdered(correctAnswer, studentAnswer, maxScore);
    return { earned, correct: earned === maxScore };
  }
  if (checkMode === "ordered_lenient") {
    const earned = gradeOrderedLenient(correctAnswer, studentAnswer, maxScore);
    return { earned, correct: earned === maxScore };
  }

  let ok = false;
  switch (checkMode) {
    case "strict":
      ok = checkStrict(correctAnswer, studentAnswer);
      // F3 fallback: rounding tolerance ONLY for strict.
      if (!ok) {
        const rounding = numericRoundingMatch(studentAnswer, correctAnswer);
        if (rounding === true) {
          console.info("[mock-exam-checker] numeric_rounding_match", {
            kim: kimNumber,
            student: studentAnswer,
            correct: correctAnswer,
            scale: countDecimals(correctAnswer),
          });
          ok = true;
        }
      }
      break;
    case "unordered": ok = checkUnordered(correctAnswer, studentAnswer); break;
    case "task20": ok = checkTask20(correctAnswer, studentAnswer); break;
    case "pair": ok = checkPair(correctAnswer, studentAnswer); break;
    default: ok = false;
  }
  return { earned: ok ? maxScore : 0, correct: ok };
}
