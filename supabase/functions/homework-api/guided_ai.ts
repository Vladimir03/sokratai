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
  type LovableImagePart,
  type LovableMessage,
  type LovableMessageContent,
  type LovableTextPart,
} from "./vision_checker.ts";

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_PROMPT_TEXT = 8_000;
const MAX_FEEDBACK_LENGTH = 1_200;
const MAX_PROMPT_IMAGE_BYTES = 5 * 1024 * 1024;
const SAFE_FEEDBACK_NO_ANSWER =
  "Проверь ход решения шаг за шагом и попробуй исправить первую найденную ошибку самостоятельно.";

const VALID_VERDICTS = new Set(["CORRECT", "INCORRECT", "ON_TRACK"]);

// ─── Types ──────────────────────────────────────────────────────────────────

export type GuidedVerdict = "CORRECT" | "INCORRECT" | "ON_TRACK";

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
  taskImageUrl: string | null;
  studentImageUrl?: string | null;
  correctAnswer: string | null;
  rubricText: string | null;
  subject: string;
  conversationHistory: Array<{ role: string; content: string; visible_to_student?: boolean }>;
  wrongAnswerCount: number;
  hintCount: number;
  availableScore: number;
  maxScore: number;
}

export interface GenerateHintParams {
  taskText: string;
  taskImageUrl: string | null;
  studentImageUrl?: string | null;
  correctAnswer: string | null;
  subject: string;
  conversationHistory: Array<{ role: string; content: string; visible_to_student?: boolean }>;
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

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(binary);
}

function isAllowedSignedStorageUrl(url: string): boolean {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  return Boolean(
    supabaseUrl &&
    url.startsWith(`${supabaseUrl}/storage/v1/object/sign/`),
  );
}

async function inlinePromptImageUrl(imageUrl: string | null | undefined): Promise<string | null> {
  if (!imageUrl) return null;
  const trimmed = imageUrl.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("data:")) return trimmed;

  if (!trimmed.startsWith("https://") || !isAllowedSignedStorageUrl(trimmed)) {
    console.warn("guided_ai_inline_image_skipped", {
      reason: "unsupported_url",
      preview: trimmed.slice(0, 120),
    });
    return null;
  }

  try {
    const response = await fetch(trimmed);
    if (!response.ok) {
      console.error("guided_ai_inline_image_failed", {
        status: response.status,
        preview: trimmed.slice(0, 120),
      });
      return null;
    }

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_PROMPT_IMAGE_BYTES) {
      console.error("guided_ai_inline_image_too_large", {
        bytes: buffer.byteLength,
        maxBytes: MAX_PROMPT_IMAGE_BYTES,
      });
      return null;
    }

    const mime = response.headers.get("content-type") || "image/jpeg";
    return `data:${mime};base64,${arrayBufferToBase64(buffer)}`;
  } catch (error) {
    console.error("guided_ai_inline_image_failed", {
      error: error instanceof Error ? error.message : String(error),
      preview: trimmed.slice(0, 120),
    });
    return null;
  }
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

function sanitizeErrorType(value: unknown, verdict: GuidedVerdict): HomeworkAiErrorType {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase() as HomeworkAiErrorType;
    if (HOMEWORK_ERROR_TYPES.has(normalized)) return normalized;
  }
  return verdict === "CORRECT" ? "correct" : "incomplete";
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
  const defaultConfidence = verdict === "CORRECT" ? 0.8 : verdict === "ON_TRACK" ? 0.6 : 0.3;
  const confidence = clamp01(confidenceRaw ?? defaultConfidence);

  // Extract and sanitize feedback
  const feedbackRaw = typeof parsed.feedback === "string" ? parsed.feedback : "";
  const feedback = sanitizeFeedback(feedbackRaw, correctAnswer);

  // Extract error_type
  const error_type = sanitizeErrorType(parsed.error_type, verdict);

  return { verdict, feedback, confidence, error_type };
}

// ─── Prompt builders ────────────────────────────────────────────────────────

/**
 * Detect if the task expects a specific numeric/short answer (vs. essay/conceptual).
 * Returns extra prompt guidance when a concrete value is expected.
 */
