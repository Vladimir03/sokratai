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

// ─── Constants ──────────────────────────────────────────────────────────────

const LOVABLE_API_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const LOVABLE_MODEL = "google/gemini-3-flash-preview";
const REQUEST_TIMEOUT_MS = 35_000;
const MAX_RETRIES = 1;

// ─── Helpers ────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
      const messageContent = payload?.choices?.[0]?.message?.content;
      const rawContent = extractMessageContent(messageContent);

      if (!rawContent) throw new Error("Model response is empty");
      return extractJsonObject(rawContent);
    } catch (error) {
      const canRetry = shouldRetry(error) && attempt < MAX_RETRIES;
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
