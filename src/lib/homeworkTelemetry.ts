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
  | 'homework_assign_group'
  // homework-reuse-v1 TASK-2 — bookmark traffic signal for /tutor/assistant
  // redirect. TASK-11 will extend the event surface with typed payloads for
  // the full reuse-v1 telemetry set.
  | 'tutor_assistant_route_hit'
  // homework-reuse-v1 TASK-7 — share link created by tutor.
  // Payload intentionally minimal: no slug (PII-adjacent for leak trackers).
  | 'homework_share_link_created'
  // homework-reuse-v1 TASK-3 — tutor-only preview at /tutor/homework/:id/preview.
  // `opened` fires once per (assignmentId, mount) via a useRef sentinel so
  // refetch does not re-emit.
  | 'homework_preview_opened'
  | 'homework_preview_printed'
  | 'homework_preview_copied_text'
  // homework-reuse-v1 TASK-6 — template snapshot post-factum (AC-14).
  // Fired exactly once on successful POST /assignments/:id/save-as-template.
  // Payload PII-free: ids + toggles only.
  | 'homework_saved_as_template_post_factum';

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
export function trackGuidedHomeworkEvent(event: 'homework_share_link_created', payload: HomeworkShareLinkCreatedPayload): void;
export function trackGuidedHomeworkEvent(event: 'homework_preview_opened', payload: HomeworkPreviewOpenedPayload): void;
export function trackGuidedHomeworkEvent(event: 'homework_preview_printed', payload: HomeworkPreviewPrintedPayload): void;
export function trackGuidedHomeworkEvent(event: 'homework_preview_copied_text', payload: HomeworkPreviewCopiedTextPayload): void;
export function trackGuidedHomeworkEvent(event: 'homework_saved_as_template_post_factum', payload: HomeworkSavedAsTemplatePostFactumPayload): void;
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
