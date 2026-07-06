// Mock Exams v1 — AI Part 2 grading background job (TASK-5).
//
// Runs after student submit. Iterates over Часть 2 задач (KIM 21-26 для ЕГЭ
// физики, до 6 штук на attempt) и для каждой:
//   1. Резолвит фото ученика (storage://...) → signed URL → inline base64.
//   2. Резолвит изображение задачи (если variant.task_image_url) тем же пайпом.
//   3. Дёргает Lovable AI Gateway (multimodal) с упрощённым ФИПИ-промптом.
//   4. Sanitizes ответ → upsert mock_exam_attempt_part2_solutions.ai_draft_json.
//
// При завершении: status attempt → 'awaiting_review', push tutor (best-effort).
//
// Spec: docs/delivery/features/mock-exams-v1/spec.md §5 + AC-4
//       SokratAI/docs/delivery/features/mock-exams-v1/product-strategy.md §5
// Migration: supabase/migrations/20260508120000_mock_exams_v1_schema.sql
//
// Architecture decisions:
//   - service_role client (auth.persistSession=false) — обходит RLS, валидирует
//     ownership и state machine вручную.
//   - Auth: либо service_role bearer (внутренний вызов из student submit
//     handler — fire-and-forget), либо JWT student'а / tutor'а как fallback
//     для ручного re-run.
//   - 6 Часть-2 задач обрабатываются ПАРАЛЛЕЛЬНО через Promise.allSettled —
//     укладываемся в AC-4 (< 90 сек) даже когда Lovable timeout = 35 сек на
//     запрос + 1 retry.
//   - rewriteToDirect() для server-to-server fetch на signed URLs (US→US,
//     экономит 200-400ms на RU-Selectel proxy roundtrip).
//   - solution_text из mock_exam_variant_tasks приходит в prompt только
//     server-side. Никогда не возвращается в response к student-у.
//     ai_draft_json пишется в attempt_part2_solutions, который student RLS
//     может прочитать — это ответственность TASK-13 (StudentMockExamResult)
//     отфильтровать ai_draft_json перед отдачей student-у. Здесь invariant —
//     не возвращать draft в response handler этого endpoint.

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  rewriteToDirect,
  SUPABASE_PROXY_URL,
} from "../_shared/proxy-url.ts";
import {
  buildBulkAssignmentPrompt,
  buildMockExamPart2Prompt,
  buildFallbackDraft,
  sanitizeBulkAssignmentResult,
  sanitizeMockExamPart2Draft,
  type BulkAssignmentResult,
  type BulkAssignmentTaskMeta,
  type LovableMessage,
  type MockExamFallbackReason,
  type MockExamPart2Draft,
} from "../_shared/mock-exam-prompts.ts";
import {
  buildPart1BlankOCRPrompt,
  buildPart1FreeformOCRPrompt,
  sanitizePart1OCRResult,
  type Part1OCRResult, // inner cells map (без __meta); используется в runPart1OCR

  type Part1OCRTaskMeta,
} from "../_shared/mock-exam-part1-ocr.ts";
import {
  checkPart1,
  type CheckMode,
} from "../_shared/mock-exam-part1-checker.ts";
import {
  sendPushNotification,
  type PushPayload,
  type PushSubscriptionData,
} from "../_shared/push-sender.ts";
import { makeUsageLogger, type TokenUsage } from "../_shared/token-usage.ts";

// ─── Env ────────────────────────────────────────────────────────────────────

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:support@sokratai.ru";

// ─── Constants ──────────────────────────────────────────────────────────────

const LOVABLE_API_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
// Mirrors homework-api/ai_shared.ts.
const LOVABLE_MODEL = "google/gemini-3-flash-preview";
// TASK-16 (2026-05-15): Часть 1 OCR требует более сильной модели — flash-preview
// failed на рукописных цифрах хорошего качества (Vladimir QA). Используем
// gemini-2.5-pro для OCR. Часть 2 grader остаётся на flash (cost optimization,
// flash справляется с structured-output prompts от Pass 1+2 bulk pipeline).
const LOVABLE_MODEL_OCR = "google/gemini-2.5-pro";
const LOVABLE_REQUEST_TIMEOUT_MS = 35_000;
const LOVABLE_MAX_RETRIES = 1;

const SIGNED_URL_TTL_SEC = 1800;
// TASK-OCR-3 (2026-05-21): bump from 5MB → 8MB. Upload cap is 10MB
// (mock-exam-student-api::MAX_PHOTO_BYTES). New frontend uses
// compressForUpload (≤ 4MB / 2048px JPEG) before upload, но legacy / HEIC
// originals могут весить 5-8MB после inline base64 overhead. Gemini Vision
// API хвостовой limit = 20MB per image, так что 8MB безопасно.
// Anything above bumps tutor into manual review territory с понятным
// `image_inline_failed` fallback (см. classifyError).
const MAX_PROMPT_IMAGE_BYTES = 8 * 1024 * 1024;
// Each Часть 2 task has 1-2 photos at most (бланк-режим может иметь несколько).
const MAX_TASK_IMAGES_FOR_AI = 3;
const MAX_STUDENT_PHOTOS_PER_TASK = 4;

const FALLBACK_ORIGINS = [
  "https://sokratai.ru",
  "https://sokratai.lovable.app",
  "http://localhost:8080",
  "http://localhost:5173",
];

// ─── CORS ───────────────────────────────────────────────────────────────────

function getAllowedOrigins(): string[] {
  const envOrigins = Deno.env.get("MOCK_EXAM_API_ALLOWED_ORIGINS");
  if (envOrigins) {
    return envOrigins.split(",").map((o) => o.trim()).filter(Boolean);
  }
  return FALLBACK_ORIGINS;
}

function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const allowed = getAllowedOrigins();
  const isLovableOrigin =
    origin.endsWith(".lovableproject.com") ||
    origin.endsWith(".lovable.app");
  const matchedOrigin = allowed.includes(origin) || isLovableOrigin
    ? origin
    : allowed[0];
  return {
    "Access-Control-Allow-Origin": matchedOrigin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

// ─── Response helpers ───────────────────────────────────────────────────────

function jsonOk(
  cors: Record<string, string>,
  payload: unknown,
  status = 200,
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function jsonError(
  cors: Record<string, string>,
  status: number,
  code: string,
  message: string,
  details?: unknown,
): Response {
  const body: { error: { code: string; message: string; details?: unknown } } = {
    error: { code, message },
  };
  if (details !== undefined) body.error.details = details;
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

// ─── Validation ─────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUUID(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

async function parseJsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

// ─── Auth ───────────────────────────────────────────────────────────────────
//
// Two paths:
//   1. service_role internal invocation (Authorization: Bearer <SERVICE_ROLE>)
//      — used by student submit handler as fire-and-forget.
//   2. End-user JWT — student of the attempt OR tutor of the assignment.
//      Falls back to ownership verification later.
//
// On either path we end up with a service_role client + a memo of who
// triggered the call (for telemetry only).

interface AuthResult {
  triggered_by: "service_role" | "user";
  user_id: string | null;
}

async function authenticate(
  req: Request,
  cors: Record<string, string>,
): Promise<AuthResult | Response> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonError(cors, 401, "UNAUTHORIZED", "Missing Authorization header");
  }
  const token = authHeader.slice("Bearer ".length).trim();
  if (token === SUPABASE_SERVICE_ROLE_KEY) {
    return { triggered_by: "service_role", user_id: null };
  }
  // Fallback: user JWT — validate via GoTrue REST.
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      Authorization: authHeader,
      apikey: SUPABASE_ANON_KEY,
    },
  });
  if (!resp.ok) {
    return jsonError(cors, 401, "UNAUTHORIZED", "Invalid or expired token");
  }
  const user = await resp.json();
  if (!user?.id) {
    return jsonError(cors, 401, "UNAUTHORIZED", "Invalid or expired token");
  }
  return { triggered_by: "user", user_id: user.id as string };
}

// ─── Storage helpers ────────────────────────────────────────────────────────

interface ParsedRef {
  bucket: string;
  path: string;
}

function parseStorageRef(ref: string | null | undefined): ParsedRef | null {
  if (!ref || typeof ref !== "string") return null;
  const trimmed = ref.trim();
  if (!trimmed.startsWith("storage://")) return null;
  const rest = trimmed.slice("storage://".length);
  const slashIdx = rest.indexOf("/");
  if (slashIdx <= 0) return null;
  const bucket = rest.slice(0, slashIdx);
  const path = rest.slice(slashIdx + 1);
  if (!bucket || !path) return null;
  return { bucket, path };
}

async function createSignedUrl(
  db: SupabaseClient,
  ref: string | null,
): Promise<string | null> {
  const parsed = parseStorageRef(ref);
  if (!parsed) {
    // Direct https URL — return as-is when it's already signed.
    if (typeof ref === "string" && ref.startsWith("https://")) return ref;
    return null;
  }
  const { data, error } = await db.storage
    .from(parsed.bucket)
    .createSignedUrl(parsed.path, SIGNED_URL_TTL_SEC);
  if (error || !data?.signedUrl) {
    console.warn("mock_exam_grade_signed_url_failed", {
      bucket: parsed.bucket,
      error: error?.message,
    });
    return null;
  }
  // Server-side fetch — keep direct host for lower latency (rewriteToDirect).
  // SDK already returns direct host, but be defensive in case future tooling
  // wraps to proxy.
  return rewriteToDirect(data.signedUrl);
}

