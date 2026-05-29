// Mock Exams v1 — frontend types.
//
// Spec: docs/delivery/features/mock-exams-v1/spec.md
// Migration: supabase/migrations/20260508120000_mock_exams_v1_schema.sql
//
// IMPORTANT: имена типов начинаются с `MockExamAssignment` / `MockExamAttempt`
// и т.д., НЕ просто `MockExam` — иначе конфликт с legacy `MockExam` в
// src/types/tutor.ts (deprecated, удаляется в TASK-17).

// ─── Enums (string union) ────────────────────────────────────────────────────

export type MockExamMode = 'blank' | 'form' | 'manual_entry';

/**
 * Per-attempt answer method choice (TASK-10 pilot-polish, 2026-05-14).
 *
 * Выбирается **самим учеником** на taking page (modal на первом open'е),
 * НЕ tutor'ом при создании пробника. NULL = ещё не выбрал.
 *
 * - `blank` — Часть 1 ответы на ФИПИ бланке от руки + фото. Часть 1 inputs скрыты.
 * - `form` — Часть 1 цифровой ввод inputs. BlankModeBanner скрыт.
 *
 * Не путать с `MockExamMode` (tutor.assignment.mode) — оно остаётся для tutor info
 * + `'manual_entry'` flow.
 */
export type MockExamAnswerMethod = 'blank' | 'form';
export type MockExamAssignmentStatus = 'draft' | 'active' | 'closed';
export type MockExamAttemptStatus =
  | 'in_progress'
  | 'paused' // AC-P10 (2026-05-25): training-mode multi-session pause
  | 'submitted'
  | 'ai_checking'
  | 'awaiting_review'
  | 'approved'
  | 'manually_entered';

/**
 * AC-P10 (2026-05-25): Режим прохождения пробника (execution mode).
 * - 'simulation': wall-clock timer 4ч, без pause (как реальный ЕГЭ)
 * - 'training': active time only + pause/resume (default)
 *
 * Tutor задаёт default в TutorMockExamCreate; ученик может override в start modal.
 * Immutable после первого start (первая session создана).
 *
 * **Не путать** с `MockExamMode` (line 12, assignment-level: blank|form|manual_entry).
 * Это разные concepts: `MockExamMode` = data collection method (фото бланка vs цифровой
 * ввод), `MockExamExamMode` = timer behavior (wall-clock vs pause/resume).
 */
export type MockExamExamMode = 'simulation' | 'training';

/**
 * AC-P10: Одна сессия работы над пробником. Latest session.ended_at === null
 * ⟺ status === 'in_progress'. При pause закрываем session (ended_at = now);
 * при resume append новую с ended_at=null.
 */
export interface MockExamAttemptSession {
  started_at: string; // ISO timestamp
  ended_at: string | null; // null = open session (in_progress)
}

export type MockExamPart2SolutionStatus =
  | 'awaiting_review'
  | 'tutor_approved'
  | 'tutor_modified';

export type MockExamCheckMode =
  | 'strict'
  | 'ordered'
  | 'unordered'
  | 'multi_choice'
  | 'task20'
  | 'pair'
  | 'manual';

export type MockExamSource = 'tutor' | 'fipi';
export type MockExamType = 'ege_physics' | 'oge_physics';
export type MockExamConfidence = 'low' | 'medium' | 'high';

// ─── Catalog: variants + tasks ───────────────────────────────────────────────

export interface MockExamVariantSummary {
  id: string;
  title: string;
  exam_type: MockExamType;
  source: MockExamSource;
  source_attribution: string | null;
  duration_minutes: number;
  total_max_score: number;
  part1_max: number;
  part2_max: number;
  task_count: number;
}

export interface MockExamVariantTask {
  id: string;
  variant_id: string;
  kim_number: number;
  part: 1 | 2;
  order_num: number;
  task_text: string;
  task_image_url: string | null;
  correct_answer: string | null;
  check_mode: MockExamCheckMode | null;
  max_score: number;
  solution_text: string | null;
  topic: string | null;
}

