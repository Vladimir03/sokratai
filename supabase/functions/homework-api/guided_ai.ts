/**
 * Phase 3: AI evaluation and hint generation for guided homework chat.
 * Uses the Lovable AI Gateway via shared utilities.
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
} from "./ai_shared.ts";

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_PROMPT_TEXT = 8_000;
const MAX_FEEDBACK_LENGTH = 1_200;
const MAX_PROMPT_IMAGE_BYTES = 5 * 1024 * 1024;
const SAFE_FEEDBACK_NO_ANSWER =
  "Проверь ход решения шаг за шагом и попробуй исправить первую найденную ошибку самостоятельно.";
const CHECK_FAILED_FEEDBACK =
  "Автопроверка сейчас не сработала, но баллы не списаны. Попробуй ещё раз или перейди в режим «Обсудить», и я помогу по шагам.";

const VALID_VERDICTS = new Set(["CORRECT", "INCORRECT", "ON_TRACK"]);
const MIN_HINT_LENGTH = 40;
const FORBIDDEN_HINT_PHRASES: RegExp[] = [
  /перечита(?:й|йте|ть)\s+услов/iu,
  /прочита(?:й|йте|ть)\s+услов/iu,
  /выдел(?:и|ите|ить)\s+ключев/iu,
  /подумай(?:те)?\s+внимательн/iu,
  /вспом(?:ни|ните|нить|инай)\s+материал/iu,
  /что\s+(?:тебе|нам|у\s+тебя|у\s+нас)\s+дано/iu,
  /какие\s+данные\s+у\s+(?:нас|тебя)/iu,
  /обрати\s+внимание\s+на\s+услов/iu,
  /попробуй\s+ещ[её]\s+раз/iu,
];
const FORBIDDEN_HINT_PROMPT_LINES = [
  "«перечитай условие», «прочитай условие»",
  "«выдели ключевые данные»",
  "«подумай внимательнее»",
  "«вспомни материал»",
  "«что тебе дано в задаче», «что нам дано»",
  "«какие данные у нас»",
  "«обрати внимание на условие»",
  "«попробуй ещё раз»",
];
const FALLBACK_PHYSICS_KEYWORDS: Array<{ stem: string; label: string }> = [
  { stem: "брусок", label: "брусок" },
  { stem: "скорост", label: "скорость" },
  { stem: "ускорен", label: "ускорение" },
  { stem: "сил", label: "сила" },
  { stem: "трени", label: "трение" },
  { stem: "масс", label: "масса" },
  { stem: "энерги", label: "энергия" },
  { stem: "импульс", label: "импульс" },
  { stem: "давлен", label: "давление" },
  { stem: "температур", label: "температура" },
  { stem: "заряд", label: "заряд" },
  { stem: "ток", label: "ток" },
  { stem: "цеп", label: "цепь" },
  { stem: "напряжен", label: "напряжение" },
  { stem: "сопротивлен", label: "сопротивление" },
  { stem: "частот", label: "частота" },
  { stem: "период", label: "период" },
  { stem: "работ", label: "работа" },
  { stem: "мощност", label: "мощность" },
  { stem: "поле", label: "поле" },
];
const FALLBACK_STOPWORDS = new Set([
  "задача",
  "условие",
  "найдите",
  "найти",
  "определите",
  "определи",
  "вычислите",
  "вычисли",
  "рассчитайте",
  "рассчитай",
  "докажите",
  "докажи",
  "данные",
  "дано",
  "нужно",
  "также",
  "попробуй",
]);

// ─── Types ──────────────────────────────────────────────────────────────────

export type GuidedVerdict = "CORRECT" | "INCORRECT" | "ON_TRACK" | "CHECK_FAILED";
export type GuidedCheckFailureReason =
  | "timeout"
  | "gateway_error"
  | "invalid_json"
  | "empty_model_response"
  | "image_fetch_failed"
  | "unknown";

interface GuidedConversationHistoryMessage {
  role: string;
  content: string;
  visible_to_student?: boolean;
  message_kind?: string | null;
}

export interface GuidedCheckResult {
  verdict: GuidedVerdict;
  feedback: string;
  confidence: number;
  error_type: HomeworkAiErrorType;
  failure_reason?: GuidedCheckFailureReason;
}

export interface GuidedHintResult {
  hint: string;
}

export interface EvaluateStudentAnswerParams {
  studentAnswer: string;
  taskText: string;
  taskImageUrl: string | null;
  studentImageUrls?: string[] | null;
  taskOcrText?: string | null;
  correctAnswer: string | null;
  rubricText: string | null;
  subject: string;
  conversationHistory: GuidedConversationHistoryMessage[];
  wrongAnswerCount: number;
  hintCount: number;
  availableScore: number;
  maxScore: number;
  checkFormat?: "short_answer" | "detailed_solution";
}

export interface GenerateHintParams {
  taskText: string;
  taskImageUrl: string | null;
  studentImageUrls?: string[] | null;
  taskOcrText?: string | null;
  taskId?: string | null;
  assignmentId?: string | null;
  correctAnswer: string | null;
  subject: string;
  conversationHistory: GuidedConversationHistoryMessage[];
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

export function validateHintContent(text: string): { ok: boolean; reason?: string } {
  const normalized = text.trim();

  for (const rx of FORBIDDEN_HINT_PHRASES) {
    if (rx.test(normalized)) {
      return { ok: false, reason: `forbidden:${rx.source}` };
    }
  }

  if (normalized.length < MIN_HINT_LENGTH) {
    return { ok: false, reason: "too_short" };
  }

  return { ok: true };
}

function pickFallbackKeyword(taskText: string): string | null {
  const normalizedTaskText = normalizeText(taskText);
  const lowercaseTaskText = normalizedTaskText.toLowerCase();

  for (const { stem, label } of FALLBACK_PHYSICS_KEYWORDS) {
    if (lowercaseTaskText.includes(stem)) {
      return label;
    }
  }

  const keywordCandidates = normalizedTaskText.match(/[А-Яа-яA-Za-z]{5,}/gu) ?? [];
  for (const keyword of keywordCandidates) {
    if (!FALLBACK_STOPWORDS.has(keyword.toLowerCase())) {
      return keyword;
    }
  }

  return null;
}

export function buildFallbackHint(
  taskContext: { taskText?: string | null; hasImage?: boolean },
): string {
  const taskText = taskContext.taskText ?? "";
  const keyword = pickFallbackKeyword(taskText);

  if (keyword) {
    return `Сосредоточься на том, что в задаче фигурирует «${keyword}». Какая физическая величина это описывает и какой закон с ней связан?`;
  }

  if (!taskText.trim() && taskContext.hasImage) {
    return "На изображении задачи есть конкретные величины — назови, что именно дано (силы, расстояния, время) и какой закон их связывает.";
  }

  return "Какая физическая величина является искомой в этой задаче и какие данные нужны, чтобы её найти?";
}

function buildValidatedFallbackHint(taskContext: { taskText?: string | null; hasImage?: boolean }): string {
  const fallbackHint = buildFallbackHint(taskContext);
  if (validateHintContent(fallbackHint).ok) {
    return fallbackHint;
  }

  return "Какая физическая величина является искомой в этой задаче и какой закон поможет её найти по известным данным?";
}

function sanitizeHintText(rawHint: unknown, correctAnswer: string | null): string {
  const hint = typeof rawHint === "string"
    ? normalizeText(stripMarkdownWrappers(rawHint))
    : "";

  const normalizedAnswer = normalizeComparable(correctAnswer ?? "");
  if (normalizedAnswer.length >= 2) {
    const normalizedHint = normalizeComparable(hint);
    if (normalizedHint.includes(normalizedAnswer)) {
      return "";
    }
  }

  return softTruncate(hint, MAX_FEEDBACK_LENGTH);
}

function getGeneratedHintCheck(text: string): { ok: boolean; reason?: string } {
  if (!text.trim()) {
    return { ok: false, reason: "empty_after_sanitize" };
  }

  return validateHintContent(text);
}

function reasonToHumanMessage(reason: string | undefined): string {
  if (!reason) return "нарушен формат подсказки";
  if (reason.startsWith("forbidden:")) return "ты использовал запрещённую шаблонную фразу";
  if (reason === "too_short") return "подсказка получилась слишком короткой";
  if (reason === "empty_after_sanitize") return "подсказка оказалась пустой или содержала правильный ответ";
  return "нарушен формат подсказки";
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

async function inlinePromptImageUrls(imageUrls: string[] | null | undefined): Promise<string[]> {
  const normalized = (imageUrls ?? [])
    .map((url) => url.trim())
    .filter(Boolean);

  if (normalized.length === 0) return [];

  const inlined = await Promise.all(normalized.map((url) => inlinePromptImageUrl(url)));
  return inlined.filter((url): url is string => Boolean(url));
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

function normalizeShortAnswerText(raw: string): string {
  return normalizeText(raw)
    .toLowerCase()
    .replace(/[–—−]/g, "-")
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/^[a-zа-я][a-zа-я0-9_]*\s*=\s*/i, "")
    .replace(/[.!?]+$/g, "")
    .trim();
}