// ─── AI image inline (mirrors homework-api/guided_ai.ts pattern) ────────────

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + CHUNK)),
    );
  }
  return btoa(binary);
}

function isAllowedSignedStorageUrl(url: string): boolean {
  // Same dual-host pattern as homework-api/guided_ai.ts: accept direct
  // (vrsseotrfmsxpbciyqzc.supabase.co) and proxy (api.sokratai.ru).
  return Boolean(
    (SUPABASE_URL && url.startsWith(`${SUPABASE_URL}/storage/v1/object/sign/`)) ||
    url.startsWith(`${SUPABASE_PROXY_URL}/storage/v1/object/sign/`),
  );
}

async function inlineImageToDataUrl(
  url: string | null,
): Promise<string | null> {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("data:")) return trimmed;

  if (!trimmed.startsWith("https://") || !isAllowedSignedStorageUrl(trimmed)) {
    console.warn("mock_exam_grade_inline_skipped", {
      reason: "unsupported_url",
      preview: trimmed.slice(0, 120),
    });
    return null;
  }

  // SVG guard — Gemini multimodal rejects SVGs (HTTP 400 from gateway).
  try {
    const parsed = new URL(trimmed);
    if (/\.svg(\?|$)/i.test(parsed.pathname)) return null;
  } catch {
    // URL parsing failed — let fetch surface the error.
  }

  try {
    // US→US fetch — convert proxy host back to direct (200-400ms saved).
    const fetchUrl = rewriteToDirect(trimmed);
    const response = await fetch(fetchUrl);
    if (!response.ok) {
      console.warn("mock_exam_grade_inline_fetch_failed", {
        status: response.status,
        preview: trimmed.slice(0, 120),
      });
      return null;
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_PROMPT_IMAGE_BYTES) {
      console.warn("mock_exam_grade_inline_too_large", {
        bytes: buffer.byteLength,
      });
      return null;
    }
    const mime = response.headers.get("content-type") || "image/jpeg";
    if (/image\/svg\+?xml/i.test(mime)) return null;

    return `data:${mime};base64,${arrayBufferToBase64(buffer)}`;
  } catch (error) {
    console.warn("mock_exam_grade_inline_error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function inlineImageRefs(
  refs: Array<string | null>,
  db: SupabaseClient,
): Promise<string[]> {
  const out: string[] = [];
  for (const ref of refs) {
    if (!ref) continue;
    const url = await createSignedUrl(db, ref);
    const data = await inlineImageToDataUrl(url);
    if (data) out.push(data);
  }
  return out;
}

// ─── Lovable AI Gateway (mirrors homework-api/ai_shared.ts callLovableJson) ─

class LovableHttpError extends Error {
  public readonly status: number;
  public readonly responseText: string;
  constructor(status: number, responseText: string) {
    super(`Lovable API HTTP ${status}`);
    this.name = "LovableHttpError";
    this.status = status;
    this.responseText = responseText;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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

  const fenced = normalized.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    const parsedFence = tryParseJsonObject(fenced[1].trim());
    if (parsedFence) return parsedFence;
  }

  const firstBrace = normalized.indexOf("{");
  const lastBrace = normalized.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const between = normalized.slice(firstBrace, lastBrace + 1);
    const parsedBetween = tryParseJsonObject(between);
    if (parsedBetween) return parsedBetween;
  }

  throw new Error(
    `Failed to extract valid JSON from model response: ${normalized.slice(0, 180)}`,
  );
}

function extractMessageContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((entry) =>
      isRecord(entry) && typeof entry.text === "string" ? entry.text : ""
    )
    .filter(Boolean)
    .join("\n")
    .trim();
}

function shouldRetry(error: unknown): boolean {
  if (error instanceof LovableHttpError) return error.status >= 500;
  if (error instanceof Error) {
    if (error.name === "AbortError") return true;
    if (error.name === "TypeError") return true;
  }
  return false;
}

