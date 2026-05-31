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
import { rewriteToDirect, SUPABASE_PROXY_URL } from "../_shared/proxy-url.ts";
import {
  getSubjectLabel as getSubjectLabelShared,
  isHumanitiesSubject,
  resolveSubjectRubric,
  type ExamType,
  type SubjectCriterionTemplate,
  type SubjectRubric,
} from "../_shared/subject-rubrics/index.ts";
import { containsVerbatimSpan } from "../_shared/leak-detector.ts";

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

// ─── Subject-aware prompt helpers ───────────────────────────────────────────
//
// Phase 2 (2026-05-15): heavy lifting moved to `_shared/subject-rubrics/`.
// This file keeps **thin wrappers** for backward-compat with callsite shapes
// (buildFallbackHint signature, buildValidatedFallbackHint flow), but role +
// methodology + hint_examples + fallback_hint now all come from
// `resolveSubjectRubric()`. See .claude/rules/40-homework-system.md «Subject-rubric layer».

function getSubjectLabelDeno(subjectId: string | null | undefined): string {
  return getSubjectLabelShared(subjectId);
}

/**
 * Subject-aware fallback hint — picks the resolver's `fallback_hint` field.
 * Used by `buildFallbackHint` after keyword-extraction misses.
 */
function buildSubjectFallbackHint(subjectId: string | null | undefined): string {
  switch (subjectId) {
    case "physics":
      return "Какая физическая величина является искомой в этой задаче и какие данные нужны, чтобы её найти?";
    case "maths":
    case "math":
    case "algebra":
    case "geometry":
      return "Какая формула, теорема или приём подходит к этому условию и что именно нужно найти?";
    case "russian":
    case "rus":
      return "Какое правило (орфография / пунктуация / морфология) применимо к этому случаю и где в задаче ключевое слово?";
    case "literature":
      return "Какая тема, художественное средство или позиция автора помогают раскрыть мысль в этой задаче?";
    case "english":
    case "french":
    case "spanish":
      return "Какое грамматическое правило, время или конструкция подходят для этого предложения, и какие слова дают подсказку?";
    case "history":
    case "social":
      return "Какое событие, термин или причинно-следственная связь нужны для ответа на этот вопрос?";
    case "informatics":
    case "cs":
      return "Какой алгоритм, конструкция языка или приём подходят к этой задаче, и какие данные ты используешь?";
    case "chemistry":
      return "Какая реакция, формула или закон применимы здесь, и какие вещества/величины задействованы?";
    case "biology":
      return "Какой процесс, термин или система описывает то, о чём задача, и какие данные для этого нужны?";
    case "geography":
      return "Какой процесс, явление или статистические данные помогают ответить на этот вопрос?";
    default:
      return "На какую часть условия ты опираешься и какой приём, правило или ключевая идея подходит для этой задачи?";
  }
}

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

/**
 * Voice-Speaking MVP TASK-3 (2026-05-27): per-criterion grading breakdown
 * for language subjects (DELF / ЕГЭ EN / IELTS / ОГЭ — written + monologue).
 * Mirror pattern of mock-exam `ai_draft_json.elements_check` (.claude/rules/45-mock-exams.md)
 * but with named criteria + max scores from `languages-ege.ts` templates.
 *
 * Sum of `score` MUST equal `GuidedCheckResult.ai_score` (validated and
 * normalized in `sanitizeCheckResult`). NULL for non-language subjects.
 *
 * Persisted into `homework_tutor_task_states.ai_criteria_json` by
 * `runStudentAnswerGrading` (homework-api/index.ts). Visible to student
 * post-submit (rendered as a 1-page criteria table).
 */
export interface GuidedCriteriaItem {
  label: string;
  score: number;
  max: number;
  comment: string;
  /**
   * Marker for criteria the AI deliberately does NOT grade (phonétique /
   * произношение). Surfaced as a muted hint in the UI; backend forces
   * `score = max` for these (no penalty). Absent for normal AI-graded
   * criteria.
   */
  kind?: "ai" | "tutor_only";
}

