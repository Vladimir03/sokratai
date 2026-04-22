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
import {
  MAX_GUIDED_CHAT_IMAGES_FOR_AI,
  MAX_TASK_IMAGES_FOR_AI,
} from "../_shared/attachment-refs.ts";

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_PROMPT_TEXT = 8_000;
const MAX_FEEDBACK_LENGTH = 1_200;
const MAX_SCORE_COMMENT_LENGTH = 280;
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
  | "task_image_missing"
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
  ai_score: number | null;
  ai_score_comment: string | null;
  failure_reason?: GuidedCheckFailureReason;
}

export interface GuidedHintResult {
  hint: string;
}

export interface EvaluateStudentAnswerParams {
  studentAnswer: string;
  taskText: string;
  taskImageUrls: string[];
  studentImageUrls?: string[] | null;
  taskOcrText?: string | null;
  correctAnswer: string | null;
  rubricText: string | null;
  rubricImageUrls?: string[] | null;
  /**
   * Эталонное решение репетитора (текст). Единое поле "Решение для AI" —
   * используется как reference для сверки логики ученика. См. plan wild-swinging-nova.md.
   * НИКОГДА не цитируется дословно (anti-spoiler контракт в промпте).
   */
  solutionText?: string | null;
  /** Эталонное решение (фото). До 5. Inline-ятся в base64 через inlinePromptImageUrls. */
  solutionImageUrls?: string[] | null;
  subject: string;
  conversationHistory: GuidedConversationHistoryMessage[];
  wrongAnswerCount: number;
  hintCount: number;
  availableScore: number;
  maxScore: number;
  checkFormat?: "short_answer" | "detailed_solution";
  /**
   * Tutor-curated student display name. When present, AI is instructed to
   * use it occasionally and apply grammatically correct gender forms based
   * on the name. Null / empty → AI falls back to gender-neutral forms.
   * Source: homework-api resolveStudentDisplayName (tutor_students.display_name
   * → profiles.username, skipping auto-generated placeholders).
   */
  studentName?: string | null;
}

export interface GenerateHintParams {
  taskText: string;
  taskImageUrls: string[];
  studentImageUrls?: string[] | null;
  taskOcrText?: string | null;
  taskId?: string | null;
  assignmentId?: string | null;
  correctAnswer: string | null;
  /** Критерии оценки репетитора (текст). Опциональное усиление. */
  rubricText?: string | null;
  /** Рубрика (фото). Опционально. */
  rubricImageUrls?: string[] | null;
  /** Эталонное решение репетитора (текст). См. EvaluateStudentAnswerParams.solutionText. */
  solutionText?: string | null;
  /** Эталонное решение (фото). */
  solutionImageUrls?: string[] | null;
  subject: string;
  conversationHistory: GuidedConversationHistoryMessage[];
  wrongAnswerCount: number;
  hintCount: number;
  /** See EvaluateStudentAnswerParams.studentName */
  studentName?: string | null;
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

function roundToHalf(value: number): number {
  return Math.round(value * 2) / 2;
}

function clampScore(value: number, maxScore: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(maxScore)) return 0;
  return Math.min(maxScore, Math.max(0, roundToHalf(value)));
}

