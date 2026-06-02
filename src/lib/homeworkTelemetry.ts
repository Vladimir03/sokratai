/**
 * Homework telemetry event registry.
 *
 * Two surface groups share this module:
 *   1. Guided chat / results v2 — original per-session / per-interaction events.
 *   2. homework-reuse-v1 (TASK-11) — preview, save-to-KB, template post-factum,
 *      share-links, group-assign, `/tutor/assistant` redirect. Invariants below.
 *
 * ─── homework-reuse-v1 AC-23 event taxonomy ────────────────────────────────
 * All 11 events are PII-free: ids + counts + booleans only. No task_text,
 * student_name, email, folder_name, title, or slug-derived identifiers in
 * client payloads (slug is a bearer token — never clone into a tracker).
 *
 * | Event                                     | Fire site                                                       | Fire-once guarantee                   |
 * |-------------------------------------------|-----------------------------------------------------------------|---------------------------------------|
 * | homework_preview_opened                   | `src/pages/tutor/TutorHomeworkPreview.tsx` (mount effect)       | `openedTrackedRef` per assignmentId   |
 * | homework_preview_printed                  | `TutorHomeworkPreview.tsx` (Print click)                        | onClick only, pre-`window.print()`    |
 * | homework_preview_copied_text              | `TutorHomeworkPreview.tsx` (Copy click)                         | onClick after successful clipboard    |
 * | homework_saved_to_kb                      | `src/components/tutor/homework-reuse/SaveTasksToKBDialog.tsx`   | bulk-mode success branch              |
 * | homework_saved_to_kb_per_task             | `SaveTasksToKBDialog.tsx`                                       | single-mode success branch            |
 * | homework_saved_as_template_post_factum    | `src/components/tutor/homework-reuse/SaveAsTemplateDialog.tsx`  | create-success branch                 |
 * | homework_share_link_created               | `src/components/tutor/homework-reuse/ShareLinkDialog.tsx`       | create-success branch (no slug!)      |
 * | homework_share_link_visited               | `supabase/functions/public-homework-share/index.ts` (server)    | only after non-expired response built |
 * | homework_assign_group                     | `src/pages/tutor/TutorHomeworkCreate.tsx` (both submit branches)| one fire per submit branch            |
 * | homework_filter_by_group                  | `src/pages/tutor/TutorHomework.tsx` (onChange callback)         | onChange only                         |
 * | tutor_assistant_route_hit                 | `src/pages/RedirectTutorAssistant.tsx` (mount effect)           | `firedRef` sentinel                   |
 * | student_problem_screen_opened             | `src/pages/student/HomeworkProblem.tsx` (mount effect)          | `openedKeyRef` per `${hwId}:${taskId}` |
 * | student_submitsheet_opened                | `HomeworkProblem.tsx` (CTA onClick)                             | onClick only                          |
 * | student_submission_sent                   | `HomeworkProblem.tsx` (SubmitSheet `onSubmitted` precursor)     | one fire per submission attempt       |
 * | student_submission_verdict                | `HomeworkProblem.tsx` (SubmitSheet `onSubmitted` callback)      | one fire per verdict response         |
 *
 * When adding new events to this surface:
 *   1. Keep payloads PII-free — if you need a name, use an id.
 *   2. Fire-once in effect-sites requires a useRef sentinel. Re-fetches and
 *      React-Query invalidations must NOT multiply emissions.
 *   3. Public endpoints log via `console.info(JSON.stringify(...))` — avoid
 *      pushing to dataLayer without a user context; backend ingestion is a
 *      different channel.
 *   4. Update this table. Grep-verify with `trackGuidedHomeworkEvent\('<name>'`.
 */