export interface GuidedCheckResult {
  verdict: GuidedVerdict;
  feedback: string;
  confidence: number;
  error_type: HomeworkAiErrorType;
  ai_score: number | null;
  ai_score_comment: string | null;
  /**
   * Per-criterion breakdown for language subjects only. NULL for
   * physics / maths / chemistry / other (no per-criterion rubric).
   * See `GuidedCriteriaItem` for shape + invariant.
   */
  criteria_breakdown?: GuidedCriteriaItem[] | null;
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
  taskId?: string | null;
  assignmentId?: string | null;
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
  /** ЕГЭ/ОГЭ — passed to subject-rubric resolver. Defaults to 'ege'. */
  examType?: ExamType | null;
  /** Optional `homework_tutor_tasks.kim_number` for per-KIM rubric selection. */
  kimNumber?: number | null;
  /** Optional `homework_tutor_tasks.task_kind` (informational for now). */
  taskKind?: "numeric" | "extended" | "proof" | "speaking" | null;
  /**
   * Explicit CEFR level («Уровень» selector → `homework_tutor_tasks.cefr_level`).
   * CEFR-level fix (2026-05-29): forces the language rubric level (A2/B1/B2),
   * overriding task_text heuristics. null → auto-detect.
   */
  cefrLevel?: "A2" | "B1" | "B2" | "C1" | null;
  /**
   * Assignment-level feedback language (Phase 11, 2026-05-31). 'auto' (default)
   * → A2 русский / B1+ изучаемый; 'russian' / 'target' — явный override.
   * Только для языковых subjects влияет на response_language_instruction.
   */
  feedbackLanguage?: "auto" | "russian" | "target" | null;
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
   * Source: homework-api resolveStudentIdentity (tutor_students.display_name
   * → profiles.full_name → profiles.username, skipping auto-generated placeholders).
   */
  studentName?: string | null;
  /**
   * Phase 8 (2026-05-20) — explicit gender для AI grammar conjugation.
   * Source: homework-api resolveStudentIdentity (tutor_students.gender →
   * profiles.gender → null). Когда null — AI использует neutral формы.
   * Решает проблему AI guess by name для иностранных / latin-spelled / gender-
   * neutral имён (Anastasiia / Marie / Саша → AI guess fails → wrong conjugation).
   */
  studentGender?: "male" | "female" | null;
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
  /**
   * Optional ЕГЭ/ОГЭ flag — passed to subject-rubric resolver so per-KIM
   * methodology blocks pick the right rubric (e.g. physics № 21-26 ФИПИ I-IV).
   * Defaults to 'ege' inside resolver when nullable.
   */
  examType?: ExamType | null;
  /**
   * Optional KIM number from `homework_tutor_tasks.kim_number`. Drives
   * per-task rubric selection (e.g. math № 18 параметр vs № 13 уравнения).
   */
  kimNumber?: number | null;
  /**
   * Optional `homework_tutor_tasks.task_kind` (numeric / extended / proof).
   * Currently informational only — resolver may use it in the future to
   * pick compact vs full methodology block.
   */
  taskKind?: "numeric" | "extended" | "proof" | "speaking" | null;
  /** Explicit CEFR level («Уровень» selector); forces language rubric level. CEFR-level fix. */
  cefrLevel?: "A2" | "B1" | "B2" | "C1" | null;
  /** See EvaluateStudentAnswerParams.feedbackLanguage (Phase 11). */
  feedbackLanguage?: "auto" | "russian" | "target" | null;
  conversationHistory: GuidedConversationHistoryMessage[];
  wrongAnswerCount: number;
  hintCount: number;
  /** See EvaluateStudentAnswerParams.studentName */
  studentName?: string | null;
  /** See EvaluateStudentAnswerParams.studentGender (Phase 8). */
  studentGender?: "male" | "female" | null;
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
  taskContext: {
    taskText?: string | null;
    hasImage?: boolean;
    /**
     * Subject id from `homework_tutor_assignments.subject` (canonical list:
     * src/types/homework.ts → SUBJECTS). Branches fallback wording so the AI
     * doesn't tell French / russian students to «name the physical quantity».
     * Missing/unknown → generic neutral fallback.
     */
    subject?: string | null;
  },
): string {
  const taskText = taskContext.taskText ?? "";
  const subjectId = (taskContext.subject ?? "").trim() || null;
  const isPhysics = subjectId === "physics";
  const keyword = pickFallbackKeyword(taskText);

  if (keyword) {
    if (isPhysics) {
      return `Сосредоточься на том, что в задаче фигурирует «${keyword}». Какая физическая величина это описывает и какой закон с ней связан?`;
    }
    return `Сосредоточься на том, что в задаче фигурирует «${keyword}». Какое правило, приём или ключевая идея с этим связана?`;
  }

  if (!taskText.trim() && taskContext.hasImage) {
    if (isPhysics) {
      return "На изображении задачи есть конкретные величины — назови, что именно дано (силы, расстояния, время) и какой закон их связывает.";
    }
    return "На изображении задачи есть конкретные элементы условия — назови, что именно ты видишь, и какое правило / приём здесь применимо.";
  }

  return buildSubjectFallbackHint(subjectId);
}