function getNonPerfectScoreCeiling(maxScore: number): number {
  return Math.max(0, roundToHalf(maxScore - 0.5));
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

function buildRubricGuidance(rubricText: string | null, hasRubricImages: boolean): string {
  if (!rubricText && !hasRubricImages) return "";
  if (hasRubricImages) {
    return "Изображения после rubric_text — критерии проверки от репетитора, проверяй по ним.";
  }
  return "";
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

const SOLUTION_LEAK_STOPWORDS = new Set([
  "равно", "тогда", "поэтому", "значит", "задача", "решение", "формула",
  "потому", "таким", "образом", "отсюда", "следовательно",
  "это", "так", "как", "что", "тут", "или", "если", "тогда.",
]);

const OPERATOR_REGEX = /[=+\-*/^<>≤≥≠·×]/u;

/**
 * Extract a list of "significant" tokens from a piece of physics/math text.
 * Used both for the tutor's reference solution (leak source) and the task text
 * (to subtract givens that already legitimately appear in student-facing output).
 *
 * Heuristics:
 *  - Numeric literals ≥ 3 digits (100, 0.15, 2.5e-3) — these are specific task
 *    values that identify a spoiler.
 *  - Any operator-containing token (F=ma, U=IR, v²/r) regardless of length —
 *    short formulas are the highest-value spoilers.
 *  - Longer tokens (≥ 5 non-space chars) containing a digit or Latin letter
 *    (catches expressions like `sqrt(2gh)`, `omega*t`).
 */
function extractSignificantTokens(text: string): Set<string> {
  const cleaned = text
    .replace(/[`]/g, " ")
    // Preserve operator-attached tokens by not splitting on `=`, `+`, etc.
    .split(/[\s,;.!?()[\]{}«»"]+/u)
    .filter(Boolean);

  const tokens = new Set<string>();

  for (const rawToken of cleaned) {
    const token = rawToken.toLowerCase();
    if (SOLUTION_LEAK_STOPWORDS.has(token)) continue;

    // Numeric literal (including simple fractions / decimals / exponents)
    if (/^-?\d+([.,]\d+)?([eE]-?\d+)?$/u.test(token) && token.replace(/[^\d]/g, "").length >= 3) {
      tokens.add(token);
      continue;
    }

    const nonSpaceLen = token.replace(/\s/g, "").length;
    const hasOperator = OPERATOR_REGEX.test(token);
    const hasDigitOrLatin = /[\dA-Za-z]/.test(token);

    // Short tokens WITH an operator are high-signal spoilers (F=ma, U=IR, p=mv).
    // Skip bare single operators (len < 3).
    if (hasOperator && nonSpaceLen >= 3) {
      tokens.add(token);
      continue;
    }

    // Long tokens without operators: only flag if they look technical.
    if (nonSpaceLen >= 5 && hasDigitOrLatin) {
      tokens.add(token);
    }
  }

  return tokens;
}

/**
 * Compute tokens that appear in the solution but NOT in the task text itself —
 * these are the spoiler-worthy additions the student shouldn't see verbatim.
 * Task-given numbers (e.g. `m=100 kg` in the problem) should not be flagged.
 */
function extractSolutionLeakTokens(
  solutionText: string,
  taskText?: string | null,
): string[] {
  const solutionTokens = extractSignificantTokens(solutionText);
  if (solutionTokens.size === 0) return [];

  if (taskText && taskText.trim()) {
    const taskTokens = extractSignificantTokens(taskText);
    for (const t of taskTokens) {
      solutionTokens.delete(t);
    }
  }

  return [...solutionTokens];
}

function outputContainsSolutionLeak(
  output: string,
  solutionText: string | null | undefined,
  taskText?: string | null,
): boolean {
  if (!solutionText || !solutionText.trim()) return false;
  const tokens = extractSolutionLeakTokens(solutionText, taskText);
  if (tokens.length === 0) return false;
  const outputLower = output.toLowerCase();
  for (const token of tokens) {
    if (token.length < 3) continue;
    if (outputLower.includes(token)) return true;
  }
  return false;
}

function getGeneratedHintCheck(
  text: string,
  solutionText?: string | null,
  taskText?: string | null,
): { ok: boolean; reason?: string } {
  if (!text.trim()) {
    return { ok: false, reason: "empty_after_sanitize" };
  }

  const contentCheck = validateHintContent(text);
  if (!contentCheck.ok) {
    return contentCheck;
  }

  // Anti-spoiler (Sokratai 2026-04-18, plan wild-swinging-nova.md):
  // reject hints that cite numbers/formulas from the tutor's reference solution
  // that are NOT already in the task statement (task givens stay allowed).
  if (outputContainsSolutionLeak(text, solutionText, taskText)) {
    return { ok: false, reason: "solution_leak" };
  }

  return { ok: true };
}

function reasonToHumanMessage(reason: string | undefined): string {
  if (!reason) return "нарушен формат подсказки";
  if (reason.startsWith("forbidden:")) return "ты использовал запрещённую шаблонную фразу";
  if (reason === "too_short") return "подсказка получилась слишком короткой";
  if (reason === "empty_after_sanitize") return "подсказка оказалась пустой или содержала правильный ответ";
  if (reason === "solution_leak") return "ты процитировал числа или формулы из эталонного решения — этого делать нельзя";
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

function sanitizeAiScoreComment(rawComment: unknown, correctAnswer: string | null): string | null {
  if (typeof rawComment !== "string") return null;

  let comment = normalizeText(stripMarkdownWrappers(rawComment))
    .replace(/\$+/g, "")
    .replace(/\\[A-Za-z]+/g, "")
    .replace(/[{}]/g, "")
    .trim();

  if (!comment) return null;

  comment = softTruncate(comment, MAX_SCORE_COMMENT_LENGTH);

  const normalizedAnswer = normalizeComparable(correctAnswer ?? "");
  if (normalizedAnswer.length >= 2) {
    const normalizedComment = normalizeComparable(comment);
    if (normalizedComment.includes(normalizedAnswer)) {
      return null;
    }
  }

  return comment || null;
}

function buildFallbackAiScoreComment(
  verdict: Exclude<GuidedVerdict, "CHECK_FAILED">,
  aiScore: number,
): string {
  if (verdict === "CORRECT") {
    return "Итоговый ответ верный, но в обосновании или оформлении не хватает части шагов для максимального балла.";
  }
  if (verdict === "ON_TRACK") {
    return aiScore > 0
      ? "Есть верные содержательные шаги, но решение ещё не доведено до полного ответа по критериям."
      : "Решение пока не доведено до полного ответа, поэтому максимальный балл не ставится.";
  }
  return aiScore > 0
    ? "В решении есть отдельные верные элементы, но остаётся существенная ошибка, поэтому балл не максимальный."
    : "В решении есть существенная ошибка или не хватает корректного хода, поэтому балл не начислен.";
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

  // Skip SVGs by URL extension before fetching — Gemini multimodal
  // only supports raster formats (PNG/JPG/WEBP/GIF). SVGs cause HTTP 400
  // from the gateway and break auto-check. AI falls back to task text.
  try {
    const parsedUrl = new URL(trimmed);
    if (/\.svg(\?|$)/i.test(parsedUrl.pathname)) {
      console.warn("guided_ai_inline_image_skipped", {
        reason: "unsupported_svg",
        source: "url_extension",
        preview: trimmed.slice(0, 120),
      });
      return null;
    }
  } catch {
    // URL parsing failed — let the fetch path handle it
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

    // Detect SVG via content-type or magic bytes (catches SVGs served
    // without .svg extension or behind signed URLs with rewritten paths).
    const isSvgMime = /image\/svg\+?xml/i.test(mime);
    let isSvgMagic = false;
    if (!isSvgMime) {
      const sniffLen = Math.min(buffer.byteLength, 256);
      const head = new TextDecoder("utf-8", { fatal: false }).decode(
        new Uint8Array(buffer, 0, sniffLen),
      );
      isSvgMagic = /^\s*(?:<\?xml[^>]*\?>\s*)?<svg[\s>]/i.test(head);
    }
    if (isSvgMime || isSvgMagic) {
      console.warn("guided_ai_inline_image_skipped", {
        reason: "unsupported_svg",
        source: isSvgMime ? "content_type" : "magic_bytes",
        mime,
        preview: trimmed.slice(0, 120),
      });
      return null;
    }

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
  const match = compact.match(/^(-?\d+(?:\.\d+)?)([a-zа-я/%°/^0-9]*)$/iu);
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
  maxScore: number,
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
      ai_score: maxScore,
      ai_score_comment: null,
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
    ai_score: maxScore,
    ai_score_comment: null,
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
  ai_score: null,
  ai_score_comment: null,
  failure_reason: "unknown",
};

function sanitizeCheckResult(
  parsed: Record<string, unknown>,
  correctAnswer: string | null,
  scoring: Pick<EvaluateStudentAnswerParams, "checkFormat" | "maxScore">,
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
  const maxScore = Math.max(0, scoring.maxScore);

  if (scoring.checkFormat !== "detailed_solution") {
    return {
      verdict,
      feedback,
      confidence,
      error_type,
      ai_score: verdict === "CORRECT" ? maxScore : 0,
      ai_score_comment: null,
    };
  }

  const rawAiScore = toNumber(parsed.ai_score);
  const initialScore = rawAiScore ?? (verdict === "CORRECT" ? maxScore : 0);
  const clampedScore = clampScore(initialScore, maxScore);
  const cappedScore = verdict === "CORRECT"
    ? clampedScore
    : Math.min(clampedScore, getNonPerfectScoreCeiling(maxScore));
  const ai_score = clampScore(cappedScore, maxScore);
  const ai_score_comment = ai_score < maxScore
    ? sanitizeAiScoreComment(parsed.ai_score_comment, correctAnswer) ??
      buildFallbackAiScoreComment(verdict, ai_score)
    : null;

  return {
    verdict,
    feedback,
    confidence,
    error_type,
    ai_score,
    ai_score_comment,
  };
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

function buildAiScoreGuidance(
  checkFormat: "short_answer" | "detailed_solution" | undefined,
  maxScore: number,
): string {
  if (checkFormat === "detailed_solution") {
    return [
      "",
      `БАЛЛ ПО КРИТЕРИЯМ ФИПИ: верни ai_score в диапазоне 0..${maxScore} с шагом 0.5.`,
      "- ai_score зависит только от качества решения и соответствия критериям, а НЕ от числа попыток, подсказок или времени.",
      "- CORRECT может иметь ai_score < max_score, если итог верный, но обоснование или оформление неполное.",
      "- ON_TRACK может иметь частичный ai_score, если есть содержательно верные шаги, но решение не завершено.",
      "- INCORRECT может иметь 0 или частичный ai_score, если есть отдельные верные содержательные элементы, но решение содержит ошибку.",
      "- Если ai_score < max_score, обязательно верни ai_score_comment: 1-2 коротких предложения без LaTeX, почему балл не максимальный.",
      "- Если ai_score = max_score, верни ai_score_comment как null или пустую строку.",
    ].join("\n");
  }

  return [
    "",
    `БАЛЛ: для short_answer ai_score может быть только 0 или ${maxScore}.`,
    "- CORRECT => ai_score = max_score.",
    "- ON_TRACK или INCORRECT => ai_score = 0.",
    "- ai_score_comment для short_answer всегда null.",
  ].join("\n");
}

/**
 * Student-name & gender guidance for AI prompts.
 *
 * Returns a short instruction block that tells the model the student's
 * display name and asks it to use grammatically correct gender forms
 * (Russian) based on the name (e.g. "ты подставила" for Юлия, "ты решил"
 * for Николай). Returns empty string when no name is available — in that
 * case the prompt stays unchanged and the model uses neutral forms.
 *
 * Called by buildCheckPrompt and buildHintPrompt.
 */
function buildStudentNameGuidance(studentName: string | null | undefined): string {
  const trimmed = typeof studentName === "string" ? studentName.trim() : "";
  if (!trimmed) return "";
  return [
    "",
    `Имя ученика: ${trimmed}.`,
    "- Обращайся по имени время от времени (не в каждом сообщении, чтобы не звучало навязчиво).",
    "- Используй грамматически правильный род глаголов и прилагательных, исходя из имени (например, «ты подставила» / «ты молодец» для женских имён вроде Юлия, Анна; «ты подставил» / «ты молодец» для мужских имён вроде Николай, Иван).",
    "- Если имя иностранное или нейтральное и пол неочевиден — используй нейтральные формы (например, «ты справился/справилась» или безличные конструкции).",
  ].join("\n");
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
  const rubricGuidance = buildRubricGuidance(params.rubricText, Boolean(params.rubricImageUrls?.length));
  const taskImageUrls = (params.taskImageUrls ?? []).filter(Boolean);
  const rubricImageUrls = (params.rubricImageUrls ?? []).filter(Boolean);
  const solutionImageUrls = (params.solutionImageUrls ?? []).filter(Boolean);
  const hasTaskImage = taskImageUrls.length > 0;
  const hasRubricImages = rubricImageUrls.length > 0;
  const hasSolutionImages = solutionImageUrls.length > 0;
  const hasSolutionText = Boolean(params.solutionText && params.solutionText.trim().length > 0);
  const studentImageUrls = (params.studentImageUrls ?? []).filter(Boolean);
  const studentImageCount = studentImageUrls.length;
  const hasStudentImage = studentImageCount > 0;
  const answerTypeGuidance = buildAnswerTypeGuidance(params.correctAnswer, params.taskText);
  const wantsImageDescription = hasStudentImage && isImageDescriptionRequest(params.studentAnswer);
  const graphGroundingGuidance = buildGraphGroundingGuidance(params.taskOcrText, hasTaskImage);
  const checkFormatGuidance = buildCheckFormatGuidance(params.checkFormat, params.studentAnswer);
  const aiScoreGuidance = buildAiScoreGuidance(params.checkFormat, params.maxScore);
  const studentNameGuidance = buildStudentNameGuidance(params.studentName);

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
    rubricGuidance,
    hasRubricImages ? "К задаче также приложены изображения с критериями проверки от репетитора — учитывай их при оценке." : "",
    hasSolutionText
      ? `Эталонное решение репетитора (для твоей сверки, НЕ цитируй дословно ученику): ${clampPromptText(params.solutionText)}`
      : "",
    hasSolutionImages
      ? "К задаче приложены фото эталонного решения репетитора — используй их для сверки логики, но НЕ показывай решение ученику дословно."
      : "",
    (hasSolutionText || hasSolutionImages)
      ? "ВАЖНО (anti-spoiler): эталон репетитора = референс для проверки. В feedback можешь опираться на него, но НЕ пересказывай шаги решения — ученик должен дойти сам."
      : "",
    "",
    `Максимальный балл по задаче: ${params.maxScore}.`,
    `Статистика: ${params.wrongAnswerCount} неверных попыток, ${params.hintCount} подсказок.`,
    "Статистика попыток дана только как контекст диалога и НЕ влияет на verdict или ai_score.",
    "",
    "Верни ТОЛЬКО валидный JSON без markdown-обёрток и лишнего текста.",
    '{"verdict":"CORRECT"|"ON_TRACK"|"INCORRECT","feedback":"...","confidence":0.0-1.0,"error_type":"...","ai_score":0,"ai_score_comment":null}',
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
    aiScoreGuidance,
    answerTypeGuidance,
    checkFormatGuidance,
    studentNameGuidance,
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

  for (const [index, imageUrl] of taskImageUrls.entries()) {
    userContent.push({
      type: "text",
      text: hasStudentImage || taskImageUrls.length > 1
        ? `Изображение ${studentImageCount + index + 1} — условие задачи${taskImageUrls.length > 1 ? `, файл ${index + 1}` : ""}. Используй его для сверки с решением ученика.`
        : "Изображение выше — условие задачи.",
    });
    userContent.push({
      type: "image_url",
      image_url: { url: imageUrl },
    });
  }

  for (const [index, imageUrl] of rubricImageUrls.entries()) {
    userContent.push({
      type: "text",
      text: `Изображение ${studentImageCount + taskImageUrls.length + index + 1} — критерии проверки от репетитора${rubricImageUrls.length > 1 ? `, файл ${index + 1}` : ""}.`,
    });
    userContent.push({
      type: "image_url",
      image_url: { url: imageUrl },
    });
  }

  const solutionOffset = studentImageCount + taskImageUrls.length + rubricImageUrls.length;
  for (const [index, imageUrl] of solutionImageUrls.entries()) {
    userContent.push({
      type: "text",
      text: `Изображение ${solutionOffset + index + 1} — эталонное решение от репетитора${solutionImageUrls.length > 1 ? `, файл ${index + 1}` : ""}. Используй для сверки, но НЕ цитируй дословно.`,
    });
    userContent.push({
      type: "image_url",
      image_url: { url: imageUrl },
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
  const taskImageUrls = (params.taskImageUrls ?? []).filter(Boolean);
  const hasTaskImage = taskImageUrls.length > 0;
  const studentImageUrls = (params.studentImageUrls ?? []).filter(Boolean);
  const studentImageCount = studentImageUrls.length;
  const hasStudentImage = studentImageCount > 0;
  const rubricImageUrls = (params.rubricImageUrls ?? []).filter(Boolean);
  const hasRubricImages = rubricImageUrls.length > 0;
  const solutionImageUrls = (params.solutionImageUrls ?? []).filter(Boolean);
  const hasSolutionImages = solutionImageUrls.length > 0;
  const hasSolutionText = Boolean(params.solutionText && params.solutionText.trim().length > 0);
  const hasTutorReference = hasSolutionText || hasSolutionImages;
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
    params.rubricText ? `Критерии проверки от репетитора: ${clampPromptText(params.rubricText)}` : "",
    hasRubricImages ? "К задаче приложены фото критериев проверки — учитывай их при формулировании подсказки." : "",
    hasSolutionText
      ? `ЭТАЛОННОЕ РЕШЕНИЕ РЕПЕТИТОРА (только для твоей сверки): ${clampPromptText(params.solutionText)}`
      : "",
    hasSolutionImages
      ? "К задаче приложены фото эталонного решения репетитора — используй их только для сверки логики подсказки."
      : "",
    hasTutorReference
      ? [
          "АНТИ-СПОЙЛЕР (КРИТИЧНО): эталонное решение дано тебе ТОЛЬКО для сверки.",
          " - НЕ цитируй формулы из решения дословно, если ученик ещё не дошёл до этого шага.",
          " - НЕ называй численные подстановки или финальные выражения из решения.",
          " - НЕ пересказывай ход решения.",
          " - Работай Сократовским методом: один наводящий вопрос к ключевой величине/закону.",
        ].join("\n")
      : "",
    "",
    `Статистика: ${params.wrongAnswerCount} неверных попыток, ${params.hintCount} подсказок.`,
    buildStudentNameGuidance(params.studentName),
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

  for (const [index, imageUrl] of taskImageUrls.entries()) {
    userContent.push({
      type: "text",
      text: hasStudentImage || taskImageUrls.length > 1
        ? `Изображение ${studentImageCount + index + 1} — условие задачи${taskImageUrls.length > 1 ? `, файл ${index + 1}` : ""}. Используй его для сверки с решением ученика.`
        : "Изображение выше — условие задачи.",
    });
    userContent.push({
      type: "image_url",
      image_url: { url: imageUrl },
    });
  }

  const hintRubricOffset = studentImageCount + taskImageUrls.length;
  for (const [index, imageUrl] of rubricImageUrls.entries()) {
    userContent.push({
      type: "text",
      text: `Изображение ${hintRubricOffset + index + 1} — критерии проверки от репетитора${rubricImageUrls.length > 1 ? `, файл ${index + 1}` : ""}.`,
    });
    userContent.push({
      type: "image_url",
      image_url: { url: imageUrl },
    });
  }

  const hintSolutionOffset = hintRubricOffset + rubricImageUrls.length;
  for (const [index, imageUrl] of solutionImageUrls.entries()) {
    userContent.push({
      type: "text",
      text: `Изображение ${hintSolutionOffset + index + 1} — эталонное решение от репетитора${solutionImageUrls.length > 1 ? `, файл ${index + 1}` : ""}. Используй для сверки логики подсказки, НЕ цитируй дословно ученику.`,
    });
    userContent.push({
      type: "image_url",
      image_url: { url: imageUrl },
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
      params.maxScore,
    );
    if (deterministicMatch) {
      console.log("guided_check_fast_path_match", {
        subject: params.subject,
        confidence: deterministicMatch.confidence,
      });
      return deterministicMatch;
    }
  }

  // Anti-leak invariant (plan wild-swinging-nova.md P0-1 v3):
  // Attach solution_image_urls only when solution_text is a MEANINGFUL anchor
  // for the leak detector. A trivially short anchor (e.g. "см. фото") produces
  // almost no tokens and leaves images effectively unprotected against
  // transcription jailbreaks. Minimum 20 chars guarantees non-trivial coverage.
  const SOLUTION_TEXT_ANCHOR_MIN_CHARS = 20;
  const solutionTextTrimmed = params.solutionText?.trim() ?? "";
  const allowSolutionImagesForCheck = solutionTextTrimmed.length >= SOLUTION_TEXT_ANCHOR_MIN_CHARS;
  const effectiveSolutionImageRefs = allowSolutionImagesForCheck
    ? (params.solutionImageUrls ?? [])
    : [];
  if (!allowSolutionImagesForCheck && (params.solutionImageUrls?.length ?? 0) > 0) {
    console.warn(JSON.stringify({
      event: "guided_check_solution_images_dropped_no_text",
      subject: params.subject,
      text_len: solutionTextTrimmed.length,
    }));
  }

  try {
    const [taskImageUrls, rubricImageUrls, solutionImageUrls, studentImageUrls] = await Promise.all([
      inlinePromptImageUrls(params.taskImageUrls.slice(0, MAX_TASK_IMAGES_FOR_AI)),
      inlinePromptImageUrls((params.rubricImageUrls ?? []).slice(0, MAX_TASK_IMAGES_FOR_AI)),
      inlinePromptImageUrls(effectiveSolutionImageRefs.slice(0, MAX_TASK_IMAGES_FOR_AI)),
      inlinePromptImageUrls((params.studentImageUrls ?? []).slice(0, MAX_GUIDED_CHAT_IMAGES_FOR_AI)),
    ]);
    const messages = buildCheckPrompt({
      ...params,
      taskImageUrls,
      rubricImageUrls,
      solutionImageUrls,
      studentImageUrls,
    });
    const parsed = await callLovableJson(messages, "guided_check");
    let result = sanitizeCheckResult(parsed, params.correctAnswer, {
      checkFormat: params.checkFormat,
      maxScore: params.maxScore,
    });

    if (result.verdict === "CHECK_FAILED") {
      console.warn("guided_check_invalid_payload", {
        subject: params.subject,
        failure_reason: result.failure_reason ?? "invalid_json",
      });
    }

    // Anti-spoiler on feedback: retry once with explicit anti-leak instruction
    // if the AI cited numbers/formulas from the reference solution in user-visible
    // feedback or ai_score_comment. Mirrors the hint path's getGeneratedHintCheck flow.
    // See plan wild-swinging-nova.md (P0-2 fix).
    if (
      result.verdict !== "CHECK_FAILED"
      && (params.solutionText || (params.solutionImageUrls?.length ?? 0) > 0)
    ) {
      const feedbackLeaks = outputContainsSolutionLeak(result.feedback ?? "", params.solutionText, params.taskText);
      const commentLeaks = outputContainsSolutionLeak(result.ai_score_comment ?? "", params.solutionText, params.taskText);
      if (feedbackLeaks || commentLeaks) {
        console.warn(JSON.stringify({
          event: "check_solution_leak_rejected",
          subject: params.subject,
          retry: 1,
          feedback_leak: feedbackLeaks,
          comment_leak: commentLeaks,
        }));

        const retryMessages: LovableMessage[] = [...messages, {
          role: "user",
          content:
            "Предыдущая версия feedback/ai_score_comment цитировала числа или формулы из эталонного решения репетитора. " +
            "Перепиши так, чтобы оставить вердикт и краткое направление без цитирования конкретных чисел или выражений из эталона. " +
            "Верни тот же JSON без markdown-обёрток.",
        }];
        try {
          const retryParsed = await callLovableJson(retryMessages, "guided_check");
          const retryResult = sanitizeCheckResult(retryParsed, params.correctAnswer, {
            checkFormat: params.checkFormat,
            maxScore: params.maxScore,
          });
          const retryFeedbackLeaks = outputContainsSolutionLeak(retryResult.feedback ?? "", params.solutionText, params.taskText);
          const retryCommentLeaks = outputContainsSolutionLeak(retryResult.ai_score_comment ?? "", params.solutionText, params.taskText);
          // Grading invariant (plan wild-swinging-nova.md P1-2 fix):
          // the leak-retry is a cosmetic rewrite — it MUST NOT change scoring.
          // Keep verdict/confidence/error_type/ai_score from the first valid
          // `result`, only swap sanitized feedback/ai_score_comment from retry.
          // Otherwise a rewrite could flip CORRECT→ON_TRACK or shift ai_score
          // for the same student answer, which makes grading nondeterministic.
          if (retryResult.verdict !== "CHECK_FAILED" && !retryFeedbackLeaks && !retryCommentLeaks) {
            result = {
              ...result,
              feedback: retryResult.feedback,
              ai_score_comment: retryResult.ai_score_comment,
            };
          } else {
            console.warn(JSON.stringify({
              event: "check_solution_leak_rejected",
              subject: params.subject,
              retry: 2,
              feedback_leak: retryFeedbackLeaks,
              comment_leak: retryCommentLeaks,
            }));
            // Scrub feedback / comment to a safe fallback; keep verdict + ai_score.
            result = {
              ...result,
              feedback: feedbackLeaks
                ? "Проверил — давай разберём шаг за шагом. Назови величину, с которой начнёшь, и я направлю дальше."
                : result.feedback,
              ai_score_comment: commentLeaks ? null : result.ai_score_comment,
            };
          }
        } catch (retryErr) {
          console.warn("guided_check_leak_retry_error", {
            error: retryErr instanceof Error ? retryErr.message : String(retryErr),
          });
          // Same scrubbing fallback as when retry still leaks.
          result = {
            ...result,
            feedback: feedbackLeaks
              ? "Проверил — давай разберём шаг за шагом. Назови величину, с которой начнёшь, и я направлю дальше."
              : result.feedback,
            ai_score_comment: commentLeaks ? null : result.ai_score_comment,
          };
        }
      }
    }

    console.log("guided_check_success", {
      verdict: result.verdict,
      confidence: result.confidence,
      error_type: result.error_type,
      ai_score: result.ai_score,
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

  // P0-1 v3: require a meaningful text anchor (≥ 20 chars) before attaching
  // solution images — a shorter anchor leaves the leak detector with no tokens
  // to match against, so image transcription jailbreaks go undetected.
  const SOLUTION_TEXT_ANCHOR_MIN_CHARS_HINT = 20;
  const solutionTextTrimmedHint = params.solutionText?.trim() ?? "";
  const allowSolutionImagesForHint =
    solutionTextTrimmedHint.length >= SOLUTION_TEXT_ANCHOR_MIN_CHARS_HINT;
  const effectiveSolutionImageRefsForHint = allowSolutionImagesForHint
    ? (params.solutionImageUrls ?? [])
    : [];
  if (!allowSolutionImagesForHint && (params.solutionImageUrls?.length ?? 0) > 0) {
    console.warn(JSON.stringify({
      event: "guided_hint_solution_images_dropped_no_text",
      text_len: solutionTextTrimmedHint.length,
      ...telemetryMeta,
    }));
  }

  try {
    const [taskImageUrls, rubricImageUrls, solutionImageUrls, studentImageUrls] = await Promise.all([
      inlinePromptImageUrls(params.taskImageUrls.slice(0, MAX_TASK_IMAGES_FOR_AI)),
      inlinePromptImageUrls((params.rubricImageUrls ?? []).slice(0, MAX_TASK_IMAGES_FOR_AI)),
      inlinePromptImageUrls(effectiveSolutionImageRefsForHint.slice(0, MAX_TASK_IMAGES_FOR_AI)),
      inlinePromptImageUrls((params.studentImageUrls ?? []).slice(0, MAX_GUIDED_CHAT_IMAGES_FOR_AI)),
    ]);
    resolvedTaskImageUrl = taskImageUrls[0] ?? null;
    const messages = buildHintPrompt({
      ...params,
      taskImageUrls,
      rubricImageUrls,
      solutionImageUrls,
      studentImageUrls,
    });
    const parsed = await callLovableJson(messages, "guided_hint");
    const firstHint = sanitizeHintText(parsed.hint, params.correctAnswer);
    const firstCheck = getGeneratedHintCheck(firstHint, params.solutionText, params.taskText);

    if (firstCheck.ok) {
      console.log("guided_hint_success", { hint_length: firstHint.length, attempt: 1 });
      return { hint: firstHint };
    }

    console.warn(JSON.stringify({
      event: firstCheck.reason === "solution_leak" ? "hint_solution_leak_rejected" : "hint_rejected",
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
        "1-3 предложения, без общих фраз, без правильного ответа и без дословного цитирования эталонного решения.",
    });

    const retryParsed = await callLovableJson(retryMessages, "guided_hint");
    const secondHint = sanitizeHintText(retryParsed.hint, params.correctAnswer);
    const secondCheck = getGeneratedHintCheck(secondHint, params.solutionText, params.taskText);

    if (secondCheck.ok) {
      console.log("guided_hint_success", { hint_length: secondHint.length, attempt: 2 });
      return { hint: secondHint };
    }

    console.warn(JSON.stringify({
      event: secondCheck.reason === "solution_leak" ? "hint_solution_leak_rejected" : "hint_rejected",
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
