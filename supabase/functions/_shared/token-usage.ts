/**
 * Shared token-usage logging helper (ai-usage-logging, 2026-07-06).
 *
 * OBSERVABILITY ONLY. Records per-call AI token consumption into
 * `public.token_usage_logs`, tagged by `source` (проверка ДЗ / подсказки /
 * пробники / OCR / kb-extract / чат / голос) so AI costs can be sliced by type
 * and — via `user_id` / `assignment_id` — by tutor. It does NOT touch prompts,
 * grading, verdicts, or the AI quota (`daily_message_limits`).
 *
 * Contract (mirror of the repo's telemetry convention, rule 40):
 *   - Fire-and-forget: NEVER throw. A logging failure must not break the AI
 *     response. Every insert is wrapped in try/catch; callers do not await it in
 *     the gateway hot path.
 *   - No PII: only ids, counts, model, source. Never task text / answers /
 *     transcript.
 *   - No-op guard: `token_usage_logs.user_id` is NOT NULL, so both entry points
 *     silently skip when `userId` is falsy (e.g. anonymous mock attempts).
 *   - Deploy-skew tolerant: writes the columns added by migration
 *     `20260706130000_token_usage_logs_source.sql`. If that migration hasn't
 *     applied yet, the insert errors — and is swallowed (no row logged for the
 *     window, which is acceptable for observability).
 *
 * Zero cross-function dependencies (only the structural client shape below).
 */

/**
 * Minimal structural shape of a service-role Supabase client — avoids importing
 * the full SDK type into leaf helpers. Any `createClient(...)` result satisfies it.
 */
export interface TokenUsageAdminClient {
  from(table: string): {
    // deno-lint-ignore no-explicit-any
    insert(values: Record<string, unknown>): any;
  };
}

/**
 * Token counts as returned by the Lovable gateway (`payload.usage`) plus the
 * resolved model (`payload.model`). All fields optional — the gateway may omit
 * usage on some responses.
 */
export interface TokenUsage {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number | null;
  /** Model string echoed by the gateway (`payload.model`), if available. */
  model?: string | null;
}

/**
 * Canonical `source` values — one bucket per AI call type. Extend additively
 * (a plain `text` column, no CHECK constraint, accepts new values).
 */
export type TokenUsageSource =
  | "chat_discussion" // /chat guided-homework discussion + generic web chat
  | "bootstrap" //       AI task intro (reserved — currently indistinguishable server-side)
  | "telegram_chat" //   /chat calls originating from the Telegram bot
  | "homework_check" //  guided_ai.evaluateStudentAnswer (+ physics flowchart + leak retry)
  | "homework_hint" //   guided_ai.generateHint (+ retry)
  | "mock_grade" //      mock-exam-grade Часть 2 (gemini-flash) + bulk photo assign
  | "mock_ocr" //        mock-exam-grade Часть 1 OCR (gemini-pro)
  | "reference_gen" //   homework-generate-reference (physics эталон)
  | "kb_extract" //      kb-ai-extract task extraction
  | "voice"; //          Groq Whisper transcription (tokens 0, audio_seconds set)

export interface LogTokenUsageInput {
  userId: string | null | undefined;
  source: TokenUsageSource | string;
  usage?: TokenUsage | null;
  /** Explicit model override; falls back to `usage.model`, then "unknown". */
  model?: string | null;
  chatId?: string | null;
  assignmentId?: string | null;
  /** Groq voice (whisper): audio duration in seconds. Tokens stay 0. */
  audioSeconds?: number | null;
}

function numOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Insert one token-usage row. Fire-and-forget: swallows all errors, never
 * throws, and no-ops when `userId` is missing.
 */
export async function logTokenUsage(
  admin: TokenUsageAdminClient,
  input: LogTokenUsageInput,
): Promise<void> {
  try {
    if (!admin || !input.userId) return;
    const usage = input.usage ?? null;
    const row: Record<string, unknown> = {
      user_id: input.userId,
      chat_id: input.chatId ?? null,
      model: input.model ?? usage?.model ?? "unknown",
      prompt_tokens: numOrNull(usage?.prompt_tokens),
      completion_tokens: numOrNull(usage?.completion_tokens),
      total_tokens: numOrNull(usage?.total_tokens),
      source: input.source,
      assignment_id: input.assignmentId ?? null,
      audio_seconds: numOrNull(input.audioSeconds),
    };
    const res = await admin.from("token_usage_logs").insert(row);
    const err = (res as { error?: { code?: string } } | null)?.error;
    if (err) {
      // PII-free: log only the source + PostgREST error code, never row content.
      console.warn("token_usage_log_insert_failed", {
        source: input.source,
        code: err.code ?? null,
      });
    }
  } catch (error) {
    console.warn("token_usage_log_exception", {
      source: input?.source ?? null,
      error: error instanceof Error ? error.name : "unknown",
    });
  }
}

/**
 * Build a bound `onUsage` callback for the `callLovableJson(..., onUsage)` hook.
 * Returns `undefined` when there is no client or no `userId`, so callers can
 * pass the result straight through (an undefined hook logs nothing).
 */
export function makeUsageLogger(
  admin: TokenUsageAdminClient | null | undefined,
  ctx: {
    userId: string | null | undefined;
    source: TokenUsageSource | string;
    assignmentId?: string | null;
    chatId?: string | null;
    model?: string | null;
  },
): ((usage: TokenUsage | null) => void) | undefined {
  if (!admin || !ctx.userId) return undefined;
  const client = admin;
  return (usage: TokenUsage | null): void => {
    // Fire-and-forget — do not await inside the gateway hot path.
    void logTokenUsage(client, {
      userId: ctx.userId,
      source: ctx.source,
      usage,
      model: ctx.model ?? usage?.model ?? null,
      assignmentId: ctx.assignmentId ?? null,
      chatId: ctx.chatId ?? null,
    });
  };
}