// ─── AI draft (per Часть 2 task) ────────────────────────────────────────────

export interface MockExamPart2Draft {
  // Phase 6 review-fix P2 #5 (2026-05-15): backend frozen contract допускает
  // `number | null` (null когда AI fails / photo_missing / awaiting_regrade
  // после смены photo assignment). Wire-level alignment с backend
  // `MockExamPart2Draft` в `supabase/functions/_shared/mock-exam-prompts.ts`.
  suggested_score: number | null;
  confidence: MockExamConfidence;
  elements_check: {
    I: boolean;
    II: boolean;
    III: boolean;
    IV: boolean;
  };
  comment_for_tutor: string;
  flags: string[];
  /**
   * Phase 6 (2026-05-15): additive поле для bulk path. Список индексов фото
   * (в `mock_exam_attempts.part2_bulk_photo_urls` массиве), которые AI
   * assignment-pass привязал к этой задаче. Tutor видит chip «Фото №X из
   * пакета» в Part2TaskCard + может переназначить через bulk-gallery
   * select dropdown. Backward compat: для legacy attempts (per-kim
   * photo_url) поле отсутствует / пустое.
   */
  assigned_photo_indices?: number[];
}

/**
 * Phase 6 (2026-05-15) — AI OCR Часть 1 cell (per kim 1-20).
 * Stored в `mock_exam_attempts.ai_part1_ocr_json` JSONB.
 * Tutor видит recognized values pre-filled в Part1BlankReviewPanel input cells.
 * Low confidence клетки помечаются amber border.
 */
export type MockExamPart1OCRConfidence = "low" | "medium" | "high";

export interface MockExamPart1OCRCell {
  /** Recognized answer text (raw, без normalization). null = пустая клетка. */
  value: string | null;
  /** AI уверенность распознавания. */
  confidence: MockExamPart1OCRConfidence;
}

/**
 * TASK-16-R2 fix #4 (2026-05-16): canonical shape `{ cells, __meta }`.
 * Раньше был flat `Record<number, MockExamPart1OCRCell>` с __meta как
 * особый ключ на верхнем уровне — ChatGPT-5.5 review нашёл что failure
 * snapshot писал {cells:{}, raw_response, error, ...} top-level, и frontend
 * показывал green "AI распознал" банер при ошибке.
 *
 * `__meta.status === 'failed'` → frontend рендерит rose warning + retry CTA.
 * `__meta.status === 'success' && recognized_cells === 0` → amber soft warning.
 * `__meta.status === 'success' && recognized_cells > 0` → emerald success.
 */
/**
 * TASK-OCR-3 (2026-05-21): `prompt_mode` additive поле для distinguishing
 * FIPI grid OCR runs ('blank') vs freeform photo OCR runs ('freeform' —
 * тетрадный лист / черновик / скан). Optional для backward compat с
 * pilot attempts из Phase 6 (где field отсутствует).
 */
export type MockExamPart1OCRPromptMode = "blank" | "freeform";

export interface MockExamPart1OCRMetaSuccess {
  status: "success";
  /** Phase 7 / TASK-OCR-3: optional для backward compat с Phase 6 attempts. */
  prompt_mode?: MockExamPart1OCRPromptMode;
  gemini_model: string;
  recognized_cells: number;
  raw_length: number;
  generated_at: string;
}

export interface MockExamPart1OCRMetaFailed {
  status: "failed";
  /** Phase 7 / TASK-OCR-3: optional для backward compat с Phase 6 attempts. */
  prompt_mode?: MockExamPart1OCRPromptMode;
  gemini_model: string;
  error: string;
  raw_response: string | null;
  failed_at: string;
  generated_at: string;
}

export type MockExamPart1OCRMeta =
  | MockExamPart1OCRMetaSuccess
  | MockExamPart1OCRMetaFailed;

export interface MockExamPart1OCRResult {
  /** kim 1-20 → распознанная клетка бланка. Empty `{}` при failure. */
  cells: Record<number, MockExamPart1OCRCell>;
  /** Status + provenance + debug fields. */
  __meta: MockExamPart1OCRMeta;
}