async function callLovableJson(
  messages: LovableMessage[],
  telemetryTag: string,
  options?: {
    modelOverride?: string;
    captureRaw?: (raw: string) => void;
    // ai-usage-logging (2026-07-06): fire-and-forget hook with the parsed gateway
    // `usage` on a successful (HTTP 200) response. Observability only.
    onUsage?: (usage: TokenUsage | null) => void;
  },
): Promise<Record<string, unknown>> {
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

  const model = options?.modelOverride ?? LOVABLE_MODEL;

  for (let attempt = 0; attempt <= LOVABLE_MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      LOVABLE_REQUEST_TIMEOUT_MS,
    );

    try {
      const response = await fetch(LOVABLE_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.2,
          stream: false,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new LovableHttpError(response.status, errorText);
      }

      const payload = await response.json();
      // ai-usage-logging: surface token usage before content parsing (tokens are
      // billed on any 200, even an empty/invalid body). Defensive, never throws.
      if (options?.onUsage) {
        try {
          const usageRec = payload && typeof payload === "object" ? (payload as Record<string, unknown>).usage : null;
          const modelEcho = payload && typeof payload === "object" ? (payload as Record<string, unknown>).model : null;
          options.onUsage(
            usageRec && typeof usageRec === "object"
              ? {
                prompt_tokens: typeof (usageRec as Record<string, unknown>).prompt_tokens === "number" ? (usageRec as Record<string, number>).prompt_tokens : null,
                completion_tokens: typeof (usageRec as Record<string, unknown>).completion_tokens === "number" ? (usageRec as Record<string, number>).completion_tokens : null,
                total_tokens: typeof (usageRec as Record<string, unknown>).total_tokens === "number" ? (usageRec as Record<string, number>).total_tokens : null,
                model: typeof modelEcho === "string" ? modelEcho : (options.modelOverride ?? null),
              }
              : null,
          );
        } catch { /* fire-and-forget */ }
      }
      const messageContent = payload?.choices?.[0]?.message?.content;
      const rawContent = extractMessageContent(messageContent);
      if (!rawContent) throw new Error("Model response is empty");
      // TASK-16: verbose logging — captureRaw callback позволяет caller'у
      // сохранить raw Gemini response (для debug failed OCR без redeploy).
      if (options?.captureRaw) {
        try { options.captureRaw(rawContent); } catch { /* defensive */ }
      }
      return extractJsonObject(rawContent);
    } catch (error) {
      const canRetry = shouldRetry(error) && attempt < LOVABLE_MAX_RETRIES;
      if (error instanceof LovableHttpError) {
        console.warn(`${telemetryTag}_http_error`, {
          status: error.status,
          body_preview: error.responseText.slice(0, 500),
        });
      }
      if (canRetry) {
        console.warn(`${telemetryTag}_retry`, {
          attempt: attempt + 1,
          error: error instanceof Error ? error.message : "unknown error",
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

// ─── Per-task grading ───────────────────────────────────────────────────────

interface VariantTaskRow {
  kim_number: number;
  part: number;
  task_text: string;
  task_image_url: string | null;
  correct_answer: string | null;
  solution_text: string | null;
  max_score: number;
}

interface SolutionRow {
  kim_number: number;
  photo_url: string | null;
}

interface GradeOutcome {
  kim_number: number;
  draft: MockExamPart2Draft;
  used_fallback: MockExamFallbackReason | null;
  latency_ms: number;
}

function classifyError(error: unknown): MockExamFallbackReason {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (error.name === "AbortError" || message.includes("abort")) return "timeout";
    if (message.includes("failed to extract valid json") || message.includes("invalid json")) {
      return "invalid_json";
    }
    if (
      error instanceof LovableHttpError ||
      message.includes("http") ||
      message.includes("lovable")
    ) {
      return "gateway_error";
    }
  }
  return "gateway_error";
}

async function gradePart2Task(
  db: SupabaseClient,
  task: VariantTaskRow,
  solution: SolutionRow,
  attemptId: string,
  // ai-usage-logging (2026-07-06): source='mock_grade'. Undefined = no logging.
  onUsage?: (usage: TokenUsage | null) => void,
): Promise<GradeOutcome> {
  const start = Date.now();
  const kimNumber = task.kim_number;
  const maxScore = task.max_score;

  // Parse student photo refs. photo_url may be a single storage:// ref OR a
  // JSON array (бланк-режим может позволять несколько фото на задачу).
  const photoRefs = parsePhotoUrls(solution.photo_url);

  if (photoRefs.length === 0) {
    const fallback = buildFallbackDraft("no_photo", { maxScore, kimNumber });
    return {
      kim_number: kimNumber,
      draft: fallback,
      used_fallback: "no_photo",
      latency_ms: Date.now() - start,
    };
  }

  const taskImageRefs = task.task_image_url
    ? parsePhotoUrls(task.task_image_url).slice(0, MAX_TASK_IMAGES_FOR_AI)
    : [];

  // Inline images in parallel for this task (within-task parallelism;
  // inter-task parallelism happens at the caller).
  const [taskImageDataUrls, studentPhotoDataUrls] = await Promise.all([
    inlineImageRefs(taskImageRefs, db),
    inlineImageRefs(photoRefs.slice(0, MAX_STUDENT_PHOTOS_PER_TASK), db),
  ]);

  if (studentPhotoDataUrls.length === 0) {
    // We had refs but couldn't inline them — fail closed instead of guessing.
    const fallback = buildFallbackDraft("image_inline_failed", { maxScore, kimNumber });
    console.warn(JSON.stringify({
      event: "mock_exam_grade_inline_all_failed",
      attempt_id: attemptId,
      kim_number: kimNumber,
      photo_ref_count: photoRefs.length,
    }));
    return {
      kim_number: kimNumber,
      draft: fallback,
      used_fallback: "image_inline_failed",
      latency_ms: Date.now() - start,
    };
  }

  const messages = buildMockExamPart2Prompt({
    kim_number: kimNumber,
    max_score: maxScore,
    task_text: task.task_text ?? "",
    correct_answer: task.correct_answer,
    solution_text: task.solution_text,
    task_image_data_urls: taskImageDataUrls,
    student_photo_data_urls: studentPhotoDataUrls,
    // Phase 4 (2026-05-15) — subject-rubric integration. Hardcoded `physics + ege`
    // для mock-exams-v1 variant-1 (физика ЕГЭ). Когда добавится математический /
    // химический пробник — extend mock_exam_variants schema с `subject` колонкой +
    // pass из БД. См. .claude/rules/45-mock-exams.md «Mock-exams subject-rubric integration».
    subject: "physics",
    exam_type: "ege",
  });

  try {
    const parsed = await callLovableJson(messages, "mock_exam_grade", { onUsage });
    const draft = sanitizeMockExamPart2Draft(parsed, { maxScore, kimNumber });
    return {
      kim_number: kimNumber,
      draft,
      used_fallback: null,
      latency_ms: Date.now() - start,
    };
  } catch (error) {
    const reason = classifyError(error);
    console.warn(JSON.stringify({
      event: "mock_exam_grade_ai_failed",
      attempt_id: attemptId,
      kim_number: kimNumber,
      reason,
      error: error instanceof Error ? error.message : String(error),
    }));
    return {
      kim_number: kimNumber,
      draft: buildFallbackDraft(reason, { maxScore, kimNumber }),
      used_fallback: reason,
      latency_ms: Date.now() - start,
    };
  }
}

/**
 * Phase 6 bulk grading entry — single Часть 2 задача с pre-resolved
 * assigned photos из bulk-pack. Передаём photo data URLs напрямую, без
 * resolution внутри (Pass 1 уже сделал inline в parent handleGrade).
 *
 * `assignedPhotoIndices` — индексы из `attempt.part2_bulk_photo_urls`,
 * сохраняются в `ai_draft_json.assigned_photo_indices` для tutor UI
 * (chip «Фото №X из пакета» + drag-drop override через select dropdown).
 */
async function gradePart2TaskBulk(
  task: VariantTaskRow,
  attemptId: string,
  assignedPhotoDataUrls: string[],
  assignedPhotoIndices: number[],
  // ai-usage-logging (2026-07-06): source='mock_grade'. Undefined = no logging.
  onUsage?: (usage: TokenUsage | null) => void,
): Promise<GradeOutcome> {
  const start = Date.now();
  const kimNumber = task.kim_number;
  const maxScore = task.max_score;

  if (assignedPhotoDataUrls.length === 0) {
    // AI assignment didn't link any photo (или photos failed to inline).
    // Tutor увидит warning + manual override через select dropdown.
    const fallback = buildFallbackDraft("no_photo", { maxScore, kimNumber });
    return {
      kim_number: kimNumber,
      draft: { ...fallback, assigned_photo_indices: assignedPhotoIndices },
      used_fallback: "no_photo",
      latency_ms: Date.now() - start,
    };
  }

  // Inline task images (условие) — Pass 2 нужно для multimodal context.
  const taskImageRefs = task.task_image_url
    ? parsePhotoUrls(task.task_image_url).slice(0, MAX_TASK_IMAGES_FOR_AI)
    : [];
  const taskImageDataUrls = taskImageRefs.length > 0
    ? await inlineImageRefs(taskImageRefs, getDbForBulk())
    : [];

  const messages = buildMockExamPart2Prompt({
    kim_number: kimNumber,
    max_score: maxScore,
    task_text: task.task_text ?? "",
    correct_answer: task.correct_answer,
    solution_text: task.solution_text,
    task_image_data_urls: taskImageDataUrls,
    student_photo_data_urls: assignedPhotoDataUrls.slice(0, MAX_STUDENT_PHOTOS_PER_TASK),
    subject: "physics",
    exam_type: "ege",
  });

  try {
    const parsed = await callLovableJson(messages, "mock_exam_grade_bulk", { onUsage });
    const draft = sanitizeMockExamPart2Draft(parsed, { maxScore, kimNumber });
    return {
      kim_number: kimNumber,
      // Phase 6: persist photo assignment в ai_draft_json для tutor UI.
      draft: { ...draft, assigned_photo_indices: assignedPhotoIndices },
      used_fallback: null,
      latency_ms: Date.now() - start,
    };
  } catch (error) {
    const reason = classifyError(error);
    console.warn(JSON.stringify({
      event: "mock_exam_grade_bulk_ai_failed",
      attempt_id: attemptId,
      kim_number: kimNumber,
      reason,
      assigned_photo_count: assignedPhotoDataUrls.length,
      error: error instanceof Error ? error.message : String(error),
    }));
    return {
      kim_number: kimNumber,
      draft: {
        ...buildFallbackDraft(reason, { maxScore, kimNumber }),
        assigned_photo_indices: assignedPhotoIndices,
      },
      used_fallback: reason,
      latency_ms: Date.now() - start,
    };
  }
}

// Helper для получения db inside gradePart2TaskBulk — Deno scope иначе требует
// taking db в каждый async helper. Используем closure через service-role
// (read-only для task images — safe).
let _cachedAdminDb: SupabaseClient | null = null;
function getDbForBulk(): SupabaseClient {
  if (!_cachedAdminDb) {
    _cachedAdminDb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return _cachedAdminDb;
}

/**
 * Phase 6 (2026-05-15) — AI Часть 1 OCR pipeline.
 *
 * Запускается из `handleGrade` для blank-mode attempts. Single Gemini
 * call → recognized answers per kim 1-20. Затем для каждого:
 *  1. Run `checkPart1` (existing deterministic checker, shared module).
 *  2. Upsert `mock_exam_attempt_part1_answers` с `student_answer +
 *     earned_score`. **Tutor preservation**: skip rows где tutor уже
 *     вручную выставил earned_score через `/part1-manual-score`.
 *  3. Update `mock_exam_attempts.ai_part1_ocr_json` = full result для
 *     tutor UI pre-fill.
 *
 * TASK-OCR-3 (2026-05-21): `promptMode` parameter selects between FIPI
 * grid prompt (`buildPart1BlankOCRPrompt`) и freeform photo prompt
 * (`buildPart1FreeformOCRPrompt`). `__meta.prompt_mode` saved so tutor
 * UI can show appropriate context («распознали с бланка ФИПИ» vs
 * «распознали с произвольного фото»).
 *
 * Errors каждого этапа логируются + не блокируют Часть 2 grading
 * (caller использует Promise.all).
 *
 * @returns OCR result + total earned (для telemetry) ИЛИ null при ошибке
 */
async function runPart1OCR(
  db: SupabaseClient,
  attemptId: string,
  photoRef: string,
  variantId: string,
  promptMode: "blank" | "freeform" = "blank",
  // ai-usage-logging (2026-07-06): source='mock_ocr'. Undefined = no logging.
  onUsage?: (usage: TokenUsage | null) => void,
): Promise<{ ocr: Part1OCRResult; totalEarned: number } | null> {
  if (!photoRef || !variantId) return null;

  try {
    // Load Часть 1 variant tasks (kim 1-20).
    const { data: part1Tasks, error: part1Err } = await db
      .from("mock_exam_variant_tasks")
      .select("kim_number, max_score, check_mode, correct_answer")
      .eq("variant_id", variantId)
      .eq("part", 1)
      .order("kim_number", { ascending: true });
    if (part1Err || !part1Tasks || part1Tasks.length === 0) {
      console.warn("mock_exam_grade_part1_ocr_no_tasks", {
        attempt_id: attemptId,
        variant_id: variantId,
        error: part1Err?.message,
      });
      return null;
    }

    // Inline photo. photoRef обычно single storage:// ref (either canonical
    // ФИПИ-blank photo OR freeform fallback — выбирается caller'ом через
    // promptMode parameter).
    const refs = parsePhotoUrls(photoRef);
    const photoDataUrls = await inlineImageRefs(refs.slice(0, 1), db);
    if (photoDataUrls.length === 0) {
      console.warn("mock_exam_grade_part1_ocr_inline_failed", {
        attempt_id: attemptId,
        prompt_mode: promptMode,
        photo_ref: photoRef.slice(0, 80),
      });
      // TASK-OCR-3: persist failure snapshot с prompt_mode for tutor diagnostics.
      const nowIso = new Date().toISOString();
      const failureSnapshot: Record<string, unknown> = {
        cells: {},
        __meta: {
          status: "failed",
          prompt_mode: promptMode,
          gemini_model: LOVABLE_MODEL_OCR,
          error: "image_inline_failed",
          raw_response: null,
          failed_at: nowIso,
          generated_at: nowIso,
        },
      };
      await db
        .from("mock_exam_attempts")
        .update({ ai_part1_ocr_json: failureSnapshot })
        .eq("id", attemptId)
        .catch(() => null);
      return null;
    }

    // Build prompt + call Gemini OCR.
    const tasksMeta: Part1OCRTaskMeta[] = (part1Tasks as Array<{
      kim_number: number;
      max_score: number;
      check_mode: string;
    }>).map((t) => ({
      kim_number: t.kim_number,
      max_score: t.max_score,
      check_mode: (t.check_mode as Part1OCRTaskMeta["check_mode"]) ?? "strict",
    }));

    // TASK-OCR-3 (2026-05-21): prompt selection based on photo source.
    //  - 'blank'    — official ФИПИ blank, grid-aware prompt expects cells 1-20.
    //  - 'freeform' — arbitrary photo (тетрадный лист / черновик / скан),
    //                 prompt просит AI извлечь номера задач без grid-assumption.
    const ocrMessages = promptMode === "freeform"
      ? buildPart1FreeformOCRPrompt(tasksMeta, photoDataUrls[0])
      : buildPart1BlankOCRPrompt(tasksMeta, photoDataUrls[0]);
    // TASK-16 (2026-05-15): model swap на gemini-2.5-pro + raw response
    // capture для verbose logging.
    let rawResponseSnapshot: string | null = null;
    let parsed: Record<string, unknown>;
    try {
      parsed = await callLovableJson(ocrMessages, "mock_exam_part1_ocr", {
        modelOverride: LOVABLE_MODEL_OCR,
        captureRaw: (raw) => { rawResponseSnapshot = raw.slice(0, 4000); },
        onUsage,
      });
    } catch (callErr) {
      // TASK-16-R2 fix #4 (ChatGPT-5.5 review): canonical shape
      // `{ cells, __meta: { status, ... } }` — frontend ветвит на
      // `__meta.status === 'failed'` → rose warning banner. Раньше top-level
      // fields + truthy ai_part1_ocr_json → green «AI распознал» на failure.
      // TASK-OCR-3 (2026-05-21): add prompt_mode so tutor UI can distinguish
      // FIPI-blank failures vs freeform photo failures.
      const nowIso = new Date().toISOString();
      const failureSnapshot: Record<string, unknown> = {
        cells: {},
        __meta: {
          status: "failed",
          prompt_mode: promptMode,
          gemini_model: LOVABLE_MODEL_OCR,
          error: callErr instanceof Error ? callErr.message : String(callErr),
          raw_response: rawResponseSnapshot,
          failed_at: nowIso,
          generated_at: nowIso,
        },
      };
      await db
        .from("mock_exam_attempts")
        .update({ ai_part1_ocr_json: failureSnapshot })
        .eq("id", attemptId)
        .catch(() => null);
      console.error("mock_exam_grade_part1_ocr_call_failed", {
        attempt_id: attemptId,
        prompt_mode: promptMode,
        error: callErr instanceof Error ? callErr.message : String(callErr),
        raw_preview: rawResponseSnapshot?.slice(0, 200) ?? null,
      });
      return null;
    }
    const ocrResult = sanitizePart1OCRResult(parsed);
    // PII-free telemetry: подсчитать сколько cells AI распознал с high confidence.
    const recognizedCount = Object.values(ocrResult).filter(
      (c) => c && typeof c.value === "string" && c.value.length > 0,
    ).length;
    console.info("mock_exam_grade_part1_ocr_response", {
      attempt_id: attemptId,
      prompt_mode: promptMode,
      recognized_cells: recognizedCount,
      total_kims: 20,
      gemini_model: LOVABLE_MODEL_OCR,
      raw_length: rawResponseSnapshot?.length ?? 0,
    });

    // Load existing per-kim answers — preserve ТОЛЬКО ручные tutor edits.
    // TASK-16-R2 fix #1 (ChatGPT-5.5 review): раньше использовали
    // `earned_score IS NOT NULL` как signal "tutor preserved row", но первый OCR
    // run сам пишет earned_score для всех 20 KIM → retry skip'ал всё → scores
    // оставались stale. Теперь явный enum `score_source` различает источник.
    const { data: existingAnswers } = await db
      .from("mock_exam_attempt_part1_answers")
      .select("kim_number, earned_score, score_source")
      .eq("attempt_id", attemptId);
    const tutorScoredKims = new Set<number>();
    for (const row of (existingAnswers ?? []) as Array<{
      kim_number: number;
      earned_score: number | null;
      score_source: string;
    }>) {
      // Skip ТОЛЬКО tutor manual edits. OCR / finalize_default / student_form
      // rows перезаписываются freshly при retry.
      if (row.score_source === "tutor") tutorScoredKims.add(row.kim_number);
    }

    // Run checker + upsert per-kim answers (только для не-tutor-scored).
    const tasksByKim = new Map<number, {
      kim_number: number;
      max_score: number;
      check_mode: CheckMode;
      correct_answer: string | null;
    }>();
    for (const t of part1Tasks as Array<{
      kim_number: number;
      max_score: number;
      check_mode: string;
      correct_answer: string | null;
    }>) {
      tasksByKim.set(t.kim_number, {
        kim_number: t.kim_number,
        max_score: t.max_score,
        check_mode: (t.check_mode as CheckMode) ?? "strict",
        correct_answer: t.correct_answer,
      });
    }

    let totalEarned = 0;
    // TASK-OCR Round 6 (2026-05-21) — fix critical bug: схема
    // mock_exam_attempt_part1_answers (миграция 20260508120000) НЕ имеет
    // колонки max_score. Postgres возвращал 42703 при upsert → upsertErr
    // logged как warning, но НЕ propagated → ai_part1_ocr_json записывался,
    // earned_score per KIM НЕТ. Banner показывал «12/20 recognized», но
    // input'ы tutor видел пустыми. Diagnosed via Supabase SQL editor 2026-05-21.
    const upserts: Array<{
      attempt_id: string;
      kim_number: number;
      student_answer: string | null;
      earned_score: number;
      score_source: "ocr";
      updated_at: string;
    }> = [];

    for (let kim = 1; kim <= 20; kim++) {
      if (tutorScoredKims.has(kim)) continue; // Preserve manual tutor edits only.
      const task = tasksByKim.get(kim);
      if (!task) continue;
      const cell = ocrResult[kim] ?? { value: null, confidence: "low" as const };
      const checkResult = checkPart1(
        task.correct_answer,
        cell.value,
        task.check_mode,
        task.max_score,
        kim,
      );
      totalEarned += checkResult.earned;
      upserts.push({
        attempt_id: attemptId,
        kim_number: kim,
        student_answer: cell.value,
        earned_score: checkResult.earned,
        // max_score колонки нет в схеме (см. comment выше) — НЕ писать!
        score_source: "ocr", // TASK-16-R2: track provenance for retry-safe distinguishment.
        updated_at: new Date().toISOString(),
      });
    }

    if (upserts.length > 0) {
      const { error: upsertErr } = await db
        .from("mock_exam_attempt_part1_answers")
        .upsert(upserts, { onConflict: "attempt_id,kim_number" });

      // TASK-OCR Round 6 (2026-05-21): если upsert упал — это критично, не
      // молчим. Раньше bug с max_score (см. comment выше) валил upsert
      // тихо, и frontend видел «AI распознал N/20» без earned_score в DB.
      // Теперь error поднимается явно — surface в logs + ai_part1_ocr_json
      // не обновляется (consistency: либо оба записаны, либо ничего).
      if (upsertErr) {
        console.error("mock_exam_grade_part1_ocr_upsert_failed_critical", {
          attempt_id: attemptId,
          error: upsertErr.message,
          upserts_count: upserts.length,
        });
        return null;
      }

      // TASK-OCR Round 4 (2026-05-21): обновляем attempt.total_part1_score
      // сразу после OCR upsert. Без этого student result page не покажет
      // «X/28» preview — total_part1_score остаётся null пока tutor не
      // нажмёт «Часть 1 проверена» или approve-all. Vladimir UX request:
      // ученик видит Часть 1 сразу после OCR с пометкой «Предварительно».
      //
      // SUM включает все existing rows (tutor_scored + new OCR upserts —
      // upserts уже скоммитнуты выше). Безопасно — мы здесь только если
      // upsert succeeded (Round 6 early-return на failure выше).
      try {
        const { data: allAnswers } = await db
          .from("mock_exam_attempt_part1_answers")
          .select("earned_score")
          .eq("attempt_id", attemptId);
        const totalPart1 = (allAnswers ?? []).reduce(
          (acc, row) => acc + ((row.earned_score as number | null) ?? 0),
          0,
        );
        const { error: scoreUpdateErr } = await db
          .from("mock_exam_attempts")
          .update({ total_part1_score: totalPart1 })
          .eq("id", attemptId);
        if (scoreUpdateErr) {
          console.warn("mock_exam_grade_part1_ocr_total_update_failed", {
            attempt_id: attemptId,
            error: scoreUpdateErr.message,
          });
        } else {
          console.info(JSON.stringify({
            event: "mock_exam_grade_part1_ocr_total_persisted",
            attempt_id: attemptId,
            total_part1_score: totalPart1,
          }));
        }
      } catch (totalErr) {
        console.warn("mock_exam_grade_part1_ocr_total_compute_failed", {
          attempt_id: attemptId,
          error: totalErr instanceof Error ? totalErr.message : String(totalErr),
        });
      }
    }

    // Update attempt with full OCR result для tutor UI pre-fill.
    // TASK-16-R2 fix #4: canonical shape `{ cells, __meta }` — frontend читает
    // `ai_part1_ocr_json.cells[kim]` (не top-level). `__meta.status` различает
    // success vs failure (см. failureSnapshot выше). `recognized_cells=0` при
    // status='success' = soft failure (AI ничего не распознал) → amber banner.
    // TASK-OCR-3 (2026-05-21): `prompt_mode` помогает tutor UI выбрать копи —
    // «AI распознал с бланка ФИПИ» vs «AI распознал с фото».
    const ocrPayload: Record<string, unknown> = {
      cells: { ...ocrResult },
      __meta: {
        status: "success",
        prompt_mode: promptMode,
        gemini_model: LOVABLE_MODEL_OCR,
        recognized_cells: recognizedCount,
        raw_length: rawResponseSnapshot?.length ?? 0,
        generated_at: new Date().toISOString(),
      },
    };
    const { error: updateErr } = await db
      .from("mock_exam_attempts")
      .update({ ai_part1_ocr_json: ocrPayload })
      .eq("id", attemptId);
    if (updateErr) {
      console.warn("mock_exam_grade_part1_ocr_attempt_update_failed", {
        attempt_id: attemptId,
        error: updateErr.message,
      });
    }

    return { ocr: ocrResult, totalEarned };
  } catch (err) {
    console.error("mock_exam_grade_part1_ocr_exception", {
      attempt_id: attemptId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// Parses a photo_url field that may be:
//  - null/"" → []
//  - "storage://..." (single) → [ref]
//  - JSON array of refs → string[]
/**
 * Phase 6 (2026-05-15) review-fix #3: reuse tutor-corrected photo assignments
 * from persisted `ai_draft_json.assigned_photo_indices` instead of re-running
 * AI Pass 1. Returns null if NO row has the `assigned_photo_indices` key in
 * its draft (first-time auto-grade — AI Pass 1 should run). Returns full
 * BulkAssignmentResult if at least one kim has the key persisted (signal
 * "tutor touched this", даже если все привязки очищены в `unassigned`).
 *
 * Round 3 review-fix P2 #1: `anyPersisted` signal должен учитывать просто
 * **presence of the key**, не non-empty array. Иначе UX-кейс «tutor очистил
 * все привязки → expects regrade без AI Pass 1» ломается (Pass 1 запустится
 * и перезатрёт ручную очистку).
 *
 * Validation: indices clamped to [0, totalPhotos). All photos not assigned
 * to any kim → `unassigned` bucket.
 */
function buildAssignmentFromPersisted(
  solutionsByKim: Map<
    number,
    SolutionRow & { status?: string; ai_draft_json?: unknown; tutor_score?: number | null }
  >,
  allKimNumbers: number[],
  totalPhotos: number,
): BulkAssignmentResult | null {
  let anyPersisted = false;
  const result: BulkAssignmentResult = {};
  const usedIndices = new Set<number>();

  for (const kim of allKimNumbers) {
    const sol = solutionsByKim.get(kim);
    const draft = sol?.ai_draft_json;
    if (draft && typeof draft === "object" && "assigned_photo_indices" in draft) {
      // Key present → tutor touched this row (через /assign-part2-photos),
      // даже если value = []. Signal "do not run AI Pass 1".
      anyPersisted = true;
      const indices = (draft as { assigned_photo_indices?: unknown }).assigned_photo_indices;
      if (Array.isArray(indices)) {
        const cleaned = indices
          .filter((x): x is number => typeof x === "number" && Number.isInteger(x))
          .filter((idx) => idx >= 0 && idx < totalPhotos);
        result[kim] = cleaned;
        cleaned.forEach((idx) => usedIndices.add(idx));
        continue;
      }
      // Key present но value не array (corrupted draft) → treat as empty.
      result[kim] = [];
      continue;
    }
    result[kim] = [];
  }

  if (!anyPersisted) return null;

  // Photos not assigned to any kim → unassigned bucket.
  const unassigned: number[] = [];
  for (let i = 0; i < totalPhotos; i++) {
    if (!usedIndices.has(i)) unassigned.push(i);
  }
  result.unassigned = unassigned;

  return result;
}

function parsePhotoUrls(value: string | null): string[] {
  if (!value || typeof value !== "string") return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (s): s is string => typeof s === "string" && s.trim().length > 0,
        );
      }
    } catch {
      // malformed JSON — fall through to single-value
    }
  }
  return [trimmed];
}

// ─── Tutor notification (best-effort) ──────────────────────────────────────

async function notifyTutorReadyForReview(
  db: SupabaseClient,
  tutorUserId: string,
  attemptId: string,
  assignmentTitle: string,
): Promise<{ delivered: boolean; channel: string | null }> {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return { delivered: false, channel: null };
  }
  const appUrl = (Deno.env.get("PUBLIC_APP_URL")?.trim().replace(/\/$/, "")) ??
    "https://sokratai.ru";
  const payload: PushPayload = {
    title: `AI проверил пробник: ${assignmentTitle}`,
    body: "Открой проверку и подтверди баллы Части 2.",
    url: `${appUrl}/tutor/mock-exams/attempts/${attemptId}/review`,
  };

  const { data: subs } = await db
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("user_id", tutorUserId);
  for (const sub of (subs ?? []) as PushSubscriptionData[]) {
    try {
      const result = await sendPushNotification(
        sub,
        payload,
        VAPID_PUBLIC_KEY,
        VAPID_PRIVATE_KEY,
        VAPID_SUBJECT,
      );
      if (result.success) return { delivered: true, channel: "push" };
    } catch (err) {
      console.warn("mock_exam_grade_push_error", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { delivered: false, channel: null };
}

// ─── Main handler ───────────────────────────────────────────────────────────

interface AttemptRow {
  id: string;
  assignment_id: string;
  status: string;
  student_id: string | null;
  anonymous_id: string | null;
  // Phase 6 (2026-05-15) — bulk path + AI Часть 1 OCR.
  answer_method?: "blank" | "form" | null;
  // Phase 6 Round 3 review-fix P1 #1: AI OCR использует CANONICAL ФИПИ-бланк
  // (`blank_photo_url`), не `part1_blank_photo_url` (последний — fallback path
  // «решал не на ФИПИ бланке», prompt не подходит для него).
  blank_photo_url?: string | null;
  part1_blank_photo_url?: string | null; // legacy fallback — see note above
  part2_bulk_photo_urls?: string | null; // dual-format (single ref OR JSON array)
  // TASK-16-R2 fix #4: canonical shape `{ cells, __meta }`. Здесь используется
  // только для idempotent check `!attemptRow.ai_part1_ocr_json` в `shouldRunPart1OCR`
  // (truthy guard, без deep access), потому loose `unknown` тип допустим.
  ai_part1_ocr_json?: unknown | null;
  // Phase 6 review-fix #1: used для stale-lock detection в CAS claim.
  updated_at?: string | null;
}

interface AssignmentRow {
  id: string;
  tutor_id: string;
  title: string;
  variant_id: string | null;
  mode: string;
}

async function handleGrade(
  db: SupabaseClient,
  auth: AuthResult,
  attemptId: string,
  cors: Record<string, string>,
  options?: { forceRetryOCR?: boolean },
): Promise<Response> {
  if (!isUUID(attemptId)) {
    return jsonError(cors, 400, "INVALID_ID", "Invalid attempt_id");
  }

  // Load attempt + assignment. Phase 6 fields: answer_method, blank/bulk photo URLs,
  // ai_part1_ocr_json (для idempotent reruns — не запускать OCR если уже есть).
  // updated_at — для stale-lock detection в Phase 6 review-fix #1 CAS guard.
  // Round 3 review-fix P1 #1: select `blank_photo_url` (canonical ФИПИ-бланк) —
  // OCR должен идти по нему, не по `part1_blank_photo_url` (fallback path).
  const { data: attempt, error: attemptErr } = await db
    .from("mock_exam_attempts")
    .select(
      "id, assignment_id, status, student_id, anonymous_id, " +
        "answer_method, blank_photo_url, part1_blank_photo_url, " +
        "part2_bulk_photo_urls, ai_part1_ocr_json, updated_at",
    )
    .eq("id", attemptId)
    .maybeSingle();
  if (attemptErr) {
    return jsonError(cors, 500, "DB_ERROR", "Failed to load attempt");
  }
  if (!attempt) {
    return jsonError(cors, 404, "NOT_FOUND", "Attempt not found");
  }
  const attemptRow = attempt as AttemptRow;

  const { data: assignment, error: assignmentErr } = await db
    .from("mock_exam_assignments")
    .select("id, tutor_id, title, variant_id, mode")
    .eq("id", attemptRow.assignment_id)
    .maybeSingle();
  if (assignmentErr || !assignment) {
    return jsonError(cors, 500, "DB_ERROR", "Failed to load assignment");
  }
  const assignmentRow = assignment as AssignmentRow;

  // ai-usage-logging (2026-07-06): observability only. user_id = student who took
  // the attempt (fallback tutor for anonymous attempts, so the NOT NULL column is
  // satisfied); assignment_id = the mock assignment for tutor-level rollups.
  // Fire-and-forget — `makeUsageLogger` no-ops when userId is missing.
  const usageUserId = attemptRow.student_id ?? assignmentRow.tutor_id ?? null;
  const gradeUsageLogger = makeUsageLogger(db, {
    userId: usageUserId,
    source: "mock_grade",
    assignmentId: attemptRow.assignment_id,
  });
  const ocrUsageLogger = makeUsageLogger(db, {
    userId: usageUserId,
    source: "mock_ocr",
    assignmentId: attemptRow.assignment_id,
  });

  // Ownership guard for user-JWT path. Service-role bypasses (internal call).
  if (auth.triggered_by === "user") {
    const userId = auth.user_id ?? "";
    const ownsAsStudent = attemptRow.student_id === userId;
    const ownsAsTutor = assignmentRow.tutor_id === userId;
    if (!ownsAsStudent && !ownsAsTutor) {
      return jsonError(cors, 403, "FORBIDDEN", "You do not own this attempt");
    }
  }

  if (assignmentRow.mode === "manual_entry") {
    return jsonError(
      cors,
      400,
      "INVALID_STATE",
      "Manual-entry attempts have no AI grading",
    );
  }

  if (!assignmentRow.variant_id) {
    return jsonError(
      cors,
      400,
      "INVALID_STATE",
      "Assignment has no variant — cannot grade",
    );
  }

  // State machine: only run when submitted (start) or already ai_checking
  // (idempotent retry — defensive). Refuse already-graded attempts.
  if (attemptRow.status === "approved") {
    return jsonError(cors, 409, "ALREADY_APPROVED", "Attempt already approved");
  }
  if (attemptRow.status === "manually_entered") {
    return jsonError(cors, 409, "MANUAL_ENTRY", "Manual-entry attempt — nothing to grade");
  }
  if (attemptRow.status === "in_progress") {
    return jsonError(cors, 400, "NOT_SUBMITTED", "Attempt has not been submitted yet");
  }
  if (
    attemptRow.status !== "submitted" &&
    attemptRow.status !== "ai_checking" &&
    attemptRow.status !== "awaiting_review"
  ) {
    return jsonError(
      cors,
      400,
      "INVALID_STATE",
      `Cannot grade attempt in status '${attemptRow.status}'`,
    );
  }

  // Phase 6 review-fix #1 (2026-05-15): atomic claim для concurrent runner
  // protection. CAS guards теперь работают и для status='ai_checking' (раньше
  // только для 'submitted'). Two cases:
  //   - status='submitted' → claim через CAS на submitted, проставить ai_checking.
  //   - status='ai_checking' → возможно другой runner работает. Если
  //     attempt.updated_at < 120s (typical grade run 30-90s) → 202 retry-later.
  //     Иначе (stale lock от crashed runner) → принять и продолжить.
  //   - status='awaiting_review' → re-grade allowed by spec (idempotent),
  //     не требует claim (status уже terminal по AI).
  const STALE_LOCK_AGE_MS = 120_000;
  if (attemptRow.status === "submitted") {
    const { data: claimed, error: stateErr } = await db
      .from("mock_exam_attempts")
      .update({ status: "ai_checking", updated_at: new Date().toISOString() })
      .eq("id", attemptId)
      .eq("status", "submitted") // CAS guard
      .select("id");
    if (stateErr) {
      console.warn("mock_exam_grade_state_transition_failed", {
        attempt_id: attemptId,
        error: stateErr.message,
      });
    } else if (!claimed || claimed.length === 0) {
      // Lost the race — другой runner забрал claim. Refresh status, abort
      // если не stale.
      const { data: fresh } = await db
        .from("mock_exam_attempts")
        .select("status, updated_at")
        .eq("id", attemptId)
        .maybeSingle();
      if (fresh && fresh.status === "ai_checking") {
        const ageMs = fresh.updated_at
          ? Date.now() - new Date(fresh.updated_at as string).getTime()
          : Infinity;
        if (ageMs < STALE_LOCK_AGE_MS) {
          console.info(JSON.stringify({
            event: "mock_exam_grade_already_running",
            attempt_id: attemptId,
            other_runner_age_ms: ageMs,
          }));
          return jsonError(
            cors,
            202,
            "ALREADY_GRADING",
            "Another grader is already processing this attempt — retry shortly",
          );
        }
        // Stale lock — proceed (existing runner crashed/timed out).
      }
    }
  } else if (attemptRow.status === "ai_checking") {
    // Attempt уже в ai_checking — либо legitimate stale recovery (crashed
    // runner), либо concurrent runner. Round 3 review-fix P1 #3: убран
    // service_role bypass — все callers (включая /regrade-part2 internal
    // call) идут через единый fresh-lock detection. /regrade-part2 теперь
    // принимает только awaiting_review статус, так что попадание сюда —
    // действительно либо stale recovery, либо race с initial grading.
    const ageMs = attemptRow.updated_at
      ? Date.now() - new Date(attemptRow.updated_at as string).getTime()
      : Infinity;
    if (ageMs < STALE_LOCK_AGE_MS) {
      console.info(JSON.stringify({
        event: "mock_exam_grade_already_running",
        attempt_id: attemptId,
        lock_age_ms: ageMs,
        triggered_by: auth.triggered_by,
      }));
      return jsonError(
        cors,
        202,
        "ALREADY_GRADING",
        "Another grader is already processing this attempt — retry shortly",
      );
    }
    // Stale lock detected (runner crashed / timed out — > 120s без updates).
    // Atomic claim через CAS: UPDATE updated_at WHERE updated_at < cutoff.
    // Если 0 rows affected → конкурент уже забрал claim → return 202.
    const cutoff = new Date(Date.now() - STALE_LOCK_AGE_MS).toISOString();
    const { data: claimedStale, error: refreshErr } = await db
      .from("mock_exam_attempts")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", attemptId)
      .eq("status", "ai_checking")
      .lt("updated_at", cutoff)
      .select("id");
    if (refreshErr) {
      console.warn("mock_exam_grade_stale_claim_failed", {
        attempt_id: attemptId,
        error: refreshErr.message,
      });
    } else if (!claimedStale || claimedStale.length === 0) {
      // Race lost — another runner reclaimed stale lock first.
      return jsonError(
        cors,
        202,
        "ALREADY_GRADING",
        "Another grader has reclaimed this attempt — retry shortly",
      );
    } else {
      console.info(JSON.stringify({
        event: "mock_exam_grade_stale_lock_recovered",
        attempt_id: attemptId,
        previous_lock_age_ms: ageMs,
      }));
    }
  } else if (attemptRow.status === "awaiting_review") {
    // P0 #2 (mock-exam-grading-v2): regrade тоже атомарно клеймит
    // awaiting_review → ai_checking. Без этого два конкурентных regrade
    // (multi-tab / ручной+авто) пишут ai_draft_json last-writer-wins, и старший
    // runner восстанавливает stale привязку. Финальный переход
    // ai_checking → awaiting_review (ниже) round-trip'ит обратно.
    const { data: claimedRegrade, error: claimErr } = await db
      .from("mock_exam_attempts")
      .update({ status: "ai_checking", updated_at: new Date().toISOString() })
      .eq("id", attemptId)
      .eq("status", "awaiting_review") // CAS guard
      .select("id");
    if (claimErr) {
      console.warn("mock_exam_grade_regrade_claim_failed", {
        attempt_id: attemptId,
        error: claimErr.message,
      });
    } else if (!claimedRegrade || claimedRegrade.length === 0) {
      console.info(JSON.stringify({
        event: "mock_exam_grade_regrade_already_running",
        attempt_id: attemptId,
      }));
      return jsonError(
        cors,
        202,
        "ALREADY_GRADING",
        "Another grader is already processing this attempt — retry shortly",
      );
    }
    // Claim won → proceed (status now ai_checking).
  }

  // Fetch Часть 2 variant tasks (kim_number → row) for this variant.
  const { data: variantTasks, error: variantErr } = await db
    .from("mock_exam_variant_tasks")
    .select("kim_number, part, task_text, task_image_url, correct_answer, solution_text, max_score")
    .eq("variant_id", assignmentRow.variant_id)
    .eq("part", 2)
    .order("kim_number", { ascending: true });
  if (variantErr || !variantTasks) {
    return jsonError(cors, 500, "DB_ERROR", "Failed to load variant tasks");
  }
  const part2TasksByKim = new Map<number, VariantTaskRow>();
  for (const t of variantTasks as VariantTaskRow[]) {
    part2TasksByKim.set(t.kim_number, t);
  }

  // Fetch existing part2 solutions to know which photos student uploaded.
  // Phase 6 (2026-05-15) review-fix #3 + #2: extended SELECT с ai_draft_json
  // + tutor_score чтобы regrade мог reuse persisted assignments И conditional
  // skip tutor-edited rows.
  const { data: solutions, error: solutionsErr } = await db
    .from("mock_exam_attempt_part2_solutions")
    .select("kim_number, photo_url, status, ai_draft_json, tutor_score")
    .eq("attempt_id", attemptId);
  if (solutionsErr) {
    return jsonError(cors, 500, "DB_ERROR", "Failed to load part2 solutions");
  }
  const solutionsByKim = new Map<
    number,
    SolutionRow & { status?: string; ai_draft_json?: unknown; tutor_score?: number | null }
  >();
  for (const s of (solutions ?? []) as Array<
    SolutionRow & { status?: string; ai_draft_json?: unknown; tutor_score?: number | null }
  >) {
    solutionsByKim.set(s.kim_number, s);
  }

  // For Часть 2 tasks where student has no row yet (бланк-режим with global
  // blank_photo_url), we still emit a placeholder row so tutor sees one card
  // per kim_number. photo_url stays null → fallback "no_photo".
  const allKimNumbers = Array.from(part2TasksByKim.keys()).sort((a, b) => a - b);

  // Phase 6 (2026-05-15): detect bulk attempts. `part2_bulk_photo_urls` —
  // dual-format строка (single ref ИЛИ JSON array). Если есть хотя бы 1 фото
  // → запускаем Pass 1 (AI assignment), затем Pass 2 (per-kim grading
  // c assigned photos). Иначе → legacy per-kim path (Egor's pilot).
  const bulkPhotoRefs = parsePhotoUrls(attemptRow.part2_bulk_photo_urls ?? null);
  const isBulkMode = bulkPhotoRefs.length > 0;

  // Phase 6: AI assignment from Pass 1, persisted into ai_draft_json.assigned_photo_indices.
  // Empty Map для legacy path.
  let bulkAssignment: BulkAssignmentResult | null = null;
  let inlinedBulkPhotos: string[] = [];

  if (isBulkMode) {
    try {
      // Inline all bulk photos in parallel (within-attempt parallelism).
      inlinedBulkPhotos = await inlineImageRefs(bulkPhotoRefs, db);
      if (inlinedBulkPhotos.length === 0) {
        console.warn(JSON.stringify({
          event: "mock_exam_grade_bulk_inline_all_failed",
          attempt_id: attemptId,
          photo_ref_count: bulkPhotoRefs.length,
        }));
        // Fall back: per-kim path с photo_missing для каждой задачи.
      } else {
        // Phase 6 review-fix #3: check persisted assignments first. Если tutor
        // вручную привязал фото к задачам через `/assign-part2-photos` —
        // используем те indices, **не запускаем Pass 1 заново**. Иначе AI
        // перезатрёт ручную правку tutor'а на каждом regrade.
        const persistedAssignment = buildAssignmentFromPersisted(
          solutionsByKim,
          allKimNumbers,
          inlinedBulkPhotos.length,
        );
        if (persistedAssignment) {
          bulkAssignment = persistedAssignment;
          console.info(JSON.stringify({
            event: "mock_exam_grade_bulk_reused_persisted",
            attempt_id: attemptId,
            bulk_photo_count: inlinedBulkPhotos.length,
            assignment: Object.fromEntries(
              Object.entries(bulkAssignment).map(([k, v]) => [k, (v as number[]).length]),
            ),
          }));
        } else {
          // Fresh Pass 1 — no tutor manual assignments yet.
          const tasksMeta: BulkAssignmentTaskMeta[] = allKimNumbers.map((kim) => {
            const task = part2TasksByKim.get(kim);
            return {
              kim_number: kim,
              max_score: task?.max_score ?? 0,
              task_text_preview: task?.task_text ?? "",
            };
          });
          const assignMessages = buildBulkAssignmentPrompt(tasksMeta, inlinedBulkPhotos);
          // P1 (mock-exam-grading-v2): Pass-1 router может транзиентно упасть
          // (битый JSON модели). Полагаемся на ВНУТРЕННИЙ ретрай callLovableJson
          // (35с timeout + 1 retry) — внешний ретрай убран, иначе суммарный
          // Pass-1 мог превысить 120с stale-lock (review P1 #1). На сбой —
          // over-include fallback вместо «никому» (раньше: один сорванный вызов
          // → photo_missing на всю Часть 2, baseline 29/55). Q1-решение: раздаём
          // все фото только НЕ-tutor-locked КИМ (rule 45 — tutor_approved/
          // tutor_modified не перезаписываем); Pass 2 отсеет нерелевантные через
          // существующий photo_off_topic.
          try {
            const parsedAssign = await callLovableJson(assignMessages, "mock_exam_bulk_assign", { onUsage: gradeUsageLogger });
            bulkAssignment = sanitizeBulkAssignmentResult(
              parsedAssign,
              inlinedBulkPhotos.length,
              allKimNumbers,
            );
            console.info(JSON.stringify({
              event: "mock_exam_grade_bulk_assigned",
              attempt_id: attemptId,
              bulk_photo_count: inlinedBulkPhotos.length,
              assignment: Object.fromEntries(
                Object.entries(bulkAssignment).map(([k, v]) => [k, v.length]),
              ),
            }));
          } catch (err) {
            console.warn(JSON.stringify({
              event: "mock_exam_grade_bulk_assign_failed",
              attempt_id: attemptId,
              error: err instanceof Error ? err.message : String(err),
            }));
            // over-include fallback: все фото → каждой НЕ-tutor-locked КИМ.
            const allIdx = inlinedBulkPhotos.map((_, i) => i);
            const fallback: BulkAssignmentResult = { unassigned: [] };
            let overIncludedKims = 0;
            for (const kim of allKimNumbers) {
              const st = solutionsByKim.get(kim)?.status;
              const tutorLocked = st === "tutor_approved" || st === "tutor_modified";
              fallback[kim] = tutorLocked ? [] : allIdx.slice();
              if (!tutorLocked) overIncludedKims += 1;
            }
            bulkAssignment = fallback;
            console.warn(JSON.stringify({
              event: "mock_exam_grade_bulk_assign_over_include_fallback",
              attempt_id: attemptId,
              bulk_photo_count: inlinedBulkPhotos.length,
              over_included_kims: overIncludedKims,
            }));
          }
        }
      }
    } catch (err) {
      console.warn(JSON.stringify({
        event: "mock_exam_grade_bulk_pass1_exception",
        attempt_id: attemptId,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }

  // Phase 6 (2026-05-15) — AI Часть 1 OCR для blank mode. Запускается
  // параллельно с Часть 2 grading (Promise.all ниже). Idempotent: если
  // ai_part1_ocr_json уже есть → skip. Tutor можно re-trigger через
  // `/regrade-part2` endpoint (он clear'ит ocr_json перед regrade).
  //
  // TASK-OCR-3 (2026-05-21) — расширено: OCR теперь запускается на любом
  // фото Часть 1, а не только на официальном ФИПИ-бланке. Если ученик
  // загрузил `kind='blank'` (canonical ФИПИ-бланк) — используем grid-prompt
  // (`buildPart1BlankOCRPrompt`). Если только `kind='part1_fallback'`
  // (тетрадный лист / произвольный формат) — используем freeform prompt
  // (`buildPart1FreeformOCRPrompt`). Egor 2026-05-21: «у моего ученика
  // ответы на обычном тетрадном листе, AI должен их распознать».
  //
  // TASK-16: force_retry от tutor /retry-part1-ocr endpoint — override
  // skip-if-exists guard. Tutor может перезапустить OCR если first attempt
  // failed или дал плохой результат.
  const ocrPath: { ref: string; mode: "blank" | "freeform" } | null = (() => {
    if (attemptRow.blank_photo_url) {
      return { ref: attemptRow.blank_photo_url, mode: "blank" };
    }
    if (attemptRow.part1_blank_photo_url) {
      return { ref: attemptRow.part1_blank_photo_url, mode: "freeform" };
    }
    return null;
  })();
  const shouldRunPart1OCR = attemptRow.answer_method === "blank"
    && ocrPath !== null
    && (options?.forceRetryOCR === true || !attemptRow.ai_part1_ocr_json);
  const part1OCRPromise = shouldRunPart1OCR && ocrPath
    ? runPart1OCR(db, attemptId, ocrPath.ref, assignmentRow.variant_id ?? "", ocrPath.mode, ocrUsageLogger)
    : Promise.resolve(null);

  console.info(JSON.stringify({
    event: "mock_exam_grade_start",
    attempt_id: attemptId,
    triggered_by: auth.triggered_by,
    part2_task_count: allKimNumbers.length,
    mode: isBulkMode ? "bulk" : "per_kim",
    bulk_photo_count: isBulkMode ? bulkPhotoRefs.length : 0,
    part1_ocr_will_run: shouldRunPart1OCR,
    // TASK-OCR-3 (2026-05-21): track prompt_mode для diagnostics — позволяет
    // отделить blank-from-FIPI OCR от freeform-photo OCR в логах.
    part1_ocr_prompt_mode: shouldRunPart1OCR && ocrPath ? ocrPath.mode : null,
  }));

  const totalStart = Date.now();

  // Process all Часть 2 tasks in parallel. Phase 6: для bulk path передаём
  // pre-inlined assigned photos через gradePart2Task'у. Для legacy per-kim
  // path — старый flow (resolve solution.photo_url внутри).
  const outcomes = await Promise.all(
    allKimNumbers.map(async (kim) => {
      const task = part2TasksByKim.get(kim);
      if (!task) {
        // Should not happen because allKimNumbers is derived from variantTasks.
        return null;
      }
      const solution = solutionsByKim.get(kim) ?? { kim_number: kim, photo_url: null };
      try {
        // Phase 6 — bulk path: pre-extracted assigned photo data URLs.
        if (isBulkMode && bulkAssignment) {
          const assignedIndices = bulkAssignment[kim] ?? [];
          const assignedPhotos = assignedIndices
            .filter((idx) => idx >= 0 && idx < inlinedBulkPhotos.length)
            .map((idx) => inlinedBulkPhotos[idx]);
          return await gradePart2TaskBulk(
            task,
            attemptId,
            assignedPhotos,
            assignedIndices,
            gradeUsageLogger,
          );
        }
        // Legacy per-kim path (Egor's pilot attempts).
        return await gradePart2Task(db, task, solution, attemptId, gradeUsageLogger);
      } catch (err) {
        console.error("mock_exam_grade_unexpected_error", {
          attempt_id: attemptId,
          kim_number: kim,
          error: err instanceof Error ? err.message : String(err),
        });
        return {
          kim_number: kim,
          draft: buildFallbackDraft("gateway_error", {
            maxScore: task.max_score,
            kimNumber: kim,
          }),
          used_fallback: "gateway_error" as MockExamFallbackReason,
          latency_ms: 0,
        };
      }
    }),
  );

  const validOutcomes = outcomes.filter((o): o is GradeOutcome => o !== null);

  // Phase 6: await Часть 1 OCR result (runs параллельно с Часть 2 grading).
  // Errors не блокируют Часть 2 — runPart1OCR ловит и логгирует internal.
  const part1OCRResult = await part1OCRPromise;
  if (part1OCRResult !== null) {
    console.info(JSON.stringify({
      event: "mock_exam_grade_part1_ocr_done",
      attempt_id: attemptId,
      cells_recognized: Object.values(part1OCRResult.ocr).filter((c) => c.value !== null).length,
      part1_earned_total: part1OCRResult.totalEarned,
    }));
  }

  // Persist drafts. Phase 6 review-fix #2: write-time conditional update
  // против stale-snapshot race (tutor approve может случиться во время AI call).
  // Сначала пытаемся UPDATE с WHERE NOT IN tutor states — если 0 rows
  // affected, значит ИЛИ row нет, ИЛИ tutor уже approved между snapshot и
  // сейчас. В первом случае делаем INSERT с awaiting_review status. Во втором
  // делаем narrow UPDATE только `ai_draft_json` (status не трогаем).
  //
  // photo_url is owned by student submit handler — никогда не overwrite here.
  const upsertResults = await Promise.all(
    validOutcomes.map(async (outcome) => {
      const updatedAt = new Date().toISOString();
      // Attempt 1: full UPDATE (sets status='awaiting_review') guarded by
      // NOT IN tutor states. PostgREST не возвращает row count в стандартном
      // ответе без `prefer: count=exact`, поэтому используем .select() для
      // detection.
      const { data: fullUpdated, error: fullErr } = await db
        .from("mock_exam_attempt_part2_solutions")
        .update({
          ai_draft_json: outcome.draft,
          status: "awaiting_review",
          updated_at: updatedAt,
        })
        .eq("attempt_id", attemptId)
        .eq("kim_number", outcome.kim_number)
        .not("status", "in", "(tutor_approved,tutor_modified)")
        .select("kim_number");
      if (fullErr) {
        console.error("mock_exam_grade_full_update_failed", {
          attempt_id: attemptId,
          kim_number: outcome.kim_number,
          error: fullErr.message,
        });
        return { kim_number: outcome.kim_number, ok: false };
      }
      if (fullUpdated && fullUpdated.length > 0) {
        return { kim_number: outcome.kim_number, ok: true };
      }

      // 0 rows affected — либо row отсутствует, либо tutor уже approved
      // между snapshot и сейчас. Detect через прямой SELECT (cheap).
      const { data: existingRow } = await db
        .from("mock_exam_attempt_part2_solutions")
        .select("status")
        .eq("attempt_id", attemptId)
        .eq("kim_number", outcome.kim_number)
        .maybeSingle();

      if (!existingRow) {
        // Row missing → INSERT.
        const { error: insertErr } = await db
          .from("mock_exam_attempt_part2_solutions")
          .insert({
            attempt_id: attemptId,
            kim_number: outcome.kim_number,
            ai_draft_json: outcome.draft,
            status: "awaiting_review",
            updated_at: updatedAt,
          });
        if (insertErr) {
          console.error("mock_exam_grade_insert_failed", {
            attempt_id: attemptId,
            kim_number: outcome.kim_number,
            error: insertErr.message,
          });
          return { kim_number: outcome.kim_number, ok: false };
        }
        return { kim_number: outcome.kim_number, ok: true };
      }

      // Row exists и tutor-approved/modified → narrow UPDATE только draft,
      // status не трогаем (tutor preservation invariant).
      const { error: narrowErr } = await db
        .from("mock_exam_attempt_part2_solutions")
        .update({
          ai_draft_json: outcome.draft,
          updated_at: updatedAt,
        })
        .eq("attempt_id", attemptId)
        .eq("kim_number", outcome.kim_number);
      if (narrowErr) {
        console.error("mock_exam_grade_narrow_update_failed", {
          attempt_id: attemptId,
          kim_number: outcome.kim_number,
          error: narrowErr.message,
        });
        return { kim_number: outcome.kim_number, ok: false };
      }
      console.info(JSON.stringify({
        event: "mock_exam_grade_preserved_tutor_status",
        attempt_id: attemptId,
        kim_number: outcome.kim_number,
        existing_status: existingRow.status,
      }));
      return { kim_number: outcome.kim_number, ok: true };
    }),
  );

  const succeededUpserts = upsertResults.filter((r) => r.ok).length;
  const failedUpserts = upsertResults.length - succeededUpserts;

  // Transition attempt status: ai_checking → awaiting_review.
  // CAS-guarded so we don't clobber a concurrent tutor approve flow.
  const { error: finalStateErr } = await db
    .from("mock_exam_attempts")
    .update({ status: "awaiting_review" })
    .eq("id", attemptId)
    .in("status", ["ai_checking", "submitted"]);
  if (finalStateErr) {
    console.warn("mock_exam_grade_final_state_failed", {
      attempt_id: attemptId,
      error: finalStateErr.message,
    });
  }

  // Best-effort tutor notification (does not block response when push-related
  // env is missing).
  let notifyResult: { delivered: boolean; channel: string | null } = {
    delivered: false,
    channel: null,
  };
  try {
    notifyResult = await notifyTutorReadyForReview(
      db,
      assignmentRow.tutor_id,
      attemptId,
      assignmentRow.title,
    );
  } catch (err) {
    console.warn("mock_exam_grade_notify_error", {
      attempt_id: attemptId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const totalLatency = Date.now() - totalStart;

  console.info(JSON.stringify({
    event: "mock_exam_grade_done",
    attempt_id: attemptId,
    triggered_by: auth.triggered_by,
    part2_task_count: validOutcomes.length,
    upsert_succeeded: succeededUpserts,
    upsert_failed: failedUpserts,
    fallback_count: validOutcomes.filter((o) => o.used_fallback !== null).length,
    total_latency_ms: totalLatency,
    notify_delivered: notifyResult.delivered,
    notify_channel: notifyResult.channel,
  }));

  // Per anti-leak invariant (see file header): NEVER return ai_draft_json /
  // suggested_score in this response. Caller (student submit handler) should
  // be fire-and-forget and shouldn't relay payload to student. Only return
  // counters — sufficient for tutor UI re-poll and for diagnostics.
  return jsonOk(cors, {
    attempt_id: attemptId,
    status: "awaiting_review",
    part2_task_count: validOutcomes.length,
    drafts_persisted: succeededUpserts,
    drafts_failed: failedUpserts,
    fallback_count: validOutcomes.filter((o) => o.used_fallback !== null).length,
    total_latency_ms: totalLatency,
    tutor_notified: notifyResult.delivered,
  });
}

// ─── Server ─────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  const cors = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: cors });
  }
  if (req.method !== "POST") {
    return jsonError(cors, 405, "METHOD_NOT_ALLOWED", "Use POST");
  }

  const startTime = Date.now();

  try {
    const auth = await authenticate(req, cors);
    if (auth instanceof Response) return auth;

    const body = (await parseJsonBody(req)) as Record<string, unknown> | null;
    if (!body) {
      return jsonError(cors, 400, "INVALID_BODY", "Request body must be JSON");
    }

    // Accept either { attempt_id } or path-style /grade/:attempt_id (future).
    const attemptId =
      typeof body.attempt_id === "string" ? body.attempt_id : null;
    if (!attemptId) {
      return jsonError(cors, 400, "VALIDATION", "attempt_id is required");
    }

    // TASK-16 (2026-05-15): force_retry flag — tutor запускает OCR заново
    // через `/retry-part1-ocr` endpoint (mock-exam-tutor-api). Сбрасывает
    // skip-if-exists guard в runPart1OCR. Только для service-role callers.
    const forceRetryOCR =
      body.force_retry_ocr === true && auth.triggered_by === "service_role";

    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    return await handleGrade(db, auth, attemptId, cors, { forceRetryOCR });
  } catch (err) {
    const elapsed = Date.now() - startTime;
    console.error("mock_exam_grade_request_error", {
      error: err instanceof Error ? err.message : String(err),
      elapsed_ms: elapsed,
    });
    return jsonError(cors, 500, "INTERNAL_ERROR", "Internal server error");
  }
});
