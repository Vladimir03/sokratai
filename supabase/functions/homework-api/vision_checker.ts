export type HomeworkSubject = "math" | "physics" | "history" | "social" | "english" | "cs";

export type HomeworkAiErrorType =
  | "calculation"
  | "concept"
  | "formatting"
  | "incomplete"
  | "factual_error"
  | "weak_argument"
  | "wrong_answer"
  | "partial"
  | "correct";

export interface RecognizeHomeworkPhotoResult {
  recognized_text: string;
  confidence: number;
  has_formulas: boolean;
}

export interface CheckHomeworkAnswerResult {
  is_correct: boolean;
  confidence: number;
  score: number;
  feedback: string;
  error_type: HomeworkAiErrorType;
}

export interface VisionCheckerOptions {
  strict?: boolean;
  rubricText?: string | null;
}

type LovableMessageRole = "system" | "user" | "assistant";

interface LovableTextPart {
  type: "text";
  text: string;
}

interface LovableImagePart {
  type: "image_url";
  image_url: {
    url: string;
  };
}

type LovableMessageContent = string | Array<LovableTextPart | LovableImagePart>;

interface LovableMessage {
  role: LovableMessageRole;
  content: LovableMessageContent;
}

const LOVABLE_API_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const LOVABLE_MODEL = "google/gemini-3-flash-preview";
const REQUEST_TIMEOUT_MS = 35_000;
const MAX_RETRIES = 1;
const MAX_RECOGNIZED_TEXT = 10_000;
const MAX_FEEDBACK_LENGTH = 1_200;
const MAX_PROMPT_TEXT = 8_000;

const RECOGNIZE_FALLBACK: RecognizeHomeworkPhotoResult = {
  recognized_text: "[неразборчиво]",
  confidence: 0.1,
  has_formulas: false,
};

const CHECK_FALLBACK: CheckHomeworkAnswerResult = {
  is_correct: false,
  confidence: 0.2,
  score: 0,
  feedback: "Не удалось проверить автоматически. Проверь фото и попробуй ещё раз.",
  error_type: "incomplete",
};

const HOMEWORK_ERROR_TYPES: HomeworkAiErrorType[] = [
  "calculation",
  "concept",
  "formatting",
  "incomplete",
  "factual_error",
  "weak_argument",
  "wrong_answer",
  "partial",
  "correct",
];

const HOMEWORK_ERROR_TYPE_SET = new Set<HomeworkAiErrorType>(HOMEWORK_ERROR_TYPES);

const SAFE_FEEDBACK_NO_ANSWER =
  "Проверь ход решения шаг за шагом и попробуй исправить первую найденную ошибку самостоятельно.";

class HttpStatusError extends Error {
  public readonly status: number;
  public readonly responseText: string;

  constructor(status: number, responseText: string) {
    super(`Lovable API returned HTTP ${status}`);
    this.name = "HttpStatusError";
    this.status = status;
    this.responseText = responseText;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function softTruncate(value: string, maxLen: number): string {
  if (value.length <= maxLen) return value;
  const slice = value.slice(0, maxLen);
  const lastSpaceIdx = slice.lastIndexOf(" ");
  const safeSlice = lastSpaceIdx > maxLen * 0.8 ? slice.slice(0, lastSpaceIdx) : slice;
  return `${safeSlice.trim()}\n...[обрезано]`;
}

function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function normalizeComparable(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[.,!?;:()[\]{}"'`]/g, "");
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    if (lowered === "true") return true;
    if (lowered === "false") return false;
  }
  return fallback;
}

function extractMessageContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  const parts = content
    .map((entry) => {
      if (isRecord(entry) && typeof entry.text === "string") {
        return entry.text;
      }
      return "";
    })
    .filter(Boolean);

  return parts.join("\n").trim();
}

function tryParseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function extractJsonObject(raw: string): Record<string, unknown> {
  const normalized = raw.trim();

  const direct = tryParseJsonObject(normalized);
  if (direct) {
    return direct;
  }

  const fencedMatch = normalized.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch?.[1]) {
    const parsedFence = tryParseJsonObject(fencedMatch[1].trim());
    if (parsedFence) {
      return parsedFence;
    }
  }

  const firstBrace = normalized.indexOf("{");
  const lastBrace = normalized.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const betweenBraces = normalized.slice(firstBrace, lastBrace + 1);
    const parsedBetween = tryParseJsonObject(betweenBraces);
    if (parsedBetween) {
      return parsedBetween;
    }
  }

  throw new Error("Failed to extract valid JSON object from model response");
}

function sanitizeRecognizedText(text: string): string {
  const normalized = normalizeText(text);
  if (!normalized) {
    return "[неразборчиво]";
  }
  return softTruncate(normalized, MAX_RECOGNIZED_TEXT);
}