// ─── Assignments ─────────────────────────────────────────────────────────────

export interface MockExamAssignment {
  id: string;
  variant_id: string | null;
  variant_title: string | null;
  tutor_id: string;
  title: string;
  mode: MockExamMode;
  deadline: string | null;
  status: MockExamAssignmentStatus;
  created_at: string;
  /**
   * AC-P10 (2026-05-25): tutor-suggested default execution mode (применяется
   * к новым attempts при первом open). Ученик может override в start modal.
   * Default 'training' для adoption flexibility.
   */
  default_exam_mode?: MockExamExamMode | null;
}

/** List item — assignment + roll-up over assigned attempts. */
export interface MockExamAssignmentListItem extends MockExamAssignment {
  /** Resolved title: variant.title for blank/form; assignment.variant_title for manual_entry. */
  display_title: string;
  /** Resolved exam_type. NULL for manual_entry without variant. */
  exam_type: MockExamType | null;
  attempts_total: number;
  attempts_submitted: number;
  attempts_awaiting_review: number;
  attempts_approved: number;
  /**
   * Назначен но student не открывал (status='in_progress' AND started_at IS NULL).
   * Backend (mock-exam-tutor-api list handler) отделяет этот case от настоящего
   * «в процессе» (started_at IS NOT NULL), чтобы UI правильно показывал
   * «Не приступали» vs «В процессе».
   */
  attempts_not_started: number;
  /**
   * NEW (TASK-11): status='in_progress' AND started_at IS NOT NULL — реально решает.
   * Backend выдаёт явно вместо NaN-prone subtraction формулы на фронте.
   */
  attempts_in_progress?: number;
  /**
   * NEW (TASK-11): «Сдали» = submitted+ai_checking+awaiting_review+approved+manually_entered.
   * Все кто нажал submit. Используется на list page как primary KPI.
   */
  attempts_completed_total?: number;
  /**
   * NEW (TASK-11): «Требует проверки» = submitted+ai_checking+awaiting_review.
   * Сдали, но tutor ещё не подтвердил.
   */
  attempts_pending_review?: number;
}

/**
 * Detail response — assignment + every attempt with student snapshot.
 * `student_display_name` resolved через tutor_students.display_name → profiles.username
 * (auto-generated `telegram_*` / `user_*` отфильтровываются на backend).
 */
export interface MockExamAssignmentDetail extends MockExamAssignment {
  display_title: string;
  exam_type: MockExamType | null;
  duration_minutes: number | null;
  total_max_score: number | null;
  attempts: MockExamAttemptListItem[];
  /**
   * NEW (TASK-11): aggregate counts pre-computed by backend.
   * Frontend reads напрямую, без NaN-prone subtraction. Optional чтобы старый
   * client'ский bundle мог продолжать работать с legacy полями.
   */
  aggregate?: {
    attempts_total: number;
    attempts_in_progress: number;
    attempts_not_started: number;
    attempts_submitted: number;
    attempts_awaiting_review: number;
    attempts_approved: number;
    attempts_completed_total: number;
    attempts_pending_review: number;
  };
}