/** Known unit aliases: latin/mixed → canonical Cyrillic form */
const UNIT_ALIASES: Array<[RegExp, string]> = [
  // velocity
  [/^m\/s2$/i, "м/с2"],
  [/^m\/s\^2$/i, "м/с2"],
  [/^м\/с2$/i, "м/с2"],
  [/^м\/с\^2$/i, "м/с2"],
  [/^м\/c2$/i, "м/с2"],   // mixed cyrillic м + latin c
  [/^м\/c\^2$/i, "м/с2"],
  [/^m\/s$/i, "м/с"],
  [/^m\/c$/i, "м/с"],     // latin m + cyrillic с
  [/^м\/c$/i, "м/с"],     // cyrillic м + latin c
  // distance
  [/^km\/h$/i, "км/ч"],
  [/^km\/ch$/i, "км/ч"],
  [/^km$/i, "км"],
  [/^cm$/i, "см"],
  [/^mm$/i, "мм"],
  [/^m$/i, "м"],
  // mass / force / energy
  [/^kg$/i, "кг"],
  [/^g$/i, "г"],
  [/^n$/i, "н"],
  [/^j$/i, "дж"],
  [/^w$/i, "вт"],
  [/^pa$/i, "па"],
  // electric
  [/^a$/i, "а"],
  [/^v$/i, "в"],
  // time
  [/^s$/i, "с"],
  [/^sec$/i, "с"],
];