function buildAnswerTypeGuidance(correctAnswer: string | null, taskText: string): string {
  // Check if task text asks for a specific value (works even without correctAnswer)
  const askingForValue = /(?:определи|найди|вычисли|рассчитай|чему равн|какова|каков|сколько|найти|определить|вычислить|рассчитать)/i.test(taskText);

  // Check if correct answer looks like a specific numeric/short value
  let answerLooksNumeric = false;
  if (correctAnswer) {
    const trimmed = correctAnswer.trim();
    const hasNumber = /\d/.test(trimmed);
    const isShort = trimmed.length < 100;
    // Common Russian units (physics, math, chemistry)
    const hasUnits = /(?:м\/с|м\/с²|км\/ч|кг|Н|Дж|Вт|Гц|Па|моль|А|В|Ом|л|мл|см|мм|км|°C|%)/i.test(trimmed);
    answerLooksNumeric = (hasNumber && isShort) || hasUnits;
  }

  if (answerLooksNumeric || askingForValue) {
    return [
      "",
      "ВАЖНО: Эта задача требует КОНКРЕТНОГО числового/фактического ответа.",
      "Формула без подставленных значений и итогового числа — это ON_TRACK, не CORRECT.",
    ].join("\n");
  }
  return "";
}

function buildCheckPrompt(params: EvaluateStudentAnswerParams): LovableMessage[] {
  const correctAnswerValue = clampPromptText(params.correctAnswer) || "[нет эталонного ответа — оцени по смыслу]";
  const rubricLine = params.rubricText ? `Критерии оценки: ${clampPromptText(params.rubricText)}` : "";

  const hasTaskImage = !!params.taskImageUrl;
  const hasStudentImage = !!params.studentImageUrl;
  const answerTypeGuidance = buildAnswerTypeGuidance(params.correctAnswer, params.taskText);

  const systemContent = [
    "Ты проверяешь ответ ученика на задачу по домашнему заданию.",
    `Предмет: ${params.subject}.`,
    `Условие задачи: ${clampPromptText(params.taskText)}`,
    hasTaskImage ? "К задаче прикреплено изображение с условием — внимательно изучи его." : "",
    hasStudentImage ? "Ученик также приложил изображение со своим рукописным решением — используй его при проверке." : "",
    `Эталонный ответ: ${correctAnswerValue}`,
    rubricLine,
    "",
    `Статистика: ${params.wrongAnswerCount} неверных попыток, ${params.hintCount} подсказок.`,
    `Доступные баллы: ${params.availableScore} из ${params.maxScore}.`,
    "",
    "Верни ТОЛЬКО валидный JSON без markdown-обёрток и лишнего текста.",
    '{"verdict":"CORRECT"|"ON_TRACK"|"INCORRECT","feedback":"...","confidence":0.0-1.0,"error_type":"..."}',
    "",
    "ПРАВИЛА ОЦЕНКИ:",
    "",
    "Перед вынесением вердикта оцени ответ по ЧЕТЫРЁМ критериям:",
    "1. Ответ относится к вопросу задачи? (а не к другой теме/величине)",
    "2. Это финальный ответ или промежуточный шаг (формула, определение, часть решения)?",
    "3. Формат ответа соответствует задаче (число с единицами, все пункты, и т.д.)?",
    "4. Итоговый результат верный?",
    "",
    "Вердикты:",
    "- CORRECT: ВСЕ 4 критерия выполнены. Ученик дал правильный финальный ответ на вопрос задачи.",
    "  Мелкие неточности оформления допустимы (единицы записаны иначе, промежуточные шаги опущены).",
    "- ON_TRACK: Шаг верный (правильная формула, верное рассуждение), но это НЕ финальный ответ на вопрос.",
    "  Используй когда ученик на верном пути, но не довёл решение до конца.",
    "- INCORRECT: Ответ неверный, не по теме, или содержит ошибку.",
    "",
    "Правила feedback:",
    "- При CORRECT: краткая похвала (1 предложение).",
    "- При ON_TRACK: похвали верный шаг и направь к завершению.",
    '  Пример: "Формула верна! Теперь подставь значения и вычисли итоговый ответ."',
    "- При INCORRECT: короткая подсказка-направление (1-2 предложения). НЕ давай ответ!",
    "- Если ответ не на тот вопрос: объясни какую величину просит задача.",
    "- НЕЛЬЗЯ выдавать правильный ответ в feedback.",
    "- error_type: calculation | concept | formatting | incomplete | factual_error | weak_argument | wrong_answer | partial | correct",
    answerTypeGuidance,
  ].filter(Boolean).join("\n");

  const messages: LovableMessage[] = [
    { role: "system", content: systemContent },
  ];

  // Add conversation context (last messages)
  for (const msg of params.conversationHistory) {
    const contentSlice = typeof msg.content === "string" ? msg.content.slice(0, 2000) : "";
    if (msg.role === "tutor" && msg.visible_to_student === false) {
      // Hidden tutor note → inject as system instruction for AI
      messages.push({
        role: "system",
        content: `[Инструкция от репетитора]: ${contentSlice}`,
      });
    } else {
      messages.push({
        role: msg.role === "assistant" || msg.role === "tutor" ? "assistant" : "user",
        content: contentSlice,
      });
    }
  }

  // Build the user message with optional task image
  const userContent: Array<LovableTextPart | LovableImagePart> = [];

  if (hasTaskImage) {
    userContent.push({
      type: "text",
      text: hasStudentImage ? "Изображение 1 — условие задачи." : "Изображение выше — условие задачи.",
    });
    userContent.push({
      type: "image_url",
      image_url: { url: params.taskImageUrl as string },
    });
  }

  if (hasStudentImage) {
    userContent.push({
      type: "text",
      text: hasTaskImage
        ? "Изображение 2 — рукописное решение ученика."
        : "Изображение выше — рукописное решение ученика.",
    });
    userContent.push({
      type: "image_url",
      image_url: { url: params.studentImageUrl as string },
    });
  }

  userContent.push({
    type: "text",
    text: `Текстовый ответ ученика: ${clampPromptText(params.studentAnswer)}`,
  });

  messages.push({
    role: "user",
    content: userContent,
  });

  return messages;
}

