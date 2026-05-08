/**
 * Mock Exams v1 — AI Part 2 grading prompts (Phase 1 simplified).
 *
 * Phase 1 contract (per docs/delivery/features/mock-exams-v1/spec.md §5):
 *   - Упрощённый prompt без deep-parsing 208-стр методички ФИПИ.
 *   - 4 элемента I-IV для №22-26 (закон, обозначения, расчёт, ответ + единицы).
 *   - Спец-правило для №21 (3-балльная качественная задача).
 *   - Structured JSON output: { suggested_score, confidence, elements_check,
 *     comment_for_tutor, flags }.
 *
 * Anti-leak invariant: solution_text from mock_exam_variant_tasks.solution_text
 * is tutor-only catalog data. AI uses it as reference but the resulting draft
 * goes into mock_exam_attempt_part2_solutions.ai_draft_json which is rendered
 * ONLY in tutor review surface (TutorMockExamReview). Student-facing endpoints
 * MUST filter ai_draft_json from responses (TASK-13 responsibility, enforced
 * out of this module).
 *
 * AI never publishes to student — это product invariant. Подтверждение балла
 * происходит через tutor approval (mock-exam-tutor-api: POST /attempts/:id/
 * approve-task | approve-all).
 */

// ─── Types (mirrors LovableMessage from homework-api/ai_shared.ts) ──────────
//
// Re-declared locally to keep _shared/ free of cross-function dependencies.
// Shape MUST match homework-api/ai_shared.ts to be wire-compatible with
// callLovableJson — that module owns the canonical type, this is its mirror.

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

// ─── Domain types ───────────────────────────────────────────────────────────

export type MockExamConfidence = "low" | "medium" | "high";

export interface MockExamPart2Draft {
  /** null when photo unreadable / missing — tutor must score manually. */
  suggested_score: number | null;
  confidence: MockExamConfidence;
  /**
   * Per-element check (criteria I-IV из ФИПИ). Для №21 (качественная задача,
   * 3 балла) все 4 ставятся в false — критерии другие; tutor UI должен
   * скрывать чекбоксы для №21.
   */
  elements_check: { I: boolean; II: boolean; III: boolean; IV: boolean };
  /** 1-3 предложения tutor-only обоснования. Может содержать ссылки на эталон. */
  comment_for_tutor: string;
  /** Структурированные сигналы: photo_unreadable, kim21_qualitative, etc. */
  flags: string[];
}

export interface BuildPart2PromptInput {
  kim_number: number;
  max_score: number;
  task_text: string;
  correct_answer: string | null;
  solution_text: string | null;
  /**
   * Pre-inlined data: URLs (e.g. data:image/jpeg;base64,...). Empty array
   * if the task has no photo or all inline attempts failed. Caller decides
   * whether absence of photo should turn into a no_photo flag pre-emptively
   * (we still emit a prompt, but the prompt asks AI to flag missing photo).
   */
  task_image_data_urls: string[];
  /** Pre-inlined data: URLs for the student's photo solutions. */
  student_photo_data_urls: string[];
}

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_TASK_TEXT = 4_000;
const MAX_SOLUTION_TEXT = 6_000;
const MAX_COMMENT_LENGTH = 600;
const MAX_FLAGS = 6;

const VALID_CONFIDENCE = new Set<MockExamConfidence>(["low", "medium", "high"]);

/**
 * Allow-list для flags. Любые другие строковые flag'и от модели
 * сохраняются как есть (max 32 символа), чтобы не терять диагностику,
 * но известные стандартизуются для UI.
 */
export const KNOWN_FLAGS = [
  "photo_unreadable",
  "photo_off_topic",
  "photo_missing",
  "low_handwriting",
  "missing_units",
  "incomplete_solution",
  "calculation_error",
  "kim21_qualitative",
  "ambiguous_grading",
] as const;

// Strip ASCII control characters (matches homework-api/ai_shared.ts normalizeText).
const CONTROL_CHARS_RE = /[\p{Cc}]/gu;

// ─── Helpers ────────────────────────────────────────────────────────────────