type GuidedTelemetryEvent =
  | 'guided_send'
  | 'guided_send_click'
  | 'guided_send_failed'
  | 'guided_retry'
  | 'guided_retry_click'
  | 'guided_retry_success'
  | 'guided_retry_failed'
  | 'guided_hint'
  | 'guided_answer_on_track'
  | 'guided_advance'
  | 'guided_advance_click'
  | 'guided_advance_success'
  | 'guided_advance_failed'
  | 'guided_assistant_save_failed'
  | 'guided_stream_failed'
  | 'guided_prev'
  | 'guided_next'
  | 'guided_bootstrap'
  | 'guided_first_run_intro'
  | 'guided_answer_correct'
  | 'guided_answer_incorrect'
  | 'guided_answer_check_failed'
  | 'guided_score_degraded'
  | 'guided_all_completed'
  | 'guided_check_failed'
  | 'guided_hint_failed'
  // Homework Results v2 — AC-10 telemetry surface (no PII).
  | 'results_v2_opened'
  | 'telegram_reminder_sent_from_results'
  | 'drill_down_expanded'
  | 'manual_score_override_saved'
  // ─── homework-reuse-v1 surface (TASK-11 taxonomy — see module header) ────
  // Grouped block so any reviewer of AC-23 can verify the full 11-event set
  // in one place. Typed overloads below enforce payload shape per event.
  // The 11th event (`homework_share_link_visited`) is server-side in
  // `supabase/functions/public-homework-share/index.ts` and intentionally
  // absent from this client-side union.
  | 'homework_assign_group'
  | 'homework_filter_by_group'
  | 'tutor_assistant_route_hit'
  | 'homework_share_link_created'
  | 'homework_preview_opened'
  | 'homework_preview_printed'
  | 'homework_preview_copied_text'
  | 'homework_saved_as_template_post_factum'
  | 'homework_saved_to_kb'
  | 'homework_saved_to_kb_per_task'
  // ─── student-homework-problem-screen Phase 1 (AC-8) ──────────────────────
  // Mobile-first single-task surface. Five events PII-free:
  //   - student_problem_screen_opened : useEffect once per (hwId, taskId)
  //   - student_submitsheet_opened    : onClick of the «Сдать решение» CTA
  //   - student_submission_sent       : at submit (before verdict)
  //   - student_submission_verdict    : on verdict response
  //   - student_hint_requested        : Phase 1.1 — tap on 💡 hint button
  // Fire-once-per-key for `_opened` is enforced via a useRef sentinel on
  // `${hwId}:${taskId}` so React Query refetches don't multiply emissions.
  | 'student_problem_screen_opened'
  | 'student_submitsheet_opened'
  | 'student_submission_sent'
  | 'student_submission_verdict'
  | 'student_hint_requested'
  // ─── tutor force-complete (2026-05-16, lexical-brewing-gadget) ───────────
  // Three PII-free events. force_completed = single task закрыта через
  // EditScoreDialog «Сохранить и закрыть». reopen = ghost CTA в том же
  // диалоге (только для force-completed, не AI-CORRECT). bulk = массовое
  // закрытие из StudentDrillDown «Закрыть все оставшиеся».
  | 'homework_task_force_completed'
  | 'homework_task_reopened'
  | 'homework_bulk_force_completed'
  // ─── tutor review «проверено» (2026-06-02, student-progress R1) ──────────
  // PII-free. `task_reviewed` covers single per-task confirm, dialog
  // «Сохранить и подтвердить», and bulk «Подтвердить всё, что AI проверил»
  // (discriminated by `source`). `task_review_reopened` = «Снять подтверждение».
  | 'task_reviewed'
  | 'task_review_reopened';

type GuidedTelemetryValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly string[]
  | readonly number[];

type GuidedTelemetryPayload = Record<string, GuidedTelemetryValue>;

// ─── AC-10 typed payloads (no PII — ids + numbers only) ──────────────────────
// Each interface extends GuidedTelemetryPayload so it is assignable to the
// implementation signature. The `kind` literal union enforces allowed values
// at compile time without needing a runtime enum.