function normalizeUnitToken(raw: string): string {
  const compact = raw.toLowerCase().replace(/\s+/g, "").replace(/²/g, "2");
  for (const [pattern, canonical] of UNIT_ALIASES) {
    if (pattern.test(compact)) return canonical;
  }
  return compact;
}

function stripOptionalOuterPunctuation(raw: string): string {
  return raw.replace(/^[=:\-–—]+/, "").replace(/[=:\-–—]+$/, "").trim();
}

function extractShortAnswerSignature(raw: string): { exact: string; numeric: string | null; unit: string | null } {
  const normalized = stripOptionalOuterPunctuation(normalizeShortAnswerText(raw));
  const compact = normalized.replace(/\s+/g, "");
  const match = compact.match(/^(-?\d+(?:\.\d+)?)([a-zа-я/%°\/^0-9]*)$/iu);
  if (!match) {
    return { exact: compact, numeric: null, unit: null };
  }

  return {
    exact: compact,
    numeric: match[1],
    unit: match[2] ? normalizeUnitToken(match[2]) : null,
  };
}

function shouldUseDeterministicFastPath(studentAnswer: string, correctAnswer: string | null): boolean {
  if (!correctAnswer) return false;
  const student = normalizeShortAnswerText(studentAnswer);
  const correct = normalizeShortAnswerText(correctAnswer);
  if (!student || !correct) return false;
  if (student.includes("\n") || correct.includes("\n")) return false;
  return student.length <= 48 && correct.length <= 48;
}