function softTruncate(value: string, maxLen: number): string {
  if (value.length <= maxLen) return value;
  const slice = value.slice(0, maxLen);
  const lastSpaceIdx = slice.lastIndexOf(" ");
  const safeSlice = lastSpaceIdx > maxLen * 0.8 ? slice.slice(0, lastSpaceIdx) : slice;
  return `${safeSlice.trim()}\n...[обрезано]`;
}

function clampPromptText(text: string | null | undefined, maxLen: number): string {
  if (!text) return "";
  return softTruncate(
    text
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(CONTROL_CHARS_RE, "")
      .trim(),
    maxLen,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ─── Prompt builders ────────────────────────────────────────────────────────

/**
 * Build Phase 1 ФИПИ-style criteria block. №21 is a qualitative task with a
 * different rubric (3 balls по полноте объяснения) — the spec lives in the
 * 208-page methodichka but Phase 1 captures it in 4 lines.
 */
function buildCriteriaBlock(kimNumber: number, maxScore: number): string {
  const isQualitative = kimNumber === 21;
  if (isQualitative) {
    return [
      `СПЕЦ-ПРАВИЛО ДЛЯ ЗАДАЧИ №21 (качественная, 0..${maxScore} баллов):`,
      "- 3 балла: дан правильный ответ И полное верное объяснение со ссылкой на физический закон или явление.",
      "- 2 балла: дан правильный ответ + объяснение содержит один недочёт или незначительную ошибку.",
      "- 1 балл: дан правильный ответ без объяснения; ИЛИ объяснение содержит существенные ошибки, но направление верное.",
      "- 0 баллов: ответ неверный ИЛИ ответ отсутствует.",
      "",
      "Для №21 elements_check ставь все четыре поля в false — стандартные элементы I-IV не применимы; используй только `flags: [\"kim21_qualitative\"]` и `comment_for_tutor` с обоснованием.",
    ].join("\n");
  }

  return [
    `КРИТЕРИИ ОЦЕНКИ ФИПИ (для №${kimNumber}, упрощённо, 0..${maxScore} баллов):`,
    "I. Записан закон или положение теории, нужное для решения задачи.",
    "II. Введены все буквенные обозначения новых физических величин (формальное «дано»).",
    "III. Выполнены математические преобразования и расчёты с подстановкой числовых значений.",
    "IV. Получен правильный численный ответ с указанием единиц измерения.",
    "",
    `Балл = число выполненных элементов из I-IV (максимум ${maxScore}). Если элемент частично выполнен — отметь false и упомяни в comment_for_tutor.`,
  ].join("\n");
}

export function buildMockExamPart2Prompt(
  input: BuildPart2PromptInput,
): LovableMessage[] {
  const taskText = clampPromptText(input.task_text, MAX_TASK_TEXT);
  const solutionText = clampPromptText(input.solution_text, MAX_SOLUTION_TEXT);
  const correctAnswer = clampPromptText(input.correct_answer, 500);

  const hasTaskImage = input.task_image_data_urls.length > 0;
  const hasStudentPhoto = input.student_photo_data_urls.length > 0;
  const hasSolutionRef = solutionText.length > 0;

  const systemContent = [
    "Ты — эксперт ЕГЭ по физике. Проверяешь развёрнутое решение Части 2 ученика по критериям ФИПИ.",
    "Ты делаешь ЧЕРНОВИК для репетитора — финальный балл всегда подтверждает он.",
    "",
    `ЗАДАЧА №${input.kim_number}, максимальный балл: ${input.max_score}.`,
    `Условие задачи: ${taskText || "[см. изображение]"}`,
    hasTaskImage
      ? "К задаче прикреплено изображение с условием — используй его."
      : "",
    correctAnswer
      ? `Правильный итоговый ответ (для твоей сверки, не цитируй ученику): ${correctAnswer}`
      : "",
    hasSolutionRef
      ? `Эталонное решение от автора варианта (только для твоей сверки логики): ${solutionText}`
      : "",
    "",
    buildCriteriaBlock(input.kim_number, input.max_score),
    "",
    "ВЫЯВЛЕНИЕ ПРОБЛЕМ С ФОТО:",
    "- Если фото нечитаемо, размыто, перевёрнуто, отсутствует решение по этой задаче → suggested_score=null, confidence=low, flags содержит \"photo_unreadable\" или \"photo_off_topic\".",
    "- Если фото явно не относится к этой задаче (другой номер, другая тема) → flags содержит \"photo_off_topic\".",
    "- Если фото вовсе нет → flags содержит \"photo_missing\".",
    "",
    "CONFIDENCE:",
    "- \"high\": решение читаемо, ход прозрачен, оценка по критериям однозначна.",
    "- \"medium\": почерк сложный, но смысл понятен; либо есть один-два неоднозначных шага.",
    "- \"low\": фото плохое, решение незавершённое или сильно расходится с эталоном.",
    "",
    "Дополнительные flags (используй когда применимо): \"low_handwriting\", \"missing_units\", \"incomplete_solution\", \"calculation_error\", \"ambiguous_grading\".",
    "",
    "ВАЖНО (anti-spoiler): comment_for_tutor читает только репетитор, но всё равно держи его кратким (1-3 предложения). Не цитируй эталонное решение дословно — пиши собственными словами.",
    "",
    "Верни ТОЛЬКО валидный JSON без markdown-обёрток и лишнего текста:",
    "{",
    "  \"suggested_score\": null | <int 0..max_score>,",
    "  \"confidence\": \"low\" | \"medium\" | \"high\",",
    "  \"elements_check\": { \"I\": bool, \"II\": bool, \"III\": bool, \"IV\": bool },",
    "  \"comment_for_tutor\": \"1-3 коротких предложения почему такой балл\",",
    "  \"flags\": [\"...\"]",
    "}",
  ].filter(Boolean).join("\n");

  const userContent: Array<LovableTextPart | LovableImagePart> = [];

  // Task images first (anchors AI to the canonical task statement).
  for (const [idx, dataUrl] of input.task_image_data_urls.entries()) {
    userContent.push({
      type: "text",
      text: input.task_image_data_urls.length > 1
        ? `Изображение ${idx + 1} — условие задачи №${input.kim_number}, файл ${idx + 1}.`
        : `Изображение — условие задачи №${input.kim_number}.`,
    });
    userContent.push({ type: "image_url", image_url: { url: dataUrl } });
  }

  if (hasStudentPhoto) {
    const offset = input.task_image_data_urls.length;
    for (const [idx, dataUrl] of input.student_photo_data_urls.entries()) {
      userContent.push({
        type: "text",
        text: input.student_photo_data_urls.length > 1
          ? `Изображение ${offset + idx + 1} — фото решения ученика, файл ${idx + 1}.`
          : `Изображение ${offset + 1} — фото решения ученика.`,
      });
      userContent.push({ type: "image_url", image_url: { url: dataUrl } });
    }
  }

  userContent.push({
    type: "text",
    text: hasStudentPhoto
      ? `Оцени решение ученика по задаче №${input.kim_number} в формате JSON.`
      : "Решение ученика отсутствует (фото не загружено). Верни JSON с suggested_score=null, confidence=low, flags=[\"photo_missing\"].",
  });

  return [
    { role: "system", content: systemContent },
    { role: "user", content: userContent },
  ];
}

// ─── Sanitization ───────────────────────────────────────────────────────────

function toBoundedInt(value: unknown, min: number, max: number): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const rounded = Math.round(value);
    if (rounded < min || rounded > max) return null;
    return rounded;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      const rounded = Math.round(parsed);
      if (rounded < min || rounded > max) return null;
      return rounded;
    }
  }
  return null;
}

