// Shared Lovable AI Gateway helpers (Gemini, multimodal JSON).
//
// Canonical SHARED home for the `callLovableJson` machinery + a generic
// signed-URL → base64 image inliner. New edge functions should import from
// here instead of re-mirroring the gateway call.
//
// NOTE (pre-existing duplication, intentionally NOT touched): `homework-api/
// ai_shared.ts` and `mock-exam-grade/index.ts` each keep their own copy of this
// call (the repo's historical "mirror locally" convention — see
// `_shared/mock-exam-prompts.ts` header). We do NOT modify those (rule 10:
// don't touch the critical homework AI path for a non-functional refactor).
// This module is the forward-looking shared version; future callers use it.
//
// Zero cross-function dependencies — only Deno/fetch/btoa + `./proxy-url.ts`.

import { rewriteToDirect } from "./proxy-url.ts";

// ─── Types (wire-compatible with homework-api/ai_shared.ts) ──────────────────

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
 * Token-usage shape surfaced by the optional `onUsage` hook below (ai-usage-logging,
 * 2026-07-06). Structurally compatible with `_shared/token-usage.ts::TokenUsage`.
 * Defined inline to keep this module free of cross-function imports.
 */
export interface LovableUsage {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number | null;
  model?: string | null;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const LOVABLE_API_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const LOVABLE_MODEL = "google/gemini-3-flash-preview";
const REQUEST_TIMEOUT_MS = 35_000;
const MAX_RETRIES = 1;

/** Max bytes for an inlined prompt image (mirror guided_ai.ts). Gemini chokes above ~5MB. */
export const MAX_PROMPT_IMAGE_BYTES = 5 * 1024 * 1024;

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

// ─── JSON extraction ─────────────────────────────────────────────────────────

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

  // Do NOT embed the model response in the error — it may contain task text /
  // answers (PII per rule 40 telemetry-convention). Keep the message content-free.
  throw new Error("Failed to extract valid JSON object from model response");
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

// ─── HTTP helpers ────────────────────────────────────────────────────────────

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

// ─── Lovable AI Gateway call ─────────────────────────────────────────────────

export async function callLovableJson(
  messages: LovableMessage[],
  telemetryTag: string,
  // ai-usage-logging (2026-07-06): fire-and-forget hook invoked with the parsed
  // gateway `usage` on a successful (HTTP 200) response. Observability only.
  onUsage?: (usage: LovableUsage | null) => void,
  // W4 (2026-07-16): explicit output cap. Without it the gateway default silently
  // truncated dense-collection extractions (73 tasks → the model emitted 5-7).
  // `model` overrides LOVABLE_MODEL per call; `fallbackModel` — if the gateway
  // rejects the override (400/404/422 — unknown/unavailable model string), the
  // call retries once with the fallback instead of failing (deploy-safe upgrade).
  // Optional — existing callers keep the gateway default.
  opts?: { maxTokens?: number; model?: string; fallbackModel?: string },
): Promise<Record<string, unknown>> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) throw new Error("LOVABLE_API_KEY is not configured");

  let currentModel = opts?.model ?? LOVABLE_MODEL;

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
          model: currentModel,
          messages,
          temperature: 0.2,
          stream: false,
          ...(opts?.maxTokens ? { max_tokens: opts.maxTokens } : {}),
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
      // Model-fallback: шлюз отверг модель-override (неизвестная строка / модель
      // недоступна) → один заход на fallback-модели вместо провала вызова.
      if (
        error instanceof HttpStatusError &&
        [400, 404, 422].includes(error.status) &&
        opts?.fallbackModel &&
        currentModel !== opts.fallbackModel &&
        attempt < MAX_RETRIES
      ) {
        console.warn(`${telemetryTag}_model_fallback`, { status: error.status });
        currentModel = opts.fallbackModel;
        continue;
      }
      const canRetry = shouldRetry(error) && attempt < MAX_RETRIES;
      if (error instanceof HttpStatusError) {
        // Log only the status — the gateway error body may echo prompt fragments,
        // task text, or model output (rule 40: no PII / task content in logs).
        console.warn(`${telemetryTag}_http_error`, { status: error.status });
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

// ─── Generic image inliner (signed URL → data: base64) ───────────────────────
// Mirror of homework-api/guided_ai.ts::inlinePromptImageUrl (generic, fresh copy
// — that one is local/unexported). Caller must pass an https signed URL it owns
// (e.g. from storage.createSignedUrl); we never accept storage:// or raw paths.

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(binary);
}

/**
 * Fetch an https signed image URL and return a `data:<mime>;base64,...` string,
 * or null on any failure (oversized, SVG, non-2xx, network). SVGs are rejected
 * (Gemini multimodal supports only raster). Server-to-server fetch uses
 * `rewriteToDirect` to skip the RU proxy round-trip.
 */
export async function inlineImageUrlToBase64(
  imageUrl: string | null | undefined,
  telemetryTag = "ai_lovable_inline",
): Promise<string | null> {
  if (!imageUrl) return null;
  const trimmed = imageUrl.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("data:")) return trimmed;
  if (!trimmed.startsWith("https://")) return null;

  // Skip SVGs by URL extension before fetching.
  try {
    const parsedUrl = new URL(trimmed);
    if (/\.svg(\?|$)/i.test(parsedUrl.pathname)) {
      console.warn(`${telemetryTag}_skipped`, { reason: "unsupported_svg", source: "url_extension" });
      return null;
    }
  } catch {
    // URL parsing failed — let the fetch path handle it
  }

  try {
    const fetchUrl = rewriteToDirect(trimmed);
    const response = await fetch(fetchUrl);
    if (!response.ok) {
      console.error(`${telemetryTag}_failed`, { status: response.status });
      return null;
    }

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_PROMPT_IMAGE_BYTES) {
      console.error(`${telemetryTag}_too_large`, {
        bytes: buffer.byteLength,
        maxBytes: MAX_PROMPT_IMAGE_BYTES,
      });
      return null;
    }

    const mime = response.headers.get("content-type") || "image/jpeg";

    // Detect SVG via content-type or magic bytes (catches extension-less SVGs).
    const isSvgMime = /image\/svg\+?xml/i.test(mime);
    let isSvgMagic = false;
    if (!isSvgMime) {
      const sniffLen = Math.min(buffer.byteLength, 256);
      const head = new TextDecoder("utf-8", { fatal: false }).decode(
        new Uint8Array(buffer, 0, sniffLen),
      );
      isSvgMagic = /^\s*(?:<\?xml[^>]*\?>\s*)?<svg[\s>]/i.test(head);
    }
    if (isSvgMime || isSvgMagic) {
      console.warn(`${telemetryTag}_skipped`, {
        reason: "unsupported_svg",
        source: isSvgMime ? "content_type" : "magic_bytes",
      });
      return null;
    }

    return `data:${mime};base64,${arrayBufferToBase64(buffer)}`;
  } catch (error) {
    console.error(`${telemetryTag}_failed`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
