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
  buildMockExamPart2Prompt,
  buildFallbackDraft,
  sanitizeMockExamPart2Draft,
  type LovableMessage,
  type MockExamFallbackReason,
  type MockExamPart2Draft,
} from "../_shared/mock-exam-prompts.ts";
import {
  sendPushNotification,
  type PushPayload,
  type PushSubscriptionData,
} from "../_shared/push-sender.ts";

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
const LOVABLE_REQUEST_TIMEOUT_MS = 35_000;
const LOVABLE_MAX_RETRIES = 1;

const SIGNED_URL_TTL_SEC = 1800;
const MAX_PROMPT_IMAGE_BYTES = 5 * 1024 * 1024;
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
): Promise<Record<string, unknown>> {
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

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
          model: LOVABLE_MODEL,
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
      const messageContent = payload?.choices?.[0]?.message?.content;
      const rawContent = extractMessageContent(messageContent);
      if (!rawContent) throw new Error("Model response is empty");
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
    // pass из БД. См. CLAUDE.md §20 «Mock-exams subject-rubric integration».
    subject: "physics",
    exam_type: "ege",
  });

  try {
    const parsed = await callLovableJson(messages, "mock_exam_grade");
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

// Parses a photo_url field that may be:
//  - null/"" → []
//  - "storage://..." (single) → [ref]
//  - JSON array of refs → string[]
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
): Promise<Response> {
  if (!isUUID(attemptId)) {
    return jsonError(cors, 400, "INVALID_ID", "Invalid attempt_id");
  }

  // Load attempt + assignment.
  const { data: attempt, error: attemptErr } = await db
    .from("mock_exam_attempts")
    .select("id, assignment_id, status, student_id, anonymous_id")
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

  // Mark as ai_checking (best-effort idempotency — if already ai_checking,
  // this is a no-op write; awaiting_review status means re-run is allowed
  // without resetting tutor approvals already in place).
  if (attemptRow.status === "submitted") {
    const { error: stateErr } = await db
      .from("mock_exam_attempts")
      .update({ status: "ai_checking" })
      .eq("id", attemptId)
      .eq("status", "submitted"); // CAS guard
    if (stateErr) {
      console.warn("mock_exam_grade_state_transition_failed", {
        attempt_id: attemptId,
        error: stateErr.message,
      });
      // Not fatal — proceed; another runner may have flipped it concurrently.
    }
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
  const { data: solutions, error: solutionsErr } = await db
    .from("mock_exam_attempt_part2_solutions")
    .select("kim_number, photo_url, status")
    .eq("attempt_id", attemptId);
  if (solutionsErr) {
    return jsonError(cors, 500, "DB_ERROR", "Failed to load part2 solutions");
  }
  const solutionsByKim = new Map<number, SolutionRow & { status?: string }>();
  for (const s of (solutions ?? []) as Array<SolutionRow & { status?: string }>) {
    solutionsByKim.set(s.kim_number, s);
  }

  // For Часть 2 tasks where student has no row yet (бланк-режим with global
  // blank_photo_url), we still emit a placeholder row so tutor sees one card
  // per kim_number. photo_url stays null → fallback "no_photo".
  const allKimNumbers = Array.from(part2TasksByKim.keys()).sort((a, b) => a - b);

  console.info(JSON.stringify({
    event: "mock_exam_grade_start",
    attempt_id: attemptId,
    triggered_by: auth.triggered_by,
    part2_task_count: allKimNumbers.length,
  }));

  const totalStart = Date.now();

  // Process all Часть 2 tasks in parallel via allSettled — single failure
  // doesn't bring down the batch.
  const outcomes = await Promise.all(
    allKimNumbers.map(async (kim) => {
      const task = part2TasksByKim.get(kim);
      if (!task) {
        // Should not happen because allKimNumbers is derived from variantTasks.
        return null;
      }
      const solution = solutionsByKim.get(kim) ?? { kim_number: kim, photo_url: null };
      try {
        return await gradePart2Task(db, task, solution, attemptId);
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

  // Persist drafts. Upsert keeps tutor_score / tutor_comment intact when
  // re-running on awaiting_review (we never overwrite tutor-edited rows).
  // Status logic: if existing status is tutor_approved or tutor_modified,
  // leave it alone — write only ai_draft_json.
  const upsertResults = await Promise.all(
    validOutcomes.map(async (outcome) => {
      const existing = solutionsByKim.get(outcome.kim_number);
      const preserveTutorStatus =
        existing?.status === "tutor_approved" || existing?.status === "tutor_modified";
      const updatePayload: Record<string, unknown> = {
        attempt_id: attemptId,
        kim_number: outcome.kim_number,
        ai_draft_json: outcome.draft,
        updated_at: new Date().toISOString(),
      };
      if (!preserveTutorStatus) {
        updatePayload.status = "awaiting_review";
      }
      // photo_url is owned by student submit handler — never overwrite from here.
      const { error } = await db
        .from("mock_exam_attempt_part2_solutions")
        .upsert(updatePayload, { onConflict: "attempt_id,kim_number" });
      if (error) {
        console.error("mock_exam_grade_upsert_failed", {
          attempt_id: attemptId,
          kim_number: outcome.kim_number,
          error: error.message,
        });
        return { kim_number: outcome.kim_number, ok: false };
      }
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

    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    return await handleGrade(db, auth, attemptId, cors);
  } catch (err) {
    const elapsed = Date.now() - startTime;
    console.error("mock_exam_grade_request_error", {
      error: err instanceof Error ? err.message : String(err),
      elapsed_ms: elapsed,
    });
    return jsonError(cors, 500, "INTERNAL_ERROR", "Internal server error");
  }
});