function sanitizeFlags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim().slice(0, 32);
    if (!trimmed) continue;
    // Allow underscored kebab/snake — strip everything else.
    const cleaned = trimmed.replace(/[^a-z0-9_]/gi, "_").toLowerCase();
    if (!cleaned) continue;
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
    if (out.length >= MAX_FLAGS) break;
  }
  return out;
}

function sanitizeBoolFlag(value: unknown): boolean {
  return value === true;
}

function sanitizeElementsCheck(value: unknown): MockExamPart2Draft["elements_check"] {
  const fallback = { I: false, II: false, III: false, IV: false };
  if (!isRecord(value)) return fallback;
  return {
    I: sanitizeBoolFlag(value.I),
    II: sanitizeBoolFlag(value.II),
    III: sanitizeBoolFlag(value.III),
    IV: sanitizeBoolFlag(value.IV),
  };
}

function sanitizeConfidence(value: unknown): MockExamConfidence {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase() as MockExamConfidence;
    if (VALID_CONFIDENCE.has(normalized)) return normalized;
  }
  return "low";
}

function sanitizeComment(value: unknown): string {
  if (typeof value !== "string") return "";
  const cleaned = value
    .replace(CONTROL_CHARS_RE, "")
    .replace(/`{3,}/g, "")
    .trim();
  return softTruncate(cleaned, MAX_COMMENT_LENGTH);
}

/**
 * Convert a raw model JSON response into a strict MockExamPart2Draft.
 * Defensive: any malformed field falls back to a low-confidence placeholder
 * so the tutor sees a coherent UI while a follow-up retry can be triggered.
 *
 * Special handling:
 *   - photo_missing flag forces suggested_score=null and confidence=low.
 *   - For №21, suggested_score must be 0..3 (max_score from variant).
 *   - elements_check for №21 is always all-false (rubric differs).
 */
export function sanitizeMockExamPart2Draft(
  parsed: Record<string, unknown>,
  params: { maxScore: number; kimNumber: number },
): MockExamPart2Draft {
  const isQualitative = params.kimNumber === 21;

  const flags = sanitizeFlags(parsed.flags);
  if (isQualitative && !flags.includes("kim21_qualitative")) {
    flags.unshift("kim21_qualitative");
  }

  // Photo-missing / unreadable signals → null score regardless of model output.
  const photoFlag = flags.find((f) =>
    f === "photo_missing" || f === "photo_unreadable" || f === "photo_off_topic"
  );

  const rawScore = toBoundedInt(parsed.suggested_score, 0, params.maxScore);

  const suggestedScore = photoFlag !== undefined ? null : rawScore;

  const confidence = photoFlag !== undefined
    ? "low"
    : sanitizeConfidence(parsed.confidence);

  const elementsCheck = isQualitative
    ? { I: false, II: false, III: false, IV: false }
    : sanitizeElementsCheck(parsed.elements_check);

  const commentRaw = sanitizeComment(parsed.comment_for_tutor);
  const comment = commentRaw || (
    photoFlag !== undefined
      ? "Фото решения нечитаемо или отсутствует — проверь вручную."
      : "AI вернул некорректный JSON — проверь решение вручную."
  );

  return {
    suggested_score: suggestedScore,
    confidence,
    elements_check: elementsCheck,
    comment_for_tutor: comment,
    flags,
  };
}

/**
 * Fallback draft used when the AI gateway times out or returns invalid JSON.
 * Tutor sees confidence=low + an explanatory flag and grades manually.
 */
export type MockExamFallbackReason =
  | "timeout"
  | "invalid_json"
  | "gateway_error"
  | "no_photo"
  | "image_inline_failed";

export function buildFallbackDraft(
  reason: MockExamFallbackReason,
  params: { maxScore: number; kimNumber: number },
): MockExamPart2Draft {
  const flagsByReason: Record<MockExamFallbackReason, string[]> = {
    timeout: ["ai_timeout", "ambiguous_grading"],
    invalid_json: ["ai_invalid_response", "ambiguous_grading"],
    gateway_error: ["ai_gateway_error", "ambiguous_grading"],
    no_photo: ["photo_missing"],
    image_inline_failed: ["photo_unreadable"],
  };
  const commentByReason: Record<MockExamFallbackReason, string> = {
    timeout: "AI не успел проверить за отведённое время — оцени вручную.",
    invalid_json: "AI вернул некорректный ответ — оцени вручную.",
    gateway_error: "AI-шлюз вернул ошибку — оцени вручную.",
    no_photo: "Ученик не загрузил фото решения по этой задаче.",
    image_inline_failed: "Не удалось загрузить фото решения для AI — оцени вручную.",
  };

  const flags = [...flagsByReason[reason]];
  if (params.kimNumber === 21) flags.unshift("kim21_qualitative");

  return {
    suggested_score: null,
    confidence: "low",
    elements_check: { I: false, II: false, III: false, IV: false },
    comment_for_tutor: commentByReason[reason],
    flags,
  };
}