function tryDeterministicShortAnswerMatch(
  studentAnswer: string,
  correctAnswer: string | null,
): GuidedCheckResult | null {
  if (!shouldUseDeterministicFastPath(studentAnswer, correctAnswer)) {
    return null;
  }

  const student = extractShortAnswerSignature(studentAnswer);
  const correct = extractShortAnswerSignature(correctAnswer ?? "");

  if (student.exact && student.exact === correct.exact) {
    return {
      verdict: "CORRECT",
      feedback: "Верно, это правильный итоговый ответ.",
      confidence: 0.99,
      error_type: "correct",
    };
  }

  if (!student.numeric || !correct.numeric) {
    return null;
  }

  if (student.numeric !== correct.numeric) {
    return null;
  }

  if (student.unit && correct.unit && student.unit !== correct.unit) {
    return null;
  }

  return {
    verdict: "CORRECT",
    feedback: "Верно, это правильный итоговый ответ.",
    confidence: 0.98,
    error_type: "correct",
  };
}

function buildGraphGroundingGuidance(taskOcrText: string | null | undefined, hasTaskImage: boolean): string[] {
  if (!hasTaskImage && !taskOcrText) return [];

  return [
    taskOcrText
      ? `Распознанный текст и факты с изображения задачи (используй как опору, не придумывай данные вне этого текста): ${clampPromptText(taskOcrText)}`
      : "",
    hasTaskImage
      ? "Для графиков и рисунков НЕ придумывай координаты точек, значения на осях, подписи, деления шкалы и промежуточные числа. Если значение нельзя уверенно считать по изображению или OCR, прямо скажи об этом."
      : "",
  ].filter(Boolean);
}

function classifyGuidedCheckFailure(error: unknown): GuidedCheckFailureReason {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (error.name === "AbortError" || message.includes("abort")) return "timeout";
    if (message.includes("http 5") || message.includes("http 4") || message.includes("lovable api returned http")) {
      return "gateway_error";
    }
    if (message.includes("empty")) return "empty_model_response";
    if (message.includes("failed to extract valid json")) return "invalid_json";
    if (message.includes("image")) return "image_fetch_failed";
  }
  return "unknown";
}

// ─── Check result sanitization ──────────────────────────────────────────────

const CHECK_FALLBACK: GuidedCheckResult = {
  verdict: "CHECK_FAILED",
  confidence: 0,
  feedback: CHECK_FAILED_FEEDBACK,
  error_type: "incomplete",
  failure_reason: "unknown",
};