interface ResultsV2OpenedPayload extends Record<string, string | number | boolean | null | undefined> {
  assignmentId: string;
  submittedCount: number;
  totalCount: number;
}

interface DrillDownExpandedPayload extends Record<string, string | number | boolean | null | undefined> {
  assignmentId: string;
  studentId: string;
  firstProblemTaskOrder: number | null;
}

interface ManualScoreOverrideSavedPayload extends Record<string, string | number | boolean | null | undefined> {
  assignmentId: string;
  taskId: string;
  aiScore: number | null;
  tutorScore: number | null;
  hadComment: boolean;
}

interface TelegramReminderSentPayload extends Record<string, string | number | boolean | null | undefined> {
  assignmentId: string;
  studentId: string;
  /** Constrained to known reminder kinds — no free-form strings. */
  kind: 'remind' | 'praise';
  /** Actual channel used; may differ from tab selection when backend auto-cascades. */
  channel?: string;
}

interface HomeworkAssignGroupPayload extends Record<string, GuidedTelemetryValue> {
  group_ids: readonly string[];
  group_id: string | null;
  student_count: number;
  is_multi_group: boolean;
}

interface HomeworkFilterByGroupPayload extends Record<string, GuidedTelemetryValue> {
  group_id: string | null;
}

// homework-reuse-v1 TASK-7 — share link created. PII-free (no slug, no url).
interface HomeworkShareLinkCreatedPayload
  extends Record<string, string | number | boolean | null | undefined> {
  assignmentId: string;
  showAnswers: boolean;
  showSolutions: boolean;
  hasExpiry: boolean;
}

// homework-reuse-v1 TASK-3 — preview surface events. PII-free (ids + counts).
interface HomeworkPreviewOpenedPayload
  extends Record<string, string | number | boolean | null | undefined> {
  assignmentId: string;
  tasksCount: number;
}

interface HomeworkPreviewPrintedPayload
  extends Record<string, string | number | boolean | null | undefined> {
  assignmentId: string;
  tasksCount: number;
}

interface HomeworkPreviewCopiedTextPayload
  extends Record<string, string | number | boolean | null | undefined> {
  assignmentId: string;
  tasksCount: number;
  /** Whether correct answers are included in the copied Telegram-friendly text. */
  withAnswers: boolean;
}

// homework-reuse-v1 TASK-6 — post-factum template snapshot from detail page.
// PII-free: ids + toggle flags only. `include_materials` intentionally omitted
// (currently noop at schema level — flag accepted by API but doesn't change
// the stored snapshot, so tracking its state would mislead retention analysis).
interface HomeworkSavedAsTemplatePostFactumPayload
  extends Record<string, string | number | boolean | null | undefined> {
  assignmentId: string;
  templateId: string;
  includeRubric: boolean;
  includeAiSettings: boolean;
}

// homework-reuse-v1 TASK-5 — bulk save of homework tasks to «Мою базу».
// PII-free: ids + counts only. `skippedCount` covers both backend-rejected
// (e.g. missing task) и уже-существующих. `alreadyInBaseCount` даёт сигнал
// retention (повторный save через месяц — пустой либо «всё уже в базе»).
interface HomeworkSavedToKBPayload
  extends Record<string, string | number | boolean | null | undefined> {
  assignmentId: string;
  tasksCount: number;
  folderId: string;
  createdFolder: boolean;
  alreadyInBaseCount: number;
  skippedCount: number;
}

interface HomeworkSavedToKBPerTaskPayload
  extends Record<string, string | number | boolean | null | undefined> {
  assignmentId: string;
  taskId: string;
  folderId: string;
  createdFolder: boolean;
  alreadyInBase: boolean;
}

// ─── student-homework-problem-screen Phase 1 typed payloads ────────────────
// Strict shape — ids, counts, verdict literal only. **No** task_text, no
// student_name, no email, no photo storage refs (refs leak path structure).
// `numericLength` is a coarse-grained signal of "how much did the student
// type" — useful for retention without exposing the actual answer.

