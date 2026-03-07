/**
 * Phase 3: AI evaluation and hint generation for guided homework chat.
 * Uses the Lovable AI Gateway (same as vision_checker.ts).
 */

import {
  callLovableJson,
  normalizeComparable,
  normalizeText,
  softTruncate,
  type HomeworkAiErrorType,
  type LovableMessage,
} from "./vision_checker.ts";

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_PROMPT_TEXT = 8_000;
const MAX_FEEDBACK_LENGTH = 1_200;
const SAFE_FEEDBACK_NO_ANSWER =
  "Проверь ход решения шаг за шагом и попробуй исправить первую найденную ошибку самостоятельно.";

const VALID_VERDICTS = new Set(["CORRECT", "INCORRECT"]);

// ─── Types ──────────────────────────────────────────────────────────────────

export type GuidedVerdict = "CORRECT" | "INCORRECT";

export interface GuidedCheckResult {
  verdict: GuidedVerdict;
  feedback: string;
  confidence: number;
  error_type: HomeworkAiErrorType;
}

export interface GuidedHintResult {
  hint: string;
}

export interface EvaluateStudentAnswerParams {
  studentAnswer: string;
  taskText: string;
  correctAnswer: string | null;
  solutionSteps: string | null;
  rubricText: string | null;
  subject: string;
  conversationHistory: Array<{ role: string; content: string }>;
  wrongAnswerCount: number;
  hintCount: number;
  availableScore: number;
  maxScore: number;
}

export interface GenerateHintParams {
  taskText: string;
  correctAnswer: string | null;
  solutionSteps: string | null;
  subject: string;
  conversationHistory: Array<{ role: string; content: string }>;
  wrongAnswerCount: number;
  hintCount: number;
}

// ─── Score computation ──────────────────────────────────────────────────────

/**
 * Compute available score after degradation.
 * Formula: maxScore * max(0.5, 1 - 0.1 * (wrongCount + hintCount))
 */