function sanitizeCheckResult(
  parsed: Record<string, unknown>,
  correctAnswer: string | null,
): GuidedCheckResult {
  // Extract verdict
  const rawVerdict = typeof parsed.verdict === "string"
    ? parsed.verdict.trim().toUpperCase()
    : null;
  if (!rawVerdict || !VALID_VERDICTS.has(rawVerdict)) {
    return {
      ...CHECK_FALLBACK,
      failure_reason: "invalid_json",
    };
  }
  const verdict = rawVerdict as Exclude<GuidedVerdict, "CHECK_FAILED">;

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

function buildCheckFormatGuidance(
  checkFormat: "short_answer" | "detailed_solution" | undefined,
  studentAnswer: string,
): string {
  if (checkFormat !== "detailed_solution") return "";

  const lines = [
    "",
    "ФОРМАТ ПРОВЕРКИ: РАЗВЁРНУТОЕ РЕШЕНИЕ.",
    "Ученик ОБЯЗАН показать ход решения (шаги, формулы, рассуждения).",
    "Если ответ содержит только число/слово без хода решения — выстави verdict: INCORRECT",
    "и в feedback попроси ученика показать ход решения.",
    "Не принимай ответ без объяснения шагов.",
  ];

  if (studentAnswer.length < 30) {
    lines.push(
      "ВНИМАНИЕ: ответ ученика очень короткий для развёрнутого решения — скорее всего ход решения отсутствует.",
    );
  }

  return lines.join("\n");
}

function isImageDescriptionRequest(text: string): boolean {
  return /(что\s+(?:ты\s+)?видишь|что\s+на|опиши|что\s+изображен|что\s+изображено).*(?:картинк|изображени|фото|скрин)/i.test(text);
}

function buildPriorHintsSummary(conversationHistory: GuidedConversationHistoryMessage[]): string {
  const priorHints = conversationHistory
    .filter((msg) => msg.role === "assistant" && msg.message_kind === "hint")
    .map((msg) => clampPromptText(msg.content))
    .filter(Boolean);

  if (priorHints.length === 0) {
    return "[нет предыдущих подсказок]";
  }

  return priorHints.join(" | ");
}

function getLatestStudentMessage(conversationHistory: GuidedConversationHistoryMessage[]): string {
  for (let i = conversationHistory.length - 1; i >= 0; i -= 1) {
    const msg = conversationHistory[i];
    if (msg.role !== "user") continue;

    const content = clampPromptText(msg.content);
    if (content) return content;
  }

  return "[ученик ещё не присылал решение]";
}

function buildCheckPrompt(params: EvaluateStudentAnswerParams): LovableMessage[] {
  const correctAnswerValue = clampPromptText(params.correctAnswer) || "[нет эталонного ответа — оцени по смыслу]";
  const rubricLine = params.rubricText ? `Критерии оценки: ${clampPromptText(params.rubricText)}` : "";

  const hasTaskImage = !!params.taskImageUrl;
  const studentImageUrls = (params.studentImageUrls ?? []).filter(Boolean);
  const studentImageCount = studentImageUrls.length;
  const hasStudentImage = studentImageCount > 0;
  const answerTypeGuidance = buildAnswerTypeGuidance(params.correctAnswer, params.taskText);
  const wantsImageDescription = hasStudentImage && isImageDescriptionRequest(params.studentAnswer);
  const graphGroundingGuidance = buildGraphGroundingGuidance(params.taskOcrText, hasTaskImage);
  const checkFormatGuidance = buildCheckFormatGuidance(params.checkFormat, params.studentAnswer);

  const systemContent = [
    "Ты проверяешь ответ ученика на задачу по домашнему заданию.",
    `Предмет: ${params.subject}.`,
    `Условие задачи: ${clampPromptText(params.taskText)}`,
    ...graphGroundingGuidance,
    hasTaskImage ? "К задаче прикреплено изображение с условием — внимательно изучи его." : "",
    hasStudentImage
      ? `Ученик также приложил ${studentImageCount > 1 ? `${studentImageCount} изображения` : "изображение"} со своим решением — используй ${studentImageCount > 1 ? "их" : "его"} при проверке.`
      : "",
    hasStudentImage
      ? "КРИТИЧНО: сначала внимательно изучи решение ученика на приложенном изображении. Если на изображении нет решения по текущей задаче или оно нерелевантно, прямо сообщи об этом в feedback."
      : "",
    wantsImageDescription
      ? "Пользователь явно спрашивает про своё изображение. В начале feedback сначала коротко опиши, что видно именно на изображении ученика, а затем мягко поясни, что это не финальный ответ по задаче, если ответ не завершён."
      : "",
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
    checkFormatGuidance,
  ].filter(Boolean).join("\n");

  const messages: LovableMessage[] = [
    { role: "system", content: systemContent },
  ];

  // Add conversation context (last messages)
  for (const msg of params.conversationHistory) {
    const contentSlice = typeof msg.content === "string" ? msg.content.slice(0, 2000) : "";
    if (!contentSlice) continue;
    if (msg.role === "system" || msg.message_kind === "system") continue;
    if (msg.role === "tutor" && msg.visible_to_student === false) {
      // Hidden tutor note → inject as system instruction for AI
      messages.push({
        role: "system",
        content: `[Инструкция от репетитора]: ${contentSlice}`,
      });
    } else if (msg.role === "assistant" || msg.role === "tutor") {
      messages.push({
        role: "assistant",
        content: contentSlice,
      });
    } else if (msg.role === "user") {
      messages.push({
        role: "user",
        content: contentSlice,
      });
    }
  }

  // Build the user message with optional task image
  const userContent: Array<LovableTextPart | LovableImagePart> = [];

  if (hasStudentImage) {
    let imageCounter = 1;
    for (const [index, imageUrl] of studentImageUrls.entries()) {
      userContent.push({
        type: "text",
        text: !hasTaskImage && studentImageCount === 1
          ? "Изображение выше — рукописное решение ученика."
          : `Изображение ${imageCounter} — решение ученика${studentImageCount > 1 ? `, файл ${index + 1}` : ""}.`,
      });
      userContent.push({
        type: "image_url",
        image_url: { url: imageUrl },
      });
      imageCounter += 1;
    }
  }

  if (hasTaskImage) {
    userContent.push({
      type: "text",
      text: hasStudentImage
        ? `Изображение ${studentImageCount + 1} — условие задачи. Используй его для сверки с решением ученика.`
        : "Изображение выше — условие задачи.",
    });
    userContent.push({
      type: "image_url",
      image_url: { url: params.taskImageUrl as string },
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
  const studentImageUrls = (params.studentImageUrls ?? []).filter(Boolean);
  const studentImageCount = studentImageUrls.length;
  const hasStudentImage = studentImageCount > 0;
  const graphGroundingGuidance = buildGraphGroundingGuidance(params.taskOcrText, hasTaskImage);
  const taskContext = [
    clampPromptText(params.taskText) || "[текст задачи отсутствует, опирайся на изображение задачи]",
    ...graphGroundingGuidance,
    hasTaskImage ? "[к задаче приложено изображение]" : "",
  ].filter(Boolean).join("\n");
  const priorHints = buildPriorHintsSummary(params.conversationHistory);
  const studentLatest = getLatestStudentMessage(params.conversationHistory);

  const systemContent = [
    "Ты — физик-наставник. Ученик просит подсказку по задаче ЕГЭ/ОГЭ.",
    "",
    "УРОВЕНЬ ПОДСКАЗКИ: 1/3",
    "- Level 1 (nudge): одним коротким вопросом направь внимание на ключевую величину или закон",
    "- Level 2 (hint): назови закон/формулу, которые применимы, но не решай за ученика",
    "- Level 3 (big hint): покажи формулу с подстановкой, но не вычисляй финальный ответ",
    "",
    "КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО использовать фразы:",
    ...FORBIDDEN_HINT_PROMPT_LINES.map((line) => `- ${line}`),
    "- любые общие фразы без привязки к физике этой задачи",
    "",
    "ОБЯЗАТЕЛЬНО:",
    "- Упоминай конкретную величину (скорость, ускорение, сила трения, напряжение, ...) или закон (Ньютон, Ом, Кирхгоф, ...) из ЭТОЙ задачи",
    "- Если задача на изображении и текст пустой — опиши что видишь и дай подсказку по видимым величинам",
    "- Если у тебя недостаточно контекста, лучше задай короткий вопрос о конкретной величине, чем используй шаблонную фразу",
    "- Длина: 1-3 предложения, без воды",
    "- Сохрани сократический тон Level 1: мягко направь ученика к следующему шагу, а не решай за него",
    "- Не раскрывай правильный ответ ученику",
    "",
    `КОНТЕКСТ ЗАДАЧИ ({task_text}): ${taskContext}`,
    `ПРЕДЫДУЩИЕ ПОДСКАЗКИ по этой задаче ({prior_hints}): ${priorHints}`,
    `ТЕКУЩЕЕ РЕШЕНИЕ УЧЕНИКА ({student_latest}): ${studentLatest}`,
    hasStudentImage
      ? `Ученик приложил ${studentImageCount > 1 ? `${studentImageCount} изображения` : "изображение"} своего решения — учитывай ${studentImageCount > 1 ? "их" : "его"}, когда даёшь подсказку.`
      : "",
    hasStudentImage
      ? "КРИТИЧНО: сначала внимательно изучи решение ученика на приложенном изображении. Если на нём нет шага решения по текущей задаче, прямо сообщи об этом и попроси прислать релевантное решение."
      : "",
    params.correctAnswer ? `Правильный ответ (НЕ раскрывай ученику!): ${clampPromptText(params.correctAnswer)}` : "",
    "",
    `Статистика: ${params.wrongAnswerCount} неверных попыток, ${params.hintCount} подсказок.`,
    "",
    "Верни ТОЛЬКО валидный JSON без markdown-обёрток:",
    '{"hint":"..."}',
  ].filter(Boolean).join("\n");

  const messages: LovableMessage[] = [
    { role: "system", content: systemContent },
  ];

  // Add conversation context
  for (const msg of params.conversationHistory) {
    const contentSlice = typeof msg.content === "string" ? msg.content.slice(0, 2000) : "";
    if (!contentSlice) continue;
    if (msg.role === "system" || msg.message_kind === "system") continue;
    if (msg.role === "tutor" && msg.visible_to_student === false) {
      // Hidden tutor note → inject as system instruction for AI
      messages.push({
        role: "system",
        content: `[Инструкция от репетитора]: ${contentSlice}`,
      });
    } else if (msg.role === "assistant" || msg.role === "tutor") {
      messages.push({
        role: "assistant",
        content: contentSlice,
      });
    } else if (msg.role === "user") {
      messages.push({
        role: "user",
        content: contentSlice,
      });
    }
  }

  // Build user message with optional task image
  const userContent: Array<LovableTextPart | LovableImagePart> = [];

  if (hasStudentImage) {
    let imageCounter = 1;
    for (const [index, imageUrl] of studentImageUrls.entries()) {
      userContent.push({
        type: "text",
        text: !hasTaskImage && studentImageCount === 1
          ? "Изображение выше — рукописное решение ученика."
          : `Изображение ${imageCounter} — решение ученика${studentImageCount > 1 ? `, файл ${index + 1}` : ""}.`,
      });
      userContent.push({
        type: "image_url",
        image_url: { url: imageUrl },
      });
      imageCounter += 1;
    }
  }

  if (hasTaskImage) {
    userContent.push({
      type: "text",
      text: hasStudentImage
        ? `Изображение ${studentImageCount + 1} — условие задачи. Используй его для сверки с решением ученика.`
        : "Изображение выше — условие задачи.",
    });
    userContent.push({
      type: "image_url",
      image_url: { url: params.taskImageUrl as string },
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

  // Skip deterministic fast path for detailed_solution — AI must enforce format
  if (params.checkFormat !== "detailed_solution") {
    const deterministicMatch = tryDeterministicShortAnswerMatch(
      params.studentAnswer,
      params.correctAnswer,
    );
    if (deterministicMatch) {
      console.log("guided_check_fast_path_match", {
        subject: params.subject,
        confidence: deterministicMatch.confidence,
      });
      return deterministicMatch;
    }
  }

  try {
    const [taskImageUrl, studentImageUrls] = await Promise.all([
      inlinePromptImageUrl(params.taskImageUrl),
      inlinePromptImageUrls(params.studentImageUrls),
    ]);
    const messages = buildCheckPrompt({
      ...params,
      taskImageUrl,
      studentImageUrls,
    });
    const parsed = await callLovableJson(messages, "guided_check");
    const result = sanitizeCheckResult(parsed, params.correctAnswer);

    if (result.verdict === "CHECK_FAILED") {
      console.warn("guided_check_invalid_payload", {
        subject: params.subject,
        failure_reason: result.failure_reason ?? "invalid_json",
      });
    }

    console.log("guided_check_success", {
      verdict: result.verdict,
      confidence: result.confidence,
      error_type: result.error_type,
    });

    return result;
  } catch (error) {
    const failure_reason = classifyGuidedCheckFailure(error);
    console.error("guided_check_error", {
      error: error instanceof Error ? error.message : String(error),
      failure_reason,
    });
    return {
      ...CHECK_FALLBACK,
      failure_reason,
    };
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

  let resolvedTaskImageUrl: string | null = null;
  const telemetryMeta = {
    task_id: params.taskId ?? null,
    assignment_id: params.assignmentId ?? null,
  };

  try {
    const [taskImageUrl, studentImageUrls] = await Promise.all([
      inlinePromptImageUrl(params.taskImageUrl),
      inlinePromptImageUrls(params.studentImageUrls),
    ]);
    resolvedTaskImageUrl = taskImageUrl;
    const messages = buildHintPrompt({
      ...params,
      taskImageUrl,
      studentImageUrls,
    });
    const parsed = await callLovableJson(messages, "guided_hint");
    const firstHint = sanitizeHintText(parsed.hint, params.correctAnswer);
    const firstCheck = getGeneratedHintCheck(firstHint);

    if (firstCheck.ok) {
      console.log("guided_hint_success", { hint_length: firstHint.length, attempt: 1 });
      return { hint: firstHint };
    }

    console.warn(JSON.stringify({
      event: "hint_rejected",
      reason: firstCheck.reason ?? null,
      retry: 1,
      ...telemetryMeta,
    }));

    const retryMessages: LovableMessage[] = [...messages];
    if (firstHint.trim()) {
      retryMessages.push({
        role: "assistant",
        content: firstHint,
      });
    }
    retryMessages.push({
      role: "user",
      content:
        `Предыдущая версия подсказки не подходит: ${reasonToHumanMessage(firstCheck.reason)}. ` +
        "Перепиши подсказку так, чтобы она явно упоминала конкретную физическую величину или закон из этой задачи. " +
        "1-3 предложения, без общих фраз и без правильного ответа.",
    });

    const retryParsed = await callLovableJson(retryMessages, "guided_hint");
    const secondHint = sanitizeHintText(retryParsed.hint, params.correctAnswer);
    const secondCheck = getGeneratedHintCheck(secondHint);

    if (secondCheck.ok) {
      console.log("guided_hint_success", { hint_length: secondHint.length, attempt: 2 });
      return { hint: secondHint };
    }

    console.warn(JSON.stringify({
      event: "hint_rejected",
      reason: secondCheck.reason ?? null,
      retry: 2,
      ...telemetryMeta,
    }));

    const fallbackHint = buildValidatedFallbackHint({
      taskText: params.taskText,
      hasImage: Boolean(resolvedTaskImageUrl),
    });

    console.warn(JSON.stringify({
      event: "hint_fallback_used",
      reason: "retry_invalid",
      ...telemetryMeta,
    }));

    return { hint: fallbackHint };
  } catch (error) {
    const fallbackHint = buildValidatedFallbackHint({
      taskText: params.taskText,
      hasImage: Boolean(resolvedTaskImageUrl),
    });

    console.warn(JSON.stringify({
      event: "hint_fallback_used",
      reason: "exception",
      ...telemetryMeta,
    }));

    console.error("guided_hint_error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { hint: fallbackHint };
  }
}
