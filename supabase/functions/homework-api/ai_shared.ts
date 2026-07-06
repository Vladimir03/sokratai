/**
 * Shared types and utilities for AI-powered homework evaluation.
 * Extracted from the removed vision_checker.ts for use by guided_ai.ts.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type HomeworkAiErrorType =
  | "calculation"
  | "concept"
  | "formatting"
  | "incomplete"
  | "factual_error"
  | "weak_argument"
  | "wrong_answer"
  | "partial"
  | "correct";

export type LovableMessageRole = "system" | "user" | "assistant";

export interface LovableTextPart {
  type: "text";
  text: string;
}

export interface LovableImagePart {
  type: "image_url";
  image_url: {
    url: string;
  };
}

export type LovableMessageContent = string | Array<LovableTextPart | LovableImagePart>;

export interface LovableMessage {
  role: LovableMessageRole;
  content: LovableMessageContent;
}

/**
 * Token-usage shape surfaced by the optional `onUsage` hook on `callLovableJson`
 * (ai-usage-logging, 2026-07-06). Structurally compatible with
 * `_shared/token-usage.ts::TokenUsage`. Defined inline (this file mirrors the
 * gateway call locally per the repo convention — no cross-function import).
 */
export interface LovableUsage {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number | null;
  model?: string | null;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const LOVABLE_API_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const LOVABLE_MODEL = "google/gemini-3-flash-preview";
const REQUEST_TIMEOUT_MS = 35_000;
const MAX_RETRIES = 1;

// ─── Helpers ────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** ai-usage-logging: extract `{ prompt/completion/total_tokens, model }` from a
 * gateway payload and hand it to `onUsage`. Fully defensive — never throws. */
function emitUsage(payload: unknown, onUsage?: (usage: LovableUsage | null) => void): void {
  if (!onUsage) return;
  try {
    const record = isRecord(payload) ? payload : null;
    const usage = record && isRecord(record.usage) ? record.usage : null;
    const model = record && typeof record.model === "string" ? record.model : null;
    onUsage(
      usage
        ? {
          prompt_tokens: typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : null,
          completion_tokens: typeof usage.completion_tokens === "number" ? usage.completion_tokens : null,
          total_tokens: typeof usage.total_tokens === "number" ? usage.total_tokens : null,
          model,
        }
        : null,
    );
  } catch {
    // Fire-and-forget — a logging hook must never break the AI call.
  }
}

export function softTruncate(value: string, maxLen: number): string {
  if (value.length <= maxLen) return value;
  const slice = value.slice(0, maxLen);
  const lastSpaceIdx = slice.lastIndexOf(" ");
  const safeSlice = lastSpaceIdx > maxLen * 0.8 ? slice.slice(0, lastSpaceIdx) : slice;
  return `${safeSlice.trim()}\n...[обрезано]`;
}

export function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

export function normalizeComparable(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[.,!?;:()[\]{}"'`]/g, "");
}

// ─── JSON extraction ────────────────────────────────────────────────────────

function tryParseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function extractJsonObject(raw: string): Record<string, unknown> {
  const normalized = raw.trim();

  const direct = tryParseJsonObject(normalized);
  if (direct) return direct;

  const fencedMatch = normalized.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch?.[1]) {
    const parsedFence = tryParseJsonObject(fencedMatch[1].trim());
    if (parsedFence) return parsedFence;
  }

  const firstBrace = normalized.indexOf("{");
  const lastBrace = normalized.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const betweenBraces = normalized.slice(firstBrace, lastBrace + 1);
    const parsedBetween = tryParseJsonObject(betweenBraces);
    if (parsedBetween) return parsedBetween;
  }

  const preview = normalized.replace(/\s+/g, " ").slice(0, 180);
  throw new Error(`Failed to extract valid JSON object from model response: ${preview}`);
}

function extractMessageContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts = content
    .map((entry) => {
      if (isRecord(entry) && typeof entry.text === "string") return entry.text;
      return "";
    })
    .filter(Boolean);
  return parts.join("\n").trim();
}

// ─── HTTP helpers ───────────────────────────────────────────────────────────

class HttpStatusError extends Error {
  public readonly status: number;
  public readonly responseText: string;
  constructor(status: number, responseText: string) {
    super(`Lovable API returned HTTP ${status}`);
    this.name = "HttpStatusError";
    this.status = status;
    this.responseText = responseText;
  }
}

function shouldRetry(error: unknown): boolean {
  if (error instanceof HttpStatusError) return error.status >= 500;
  if (error instanceof Error) {
    if (error.name === "AbortError") return true;
    if (error.name === "TypeError") return true;
  }
  return false;
}

// ─── Lovable AI Gateway call ────────────────────────────────────────────────

export async function callLovableJson(
  messages: LovableMessage[],
  telemetryTag: string,
  // ai-usage-logging (2026-07-06): fire-and-forget hook invoked with the parsed
  // gateway `usage` on a successful (HTTP 200) response. Observability only —
  // does not affect grading / verdict / prompt.
  onUsage?: (usage: LovableUsage | null) => void,
): Promise<Record<string, unknown>> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) throw new Error("LOVABLE_API_KEY is not configured");

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(LOVABLE_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: LOVABLE_MODEL,
          messages,
          temperature: 0.2,
          stream: false,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new HttpStatusError(response.status, errorText);
      }

      const payload = await response.json();
      emitUsage(payload, onUsage);
      const messageContent = payload?.choices?.[0]?.message?.content;
      const rawContent = extractMessageContent(messageContent);

      if (!rawContent) throw new Error("Model response is empty");
      return extractJsonObject(rawContent);
    } catch (error) {
      const canRetry = shouldRetry(error) && attempt < MAX_RETRIES;
      if (error instanceof HttpStatusError) {
        // Surface gateway error body so multimodal failures (e.g. SVG rejection,
        // model-side validation errors) become diagnosable in telemetry.
        console.warn(`${telemetryTag}_http_error`, {
          status: error.status,
          body_preview: error.responseText.slice(0, 500),
        });
      }
      if (canRetry) {
        const errorMessage = error instanceof Error ? error.message : "unknown error";
        console.warn(`${telemetryTag}_retry`, {
          attempt: attempt + 1,
          max_retries: MAX_RETRIES,
          error: errorMessage,
        });
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw new Error("Unexpected retry loop termination");
}