export interface MockExamAttemptListItem {
  id: string;
  assignment_id: string;
  student_id: string | null;
  anonymous_id: string | null;
  student_display_name: string | null;
  status: MockExamAttemptStatus;
  started_at: string | null;
  submitted_at: string | null;
  total_time_minutes: number | null;
  total_part1_score: number | null;
  total_part2_score: number | null;
  total_score: number | null;
  manual_entered_date: string | null;
  manual_comment: string | null;
  /**
   * NEW (TASK-11): per-attempt answer method (выбран самим учеником в taking modal).
   * - `'blank'` — фото ФИПИ бланка от руки; tutor оценивает Часть 1 вручную через `/part1-manual-score`
   * - `'form'` — цифровой ввод; auto-check сделан при submit
   * - `null` — legacy attempt до миграции 20260514130000, либо ученик ещё не выбрал
   */
  answer_method?: MockExamAnswerMethod | null;
  /**
   * NEW (TASK-16, 2026-05-15): per-task scores для MockExamHeatmap rendering.
   * Backend handleGetAssignment теперь batch-load'ит из mock_exam_attempt_part1_answers
   * и mock_exam_attempt_part2_solutions. Empty arrays для not-started attempts.
   * Anti-leak: НЕ содержит student_answer (form-mode legacy) и НЕ содержит ai_draft_json.
   */
  part1_answers?: Array<{ kim_number: number; earned_score: number | null }>;
  part2_solutions?: Array<{
    kim_number: number;
    tutor_score: number | null;
    status: string;
  }>;
  /**
   * AC-P10 (2026-05-25): immutable execution mode. 'simulation' = wall-clock
   * 4ч без pause; 'training' = active time only + pause/resume. Default training.
   */
  exam_mode?: MockExamExamMode | null;
  /**
   * AC-P10: array of work sessions. Latest.ended_at === null ⟺ status='in_progress'.
   * Tutor использует для «Solo time: X мин в N сессии».
   */
  sessions?: MockExamAttemptSession[] | null;
  /**
   * AC-P10: cached SUM(session.duration_ms) для KPI / sort. Frontend should
   * adjust в running attempts: total_active_ms + (now - latest.started_at).
   */
  total_active_ms?: number | null;
}

// ─── Single-attempt detail (review surface) ──────────────────────────────────

export interface MockExamAttemptPart1Answer {
  kim_number: number;
  student_answer: string | null;
  earned_score: number | null;
  /** From mock_exam_variant_tasks for the same kim_number. */
  correct_answer: string | null;
  max_score: number;
  check_mode: MockExamCheckMode | null;
  /**
   * AC-P11 (2026-05-26): optional tutor comment to KIM. Tutor пишет в
   * Part1TaskDrillDownDialog → ученик видит после approval в Part1Card row.
   * Max 600 chars (backend validation). null = нет комментария.
   */
  tutor_comment?: string | null;
  /**
   * AC-P11 (2026-05-26): task condition text для drill-down modal. Tutor видит
   * для context при review (можно collapse «Показать условие»). Optional —
   * backward compat с pre-AC-P11 payload.
   */
  task_text?: string | null;
  /**
   * AC-P11 (2026-05-26): task image (storage:// ref) для drill-down modal.
   * Frontend resolves через signed URL helper при render.
   */
  task_image_url?: string | null;
}

export interface MockExamAttemptPart2Solution {
  kim_number: number;
  /** Browser-facing signed URL (or null when no photo uploaded yet). */
  photo_url: string | null;
  ai_draft: MockExamPart2Draft | null;
  tutor_score: number | null;
  tutor_comment: string | null;
  status: MockExamPart2SolutionStatus;
  /** From mock_exam_variant_tasks for the same kim_number. */
  task_text: string;
  task_image_url: string | null;
  max_score: number;
  solution_text: string | null;
}

