export type TrainerTelemetryEvent =
  | 'trainer_round_completed'
  | 'trainer_streak_incremented'
  | 'trainer_streak_broken'
  | 'trainer_daily_goal_reached'
  | 'trainer_new_best';

export type TrainerTelemetryPayload = Record<
  string,
  string | number | boolean | null | undefined
>;

/**
 * Emit a trainer-gamification telemetry event.
 *
 * Phase 1 transport = `console.info` (Supabase logs / browser devtools).
 * No PII, no task_text — only ids, counts, and booleans.
 *
 * Prefix `[trainer-telemetry]` is used as a stable console filter
 * (matches pattern used by `hint_rejected` in `guided_ai.ts`).
 */
export function trackTrainerEvent(
  event: TrainerTelemetryEvent,
  payload: TrainerTelemetryPayload = {},
): void {
  try {
    const safe: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload)) {
      if (value === undefined) continue;
      safe[key] = value;
    }
    console.info(
      `[trainer-telemetry] ${JSON.stringify({ event, ...safe, ts: Date.now() })}`,
    );
  } catch {
    /* noop — telemetry must never break product flow */
  }
}
