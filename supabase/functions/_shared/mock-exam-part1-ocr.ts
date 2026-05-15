/**
 * Mock Exam — AI OCR Часть 1 (blank mode), Phase 6 (2026-05-15).
 *
 * Single Gemini call: full фото бланка ФИПИ + список 20 задач Часть 1 →
 * JSON `{ "1": {value, confidence}, ..., "20": {value, confidence} }`.
 *
 * Запускается из `mock-exam-grade::handleGrade` при условии:
 *   - `attempt.answer_method === 'blank'`
 *   - `attempt.part1_blank_photo_url IS NOT NULL`
 *   - `attempt.ai_part1_ocr_json IS NULL` (первый run) ИЛИ regrade triggered
 *
 * После OCR результат:
 *   1. Сохраняется в `mock_exam_attempts.ai_part1_ocr_json` (миграция
 *      `20260515120000_attempt_ai_part1_ocr.sql`)
 *   2. Для каждой kim 1-20 вызывается existing `checkPart1Answer` из
 *      `src/lib/mockExamPart1Checker.ts` Deno-mirror в
 *      `mock-exam-student-api` (одна логика для form и blank mode)
 *   3. Upsert `mock_exam_attempt_part1_answers` с `student_answer +
 *      earned_score` (только если tutor ещё не выставил manual)
 *
 * Anti-leak invariant: `ai_part1_ocr_json` — tutor-only до approval.
 * Ученик видит только `earned_score` post-approval (CLAUDE.md §15).
 *
 * Tutor UX: `Part1BlankReviewPanel` pre-fill'ит input cells из
 * `ai_part1_ocr_json[kim].value`. Low confidence cells — amber border
 * + tooltip «AI не уверен, проверь по фото».
 */

// Re-declared locally (mirror `mock-exam-prompts.ts` convention) —
// keeps _shared/ free of cross-function imports.

export interface LovableTextPart {
  type: "text";
  text: string;
}

export interface LovableImagePart {
  type: "image_url";
  image_url: { url: string };
}

export type LovableMessageContent =
  | string
  | Array<LovableTextPart | LovableImagePart>;

export interface LovableMessage {
  role: "system" | "user" | "assistant";
  content: LovableMessageContent;
}

export type Part1OCRConfidence = "low" | "medium" | "high";

export interface Part1OCRCell {
  /** Recognized answer text (raw, без normalization). null = пустая клетка. */
  value: string | null;
  /** AI уверенность распознавания. */
  confidence: Part1OCRConfidence;
}

/** kim 1-20 → распознанная клетка бланка. */
export type Part1OCRResult = Record<number, Part1OCRCell>;

/**
 * Meta-info per Часть 1 задаче для OCR-pass: AI видит structure ответа
 * (число / последовательность / два числа) и адаптирует распознавание.
 *
 * `check_mode` зеркалит `mock_exam_variant_tasks.check_mode` (Phase 1):
 *   - 'strict'       — одно число / целое
 *   - 'multi_choice' — последовательность цифр (2-3 верных ответа)
 *   - 'ordered'      — последовательность цифр в порядке
 *   - 'pair'         — два числа (например, `(1,4±0,2) → "1,40,2"`)
 *   - 'task20'       — последовательность 2-х цифр в задании 20
 *   - 'manual'       — Часть 2 (НЕ передаётся в Part1 OCR; для контекста)
 */
export interface Part1OCRTaskMeta {
  kim_number: number;
  max_score: number;
  check_mode: "strict" | "multi_choice" | "ordered" | "pair" | "task20" | "manual";
}

const VALID_CONFIDENCE = new Set<Part1OCRConfidence>(["low", "medium", "high"]);
const CONTROL_CHARS_RE = /[\p{Cc}]/gu;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function softTruncate(value: string, maxLen: number): string {
  if (value.length <= maxLen) return value;
  return `${value.slice(0, maxLen).trim()}...`;
}

function sanitizeConfidence(value: unknown): Part1OCRConfidence {
  if (typeof value === "string") {
    const norm = value.trim().toLowerCase() as Part1OCRConfidence;
    if (VALID_CONFIDENCE.has(norm)) return norm;
  }
  return "low";
}

function sanitizeCellValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  const cleaned = value.replace(CONTROL_CHARS_RE, "").trim();
  if (!cleaned) return null;
  return softTruncate(cleaned, 64); // Защита от prompt-injection / огромных ответов
}

