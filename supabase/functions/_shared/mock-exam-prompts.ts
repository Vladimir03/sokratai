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

// Phase 4 (2026-05-15): subject-rubric integration. Reuse the same ФИПИ 2026
// methodology that powers homework guided chat (physics-ege.ts, math-ege.ts,
// chemistry-ege.ts, languages-ege.ts). Mock-exam-grade becomes the third
// consumer of resolveSubjectRubric (after guided_ai.ts + chat/index.ts).
import { resolveSubjectRubric } from "./subject-rubrics/index.ts";

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
  /** 1-3 предложения tutor-only операт. заметки. Может содержать ссылки на эталон. */
  comment_for_tutor: string;
  /**
   * 2026-06-02 (item 2): детальный разбор «что верно/неверно», видят И УЧЕНИК,
   * И репетитор. Дружелюбный обучающий тон, anti-spoiler (без дословного эталона).
   * Default "" для backward-compat со старыми attempts (re-grade заполнит).
   */
  feedback: string;
  /** Структурированные сигналы: photo_unreadable, kim21_qualitative, etc. */
  flags: string[];
  /**
   * Phase 6 (2026-05-15): additive поле для bulk path. Список индексов фото
   * (в `mock_exam_attempts.part2_bulk_photo_urls` массиве), которые AI
   * assignment-pass привязал к этой задаче. Tutor видит chip «Фото №X из
   * пакета» в Part2TaskCard. Может быть пустым (`[]`) если AI не нашёл
   * подходящего фото — карточка показывает warning «AI не привязал».
   * Для legacy attempts (per-kim photo_url, нет bulk) — поле отсутствует
   * / пустое; UI fallback на solution.photo_url.
   */
  assigned_photo_indices?: number[];
}

/**
 * Phase 6 (2026-05-15): результат AI assignment-pass для bulk Часть 2.
 * Single Gemini call с (6 задач + N bulk фото) → JSON mapping kim → photo
 * indices. Каждый photo index может быть assigned to multiple kims (если
 * на одной фотографии 2+ задач), или не assigned никому (попадает в
 * `unassigned` bucket → AI Pass 2 для этой задачи возвращает photo_missing).
 */
export type BulkAssignmentKey = number | "unassigned";
export type BulkAssignmentResult = Record<BulkAssignmentKey, number[]>;

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
  /**
   * Subject + exam_type for Phase 4 subject-rubric integration (2026-05-15).
   * Defaults preserve backward-compat with mock-exams-v1 variant-1 (физика ЕГЭ).
   * When `mock_exam_variants.subject` колонка появится — caller передаст
   * реальное значение из БД. Сейчас mock-exam-grade hardcoded `'physics' + 'ege'`.
   */
  subject?: string;
  exam_type?: "ege" | "oge";
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

// ─── Subject helpers (Фаза 2, 2026-07-20) ───────────────────────────────────
// Локальная карта лейблов (конвенция «mirror locally»: Deno не импортирует
// src/types/homework.ts; зеркала уже живут в guided_ai.ts и chat/index.ts).
const SUBJECT_LABELS_MOCK: Record<string, string> = {
  maths: "Математика",
  physics: "Физика",
  informatics: "Информатика",
  russian: "Русский язык",
  literature: "Литература",
  history: "История",
  social: "Обществознание",
  english: "Английский язык",
  french: "Французский язык",
  spanish: "Испанский язык",
  chemistry: "Химия",
  biology: "Биология",
  geography: "География",
  other: "Предмет",
};

function mockSubjectLabel(subject: string | null | undefined): string {
  return SUBJECT_LABELS_MOCK[subject ?? "physics"] ?? "Предмет";
}

/** Физика ЕГЭ №21 — качественная задача со спец-рубрикой. Только физика:
 *  у других предметов КИМ 21 — обычная задача Части 2 (напр. обществознание). */
function isPhysicsQualitative21(kimNumber: number, subject: string | null | undefined): boolean {
  return kimNumber === 21 && (subject ?? "physics") === "physics";
}

// ─── Prompt builders ────────────────────────────────────────────────────────

/**
 * Build Phase 1 ФИПИ-style criteria block. №21 is a qualitative task with a
 * different rubric (3 balls по полноте объяснения) — the spec lives in the
 * 208-page methodichka but Phase 1 captures it in 4 lines.
 *
 * Фаза 2 (2026-07-20): subject-гейт — физика получает БАЙТ-В-БАЙТ прежние
 * блоки (нулевая регрессия пилота); не-физика — нейтральную трактовку
 * elements_check (frozen JSON-shape I-IV НЕ меняется).
 */