export interface MockExamAttemptDetail {
  id: string;
  assignment_id: string;
  assignment_title: string;
  variant_id: string | null;
  exam_type: MockExamType | null;
  mode: MockExamMode;
  student_id: string | null;
  anonymous_id: string | null;
  student_display_name: string | null;
  status: MockExamAttemptStatus;
  started_at: string | null;
  submitted_at: string | null;
  total_time_minutes: number | null;
  /** Browser-facing signed URL of the blank photo (storage://... rewritten). */
  blank_photo_url: string | null;
  /**
   * NEW (TASK-11, backend extension needed): per-attempt answer method choice.
   * `'blank'` → review UI shows blank_photo_url + manual scoring inputs for Part 1.
   * `'form'` → auto-checked Part 1 read-only display.
   * `null` → legacy (assume 'form' for backward compat).
   */
  answer_method?: MockExamAnswerMethod | null;
  /** Browser-facing signed URL for fallback Part 1 photo (не на ФИПИ бланке). */
  part1_blank_photo_url?: string | null;
  /** Browser-facing signed URLs for bulk Part 2 photos (additive to per-task). */
  part2_bulk_photo_urls?: string[];
  /**
   * Phase 6 (2026-05-15) — AI OCR Часть 1 result для blank-mode attempts.
   * Tutor-only до approval (.claude/rules/45-mock-exams.md anti-leak). После approval ученик
   * видит только `mock_exam_attempt_part1_answers.earned_score`. NULL для
   * form mode и legacy pre-Phase 6 attempts.
   */
  ai_part1_ocr_json?: MockExamPart1OCRResult | null;
  total_part1_score: number | null;
  total_part2_score: number | null;
  total_score: number | null;
  total_max_score: number | null;
  manual_entered_date: string | null;
  manual_comment: string | null;
  part1_answers: MockExamAttemptPart1Answer[];
  part2_solutions: MockExamAttemptPart2Solution[];
  /**
   * AC-P10 (2026-05-25): execution mode (simulation/training).
   * Tutor review shows badge based on this. Optional для backward compat.
   * Это **final mode** после student override (immutable после первого start).
   */
  exam_mode?: MockExamExamMode | null;
  /**
   * AC-P10 Phase 2 (PAUSE-8, 2026-05-25): assignment-level tutor recommendation.
   * Tutor UI показывает override indicator если exam_mode != default_exam_mode.
   */
  default_exam_mode?: MockExamExamMode | null;
  /**
   * AC-P10: work sessions для Tutor «Solo time + sessions detail» в review surface.
   * Latest session may have ended_at=null если status='in_progress'.
   */
  sessions?: MockExamAttemptSession[] | null;
  /**
   * AC-P10: cached SUM of session durations. Frontend для running attempts
   * добавляет (now - latest_session.started_at) для real-time display.
   */
  total_active_ms?: number | null;
}

// ─── Create / approve / invite-link payloads + responses ─────────────────────

export interface CreateMockExamAssignmentPayload {
  /** UUID of variant (required for mode='blank'|'form'). */
  variant_id?: string | null;
  /** Free-text variant name (required for mode='manual_entry'). */
  variant_title?: string | null;
  title: string;
  mode: MockExamMode;
  /** ISO 8601 — required for blank/form, MUST be null for manual_entry. */
  deadline?: string | null;
  /** Student ids (auth.users.id) to assign — required for blank/form. */
  student_ids?: string[];
  /** For mode='manual_entry' only: single student_id + the prefilled result. */
  manual_entry?: MockExamManualEntryPayload | null;
  /**
   * AC-P10 (2026-05-25): default execution mode для new attempts (студент видит
   * pre-selected в start modal + может override). Default 'training'.
   */
  default_exam_mode?: MockExamExamMode | null;
}

export interface MockExamManualEntryPayload {
  student_id: string;
  manual_entered_date: string;
  total_score: number;
  total_max_score: number;
  manual_comment?: string | null;
}

export interface CreateMockExamAssignmentResponse {
  assignment_id: string;
  attempts_created: number;
}

export interface ApproveTaskPayload {
  /** Часть 2 KIM number (21..26 для ЕГЭ физики). */
  kim_number: number;
  /** Tutor-confirmed score for the task. Must be 0..max_score. */
  score: number;
  comment?: string | null;
}

export interface ApproveTaskResponse {
  attempt_id: string;
  kim_number: number;
  status: MockExamPart2SolutionStatus;
  tutor_score: number;
  tutor_comment: string | null;
}

export interface ApproveAllResponse {
  attempt_id: string;
  status: MockExamAttemptStatus;
  total_part1_score: number;
  total_part2_score: number;
  total_score: number;
  /** Best-effort delivery summary — student push/telegram/email cascade. */
  delivery: {
    channel: 'push' | 'telegram' | 'email' | null;
    failed_reason: string | null;
  };
}

export interface CreateInviteLinkPayload {
  /** Days until expiry. Omit/null for never-expiring link. */
  expires_in_days?: number | null;
}

export interface MockExamInviteLink {
  slug: string;
  url: string;
  scope: 'invite';
  assignment_id: string;
  expires_at: string | null;
  created_at: string;
}