interface StudentProblemScreenOpenedPayload
  extends Record<string, string | number | boolean | null | undefined> {
  assignmentId: string;
  taskId: string;
  /** 1-based position; helps segment by «first task vs. later». */
  taskNo: number;
  taskKind: 'numeric' | 'extended' | 'proof';
}

interface StudentSubmitSheetOpenedPayload
  extends Record<string, string | number | boolean | null | undefined> {
  assignmentId: string;
  taskId: string;
  /** Whether a draft existed when the sheet opened (autosave is Phase 2 — */
  /* in Phase 1 always false). Reserved for forward-compat. */
  hadDraft: boolean;
}

interface StudentSubmissionSentPayload
  extends Record<string, string | number | boolean | null | undefined> {
  assignmentId: string;
  taskId: string;
  hasPhotos: boolean;
  photoCount: number;
  hasText: boolean;
  /** Length of the trimmed numeric input — never the value itself. */
  numericLength: number;
}

interface StudentSubmissionVerdictPayload
  extends Record<string, string | number | boolean | null | undefined> {
  assignmentId: string;
  taskId: string;
  verdict: 'CORRECT' | 'INCORRECT' | 'ON_TRACK' | 'CHECK_FAILED';
  /** earned_score from `CheckAnswerResponse`. null when CHECK_FAILED. */
  aiScore: number | null;
  maxScore: number;
}

/**
 * Phase 1.1 — student tapped 💡 hint button. Fires before optimistic
 * bubble insertion (codex review #7 typed registry fix).
 */
interface StudentHintRequestedPayload
  extends Record<string, string | number | boolean | null | undefined> {
  assignmentId: string;
  taskId: string;
  /** Hint counter BEFORE this request (post-request += 1 happens server-side). */
  hintCountBefore: number;
}

// ─── Tutor force-complete (2026-05-16, lexical-brewing-gadget) ───────────────
// PII-free: ids + booleans + counts. `source` различает single-dialog vs bulk
// closure entry points. `hadScore` отслеживает, выставлен ли балл одновременно
// с закрытием (т.е. был ли value в EditScoreDialog).

interface HomeworkTaskForceCompletedPayload
  extends Record<string, string | number | boolean | null | undefined> {
  assignmentId: string;
  studentId: string;
  taskId: string;
  source: 'dialog' | 'bulk';
  hadScore: boolean;
}

interface HomeworkTaskReopenedPayload
  extends Record<string, string | number | boolean | null | undefined> {
  assignmentId: string;
  studentId: string;
  taskId: string;
}

interface HomeworkBulkForceCompletedPayload
  extends Record<string, string | number | boolean | null | undefined> {
  assignmentId: string;
  studentId: string;
  closedCount: number;
}

// ─── Tutor review «проверено» (2026-06-02, student-progress R1) ──────────────
// PII-free: ids + booleans + counts. `source` различает single per-task confirm
// vs dialog «Сохранить и подтвердить» vs bulk. `taskId` = null для bulk.
// `reviewedCount` — только для bulk. `hadOverride` — был ли выставлен балл вместе
// с подтверждением (manual «Поставить балл и подтвердить» / правка в диалоге).

interface TaskReviewedPayload
  extends Record<string, string | number | boolean | null | undefined> {
  assignmentId: string;
  studentId: string;
  taskId: string | null;
  source: 'single' | 'dialog' | 'bulk';
  hadOverride: boolean;
  reviewedCount?: number;
}

interface TaskReviewReopenedPayload
  extends Record<string, string | number | boolean | null | undefined> {
  assignmentId: string;
  studentId: string;
  taskId: string;
}

interface DataLayerWindow extends Window {
  dataLayer?: Array<Record<string, unknown>>;
  gtag?: (...args: unknown[]) => void;
}