function buildCriteriaBlock(kimNumber: number, maxScore: number, subject?: string | null): string {
  if ((subject ?? "physics") !== "physics") {
    return [
      `КРИТЕРИИ ОЦЕНКИ (для №${kimNumber}, 0..${maxScore} баллов):`,
      "Оценивай по ПОЛНОЙ МЕТОДОЛОГИИ предмета выше — она источник правды для балла.",
      "Поля elements_check трактуй как обобщённые элементы решения:",
      "I. Верный метод / подход к решению.",
      "II. Ход решения / аргументация без существенных ошибок.",
      "III. Выкладки, примеры или обоснования выполнены корректно.",
      "IV. Получен верный итоговый ответ / вывод.",
      "",
      `Если элемент частично выполнен — отметь false и упомяни в comment_for_tutor. Балл не выше ${maxScore}.`,
    ].join("\n");
  }

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

  // Phase 4 (2026-05-15): subject-rubric resolver gives role + methodology
  // (full ФИПИ 2026 для № 21-26 включая № 21 качественную + № 22-23 / № 24-25
  // ФИПИ I-IV + № 26 Критерий 1 + Критерий 2). Backward-compat defaults =
  // 'physics' / 'ege' для mock-exams-v1 variant-1.
  const rubric = resolveSubjectRubric({
    subject: input.subject ?? "physics",
    exam_type: input.exam_type ?? "ege",
    kim_number: input.kim_number,
    task_kind: "extended",
    task_text: input.task_text,
    tutor_rubric: null,
  });

  const systemContent = [
    rubric.role,
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
    // Полная ФИПИ 2026 методология (источник: physics-ege.ts → KIM_METHODOLOGIES[№ 21-26]).
    // Для № 21: 3-балльная качественная rubric с 3 элементами (формулировка + объяснение + явления).
    // Для № 22-23: ФИПИ I-IV (2 балла), элементы законы / обозначения / преобразования / ответ с единицами.
    // Для № 24-25: ФИПИ I-IV (3 балла), плюс case «отсутствует одна формула — 1 балл».
    // Для № 26: Критерий 1 (обоснование, 1 балл) + Критерий 2 (расчёт как № 24-25, 3 балла).
    "ПОЛНАЯ МЕТОДОЛОГИЯ ОЦЕНКИ (используй для распределения баллов по элементам):",
    rubric.methodology,
    // Strict-criteria-grading (2026-06-29): провод строгости. No-op пока физику
    // (subject hardcode='physics') не валидируем — там grading_discipline=null.
    rubric.grading_discipline ?? "",
    "",
    // Backward-compat slot: legacy buildCriteriaBlock summary всё ещё инжектируется
    // как краткая шпаргалка (для № 21 — спец-правило, для № 22-26 — компакт I-IV).
    // Phase 4 не удаляет — frozen JSON output contract `elements_check` остаётся
    // тем же I/II/III/IV, и краткая summary помогает модели выровнять выход.
    // Фаза 2: subject-гейт внутри — физика байт-в-байт, не-физика — нейтральная трактовка.
    buildCriteriaBlock(input.kim_number, input.max_score, input.subject),
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
    "ВАЖНО (anti-spoiler): comment_for_tutor читает только репетитор — краткая операт. заметка (1-3 предложения).",
    "",
    "ПОЛЕ feedback (видят И УЧЕНИК, И репетитор) — это главный разбор. Требования:",
    "- Детальный, но дружелюбный разбор: что в решении ВЕРНО, что НЕВЕРНО/упущено, на что обратить внимание (2-5 предложений).",
    "- Тон поддерживающий и обучающий (обращение к ученику на «ты»), без сухих инструкций репетитору вроде «снизь балл».",
    "- anti-spoiler: НЕ цитируй эталонное решение дословно и не выдавай готовый ответ целиком — указывай на шаги и идеи своими словами.",
    "- Если фото нечитаемо / решения нет — мягко скажи об этом и попроси перезагрузить фото.",
    "",
    "Верни ТОЛЬКО валидный JSON без markdown-обёрток и лишнего текста:",
    "{",
    "  \"suggested_score\": null | <int 0..max_score>,",
    "  \"confidence\": \"low\" | \"medium\" | \"high\",",
    "  \"elements_check\": { \"I\": bool, \"II\": bool, \"III\": bool, \"IV\": bool },",
    "  \"comment_for_tutor\": \"1-3 коротких предложения почему такой балл (только репетитор)\",",
    "  \"feedback\": \"детальный разбор что верно/неверно для ученика и репетитора (2-5 предложений)\",",
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

// 2026-06-02 (item 2): shared student+tutor разбор — длиннее tutor-комментария.
const MAX_FEEDBACK_LENGTH = 1200;
function sanitizeFeedback(value: unknown): string {
  if (typeof value !== "string") return "";
  const cleaned = value
    .replace(CONTROL_CHARS_RE, "")
    .replace(/`{3,}/g, "")
    .trim();
  return softTruncate(cleaned, MAX_FEEDBACK_LENGTH);
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
  // Фаза 2: optional subject — физ-спец-правило №21 не должно фаериться на
  // КИМ 21 других предметов (у обществознания №21 — обычная задача Части 2).
  // Отсутствие subject = физика (backward-compat со старыми call-sites).
  params: { maxScore: number; kimNumber: number; subject?: string | null },
): MockExamPart2Draft {
  const isQualitative = isPhysicsQualitative21(params.kimNumber, params.subject);

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

  // 2026-06-02 (item 2): shared student+tutor разбор. Default при photo-fail /
  // пустом ответе модели — дружелюбная подсказка ученику (не сухая tutor-фраза).
  const feedbackRaw = sanitizeFeedback(parsed.feedback);
  const feedback = feedbackRaw || (
    photoFlag !== undefined
      ? "Фото решения не распозналось. Перезагрузи более чёткое фото — и я разберу решение."
      : ""
  );

  return {
    suggested_score: suggestedScore,
    confidence,
    elements_check: elementsCheck,
    comment_for_tutor: comment,
    feedback,
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
  params: { maxScore: number; kimNumber: number; subject?: string | null },
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
  // 2026-06-02 (item 2): student+tutor-facing fallback — мягкий тон для ученика.
  const feedbackByReason: Record<MockExamFallbackReason, string> = {
    timeout: "AI не успел проверить за отведённое время. Репетитор проверит решение вручную.",
    invalid_json: "Автопроверка не сработала. Репетитор проверит решение вручную.",
    gateway_error: "Автопроверка временно недоступна. Репетитор проверит решение вручную.",
    no_photo: "Не вижу фото решения по этой задаче — загрузи фото, чтобы получить разбор.",
    image_inline_failed: "Не удалось загрузить фото решения. Перезагрузи более чёткое фото.",
  };

  const flags = [...flagsByReason[reason]];
  if (isPhysicsQualitative21(params.kimNumber, params.subject)) flags.unshift("kim21_qualitative");

  return {
    suggested_score: null,
    confidence: "low",
    elements_check: { I: false, II: false, III: false, IV: false },
    comment_for_tutor: commentByReason[reason],
    feedback: feedbackByReason[reason],
    flags,
  };
}

// ─── Phase 6: Bulk assignment-pass (Часть 2 фото → задача) ──────────────────

/**
 * Meta-info per Часть 2 задаче для bulk assignment-pass. Передаётся в
 * `buildBulkAssignmentPrompt` — AI смотрит на 6 описаний задач + N фото
 * и сопоставляет каждое фото с задачей (или маркирует как 'unassigned').
 */
export interface BulkAssignmentTaskMeta {
  kim_number: number;
  max_score: number;
  /** Короткий заголовок задачи (первые 200 символов task_text для контекста). */
  task_text_preview: string;
}

/**
 * Build prompt для AI assignment-pass — Pass 1 в two-pass bulk pipeline.
 *
 * Vladimir's choice (Phase 6 UX вопрос #1, 2026-05-15): select dropdown
 * UI для tutor override. AI assignment — это just default; tutor может
 * переназначить через `/assign-part2-photos` endpoint + click
 * «Перепроверить AI» для Pass 2 regrading.
 *
 * @param tasksMeta meta всех Часть 2 задач (обычно № 21-26)
 * @param bulkPhotoDataUrls inline `data:image/jpeg;base64,...` URLs
 * @returns LovableMessage[] для callLovableJson; output JSON shape
 *          `{ "21": [0, 1], "22": [2], ..., "unassigned": [3] }`
 */
export function buildBulkAssignmentPrompt(
  tasksMeta: BulkAssignmentTaskMeta[],
  bulkPhotoDataUrls: string[],
  // Фаза 2 (2026-07-20): предмет варианта. Отсутствие = физика — вводная строка
  // и пример JSON для физики остаются БАЙТ-В-БАЙТ прежними (нулевая регрессия).
  subject?: string | null,
): LovableMessage[] {
  const tasksSummary = tasksMeta
    .map((task) => {
      const preview = clampPromptText(task.task_text_preview, 200) || "[см. варианты]";
      return `• Задача №${task.kim_number} (макс. ${task.max_score} баллов): ${preview}`;
    })
    .join("\n");

  const photoIndicesList = bulkPhotoDataUrls
    .map((_, i) => `Фото ${i} (индекс ${i})`)
    .join(", ");

  const effSubject = subject ?? "physics";
  const kims = tasksMeta.map((t) => t.kim_number);
  const kimRangeLabel = kims.length > 0
    ? `№ ${Math.min(...kims)}-${Math.max(...kims)}`
    : "Части 2";
  const introLine = effSubject === "physics"
    ? "Ты — эксперт ЕГЭ по физике. Ученик сдал пробник и приложил пакет фотографий рукописных решений Часть 2 (задачи № 21-26)."
    : `Ты — эксперт-экзаменатор по предмету «${mockSubjectLabel(effSubject)}». Ученик сдал пробник и приложил пакет фотографий рукописных решений Части 2 (задачи ${kimRangeLabel}).`;
  const hintLine = effSubject === "physics"
    ? "- Опирайся на: (a) номер задачи на странице — ученики часто пишут «№21», «к задаче 22», (b) тематика решения — формулы / физические законы / тип расчёта, (c) ссылку на условие."
    : "- Опирайся на: (a) номер задачи на странице — ученики часто пишут номер, (b) тематика решения и его форма (расчёт / текст / аргументация), (c) ссылку на условие.";
  // Пример JSON — из фактических КИМ задач (для физики 21-26 → те же строки).
  const jsonExampleKims = (kims.length > 0 ? kims : [21, 22, 23, 24, 25, 26])
    .map((kim) => `  "${kim}": [<photo_index>, ...],`);

  const systemContent = [
    introLine,
    "Твоя задача: посмотреть на каждое фото и сопоставить его с задачей.",
    "",
    "СПИСОК ЗАДАЧ:",
    tasksSummary,
    "",
    `ФОТО В ПАКЕТЕ (всего ${bulkPhotoDataUrls.length}): ${photoIndicesList}`,
    "",
    "ПРАВИЛА:",
    "- Каждое фото может быть привязано к одной или нескольким задачам (если на странице 2+ задачи).",
    "- Если фото нерелевантно (например, чистая страница, или лист условий, или мусор) — отнеси его в 'unassigned'.",
    hintLine,
    "- Если сомневаешься — отнеси в задачу с наибольшим content overlap, либо в 'unassigned'.",
    "",
    "Верни ТОЛЬКО валидный JSON без markdown-обёрток и лишнего текста:",
    "{",
    ...jsonExampleKims,
    "  \"unassigned\": [<photo_index>, ...]",
    "}",
    "Все индексы — 0-based, без дублирования внутри одного ключа.",
  ].join("\n");

  const userContent: Array<LovableTextPart | LovableImagePart> = [];
  for (const [idx, dataUrl] of bulkPhotoDataUrls.entries()) {
    userContent.push({
      type: "text",
      text: `Фото ${idx} (индекс ${idx}):`,
    });
    userContent.push({ type: "image_url", image_url: { url: dataUrl } });
  }
  userContent.push({
    type: "text",
    text: "Сопоставь каждое фото с задачей в формате JSON выше.",
  });

  return [
    { role: "system", content: systemContent },
    { role: "user", content: userContent },
  ];
}

/**
 * Sanitize raw AI assignment JSON → strict BulkAssignmentResult.
 * Defensive: invalid keys / out-of-range indices / duplicates drop'аются
 * silently. Если result пустой (все задачи без фото) → каждая kim получает
 * `photo_missing` flag в Pass 2 grading.
 */
export function sanitizeBulkAssignmentResult(
  parsed: unknown,
  totalPhotos: number,
  expectedKims: number[],
): BulkAssignmentResult {
  const result: BulkAssignmentResult = { unassigned: [] };
  for (const kim of expectedKims) result[kim] = [];

  if (!isRecord(parsed)) return result;

  const validIndices = new Set<number>();
  for (let i = 0; i < totalPhotos; i++) validIndices.add(i);

  for (const [rawKey, rawValue] of Object.entries(parsed)) {
    if (!Array.isArray(rawValue)) continue;

    const keyTrimmed = rawKey.trim().toLowerCase();
    let targetKey: BulkAssignmentKey | null = null;
    if (keyTrimmed === "unassigned") {
      targetKey = "unassigned";
    } else {
      const kimNum = Number.parseInt(keyTrimmed, 10);
      if (Number.isFinite(kimNum) && expectedKims.includes(kimNum)) {
        targetKey = kimNum;
      }
    }
    if (targetKey === null) continue;

    const seen = new Set<number>();
    for (const item of rawValue) {
      const idx = typeof item === "number"
        ? Math.trunc(item)
        : typeof item === "string"
          ? Number.parseInt(item.trim(), 10)
          : NaN;
      if (!Number.isFinite(idx)) continue;
      if (!validIndices.has(idx)) continue;
      if (seen.has(idx)) continue;
      seen.add(idx);
      result[targetKey].push(idx);
    }
  }

  return result;
}