/**
 * Build prompt для AI OCR Часть 1 — single Gemini call.
 *
 * @param tasksMeta meta всех 20 Часть 1 задач (kim + max_score + check_mode)
 * @param blankPhotoDataUrl inline `data:image/jpeg;base64,...` бланк ФИПИ
 * @returns LovableMessage[] для callLovableJson
 */
export function buildPart1BlankOCRPrompt(
  tasksMeta: Part1OCRTaskMeta[],
  blankPhotoDataUrl: string,
): LovableMessage[] {
  // Filter только Часть 1 (check_mode !== 'manual')
  const part1Tasks = tasksMeta.filter((t) => t.check_mode !== "manual");

  const tasksSummary = part1Tasks
    .map((task) => {
      const formatHint = (() => {
        switch (task.check_mode) {
          case "strict":
            return "одно число (целое / десятичная дробь)";
          case "multi_choice":
            return "последовательность 2-3 цифр (например, `134`)";
          case "ordered":
            return "последовательность цифр в порядке (например, `2143`)";
          case "pair":
            return "два числа без разделителей (например, `1,40,2` для ответа `(1,4±0,2)`)";
          case "task20":
            return "последовательность 2-х цифр (например, `12`, `23`)";
          default:
            return "формат не определён";
        }
      })();
      return `• Задача №${task.kim_number}: ${formatHint}`;
    })
    .join("\n");

  const systemContent = [
    "Ты распознаёшь рукописные ответы ученика на бланке № 1 ФИПИ ЕГЭ по физике.",
    "На бланке — клетки с номерами задач 1-20. В каждой клетке ученик написал свой ответ от руки.",
    "Твоя задача: внимательно прочитать каждую клетку и вернуть распознанный текст + уверенность.",
    "",
    "ФОРМАТЫ ОТВЕТОВ ПО ЗАДАЧАМ:",
    tasksSummary,
    "",
    "ПРАВИЛА РАСПОЗНАВАНИЯ:",
    "- Пустая клетка → `\"value\": null, \"confidence\": \"high\"`",
    "- Если ученик зачеркнул ответ и написал другой — бери последний (актуальный) ответ.",
    "- Запятая vs точка в десятичных — сохраняй как ученик написал (нормализация уже в checker'е).",
    "- Знак минус '−' / '-' — сохраняй; '+' опускай если стоит перед числом.",
    "- Не интерпретируй и не исправляй ответ — твоя задача распознать как написано.",
    "- Уверенность:",
    "    high — ответ читается чётко",
    "    medium — почерк сложный, но смысл понятен; есть один-два двусмысленных знака",
    "    low — клетка размыта / зачёркнута многократно / нечитаемо",
    "- При low confidence по-прежнему верни best guess (или null если совсем нечитаемо).",
    "",
    "Верни ТОЛЬКО валидный JSON без markdown-обёрток:",
    "{",
    "  \"1\": {\"value\": \"12\", \"confidence\": \"high\"},",
    "  \"2\": {\"value\": null, \"confidence\": \"high\"},",
    "  \"3\": {\"value\": \"234\", \"confidence\": \"medium\"},",
    "  ...",
    "  \"20\": {\"value\": \"12\", \"confidence\": \"high\"}",
    "}",
  ].join("\n");

  const userContent: Array<LovableTextPart | LovableImagePart> = [
    {
      type: "text",
      text: "Изображение бланка № 1 ФИПИ с ответами ученика. Распознай клетки 1-20.",
    },
    { type: "image_url", image_url: { url: blankPhotoDataUrl } },
    {
      type: "text",
      text: "Верни JSON по схеме выше.",
    },
  ];

  return [
    { role: "system", content: systemContent },
    { role: "user", content: userContent },
  ];
}

/**
 * Sanitize raw AI OCR JSON → strict Part1OCRResult.
 * Defensive: invalid keys / values drop'аются, defaulting на
 * `{value: null, confidence: 'low'}` для отсутствующих kim 1-20.
 */
export function sanitizePart1OCRResult(parsed: unknown): Part1OCRResult {
  const result: Part1OCRResult = {};
  for (let kim = 1; kim <= 20; kim++) {
    result[kim] = { value: null, confidence: "low" };
  }

  if (!isRecord(parsed)) return result;

  for (const [rawKey, rawValue] of Object.entries(parsed)) {
    const kimNum = Number.parseInt(rawKey.trim(), 10);
    if (!Number.isFinite(kimNum) || kimNum < 1 || kimNum > 20) continue;
    if (!isRecord(rawValue)) continue;

    result[kimNum] = {
      value: sanitizeCellValue(rawValue.value),
      confidence: sanitizeConfidence(rawValue.confidence),
    };
  }

  return result;
}