function toSafePayload(payload: GuidedTelemetryPayload): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined) continue;
    safe[key] = value;
  }
  return safe;
}

export function trackGuidedHomeworkEvent(event: 'results_v2_opened', payload: ResultsV2OpenedPayload): void;
export function trackGuidedHomeworkEvent(event: 'drill_down_expanded', payload: DrillDownExpandedPayload): void;
export function trackGuidedHomeworkEvent(event: 'manual_score_override_saved', payload: ManualScoreOverrideSavedPayload): void;
export function trackGuidedHomeworkEvent(event: 'telegram_reminder_sent_from_results', payload: TelegramReminderSentPayload): void;
export function trackGuidedHomeworkEvent(event: 'homework_assign_group', payload: HomeworkAssignGroupPayload): void;
export function trackGuidedHomeworkEvent(event: 'homework_filter_by_group', payload: HomeworkFilterByGroupPayload): void;
export function trackGuidedHomeworkEvent(event: 'homework_share_link_created', payload: HomeworkShareLinkCreatedPayload): void;
export function trackGuidedHomeworkEvent(event: 'homework_preview_opened', payload: HomeworkPreviewOpenedPayload): void;
export function trackGuidedHomeworkEvent(event: 'homework_preview_printed', payload: HomeworkPreviewPrintedPayload): void;
export function trackGuidedHomeworkEvent(event: 'homework_preview_copied_text', payload: HomeworkPreviewCopiedTextPayload): void;
export function trackGuidedHomeworkEvent(event: 'homework_saved_as_template_post_factum', payload: HomeworkSavedAsTemplatePostFactumPayload): void;
export function trackGuidedHomeworkEvent(event: 'homework_saved_to_kb', payload: HomeworkSavedToKBPayload): void;
export function trackGuidedHomeworkEvent(event: 'homework_saved_to_kb_per_task', payload: HomeworkSavedToKBPerTaskPayload): void;
export function trackGuidedHomeworkEvent(event: 'student_problem_screen_opened', payload: StudentProblemScreenOpenedPayload): void;
export function trackGuidedHomeworkEvent(event: 'student_submitsheet_opened', payload: StudentSubmitSheetOpenedPayload): void;
export function trackGuidedHomeworkEvent(event: 'student_submission_sent', payload: StudentSubmissionSentPayload): void;
export function trackGuidedHomeworkEvent(event: 'student_submission_verdict', payload: StudentSubmissionVerdictPayload): void;
export function trackGuidedHomeworkEvent(event: 'student_hint_requested', payload: StudentHintRequestedPayload): void;
export function trackGuidedHomeworkEvent(event: 'homework_task_force_completed', payload: HomeworkTaskForceCompletedPayload): void;
export function trackGuidedHomeworkEvent(event: 'homework_task_reopened', payload: HomeworkTaskReopenedPayload): void;
export function trackGuidedHomeworkEvent(event: 'homework_bulk_force_completed', payload: HomeworkBulkForceCompletedPayload): void;
export function trackGuidedHomeworkEvent(event: 'task_reviewed', payload: TaskReviewedPayload): void;
export function trackGuidedHomeworkEvent(event: 'task_review_reopened', payload: TaskReviewReopenedPayload): void;
export function trackGuidedHomeworkEvent(event: GuidedTelemetryEvent, payload?: GuidedTelemetryPayload): void;
export function trackGuidedHomeworkEvent(
  event: GuidedTelemetryEvent,
  payload: GuidedTelemetryPayload = {},
): void {
  const safePayload = toSafePayload(payload);
  const timestamp = new Date().toISOString();
  console.info('guided_homework_event', { event, timestamp, ...safePayload });

  const win = window as DataLayerWindow;
  if (Array.isArray(win.dataLayer)) {
    win.dataLayer.push({ event, timestamp, ...safePayload });
  }
  if (typeof win.gtag === 'function') {
    win.gtag('event', event, safePayload);
  }
}