function buildValidatedFallbackHint(taskContext: {
  taskText?: string | null;
  hasImage?: boolean;
  subject?: string | null;
}): string {
  const fallbackHint = buildFallbackHint(taskContext);
  if (validateHintContent(fallbackHint).ok) {
    return fallbackHint;
  }

  const subjectId = (taskContext.subject ?? "").trim() || null;
  if (subjectId === "physics") {
    return "Какая физическая величина является искомой в этой задаче и какой закон поможет её найти по известным данным?";
  }
  return "Какое правило, формула или приём подойдут к этой задаче, и какие данные из условия для этого нужны?";
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
  subject?: string | null,
): { ok: boolean; reason?: string } {
  if (!text.trim()) {
    return { ok: false, reason: "empty_after_sanitize" };
  }

  const contentCheck = validateHintContent(text);
  if (!contentCheck.ok) {
    return contentCheck;
  }

  // Anti-spoiler — subject-aware leak detection (Phase 7 round 2, 2026-05-20):
  //   humanities (russian/literature/english/french/spanish) → verbatim span
  //     (8+ words copy-paste). Token-based detector имел false positive на
  //     естественном языке — любое латинское слово ≥5 chars значимо,
  //     а на French каждое слово такое.
  //   non-humanities (physics/math/etc.) → token-based как раньше
  //     (numbers/formulas — unique tokens, false positive minimal).
  const leakDetected = isHumanitiesSubject(subject)
    ? containsVerbatimSpan(text, solutionText, taskText)
    : outputContainsSolutionLeak(text, solutionText, taskText);
  if (leakDetected) {
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

// ─── Criteria breakdown sanitizer (voice-speaking-mvp TASK-3) ──────────────

const MAX_CRITERION_LABEL_LENGTH = 120;
const MAX_CRITERION_COMMENT_LENGTH = 600;
const CRITERIA_SUM_TOLERANCE = 0.05;

function sanitizeCriterionLabel(value: unknown): string {
  if (typeof value !== "string") return "";
  const cleaned = normalizeText(value).replace(/[\r\n]+/g, " ").trim();
  if (!cleaned) return "";
  return softTruncate(cleaned, MAX_CRITERION_LABEL_LENGTH);
}

function sanitizeCriterionComment(value: unknown): string {
  if (typeof value !== "string") return "";
  const cleaned = normalizeText(stripMarkdownWrappers(value)).trim();
  if (!cleaned) return "";
  return softTruncate(cleaned, MAX_CRITERION_COMMENT_LENGTH);
}

/** Round to nearest 0.1 (matches `ai_score` step, .claude/rules/40-homework-system.md). */
function roundToTenth(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 10) / 10;
}

function matchTemplateEntry(
  template: SubjectCriterionTemplate[],
  rawLabel: string,
  usedIndices: Set<number>,
): { index: number; entry: SubjectCriterionTemplate } | null {
  const normalized = rawLabel.toLowerCase();
  for (let i = 0; i < template.length; i += 1) {
    if (usedIndices.has(i)) continue;
    if (template[i].label.toLowerCase() === normalized) {
      return { index: i, entry: template[i] };
    }
  }
  for (let i = 0; i < template.length; i += 1) {
    if (usedIndices.has(i)) continue;
    const templateLower = template[i].label.toLowerCase();
    if (templateLower.includes(normalized) || normalized.includes(templateLower)) {
      return { index: i, entry: template[i] };
    }
  }
  for (let i = 0; i < template.length; i += 1) {
    if (!usedIndices.has(i)) return { index: i, entry: template[i] };
  }
  return null;
}

/** Σ of `max` over AI-graded criteria (excludes `tutor_only`). */
function sumAiGradableMax(items: { max: number; kind?: "ai" | "tutor_only" }[]): number {
  return items
    .filter((c) => c.kind !== "tutor_only")
    .reduce((sum, c) => sum + (Number.isFinite(c.max) ? c.max : 0), 0);
}

/**
 * Map `ai_score` (on the TASK scale [0, maxScore]) onto the breakdown's
 * AI-gradable template scale [0, aiGradableMax]. When the tutor sets
 * `max_score == aiGradableMax` (the recommended config — see CLAUDE.md /
 * spec §5), the ratio is 1 and this is a no-op. When it diverges
 * (misconfig), proportional remap keeps the footer coherent.
 */
function mapAiScoreToTemplateScale(
  aiScore: number,
  maxScore: number,
  aiGradableMax: number,
): number {
  const safeScore = Math.max(0, aiScore);
  if (aiGradableMax <= 0) return 0;
  if (maxScore > 0) {
    const scaled = safeScore * (aiGradableMax / maxScore);
    return Math.min(aiGradableMax, Math.max(0, scaled));
  }
  return Math.min(aiGradableMax, safeScore);
}

/**
 * Normalize AI-graded criteria scores so their Σ equals `targetScore`
 * (already on the template scale). `tutor_only` criteria are untouched
 * (pinned at `max`, excluded from the sum). Drift from rounding is
 * absorbed into the largest-max AI-graded criterion. Pure — returns a
 * new array.
 *
 * Voice-Speaking MVP TASK-3 (2026-05-27). Extracted so the grading
 * pipeline can RE-normalize after a verdict downgrade changes the
 * effective score (P1 #3, review of 2026-05-27).
 */
function normalizeAiGradableScores(
  items: GuidedCriteriaItem[],
  targetScore: number,
): GuidedCriteriaItem[] {
  const out = items.map((it) => ({ ...it }));
  const aiIdx = out
    .map((it, idx) => ({ it, idx }))
    .filter(({ it }) => it.kind !== "tutor_only");
  if (aiIdx.length === 0) return out;

  const target = Math.max(0, targetScore);
  const aiSum = aiIdx.reduce((sum, { it }) => sum + it.score, 0);

  if (Math.abs(aiSum - target) > CRITERIA_SUM_TOLERANCE) {
    if (aiSum > 0) {
      const factor = target / aiSum;
      for (const { it, idx } of aiIdx) {
        out[idx] = { ...it, score: Math.min(it.max, roundToTenth(it.score * factor)) };
      }
    } else if (target > 0) {
      const totalMax = aiIdx.reduce((sum, { it }) => sum + it.max, 0);
      if (totalMax > 0) {
        for (const { it, idx } of aiIdx) {
          out[idx] = {
            ...it,
            score: Math.min(it.max, roundToTenth((it.max / totalMax) * target)),
          };
        }
      }
    }

    // Absorb rounding drift into the largest-max AI-graded criterion.
    const newSum = aiIdx.reduce((sum, { idx }) => sum + out[idx].score, 0);
    const drift = roundToTenth(target - newSum);
    if (Math.abs(drift) >= 0.1) {
      let largestIdx = -1;
      let largestMax = -Infinity;
      for (const { idx } of aiIdx) {
        if (out[idx].max > largestMax) {
          largestMax = out[idx].max;
          largestIdx = idx;
        }
      }
      if (largestIdx >= 0) {
        const next = out[largestIdx].score + drift;
        out[largestIdx] = {
          ...out[largestIdx],
          score: Math.max(0, Math.min(out[largestIdx].max, roundToTenth(next))),
        };
      }
    }
  }

  return out;
}

/**
 * RE-normalize an already-built breakdown to a NEW effective score (task
 * scale). Used by `runStudentAnswerGrading` after a CORRECT→ON_TRACK
 * downgrade reduces the persisted score below `result.ai_score` — without
 * this, Σ criteria would drift from the stored `ai_score` (P1 #3).
 *
 * Voice-Speaking MVP TASK-3 (2026-05-27, review fix).
 */
export function renormalizeCriteriaToScore(
  items: GuidedCriteriaItem[] | null | undefined,
  effectiveAiScoreTaskScale: number | null,
  maxScore: number,
): GuidedCriteriaItem[] | null {
  if (!Array.isArray(items) || items.length === 0) return null;
  if (effectiveAiScoreTaskScale == null || !Number.isFinite(effectiveAiScoreTaskScale)) {
    return items;
  }
  const aiGradableMax = sumAiGradableMax(items);
  const target = mapAiScoreToTemplateScale(effectiveAiScoreTaskScale, maxScore, aiGradableMax);
  return normalizeAiGradableScores(items, target);
}

/**
 * Voice-Speaking MVP TASK-3 (2026-05-27): validate + normalize AI's
 * per-criterion breakdown.
 *
 * Aggregation model (review fix 2026-05-27, P1 #2):
 *   - ONLY additive (sum) rubrics reach here. The resolver returns a
 *     non-null `criteria_breakdown_template` ONLY for sum-aggregated
 *     formats (DELF écrite/orale, ЕГЭ / ОГЭ letter+essay+monologue).
 *     IELTS (band AVERAGE, not sum) returns a null template → no breakdown,
 *     graceful degradation to overall `ai_score`. See languages-ege.ts.
 *   - The breakdown lives on the TEMPLATE scale (real exam criterion maxes).
 *     `ai_score` (task scale, bounded by `maxScore`) is remapped to the
 *     AI-gradable template scale via `mapAiScoreToTemplateScale` before
 *     normalization, so the footer (Σ AI-graded score / Σ AI-graded max)
 *     is always internally consistent regardless of `max_score`.
 *
 * Contract:
 *   - Each item: {label, score (0..max), max, comment, kind}.
 *   - Labels fuzzy-matched against `template`; ordinal fallback so a
 *     mislabeled criterion isn't dropped. Missing criteria filled at 0.
 *   - `tutor_only` criteria (phonétique) pinned at `max`, EXCLUDED from
 *     the sum (rendered as informational «оценивает репетитор» rows).
 *   - Σ AI-graded score == remapped ai_score (± CRITERIA_SUM_TOLERANCE),
 *     else proportional rescale + drift absorption.
 *   - All scores rounded to 0.1 (.claude/rules/40-homework-system.md).
 *   - Returns null when template is empty/null (subject without rubric).
 */
function sanitizeCriteriaBreakdown(
  parsed: unknown,
  template: SubjectCriterionTemplate[] | null | undefined,
  aiScore: number | null,
  maxScore: number,
): GuidedCriteriaItem[] | null {
  if (!template || template.length === 0) return null;

  const rawItems = Array.isArray(parsed) ? parsed : [];
  const used = new Set<number>();
  const slots: Array<GuidedCriteriaItem | null> = new Array(template.length).fill(null);

  for (const raw of rawItems) {
    if (!raw || typeof raw !== "object") continue;
    const obj = raw as Record<string, unknown>;
    const label = sanitizeCriterionLabel(obj.label);
    if (!label) continue;
    const match = matchTemplateEntry(template, label, used);
    if (!match) continue;
    used.add(match.index);

    const isTutorOnly = match.entry.kind === "tutor_only";
    const maxValue = match.entry.max;
    let scoreValue = toNumber(obj.score) ?? 0;
    if (scoreValue < 0) scoreValue = 0;
    if (scoreValue > maxValue) scoreValue = maxValue;
    if (isTutorOnly) scoreValue = maxValue; // AI must not penalize tutor_only.

    slots[match.index] = {
      label: match.entry.label,
      max: maxValue,
      score: roundToTenth(scoreValue),
      comment: sanitizeCriterionComment(obj.comment),
      kind: isTutorOnly ? "tutor_only" : "ai",
    };
  }

  // Fill missing slots (AI omitted a criterion) — score 0 with empty comment.
  // For tutor_only criteria with no AI output, set score=max (no penalty).
  for (let i = 0; i < template.length; i += 1) {
    if (slots[i]) continue;
    const entry = template[i];
    slots[i] = {
      label: entry.label,
      max: entry.max,
      score: entry.kind === "tutor_only" ? entry.max : 0,
      comment: "",
      kind: entry.kind === "tutor_only" ? "tutor_only" : "ai",
    };
  }

  const items = slots.filter((s): s is GuidedCriteriaItem => s !== null);

  if (aiScore == null || !Number.isFinite(aiScore)) return items;

  // Remap ai_score (task scale) → AI-gradable template scale, then normalize.
  const aiGradableMax = sumAiGradableMax(items);
  const target = mapAiScoreToTemplateScale(aiScore, maxScore, aiGradableMax);
  return normalizeAiGradableScores(items, target);
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
  // Both direct (vrsseotrfmsxpbciyqzc.supabase.co) and proxy (api.sokratai.ru)
  // signed URLs are valid — same JWT signing key. Validate against both hosts
  // because after Phase B migration, frontend stores proxy URLs in DB but
  // server-side fetches may convert them back to direct for performance.
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  return Boolean(
    (supabaseUrl && url.startsWith(`${supabaseUrl}/storage/v1/object/sign/`)) ||
    url.startsWith(`${SUPABASE_PROXY_URL}/storage/v1/object/sign/`),
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
    // Server-to-server fetch: convert proxy URL to direct for lower latency.
    // Both URLs work (same JWT), but direct skips US -> RU -> US roundtrip.
    const fetchUrl = rewriteToDirect(trimmed);
    const response = await fetch(fetchUrl);
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

interface SanitizeCheckScoring {
  checkFormat?: EvaluateStudentAnswerParams["checkFormat"];
  maxScore: number;
  /**
   * Voice-Speaking MVP TASK-3 (2026-05-27): if non-null/non-empty, parse
   * `parsed.criteria_breakdown` against this template (validate labels,
   * clamp scores, normalize sum to `ai_score`). NULL for non-language /
   * numeric subjects → `criteria_breakdown` stays null.
   */
  criteriaTemplate?: SubjectCriterionTemplate[] | null;
}

function sanitizeCheckResult(
  parsed: Record<string, unknown>,
  correctAnswer: string | null,
  scoring: SanitizeCheckScoring,
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
    const aiScoreShort = verdict === "CORRECT" ? maxScore : 0;
    return {
      verdict,
      feedback,
      confidence,
      error_type,
      ai_score: aiScoreShort,
      ai_score_comment: null,
      criteria_breakdown: sanitizeCriteriaBreakdown(
        parsed.criteria_breakdown,
        scoring.criteriaTemplate,
        aiScoreShort,
        maxScore,
      ),
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
    criteria_breakdown: sanitizeCriteriaBreakdown(
      parsed.criteria_breakdown,
      scoring.criteriaTemplate,
      ai_score,
      maxScore,
    ),
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
      `БАЛЛ ПО КРИТЕРИЯМ ФИПИ: верни ai_score в диапазоне 0..${maxScore} с шагом 0.1.`,
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
/**
 * Phase 8 (2026-05-20): subject-agnostic student identity guidance block.
 *
 * Refactored from Phase 1 single-line «обращайся по имени время от времени».
 * Изменения:
 *   1. **Explicit gender** через `studentGender` param (Phase 8 new):
 *      - 'male' → инструкция: «ты подставил / ты молодец / ты решил».
 *      - 'female' → «ты подставила / ты молодец / ты решила».
 *      - null → нейтральные формы (или AI guess by name as fallback).
 *      Решает проблему latin-spelling русских имён (Anastasiia → AI guess
 *      может ошибиться → wrong gender → unnatural Russian).
 *
 *   2. **Frequency cap** более явный: «1-2 сообщения из 5» вместо vague
 *      «время от времени» — AI tends to over-apply soft signals.
 *
 *   3. **Praise variation**: explicit список похвал, AI выбирает разные.
 *      Защита от mode-collapse на «Молодец!». Инструкция «не повторяй одну
 *      и ту же похвалу в 2 подряд сообщениях».
 *
 *   4. **Placement** (caller site): block теперь инжектируется в **начало**
 *      systemContent (сразу после rubric.role), не в конец. Phase 1-2-7
 *      сделали prompt очень длинным; instruction в конце тонет в noise.
 *
 * Returns "" if both name AND gender are absent — каноничный fallback.
 */
function buildStudentNameGuidance(
  studentName: string | null | undefined,
  studentGender: "male" | "female" | null = null,
): string {
  const trimmed = typeof studentName === "string" ? studentName.trim() : "";
  if (!trimmed && !studentGender) return "";

  const lines: string[] = [""];
  if (trimmed) {
    lines.push(`Имя ученика: ${trimmed}.`);
  }

  // Frequency cap — explicit number, не soft signal.
  lines.push(
    "- Обращайся по имени иногда (примерно в 1-2 сообщениях из 5, не в каждом — звучит навязчиво). Хорошие моменты для имени: приветствие в начале задачи, поздравление при правильном ответе. В остальных сообщениях — без имени.",
  );

  // Gender-aware conjugation — EXPLICIT instruction, не AI guess.
  if (studentGender === "female") {
    lines.push(
      "- Пол ученика: ЖЕНСКИЙ. Используй женский род для глаголов прошедшего времени и прилагательных: «ты подставила», «ты решила», «ты написала», «ты допустила ошибку», «ты молодец», «ты внимательная». Не используй мужской род даже если имя звучит иностранно.",
    );
  } else if (studentGender === "male") {
    lines.push(
      "- Пол ученика: МУЖСКОЙ. Используй мужской род: «ты подставил», «ты решил», «ты написал», «ты допустил ошибку», «ты молодец», «ты внимательный». Не используй женский род даже если имя звучит иностранно.",
    );
  } else {
    lines.push(
      "- Пол ученика не указан. Используй гендер-нейтральные формы: «ты справился/справилась», «получилось», «есть прогресс», «верно подмечено», «отличный ход», «молодец» — либо безличные конструкции («можно решить так…», «здесь нужна формула…»). Не угадывай пол по имени — лучше нейтрально.",
    );
  }

  // Praise variation — explicit list, защита от mode-collapse.
  lines.push(
    "- При похвале (правильный ответ, удачный шаг) ВАРЬИРУЙ фразы. Выбирай из: «Молодец», «Отлично», «Точно», «Верно», «Грамотно», «Хороший ход», «Здорово подмечено», «То, что нужно», «Класс», «Правильно мыслишь». НЕ повторяй одну и ту же похвалу в двух подряд сообщениях. Лучше короткая разная похвала, чем длинная одинаковая.",
  );

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
  // Phase 8 (2026-05-20): teraz pass gender + placement в начало systemContent.
  const studentNameGuidance = buildStudentNameGuidance(params.studentName, params.studentGender ?? null);

  // Phase 2 (2026-05-15): subject-rubric resolver — provides per-subject
  // role + ФИПИ / DELF / IELTS methodology block + tutor_rubric override.
  // Replaces single-line `Предмет: X` from Phase 1 with full grading rubric.
  const rubric: SubjectRubric = resolveSubjectRubric({
    subject: params.subject,
    exam_type: params.examType,
    kim_number: params.kimNumber,
    task_kind: params.taskKind ?? (params.checkFormat === "detailed_solution" ? "extended" : "numeric"),
    cefr_level: params.cefrLevel ?? null,
    feedback_language: params.feedbackLanguage ?? null,
    task_text: params.taskText,
    tutor_rubric: params.rubricText,
  });

  // Voice-Speaking MVP TASK-3 (2026-05-27): per-criterion breakdown for
  // language subjects (DELF / ЕГЭ EN / IELTS / ОГЭ). When the resolver
  // returns a template, the prompt asks AI to populate `criteria_breakdown`
  // alongside `ai_score`. NULL/empty → no breakdown block, JSON schema
  // stays Phase 2 (физика / математика / others — output без criteria).
  const criteriaTemplate = rubric.criteria_breakdown_template ?? null;
  const hasCriteriaTemplate = Array.isArray(criteriaTemplate) && criteriaTemplate.length > 0;
  const criteriaPromptBlock = hasCriteriaTemplate
    ? [
        "",
        "ПОКРИТЕРИАЛЬНЫЙ РАЗБОР (ОБЯЗАТЕЛЬНО для этой задачи):",
        "Помимо ai_score разложи балл по перечисленным критериям. Используй ТОЧНО эти label'ы и max-значения:",
        ...criteriaTemplate!.map((c) =>
          c.kind === "tutor_only"
            ? `- "${c.label}" — max ${c.max} (ОЦЕНИВАЕТ РЕПЕТИТОР НА СЛУХ; для тебя score = max, comment = "Оценивает репетитор на слух").`
            : `- "${c.label}" — max ${c.max}.`,
        ),
        "Правила:",
        "- Включи ВСЕ перечисленные критерии (даже если score = 0).",
        "- label должен совпадать с указанным дословно (включая регистр и знаки препинания).",
        "- score — число от 0 до max с шагом 0.1.",
        "- max — указанный максимум (повтори его в каждом объекте).",
        "- comment — 1 короткое предложение по-русски, почему такой балл (без LaTeX, без цитирования эталона дословно).",
        "- Σ score (без tutor_only) = ai_score. Если разойдётся — сервер нормализует.",
      ]
    : [];

  const criteriaJsonSchema = hasCriteriaTemplate
    ? '{"verdict":"CORRECT"|"ON_TRACK"|"INCORRECT","feedback":"...","confidence":0.0-1.0,"error_type":"...","ai_score":0,"ai_score_comment":null,"criteria_breakdown":[{"label":"...","score":0,"max":0,"comment":"..."}]}'
    : '{"verdict":"CORRECT"|"ON_TRACK"|"INCORRECT","feedback":"...","confidence":0.0-1.0,"error_type":"...","ai_score":0,"ai_score_comment":null}';

  const systemContent = [
    rubric.role,
    `Предмет: ${rubric.subject_label}.`,
    rubric.cefr_level ? `Целевой уровень CEFR: ${rubric.cefr_level}.` : "",
    // Phase 11 (2026-05-31): детерминированный язык feedback (язык. subjects).
    rubric.response_language_instruction ?? "",
    // Phase 8 (2026-05-20): student identity guidance в НАЧАЛЕ system prompt
    // (выше priority AI attention). Раньше был в конце — тонул в 100+ строках
    // ФИПИ methodology / anti-spoiler / etc. См. .claude/rules/40-homework-system.md.
    studentNameGuidance,
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
    criteriaJsonSchema,
    "",
    "МЕТОДОЛОГИЯ ОЦЕНКИ ПО ПРЕДМЕТУ (используй ПРИ выставлении ai_score и распределении баллов по элементам):",
    rubric.methodology,
    rubric.tutor_rubric_active
      ? "ВЫШЕ — критерии от репетитора имеют ПРИОРИТЕТ. Если они конфликтуют со стандартной методологией, следуй tutor."
      : "",
    ...criteriaPromptBlock,
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
    // Note: studentNameGuidance moved to top of systemContent (Phase 8 placement).
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

  // Phase 2 (2026-05-15): subject-rubric resolver gives role / methodology /
  // hint_examples / fallback_hint in one call. Replaces Phase 1 helper switches.
  // Methodology block carries ФИПИ / DELF / IELTS criteria (and tutor_rubric
  // when set) — AI uses it to score with the same rubric tutor would apply.
  const rubric: SubjectRubric = resolveSubjectRubric({
    subject: params.subject,
    exam_type: params.examType,
    kim_number: params.kimNumber,
    task_kind: params.taskKind ?? "extended",
    cefr_level: params.cefrLevel ?? null,
    feedback_language: params.feedbackLanguage ?? null,
    task_text: params.taskText,
    tutor_rubric: params.rubricText,
  });

  const systemContent = [
    rubric.role,
    `Предмет: ${rubric.subject_label}.`,
    rubric.cefr_level ? `Целевой уровень CEFR: ${rubric.cefr_level}.` : "",
    // Phase 11 (2026-05-31): детерминированный язык feedback (язык. subjects).
    rubric.response_language_instruction ?? "",
    // Phase 8 (2026-05-20): student identity guidance в НАЧАЛЕ system prompt
    // (после role/subject/CEFR, перед task content). Раньше был в конце —
    // тонул в 80+ строках hint level rules + ФИПИ methodology. См. .claude/rules/40-homework-system.md.
    buildStudentNameGuidance(params.studentName, params.studentGender ?? null),
    "",
    "УРОВЕНЬ ПОДСКАЗКИ: 1/3",
    "- Level 1 (nudge): одним коротким вопросом направь внимание на ключевое правило, приём или элемент условия",
    "- Level 2 (hint): назови правило/формулу/приём, которые применимы, но не решай за ученика",
    "- Level 3 (big hint): покажи подход с частичной подстановкой, но не доводи до финального ответа",
    "",
    "КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО использовать фразы:",
    ...FORBIDDEN_HINT_PROMPT_LINES.map((line) => `- ${line}`),
    "- любые общие фразы без привязки к содержанию этой задачи",
    `- любые упоминания понятий, законов или правил, не относящихся к предмету «${rubric.subject_label}»`,
    "",
    "ОБЯЗАТЕЛЬНО:",
    rubric.hint_examples,
    "- Если задача на изображении и текст пустой — опиши что видишь и дай подсказку по видимым элементам условия",
    "- Если у тебя недостаточно контекста, лучше задай короткий вопрос о конкретном элементе условия, чем используй шаблонную фразу",
    "- Длина: 1-3 предложения, без воды",
    "- Сохрани сократический тон Level 1: мягко направь ученика к следующему шагу, а не решай за него",
    "- Не раскрывай правильный ответ ученику",
    "",
    "МЕТОДОЛОГИЯ ОЦЕНКИ (для понимания, какие шаги ожидаются в полном решении):",
    rubric.methodology,
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
    // Note: student identity guidance moved to top of systemContent (Phase 8).
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

  // Voice-Speaking MVP TASK-3 (2026-05-27): resolve subject-rubric once here
  // so `sanitizeCheckResult` validates `criteria_breakdown` against the same
  // template that `buildCheckPrompt` ships to the model. Resolver is pure /
  // synchronous, no I/O — double call (buildCheckPrompt also resolves) is
  // cheap and keeps the prompt builder signature unchanged.
  const checkRubric = resolveSubjectRubric({
    subject: params.subject,
    exam_type: params.examType,
    kim_number: params.kimNumber,
    task_kind: params.taskKind ?? (params.checkFormat === "detailed_solution" ? "extended" : "numeric"),
    cefr_level: params.cefrLevel ?? null,
    feedback_language: params.feedbackLanguage ?? null,
    task_text: params.taskText,
    tutor_rubric: params.rubricText,
  });
  const criteriaTemplate: SubjectCriterionTemplate[] | null =
    checkRubric.criteria_breakdown_template ?? null;

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

    // Anti-hallucination guard (mirrors chat/index.ts): if the task condition
    // lives only on an image and that image failed to inline, do NOT call the
    // LLM — it would invent a plausible problem. Fail closed with a friendly
    // CHECK_FAILED so the wrong_answer/score is preserved.
    const expectedTaskImageRefs = (params.taskImageUrls ?? []).filter(
      (u) => typeof u === "string" && u.trim().length > 0,
    ).length;
    const taskTextStr = (params.taskText ?? "").trim();
    const taskTextIsPlaceholder =
      taskTextStr.length === 0 ||
      /\[\s*задача\s+на\s+фото\s*\]|\[\s*task\s+on\s+(?:the\s+)?image\s*\]/i.test(taskTextStr);
    if (expectedTaskImageRefs > 0 && taskImageUrls.length === 0 && taskTextIsPlaceholder) {
      console.error(JSON.stringify({
        event: "guided_check_task_image_missing",
        subject: params.subject,
        task_id: params.taskId ?? null,
        assignment_id: params.assignmentId ?? null,
        expected_images: expectedTaskImageRefs,
        task_text_len: taskTextStr.length,
      }));
      return {
        ...CHECK_FALLBACK,
        feedback:
          "Не удалось загрузить картинку с условием задачи. Это техническая проблема — попробуй ещё раз через минуту. Баллы не списаны.",
        failure_reason: "task_image_missing",
      };
    }

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
      criteriaTemplate,
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
    //
    // Phase 7 round 2 (2026-05-20, ChatGPT-5.5 review P0 #1):
    // Для humanities subjects (russian / literature / english / french / spanish)
    // используем **verbatim span detector** (8+ слов подряд из solution_text)
    // вместо token-overlap detector. Token-level имеет high false-positive
    // на естественном языке (любое латинское слово ≥5 chars значимо, а в
    // French каждое слово латиница). Span-level ловит copy-paste атак
    // (model letter скопирован дословно) но позволяет AI использовать
    // общую лексику. Для non-humanities — token detector как раньше
    // (числа/формулы — unique tokens, false positive минимален).
    //
    // Phase 7 round 1 (commit 985a36c) полностью SKIPPED detector для
    // humanities — это создало architectural gap (см. review verdict P0 #1).
    // Round 2 закрывает его span guard'ом.
    //
    // Telemetry trigger: emit `*_check_skipped_humanities` event только при
    // **effective** solution context (после anchor gate в line 1558-1569
    // image refs могут быть отброшены), не raw `solutionImageUrls`.
    const isHumanitiesContext = isHumanitiesSubject(params.subject);
    const hasEffectiveSolutionContext =
      solutionTextTrimmed.length > 0 || effectiveSolutionImageRefs.length > 0;
    if (isHumanitiesContext && hasEffectiveSolutionContext) {
      console.info(JSON.stringify({
        // Phase 7 round 3 polish (2026-05-20, review P2 #2): renamed
        // от `_skipped_humanities` → `_humanities_verbatim_mode` для
        // symmetry с chat-side event. Detector НЕ skipped — переключается
        // в verbatim span mode (token detector replaced, не disabled).
        event: "check_leak_check_humanities_verbatim_mode",
        subject: params.subject,
        verdict: result.verdict,
        has_solution_text: solutionTextTrimmed.length > 0,
        detector: "verbatim_span",
      }));
    }
    if (
      result.verdict !== "CHECK_FAILED"
      && (params.solutionText || (params.solutionImageUrls?.length ?? 0) > 0)
    ) {
      // Subject-aware leak detection:
      //   humanities → verbatim span (8+ contiguous words copy-paste)
      //   non-humanities → token-based (numbers/formulas overlap)
      const detectLeak = (text: string | null | undefined): boolean => {
        if (!text) return false;
        if (isHumanitiesContext) {
          return containsVerbatimSpan(text, params.solutionText, params.taskText);
        }
        return outputContainsSolutionLeak(text, params.solutionText, params.taskText);
      };
      const feedbackLeaks = detectLeak(result.feedback ?? "");
      const commentLeaks = detectLeak(result.ai_score_comment ?? "");
      if (feedbackLeaks || commentLeaks) {
        console.warn(JSON.stringify({
          event: "check_solution_leak_rejected",
          subject: params.subject,
          retry: 1,
          feedback_leak: feedbackLeaks,
          comment_leak: commentLeaks,
        }));

        // Phase 7 round 2: retry prompt subject-aware. Для humanities — «не
        // цитируй большие фрагменты дословно» (verbatim copy-paste atak); для
        // physics/math — «не цитируй числа/формулы». Старый prompt был
        // hardcoded физическим — confused AI на humanities task.
        const retryInstruction = isHumanitiesContext
          ? "Предыдущая версия feedback/ai_score_comment содержала длинный фрагмент дословно из эталонного решения репетитора. " +
            "Перепиши своими словами, сохраняя смысл feedback'а — не цитируй 8+ слов подряд из эталона. " +
            "Можно использовать общую лексику предмета, но без копирования целых предложений или больших фраз. " +
            "Верни тот же JSON без markdown-обёрток."
          : "Предыдущая версия feedback/ai_score_comment цитировала числа или формулы из эталонного решения репетитора. " +
            "Перепиши так, чтобы оставить вердикт и краткое направление без цитирования конкретных чисел или выражений из эталона. " +
            "Верни тот же JSON без markdown-обёрток.";
        const retryMessages: LovableMessage[] = [...messages, {
          role: "user",
          content: retryInstruction,
        }];
        try {
          const retryParsed = await callLovableJson(retryMessages, "guided_check");
          const retryResult = sanitizeCheckResult(retryParsed, params.correctAnswer, {
            checkFormat: params.checkFormat,
            maxScore: params.maxScore,
            criteriaTemplate,
          });
          // Same subject-aware detection on retry output.
          const retryFeedbackLeaks = detectLeak(retryResult.feedback ?? "");
          const retryCommentLeaks = detectLeak(retryResult.ai_score_comment ?? "");
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
            // Scrub feedback / comment to a safe SUBJECT-AWARE fallback;
            // keep verdict + ai_score. Phase 7 (2026-05-16): заменили
            // hardcoded физическую фразу на `buildValidatedFallbackHint`
            // которая возвращает subject-appropriate fallback для всех
            // 11 subjects (physics/maths/russian/etc.).
            result = {
              ...result,
              feedback: feedbackLeaks
                ? buildValidatedFallbackHint({
                    taskText: params.taskText,
                    subject: params.subject,
                    hasImage: (params.taskImageUrls?.length ?? 0) > 0,
                  })
                : result.feedback,
              ai_score_comment: commentLeaks ? null : result.ai_score_comment,
            };
          }
        } catch (retryErr) {
          console.warn("guided_check_leak_retry_error", {
            error: retryErr instanceof Error ? retryErr.message : String(retryErr),
          });
          // Same SUBJECT-AWARE scrubbing fallback as when retry still leaks.
          // Phase 7 (2026-05-16).
          result = {
            ...result,
            feedback: feedbackLeaks
              ? buildValidatedFallbackHint({
                  taskText: params.taskText,
                  subject: params.subject,
                  hasImage: (params.taskImageUrls?.length ?? 0) > 0,
                })
              : result.feedback,
            ai_score_comment: commentLeaks ? null : result.ai_score_comment,
          };
        }
      }

      // Review fix 2026-05-27 (P1 #1): criteria_breakdown comments are
      // student-facing too, but the feedback/ai_score_comment retry above
      // does NOT cover them. Scrub (blank) any criterion comment that leaks
      // the tutor solution — keep label/score/max so the breakdown table
      // stays intact, just without the leaking rationale. Independent of
      // the feedback retry (scores never change). Same subject-aware
      // detector (humanities verbatim span / non-humanities token overlap).
      if (Array.isArray(result.criteria_breakdown) && result.criteria_breakdown.length > 0) {
        let scrubbedCount = 0;
        const scrubbed = result.criteria_breakdown.map((item) => {
          if (item.comment && detectLeak(item.comment)) {
            scrubbedCount += 1;
            return { ...item, comment: "" };
          }
          return item;
        });
        if (scrubbedCount > 0) {
          console.warn(JSON.stringify({
            event: "check_criteria_comment_leak_scrubbed",
            subject: params.subject,
            scrubbed_count: scrubbedCount,
          }));
          result = { ...result, criteria_breakdown: scrubbed };
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

    // Anti-hallucination guard: if the task condition lives only on an image
    // and we failed to inline it, do NOT call the LLM for a hint — it would
    // invent a plausible problem. Return a deterministic technical message.
    const expectedTaskImageRefsHint = (params.taskImageUrls ?? []).filter(
      (u) => typeof u === "string" && u.trim().length > 0,
    ).length;
    const taskTextStrHint = (params.taskText ?? "").trim();
    const taskTextIsPlaceholderHint =
      taskTextStrHint.length === 0 ||
      /\[\s*задача\s+на\s+фото\s*\]|\[\s*task\s+on\s+(?:the\s+)?image\s*\]/i.test(taskTextStrHint);
    if (
      expectedTaskImageRefsHint > 0 &&
      taskImageUrls.length === 0 &&
      taskTextIsPlaceholderHint
    ) {
      console.error(JSON.stringify({
        event: "guided_hint_task_image_missing",
        subject: params.subject,
        expected_images: expectedTaskImageRefsHint,
        task_text_len: taskTextStrHint.length,
        ...telemetryMeta,
      }));
      return {
        hint:
          "Не удалось загрузить картинку с условием задачи. Попробуй ещё раз через минуту — это техническая проблема, не твоя ошибка.",
      };
    }

    const messages = buildHintPrompt({
      ...params,
      taskImageUrls,
      rubricImageUrls,
      solutionImageUrls,
      studentImageUrls,
    });
    const parsed = await callLovableJson(messages, "guided_hint");
    const firstHint = sanitizeHintText(parsed.hint, params.correctAnswer);
    // Phase 7 round 2 (2026-05-20): pass subject → getGeneratedHintCheck
    // выбирает verbatim span detector для humanities (вместо token detector
    // который false positive'ит на естественном языке).
    const firstCheck = getGeneratedHintCheck(firstHint, params.solutionText, params.taskText, params.subject);

    if (firstCheck.ok) {
      console.log("guided_hint_success", { hint_length: firstHint.length, attempt: 1 });
      return { hint: firstHint };
    }

    console.warn(JSON.stringify({
      event: firstCheck.reason === "solution_leak" ? "hint_solution_leak_rejected" : "hint_rejected",
      reason: firstCheck.reason ?? null,
      retry: 1,
      subject: params.subject,
      detector: isHumanitiesSubject(params.subject) ? "verbatim_span" : "token_overlap",
      ...telemetryMeta,
    }));

    // Phase 7 round 2: retry prompt subject-aware. Раньше hardcoded
    // «упомяни конкретную физическую величину или закон» — на French задаче
    // confused AI и вынуждал writing про физику. Now: hint_examples из
    // resolveSubjectRubric (DELF B1 → грамматика/лексика/структура письма;
    // physics → величина/закон; etc.).
    let retryExamples = "";
    try {
      const retryRubric = resolveSubjectRubric({
        subject: params.subject ?? null,
        exam_type: params.examType ?? null,
        kim_number: params.kimNumber ?? null,
        task_kind: params.taskKind ?? "extended",
        cefr_level: params.cefrLevel ?? null,
        feedback_language: params.feedbackLanguage ?? null,
        task_text: params.taskText ?? null,
        tutor_rubric: null,
      });
      if (retryRubric.hint_examples && retryRubric.hint_examples.trim().length > 0) {
        retryExamples = retryRubric.hint_examples;
      }
    } catch (rubricErr) {
      console.warn(JSON.stringify({
        event: "hint_retry_rubric_resolve_failed",
        subject: params.subject,
        error: rubricErr instanceof Error ? rubricErr.message : String(rubricErr),
      }));
    }

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
        (retryExamples
          ? `Перепиши подсказку с учётом следующих ориентиров для этого предмета:\n${retryExamples}\n`
          : "Перепиши подсказку так, чтобы она направляла к ключевому понятию или приёму ЭТОЙ задачи. ") +
        "1-3 предложения, без общих фраз, без правильного ответа и без дословного цитирования эталонного решения (особенно избегай повторения 8+ слов подряд из эталона).",
    });

    const retryParsed = await callLovableJson(retryMessages, "guided_hint");
    const secondHint = sanitizeHintText(retryParsed.hint, params.correctAnswer);
    const secondCheck = getGeneratedHintCheck(secondHint, params.solutionText, params.taskText, params.subject);

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
      subject: params.subject,
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
      subject: params.subject,
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