function buildHintPrompt(params: GenerateHintParams): LovableMessage[] {
  const hasTaskImage = !!params.taskImageUrl;
  const hasStudentImage = !!params.studentImageUrl;

  const systemContent = [
    "Ты репетитор, помогаешь ученику с домашним заданием.",
    `Предмет: ${params.subject}.`,
    `Условие задачи: ${clampPromptText(params.taskText)}`,
    hasTaskImage ? "К задаче прикреплено изображение с условием — внимательно изучи его." : "",
    hasStudentImage ? "Ученик приложил изображение своего решения — учитывай его, когда даёшь подсказку." : "",
    params.correctAnswer ? `Правильный ответ (НЕ раскрывай ученику!): ${clampPromptText(params.correctAnswer)}` : "",
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
    const contentSlice = typeof msg.content === "string" ? msg.content.slice(0, 2000) : "";
    if (msg.role === "tutor" && msg.visible_to_student === false) {
      // Hidden tutor note → inject as system instruction for AI
      messages.push({
        role: "system",
        content: `[Инструкция от репетитора]: ${contentSlice}`,
      });
    } else {
      messages.push({
        role: msg.role === "assistant" || msg.role === "tutor" ? "assistant" : "user",
        content: contentSlice,
      });
    }
  }

  // Build user message with optional task image
  const userContent: Array<LovableTextPart | LovableImagePart> = [];

  if (hasTaskImage) {
    userContent.push({
      type: "text",
      text: hasStudentImage ? "Изображение 1 — условие задачи." : "Изображение выше — условие задачи.",
    });
    userContent.push({
      type: "image_url",
      image_url: { url: params.taskImageUrl as string },
    });
  }

  if (hasStudentImage) {
    userContent.push({
      type: "text",
      text: hasTaskImage
        ? "Изображение 2 — рукописное решение ученика."
        : "Изображение выше — рукописное решение ученика.",
    });
    userContent.push({
      type: "image_url",
      image_url: { url: params.studentImageUrl as string },
    });
  }

  userContent.push({
    type: "text",
    text: hasStudentImage
      ? "Дай короткую подсказку по этой задаче с учетом решения ученика на изображении."
      : "Дай подсказку по этой задаче.",
  });

  messages.push({
    role: "user",
    content: userContent,
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
    const [taskImageUrl, studentImageUrl] = await Promise.all([
      inlinePromptImageUrl(params.taskImageUrl),
      inlinePromptImageUrl(params.studentImageUrl),
    ]);
    const messages = buildCheckPrompt({
      ...params,
      taskImageUrl,
      studentImageUrl,
    });
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
    const [taskImageUrl, studentImageUrl] = await Promise.all([
      inlinePromptImageUrl(params.taskImageUrl),
      inlinePromptImageUrl(params.studentImageUrl),
    ]);
    const messages = buildHintPrompt({
      ...params,
      taskImageUrl,
      studentImageUrl,
    });
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
