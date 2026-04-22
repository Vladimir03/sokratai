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
  | 'homework_saved_to_kb_per_task';

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
