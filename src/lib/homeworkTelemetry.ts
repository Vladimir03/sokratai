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
  | 'manual_score_override_saved';

type GuidedTelemetryPayload = Record<string, string | number | boolean | null | undefined>;

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
