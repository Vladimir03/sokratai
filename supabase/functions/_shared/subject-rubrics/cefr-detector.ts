/**
 * CEFR level auto-detection from homework task_text.
 *
 * Used by `resolveSubjectRubric()` for language subjects (english / french /
 * spanish) to pick B1 vs B2 rubric without requiring tutors to fill an
 * additional field. Falls back to B1 (most common school level).
 *
 * Detection priority (first match wins):
 *   1. Explicit CEFR token («B1», «уровень B2», «B1.2»)
 *   2. Exam name token («DELF B1», «DELE B2», «IELTS 6.5»)
 *   3. School exam token («ЕГЭ» ≈ B2, «ОГЭ» ≈ B1)
 *   4. Default B1
 *
 * Regex are case-insensitive and Unicode-aware. We deliberately avoid
 * heavy NLP — task_text often contains the exam name in the first 200
 * chars (e.g. «production écrite DELF B1»).
 */

import type { CefrLevel } from "./types.ts";

const EXPLICIT_CEFR_RE = /\b(A2|B1\.[12]|B1|B2\.[12]|B2|C1)\b/i;
const DELF_RE = /\bDELF\s*(A2|B1|B2)\b/i;
const DELE_RE = /\bDELE\s*(A2|B1|B2|C1)\b/i;
const IELTS_RE = /\bIELTS\s*([4-9](?:\.5)?)\b/i;
const TOEFL_RE = /\bTOEFL\s*(?:iBT)?\s*([0-9]{2,3})\b/i;
const EGE_RE = /\b(?:ЕГЭ|EGE|USE)\b/i;
const OGE_RE = /\b(?:ОГЭ|OGE)\b/i;

/**
 * Map IELTS overall band to approximate CEFR.
 * Source: Cambridge / IELTS-CEFR alignment table.
 */
function ieltsBandToCefr(band: number): CefrLevel {
  if (band >= 7) return "C1";
  if (band >= 6) return "B2";
  if (band >= 5) return "B1";
  return "A2";
}

/**
 * Map TOEFL iBT score to approximate CEFR (Cambridge alignment).
 */
function toeflScoreToCefr(score: number): CefrLevel {
  if (score >= 95) return "C1";
  if (score >= 72) return "B2";
  if (score >= 42) return "B1";
  return "A2";
}

/**
 * Normalise the explicit CEFR token («B1.2» → «B1», «B2.1» → «B2»).
 */
function normaliseExplicitCefr(raw: string): CefrLevel {
  const upper = raw.toUpperCase().replace(/\.\d+$/, "");
  if (upper === "A2" || upper === "B1" || upper === "B2" || upper === "C1") {
    return upper;
  }
  return "B1";
}

export interface DetectCefrResult {
  level: CefrLevel;
  /** What signal matched first — useful for telemetry / debug. */
  source: "explicit" | "delf" | "dele" | "ielts" | "toefl" | "ege" | "oge" | "default";
}

/**
 * Detect CEFR level from task_text.
 * Returns B1 default when no signal is found (most common school level in RU pilot).
 */
export function detectCefrLevel(taskText: string | null | undefined): DetectCefrResult {
  const text = (taskText ?? "").trim();
  if (!text) return { level: "B1", source: "default" };

  // 1. DELF/DELE explicit tokens take priority — they tightly bind subject + level.
  const delfMatch = text.match(DELF_RE);
  if (delfMatch) {
    return { level: normaliseExplicitCefr(delfMatch[1]), source: "delf" };
  }
  const deleMatch = text.match(DELE_RE);
  if (deleMatch) {
    return { level: normaliseExplicitCefr(deleMatch[1]), source: "dele" };
  }

  // 2. IELTS / TOEFL — convert score to CEFR.
  const ieltsMatch = text.match(IELTS_RE);
  if (ieltsMatch) {
    const band = Number.parseFloat(ieltsMatch[1]);
    if (Number.isFinite(band)) {
      return { level: ieltsBandToCefr(band), source: "ielts" };
    }
  }
  const toeflMatch = text.match(TOEFL_RE);
  if (toeflMatch) {
    const score = Number.parseInt(toeflMatch[1], 10);
    if (Number.isFinite(score)) {
      return { level: toeflScoreToCefr(score), source: "toefl" };
    }
  }

  // 3. Generic CEFR token («Урок уровня B2»).
  const cefrMatch = text.match(EXPLICIT_CEFR_RE);
  if (cefrMatch) {
    return { level: normaliseExplicitCefr(cefrMatch[1]), source: "explicit" };
  }

  // 4. School exam tokens — ЕГЭ ≈ B2 (FIPI требования), ОГЭ ≈ B1.
  if (EGE_RE.test(text)) {
    return { level: "B2", source: "ege" };
  }
  if (OGE_RE.test(text)) {
    return { level: "B1", source: "oge" };
  }

  return { level: "B1", source: "default" };
}
