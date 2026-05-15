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
 * Deno-mirror invariant (CLAUDE.md §15a): этот файл — single source of
 * truth для Часть 1 checker'а на стороне edge functions. ОБА consumer'а
 * (`mock-exam-student-api` + `mock-exam-grade`) импортируют отсюда.
 * Логика идентична `src/lib/mockExamPart1Checker.ts` (frontend canonical).
 * Любое изменение логики ОБЯЗАНО синхронно править frontend canonical +
 * этот mirror (см. инструкции в CLAUDE.md §15a).
 *
 * F3 invariant (mock-exams-v1-pilot-polish AC-P3, 2026-05-14):
 * `numericRoundingMatch` fallback применяется ТОЛЬКО в `check_mode='strict'`
 * ветке. НЕ трогать `multi_choice` / `ordered` / `unordered` / `pair` / `task20`.
 */

export type CheckMode =
  | "strict" | "ordered" | "unordered" | "multi_choice"
  | "task20" | "pair" | "manual";

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

export function checkMultiChoice(c: string, s: string): boolean {
  const toSet = (raw: string): Set<string> => {
    const tokens = normalizeBasic(raw)
      .split(/[,;]/)
      .flatMap((part) => (/^\d+$/.test(part) ? part.split("") : [part]))
      .map((x) => x.toLowerCase())
      .filter(Boolean);
    return new Set(tokens);
  };
  const setC = toSet(c), setS = toSet(s);
  if (setC.size === 0 || setC.size !== setS.size) return false;
  for (const item of setC) if (!setS.has(item)) return false;
  return true;
}

export function checkTask20(c: string, s: string): boolean {
  const onlyDigits = (r: string) => normalizeBasic(r).replace(/[,;.\s]/g, "").toLowerCase();
  const ac = onlyDigits(c), as = onlyDigits(s);
  if (!ac || !as) return false;
  if (!/^\d+$/.test(ac) || !/^\d+$/.test(as)) return false;
  return ac === as;
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
    case "ordered": ok = checkOrdered(correctAnswer, studentAnswer); break;
    case "unordered": ok = checkUnordered(correctAnswer, studentAnswer); break;
    case "multi_choice": ok = checkMultiChoice(correctAnswer, studentAnswer); break;
    case "task20": ok = checkTask20(correctAnswer, studentAnswer); break;
    case "pair": ok = checkPair(correctAnswer, studentAnswer); break;
    default: ok = false;
  }
  return { earned: ok ? maxScore : 0, correct: ok };
}