export function computeAvailableScore(
  maxScore: number,
  wrongCount: number,
  hintCount: number,
): number {
  const factor = Math.max(0.5, 1 - 0.1 * (wrongCount + hintCount));
  const raw = maxScore * factor;
  return Math.round(raw * 100) / 100; // round to 2 decimals
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function clampPromptText(text: string | null | undefined): string {
  if (!text) return "";
  return softTruncate(normalizeText(text), MAX_PROMPT_TEXT);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function stripMarkdownWrappers(text: string): string {
  let value = text.trim();
  const fenced = value.match(/^```(?:json|markdown|md|text)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) {
    value = fenced[1].trim();
  }
  value = value.replace(/^["'`]+|["'`]+$/g, "");
  return value.trim();
}

function sanitizeFeedback(text: string, correctAnswer: string | null): string {
  const normalized = normalizeText(stripMarkdownWrappers(text));
  if (!normalized) return SAFE_FEEDBACK_NO_ANSWER;

  let feedback = softTruncate(normalized, MAX_FEEDBACK_LENGTH);

  // Strip correct answer from feedback to prevent leakage
  const normalizedAnswer = normalizeComparable(correctAnswer ?? "");
  if (normalizedAnswer.length >= 2) {
    const normalizedFeedback = normalizeComparable(feedback);
    if (normalizedFeedback.includes(normalizedAnswer)) {
      feedback = SAFE_FEEDBACK_NO_ANSWER;
    }
  }

  return feedback;
}

const HOMEWORK_ERROR_TYPES = new Set<HomeworkAiErrorType>([
  "calculation", "concept", "formatting", "incomplete",
  "factual_error", "weak_argument", "wrong_answer", "partial", "correct",
]);

function sanitizeErrorType(value: unknown, isCorrect: boolean): HomeworkAiErrorType {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase() as HomeworkAiErrorType;
    if (HOMEWORK_ERROR_TYPES.has(normalized)) return normalized;
  }
  return isCorrect ? "correct" : "incomplete";
}

// ─── Check result sanitization ──────────────────────────────────────────────

const CHECK_FALLBACK: GuidedCheckResult = {
  verdict: "INCORRECT",
  confidence: 0.2,
  feedback: "Не удалось проверить автоматически. Попробуй переформулировать ответ.",
  error_type: "incomplete",
};

function sanitizeCheckResult(
  parsed: Record<string, unknown>,
  correctAnswer: string | null,
): GuidedCheckResult {
  // Extract verdict
  const rawVerdict = typeof parsed.verdict === "string"
    ? parsed.verdict.trim().toUpperCase()
    : null;
  const verdict: GuidedVerdict = rawVerdict && VALID_VERDICTS.has(rawVerdict)
    ? (rawVerdict as GuidedVerdict)
    : "INCORRECT";

  // Extract confidence
  const confidenceRaw = toNumber(parsed.confidence);
  const confidence = clamp01(confidenceRaw ?? (verdict === "CORRECT" ? 0.8 : 0.3));

  // Extract and sanitize feedback
  const feedbackRaw = typeof parsed.feedback === "string" ? parsed.feedback : "";
  const feedback = sanitizeFeedback(feedbackRaw, correctAnswer);

  // Extract error_type
  const error_type = sanitizeErrorType(parsed.error_type, verdict === "CORRECT");

  return { verdict, feedback, confidence, error_type };
}

// ─── Prompt builders ────────────────────────────────────────────────────────

function buildCheckPrompt(params: EvaluateStudentAnswerParams): LovableMessage[] {
  const correctAnswerValue = clampPromptText(params.correctAnswer) || "[нет эталонного ответа — оцени по смыслу]";
  const solutionStepsValue = clampPromptText(params.solutionSteps) || "[нет эталонных шагов]";
  const rubricLine = params.rubricText ? `Критерии оценки: ${clampPromptText(params.rubricText)}` : "";

  const systemContent = [
    "Ты проверяешь ответ ученика на задачу по домашнему заданию.",
    `Предмет: ${params.subject}.`,
    `Условие задачи: ${clampPromptText(params.taskText)}`,
    `Эталонный ответ: ${correctAnswerValue}`,
    `Шаги решения: ${solutionStepsValue}`,
    rubricLine,
    "",
    `Статистика: ${params.wrongAnswerCount} неверных попыток, ${params.hintCount} подсказок.`,
    `Доступные баллы: ${params.availableScore} из ${params.maxScore}.`,
    "",
    "Верни ТОЛЬКО валидный JSON без markdown-обёрток и лишнего текста.",
    '{"verdict":"CORRECT"|"INCORRECT","feedback":"...","confidence":0.0-1.0,"error_type":"..."}',
    "",
    "ПРАВИЛА:",
    "- CORRECT только если ответ верный по существу (мелкие неточности оформления допустимы).",
    "- feedback при INCORRECT: короткая подсказка-направление (1-2 предложения). НЕ давай ответ!",
    "- feedback при CORRECT: краткая похвала (1 предложение).",
    "- НЕЛЬЗЯ выдавать правильный ответ в feedback.",
    "- error_type: calculation | concept | formatting | incomplete | factual_error | weak_argument | wrong_answer | partial | correct",
  ].filter(Boolean).join("\n");

  const messages: LovableMessage[] = [
    { role: "system", content: systemContent },
  ];

  // Add conversation context (last messages)
  for (const msg of params.conversationHistory) {
    messages.push({
      role: msg.role === "assistant" ? "assistant" : "user",
      content: typeof msg.content === "string" ? msg.content.slice(0, 2000) : "",
    });
  }

  // Add the current answer
  messages.push({
    role: "user",
    content: `Ответ ученика: ${clampPromptText(params.studentAnswer)}`,
  });

  return messages;
}

function buildHintPrompt(params: GenerateHintParams): LovableMessage[] {
  const systemContent = [
    "Ты репетитор, помогаешь ученику с домашним заданием.",
    `Предмет: ${params.subject}.`,
    `Условие задачи: ${clampPromptText(params.taskText)}`,
    params.correctAnswer ? `Правильный ответ (НЕ раскрывай ученику!): ${clampPromptText(params.correctAnswer)}` : "",
    params.solutionSteps ? `Шаги решения (для справки, НЕ раскрывай!): ${clampPromptText(params.solutionSteps)}` : "",
    "",
    `Ученик уже сделал ${params.wrongAnswerCount} неверных попыток и получил ${params.hintCount} подсказок.`,
    "",
    "Верни ТОЛЬКО валидный JSON без markdown-обёрток:",
    '{"hint":"..."}',
    "",
    "ПРАВИЛА:",
    "- Дай короткую педагогическую подсказку (1-3 предложения).",
    "- Направь ученика к решению, НЕ давай готовый ответ.",
    "- Используй LaTeX ($..$ или $$..$) если нужны формулы.",
    "- Если это не первая подсказка — сделай её чуть более конкретной.",
  ].filter(Boolean).join("\n");

  const messages: LovableMessage[] = [
    { role: "system", content: systemContent },
  ];

  // Add conversation context
  for (const msg of params.conversationHistory) {
    messages.push({
      role: msg.role === "assistant" ? "assistant" : "user",
      content: typeof msg.content === "string" ? msg.content.slice(0, 2000) : "",
    });
  }

  messages.push({
    role: "user",
    content: "Дай подсказку по этой задаче.",
  });

  return messages;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export async function evaluateStudentAnswer(
  params: EvaluateStudentAnswerParams,
): Promise<GuidedCheckResult> {
  console.log("guided_check_start", {
    subject: params.subject,
    wrongAnswerCount: params.wrongAnswerCount,
    hintCount: params.hintCount,
    availableScore: params.availableScore,
    maxScore: params.maxScore,
  });

  try {
    const messages = buildCheckPrompt(params);
    const parsed = await callLovableJson(messages, "guided_check");
    const result = sanitizeCheckResult(parsed, params.correctAnswer);

    console.log("guided_check_success", {
      verdict: result.verdict,
      confidence: result.confidence,
      error_type: result.error_type,
    });

    return result;
  } catch (error) {
    console.error("guided_check_error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { ...CHECK_FALLBACK };
  }
}

export async function generateHint(
  params: GenerateHintParams,
): Promise<GuidedHintResult> {
  console.log("guided_hint_start", {
    subject: params.subject,
    wrongAnswerCount: params.wrongAnswerCount,
    hintCount: params.hintCount,
  });

  try {
    const messages = buildHintPrompt(params);
    const parsed = await callLovableJson(messages, "guided_hint");

    let hint = typeof parsed.hint === "string"
      ? normalizeText(stripMarkdownWrappers(parsed.hint))
      : "";

    if (!hint) {
      hint = "Попробуй разбить задачу на шаги и решить каждый отдельно.";
    }

    // Strip correct answer from hint
    const normalizedAnswer = normalizeComparable(params.correctAnswer ?? "");
    if (normalizedAnswer.length >= 2) {
      const normalizedHint = normalizeComparable(hint);
      if (normalizedHint.includes(normalizedAnswer)) {
        hint = "Попробуй разбить задачу на шаги и решить каждый отдельно.";
      }
    }

    hint = softTruncate(hint, MAX_FEEDBACK_LENGTH);

    console.log("guided_hint_success", { hint_length: hint.length });

    return { hint };
  } catch (error) {
    console.error("guided_hint_error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { hint: "Попробуй перечитать условие задачи и выделить ключевые данные." };
  }
}