function inferHasFormulas(text: string): boolean {
  const formulaPatterns = [
    /\\frac\b/,
    /\\sqrt\b/,
    /\\sum\b/,
    /\\int\b/,
    /\\[a-zA-Z]{2,}/,
    /[A-Za-zА-Яа-я]\s*\^\s*\{?[-\d]+/,
    /[A-Za-zА-Яа-я]\s*_\s*\{?[-\d]+/,
    /[=<>±÷×]/,
  ];

  let matches = 0;
  for (const pattern of formulaPatterns) {
    if (pattern.test(text)) {
      matches += 1;
    }
  }

  return matches >= 2;
}

function sanitizeRecognizeResult(parsed: Record<string, unknown>): RecognizeHomeworkPhotoResult {
  const recognizedRaw = typeof parsed.recognized_text === "string" ? parsed.recognized_text : "";
  const recognized_text = sanitizeRecognizedText(recognizedRaw);

  const confidenceRaw = toNumber(parsed.confidence);
  const confidence = clamp01(confidenceRaw ?? 0.1);

  const hasFormulasRaw = parsed.has_formulas;
  const has_formulas = typeof hasFormulasRaw === "boolean" ? hasFormulasRaw : inferHasFormulas(recognized_text);

  return {
    recognized_text,
    confidence,
    has_formulas,
  };
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

function sanitizeFeedback(text: string): string {
  const normalized = normalizeText(stripMarkdownWrappers(text));
  if (!normalized) {
    return CHECK_FALLBACK.feedback;
  }
  return softTruncate(normalized, MAX_FEEDBACK_LENGTH);
}

function sanitizeErrorType(value: unknown, isCorrect: boolean): HomeworkAiErrorType {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase() as HomeworkAiErrorType;
    if (HOMEWORK_ERROR_TYPE_SET.has(normalized)) {
      return normalized;
    }
  }
  return isCorrect ? "correct" : "incomplete";
}

function sanitizeCheckResult(parsed: Record<string, unknown>, correctAnswer: string | null): CheckHomeworkAnswerResult {
  const is_correct = toBoolean(parsed.is_correct, false);

  const confidenceRaw = toNumber(parsed.confidence);
  const confidence = clamp01(confidenceRaw ?? (is_correct ? 0.8 : 0.3));

  const scoreRaw = toNumber(parsed.score);
  const scoreCandidate = clamp01(scoreRaw ?? (is_correct ? 1 : 0));
  const score = scoreCandidate >= 0.5 ? 1 : 0;

  let feedback = sanitizeFeedback(typeof parsed.feedback === "string" ? parsed.feedback : "");
  const normalizedAnswer = normalizeComparable(correctAnswer ?? "");
  if (normalizedAnswer.length >= 2) {
    const normalizedFeedback = normalizeComparable(feedback);
    if (normalizedFeedback.includes(normalizedAnswer)) {
      feedback = SAFE_FEEDBACK_NO_ANSWER;
    }
  }

  const error_type = sanitizeErrorType(parsed.error_type, is_correct);

  return {
    is_correct,
    confidence,
    score,
    feedback,
    error_type,
  };
}

function shouldRetry(error: unknown): boolean {
  if (error instanceof HttpStatusError) {
    return error.status >= 500;
  }
  if (error instanceof Error) {
    if (error.name === "AbortError") return true;
    if (error.name === "TypeError") return true;
  }
  return false;
}

async function callLovableJson(messages: LovableMessage[], telemetryTag: string): Promise<Record<string, unknown>> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) {
    throw new Error("LOVABLE_API_KEY is not configured");
  }

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(LOVABLE_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: LOVABLE_MODEL,
          messages,
          temperature: 0.2,
          stream: false,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new HttpStatusError(response.status, errorText);
      }

      const payload = await response.json();
      const messageContent = payload?.choices?.[0]?.message?.content;
      const rawContent = extractMessageContent(messageContent);

      if (!rawContent) {
        throw new Error("Model response is empty");
      }

      return extractJsonObject(rawContent);
    } catch (error) {
      const canRetry = shouldRetry(error) && attempt < MAX_RETRIES;
      if (canRetry) {
        const errorMessage = error instanceof Error ? error.message : "unknown error";
        console.warn(`${telemetryTag}_retry`, {
          attempt: attempt + 1,
          max_retries: MAX_RETRIES,
          error: errorMessage,
        });
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw new Error("Unexpected retry loop termination");
}

function clampPromptText(text: string | null | undefined): string {
  if (!text) return "";
  return softTruncate(normalizeText(text), MAX_PROMPT_TEXT);
}

function buildRecognizePrompt(subject: HomeworkSubject): LovableMessage[] {
  return [
    {
      role: "system",
      content: [
        "Ты OCR/vision-модуль для проверки школьной домашки.",
        "Верни ТОЛЬКО валидный JSON без markdown и без пояснений.",
        'Формат: {"recognized_text":"...","confidence":0.0,"has_formulas":false}',
        "Если часть текста не читается, вставляй маркер [неразборчиво].",
        "Если есть формулы, сохраняй их в LaTeX (без лишних $$).",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: [
            `subject: ${subject}`,
            `Ограничение recognized_text: до ${MAX_RECOGNIZED_TEXT} символов с мягким усечением.`,
            "Верни строго JSON-объект с ключами recognized_text, confidence, has_formulas.",
          ].join("\n"),
        },
      ],
    },
  ];
}

function buildCheckPrompt(
  recognizedText: string,
  taskText: string,
  correctAnswer: string | null,
  solutionSteps: string | null,
  subject: HomeworkSubject,
  rubricText?: string | null,
): LovableMessage[] {
  const correctAnswerValue = clampPromptText(correctAnswer) || "[нет эталонного ответа]";
  const solutionStepsValue = clampPromptText(solutionSteps) || "[нет эталонных шагов]";
  const rubricLine = rubricText ? `rubric_criteria: ${clampPromptText(rubricText)}` : null;

  return [
    {
      role: "system",
      content: [
        "Ты проверяешь домашние задания учеников.",
        "Верни ТОЛЬКО валидный JSON без markdown и лишнего текста.",
        'Формат: {"is_correct":boolean,"confidence":0..1,"score":0|1,"feedback":"...","error_type":"..."}',
        "НЕЛЬЗЯ выдавать готовый правильный ответ в feedback.",
        "Feedback должен быть в стиле короткой подсказки-направления.",
        rubricLine ? "Если предоставлена rubric_criteria — используй её как основной критерий оценки." : "",
        `Допустимые error_type: ${HOMEWORK_ERROR_TYPES.join(", ")}.`,
      ].filter(Boolean).join("\n"),
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: [
            `subject: ${subject}`,
            `task_text: ${clampPromptText(taskText)}`,
            `recognized_text: ${clampPromptText(recognizedText)}`,
            `correct_answer: ${correctAnswerValue}`,
            `solution_steps: ${solutionStepsValue}`,
            rubricLine,
            "В ответе score используй только 0 или 1.",
            "Верни строго JSON-объект с ключами is_correct, confidence, score, feedback, error_type.",
          ].filter(Boolean).join("\n\n"),
        },
      ],
    },
  ];
}

export async function recognizeHomeworkPhoto(
  imageBase64: string,
  subject: HomeworkSubject,
  options: VisionCheckerOptions = {},
): Promise<RecognizeHomeworkPhotoResult> {
  const strict = options.strict === true;
  console.log("homework_vision_recognize_start", { subject, strict });

  try {
    const trimmedBase64 = imageBase64.replace(/^data:[^,]+,/, "").trim();
    if (!trimmedBase64) {
      throw new Error("imageBase64 is empty");
    }

    const messages = buildRecognizePrompt(subject);
    const userMessage = messages[1];
    if (Array.isArray(userMessage.content)) {
      userMessage.content.push({
        type: "image_url",
        image_url: {
          url: `data:image/jpeg;base64,${trimmedBase64}`,
        },
      });
    }

    const parsed = await callLovableJson(messages, "homework_vision_recognize");
    const result = sanitizeRecognizeResult(parsed);

    console.log("homework_vision_recognize_success", {
      subject,
      strict,
      confidence: result.confidence,
      recognized_length: result.recognized_text.length,
      has_formulas: result.has_formulas,
    });

    return result;
  } catch (error) {
    console.error("homework_vision_recognize_error", {
      subject,
      strict,
      error: error instanceof Error ? error.message : String(error),
    });
    if (strict) {
      throw error;
    }
    return { ...RECOGNIZE_FALLBACK };
  }
}

export async function checkHomeworkAnswer(
  recognizedText: string,
  taskText: string,
  correctAnswer: string | null,
  solutionSteps: string | null,
  subject: HomeworkSubject,
  options: VisionCheckerOptions = {},
): Promise<CheckHomeworkAnswerResult> {
  const strict = options.strict === true;
  console.log("homework_vision_check_start", { subject, strict, has_rubric: !!options.rubricText });

  try {
    const messages = buildCheckPrompt(recognizedText, taskText, correctAnswer, solutionSteps, subject, options.rubricText);
    const parsed = await callLovableJson(messages, "homework_vision_check");
    const result = sanitizeCheckResult(parsed, correctAnswer);

    console.log("homework_vision_check_success", {
      subject,
      strict,
      is_correct: result.is_correct,
      confidence: result.confidence,
      error_type: result.error_type,
    });

    return result;
  } catch (error) {
    console.error("homework_vision_check_error", {
      subject,
      strict,
      error: error instanceof Error ? error.message : String(error),
    });
    if (strict) {
      throw error;
    }
    return { ...CHECK_FALLBACK };
  }
}
