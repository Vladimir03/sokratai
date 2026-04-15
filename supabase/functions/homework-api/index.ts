import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  computeAvailableScore,
  evaluateStudentAnswer,
  generateHint,
} from "./guided_ai.ts";
import { sendPushNotification, type PushSubscriptionData, type PushPayload } from "../_shared/push-sender.ts";
import {
  sendHomeworkNotificationEmail,
  sendHomeworkTutorMessageEmail,
} from "../_shared/email-sender.ts";
import {
  MAX_RUBRIC_IMAGES,
  MAX_TASK_IMAGES,
  parseAttachmentUrls,
} from "../_shared/attachment-refs.ts";

// ─── Constants ───────────────────────────────────────────────────────────────

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:support@sokratai.ru";

const VALID_SUBJECTS_CREATE = [
  "maths", "physics", "informatics",
  "russian", "literature", "history", "social",
  "english", "french", "chemistry", "biology",
  "geography", "spanish", "other",
] as const;
const VALID_SUBJECTS_UPDATE = [
  ...VALID_SUBJECTS_CREATE,
  "math", "cs", "rus", "algebra", "geometry",
] as const;
const VALID_STATUSES = ["draft", "active", "closed"] as const;
const VALID_STATUS_FILTERS = ["draft", "active", "closed", "all"] as const;
const VALID_CHECK_FORMATS = ["short_answer", "detailed_solution"] as const;
const VALID_EXAM_TYPES = ["ege", "oge"] as const;
type NotifyFailureReason =
  | "missing_telegram_link" | "telegram_send_failed" | "telegram_send_error"
  | "push_expired" | "push_send_failed"
  | "email_send_failed"
  | "no_channels_available" | "all_channels_failed";

const FALLBACK_ORIGINS = [
  "https://sokratai.ru",
  "https://sokratai.lovable.app",
  "http://localhost:8080",
  "http://localhost:5173",
];

// ─── CORS ────────────────────────────────────────────────────────────────────

function getAllowedOrigins(): string[] {
  const envOrigins = Deno.env.get("HOMEWORK_API_ALLOWED_ORIGINS");
  if (envOrigins) {
    return envOrigins.split(",").map((o) => o.trim()).filter(Boolean);
  }
  return FALLBACK_ORIGINS;
}

function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const allowed = getAllowedOrigins();
  // Allow any *.lovableproject.com and *.lovable.app preview domains
  const isLovableOrigin =
    origin.endsWith(".lovableproject.com") ||
    origin.endsWith(".lovable.app");
  const matchedOrigin = allowed.includes(origin) || isLovableOrigin
    ? origin
    : allowed[0];
  return {
    "Access-Control-Allow-Origin": matchedOrigin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

// ─── Helpers: Response ───────────────────────────────────────────────────────

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

// ─── Helpers: Validation ─────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_THREAD_ATTACHMENTS = 3;
const THREAD_IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "heic", "heif", "gif", "bmp"]);
const THREAD_ATTACHMENT_EXTENSIONS = new Set([...THREAD_IMAGE_EXTENSIONS, "pdf"]);
const THREAD_ATTACHMENT_BUCKETS = new Set(["homework-submissions", "homework-images"]);
const MAX_VOICE_BYTES = 10 * 1024 * 1024;
const VOICE_TRANSCRIPTION_MODEL = "whisper-large-v3";
const ALLOWED_VOICE_MIME_TYPES = new Set([
  "audio/webm",
  "audio/mp4",
  "audio/ogg",
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
]);

function isUUID(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isPositiveInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0;
}

function isNonNegativeInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

function isBoolean(v: unknown): v is boolean {
  return typeof v === "boolean";
}

function isMissingColumnError(message: string, column: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes(column.toLowerCase()) && (
    lower.includes("schema cache") ||
    (lower.includes("column") && lower.includes("does not exist"))
  );
}

function validateAttachmentRefLimit(
  cors: Record<string, string>,
  value: unknown,
  maxCount: number,
  fieldPath: string,
): Response | null {
  if (value === undefined || value === null || !isString(value)) return null;
  const refs = parseAttachmentUrls(value);
  if (refs.length > maxCount) {
    return jsonError(
      cors,
      400,
      "VALIDATION",
      `${fieldPath} exceeds maximum of ${maxCount} images`,
    );
  }
  return null;
}

function hasUnsafeObjectPath(path: string): boolean {
  return path
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .some((segment) => (
      segment === ".." ||
      segment.includes("\\") ||
      segment.includes("\0")
    ));
}

function normalizeThreadAttachmentRefs(refs: string[]): string[] {
  const unique = new Set<string>();
  for (const ref of refs) {
    const trimmed = ref.trim();
    if (!trimmed) continue;
    unique.add(trimmed);
  }
  return Array.from(unique);
}

function parseStoredThreadAttachmentRefs(value: unknown): string[] {
  if (typeof value !== "string") return [];
  const trimmed = value.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (!Array.isArray(parsed)) return [];
      return normalizeThreadAttachmentRefs(
        parsed.filter((item): item is string => typeof item === "string"),
      );
    } catch {
      return [];
    }
  }

  return [trimmed];
}

function serializeThreadAttachmentRefs(refs: string[]): string | null {
  const normalized = normalizeThreadAttachmentRefs(refs);
  if (normalized.length === 0) return null;
  if (normalized.length === 1) return normalized[0];
  return JSON.stringify(normalized);
}

function getThreadAttachmentExtension(value: string): string {
  const trimmed = value.trim();
  const rawPath = trimmed.startsWith("storage://")
    ? trimmed.slice("storage://".length).split("/").slice(1).join("/")
    : (() => {
      try {
        return new URL(trimmed).pathname;
      } catch {
        return trimmed;
      }
    })();
  const cleanPath = rawPath.split("?")[0].split("#")[0];
  const lastSegment = cleanPath.split("/").filter(Boolean).pop() ?? "";
  const dotIdx = lastSegment.lastIndexOf(".");
  return dotIdx >= 0 ? lastSegment.slice(dotIdx + 1).toLowerCase() : "";
}

function isImageThreadAttachmentRef(value: string): boolean {
  return THREAD_IMAGE_EXTENSIONS.has(getThreadAttachmentExtension(value));
}

async function parseJsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

function isAcceptedVoiceMimeType(mimeType: string): boolean {
  if (!mimeType) return false;

  const normalized = mimeType.toLowerCase().split(";")[0].trim();
  return ALLOWED_VOICE_MIME_TYPES.has(normalized);
}

function getVoiceFilename(mimeType: string, providedName?: string): string {
  if (providedName && providedName.trim()) {
    return providedName;
  }

  const normalized = mimeType.toLowerCase().split(";")[0].trim();
  if (normalized.includes("ogg")) return "voice.ogg";
  if (normalized.includes("mpeg")) return "voice.mp3";
  if (normalized.includes("mp4")) return "voice.m4a";
  if (normalized.includes("wav")) return "voice.wav";
  return "voice.webm";
}

// ─── Helpers: Auth & Ownership ───────────────────────────────────────────────

interface AuthResult {
  userId: string;
}

async function authenticateUser(
  req: Request,
  cors: Record<string, string>,
): Promise<AuthResult | Response> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonError(cors, 401, "UNAUTHORIZED", "Missing Authorization header");
  }
  // Use GoTrue API directly to validate token — avoids SDK session issues
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      Authorization: authHeader,
      apikey: SUPABASE_ANON_KEY,
    },
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    console.error("homework_api_auth_failed", {
      status: resp.status,
      body: body.slice(0, 200),
    });
    return jsonError(cors, 401, "UNAUTHORIZED", "Invalid or expired token");
  }
  const user = await resp.json();
  if (!user?.id) {
    return jsonError(cors, 401, "UNAUTHORIZED", "Invalid or expired token");
  }
  return { userId: user.id };
}

async function getTutorOrThrow(
  db: SupabaseClient,
  userId: string,
  cors: Record<string, string>,
): Promise<{ id: string } | Response> {
  const { data, error } = await db
    .from("tutors")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) {
    return jsonError(cors, 403, "NOT_TUTOR", "Tutor profile not found");
  }
  return { id: data.id };
}

async function getOwnedAssignmentOrThrow(
  db: SupabaseClient,
  assignmentId: string,
  tutorUserId: string,
  cors: Record<string, string>,
): Promise<Record<string, unknown> | Response> {
  if (!isUUID(assignmentId)) {
    return jsonError(cors, 400, "INVALID_ID", "Invalid assignment ID format");
  }
  const { data, error } = await db
    .from("homework_tutor_assignments")
    .select("*")
    .eq("id", assignmentId)
    .maybeSingle();
  if (error || !data) {
    return jsonError(cors, 404, "NOT_FOUND", "Assignment not found");
  }
  if (data.tutor_id !== tutorUserId) {
    return jsonError(cors, 403, "FORBIDDEN", "Assignment does not belong to you");
  }
  return data as Record<string, unknown>;
}

// ─── Routing ─────────────────────────────────────────────────────────────────

interface RouteMatch {
  segments: string[];
  method: string;
  searchParams: URLSearchParams;
}

function parseRoute(req: Request): RouteMatch {
  const url = new URL(req.url);
  const pathname = url.pathname;
  const idx = pathname.indexOf("homework-api");
  const rest = idx >= 0 ? pathname.slice(idx + "homework-api".length) : "";
  const segments = rest.split("/").filter(Boolean);
  return { segments, method: req.method, searchParams: url.searchParams };
}

// ─── Endpoint: POST /assignments ─────────────────────────────────────────────

async function handleCreateAssignment(
  db: SupabaseClient,
  tutorUserId: string,
  body: unknown,
  cors: Record<string, string>,
): Promise<Response> {
  if (!body || typeof body !== "object") {
    return jsonError(cors, 400, "INVALID_BODY", "Request body must be a JSON object");
  }
  const b = body as Record<string, unknown>;

  if (!isNonEmptyString(b.title)) {
    return jsonError(cors, 400, "VALIDATION", "title is required (non-empty string)");
  }
  if (!isNonEmptyString(b.subject) || !(VALID_SUBJECTS_CREATE as readonly string[]).includes(b.subject)) {
    return jsonError(cors, 400, "VALIDATION", `subject must be one of: ${VALID_SUBJECTS_CREATE.join(", ")}`);
  }
  if (b.topic !== undefined && b.topic !== null && !isString(b.topic)) {
    return jsonError(cors, 400, "VALIDATION", "topic must be a string or null");
  }
  if (b.description !== undefined && b.description !== null && !isString(b.description)) {
    return jsonError(cors, 400, "VALIDATION", "description must be a string or null");
  }
  if (b.deadline !== undefined && b.deadline !== null && !isString(b.deadline)) {
    return jsonError(cors, 400, "VALIDATION", "deadline must be an ISO date string or null");
  }
  if (b.exam_type !== undefined && b.exam_type !== null && !(VALID_EXAM_TYPES as readonly string[]).includes(b.exam_type as string)) {
    return jsonError(cors, 400, "VALIDATION", `exam_type must be one of: ${VALID_EXAM_TYPES.join(", ")}`);
  }
  if (!Array.isArray(b.tasks) || b.tasks.length === 0) {
    return jsonError(cors, 400, "VALIDATION", "tasks must be a non-empty array");
  }
  for (let i = 0; i < b.tasks.length; i++) {
    const t = b.tasks[i];
    if (!t || typeof t !== "object") {
      return jsonError(cors, 400, "VALIDATION", `tasks[${i}] must be an object`);
    }
    if (!isNonEmptyString(t.task_text) && !isNonEmptyString(t.task_image_url)) {
      return jsonError(cors, 400, "VALIDATION", `tasks[${i}].task_text is required (or provide task_image_url)`);
    }
    if (t.max_score !== undefined && t.max_score !== null && !isPositiveInt(t.max_score)) {
      return jsonError(cors, 400, "VALIDATION", `tasks[${i}].max_score must be a positive integer`);
    }
    if (t.order_num !== undefined && t.order_num !== null && !isPositiveInt(t.order_num)) {
      return jsonError(cors, 400, "VALIDATION", `tasks[${i}].order_num must be a positive integer`);
    }
    if (t.check_format !== undefined && t.check_format !== null && !(VALID_CHECK_FORMATS as readonly string[]).includes(t.check_format)) {
      return jsonError(cors, 400, "VALIDATION", `tasks[${i}].check_format must be one of: ${VALID_CHECK_FORMATS.join(", ")}`);
    }
    const taskImageLimitError = validateAttachmentRefLimit(
      cors,
      t.task_image_url,
      MAX_TASK_IMAGES,
      `tasks[${i}].task_image_url`,
    );
    if (taskImageLimitError) return taskImageLimitError;
    const rubricImageLimitError = validateAttachmentRefLimit(
      cors,
      t.rubric_image_urls,
      MAX_RUBRIC_IMAGES,
      `tasks[${i}].rubric_image_urls`,
    );
    if (rubricImageLimitError) return rubricImageLimitError;
  }

  const { data: assignment, error: assignErr } = await db
    .from("homework_tutor_assignments")
    .insert({
      tutor_id: tutorUserId,
      title: (b.title as string).trim(),
      subject: b.subject,
      topic: isNonEmptyString(b.topic) ? (b.topic as string).trim() : null,
      description: isNonEmptyString(b.description) ? (b.description as string).trim() : null,
      deadline: isNonEmptyString(b.deadline) ? b.deadline : null,
      status: "draft",
      exam_type: (VALID_EXAM_TYPES as readonly string[]).includes(b.exam_type as string) ? b.exam_type : "ege",
      disable_ai_bootstrap: b.disable_ai_bootstrap === true,
    })
    .select("id")
    .single();

  if (assignErr || !assignment) {
    console.error("homework_api_request_error", { route: "POST /assignments", error: assignErr?.message });
    return jsonError(cors, 500, "DB_ERROR", "Failed to create assignment");
  }

  const taskRows = (b.tasks as Record<string, unknown>[]).map((t, i) => ({
    assignment_id: assignment.id,
    order_num: isPositiveInt(t.order_num) ? t.order_num : i + 1,
    task_text: isNonEmptyString(t.task_text) ? (t.task_text as string).trim() : "[Задача на фото]",
    task_image_url: isNonEmptyString(t.task_image_url) ? (t.task_image_url as string).trim() : null,
    correct_answer: isNonEmptyString(t.correct_answer) ? (t.correct_answer as string).trim() : null,
    max_score: isPositiveInt(t.max_score) ? t.max_score : 1,
    rubric_text: isNonEmptyString(t.rubric_text) ? (t.rubric_text as string).trim() : null,
    rubric_image_urls: isNonEmptyString(t.rubric_image_urls) ? (t.rubric_image_urls as string).trim() : null,
    check_format: (VALID_CHECK_FORMATS as readonly string[]).includes(t.check_format as string) ? t.check_format : "short_answer",
  }));

  const { error: tasksErr } = await db
    .from("homework_tutor_tasks")
    .insert(taskRows);

  if (tasksErr) {
    console.error("homework_api_request_error", { route: "POST /assignments", error: tasksErr.message });
    await db.from("homework_tutor_assignments").delete().eq("id", assignment.id);
    return jsonError(cors, 500, "DB_ERROR", "Failed to create tasks");
  }

  // Feature 1: save_as_template
  if (b.save_as_template === true) {
    const templateTasksJson = taskRows.map((t) => ({
      task_text: t.task_text,
      task_image_url: t.task_image_url,
      correct_answer: t.correct_answer,
      max_score: t.max_score,
      rubric_text: t.rubric_text,
    }));
    const { error: templateErr } = await db
      .from("homework_tutor_templates")
      .insert({
        tutor_id: tutorUserId,
        title: (b.title as string).trim(),
        subject: b.subject,
        topic: isNonEmptyString(b.topic) ? (b.topic as string).trim() : null,
        tags: [],
        tasks_json: templateTasksJson,
      });
    if (templateErr) {
      console.warn("homework_api_template_save_failed", {
        assignment_id: assignment.id,
        error: templateErr.message,
      });
    }
  }

  console.log("homework_api_request_success", {
    route: "POST /assignments",
    tutor_id: tutorUserId,
    assignment_id: assignment.id,
  });
  return jsonOk(cors, { assignment_id: assignment.id }, 201);
}

// ─── Shared score helpers (used by handleListAssignments + handleGetResults) ──

interface TaskStateScoreFields {
  thread_id: string;
  task_id: string;
  earned_score: number | null;
  status: string | null;
  ai_score: number | null;
  tutor_score_override: number | null;
  hint_count: number | null;
  attempts: number | null;
}

/**
 * Compute the final score for a single task state with the priority chain
 * tutor_score_override → earned_score → ai_score → status fallback. Used by
 * both per-student and per-task aggregations so the shapes stay consistent.
 *
 * earned_score takes priority over ai_score because it reflects hint/wrong-
 * answer degradation — the same value the student sees on their results
 * screen. ai_score is the AI's raw evaluation BEFORE degradation and is
 * kept as a supplementary field for the tutor's "AI: X/Y" display in the
 * edit-score dialog.
 */
function computeFinalScore(ts: TaskStateScoreFields, maxScore: number): number {
  if (ts.tutor_score_override != null) return Number(ts.tutor_score_override);
  if (ts.earned_score != null) return Number(ts.earned_score);
  if (ts.ai_score != null) return Number(ts.ai_score);
  if (ts.status === "completed") return maxScore;
  return 0;
}

/**
 * Wall-clock minutes between the first and last `homework_tutor_thread_messages.created_at`
 * for a student. `Math.max(1, …)` ensures any non-empty thread reports ≥1 min.
 * Returns `null` when there is no thread or no messages (frontend renders «—»).
 * See: docs/delivery/features/homework-student-totals/spec.md AC-9.
 */
function computeTotalMinutes(times: { first: string; last: string } | undefined): number | null {
  if (!times) return null;
  const diffMs = new Date(times.last).getTime() - new Date(times.first).getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return null;
  return Math.max(1, Math.round(diffMs / 60000));
}

// ─── Endpoint: GET /assignments ──────────────────────────────────────────────

async function handleListAssignments(
  db: SupabaseClient,
  tutorUserId: string,
  searchParams: URLSearchParams,
  cors: Record<string, string>,
): Promise<Response> {
  const statusFilter = searchParams.get("status") ?? "all";
  if (!(VALID_STATUS_FILTERS as readonly string[]).includes(statusFilter)) {
    return jsonError(cors, 400, "VALIDATION", `status must be one of: ${VALID_STATUS_FILTERS.join(", ")}`);
  }

  let query = db
    .from("homework_tutor_assignments")
    .select("id, title, subject, topic, deadline, status, created_at")
    .eq("tutor_id", tutorUserId)
    .order("created_at", { ascending: false });

  if (statusFilter !== "all") {
    query = query.eq("status", statusFilter);
  }

  const { data: assignments, error } = await query;
  if (error) {
    console.error("homework_api_request_error", { route: "GET /assignments", error: error.message });
    return jsonError(cors, 500, "DB_ERROR", "Failed to fetch assignments");
  }

  if (!assignments || assignments.length === 0) {
    return jsonOk(cors, []);
  }

  const assignmentIds = assignments.map((a) => a.id);

  const { data: assignedCounts } = await db
    .from("homework_tutor_student_assignments")
    .select("id, assignment_id, delivery_status")
    .in("assignment_id", assignmentIds);

  const assignedMap: Record<string, number> = {};
  const deliveredMap: Record<string, number> = {};
  const notConnectedMap: Record<string, number> = {};
  const saIdToAssignment: Record<string, string> = {};
  const allSaIds: string[] = [];
  for (const r of assignedCounts ?? []) {
    assignedMap[r.assignment_id] = (assignedMap[r.assignment_id] ?? 0) + 1;
    saIdToAssignment[r.id as string] = r.assignment_id as string;
    allSaIds.push(r.id as string);
    const ds = r.delivery_status as string;
    if (ds === "delivered" || ds === "delivered_push" || ds === "delivered_telegram" || ds === "delivered_email") {
      deliveredMap[r.assignment_id] = (deliveredMap[r.assignment_id] ?? 0) + 1;
    } else if (ds === "failed_not_connected" || ds === "failed_no_channel") {
      notConnectedMap[r.assignment_id] = (notConnectedMap[r.assignment_id] ?? 0) + 1;
    }
  }

  const submittedMap: Record<string, number> = {};
  const scoreMap: Record<string, { sum: number; count: number }> = {};
  let totalMaxByAssignment: Record<string, number> = {};

  // Guided chat: count completed threads as "submissions" for stats
  if (allSaIds.length > 0) {
    // Get completed threads
    const { data: completedThreads } = await db
      .from("homework_tutor_threads")
      .select("id, student_assignment_id")
      .in("student_assignment_id", allSaIds)
      .eq("status", "completed");

    if (completedThreads && completedThreads.length > 0) {
      const threadIds = completedThreads.map((t) => t.id);

      // Get ALL task states for completed threads (no status filter — active tasks
      // contribute 0/max to the average, matching handleGetResults behaviour).
      const { data: taskStates } = await db
        .from("homework_tutor_task_states")
        .select("thread_id, task_id, earned_score, ai_score, tutor_score_override, status")
        .in("thread_id", threadIds);

      // Fetch max_score from tasks for guided assignments
      const { data: guidedTasks } = await db
        .from("homework_tutor_tasks")
        .select("id, max_score, assignment_id")
        .in("assignment_id", assignmentIds);

      const guidedTaskMaxScore: Record<string, number> = {};
      totalMaxByAssignment = {};
      for (const t of guidedTasks ?? []) {
        guidedTaskMaxScore[t.id] = t.max_score ?? 1;
        totalMaxByAssignment[t.assignment_id] =
          (totalMaxByAssignment[t.assignment_id] ?? 0) + (t.max_score ?? 1);
      }

      // Aggregate scores per thread using the same computeFinalScore chain as
      // handleGetResults so both surfaces show the same value.
      const threadScores: Record<string, { earned: number; maxTotal: number }> = {};
      for (const ts of taskStates ?? []) {
        const maxScore = guidedTaskMaxScore[ts.task_id] ?? 1;
        if (!threadScores[ts.thread_id]) {
          threadScores[ts.thread_id] = { earned: 0, maxTotal: 0 };
        }
        threadScores[ts.thread_id].earned += computeFinalScore(
          ts as TaskStateScoreFields,
          maxScore,
        );
        threadScores[ts.thread_id].maxTotal += maxScore;
      }

      for (const thread of completedThreads) {
        const aId = saIdToAssignment[thread.student_assignment_id];
        if (!aId) continue;

        submittedMap[aId] = (submittedMap[aId] ?? 0) + 1;

        const scores = threadScores[thread.id];
        if (scores && scores.maxTotal > 0) {
          if (!scoreMap[aId]) {
            scoreMap[aId] = { sum: 0, count: 0 };
          }
          // Accumulate absolute score (not %) — divided at the end to get avg.
          scoreMap[aId].sum += scores.earned;
          scoreMap[aId].count += 1;
        }
      }
    }
  }

  const result = assignments.map((a) => ({
    id: a.id,
    title: a.title,
    subject: a.subject,
    topic: a.topic,
    deadline: a.deadline,
    status: a.status,
    created_at: a.created_at,
    assigned_count: assignedMap[a.id] ?? 0,
    submitted_count: submittedMap[a.id] ?? 0,
    delivered_count: deliveredMap[a.id] ?? 0,
    not_connected_count: notConnectedMap[a.id] ?? 0,
    // Absolute average score (e.g. 3.2 out of 5). Use max_score_total for display.
    avg_score: scoreMap[a.id]?.count
      ? Math.round((scoreMap[a.id].sum / scoreMap[a.id].count) * 100) / 100
      : null,
    max_score_total: totalMaxByAssignment[a.id] ?? null,
  }));

  console.log("homework_api_request_success", {
    route: "GET /assignments",
    tutor_id: tutorUserId,
    count: result.length,
  });
  return jsonOk(cors, result);
}

// ─── Endpoint: GET /assignments/:id ──────────────────────────────────────────

async function handleGetAssignment(
  db: SupabaseClient,
  tutorUserId: string,
  assignmentId: string,
  cors: Record<string, string>,
): Promise<Response> {
  const assignmentOrErr = await getOwnedAssignmentOrThrow(db, assignmentId, tutorUserId, cors);
  if (assignmentOrErr instanceof Response) return assignmentOrErr;
  const assignment = assignmentOrErr;

  const { data: tasks } = await db
    .from("homework_tutor_tasks")
    .select("id, order_num, task_text, task_image_url, correct_answer, max_score, rubric_text, rubric_image_urls, check_format")
    .eq("assignment_id", assignmentId)
    .order("order_num", { ascending: true });

  const { data: studentAssignments } = await db
    .from("homework_tutor_student_assignments")
    .select("id, student_id, notified, notified_at, delivery_status, delivery_error_code")
    .eq("assignment_id", assignmentId);

  let assignedStudents: unknown[] = [];
  if (studentAssignments && studentAssignments.length > 0) {
    const studentIds = studentAssignments.map((sa) => sa.student_id);
    const { data: profiles } = await db
      .from("profiles")
      .select("id, username, telegram_user_id")
      .in("id", studentIds);

    const profileMap: Record<string, string | null> = {};
    const telegramFromProfile: Record<string, boolean> = {};
    for (const p of profiles ?? []) {
      profileMap[p.id] = p.username;
      if (p.telegram_user_id != null) telegramFromProfile[p.id] = true;
    }

    // Resolve has_telegram_link via profiles.telegram_user_id OR
    // telegram_sessions.user_id (used by web Telegram login flow).
    const { data: tgSessions } = await db
      .from("telegram_sessions")
      .select("user_id, telegram_user_id")
      .in("user_id", studentIds);

    const telegramFromSessions: Record<string, boolean> = {};
    for (const s of tgSessions ?? []) {
      if (s.telegram_user_id != null) {
        telegramFromSessions[s.user_id as string] = true;
      }
    }

    // Resolve has_email via auth.users.email (skip placeholder temp emails so
    // "Напомнить на email" doesn't offer a dead channel for Telegram-only users).
    const emailByUser: Record<string, boolean> = {};
    for (const uid of studentIds) {
      try {
        const { data: userRes } = await db.auth.admin.getUserById(uid);
        const email = userRes?.user?.email;
        if (email && !email.endsWith("@temp.sokratai.ru")) {
          emailByUser[uid] = true;
        }
      } catch {
        // treat lookup failure as "no email" — channel will just be unavailable
      }
    }

    assignedStudents = studentAssignments.map((sa) => ({
      student_id: sa.student_id,
      name: profileMap[sa.student_id] ?? null,
      notified: sa.notified,
      notified_at: sa.notified_at,
      delivery_status: sa.delivery_status,
      delivery_error_code: sa.delivery_error_code,
      has_telegram_link:
        Boolean(telegramFromProfile[sa.student_id]) ||
        Boolean(telegramFromSessions[sa.student_id]),
      has_email: Boolean(emailByUser[sa.student_id]),
    }));
  }

  const { data: materials } = await db
    .from("homework_tutor_materials")
    .select("id, type, storage_ref, url, title, created_at")
    .eq("assignment_id", assignmentId)
    .order("created_at", { ascending: true });

  const statusCounts: Record<string, number> = {};
  let scoreSum = 0;
  let scoreCount = 0;
  let guidedCompletedCount = 0;
  // `has_interactions` mirrors the destructive-change gate in PUT /assignments/:id:
  // any user message across all threads counts as "student has started solving".
  // The tutor editor reads this to lock add/remove task actions.
  let hasInteractions = false;

  // Guided chat: add completed thread data to submissions summary
  if (studentAssignments && studentAssignments.length > 0) {
    const saIds = studentAssignments.map((sa) => sa.id);

    const { data: allThreads } = await db
      .from("homework_tutor_threads")
      .select("id, student_assignment_id, status")
      .in("student_assignment_id", saIds);

    const allThreadIds = (allThreads ?? []).map((t) => t.id as string);
    if (allThreadIds.length > 0) {
      const { count: userMsgCount } = await db
        .from("homework_tutor_thread_messages")
        .select("id", { count: "exact", head: true })
        .in("thread_id", allThreadIds)
        .eq("role", "user");
      hasInteractions = (userMsgCount ?? 0) > 0;
    }

    const completedThreads = (allThreads ?? []).filter((t) => t.status === "completed");

    if (completedThreads.length > 0) {
      const threadIds = completedThreads.map((t) => t.id);

      const { data: taskStates } = await db
        .from("homework_tutor_task_states")
        .select("thread_id, task_id, earned_score")
        .in("thread_id", threadIds)
        .eq("status", "completed");

      // Build max_score lookup from tasks already fetched above
      const taskMaxScoreMap: Record<string, number> = {};
      for (const t of tasks ?? []) {
        taskMaxScoreMap[t.id] = t.max_score ?? 1;
      }

      const threadScores: Record<string, { earned: number; maxTotal: number }> = {};
      for (const ts of taskStates ?? []) {
        if (!threadScores[ts.thread_id]) {
          threadScores[ts.thread_id] = { earned: 0, maxTotal: 0 };
        }
        threadScores[ts.thread_id].earned += Number(ts.earned_score ?? 0);
        threadScores[ts.thread_id].maxTotal += taskMaxScoreMap[ts.task_id] ?? 1;
      }

      for (const thread of completedThreads) {
        guidedCompletedCount++;
        statusCounts["completed"] = (statusCounts["completed"] ?? 0) + 1;

        const scores = threadScores[thread.id];
        if (scores && scores.maxTotal > 0) {
          scoreSum += (scores.earned / scores.maxTotal) * 100;
          scoreCount += 1;
        }
      }
    }
  }

  const submissionsSummary = {
    total: guidedCompletedCount,
    by_status: statusCounts,
    avg_percent: scoreCount > 0 ? Math.round((scoreSum / scoreCount) * 100) / 100 : null,
    has_interactions: hasInteractions,
  };

  console.log("homework_api_request_success", {
    route: "GET /assignments/:id",
    tutor_id: tutorUserId,
    assignment_id: assignmentId,
  });

  return jsonOk(cors, {
    assignment,
    tasks: tasks ?? [],
    assigned_students: assignedStudents,
    materials: materials ?? [],
    submissions_summary: submissionsSummary,
  });
}

// ─── Endpoint: PUT /assignments/:id ──────────────────────────────────────────

async function handleUpdateAssignment(
  db: SupabaseClient,
  tutorUserId: string,
  assignmentId: string,
  body: unknown,
  cors: Record<string, string>,
): Promise<Response> {
  const assignmentOrErr = await getOwnedAssignmentOrThrow(db, assignmentId, tutorUserId, cors);
  if (assignmentOrErr instanceof Response) return assignmentOrErr;

  if (!body || typeof body !== "object") {
    return jsonError(cors, 400, "INVALID_BODY", "Request body must be a JSON object");
  }
  const b = body as Record<string, unknown>;

  const patch: Record<string, unknown> = {};
  if (b.title !== undefined) {
    if (!isNonEmptyString(b.title)) return jsonError(cors, 400, "VALIDATION", "title must be a non-empty string");
    patch.title = (b.title as string).trim();
  }
  if (b.subject !== undefined) {
    if (!isNonEmptyString(b.subject) || !(VALID_SUBJECTS_UPDATE as readonly string[]).includes(b.subject)) {
      return jsonError(cors, 400, "VALIDATION", `subject must be one of: ${VALID_SUBJECTS_UPDATE.join(", ")}`);
    }
    patch.subject = b.subject;
  }
  if (b.topic !== undefined) {
    patch.topic = isNonEmptyString(b.topic) ? (b.topic as string).trim() : null;
  }
  if (b.description !== undefined) {
    patch.description = isNonEmptyString(b.description) ? (b.description as string).trim() : null;
  }
  if (b.deadline !== undefined) {
    patch.deadline = isNonEmptyString(b.deadline) ? b.deadline : null;
  }
  if (b.exam_type !== undefined) {
    if (!isNonEmptyString(b.exam_type) || !(VALID_EXAM_TYPES as readonly string[]).includes(b.exam_type)) {
      return jsonError(cors, 400, "VALIDATION", `exam_type must be one of: ${VALID_EXAM_TYPES.join(", ")}`);
    }
    patch.exam_type = b.exam_type;
  }
  if (b.status !== undefined) {
    if (!isNonEmptyString(b.status) || !(VALID_STATUSES as readonly string[]).includes(b.status)) {
      return jsonError(cors, 400, "VALIDATION", `status must be one of: ${VALID_STATUSES.join(", ")}`);
    }
    patch.status = b.status;
  }
  if (b.disable_ai_bootstrap !== undefined) {
    patch.disable_ai_bootstrap = b.disable_ai_bootstrap === true;
  }

  if (Object.keys(patch).length > 0) {
    const { error } = await db
      .from("homework_tutor_assignments")
      .update(patch)
      .eq("id", assignmentId);
    if (error) {
      console.error("homework_api_request_error", { route: "PUT /assignments/:id", error: error.message });
      return jsonError(cors, 500, "DB_ERROR", "Failed to update assignment");
    }
  }

  if (b.tasks !== undefined) {
    if (!Array.isArray(b.tasks)) {
      return jsonError(cors, 400, "VALIDATION", "tasks must be an array");
    }

    for (let i = 0; i < b.tasks.length; i++) {
      const t = b.tasks[i];
      if (!t || typeof t !== "object") {
        return jsonError(cors, 400, "VALIDATION", `tasks[${i}] must be an object`);
      }
      if (!isNonEmptyString(t.task_text) && !isNonEmptyString(t.task_image_url)) {
        return jsonError(cors, 400, "VALIDATION", `tasks[${i}].task_text is required (or provide task_image_url)`);
      }
      if (t.max_score !== undefined && t.max_score !== null && !isPositiveInt(t.max_score)) {
        return jsonError(cors, 400, "VALIDATION", `tasks[${i}].max_score must be a positive integer`);
      }
      if (t.order_num !== undefined && t.order_num !== null && !isPositiveInt(t.order_num)) {
        return jsonError(cors, 400, "VALIDATION", `tasks[${i}].order_num must be a positive integer`);
      }
      if (t.check_format !== undefined && t.check_format !== null && !(VALID_CHECK_FORMATS as readonly string[]).includes(t.check_format)) {
        return jsonError(cors, 400, "VALIDATION", `tasks[${i}].check_format must be one of: ${VALID_CHECK_FORMATS.join(", ")}`);
      }
      const taskImageLimitError = validateAttachmentRefLimit(
        cors,
        t.task_image_url,
        MAX_TASK_IMAGES,
        `tasks[${i}].task_image_url`,
      );
      if (taskImageLimitError) return taskImageLimitError;
      const rubricImageLimitError = validateAttachmentRefLimit(
        cors,
        t.rubric_image_urls,
        MAX_RUBRIC_IMAGES,
        `tasks[${i}].rubric_image_urls`,
      );
      if (rubricImageLimitError) return rubricImageLimitError;
    }

    // Detect if any student has interacted with the assignment via guided threads.
    // Block destructive task changes only if there are existing thread messages.
    let hasSubmissions = false;
    {
      const { data: existingSAs } = await db
        .from("homework_tutor_student_assignments")
        .select("id")
        .eq("assignment_id", assignmentId);
      const existingSAIds = (existingSAs ?? []).map((sa) => sa.id as string);
      if (existingSAIds.length > 0) {
        const { data: existingThreads } = await db
          .from("homework_tutor_threads")
          .select("id")
          .in("student_assignment_id", existingSAIds);
        const existingThreadIds = (existingThreads ?? []).map((t) => t.id as string);
        if (existingThreadIds.length > 0) {
          const { count: msgCount } = await db
            .from("homework_tutor_thread_messages")
            .select("id", { count: "exact", head: true })
            .in("thread_id", existingThreadIds)
            .eq("role", "user");
          hasSubmissions = (msgCount ?? 0) > 0;
        }
      }
    }

    const { data: existingTasks } = await db
      .from("homework_tutor_tasks")
      .select("id, order_num")
      .eq("assignment_id", assignmentId);
    const existingTaskRows = existingTasks ?? [];
    const existingIds = new Set(existingTaskRows.map((t) => t.id));
    const maxCurrentOrder = Math.max(
      0,
      ...existingTaskRows.map((t) => (typeof t.order_num === "number" ? t.order_num : 0)),
    );

    const incomingTasks = b.tasks as Record<string, unknown>[];
    const normalizedIncomingTasks = incomingTasks.map((task, index) => {
      const taskId = isUUID(task.id) ? (task.id as string) : null;
      return {
        task,
        desiredOrder: isPositiveInt(task.order_num) ? (task.order_num as number) : index + 1,
        existingId: taskId && existingIds.has(taskId) ? taskId : null,
      };
    });
    const incomingIds = new Set(
      normalizedIncomingTasks
        .filter((t) => t.existingId)
        .map((t) => t.existingId as string),
    );
    const desiredOrderNums = new Set(normalizedIncomingTasks.map((t) => t.desiredOrder));
    if (desiredOrderNums.size !== normalizedIncomingTasks.length) {
      return jsonError(cors, 400, "VALIDATION", "Duplicate order_num values in tasks");
    }

    if (hasSubmissions) {
      const newTasks = normalizedIncomingTasks.filter((t) => !t.existingId);
      const removedIds = [...existingIds].filter((id) => !incomingIds.has(id));

      if (newTasks.length > 0 || removedIds.length > 0) {
        return jsonError(
          cors,
          400,
          "DESTRUCTIVE_CHANGE",
          "Cannot add or remove tasks when submissions exist. Only updating existing tasks is allowed.",
          { new_tasks: newTasks.length, removed_tasks: removedIds.length },
        );
      }

      // Atomic reorder via PL/pgSQL transaction (avoids UNIQUE constraint corruption)
      const taskOrder = normalizedIncomingTasks
        .filter((t) => t.existingId)
        .map((t) => ({ id: t.existingId as string, order_num: t.desiredOrder }));
      if (taskOrder.length > 0) {
        const { error: reorderErr } = await db.rpc("hw_reorder_tasks", {
          p_assignment_id: assignmentId,
          p_task_order: taskOrder,
        });
        if (reorderErr) {
          console.error("homework_api_request_error", { route: "PUT /assignments/:id tasks reorder", error: reorderErr.message });
          return jsonError(cors, 500, "DB_ERROR", "Failed to reorder tasks");
        }
      }
      // Update task fields (order_num already set atomically above)
      for (let i = 0; i < incomingTasks.length; i++) {
        const t = incomingTasks[i];
        if (!isUUID(t.id)) continue;
        const updateFields: Record<string, unknown> = {};
        updateFields.task_text = isNonEmptyString(t.task_text) ? (t.task_text as string).trim() : "[Задача на фото]";
        if (t.task_image_url !== undefined) {
          updateFields.task_image_url = isNonEmptyString(t.task_image_url) ? (t.task_image_url as string).trim() : null;
        }
        if (t.correct_answer !== undefined) {
          updateFields.correct_answer = isNonEmptyString(t.correct_answer) ? (t.correct_answer as string).trim() : null;
        }
        if (t.max_score !== undefined) {
          updateFields.max_score = isPositiveInt(t.max_score) ? t.max_score : 1;
        }
        if (t.rubric_text !== undefined) {
          updateFields.rubric_text = isNonEmptyString(t.rubric_text) ? (t.rubric_text as string).trim() : null;
        }
        if (t.rubric_image_urls !== undefined) {
          updateFields.rubric_image_urls = isNonEmptyString(t.rubric_image_urls) ? (t.rubric_image_urls as string).trim() : null;
        }
        if (t.check_format !== undefined) {
          updateFields.check_format = (VALID_CHECK_FORMATS as readonly string[]).includes(t.check_format as string) ? t.check_format : "short_answer";
        }

        const { error } = await db
          .from("homework_tutor_tasks")
          .update(updateFields)
          .eq("id", t.id)
          .eq("assignment_id", assignmentId);
        if (error) {
          console.error("homework_api_request_error", { route: "PUT /assignments/:id tasks update", error: error.message });
          return jsonError(cors, 500, "DB_ERROR", "Failed to update task fields");
        }
      }
    } else {
      const toUpdate = normalizedIncomingTasks.filter((t) => t.existingId);
      const toInsert = normalizedIncomingTasks.filter((t) => !t.existingId);
      const toDeleteIds = [...existingIds].filter((id) => !incomingIds.has(id));

      // Order: update existing fields → insert new at temp orders → atomic final reorder → delete removed.
      // This lets a tutor replace a removed task with a new one at the same visible position.

      // 1. Update existing task fields without touching order_num.
      for (let i = 0; i < toUpdate.length; i++) {
        const entry = toUpdate[i];
        const t = entry.task;
        const updateFields: Record<string, unknown> = {
          task_text: isNonEmptyString(t.task_text) ? (t.task_text as string).trim() : "[Задача на фото]",
          task_image_url: isNonEmptyString(t.task_image_url) ? (t.task_image_url as string).trim() : null,
          correct_answer: isNonEmptyString(t.correct_answer) ? (t.correct_answer as string).trim() : null,
          max_score: isPositiveInt(t.max_score) ? t.max_score : 1,
          rubric_text: isNonEmptyString(t.rubric_text) ? (t.rubric_text as string).trim() : null,
          rubric_image_urls: isNonEmptyString(t.rubric_image_urls) ? (t.rubric_image_urls as string).trim() : null,
          check_format: (VALID_CHECK_FORMATS as readonly string[]).includes(t.check_format as string) ? t.check_format : "short_answer",
        };
        const { error } = await db
          .from("homework_tutor_tasks")
          .update(updateFields)
          .eq("id", entry.existingId as string)
          .eq("assignment_id", assignmentId);
        if (error) {
          console.error("homework_api_request_error", { route: "PUT /assignments/:id tasks update", error: error.message });
          return jsonError(cors, 500, "DB_ERROR", "Failed to update task fields");
        }
      }

      // 2. Insert new tasks at temporary high order_num values to avoid UNIQUE conflicts.
      const tempOrderBase =
        Math.max(
          maxCurrentOrder,
          ...normalizedIncomingTasks.map((t) => t.desiredOrder),
          0,
        ) + 1000;
      const insertedTaskIds: string[] = [];
      if (toInsert.length > 0) {
        for (let i = 0; i < toInsert.length; i++) {
          const t = toInsert[i].task;
          const { data: insertedRow, error } = await db
            .from("homework_tutor_tasks")
            .insert({
              assignment_id: assignmentId,
              order_num: tempOrderBase + i + 1,
              task_text: isNonEmptyString(t.task_text) ? (t.task_text as string).trim() : "[Задача на фото]",
              task_image_url: isNonEmptyString(t.task_image_url) ? (t.task_image_url as string).trim() : null,
              correct_answer: isNonEmptyString(t.correct_answer) ? (t.correct_answer as string).trim() : null,
              max_score: isPositiveInt(t.max_score) ? t.max_score : 1,
              rubric_text: isNonEmptyString(t.rubric_text) ? (t.rubric_text as string).trim() : null,
              rubric_image_urls: isNonEmptyString(t.rubric_image_urls) ? (t.rubric_image_urls as string).trim() : null,
              check_format: (VALID_CHECK_FORMATS as readonly string[]).includes(t.check_format as string) ? t.check_format : "short_answer",
            })
            .select("id")
            .single();
          const insertedId = (insertedRow as { id?: string } | null)?.id ?? null;
          if (error || !isUUID(insertedId)) {
            console.error("homework_api_request_error", { route: "PUT /assignments/:id tasks insert", error: error?.message ?? "missing inserted id" });
            return jsonError(cors, 500, "DB_ERROR", "Failed to insert new tasks");
          }
          insertedTaskIds.push(insertedId);
        }
      }

      // 3. Final atomic reorder:
      // kept tasks get their final desired order, removed tasks are parked at the tail,
      // then the actual delete happens last.
      const insertedIdQueue = [...insertedTaskIds];
      const keptTaskOrder = normalizedIncomingTasks.map((entry) => {
        if (entry.existingId) {
          return { id: entry.existingId, order_num: entry.desiredOrder };
        }
        const insertedId = insertedIdQueue.shift();
        return insertedId ? { id: insertedId, order_num: entry.desiredOrder } : null;
      });
      if (keptTaskOrder.some((entry) => entry === null)) {
        return jsonError(cors, 500, "DB_ERROR", "Failed to map inserted tasks for reorder");
      }
      const parkingBase = tempOrderBase + toInsert.length;
      const parkingTaskOrder = toDeleteIds.map((id, index) => ({
        id,
        order_num: parkingBase + index + 1,
      }));
      const reorderPayload = [
        ...(keptTaskOrder as Array<{ id: string; order_num: number }>),
        ...parkingTaskOrder,
      ];
      if (reorderPayload.length > 0) {
        const { error: reorderErr } = await db.rpc("hw_reorder_tasks", {
          p_assignment_id: assignmentId,
          p_task_order: reorderPayload,
        });
        if (reorderErr) {
          console.error("homework_api_request_error", { route: "PUT /assignments/:id tasks reorder", error: reorderErr.message });
          return jsonError(cors, 500, "DB_ERROR", "Failed to reorder tasks");
        }
      }

      // 4. Delete removed tasks only after the final order is safely in place.
      if (toDeleteIds.length > 0) {
        const { error } = await db
          .from("homework_tutor_tasks")
          .delete()
          .in("id", toDeleteIds)
          .eq("assignment_id", assignmentId);
        if (error) {
          console.error("homework_api_request_error", { route: "PUT /assignments/:id tasks delete", error: error.message });
          return jsonError(cors, 500, "DB_ERROR", "Failed to delete removed tasks");
        }
      }
    }

    await syncThreadCursorOrdersForAssignment(db, assignmentId);
  }

  console.log("homework_api_request_success", {
    route: "PUT /assignments/:id",
    tutor_id: tutorUserId,
    assignment_id: assignmentId,
  });
  return jsonOk(cors, { ok: true });
}

// ─── Endpoint: POST /assignments/:id/assign ──────────────────────────────────

async function handleAssignStudents(
  db: SupabaseClient,
  tutorUserId: string,
  tutorId: string,
  assignmentId: string,
  body: unknown,
  cors: Record<string, string>,
): Promise<Response> {
  const assignmentOrErr = await getOwnedAssignmentOrThrow(db, assignmentId, tutorUserId, cors);
  if (assignmentOrErr instanceof Response) return assignmentOrErr;
  const assignment = assignmentOrErr;

  if (!body || typeof body !== "object") {
    return jsonError(cors, 400, "INVALID_BODY", "Request body must be a JSON object");
  }
  const b = body as Record<string, unknown>;

  if (b.group_id !== undefined && b.group_id !== null && !isUUID(b.group_id)) {
    return jsonError(cors, 400, "VALIDATION", "group_id must be a UUID or null");
  }

  let studentIds: string[] = [];
  if (Array.isArray(b.student_ids) && b.student_ids.length > 0) {
    for (let i = 0; i < b.student_ids.length; i++) {
      if (!isUUID(b.student_ids[i])) {
        return jsonError(cors, 400, "VALIDATION", `student_ids[${i}] is not a valid UUID`);
      }
    }
    studentIds = [...new Set(b.student_ids as string[])];
  }

  if (isUUID(b.group_id)) {
    const { data: memberships, error: membershipsError } = await db
      .from("tutor_group_memberships")
      .select("tutor_student_id")
      .eq("tutor_id", tutorId)
      .eq("tutor_group_id", b.group_id)
      .eq("is_active", true);

    if (membershipsError) {
      return jsonError(cors, 500, "DB_ERROR", "Failed to load group members");
    }

    const tutorStudentIds = (memberships ?? []).map((m) => m.tutor_student_id as string);
    if (tutorStudentIds.length > 0) {
      const { data: mappedStudents, error: mapError } = await db
        .from("tutor_students")
        .select("id, student_id")
        .eq("tutor_id", tutorId)
        .in("id", tutorStudentIds);
      if (mapError) {
        return jsonError(cors, 500, "DB_ERROR", "Failed to resolve group students");
      }
      studentIds = [...new Set([
        ...studentIds,
        ...(mappedStudents ?? []).map((m) => m.student_id as string),
      ])];
    }
  }

  if (studentIds.length === 0) {
    return jsonError(cors, 400, "VALIDATION", "Provide student_ids or group_id with members");
  }

  const { data: tutorStudents } = await db
    .from("tutor_students")
    .select("student_id")
    .eq("tutor_id", tutorId)
    .in("student_id", studentIds);

  const validStudentIds = new Set((tutorStudents ?? []).map((ts) => ts.student_id));
  const invalidIds = studentIds.filter((id) => !validStudentIds.has(id));

  if (invalidIds.length > 0) {
    return jsonError(cors, 403, "INVALID_STUDENTS", "Some student_ids are not your students", {
      invalid_student_ids: invalidIds,
    });
  }

  let studentsWithoutTelegram: string[] = [];
  let studentsWithoutTelegramNames: string[] = [];

  const { data: studentProfiles, error: studentProfilesError } = await db
    .from("profiles")
    .select("id, username, telegram_username, telegram_user_id")
    .in("id", studentIds);

  if (studentProfilesError) {
    console.warn("homework_api_student_profile_lookup_failed", {
      route: "POST /assignments/:id/assign",
      assignment_id: assignmentId,
      error: studentProfilesError.message,
    });
  } else {
    const profileById = new Map((studentProfiles ?? []).map((p) => [p.id as string, p]));
    studentsWithoutTelegram = studentIds.filter((sid) => {
      const profile = profileById.get(sid);
      return !profile?.telegram_user_id;
    });
    studentsWithoutTelegramNames = studentsWithoutTelegram.map((sid) => {
      const profile = profileById.get(sid);
      if (profile?.username && String(profile.username).trim().length > 0) {
        return String(profile.username);
      }
      if (profile?.telegram_username && String(profile.telegram_username).trim().length > 0) {
        return `@${String(profile.telegram_username).replace(/^@/, "")}`;
      }
      return sid;
    });
  }

  const rows = studentIds.map((sid) => ({
    assignment_id: assignmentId,
    student_id: sid,
  }));

  if (isUUID(b.group_id)) {
    await db
      .from("homework_tutor_assignments")
      .update({ group_id: b.group_id })
      .eq("id", assignmentId);
  }

  const { data: upserted, error } = await db
    .from("homework_tutor_student_assignments")
    .upsert(rows, { onConflict: "assignment_id,student_id", ignoreDuplicates: true })
    .select("id");

  if (error) {
    console.error("homework_api_request_error", { route: "POST /assignments/:id/assign", error: error.message });
    return jsonError(cors, 500, "DB_ERROR", "Failed to assign students");
  }

  // Provision guided threads eagerly for newly assigned students
  if (upserted && upserted.length > 0) {
    for (const sa of upserted as { id: string }[]) {
      await provisionGuidedThread(db, assignmentId, sa.id);
    }
  }

  let assignmentStatus = String(assignment.status ?? "draft");
  if (assignmentStatus === "draft") {
    const { data: updatedAssignment, error: statusUpdateError } = await db
      .from("homework_tutor_assignments")
      .update({ status: "active" })
      .eq("id", assignmentId)
      .eq("status", "draft")
      .select("status")
      .maybeSingle();

    if (statusUpdateError) {
      console.error("homework_api_request_error", {
        route: "POST /assignments/:id/assign",
        assignment_id: assignmentId,
        error: statusUpdateError.message,
      });
      return jsonError(cors, 500, "DB_ERROR", "Failed to activate assignment after assign");
    }

    if (updatedAssignment?.status) {
      assignmentStatus = updatedAssignment.status as string;
    }
  }

  console.log("homework_api_request_success", {
    route: "POST /assignments/:id/assign",
    tutor_id: tutorUserId,
    assignment_id: assignmentId,
    added: (upserted ?? []).length,
    assignment_status_after_assign: assignmentStatus,
  });
  return jsonOk(cors, {
    added: (upserted ?? []).length,
    assignment_status: assignmentStatus,
    assigned_group_id: isUUID(b.group_id) ? b.group_id : null,
    students_without_telegram: studentsWithoutTelegram,
    students_without_telegram_names: studentsWithoutTelegramNames,
  });
}

// ─── Endpoint: POST /assignments/:id/notify ──────────────────────────────────

async function handleNotifyStudents(
  db: SupabaseClient,
  tutorUserId: string,
  assignmentId: string,
  body: unknown,
  cors: Record<string, string>,
): Promise<Response> {
  const assignmentOrErr = await getOwnedAssignmentOrThrow(db, assignmentId, tutorUserId, cors);
  if (assignmentOrErr instanceof Response) return assignmentOrErr;
  const assignment = assignmentOrErr;

  const b = (body && typeof body === "object") ? body as Record<string, unknown> : {};
  const messageTemplate = isNonEmptyString(b.message_template)
    ? (b.message_template as string).trim()
    : null;

  const { data: pendingStudents } = await db
    .from("homework_tutor_student_assignments")
    .select("student_id")
    .eq("assignment_id", assignmentId)
    .eq("notified", false);

  if (!pendingStudents || pendingStudents.length === 0) {
    return jsonOk(cors, { sent: 0, failed: 0, failed_student_ids: [], failed_by_reason: {} });
  }

  const studentIds = pendingStudents.map((s) => s.student_id);

  // ─── Resolve all delivery channels ──────────────────────────────────────────

  const { data: profiles, error: profilesError } = await db
    .from("profiles")
    .select("id, telegram_user_id")
    .in("id", studentIds);

  if (profilesError) {
    console.error("homework_api_request_error", {
      route: "POST /assignments/:id/notify",
      assignment_id: assignmentId,
      error: profilesError.message,
    });
    return jsonError(cors, 500, "DB_ERROR", "Failed to resolve students telegram links");
  }

  const { data: sessions, error: sessionsError } = await db
    .from("telegram_sessions")
    .select("user_id, telegram_user_id")
    .in("user_id", studentIds);

  if (sessionsError) {
    console.error("homework_api_request_error", {
      route: "POST /assignments/:id/notify",
      assignment_id: assignmentId,
      error: sessionsError.message,
    });
    return jsonError(cors, 500, "DB_ERROR", "Failed to resolve telegram sessions");
  }

  // Service-role client for push_subscriptions (RLS limits to own user)
  const dbService = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: pushSubs, error: pushSubsError } = await dbService
    .from("push_subscriptions")
    .select("user_id, endpoint, p256dh, auth")
    .in("user_id", studentIds);

  if (pushSubsError) {
    console.error("homework_notify_push_subs_query_error", {
      assignment_id: assignmentId,
      error: pushSubsError.message,
    });
    // Continue without push — cascade to telegram/email
  }

  // Build lookup maps
  const profileTgMap: Record<string, number> = {};
  for (const p of profiles ?? []) {
    if (p.telegram_user_id) {
      profileTgMap[p.id] = p.telegram_user_id;
    }
  }

  // Fetch emails from auth.users (profiles table has no email column)
  const emailMap: Record<string, string> = {};
  for (const sid of studentIds) {
    try {
      const { data } = await dbService.auth.admin.getUserById(sid);
      if (data?.user?.email && !data.user.email.endsWith("@temp.sokratai.ru")) {
        emailMap[sid] = data.user.email;
      }
    } catch {
      // Skip — student won't get email fallback
    }
  }

  const sessionTgMap: Record<string, number> = {};
  for (const s of sessions ?? []) {
    if (s.telegram_user_id) {
      sessionTgMap[s.user_id] = s.telegram_user_id;
    }
  }

  const pushSubsMap: Record<string, PushSubscriptionData[]> = {};
  for (const sub of pushSubs ?? []) {
    const uid = sub.user_id as string;
    if (!pushSubsMap[uid]) pushSubsMap[uid] = [];
    pushSubsMap[uid].push({
      endpoint: sub.endpoint as string,
      p256dh: sub.p256dh as string,
      auth: sub.auth as string,
    });
  }

  // Fetch tutor name for email template
  const { data: tutorProfile } = await dbService
    .from("profiles")
    .select("display_name")
    .eq("id", tutorUserId)
    .single();
  const tutorName = (tutorProfile?.display_name as string) || "Репетитор";

  const appUrl = Deno.env.get("PUBLIC_APP_URL")?.trim().replace(/\/$/, "") ?? "https://sokratai.lovable.app";
  const homeworkUrl = `${appUrl}/homework/${assignmentId}`;
  const defaultMessage = `📚 Новое домашнее задание: <b>${escapeHtmlEntities(assignment.title as string)}</b>\n\nПредмет: ${escapeHtmlEntities(assignment.subject as string)}\n<a href="${escapeHtmlEntities(homeworkUrl)}">Открыть ДЗ</a>`;
  const tgText = messageTemplate ?? defaultMessage;

  const pushPayload: PushPayload = {
    title: `Новое ДЗ: ${assignment.title as string}`,
    body: `Новое задание по ${assignment.subject as string}`,
    url: homeworkUrl,
  };

  // ─── Cascade delivery per student ───────────────────────────────────────────

  let sent = 0;
  let failed = 0;
  const sentByChannel = { push: 0, telegram: 0, email: 0 };
  const deliveredStudents: { sid: string; status: string; channel: string }[] = [];
  const failedStudentIds: string[] = [];
  const failedByReason: Record<string, NotifyFailureReason> = {};

  for (const sid of studentIds) {
    let hasPush = (pushSubsMap[sid]?.length ?? 0) > 0;
    const chatId = profileTgMap[sid] ?? sessionTgMap[sid];
    const hasTelegram = Boolean(chatId);
    const hasEmail = Boolean(emailMap[sid]);

    console.log("homework_assignment_delivery_diagnostics", {
      assignment_id: assignmentId,
      student_id: sid,
      has_push: hasPush,
      has_telegram: hasTelegram,
      has_email: hasEmail,
    });

    let delivered = false;
    let deliveryChannel: string | null = null;
    let deliveryStatus: string | null = null;
    let lastFailedReason: NotifyFailureReason | null = null;

    // ── Step 1: Try Push ──────────────────────────────────────────────────────
    if (hasPush && VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
      const subs = pushSubsMap[sid];
      let allGone = true;
      for (const sub of subs) {
        let pushResult = await sendPushNotification(sub, pushPayload, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT);

        if (pushResult.success) {
          delivered = true;
          deliveryChannel = "push";
          deliveryStatus = "delivered_push";
          allGone = false;
          console.log("homework_notify_push_ok", { assignment_id: assignmentId, student_id: sid });
          break;
        }

        if (pushResult.gone) {
          // 410 Gone — subscription expired, clean up
          console.warn("homework_notify_push_gone", { assignment_id: assignmentId, student_id: sid, endpoint: sub.endpoint });
          await dbService.from("push_subscriptions").delete().eq("endpoint", sub.endpoint).eq("user_id", sid);
          continue;
        }

        allGone = false;
        // 5xx — retry once
        if (pushResult.status >= 500) {
          console.warn("homework_notify_push_retry", { assignment_id: assignmentId, student_id: sid, status: pushResult.status });
          pushResult = await sendPushNotification(sub, pushPayload, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT);
          if (pushResult.success) {
            delivered = true;
            deliveryChannel = "push";
            deliveryStatus = "delivered_push";
            console.log("homework_notify_push_ok_retry", { assignment_id: assignmentId, student_id: sid });
            break;
          }
          if (pushResult.gone) {
            await dbService.from("push_subscriptions").delete().eq("endpoint", sub.endpoint).eq("user_id", sid);
          }
        }
        // Try next subscription
      }
      if (!delivered) {
        lastFailedReason = allGone ? "push_expired" : "push_send_failed";
        // If all subscriptions expired, this student effectively has no push channel
        if (allGone) hasPush = false;
      }
    }

    // ── Step 2: Try Telegram (preserved existing logic) ───────────────────────
    if (!delivered && hasTelegram) {
      try {
        const payload: Record<string, unknown> = {
          chat_id: chatId,
          text: tgText,
        };
        if (!messageTemplate) {
          payload.parse_mode = "HTML";
        }

        let lastResp: Response | null = null;
        const maxAttempts = 2;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          lastResp = await fetch(
            `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            },
          );
          if (lastResp.ok) break;

          const status = lastResp.status;
          // Retry only on transient errors (429 rate limit, 5xx server errors)
          if (attempt < maxAttempts - 1 && (status === 429 || status >= 500)) {
            console.warn("homework_notify_telegram_retry", {
              assignment_id: assignmentId,
              student_id: sid,
              attempt: attempt + 1,
              status,
            });
            await new Promise((r) => setTimeout(r, 500));
            continue;
          }
          break;
        }

        if (lastResp?.ok) {
          delivered = true;
          deliveryChannel = "telegram";
          deliveryStatus = "delivered_telegram";
          console.log("homework_notify_telegram_ok", { assignment_id: assignmentId, student_id: sid });
        } else {
          const errBody = await lastResp?.text().catch(() => "unknown");
          console.error("homework_api_telegram_send_failed", {
            assignment_id: assignmentId,
            student_id: sid,
            chat_id: chatId,
            status: lastResp?.status,
            error: errBody,
          });
        }
        if (!delivered) lastFailedReason = "telegram_send_failed";
      } catch (err) {
        console.error("homework_api_telegram_send_error", {
          assignment_id: assignmentId,
          student_id: sid,
          error: String(err),
        });
        lastFailedReason = "telegram_send_error";
      }
    }

    // ── Step 3: Try Email ─────────────────────────────────────────────────────
    if (!delivered && hasEmail) {
      try {
        const emailResult = await sendHomeworkNotificationEmail(
          dbService,
          emailMap[sid],
          {
            tutorName,
            assignmentTitle: assignment.title as string,
            subject: assignment.subject as string,
            deadline: (assignment.deadline as string) ?? null,
            homeworkUrl: homeworkUrl ?? `https://sokratai.lovable.app/homework/${assignmentId}`,
          },
          assignmentId,
        );

        if (emailResult.success && !emailResult.skipped) {
          delivered = true;
          deliveryChannel = "email";
          deliveryStatus = "delivered_email";
          console.log("homework_notify_email_ok", { assignment_id: assignmentId, student_id: sid });
        } else if (emailResult.skipped) {
          console.log("homework_notify_email_skipped", { assignment_id: assignmentId, student_id: sid, reason: emailResult.skipped });
        } else {
          console.error("homework_notify_email_failed", { assignment_id: assignmentId, student_id: sid, error: emailResult.error });
        }
      } catch (err) {
        console.error("homework_notify_email_error", { assignment_id: assignmentId, student_id: sid, error: String(err) });
      }
      if (!delivered) lastFailedReason = "email_send_failed";
    }

    // ── Step 4: Record result ─────────────────────────────────────────────────
    if (delivered) {
      sent++;
      sentByChannel[deliveryChannel as keyof typeof sentByChannel]++;
      deliveredStudents.push({ sid, status: deliveryStatus!, channel: deliveryChannel! });
    } else {
      failed++;
      failedStudentIds.push(sid);
      if (!hasPush && !hasTelegram && !hasEmail) {
        failedByReason[sid] = "no_channels_available";
      } else {
        // Use the most specific reason from the last failed channel
        failedByReason[sid] = lastFailedReason ?? "all_channels_failed";
      }
      console.warn("homework_notify_student_failed", {
        assignment_id: assignmentId,
        student_id: sid,
        reason: failedByReason[sid],
        channels_tried: { push: hasPush, telegram: hasTelegram, email: hasEmail },
      });
    }
  }

  // ─── Update DB ────────────────────────────────────────────────────────────

  if (deliveredStudents.length > 0) {
    const now = new Date().toISOString();
    // Group by (status, channel) for batch update
    const groups: Record<string, string[]> = {};
    for (const s of deliveredStudents) {
      const key = `${s.status}|${s.channel}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(s.sid);
    }
    for (const [key, sids] of Object.entries(groups)) {
      const [status, channel] = key.split("|");
      await db
        .from("homework_tutor_student_assignments")
        .update({ notified: true, notified_at: now, delivery_status: status, delivery_channel: channel, delivery_error_code: null })
        .eq("assignment_id", assignmentId)
        .in("student_id", sids);
    }
  }

  // Update failed students
  const noChannelStudents = failedStudentIds.filter((sid) => failedByReason[sid] === "no_channels_available");
  if (noChannelStudents.length > 0) {
    await db
      .from("homework_tutor_student_assignments")
      .update({ delivery_status: "failed_no_channel" })
      .eq("assignment_id", assignmentId)
      .in("student_id", noChannelStudents);
  }

  const allChannelsFailedStudents = failedStudentIds.filter((sid) => failedByReason[sid] !== "no_channels_available");
  if (allChannelsFailedStudents.length > 0) {
    await db
      .from("homework_tutor_student_assignments")
      .update({ delivery_status: "failed_all_channels" })
      .eq("assignment_id", assignmentId)
      .in("student_id", allChannelsFailedStudents);
  }

  console.log("homework_api_request_success", {
    route: "POST /assignments/:id/notify",
    tutor_id: tutorUserId,
    assignment_id: assignmentId,
    sent,
    failed,
    sent_by_channel: sentByChannel,
    failed_student_ids: failedStudentIds,
    failed_by_reason: failedByReason,
  });
  return jsonOk(cors, {
    sent,
    failed,
    sent_by_channel: sentByChannel,
    failed_student_ids: failedStudentIds,
    failed_by_reason: failedByReason,
  });
}

function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
}

function escapeHtmlEntities(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ─── Endpoint: POST /assignments/:id/students/:sid/remind ────────────────────
//
// Per-student re-engagement reminder used by Homework Results v2 action block
// (RemindStudentDialog). The tutor authors a free-text message and we deliver
// it via Telegram (preferred) or email-fallback (AC-7) in a single attempt.
//
// Differences vs. handleNotifyStudents:
//   - targets exactly one student (already in the assignment)
//   - tutor message is plain text (no HTML parse_mode)
//   - does NOT mutate notified / notified_at / delivery_status — this is a
//     re-engagement nudge, not initial delivery
//   - returns the resolved channel so the frontend can show a channel-specific
//     toast and emit telemetry without PII
//
// Body: { message: string } (1..2000 chars, trimmed)
// Response: { success, channel: 'telegram' | 'email', reason? }

const REMIND_MESSAGE_MIN_CHARS = 1;
const REMIND_MESSAGE_MAX_CHARS = 2000;

async function handleRemindStudent(
  db: SupabaseClient,
  tutorUserId: string,
  assignmentId: string,
  studentId: string,
  body: unknown,
  cors: Record<string, string>,
): Promise<Response> {
  if (!isUUID(studentId)) {
    return jsonError(cors, 400, "VALIDATION", "studentId is not a valid UUID");
  }

  const assignmentOrErr = await getOwnedAssignmentOrThrow(db, assignmentId, tutorUserId, cors);
  if (assignmentOrErr instanceof Response) return assignmentOrErr;
  const assignment = assignmentOrErr;

  const b = (body && typeof body === "object") ? body as Record<string, unknown> : {};
  if (!isNonEmptyString(b.message)) {
    return jsonError(cors, 400, "VALIDATION", "message must be a non-empty string");
  }
  const message = (b.message as string).trim();
  if (message.length < REMIND_MESSAGE_MIN_CHARS) {
    return jsonError(cors, 400, "VALIDATION", "message is empty after trim");
  }
  if (message.length > REMIND_MESSAGE_MAX_CHARS) {
    return jsonError(
      cors,
      400,
      "VALIDATION",
      `message must be at most ${REMIND_MESSAGE_MAX_CHARS} characters`,
    );
  }

  // Optional channel override. `'auto'` (default) = cascade telegram → email.
  // Explicit `'telegram'` / `'email'` forces that channel only — no fallback.
  const rawChannel = typeof b.channel === "string" ? b.channel : "auto";
  const channelPreference: "auto" | "telegram" | "email" =
    rawChannel === "telegram" || rawChannel === "email" ? rawChannel : "auto";

  // Confirm the student is actually assigned to this homework. Avoids
  // accidentally messaging students from other tutors via id-spoofing.
  const { data: studentAssignmentRow, error: saError } = await db
    .from("homework_tutor_student_assignments")
    .select("id, student_id")
    .eq("assignment_id", assignmentId)
    .eq("student_id", studentId)
    .maybeSingle();

  if (saError) {
    console.error("homework_remind_student_sa_error", {
      assignment_id: assignmentId,
      student_id: studentId,
      error: saError.message,
    });
    return jsonError(cors, 500, "DB_ERROR", "Failed to validate student assignment");
  }
  if (!studentAssignmentRow) {
    return jsonError(cors, 404, "NOT_FOUND", "Student is not assigned to this homework");
  }

  // ── Resolve channels for this student ─────────────────────────────────────
  const dbService = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: studentProfile } = await db
    .from("profiles")
    .select("id, telegram_user_id")
    .eq("id", studentId)
    .maybeSingle();

  let chatId: number | null =
    studentProfile?.telegram_user_id != null
      ? (studentProfile.telegram_user_id as number)
      : null;

  if (chatId == null) {
    const { data: sessionRow } = await db
      .from("telegram_sessions")
      .select("telegram_user_id")
      .eq("user_id", studentId)
      .maybeSingle();
    if (sessionRow?.telegram_user_id != null) {
      chatId = sessionRow.telegram_user_id as number;
    }
  }

  let studentEmail: string | null = null;
  try {
    const { data } = await dbService.auth.admin.getUserById(studentId);
    if (data?.user?.email && !data.user.email.endsWith("@temp.sokratai.ru")) {
      studentEmail = data.user.email;
    }
  } catch {
    // ignore — student simply has no email fallback
  }

  if (chatId == null && !studentEmail) {
    console.warn("homework_remind_student_no_channel", {
      assignment_id: assignmentId,
      student_id: studentId,
    });
    return jsonError(
      cors,
      422,
      "NO_CHANNEL",
      "Student has neither a Telegram link nor a usable email",
    );
  }

  // Honor explicit channel preference: if the tutor picked a channel in the
  // dialog tab and it's unavailable, fail fast (no silent fallback — the UI
  // should never offer a tab for a channel that's unusable).
  if (channelPreference === "telegram" && chatId == null) {
    return jsonError(cors, 422, "NO_TELEGRAM", "Student has no Telegram link");
  }
  if (channelPreference === "email" && !studentEmail) {
    return jsonError(cors, 422, "NO_EMAIL", "Student has no usable email");
  }

  // ── Try Telegram first (skipped if tutor picked email explicitly) ────────
  if (chatId != null && channelPreference !== "email") {
    try {
      const appUrl =
        Deno.env.get("PUBLIC_APP_URL")?.trim().replace(/\/$/, "") ??
        "https://sokratai.lovable.app";
      const homeworkUrl = `${appUrl}/homework/${assignmentId}`;
      const textWithLink =
        `${escapeHtmlEntities(message)}\n\n<a href="${escapeHtmlEntities(homeworkUrl)}">Открыть ДЗ</a>`;

      const payload: Record<string, unknown> = {
        chat_id: chatId,
        text: textWithLink,
        parse_mode: "HTML",
      };

      let lastResp: Response | null = null;
      const maxAttempts = 2;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        lastResp = await fetch(
          `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          },
        );
        if (lastResp.ok) break;

        const status = lastResp.status;
        if (attempt < maxAttempts - 1 && (status === 429 || status >= 500)) {
          console.warn("homework_remind_student_telegram_retry", {
            assignment_id: assignmentId,
            student_id: studentId,
            attempt: attempt + 1,
            status,
          });
          await new Promise((r) => setTimeout(r, 500));
          continue;
        }
        break;
      }

      if (lastResp?.ok) {
        console.log("homework_remind_student_ok", {
          assignment_id: assignmentId,
          student_id: studentId,
          channel: "telegram",
        });
        return jsonOk(cors, { success: true, channel: "telegram" });
      }

      const errBody = await lastResp?.text().catch(() => "unknown");
      console.error("homework_remind_student_telegram_failed", {
        assignment_id: assignmentId,
        student_id: studentId,
        status: lastResp?.status,
        error: errBody,
      });
      if (channelPreference === "telegram") {
        return jsonError(
          cors,
          502,
          "TELEGRAM_FAILED",
          "Failed to deliver via Telegram",
        );
      }
      // fall through to email fallback (auto cascade only)
    } catch (err) {
      console.error("homework_remind_student_telegram_error", {
        assignment_id: assignmentId,
        student_id: studentId,
        error: String(err),
      });
      if (channelPreference === "telegram") {
        return jsonError(
          cors,
          502,
          "TELEGRAM_FAILED",
          "Failed to deliver via Telegram",
        );
      }
      // fall through to email fallback (auto cascade only)
    }
  }

  // ── Email fallback ────────────────────────────────────────────────────────
  if (studentEmail) {
    // Resolve student/tutor display names for the email body. Falls back to
    // safe placeholders so we never leak raw uuids or block on missing rows.
    const { data: studentProfileForName } = await dbService
      .from("profiles")
      .select("display_name, username")
      .eq("id", studentId)
      .maybeSingle();
    const studentName =
      (studentProfileForName?.display_name as string) ||
      (studentProfileForName?.username as string) ||
      "Ученик";

    const { data: tutorProfile } = await dbService
      .from("profiles")
      .select("display_name")
      .eq("id", tutorUserId)
      .maybeSingle();
    const tutorName = (tutorProfile?.display_name as string) || "Репетитор";

    const appUrl =
      Deno.env.get("PUBLIC_APP_URL")?.trim().replace(/\/$/, "") ??
      "https://sokratai.lovable.app";
    const homeworkUrl = `${appUrl}/homework/${assignmentId}`;

    const emailResult = await sendHomeworkTutorMessageEmail(
      dbService,
      studentEmail,
      {
        tutorName,
        studentName,
        assignmentTitle: assignment.title as string,
        message,
        homeworkUrl,
      },
      assignmentId,
    );

    if (emailResult.success && !emailResult.skipped) {
      console.log("homework_remind_student_ok", {
        assignment_id: assignmentId,
        student_id: studentId,
        channel: "email",
      });
      return jsonOk(cors, { success: true, channel: "email" });
    }

    console.error("homework_remind_student_email_failed", {
      assignment_id: assignmentId,
      student_id: studentId,
      skipped: emailResult.skipped,
      error: emailResult.error,
    });
    return jsonError(
      cors,
      502,
      "EMAIL_FAILED",
      emailResult.skipped
        ? `Email skipped: ${emailResult.skipped}`
        : `Email send failed: ${emailResult.error ?? "unknown"}`,
    );
  }

  // Telegram failed AND no email available
  return jsonError(
    cors,
    502,
    "TELEGRAM_FAILED",
    "Failed to deliver via Telegram and no email fallback available",
  );
}

// ─── Endpoint: GET /assignments/:id/results ──────────────────────────────────

async function handleGetResults(
  db: SupabaseClient,
  tutorUserId: string,
  assignmentId: string,
  cors: Record<string, string>,
): Promise<Response> {
  const assignmentOrErr = await getOwnedAssignmentOrThrow(db, assignmentId, tutorUserId, cors);
  if (assignmentOrErr instanceof Response) return assignmentOrErr;

  const { data: tasks } = await db
    .from("homework_tutor_tasks")
    .select("id, order_num, task_text, max_score")
    .eq("assignment_id", assignmentId)
    .order("order_num", { ascending: true });

  // Build taskMap for lookups by task_id
  const taskMap: Record<string, { order_num: number; task_text: string; max_score: number }> = {};
  for (const t of tasks ?? []) {
    taskMap[t.id] = { order_num: t.order_num, task_text: t.task_text, max_score: t.max_score };
  }

  // Sum of max_score across all tasks in the assignment (used as fallback
  // denominator when a student does not yet have any task_states).
  const assignmentMaxScoreTotal = (tasks ?? []).reduce(
    (sum, t) => sum + (t.max_score ?? 0),
    0,
  );

  // Hint overuse threshold per spec: ceil(tasks.length * 0.6).
  const hintOveruseThreshold = Math.max(1, Math.ceil((tasks?.length ?? 0) * 0.6));

  let totalScoreSum = 0;
  let totalScoreCount = 0;
  const distribution = { "0-24": 0, "25-49": 0, "50-74": 0, "75-100": 0 };

  // Guided chat: gather completed thread data for summary and perTask aggregates
  const guidedTaskScores: Record<string, { scoreSum: number; scoreCount: number; correctCount: number; total: number }> = {};

  const perStudent: {
    student_id: string;
    submitted: boolean;
    final_score_total: number;
    max_score_total: number;
    hint_total: number;
    needs_attention: boolean;
    task_scores: { task_id: string; final_score: number; hint_count: number; has_override: boolean }[];
    total_score: number;
    total_max: number;
    total_time_minutes: number | null;
  }[] = [];

  // student_id → task_id → { final_score, hint_count, has_override }. Built
  // alongside the aggregate accumulator so the per_student heatmap cells and
  // the totals use the same computeFinalScore priority chain. Only submitted
  // students get an entry — not-submitted students receive `task_scores: []`.
  const taskScoresByStudent: Record<string, Record<string, { final_score: number; hint_count: number; has_override: boolean; ai_score: number | null }>> = {};

  const { data: studentAssignments } = await db
    .from("homework_tutor_student_assignments")
    .select("id, student_id")
    .eq("assignment_id", assignmentId);

  // Map student_assignment_id → student_id for joining threads → students.
  const studentBySa: Record<string, string> = {};
  for (const sa of studentAssignments ?? []) {
    studentBySa[sa.id] = sa.student_id;
  }

  if (studentAssignments && studentAssignments.length > 0) {
    const saIds = studentAssignments.map((sa) => sa.id);

    // ─── Fetch ALL threads (any status) for both score aggregation and time ──
    // Previously only completed threads were fetched, which caused in-progress
    // students to appear with empty scores in tutor results (Bug 2 fix).
    const { data: allThreads } = await db
      .from("homework_tutor_threads")
      .select("id, student_assignment_id, status")
      .in("student_assignment_id", saIds);

    // Split into completed (for submitted=true aggregates and summary stats)
    // and active (for partial progress display in heatmap).
    const completedThreadIds: string[] = [];
    const activeThreadIds: string[] = [];
    const threadStatusById: Record<string, string> = {};
    for (const t of allThreads ?? []) {
      threadStatusById[t.id] = t.status as string;
      if (t.status === "completed") {
        completedThreadIds.push(t.id);
      } else {
        activeThreadIds.push(t.id);
      }
    }

    // student_id → aggregate accumulator (built only for completed-thread students).
    const studentAcc: Record<string, { final: number; max: number; hints: number }> = {};
    // student_id → partial accumulator (built for active-thread students with partial progress).
    const activeStudentAcc: Record<string, { final: number; hints: number }> = {};

    const allThreadIdsForStates = [...completedThreadIds, ...activeThreadIds];

    if (allThreadIdsForStates.length > 0) {
      const { data: allTaskStates } = await db
        .from("homework_tutor_task_states")
        .select(
          "thread_id, task_id, earned_score, status, ai_score, tutor_score_override, hint_count, attempts",
        )
        .in("thread_id", allThreadIdsForStates);

      // Group task states by thread
      const statesByThread: Record<string, TaskStateScoreFields[]> = {};
      for (const ts of allTaskStates ?? []) {
        const row = ts as TaskStateScoreFields;
        if (!statesByThread[row.thread_id]) statesByThread[row.thread_id] = [];
        statesByThread[row.thread_id]!.push(row);
      }

      for (const thread of allThreads ?? []) {
        const states = statesByThread[thread.id] ?? [];
        const studentId = studentBySa[thread.student_assignment_id as string];
        const isCompleted = threadStatusById[thread.id] === "completed";

        let threadFinal = 0;
        let threadMaxTotal = 0;
        let threadHints = 0;

        for (const ts of states) {
          const taskInfo = taskMap[ts.task_id];
          const maxScore = taskInfo?.max_score ?? 1;

          // For active threads, skip task_states that the student hasn't
          // actually solved. provisionGuidedThread pre-creates ALL task_states
          // as status="active", so including them would produce false-zero red
          // cells in the heatmap and inflate aggregates.
          //
          // Product decision: "partial = only individually-completed tasks".
          // In-progress tasks (with intermediate ai_score / hint_count from
          // INCORRECT/ON_TRACK attempts) are excluded because earned_score is
          // still null and the outcome is undetermined. This means tutor-side
          // hint_total and score aggregates for in-progress students reflect
          // only their solved tasks, not ongoing interaction. If the product
          // later wants "partial = all current interaction", remove this guard
          // and handle the null-earned_score display on the frontend.
          const isTaskCompleted = ts.status === "completed";
          if (!isCompleted && !isTaskCompleted) continue;

          const finalScore = computeFinalScore(ts, maxScore);
          const hintCount = Number(ts.hint_count ?? 0);

          threadFinal += finalScore;
          threadMaxTotal += maxScore;
          threadHints += hintCount;

          // Per-cell scores for the heatmap. Keyed by (student_id, task_id),
          // last-write-wins if the same student somehow has multiple threads.
          // Built for BOTH completed and active threads so partial progress
          // renders colored cells in the heatmap. For active threads, only
          // individually-completed tasks appear — unsolved tasks stay null
          // (grey dash in the frontend).
          if (studentId && taskInfo) {
            if (!taskScoresByStudent[studentId]) {
              taskScoresByStudent[studentId] = {};
            }
            // Compute the score that would apply WITHOUT the tutor override,
            // so the edit dialog can show "AI: X/Y" even when an override exists.
            const scoreWithoutOverride =
              ts.ai_score != null ? Math.round(Number(ts.ai_score) * 100) / 100
              : ts.earned_score != null ? Math.round(Number(ts.earned_score) * 100) / 100
              : ts.status === "completed" ? maxScore
              : 0;

            taskScoresByStudent[studentId][ts.task_id] = {
              final_score: Math.round(finalScore * 100) / 100,
              hint_count: hintCount,
              has_override: ts.tutor_score_override != null,
              ai_score: scoreWithoutOverride,
            };
          }

          // Per-task aggregates — only count completed threads for summary stats
          // (avg_score, correct_rate) to keep them meaningful.
          if (taskInfo && isCompleted) {
            if (!guidedTaskScores[ts.task_id]) {
              guidedTaskScores[ts.task_id] = { scoreSum: 0, scoreCount: 0, correctCount: 0, total: 0 };
            }
            guidedTaskScores[ts.task_id].total++;
            if (ts.status === "completed") {
              guidedTaskScores[ts.task_id].scoreSum += finalScore;
              guidedTaskScores[ts.task_id].scoreCount++;
              if (finalScore > 0) {
                guidedTaskScores[ts.task_id].correctCount++;
              }
            }
          }
        }

        if (isCompleted) {
          // Summary stats: only completed threads count for avg_score / distribution.
          if (threadMaxTotal > 0) {
            const pct = (threadFinal / threadMaxTotal) * 100;
            totalScoreSum += pct;
            totalScoreCount++;

            if (pct < 25) distribution["0-24"]++;
            else if (pct < 50) distribution["25-49"]++;
            else if (pct < 75) distribution["50-74"]++;
            else distribution["75-100"]++;
          }

          if (studentId) {
            // Multiple completed threads per student should not happen, but if
            // they do, accumulate so we still return one entry per student.
            if (!studentAcc[studentId]) {
              studentAcc[studentId] = { final: 0, max: 0, hints: 0 };
            }
            studentAcc[studentId].final += threadFinal;
            studentAcc[studentId].max += threadMaxTotal;
            studentAcc[studentId].hints += threadHints;
          }
        } else if (studentId && !studentAcc[studentId]) {
          // Active thread — accumulate partial progress only if the student
          // does NOT already have a completed thread (completed takes priority).
          if (!activeStudentAcc[studentId]) {
            activeStudentAcc[studentId] = { final: 0, hints: 0 };
          }
          activeStudentAcc[studentId].final += threadFinal;
          activeStudentAcc[studentId].hints += threadHints;
        }
      }
    }

    // ─── Wall-clock time aggregation (homework-student-totals AC-9) ──────────
    // Reuses the already-fetched allThreads (any status) to populate
    // total_time_minutes for both submitted and in-progress students.
    const timeByStudent: Record<string, { first: string; last: string }> = {};
    const allThreadIds = (allThreads ?? []).map((t: { id: string }) => t.id);

    if (allThreadIds.length > 0) {
      const { data: msgRows } = await db
        .from("homework_tutor_thread_messages")
        .select("thread_id, created_at")
        .in("thread_id", allThreadIds);

      // thread_id → {first, last} (single pass over rows)
      const threadTimes: Record<string, { first: string; last: string }> = {};
      for (const m of msgRows ?? []) {
        const created = m.created_at as string;
        const t = threadTimes[m.thread_id as string];
        if (!t) {
          threadTimes[m.thread_id as string] = { first: created, last: created };
        } else {
          if (created < t.first) t.first = created;
          if (created > t.last) t.last = created;
        }
      }

      // thread_id → student_id (defensive accumulation if a student somehow
      // has multiple threads — DB invariant is UNIQUE(student_assignment_id),
      // but mirror the existing acc-pattern in this function).
      for (const th of allThreads ?? []) {
        const sid = studentBySa[th.student_assignment_id as string];
        if (!sid) continue;
        const tt = threadTimes[th.id as string];
        if (!tt) continue;
        const cur = timeByStudent[sid];
        if (!cur) {
          timeByStudent[sid] = { first: tt.first, last: tt.last };
        } else {
          if (tt.first < cur.first) cur.first = tt.first;
          if (tt.last > cur.last) cur.last = tt.last;
        }
      }
    }

    // total_max is stable across all students (Σ max_score over ALL tasks of
    // the assignment). Guard: empty assignment → 0/0 (frontend renders «—»).
    const totalMaxForAll = assignmentMaxScoreTotal;

    // Build per_student in the same order as student_assignments.
    // Three-way: completed thread → submitted:true, active thread →
    // submitted:false with partial data, no thread → submitted:false empty.
    for (const sa of studentAssignments) {
      const acc = studentAcc[sa.student_id];
      const activeAcc = activeStudentAcc[sa.student_id];
      const totalTimeMinutes = computeTotalMinutes(timeByStudent[sa.student_id]);

      // Heatmap cell data — shared between completed and active students.
      const cellMap = taskScoresByStudent[sa.student_id] ?? {};
      const taskScores = Object.entries(cellMap).map(([task_id, cell]) => ({
        task_id,
        final_score: cell.final_score,
        hint_count: cell.hint_count,
        has_override: cell.has_override,
        ai_score: cell.ai_score,
      }));

      if (acc) {
        // Completed thread: submitted=true, full aggregates.
        const lowScore = acc.max > 0 && acc.final < 0.3 * acc.max;
        const overuse = acc.hints >= hintOveruseThreshold;
        perStudent.push({
          student_id: sa.student_id,
          submitted: true,
          final_score_total: Math.round(acc.final * 100) / 100,
          max_score_total: acc.max,
          hint_total: acc.hints,
          needs_attention: lowScore || overuse,
          task_scores: taskScores,
          total_score: totalMaxForAll === 0 ? 0 : Math.round(acc.final * 100) / 100,
          total_max: totalMaxForAll,
          total_time_minutes: totalTimeMinutes,
        });
      } else if (activeAcc) {
        // Active thread with partial progress: submitted=false (frontend
        // derives in_progress from total_time_minutes !== null), but task_scores
        // and aggregates are populated so the heatmap and totals columns
        // show real partial data instead of blank dashes.
        const partialScore = Math.round(activeAcc.final * 100) / 100;
        perStudent.push({
          student_id: sa.student_id,
          submitted: false,
          final_score_total: partialScore,
          max_score_total: assignmentMaxScoreTotal,
          hint_total: activeAcc.hints,
          needs_attention: false,
          task_scores: taskScores,
          total_score: partialScore,
          total_max: totalMaxForAll,
          total_time_minutes: totalTimeMinutes,
        });
      } else {
        // No thread at all: not started.
        perStudent.push({
          student_id: sa.student_id,
          submitted: false,
          final_score_total: 0,
          max_score_total: assignmentMaxScoreTotal,
          hint_total: 0,
          needs_attention: false,
          task_scores: [],
          total_score: 0,
          total_max: totalMaxForAll,
          total_time_minutes: totalTimeMinutes,
        });
      }
    }
  }

  const summary = {
    avg_score: totalScoreCount > 0
      ? Math.round((totalScoreSum / totalScoreCount) * 100) / 100
      : null,
    distribution,
    common_error_types: [] as { type: string; count: number }[],
  };

  const perTask = (tasks ?? []).map((t) => {
    const guidedData = guidedTaskScores[t.id];
    const scoreSum = guidedData?.scoreSum ?? 0;
    const scoreCount = guidedData?.scoreCount ?? 0;
    const correctCount = guidedData?.correctCount ?? 0;
    const totalCount = guidedData?.total ?? 0;

    return {
      task_id: t.id,
      order_num: t.order_num,
      max_score: t.max_score,
      avg_score: scoreCount > 0 ? Math.round((scoreSum / scoreCount) * 100) / 100 : null,
      correct_rate: totalCount > 0
        ? Math.round((correctCount / totalCount) * 100 * 100) / 100
        : null,
      error_type_histogram: [] as { type: string; count: number }[],
    };
  });

  console.log("homework_api_request_success", {
    route: "GET /assignments/:id/results",
    tutor_id: tutorUserId,
    assignment_id: assignmentId,
  });

  return jsonOk(cors, { summary, per_task: perTask, per_student: perStudent });
}

// ─── Endpoint: PATCH /assignments/:id/students/:sid/tasks/:tid/score-override
// ─────────────────────────────────────────────────────────────────────────────
//
// Manual score override (Homework Results v2 P0-5 / AC-5). Tutor sets a score
// for a single (student, task) pair without touching ai_score / ai_score_comment.
// `final_score = COALESCE(tutor_score_override, ai_score)` is computed via the
// shared `computeFinalScore` helper — never duplicate the priority chain here.
//
// Reset = same handler with `tutor_score_override: null`.
async function handleSetTutorScoreOverride(
  db: SupabaseClient,
  tutorUserId: string,
  assignmentId: string,
  studentId: string,
  taskId: string,
  body: Record<string, unknown>,
  cors: Record<string, string>,
): Promise<Response> {
  if (!isUUID(assignmentId) || !isUUID(studentId) || !isUUID(taskId)) {
    return jsonError(cors, 400, "INVALID_ID", "Invalid id format");
  }

  const assignmentOrErr = await getOwnedAssignmentOrThrow(db, assignmentId, tutorUserId, cors);
  if (assignmentOrErr instanceof Response) return assignmentOrErr;

  // Validate task belongs to this assignment & get max_score for range check.
  const { data: task, error: taskErr } = await db
    .from("homework_tutor_tasks")
    .select("id, max_score, assignment_id")
    .eq("id", taskId)
    .maybeSingle();
  if (taskErr || !task || task.assignment_id !== assignmentId) {
    return jsonError(cors, 404, "TASK_NOT_FOUND", "Task not found");
  }
  const maxScore = Number(task.max_score ?? 0);

  // Validate body.
  const rawOverride = body?.tutor_score_override;
  let overrideValue: number | null;
  if (rawOverride === null) {
    overrideValue = null;
  } else if (typeof rawOverride === "number" && Number.isFinite(rawOverride)) {
    if (rawOverride < 0 || rawOverride > maxScore) {
      return jsonError(cors, 400, "VALIDATION", `tutor_score_override must be in [0, ${maxScore}]`);
    }
    if (Math.round(rawOverride * 2) !== rawOverride * 2) {
      return jsonError(cors, 400, "VALIDATION", "tutor_score_override must be a multiple of 0.5");
    }
    overrideValue = rawOverride;
  } else {
    return jsonError(cors, 400, "VALIDATION", "tutor_score_override must be a number or null");
  }

  let commentValue: string | null = null;
  const rawComment = body?.tutor_score_override_comment;
  if (overrideValue !== null && typeof rawComment === "string") {
    const trimmed = rawComment.trim();
    if (trimmed.length > 1000) {
      return jsonError(cors, 400, "VALIDATION", "comment too long (max 1000)");
    }
    commentValue = trimmed.length > 0 ? trimmed : null;
  }

  // Resolve thread for (assignment, student) → task_state row.
  const { data: sa, error: saErr } = await db
    .from("homework_tutor_student_assignments")
    .select("id")
    .eq("assignment_id", assignmentId)
    .eq("student_id", studentId)
    .maybeSingle();
  if (saErr || !sa) {
    return jsonError(cors, 404, "STUDENT_NOT_ASSIGNED", "Student not assigned");
  }

  const { data: thread, error: threadErr } = await db
    .from("homework_tutor_threads")
    .select("id")
    .eq("student_assignment_id", sa.id)
    .maybeSingle();
  if (threadErr || !thread) {
    return jsonError(cors, 404, "THREAD_NOT_FOUND", "Guided thread not found");
  }

  const { data: existing, error: tsErr } = await db
    .from("homework_tutor_task_states")
    .select("id, ai_score, tutor_score_override, earned_score, status, hint_count, attempts, thread_id, task_id")
    .eq("thread_id", thread.id)
    .eq("task_id", taskId)
    .maybeSingle();
  if (tsErr || !existing) {
    return jsonError(cors, 404, "TASK_STATE_NOT_FOUND", "Task state not found");
  }

  const updatePayload: Record<string, unknown> = overrideValue === null
    ? {
        tutor_score_override: null,
        tutor_score_override_comment: null,
        tutor_score_override_at: null,
        tutor_score_override_by: null,
      }
    : {
        tutor_score_override: overrideValue,
        tutor_score_override_comment: commentValue,
        tutor_score_override_at: new Date().toISOString(),
        tutor_score_override_by: tutorUserId,
      };

  const { data: updated, error: updErr } = await db
    .from("homework_tutor_task_states")
    .update(updatePayload)
    .eq("id", existing.id)
    .select("id, ai_score, tutor_score_override, tutor_score_override_comment, tutor_score_override_at, earned_score, status, hint_count, attempts, thread_id, task_id")
    .maybeSingle();
  if (updErr || !updated) {
    console.error("homework_api_request_error", { route: "PATCH score-override", error: updErr?.message });
    return jsonError(cors, 500, "DB_ERROR", "Failed to update task state");
  }

  const finalScore = computeFinalScore(updated as TaskStateScoreFields, maxScore);

  console.log("homework_api_request_success", {
    route: "PATCH /assignments/:id/students/:sid/tasks/:tid/score-override",
    tutor_id: tutorUserId,
    assignment_id: assignmentId,
    student_id: studentId,
    task_id: taskId,
    is_reset: overrideValue === null,
  });

  return jsonOk(cors, {
    ok: true,
    task_state: {
      id: updated.id,
      thread_id: updated.thread_id,
      task_id: updated.task_id,
      ai_score: updated.ai_score,
      tutor_score_override: updated.tutor_score_override,
      tutor_score_override_comment: updated.tutor_score_override_comment,
      tutor_score_override_at: updated.tutor_score_override_at,
      final_score: Math.round(finalScore * 100) / 100,
      max_score: maxScore,
    },
  });
}

// ─── Endpoint: GET /templates ────────────────────────────────────────────────

async function handleListTemplates(
  db: SupabaseClient,
  tutorUserId: string,
  searchParams: URLSearchParams,
  cors: Record<string, string>,
): Promise<Response> {
  const subject = searchParams.get("subject");
  if (subject && !(VALID_SUBJECTS_UPDATE as readonly string[]).includes(subject)) {
    return jsonError(cors, 400, "VALIDATION", `subject must be one of: ${VALID_SUBJECTS_UPDATE.join(", ")}`);
  }

  let query = db
    .from("homework_tutor_templates")
    .select("id, title, subject, topic, tags, created_at, tasks_json")
    .eq("tutor_id", tutorUserId)
    .order("created_at", { ascending: false });

  if (subject) {
    query = query.eq("subject", subject);
  }

  const { data, error } = await query;
  if (error) {
    console.error("homework_api_request_error", { route: "GET /templates", error: error.message });
    return jsonError(cors, 500, "DB_ERROR", "Failed to fetch templates");
  }

  const result = (data ?? []).map((t) => ({
    id: t.id,
    title: t.title,
    subject: t.subject,
    topic: t.topic,
    tags: t.tags,
    created_at: t.created_at,
    task_count: Array.isArray(t.tasks_json) ? t.tasks_json.length : 0,
  }));

  return jsonOk(cors, result);
}

// ─── Endpoint: POST /templates ───────────────────────────────────────────────

async function handleCreateTemplate(
  db: SupabaseClient,
  tutorUserId: string,
  body: unknown,
  cors: Record<string, string>,
): Promise<Response> {
  if (!body || typeof body !== "object") {
    return jsonError(cors, 400, "INVALID_BODY", "Request body must be a JSON object");
  }
  const b = body as Record<string, unknown>;

  if (!isNonEmptyString(b.title)) {
    return jsonError(cors, 400, "VALIDATION", "title is required");
  }
  if (!isNonEmptyString(b.subject) || !(VALID_SUBJECTS_CREATE as readonly string[]).includes(b.subject)) {
    return jsonError(cors, 400, "VALIDATION", `subject must be one of: ${VALID_SUBJECTS_CREATE.join(", ")}`);
  }
  if (!Array.isArray(b.tasks_json)) {
    return jsonError(cors, 400, "VALIDATION", "tasks_json must be an array");
  }

  const { data, error } = await db
    .from("homework_tutor_templates")
    .insert({
      tutor_id: tutorUserId,
      title: (b.title as string).trim(),
      subject: b.subject,
      topic: isNonEmptyString(b.topic) ? (b.topic as string).trim() : null,
      tags: Array.isArray(b.tags) ? b.tags.filter((t) => isString(t)) : [],
      tasks_json: b.tasks_json,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("homework_api_request_error", { route: "POST /templates", error: error?.message });
    return jsonError(cors, 500, "DB_ERROR", "Failed to create template");
  }

  return jsonOk(cors, { template_id: data.id }, 201);
}

// ─── Endpoint: GET /templates/:id ────────────────────────────────────────────

async function handleGetTemplate(
  db: SupabaseClient,
  tutorUserId: string,
  templateId: string,
  cors: Record<string, string>,
): Promise<Response> {
  if (!isUUID(templateId)) {
    return jsonError(cors, 400, "INVALID_ID", "Invalid template ID format");
  }

  const { data, error } = await db
    .from("homework_tutor_templates")
    .select("*")
    .eq("id", templateId)
    .maybeSingle();

  if (error || !data) {
    return jsonError(cors, 404, "NOT_FOUND", "Template not found");
  }
  if (data.tutor_id !== tutorUserId) {
    return jsonError(cors, 403, "FORBIDDEN", "Template does not belong to you");
  }

  return jsonOk(cors, data);
}

// ─── Endpoint: DELETE /templates/:id ─────────────────────────────────────────

async function handleDeleteTemplate(
  db: SupabaseClient,
  tutorUserId: string,
  templateId: string,
  cors: Record<string, string>,
): Promise<Response> {
  if (!isUUID(templateId)) {
    return jsonError(cors, 400, "INVALID_ID", "Invalid template ID format");
  }

  const { data: existing } = await db
    .from("homework_tutor_templates")
    .select("tutor_id")
    .eq("id", templateId)
    .maybeSingle();

  if (!existing) {
    return jsonError(cors, 404, "NOT_FOUND", "Template not found");
  }
  if (existing.tutor_id !== tutorUserId) {
    return jsonError(cors, 403, "FORBIDDEN", "Template does not belong to you");
  }

  const { error } = await db
    .from("homework_tutor_templates")
    .delete()
    .eq("id", templateId);

  if (error) {
    console.error("homework_api_request_error", { route: "DELETE /templates/:id", error: error.message });
    return jsonError(cors, 500, "DB_ERROR", "Failed to delete template");
  }

  return jsonOk(cors, { ok: true });
}

// ─── Endpoint: DELETE /assignments/:id ─────────────────────────────────────

async function handleDeleteAssignment(
  db: SupabaseClient,
  tutorUserId: string,
  assignmentId: string,
  cors: Record<string, string>,
): Promise<Response> {
  const assignmentOrErr = await getOwnedAssignmentOrThrow(db, assignmentId, tutorUserId, cors);
  if (assignmentOrErr instanceof Response) return assignmentOrErr;

  const { data: taskRows, error: taskRowsError } = await db
    .from("homework_tutor_tasks")
    .select("id")
    .eq("assignment_id", assignmentId);
  if (taskRowsError) {
    console.error("homework_api_request_error", { route: "DELETE /assignments/:id", error: taskRowsError.message });
    return jsonError(cors, 500, "DB_ERROR", "Failed to delete assignment");
  }
  const taskIds = (taskRows ?? []).map((row) => row.id);

  const { data: studentAssignmentRows, error: studentAssignmentRowsError } = await db
    .from("homework_tutor_student_assignments")
    .select("id")
    .eq("assignment_id", assignmentId);
  if (studentAssignmentRowsError) {
    console.error("homework_api_request_error", { route: "DELETE /assignments/:id", error: studentAssignmentRowsError.message });
    return jsonError(cors, 500, "DB_ERROR", "Failed to delete assignment");
  }
  const studentAssignmentIds = (studentAssignmentRows ?? []).map((row) => row.id);

  let threadIds: string[] = [];
  if (studentAssignmentIds.length > 0) {
    const { data: threadRows, error: threadRowsError } = await db
      .from("homework_tutor_threads")
      .select("id")
      .in("student_assignment_id", studentAssignmentIds);

    if (threadRowsError) {
      console.error("homework_api_request_error", { route: "DELETE /assignments/:id", error: threadRowsError.message });
      return jsonError(cors, 500, "DB_ERROR", "Failed to delete assignment");
    }

    threadIds = (threadRows ?? []).map((row) => row.id);
  }

  const deleteByAssignment = async (table: string) => {
    const { error } = await db.from(table).delete().eq("assignment_id", assignmentId);
    if (error) throw error;
  };

  try {
    if (threadIds.length > 0) {
      const { error: deleteThreadMessagesError } = await db
        .from("homework_tutor_thread_messages")
        .delete()
        .in("thread_id", threadIds);
      if (deleteThreadMessagesError) throw deleteThreadMessagesError;

      const { error: deleteTaskStatesByThreadError } = await db
        .from("homework_tutor_task_states")
        .delete()
        .in("thread_id", threadIds);
      if (deleteTaskStatesByThreadError) throw deleteTaskStatesByThreadError;
    }

    if (taskIds.length > 0) {
      const { error: deleteTaskStatesByTaskError } = await db
        .from("homework_tutor_task_states")
        .delete()
        .in("task_id", taskIds);
      if (deleteTaskStatesByTaskError) throw deleteTaskStatesByTaskError;
    }

    if (threadIds.length > 0) {
      const { error: deleteThreadsError } = await db
        .from("homework_tutor_threads")
        .delete()
        .in("id", threadIds);
      if (deleteThreadsError) throw deleteThreadsError;
    }

    await deleteByAssignment("homework_tutor_student_assignments");
    await deleteByAssignment("homework_tutor_materials");
    await deleteByAssignment("homework_tutor_reminder_log");
    await deleteByAssignment("homework_tutor_tasks");

    const { error } = await db
      .from("homework_tutor_assignments")
      .delete()
      .eq("id", assignmentId);

    if (error) {
      throw error;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("homework_api_request_error", { route: "DELETE /assignments/:id", error: message });
    return jsonError(cors, 500, "DB_ERROR", "Failed to delete assignment");
  }


  console.log("homework_api_request_success", {
    route: "DELETE /assignments/:id",
    tutor_id: tutorUserId,
    assignment_id: assignmentId,
  });
  return jsonOk(cors, { ok: true });
}

// ─── Endpoint: POST /assignments/:id/materials ───────────────────────────────

async function handleAddMaterial(
  db: SupabaseClient,
  tutorUserId: string,
  assignmentId: string,
  body: unknown,
  cors: Record<string, string>,
): Promise<Response> {
  const assignmentOrErr = await getOwnedAssignmentOrThrow(db, assignmentId, tutorUserId, cors);
  if (assignmentOrErr instanceof Response) return assignmentOrErr;

  if (!body || typeof body !== "object") {
    return jsonError(cors, 400, "INVALID_BODY", "Request body must be a JSON object");
  }
  const b = body as Record<string, unknown>;

  const validTypes = ["pdf", "image", "link"] as const;
  if (!isNonEmptyString(b.type) || !validTypes.includes(b.type as typeof validTypes[number])) {
    return jsonError(cors, 400, "VALIDATION", "type must be one of: pdf, image, link");
  }
  if (!isNonEmptyString(b.title)) {
    return jsonError(cors, 400, "VALIDATION", "title is required");
  }

  const materialType = b.type as string;
  if (materialType === "link" && !isNonEmptyString(b.url)) {
    return jsonError(cors, 400, "VALIDATION", "url is required for link type");
  }
  if ((materialType === "pdf" || materialType === "image") && !isNonEmptyString(b.storage_ref)) {
    return jsonError(cors, 400, "VALIDATION", "storage_ref is required for pdf/image type");
  }

  const { data, error } = await db
    .from("homework_tutor_materials")
    .insert({
      assignment_id: assignmentId,
      type: materialType,
      title: (b.title as string).trim(),
      storage_ref: isNonEmptyString(b.storage_ref) ? (b.storage_ref as string).trim() : null,
      url: isNonEmptyString(b.url) ? (b.url as string).trim() : null,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("homework_api_request_error", { route: "POST /assignments/:id/materials", error: error?.message });
    return jsonError(cors, 500, "DB_ERROR", "Failed to add material");
  }

  return jsonOk(cors, { material_id: data.id }, 201);
}

// ─── Endpoint: DELETE /assignments/:id/materials/:mid ────────────────────────

async function handleDeleteMaterial(
  db: SupabaseClient,
  tutorUserId: string,
  assignmentId: string,
  materialId: string,
  cors: Record<string, string>,
): Promise<Response> {
  const assignmentOrErr = await getOwnedAssignmentOrThrow(db, assignmentId, tutorUserId, cors);
  if (assignmentOrErr instanceof Response) return assignmentOrErr;

  if (!isUUID(materialId)) {
    return jsonError(cors, 400, "INVALID_ID", "Invalid material ID format");
  }

  const { data: existing } = await db
    .from("homework_tutor_materials")
    .select("id")
    .eq("id", materialId)
    .eq("assignment_id", assignmentId)
    .maybeSingle();

  if (!existing) {
    return jsonError(cors, 404, "NOT_FOUND", "Material not found");
  }

  const { error } = await db
    .from("homework_tutor_materials")
    .delete()
    .eq("id", materialId);

  if (error) {
    console.error("homework_api_request_error", { route: "DELETE /assignments/:id/materials/:mid", error: error.message });
    return jsonError(cors, 500, "DB_ERROR", "Failed to delete material");
  }

  return jsonOk(cors, { ok: true });
}

// ─── Endpoint: GET /assignments/:id/materials/:mid/signed-url ────────────────

async function handleMaterialSignedUrl(
  db: SupabaseClient,
  tutorUserId: string,
  assignmentId: string,
  materialId: string,
  cors: Record<string, string>,
): Promise<Response> {
  const assignmentOrErr = await getOwnedAssignmentOrThrow(db, assignmentId, tutorUserId, cors);
  if (assignmentOrErr instanceof Response) return assignmentOrErr;

  if (!isUUID(materialId)) {
    return jsonError(cors, 400, "INVALID_ID", "Invalid material ID format");
  }

  const { data: material } = await db
    .from("homework_tutor_materials")
    .select("id, type, storage_ref, url")
    .eq("id", materialId)
    .eq("assignment_id", assignmentId)
    .maybeSingle();

  if (!material) {
    return jsonError(cors, 404, "NOT_FOUND", "Material not found");
  }

  if (material.type === "link") {
    return jsonOk(cors, { url: material.url });
  }

  if (!material.storage_ref) {
    return jsonError(cors, 400, "NO_STORAGE_REF", "Material has no storage reference");
  }

  // Parse storage://bucket/objectPath
  const storageRef = material.storage_ref as string;
  let bucket: string;
  let objectPath: string;

  if (storageRef.startsWith("storage://")) {
    const rest = storageRef.slice("storage://".length);
    const slashIdx = rest.indexOf("/");
    if (slashIdx < 0) {
      return jsonError(cors, 500, "INVALID_STORAGE_REF", "Cannot parse storage reference");
    }
    bucket = rest.slice(0, slashIdx);
    objectPath = rest.slice(slashIdx + 1);
  } else {
    bucket = "homework-materials";
    objectPath = storageRef;
  }

  const { data: signedData, error: signedErr } = await db.storage
    .from(bucket)
    .createSignedUrl(objectPath, 3600);

  if (signedErr || !signedData?.signedUrl) {
    console.error("homework_api_request_error", { route: "GET /materials/signed-url", error: signedErr?.message });
    return jsonError(cors, 500, "STORAGE_ERROR", "Failed to generate signed URL");
  }

  return jsonOk(cors, { url: signedData.signedUrl });
}

function parseStorageRef(
  value: string | null | undefined,
  defaultBucket: string,
): { bucket: string; objectPath: string } | null {
  if (!isNonEmptyString(value)) return null;
  const trimmed = value.trim();

  if (trimmed.startsWith("storage://")) {
    const rest = trimmed.slice("storage://".length);
    const slashIdx = rest.indexOf("/");
    if (slashIdx <= 0 || slashIdx === rest.length - 1) {
      return null;
    }
    const objectPath = rest.slice(slashIdx + 1).replace(/^\/+/, "");
    if (!objectPath || hasUnsafeObjectPath(objectPath)) {
      return null;
    }
    return {
      bucket: rest.slice(0, slashIdx),
      objectPath,
    };
  }

  if (hasUnsafeObjectPath(trimmed)) {
    return null;
  }

  return {
    bucket: defaultBucket,
    objectPath: trimmed.replace(/^\/+/, ""),
  };
}

function isValidStudentThreadAttachmentRef(
  storageRef: string,
  userId: string,
  assignmentId: string,
): boolean {
  if (!storageRef.trim().startsWith("storage://")) {
    return false;
  }

  const parsed = parseStorageRef(storageRef, "homework-submissions");
  if (!parsed?.bucket || !parsed.objectPath) {
    return false;
  }

  if (!THREAD_ATTACHMENT_BUCKETS.has(parsed.bucket)) {
    return false;
  }

  if (hasUnsafeObjectPath(parsed.objectPath)) {
    return false;
  }

  const extension = getThreadAttachmentExtension(storageRef);
  if (!THREAD_ATTACHMENT_EXTENSIONS.has(extension)) {
    return false;
  }

  return parsed.objectPath.startsWith(`${userId}/${assignmentId}/threads/`);
}

function extractStudentThreadAttachmentRefs(
  body: Record<string, unknown>,
  userId: string,
  assignmentId: string,
  cors: Record<string, string>,
): string[] | Response {
  let refs: string[] = [];

  if (Array.isArray(body.image_urls) && body.image_urls.length > 0) {
    if (!body.image_urls.every((item) => typeof item === "string")) {
      return jsonError(cors, 400, "INVALID_ATTACHMENT_REF", "image_urls must be an array of strings");
    }
    refs = normalizeThreadAttachmentRefs(body.image_urls as string[]);
  } else {
    refs = parseStoredThreadAttachmentRefs(body.image_url);
  }

  if (refs.length > MAX_THREAD_ATTACHMENTS) {
    return jsonError(
      cors,
      400,
      "TOO_MANY_ATTACHMENTS",
      `Maximum ${MAX_THREAD_ATTACHMENTS} attachments are allowed`,
    );
  }

  for (const ref of refs) {
    if (!isValidStudentThreadAttachmentRef(ref, userId, assignmentId)) {
      return jsonError(cors, 400, "INVALID_ATTACHMENT_REF", "Invalid attachment reference");
    }
  }

  return refs;
}

async function createSignedStorageUrl(
  db: SupabaseClient,
  storageRef: string | null | undefined,
  defaultBucket: string,
): Promise<string | null> {
  const parsed = parseStorageRef(storageRef, defaultBucket);
  if (!parsed?.bucket || !parsed.objectPath) {
    return null;
  }

  const { data, error } = await db.storage
    .from(parsed.bucket)
    .createSignedUrl(parsed.objectPath, 3600);

  if (error || !data?.signedUrl) {
    console.error("homework_api_signed_url_failed", {
      bucket: parsed.bucket,
      objectPath: parsed.objectPath,
      error: error?.message,
    });
    return null;
  }

  return data.signedUrl;
}

async function getReadableAssignmentOrThrow(
  db: SupabaseClient,
  assignmentId: string,
  userId: string,
  cors: Record<string, string>,
): Promise<{ id: string; tutor_id: string } | Response> {
  if (!isUUID(assignmentId)) {
    return jsonError(cors, 400, "INVALID_ID", "Invalid assignment ID format");
  }

  const { data: assignment } = await db
    .from("homework_tutor_assignments")
    .select("id, tutor_id")
    .eq("id", assignmentId)
    .maybeSingle();

  if (!assignment) {
    return jsonError(cors, 404, "NOT_FOUND", "Assignment not found");
  }

  if (assignment.tutor_id === userId) {
    return assignment;
  }

  const { data: studentAssignment } = await db
    .from("homework_tutor_student_assignments")
    .select("id")
    .eq("assignment_id", assignmentId)
    .eq("student_id", userId)
    .maybeSingle();

  if (!studentAssignment) {
    return jsonError(cors, 403, "FORBIDDEN", "Not authorized to access this assignment");
  }

  return assignment;
}

async function createSignedStorageUrls(
  db: SupabaseClient,
  refs: string[],
  defaultBucket: string,
): Promise<string[]> {
  const signedUrls = await Promise.all(
    refs.map((ref) => createSignedStorageUrl(db, ref, defaultBucket)),
  );
  return signedUrls.filter((value): value is string => Boolean(value));
}

interface GuidedTaskIdentityRow {
  id: string;
  order_num: number;
  max_score?: number | null;
}

function resolveTaskReference(
  tasks: GuidedTaskIdentityRow[],
  options: {
    taskId?: string | null;
    taskOrder?: number | null;
    fallbackTaskId?: string | null;
    fallbackTaskOrder?: number | null;
  },
): GuidedTaskIdentityRow | null {
  const orderedCandidates = [
    options.taskId && isUUID(options.taskId) ? tasks.find((task) => task.id === options.taskId) ?? null : null,
    typeof options.taskOrder === "number" ? tasks.find((task) => task.order_num === options.taskOrder) ?? null : null,
    options.fallbackTaskId && isUUID(options.fallbackTaskId)
      ? tasks.find((task) => task.id === options.fallbackTaskId) ?? null
      : null,
    typeof options.fallbackTaskOrder === "number"
      ? tasks.find((task) => task.order_num === options.fallbackTaskOrder) ?? null
      : null,
  ];

  return orderedCandidates.find((task): task is GuidedTaskIdentityRow => Boolean(task)) ?? null;
}

async function syncThreadCursorOrdersForAssignment(
  db: SupabaseClient,
  assignmentId: string,
): Promise<void> {
  const { data: studentAssignments, error: saErr } = await db
    .from("homework_tutor_student_assignments")
    .select("id")
    .eq("assignment_id", assignmentId);
  if (saErr || !studentAssignments || studentAssignments.length === 0) return;

  const studentAssignmentIds = studentAssignments.map((row) => row.id as string);
  const { data: threads, error: threadErr } = await db
    .from("homework_tutor_threads")
    .select("id, current_task_id, current_task_order")
    .in("student_assignment_id", studentAssignmentIds)
    .not("current_task_id", "is", null);
  if (threadErr || !threads || threads.length === 0) return;

  const { data: tasks, error: taskErr } = await db
    .from("homework_tutor_tasks")
    .select("id, order_num")
    .eq("assignment_id", assignmentId);
  if (taskErr || !tasks) return;

  const orderByTaskId = new Map(tasks.map((task) => [task.id as string, task.order_num as number]));
  for (const thread of threads) {
    const taskId = thread.current_task_id as string | null;
    if (!taskId) continue;
    const nextOrder = orderByTaskId.get(taskId);
    if (typeof nextOrder !== "number" || nextOrder === thread.current_task_order) continue;

    await db
      .from("homework_tutor_threads")
      .update({
        current_task_order: nextOrder,
        updated_at: new Date().toISOString(),
      })
      .eq("id", thread.id);
  }
}

async function loadLatestStudentImageUrlsForTask(
  db: SupabaseClient,
  threadId: string,
  taskOrder: number,
  taskId: string,
  userId: string,
  assignmentId: string,
): Promise<string[]> {
  const { data: latestMsg, error } = await db
    .from("homework_tutor_thread_messages")
    .select("image_url")
    .eq("thread_id", threadId)
    .eq("role", "user")
    .eq("task_id", taskId)
    .not("image_url", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("homework_api_latest_student_image_failed", {
      threadId,
      taskOrder,
      error: error.message,
    });
    return [];
  }

  const imageRefs = parseStoredThreadAttachmentRefs(latestMsg?.image_url)
    .filter(isImageThreadAttachmentRef)
    .filter((ref) => isValidStudentThreadAttachmentRef(ref, userId, assignmentId));

  if (imageRefs.length === 0) return [];

  const signedUrls = await Promise.all(imageRefs.map(async (imageRef) => {
    if (imageRef.startsWith("http://")) {
      console.warn("homework_api_latest_student_image_rejected", {
        reason: "non_https_url",
        threadId,
        taskOrder,
      });
      return null;
    }
    if (imageRef.startsWith("https://")) {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const isAllowedSignedUrl = Boolean(
        supabaseUrl &&
        imageRef.startsWith(`${supabaseUrl}/storage/v1/object/sign/`),
      );
      if (isAllowedSignedUrl) {
        return imageRef;
      }
      console.warn("homework_api_latest_student_image_rejected", {
        reason: "external_https_url",
        threadId,
        taskOrder,
      });
      return null;
    }

    return await createSignedStorageUrl(db, imageRef, "homework-submissions");
  }));

  return signedUrls.filter((value): value is string => Boolean(value));
}

// ─── Helper: resolve task image URL to an AI-compatible data URL ─────────────

/** Convert ArrayBuffer to base64 string in chunks to avoid stack overflow on large images. */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x8000; // 32 KB chunks
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(binary);
}

/** Max image size (5 MB raw ≈ 6.7 MB base64) to stay within gateway body limits. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Converts a task_image_url (storage:// or plain storage path)
 * into a base64 data URL that the Lovable AI Gateway can use directly.
 *
 * The Lovable gateway (proxying Gemini) does NOT fetch external HTTP URLs —
 * images must be inlined as `data:image/...;base64,...`.
 *
 * SECURITY: External HTTP(S) URLs are rejected to prevent SSRF.
 * task_image_url must always be a storage:// ref or plain storage path.
 *
 * Returns null if the image ref is empty, external, or download fails.
 */
async function resolveTaskImageUrlForAI(
  db: SupabaseClient,
  imageRef: string | null | undefined,
): Promise<string | null> {
  if (!imageRef) return null;

  // SECURITY: reject external URLs to prevent SSRF — task images must live in storage
  if (imageRef.startsWith("http://") || imageRef.startsWith("https://")) {
    console.error("resolveTaskImageUrlForAI: external URLs not allowed (SSRF prevention)", {
      imageRef: imageRef.slice(0, 120),
    });
    return null;
  }

  // Parse storage://bucket/objectPath or plain path
  let bucket: string;
  let objectPath: string;

  if (imageRef.startsWith("storage://")) {
    const rest = imageRef.slice("storage://".length);
    const slashIdx = rest.indexOf("/");
    if (slashIdx < 0) {
      console.error("resolveTaskImageUrlForAI: cannot parse storage ref", { imageRef });
      return null;
    }
    bucket = rest.slice(0, slashIdx);
    objectPath = rest.slice(slashIdx + 1);
  } else {
    bucket = "homework-task-images";
    objectPath = imageRef;
  }

  // Download directly from Supabase storage (service_role client — no signed URL needed)
  const { data: blob, error: dlErr } = await db.storage
    .from(bucket)
    .download(objectPath);

  if (dlErr || !blob) {
    console.error("resolveTaskImageUrlForAI: failed to download", {
      bucket,
      objectPath,
      error: dlErr?.message,
    });
    return null;
  }

  const buf = await blob.arrayBuffer();
  if (buf.byteLength > MAX_IMAGE_BYTES) {
    console.error("resolveTaskImageUrlForAI: image too large", {
      bucket,
      objectPath,
      bytes: buf.byteLength,
      maxBytes: MAX_IMAGE_BYTES,
    });
    return null;
  }

  const mime = blob.type || "image/jpeg";
  return `data:${mime};base64,${arrayBufferToBase64(buf)}`;
}

async function resolveTaskImageUrlsForAI(
  db: SupabaseClient,
  imageRefsValue: string | null | undefined,
): Promise<string[]> {
  const imageRefs = parseAttachmentUrls(imageRefsValue);
  if (imageRefs.length === 0) return [];

  const resolvedUrls = await Promise.all(
    imageRefs.map((imageRef) => resolveTaskImageUrlForAI(db, imageRef)),
  );

  return resolvedUrls.filter((value): value is string => Boolean(value));
}

/**
 * Resolve a tutor-curated display name for the student behind a given
 * `homework_tutor_student_assignments.id`. Used to inject the student's
 * name into AI prompts so the model uses the correct Russian gender form.
 *
 * Resolution order:
 *   1. tutor_students.display_name (tutor-owned override for the student)
 *   2. profiles.username (the login-visible display name)
 *   3. null — when only an auto-generated placeholder like
 *      "telegram_776836955" or "user_123" is available (AI should fall
 *      back to gender-neutral forms instead of addressing the student by
 *      a machine-generated id).
 *
 * All queries use the `SupabaseClient` passed in (service_role inside the
 * edge function), so RLS is bypassed for the lookup.
 */
async function resolveStudentDisplayName(
  db: SupabaseClient,
  studentAssignmentId: string,
): Promise<string | null> {
  try {
    const { data: sa } = await db
      .from("homework_tutor_student_assignments")
      .select("student_id, assignment_id")
      .eq("id", studentAssignmentId)
      .maybeSingle();
    const studentId = sa?.student_id as string | undefined;
    const assignmentId = sa?.assignment_id as string | undefined;
    if (!studentId || !assignmentId) return null;

    const { data: assn } = await db
      .from("homework_tutor_assignments")
      .select("tutor_id")
      .eq("id", assignmentId)
      .maybeSingle();
    const tutorId = assn?.tutor_id as string | undefined;

    // Primary: tutor-curated display name
    if (tutorId) {
      const { data: ts } = await db
        .from("tutor_students")
        .select("display_name")
        .eq("tutor_id", tutorId)
        .eq("student_id", studentId)
        .maybeSingle();
      const curated = typeof ts?.display_name === "string" ? ts.display_name.trim() : "";
      if (curated) return curated;
    }

    // Fallback: profiles.username, unless it's an auto-generated placeholder
    const { data: prof } = await db
      .from("profiles")
      .select("username")
      .eq("id", studentId)
      .maybeSingle();
    const username = typeof prof?.username === "string" ? prof.username.trim() : "";
    if (!username) return null;
    if (/^(telegram_|user_)\d+$/i.test(username)) return null;
    return username;
  } catch (err) {
    // Non-fatal: AI should still work without a name.
    console.warn("resolve_student_display_name_failed", {
      studentAssignmentId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function ensureTaskOcrText(
  _db: SupabaseClient,
  task: { id: string; task_image_url: string | null; ocr_text?: string | null },
  _subject: string | null | undefined,
): Promise<string | null> {
  if (typeof task.ocr_text === "string" && task.ocr_text.trim() && task.ocr_text !== "[неразборчиво]") {
    return task.ocr_text.trim();
  }

  // OCR recognition path was removed with the classic-mode vision_checker.
  // Guided check/hint will fall back to the task image without OCR text.
  return null;
}

// ─── Endpoint: GET /assignments/:id/tasks/:taskId/image-url ──────────────────

async function handleTaskImageSignedUrl(
  db: SupabaseClient,
  userId: string,
  assignmentId: string,
  taskId: string,
  cors: Record<string, string>,
): Promise<Response> {
  if (!isUUID(taskId)) {
    return jsonError(cors, 400, "INVALID_ID", "Invalid task ID format");
  }

  const assignmentOrErr = await getReadableAssignmentOrThrow(db, assignmentId, userId, cors);
  if (assignmentOrErr instanceof Response) return assignmentOrErr;

  // Get task image URL
  const { data: task } = await db
    .from("homework_tutor_tasks")
    .select("id, task_image_url")
    .eq("id", taskId)
    .eq("assignment_id", assignmentId)
    .maybeSingle();

  if (!task) {
    return jsonError(cors, 404, "NOT_FOUND", "Task not found");
  }

  if (!task.task_image_url) {
    return jsonError(cors, 400, "NO_IMAGE", "Task has no image");
  }

  const imageRef = task.task_image_url as string;

  // External URL — return as-is
  if (imageRef.startsWith("http://") || imageRef.startsWith("https://")) {
    return jsonOk(cors, { url: imageRef });
  }

  // Parse storage://bucket/objectPath
  let bucket: string;
  let objectPath: string;

  if (imageRef.startsWith("storage://")) {
    const rest = imageRef.slice("storage://".length);
    const slashIdx = rest.indexOf("/");
    if (slashIdx < 0) {
      return jsonError(cors, 500, "INVALID_STORAGE_REF", "Cannot parse storage reference");
    }
    bucket = rest.slice(0, slashIdx);
    objectPath = rest.slice(slashIdx + 1);
  } else {
    bucket = "homework-task-images";
    objectPath = imageRef;
  }

  const { data: signedData, error: signedErr } = await db.storage
    .from(bucket)
    .createSignedUrl(objectPath, 3600);

  if (signedErr || !signedData?.signedUrl) {
    console.error("homework_api_request_error", { route: "GET /tasks/image-url", error: signedErr?.message });
    return jsonError(cors, 500, "STORAGE_ERROR", "Failed to generate signed URL");
  }

  return jsonOk(cors, { url: signedData.signedUrl });
}

async function handleTaskImagesSignedUrls(
  db: SupabaseClient,
  userId: string,
  assignmentId: string,
  taskId: string,
  cors: Record<string, string>,
): Promise<Response> {
  if (!isUUID(taskId)) {
    return jsonError(cors, 400, "INVALID_ID", "Invalid task ID format");
  }

  const assignmentOrErr = await getReadableAssignmentOrThrow(db, assignmentId, userId, cors);
  if (assignmentOrErr instanceof Response) return assignmentOrErr;

  const { data: task } = await db
    .from("homework_tutor_tasks")
    .select("id, task_image_url")
    .eq("id", taskId)
    .eq("assignment_id", assignmentId)
    .maybeSingle();

  if (!task) {
    return jsonError(cors, 404, "NOT_FOUND", "Task not found");
  }

  const refs = parseAttachmentUrls(task.task_image_url);
  if (refs.length === 0) {
    console.log("homework_api_request_success", {
      route: "GET /assignments/:id/tasks/:taskId/images",
      user_id: userId,
      assignment_id: assignmentId,
      task_id: taskId,
      signed_url_count: 0,
    });
    return jsonOk(cors, { signed_urls: [] });
  }

  const signedUrls = await createSignedStorageUrls(db, refs, "homework-task-images");

  console.log("homework_api_request_success", {
    route: "GET /assignments/:id/tasks/:taskId/images",
    user_id: userId,
    assignment_id: assignmentId,
    task_id: taskId,
    signed_url_count: signedUrls.length,
  });
  return jsonOk(cors, { signed_urls: signedUrls });
}

async function handleRubricImagesSignedUrls(
  db: SupabaseClient,
  tutorUserId: string,
  assignmentId: string,
  taskId: string,
  cors: Record<string, string>,
): Promise<Response> {
  if (!isUUID(taskId)) {
    return jsonError(cors, 400, "INVALID_ID", "Invalid task ID format");
  }

  const assignmentOrErr = await getOwnedAssignmentOrThrow(db, assignmentId, tutorUserId, cors);
  if (assignmentOrErr instanceof Response) return assignmentOrErr;

  const { data: task } = await db
    .from("homework_tutor_tasks")
    .select("id, rubric_image_urls")
    .eq("id", taskId)
    .eq("assignment_id", assignmentId)
    .maybeSingle();

  if (!task) {
    return jsonError(cors, 404, "NOT_FOUND", "Task not found");
  }

  const refs = parseAttachmentUrls(task.rubric_image_urls);
  if (refs.length === 0) {
    console.log("homework_api_request_success", {
      route: "GET /assignments/:id/tasks/:taskId/rubric-images",
      tutor_id: tutorUserId,
      assignment_id: assignmentId,
      task_id: taskId,
      signed_url_count: 0,
    });
    return jsonOk(cors, { signed_urls: [] });
  }

  const signedUrls = await createSignedStorageUrls(db, refs, "homework-task-images");

  console.log("homework_api_request_success", {
    route: "GET /assignments/:id/tasks/:taskId/rubric-images",
    tutor_id: tutorUserId,
    assignment_id: assignmentId,
    task_id: taskId,
    signed_url_count: signedUrls.length,
  });
  return jsonOk(cors, { signed_urls: signedUrls });
}

// ─── Formula round endpoints (student) ──────────────────────────────────────

interface FormulaRoundRecord {
  id: string;
  assignment_id: string;
  section: string;
  formula_count: number;
  questions_per_round: number;
  lives: number;
  created_at: string;
}

async function verifyFormulaRoundOwnership(
  db: SupabaseClient,
  roundId: string,
  userId: string,
  cors: Record<string, string>,
): Promise<FormulaRoundRecord | Response> {
  if (!isUUID(roundId)) {
    return jsonError(cors, 400, "INVALID_ID", "Invalid formula round ID format");
  }

  const { data: round, error: roundError } = await db
    .from("formula_rounds")
    .select("id, assignment_id, section, formula_count, questions_per_round, lives, created_at")
    .eq("id", roundId)
    .maybeSingle();

  if (roundError) {
    console.error("homework_api_request_error", {
      route: "formula-rounds:verify",
      round_id: roundId,
      error: roundError.message,
    });
    return jsonError(cors, 500, "DB_ERROR", "Failed to load formula round");
  }

  if (!round) {
    return jsonError(cors, 404, "NOT_FOUND", "Formula round not found");
  }

  const { data: studentAssignment, error: assignmentError } = await db
    .from("homework_tutor_student_assignments")
    .select("id")
    .eq("assignment_id", round.assignment_id)
    .eq("student_id", userId)
    .maybeSingle();

  if (assignmentError) {
    console.error("homework_api_request_error", {
      route: "formula-rounds:verify",
      round_id: roundId,
      error: assignmentError.message,
    });
    return jsonError(cors, 500, "DB_ERROR", "Failed to verify formula round access");
  }

  if (!studentAssignment) {
    return jsonError(cors, 403, "FORBIDDEN", "Not authorized to access this formula round");
  }

  return round as FormulaRoundRecord;
}

async function handleGetFormulaRound(
  db: SupabaseClient,
  userId: string,
  roundId: string,
  cors: Record<string, string>,
): Promise<Response> {
  const round = await verifyFormulaRoundOwnership(db, roundId, userId, cors);
  if (round instanceof Response) return round;

  return jsonOk(cors, round);
}

async function handleListFormulaRoundResults(
  db: SupabaseClient,
  userId: string,
  roundId: string,
  cors: Record<string, string>,
): Promise<Response> {
  const round = await verifyFormulaRoundOwnership(db, roundId, userId, cors);
  if (round instanceof Response) return round;

  const { data: results, error } = await db
    .from("formula_round_results")
    .select("id, round_id, student_id, score, total, lives_remaining, completed, duration_seconds, answers, weak_formulas, created_at")
    .eq("round_id", round.id)
    .eq("student_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("homework_api_request_error", {
      route: "GET /formula-rounds/:roundId/results",
      round_id: roundId,
      user_id: userId,
      error: error.message,
    });
    return jsonError(cors, 500, "DB_ERROR", "Failed to load formula round results");
  }

  return jsonOk(cors, results ?? []);
}

async function handleCreateFormulaRoundResult(
  db: SupabaseClient,
  userId: string,
  roundId: string,
  body: unknown,
  cors: Record<string, string>,
): Promise<Response> {
  const round = await verifyFormulaRoundOwnership(db, roundId, userId, cors);
  if (round instanceof Response) return round;

  if (!body || typeof body !== "object") {
    return jsonError(cors, 400, "INVALID_BODY", "Request body must be a JSON object");
  }

  const payload = body as Record<string, unknown>;
  const score = payload.score;
  const total = payload.total;
  const livesRemaining = payload.livesRemaining ?? payload.lives_remaining;
  const completed = payload.completed;
  const durationSeconds = payload.durationSeconds ?? payload.duration_seconds;
  const answers = payload.answers;
  const weakFormulas = payload.weakFormulas ?? payload.weak_formulas ?? [];

  if (!isNonNegativeInt(score)) {
    return jsonError(cors, 400, "VALIDATION", "score must be a non-negative integer");
  }
  if (!isPositiveInt(total)) {
    return jsonError(cors, 400, "VALIDATION", "total must be a positive integer");
  }
  if (!isNonNegativeInt(livesRemaining)) {
    return jsonError(cors, 400, "VALIDATION", "livesRemaining must be a non-negative integer");
  }
  if (!isBoolean(completed)) {
    return jsonError(cors, 400, "VALIDATION", "completed must be a boolean");
  }
  if (durationSeconds !== undefined && durationSeconds !== null && !isNonNegativeInt(durationSeconds)) {
    return jsonError(cors, 400, "VALIDATION", "durationSeconds must be a non-negative integer or null");
  }
  if (!Array.isArray(answers)) {
    return jsonError(cors, 400, "VALIDATION", "answers must be an array");
  }
  if (!Array.isArray(weakFormulas)) {
    return jsonError(cors, 400, "VALIDATION", "weakFormulas must be an array");
  }
  if (score > total) {
    return jsonError(cors, 400, "VALIDATION", "score cannot exceed total");
  }
  if (livesRemaining > round.lives) {
    return jsonError(cors, 400, "VALIDATION", "livesRemaining cannot exceed round lives");
  }

  const { data: savedResult, error } = await db
    .from("formula_round_results")
    .insert({
      round_id: round.id,
      student_id: userId,
      score,
      total,
      lives_remaining: livesRemaining,
      completed,
      duration_seconds: durationSeconds ?? null,
      answers,
      weak_formulas: weakFormulas,
    })
    .select("id, created_at")
    .single();

  if (error || !savedResult) {
    console.error("homework_api_request_error", {
      route: "POST /formula-rounds/:roundId/results",
      round_id: roundId,
      user_id: userId,
      error: error?.message,
    });
    return jsonError(cors, 500, "DB_ERROR", "Failed to save formula round result");
  }

  console.log("homework_api_request_success", {
    route: "POST /formula-rounds/:roundId/results",
    round_id: roundId,
    user_id: userId,
    result_id: savedResult.id,
  });

  return jsonOk(cors, savedResult, 201);
}

// ─── Endpoint: GET /threads/:id (student) ────────────────────────────────────

async function handleGetThread(
  db: SupabaseClient,
  userId: string,
  threadId: string,
  cors: Record<string, string>,
): Promise<Response> {
  if (!isUUID(threadId)) {
    return jsonError(cors, 400, "VALIDATION", "Invalid thread ID");
  }

  const { data: thread, error } = await db
    .from("homework_tutor_threads")
    .select(THREAD_SELECT)
    .eq("id", threadId)
    .order("created_at", { referencedTable: "homework_tutor_thread_messages", ascending: true })
    .single();

  if (error || !thread) {
    return jsonError(cors, 404, "NOT_FOUND", "Thread not found");
  }

  // Verify ownership: student must own this thread
  const { data: sa } = await db
    .from("homework_tutor_student_assignments")
    .select("student_id, assignment_id")
    .eq("id", thread.student_assignment_id)
    .single();

  if (!sa || sa.student_id !== userId) {
    return jsonError(cors, 403, "FORBIDDEN", "Not your thread");
  }

  const { data: tasks, error: tasksError } = await db
    .from("homework_tutor_tasks")
    .select("id, order_num, task_text, task_image_url, max_score, check_format")
    .eq("assignment_id", sa.assignment_id)
    .order("order_num", { ascending: true });

  if (tasksError) {
    return jsonError(cors, 500, "DB_ERROR", "Failed to load tasks for thread");
  }

  // Filter out hidden tutor notes (service-role bypasses RLS)
  return jsonOk(cors, {
    ...stripStudentSensitiveTaskStateFields(
      stripHiddenMessages(thread as Record<string, unknown>),
    ),
    tasks: tasks ?? [],
  });
}

// ─── Endpoint: GET /assignments/:id/student (student) ────────────────────────

async function handleGetStudentAssignment(
  db: SupabaseClient,
  userId: string,
  assignmentId: string,
  cors: Record<string, string>,
): Promise<Response> {
  if (!isUUID(assignmentId)) {
    return jsonError(cors, 400, "VALIDATION", "Invalid assignment ID");
  }

  const { data: assigned, error: assignedError } = await db
    .from("homework_tutor_student_assignments")
    .select("assignment_id")
    .eq("assignment_id", assignmentId)
    .eq("student_id", userId)
    .maybeSingle();

  if (assignedError) {
    return jsonError(cors, 500, "DB_ERROR", "Failed to verify student assignment");
  }
  if (!assigned) {
    return jsonError(cors, 404, "NOT_FOUND", "Assignment not found");
  }

  const { data: assignment, error: assignmentError } = await db
    .from("homework_tutor_assignments")
    .select("id, title, subject, topic, description, deadline, status, disable_ai_bootstrap, exam_type, created_at")
    .eq("id", assignmentId)
    .single();

  if (assignmentError || !assignment) {
    return jsonError(cors, 404, "NOT_FOUND", "Assignment not found");
  }

  const { data: tasks, error: tasksError } = await db
    .from("homework_tutor_tasks")
    .select("id, assignment_id, order_num, task_text, task_image_url, max_score, check_format")
    .eq("assignment_id", assignmentId)
    .order("order_num", { ascending: true });

  if (tasksError) {
    return jsonError(cors, 500, "DB_ERROR", "Failed to load tasks");
  }

  const { data: materials, error: materialsError } = await db
    .from("homework_tutor_materials")
    .select("id, assignment_id, type, title, storage_ref, url, created_at")
    .eq("assignment_id", assignmentId)
    .order("created_at", { ascending: true });

  if (materialsError) {
    return jsonError(cors, 500, "DB_ERROR", "Failed to load materials");
  }

  return jsonOk(cors, {
    ...assignment,
    updated_at: assignment.created_at,
    tasks: tasks ?? [],
    materials: materials ?? [],
  });
}

// ─── Endpoint: POST /threads/:id/messages (student) ─────────────────────────

async function verifyThreadOwnership(
  db: SupabaseClient,
  threadId: string,
  userId: string,
  cors: Record<string, string>,
): Promise<{
  thread: Record<string, unknown>;
  studentAssignment: { id: string; assignment_id: string; student_id: string };
} | Response> {
  if (!isUUID(threadId)) {
    return jsonError(cors, 400, "VALIDATION", "Invalid thread ID");
  }

  const { data: thread, error } = await db
    .from("homework_tutor_threads")
    .select("id, status, current_task_order, student_assignment_id")
    .eq("id", threadId)
    .single();

  if (error || !thread) {
    return jsonError(cors, 404, "NOT_FOUND", "Thread not found");
  }

  const { data: sa } = await db
    .from("homework_tutor_student_assignments")
    .select("id, assignment_id, student_id")
    .eq("id", thread.student_assignment_id)
    .single();

  if (!sa || sa.student_id !== userId) {
    return jsonError(cors, 403, "FORBIDDEN", "Not your thread");
  }

  return {
    thread: thread as Record<string, unknown>,
    studentAssignment: sa as { id: string; assignment_id: string; student_id: string },
  };
}

async function handleTranscribeThreadVoice(
  db: SupabaseClient,
  userId: string,
  threadId: string,
  req: Request,
  cors: Record<string, string>,
): Promise<Response> {
  const ownershipResult = await verifyThreadOwnership(db, threadId, userId, cors);
  if (ownershipResult instanceof Response) return ownershipResult;

  const { thread } = ownershipResult;
  if (thread.status !== "active") {
    return jsonError(cors, 409, "THREAD_NOT_ACTIVE", "Thread is not active");
  }

  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return jsonError(cors, 400, "INVALID_BODY", "Expected multipart audio upload");
  }

  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof Blob)) {
    return jsonError(cors, 400, "VALIDATION", "Audio file is required");
  }

  if (file.size === 0) {
    return jsonError(cors, 400, "VALIDATION", "Voice message is empty");
  }

  if (file.size > MAX_VOICE_BYTES) {
    return jsonError(cors, 413, "VOICE_TOO_LARGE", "Голосовое сообщение слишком большое");
  }

  const mimeType = file.type || "application/octet-stream";
  if (!isAcceptedVoiceMimeType(mimeType)) {
    return jsonError(cors, 400, "VOICE_UNSUPPORTED_FORMAT", "Неподдерживаемый формат голосового сообщения");
  }

  const lemonfoxApiKey = Deno.env.get("LEMONFOX_API_KEY");
  if (!lemonfoxApiKey) {
    console.error("LEMONFOX_API_KEY is not configured for homework voice transcription");
    return jsonError(cors, 503, "VOICE_UNAVAILABLE", "Расшифровка голосовых временно недоступна");
  }

  const outboundForm = new FormData();
  const uploadedName = file instanceof File ? file.name : undefined;
  outboundForm.append("file", file, getVoiceFilename(mimeType, uploadedName));
  outboundForm.append("model", VOICE_TRANSCRIPTION_MODEL);
  outboundForm.append("language", "ru");

  console.log("homework_voice_transcription_request", {
    threadId,
    userId,
    mimeType,
    size: file.size,
  });

  const transcriptionRes = await fetch("https://api.lemonfox.ai/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${lemonfoxApiKey}`,
    },
    body: outboundForm,
  });

  if (!transcriptionRes.ok) {
    const errText = await transcriptionRes.text().catch(() => "unknown");
    console.error("homework_voice_transcription_failed", {
      threadId,
      userId,
      status: transcriptionRes.status,
      body: errText,
    });
    return jsonError(cors, 502, "VOICE_TRANSCRIPTION_FAILED", "Не удалось расшифровать голосовое сообщение");
  }

  const transcriptionData = await transcriptionRes.json();
  const text = typeof transcriptionData?.text === "string"
    ? transcriptionData.text.trim()
    : "";

  if (!text) {
    return jsonError(cors, 422, "VOICE_EMPTY_TRANSCRIPT", "Не удалось распознать речь");
  }

  return jsonOk(cors, { text });
}

async function handlePostThreadMessage(
  db: SupabaseClient,
  userId: string,
  threadId: string,
  body: unknown,
  cors: Record<string, string>,
): Promise<Response> {
  const ownershipResult = await verifyThreadOwnership(db, threadId, userId, cors);
  if (ownershipResult instanceof Response) return ownershipResult;
  const { thread, studentAssignment } = ownershipResult;

  if (!body || typeof body !== "object") {
    return jsonError(cors, 400, "INVALID_BODY", "Request body must be a JSON object");
  }
  const b = body as Record<string, unknown>;

  if (!isNonEmptyString(b.content)) {
    return jsonError(cors, 400, "VALIDATION", "content is required (non-empty string)");
  }
  const role = b.role === "assistant" ? "assistant" : "user";
  const attachmentRefs = role === "user"
    ? extractStudentThreadAttachmentRefs(b, userId, studentAssignment.assignment_id, cors)
    : [];
  if (attachmentRefs instanceof Response) return attachmentRefs;
  const serializedAttachments = serializeThreadAttachmentRefs(attachmentRefs);
  const requestedTaskOrder = typeof b.task_order === "number" ? b.task_order : undefined;
  const requestedTaskId = isUUID(b.task_id) ? b.task_id as string : undefined;
  const messageKindRaw = isString(b.message_kind) ? (b.message_kind as string).trim() : "";
  const validMessageKinds = new Set(["answer", "hint_request", "question", "ai_reply", "system"]);
  const messageKind = validMessageKinds.has(messageKindRaw)
    ? messageKindRaw
    : (role === "assistant" ? "ai_reply" : "answer");

  const { data: assignmentTasks, error: assignmentTasksError } = await db
    .from("homework_tutor_tasks")
    .select("id, order_num")
    .eq("assignment_id", studentAssignment.assignment_id)
    .order("order_num", { ascending: true });
  if (assignmentTasksError || !assignmentTasks) {
    return jsonError(cors, 500, "DB_ERROR", "Failed to resolve task reference");
  }

  const resolvedTask = resolveTaskReference(
    assignmentTasks as GuidedTaskIdentityRow[],
    {
      taskId: requestedTaskId,
      taskOrder: requestedTaskOrder,
      fallbackTaskId: typeof thread.current_task_id === "string" ? thread.current_task_id as string : null,
      fallbackTaskOrder: thread.current_task_order as number,
    },
  );
  if (!resolvedTask) {
    return jsonError(cors, 400, "VALIDATION", "Invalid task reference");
  }
  const taskOrder = resolvedTask.order_num;
  const taskId = resolvedTask.id;

  // Integrity check: assistant messages can only follow a user message
  // Exception: bootstrap intro messages (message_kind='system') can be first in thread
  if (role === "assistant" && messageKind !== "system") {
    const { data: lastMsg } = await db
      .from("homework_tutor_thread_messages")
      .select("role")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!lastMsg || lastMsg.role !== "user") {
      return jsonError(cors, 400, "INVALID_ORDER", "Assistant message must follow a user message");
    }
  }

  // Insert message (message_kind is optional for backward compatibility)
  const payloadWithKind = {
    thread_id: threadId,
    role,
    content: b.content,
    image_url: serializedAttachments,
    task_id: taskId,
    task_order: taskOrder,
    message_kind: messageKind,
  };
  const payloadLegacy = {
    thread_id: threadId,
    role,
    content: b.content,
    image_url: serializedAttachments,
    task_id: taskId,
    task_order: taskOrder,
  };

  let savedMsg: Record<string, unknown> | null = null;
  let insertErr: { message?: string } | null = null;

  const withKindResult = await db
    .from("homework_tutor_thread_messages")
    .insert(payloadWithKind)
    .select("id, role, content, image_url, task_id, task_order, created_at")
    .single();

  if (withKindResult.error && isMissingColumnError(withKindResult.error.message, "message_kind")) {
    const legacyResult = await db
      .from("homework_tutor_thread_messages")
      .insert(payloadLegacy)
      .select("id, role, content, image_url, task_id, task_order, created_at")
      .single();
    savedMsg = legacyResult.data as Record<string, unknown> | null;
    insertErr = legacyResult.error;
  } else {
    savedMsg = withKindResult.data as Record<string, unknown> | null;
    insertErr = withKindResult.error;
  }

  if (insertErr || !savedMsg) {
    console.error("homework_api_thread_message_insert_failed", { error: insertErr?.message });
    return jsonError(cors, 500, "DB_ERROR", "Failed to save message");
  }

  // If user message, increment attempts on the current active task_state
  if (role === "user") {
    const { data: activeState } = await db
      .from("homework_tutor_task_states")
      .select("id, attempts")
      .eq("thread_id", threadId)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();

    if (activeState) {
      await db
        .from("homework_tutor_task_states")
        .update({
          attempts: (activeState.attempts ?? 0) + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", activeState.id);
    }
  }

  return jsonOk(cors, {
    ...savedMsg,
    message_kind: messageKind,
  }, 201);
}

// ─── Endpoint: POST /threads/:id/advance (student) ──────────────────────────

async function handleAdvanceTask(
  db: SupabaseClient,
  userId: string,
  threadId: string,
  body: unknown,
  cors: Record<string, string>,
): Promise<Response> {
  const ownershipResult = await verifyThreadOwnership(db, threadId, userId, cors);
  if (ownershipResult instanceof Response) return ownershipResult;
  const { thread, studentAssignment } = ownershipResult;

  if (thread.status === "completed") {
    return jsonError(cors, 400, "ALREADY_COMPLETED", "Thread is already completed");
  }

  const b = (body && typeof body === "object") ? body as Record<string, unknown> : {};
  // Clamp score to 0-100 if provided
  const rawScore = typeof b.score === "number" ? b.score : null;
  const score = rawScore !== null ? Math.max(0, Math.min(100, rawScore)) : null;

  // Guard: require at least 1 AI reply for the current task before allowing advance.
  // Use task_id (immutable) instead of task_order (positional, can change on reorder).
  const currentTaskId = typeof thread.current_task_id === "string" ? thread.current_task_id : null;
  const guardQuery = db
    .from("homework_tutor_thread_messages")
    .select("id", { count: "exact", head: true })
    .eq("thread_id", threadId)
    .eq("role", "assistant");

  const { count: assistantMsgCount } = currentTaskId
    ? await guardQuery.eq("task_id", currentTaskId)
    : await guardQuery.eq("task_order", thread.current_task_order as number);

  if (!assistantMsgCount || assistantMsgCount < 1) {
    return jsonError(cors, 400, "NO_INTERACTION", "Complete at least one exchange with the AI before advancing");
  }

  // Load advance context using shared helper
  const ctx = await loadAdvanceContext(db, threadId, thread);
  if (!ctx) {
    return jsonError(cors, 400, "NO_ACTIVE_TASK", "No active task to advance from");
  }

  // Perform advance using shared helper
  await performTaskAdvance(
    db, threadId, ctx.currentState, ctx.stateByOrder, ctx.sortedOrders, ctx.currentOrder, score,
  );

  // Return updated thread (student-facing: filter hidden notes)
  const updatedThread = await fetchStudentThread(db, threadId);
  return jsonOk(cors, updatedThread ?? { id: threadId });
}

// ─── Helper: fetch full thread with nested data ─────────────────────────────

const THREAD_SELECT = `
  id, status, current_task_order, current_task_id, created_at, updated_at,
  student_assignment_id, last_student_message_at, last_tutor_message_at,
  homework_tutor_thread_messages(id, role, content, image_url, task_id, task_order, message_kind, created_at, author_user_id, visible_to_student),
  homework_tutor_task_states(id, task_id, status, attempts, best_score, available_score, earned_score, wrong_answer_count, hint_count, ai_score, ai_score_comment)
`;

/**
 * Strip hidden tutor notes from thread data before returning to student.
 * Service-role key bypasses RLS, so we must filter server-side.
 */
function stripHiddenMessages(thread: Record<string, unknown>): Record<string, unknown> {
  const messages = thread.homework_tutor_thread_messages;
  if (!Array.isArray(messages)) return thread;
  return {
    ...thread,
    homework_tutor_thread_messages: messages.filter(
      (m: Record<string, unknown>) => m.visible_to_student !== false,
    ),
  };
}

/**
 * Remove tutor-facing draft commentary from student responses.
 */
function stripStudentSensitiveTaskStateFields(
  thread: Record<string, unknown>,
): Record<string, unknown> {
  const taskStates = thread.homework_tutor_task_states;
  if (!Array.isArray(taskStates)) return thread;
  return {
    ...thread,
    homework_tutor_task_states: taskStates.map((taskState) => {
      if (!taskState || typeof taskState !== "object") return taskState;
      const { ai_score_comment: _aiScoreComment, ...safeTaskState } = taskState as Record<
        string,
        unknown
      >;
      return safeTaskState;
    }),
  };
}

async function fetchFullThread(
  db: SupabaseClient,
  threadId: string,
): Promise<Record<string, unknown> | null> {
  const { data } = await db
    .from("homework_tutor_threads")
    .select(THREAD_SELECT)
    .eq("id", threadId)
    .order("created_at", { referencedTable: "homework_tutor_thread_messages", ascending: true })
    .single();
  return data as Record<string, unknown> | null;
}

/** Fetch thread for student: filters out hidden tutor notes. */
async function fetchStudentThread(
  db: SupabaseClient,
  threadId: string,
): Promise<Record<string, unknown> | null> {
  const thread = await fetchFullThread(db, threadId);
  return thread
    ? stripStudentSensitiveTaskStateFields(stripHiddenMessages(thread))
    : null;
}

// ─── Helper: lazy thread provisioning for guided_chat ───────────────────────

/**
 * Create a guided_chat thread + task_states for a student assignment.
 * Used both at assign-time (eager) and on first GET (lazy fallback).
 * Returns the fully-loaded thread (with nested messages/task_states) or null on failure.
 */
async function provisionGuidedThread(
  db: SupabaseClient,
  assignmentId: string,
  studentAssignmentId: string,
): Promise<Record<string, unknown> | null> {
  const { data: tasks } = await db
    .from("homework_tutor_tasks")
    .select("id, order_num, max_score")
    .eq("assignment_id", assignmentId)
    .order("order_num", { ascending: true });

  if (!tasks || tasks.length === 0) {
    console.warn("provisionGuidedThread: no tasks found", { assignmentId, studentAssignmentId });
    return null;
  }

  const { data: thread, error: threadErr } = await db
    .from("homework_tutor_threads")
    .upsert(
      {
        student_assignment_id: studentAssignmentId,
        status: "active",
        current_task_order: 1,
        current_task_id: tasks[0]?.id ?? null,
      },
      { onConflict: "student_assignment_id", ignoreDuplicates: true },
    )
    .select("id")
    .single();

  if (threadErr || !thread) {
    console.warn("provisionGuidedThread: thread upsert failed", {
      assignmentId,
      studentAssignmentId,
      error: threadErr?.message,
    });
    return null;
  }

  const taskStateRows = tasks.map((task: { id: string; max_score?: number }) => ({
    thread_id: thread.id,
    task_id: task.id,
    status: "active",
    attempts: 0,
    available_score: task.max_score ?? 1,
  }));

  const { error: stateErr } = await db
    .from("homework_tutor_task_states")
    .upsert(taskStateRows, { onConflict: "thread_id,task_id", ignoreDuplicates: true });

  if (stateErr) {
    console.warn("provisionGuidedThread: task_states upsert failed", {
      assignmentId,
      threadId: thread.id,
      error: stateErr.message,
    });
  }

  // Return the full thread with nested relations
  return await fetchFullThread(db, thread.id);
}

// ─── Helper: shared advance logic (used by /advance and /check) ─────────────

interface AdvanceResult {
  nextOrder: number | null;
  nextTaskId: string | null;
  threadCompleted: boolean;
}

async function performTaskAdvance(
  db: SupabaseClient,
  threadId: string,
  currentState: Record<string, unknown>,
  stateByOrder: Map<number, Record<string, unknown>>,
  sortedOrders: number[],
  currentOrder: number,
  score: number | null,
): Promise<AdvanceResult> {
  // Mark current task as completed
  const bestScore = score !== null
    ? (currentState.best_score !== null ? Math.max(currentState.best_score as number, score) : score)
    : (currentState.best_score as number | null);

  await db
    .from("homework_tutor_task_states")
    .update({
      status: "completed",
      best_score: bestScore,
      updated_at: new Date().toISOString(),
    })
    .eq("id", currentState.id);

  // Find the first remaining active task in order. `stateByOrder` is a snapshot
  // from before the DB update above, so we must explicitly exclude the task we
  // just completed.
  const remainingActiveOrders = sortedOrders.filter(
    (order) => order !== currentOrder && stateByOrder.get(order)?.status === "active",
  );
  const nextOrder = remainingActiveOrders.length > 0 ? remainingActiveOrders[0] : null;
  const nextState = nextOrder !== null ? stateByOrder.get(nextOrder) : null;
  const nextTaskId = typeof nextState?.task_id === "string" ? nextState.task_id as string : null;

  if (nextOrder !== null) {
    // Update thread current_task_order
    await db
      .from("homework_tutor_threads")
      .update({
        current_task_id: nextTaskId,
        current_task_order: nextOrder,
        updated_at: new Date().toISOString(),
      })
      .eq("id", threadId);

    // Insert system message about task transition
    await db
      .from("homework_tutor_thread_messages")
      .insert({
        thread_id: threadId,
        role: "system",
        content: `Задача ${currentOrder} выполнена! Переходим к задаче ${nextOrder}.`,
        task_id: nextTaskId,
        task_order: nextOrder,
        message_kind: "system",
      });

    return { nextOrder, nextTaskId, threadCompleted: false };
  } else {
    // All tasks completed
    await db
      .from("homework_tutor_threads")
      .update({
        current_task_id: null,
        status: "completed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", threadId);

    await db
      .from("homework_tutor_thread_messages")
      .insert({
        thread_id: threadId,
        role: "system",
        content: "Все задачи выполнены! 🎉",
        task_id: typeof currentState.task_id === "string" ? currentState.task_id as string : null,
        task_order: currentOrder,
        message_kind: "system",
      });

    return { nextOrder: null, nextTaskId: null, threadCompleted: true };
  }
}

// ─── Helper: load advance context (shared between /advance and /check) ──────

async function loadAdvanceContext(
  db: SupabaseClient,
  threadId: string,
  thread: Record<string, unknown>,
  overrideTaskOrder?: number,
  overrideTaskId?: string,
): Promise<{
  allStates: Record<string, unknown>[];
  stateByOrder: Map<number, Record<string, unknown>>;
  sortedOrders: number[];
  currentState: Record<string, unknown>;
  currentOrder: number;
  sa: Record<string, unknown>;
  tasks: Array<{ id: string; order_num: number; max_score?: number }>;
} | null> {
  const { data: allStates, error: statesErr } = await db
    .from("homework_tutor_task_states")
    .select("id, task_id, status, attempts, best_score, available_score, earned_score, wrong_answer_count, hint_count")
    .eq("thread_id", threadId);

  if (statesErr || !allStates || allStates.length === 0) return null;

  const { data: sa } = await db
    .from("homework_tutor_student_assignments")
    .select("assignment_id")
    .eq("id", thread.student_assignment_id)
    .single();
  if (!sa) return null;

  const { data: tasks } = await db
    .from("homework_tutor_tasks")
    .select("id, order_num, max_score")
    .eq("assignment_id", sa.assignment_id)
    .order("order_num", { ascending: true });
  if (!tasks || tasks.length === 0) return null;

  const taskOrderMap = new Map(tasks.map((t: { id: string; order_num: number }) => [t.id, t.order_num]));
  const stateByOrder = new Map(
    allStates.map((s: Record<string, unknown>) => [taskOrderMap.get(s.task_id as string) ?? 0, s]),
  );

  const currentTask = resolveTaskReference(
    tasks as GuidedTaskIdentityRow[],
    {
      taskId: overrideTaskId,
      taskOrder: overrideTaskOrder,
      fallbackTaskId: typeof thread.current_task_id === "string" ? thread.current_task_id as string : null,
      fallbackTaskOrder: thread.current_task_order as number,
    },
  );
  if (!currentTask) return null;

  const currentOrder = currentTask.order_num;
  const currentState = allStates.find((state) => state.task_id === currentTask.id);
  if (!currentState || currentState.status !== "active") return null;

  const sortedOrders = tasks
    .map((t: { order_num: number }) => t.order_num)
    .sort((a: number, b: number) => a - b);

  return { allStates, stateByOrder, sortedOrders, currentState, currentOrder, sa, tasks };
}

// ─── Endpoint: POST /threads/:id/check (student — Phase 3) ─────────────────

async function handleCheckAnswer(
  db: SupabaseClient,
  userId: string,
  threadId: string,
  body: unknown,
  cors: Record<string, string>,
): Promise<Response> {
  const ownershipResult = await verifyThreadOwnership(db, threadId, userId, cors);
  if (ownershipResult instanceof Response) return ownershipResult;
  const { thread, studentAssignment } = ownershipResult;

  if (thread.status === "completed") {
    return jsonError(cors, 400, "ALREADY_COMPLETED", "Thread is already completed");
  }

  const b = (body && typeof body === "object") ? body as Record<string, unknown> : {};
  const answer = typeof b.answer === "string" ? b.answer.trim() : "";
  if (!answer) {
    return jsonError(cors, 400, "VALIDATION", "answer is required");
  }
  const requestedTaskOrder = typeof b.task_order === "number" ? b.task_order : undefined;
  const requestedTaskId = isUUID(b.task_id) ? b.task_id as string : undefined;
  const attachmentRefs = extractStudentThreadAttachmentRefs(b, userId, studentAssignment.assignment_id, cors);
  if (attachmentRefs instanceof Response) return attachmentRefs;
  const serializedAttachments = serializeThreadAttachmentRefs(attachmentRefs);

  // Load advance context
  const ctx = await loadAdvanceContext(db, threadId, thread, requestedTaskOrder, requestedTaskId);
  if (!ctx) {
    return jsonError(cors, 400, "NO_ACTIVE_TASK", "No active task to check");
  }

  const { currentState, currentOrder, stateByOrder, sortedOrders, tasks } = ctx;

  // Load the full task (with correct_answer, rubric)
  const { data: task } = await db
    .from("homework_tutor_tasks")
    .select("id, order_num, task_text, task_image_url, ocr_text, correct_answer, rubric_text, rubric_image_urls, max_score, check_format")
    .eq("id", currentState.task_id)
    .single();

  if (!task) {
    return jsonError(cors, 500, "DB_ERROR", "Task not found");
  }

  // Load assignment for subject
  const { data: assignment } = await db
    .from("homework_tutor_assignments")
    .select("subject")
    .eq("id", ctx.sa.assignment_id)
    .single();

  if (!assignment) {
    return jsonError(cors, 500, "DB_ERROR", "Assignment not found");
  }

  // Load conversation history (last 15 messages for current task)
  const { data: recentMessages } = await db
    .from("homework_tutor_thread_messages")
    .select("role, content, visible_to_student, message_kind")
    .eq("thread_id", threadId)
    .eq("task_id", currentState.task_id as string)
    .order("created_at", { ascending: true })
    .limit(15);

  // Initialize available_score if null (backward compat for old threads)
  const currentAvailableScore: number =
    currentState.available_score != null
      ? Number(currentState.available_score)
      : (task.max_score ?? 1);

  // Save user answer message (with optional student image attachment)
  const { data: savedUserAnswerMessage, error: saveUserAnswerError } = await db
    .from("homework_tutor_thread_messages")
    .insert({
      thread_id: threadId,
      role: "user",
      content: answer,
      task_id: currentState.task_id as string,
      task_order: currentOrder,
      message_kind: "answer",
      ...(serializedAttachments && { image_url: serializedAttachments }),
    })
    .select("id, role, content, image_url, task_id, task_order, message_kind, created_at, author_user_id, visible_to_student")
    .single();

  if (saveUserAnswerError || !savedUserAnswerMessage) {
    console.error("homework_api_check_answer_insert_failed", {
      threadId,
      currentOrder,
      error: saveUserAnswerError?.message,
    });
    return jsonError(cors, 500, "DB_ERROR", "Failed to save answer message");
  }

  // Update last_student_message_at
  await db.from("homework_tutor_threads")
    .update({ last_student_message_at: new Date().toISOString() })
    .eq("id", threadId);

  // Resolve task/rubric images into AI-compatible data URLs, latest student
  // image into signed URLs, and tutor-curated student display name.
  const [taskImageUrls, rubricImageUrls, taskOcrText, studentImageUrls, studentName] = await Promise.all([
    resolveTaskImageUrlsForAI(db, task.task_image_url),
    resolveTaskImageUrlsForAI(db, task.rubric_image_urls),
    ensureTaskOcrText(db, task, assignment.subject ?? "math"),
    loadLatestStudentImageUrlsForTask(
      db,
      threadId,
      currentOrder,
      currentState.task_id as string,
      userId,
      studentAssignment.assignment_id,
    ),
    resolveStudentDisplayName(db, studentAssignment.id),
  ]);

  // Call AI evaluation
  const totalTasks = tasks.length;
  const result = await evaluateStudentAnswer({
    studentAnswer: answer,
    taskText: task.task_text ?? "",
    taskImageUrls,
    studentImageUrls,
    taskOcrText,
    correctAnswer: task.correct_answer,
    rubricText: task.rubric_text,
    rubricImageUrls,
    subject: assignment.subject ?? "math",
    conversationHistory: recentMessages ?? [],
    wrongAnswerCount: (currentState.wrong_answer_count as number) ?? 0,
    hintCount: (currentState.hint_count as number) ?? 0,
    availableScore: currentAvailableScore,
    maxScore: task.max_score ?? 1,
    checkFormat: task.check_format ?? undefined,
    studentName,
  });

  // Safety guard: without correct_answer, only trust high-confidence CORRECT
  let effectiveVerdict = result.verdict;
  if (effectiveVerdict === "CORRECT" && !task.correct_answer?.trim() && result.confidence < 0.7) {
    console.log("guided_check_downgrade_low_confidence", {
      taskId: task.id,
      confidence: result.confidence,
    });
    effectiveVerdict = "ON_TRACK";
  }

  const maxScore = task.max_score ?? 1;
  const isDetailedSolution = task.check_format === "detailed_solution";
  const effectiveAiScore = effectiveVerdict === result.verdict
    ? result.ai_score
    : effectiveVerdict === "ON_TRACK"
      ? (isDetailedSolution
        ? Math.min(result.ai_score ?? 0, Math.max(0, maxScore - 0.5))
        : 0)
      : result.ai_score;
  const effectiveAiScoreComment =
    isDetailedSolution && effectiveAiScore != null && effectiveAiScore < maxScore
      ? result.ai_score_comment ??
        "Решение пока не дотягивает до полного зачёта по критериям, поэтому балл не максимальный."
      : null;

  // Save AI feedback message
  await db.from("homework_tutor_thread_messages").insert({
    thread_id: threadId,
    role: "assistant",
    content: result.feedback,
    task_id: currentState.task_id as string,
    task_order: currentOrder,
    message_kind: "ai_reply",
  });

  let responseData: Record<string, unknown>;
  const nextAttemptCount = ((currentState.attempts as number) ?? 0) + 1;

  if (effectiveVerdict === "CORRECT") {
    // Set earned_score, mark completed, advance
    const earnedScore = currentAvailableScore;

    await db.from("homework_tutor_task_states").update({
      attempts: nextAttemptCount,
      status: "completed",
      earned_score: earnedScore,
      available_score: currentAvailableScore,
      ai_score: effectiveAiScore,
      ai_score_comment: effectiveAiScoreComment,
      best_score: Math.max((currentState.best_score as number) ?? 0, Math.round(earnedScore)),
      last_ai_feedback: result.feedback,
      updated_at: new Date().toISOString(),
    }).eq("id", currentState.id);

    const advanceResult = await performTaskAdvance(
      db, threadId, currentState, stateByOrder, sortedOrders, currentOrder, Math.round(earnedScore),
    );

    responseData = {
      verdict: "CORRECT",
      feedback: result.feedback,
      ai_score: effectiveAiScore,
      ai_score_comment: effectiveAiScoreComment,
      earned_score: earnedScore,
      available_score: currentAvailableScore,
      max_score: maxScore,
      wrong_answer_count: (currentState.wrong_answer_count as number) ?? 0,
      hint_count: (currentState.hint_count as number) ?? 0,
      task_completed: true,
      next_task_order: advanceResult.nextOrder,
      next_task_id: advanceResult.nextTaskId,
      thread_completed: advanceResult.threadCompleted,
      total_tasks: totalTasks,
    };
  } else if (effectiveVerdict === "CHECK_FAILED") {
    await db.from("homework_tutor_task_states").update({
      last_ai_feedback: result.feedback,
      updated_at: new Date().toISOString(),
    }).eq("id", currentState.id);

    responseData = {
      verdict: "CHECK_FAILED",
      feedback: result.feedback,
      ai_score: null,
      ai_score_comment: null,
      earned_score: null,
      available_score: currentAvailableScore,
      max_score: maxScore,
      wrong_answer_count: (currentState.wrong_answer_count as number) ?? 0,
      hint_count: (currentState.hint_count as number) ?? 0,
      task_completed: false,
      next_task_order: null,
      next_task_id: null,
      thread_completed: false,
      total_tasks: totalTasks,
    };
  } else if (effectiveVerdict === "ON_TRACK") {
    // Correct step but NOT the final answer — keep task open
    // First 2 ON_TRACKs are free; from 3rd onward, count as hint (degrades score)
    const currentAttempts = nextAttemptCount;
    const wrongCount = (currentState.wrong_answer_count as number) ?? 0;
    const prevOnTrackCount = currentAttempts - wrongCount - 1; // past ON_TRACK-like attempts
    let newHintCount = (currentState.hint_count as number) ?? 0;
    let onTrackAvailableScore = currentAvailableScore;

    if (prevOnTrackCount >= 2) {
      // 3rd+ ON_TRACK: count as hint, degrade score
      newHintCount += 1;
      onTrackAvailableScore = computeAvailableScore(
        task.max_score ?? 1, wrongCount, newHintCount,
      );
    }

    await db.from("homework_tutor_task_states").update({
      attempts: nextAttemptCount,
      hint_count: newHintCount,
      available_score: onTrackAvailableScore,
      ai_score: effectiveAiScore,
      ai_score_comment: effectiveAiScoreComment,
      last_ai_feedback: result.feedback,
      updated_at: new Date().toISOString(),
    }).eq("id", currentState.id);

    responseData = {
      verdict: "ON_TRACK",
      feedback: result.feedback,
      ai_score: effectiveAiScore,
      ai_score_comment: effectiveAiScoreComment,
      earned_score: null,
      available_score: onTrackAvailableScore,
      max_score: maxScore,
      wrong_answer_count: wrongCount,
      hint_count: newHintCount,
      task_completed: false,
      next_task_order: null,
      next_task_id: null,
      thread_completed: false,
      total_tasks: totalTasks,
    };
  } else {
    // Increment wrong_answer_count, degrade score
    const newWrongCount = ((currentState.wrong_answer_count as number) ?? 0) + 1;
    const newHintCount = (currentState.hint_count as number) ?? 0;
    const newAvailableScore = computeAvailableScore(
      task.max_score ?? 1, newWrongCount, newHintCount,
    );

    await db.from("homework_tutor_task_states").update({
      attempts: nextAttemptCount,
      wrong_answer_count: newWrongCount,
      available_score: newAvailableScore,
      ai_score: effectiveAiScore,
      ai_score_comment: effectiveAiScoreComment,
      last_ai_feedback: result.feedback,
      updated_at: new Date().toISOString(),
    }).eq("id", currentState.id);

    responseData = {
      verdict: "INCORRECT",
      feedback: result.feedback,
      ai_score: effectiveAiScore,
      ai_score_comment: effectiveAiScoreComment,
      earned_score: null,
      available_score: newAvailableScore,
      max_score: maxScore,
      wrong_answer_count: newWrongCount,
      hint_count: newHintCount,
      task_completed: false,
      next_task_order: null,
      next_task_id: null,
      thread_completed: false,
      total_tasks: totalTasks,
    };
  }

  // Return updated thread (student-facing: filter hidden notes)
  const updatedThread = await fetchStudentThread(db, threadId);
  if (
    updatedThread &&
    Array.isArray(updatedThread.homework_tutor_thread_messages)
  ) {
    const existingIndex = updatedThread.homework_tutor_thread_messages.findIndex(
      (message) => message.id === savedUserAnswerMessage.id,
    );

    if (existingIndex >= 0) {
      const existingMessage = updatedThread.homework_tutor_thread_messages[existingIndex];
      if (!existingMessage.image_url && savedUserAnswerMessage.image_url) {
        updatedThread.homework_tutor_thread_messages[existingIndex] = {
          ...existingMessage,
          image_url: savedUserAnswerMessage.image_url,
        };
      }
    } else {
      updatedThread.homework_tutor_thread_messages = [
        ...updatedThread.homework_tutor_thread_messages,
        savedUserAnswerMessage as Record<string, unknown>,
      ].sort((a, b) => {
        const aTime = typeof a.created_at === "string" ? Date.parse(a.created_at) : 0;
        const bTime = typeof b.created_at === "string" ? Date.parse(b.created_at) : 0;
        return aTime - bTime;
      });
    }
  }
  return jsonOk(cors, { ...responseData, thread: updatedThread });
}

// ─── Endpoint: POST /threads/:id/hint (student — Phase 3) ──────────────────

async function handleRequestHint(
  db: SupabaseClient,
  userId: string,
  threadId: string,
  body: unknown,
  cors: Record<string, string>,
): Promise<Response> {
  const ownershipResult = await verifyThreadOwnership(db, threadId, userId, cors);
  if (ownershipResult instanceof Response) return ownershipResult;
  const { thread, studentAssignment } = ownershipResult;

  if (thread.status === "completed") {
    return jsonError(cors, 400, "ALREADY_COMPLETED", "Thread is already completed");
  }

  const b = (body && typeof body === "object") ? body as Record<string, unknown> : {};
  const requestedTaskOrder = typeof b.task_order === "number" ? b.task_order : undefined;
  const requestedTaskId = isUUID(b.task_id) ? b.task_id as string : undefined;

  // Get task_state for the requested task order
  const { data: allStates } = await db
    .from("homework_tutor_task_states")
    .select("id, task_id, status, attempts, best_score, available_score, wrong_answer_count, hint_count")
    .eq("thread_id", threadId);

  // Find the task state matching the requested order
  const { data: tasks } = await db
    .from("homework_tutor_tasks")
    .select("id, order_num")
    .eq("assignment_id", studentAssignment.assignment_id)
    .order("order_num", { ascending: true });

  const resolvedTask = resolveTaskReference(
    (tasks ?? []) as GuidedTaskIdentityRow[],
    {
      taskId: requestedTaskId,
      taskOrder: requestedTaskOrder,
      fallbackTaskId: typeof thread.current_task_id === "string" ? thread.current_task_id as string : null,
      fallbackTaskOrder: thread.current_task_order as number,
    },
  );
  if (!resolvedTask) {
    return jsonError(cors, 400, "VALIDATION", "Invalid task reference");
  }

  const currentOrder = resolvedTask.order_num;
  const activeState = allStates?.find((s: Record<string, unknown>) => s.task_id === resolvedTask.id);

  if (!activeState || activeState.status !== "active") {
    return jsonError(cors, 400, "NO_ACTIVE_TASK", "No active task for hint");
  }

  // Load task
  const { data: task } = await db
    .from("homework_tutor_tasks")
    .select("id, order_num, task_text, task_image_url, ocr_text, correct_answer, max_score")
    .eq("id", activeState.task_id)
    .single();

  if (!task) {
    return jsonError(cors, 500, "DB_ERROR", "Task not found");
  }

  // Load assignment for subject (reuse saData from above)
  const { data: assignment } = await db
    .from("homework_tutor_assignments")
    .select("subject")
    .eq("id", studentAssignment.assignment_id)
    .single();

  // Load conversation history
  const { data: recentMessages } = await db
    .from("homework_tutor_thread_messages")
    .select("role, content, visible_to_student, message_kind")
    .eq("thread_id", threadId)
    .eq("task_id", task.id)
    .order("created_at", { ascending: true })
    .limit(15);

  // Save hint request message from user
  await db.from("homework_tutor_thread_messages").insert({
    thread_id: threadId,
    role: "user",
    content: "Подсказка",
    task_id: task.id,
    task_order: currentOrder,
    message_kind: "hint_request",
  });

  // Update last_student_message_at
  await db.from("homework_tutor_threads")
    .update({ last_student_message_at: new Date().toISOString() })
    .eq("id", threadId);

  // Resolve task images into AI-compatible data URLs, latest student image
  // into signed URLs, and tutor-curated student display name.
  const [taskImageUrls, taskOcrText, studentImageUrls, studentName] = await Promise.all([
    resolveTaskImageUrlsForAI(db, task.task_image_url),
    ensureTaskOcrText(db, task, assignment?.subject ?? "math"),
    loadLatestStudentImageUrlsForTask(
      db,
      threadId,
      currentOrder,
      task.id,
      userId,
      studentAssignment.assignment_id,
    ),
    resolveStudentDisplayName(db, studentAssignment.id),
  ]);

  // Call AI for hint
  const hintResult = await generateHint({
    taskText: task.task_text ?? "",
    taskImageUrls,
    studentImageUrls,
    taskOcrText,
    taskId: task.id ?? null,
    assignmentId: studentAssignment.assignment_id ?? null,
    correctAnswer: task.correct_answer,
    subject: assignment?.subject ?? "math",
    conversationHistory: recentMessages ?? [],
    wrongAnswerCount: (activeState.wrong_answer_count as number) ?? 0,
    hintCount: (activeState.hint_count as number) ?? 0,
    studentName,
  });

  // Save hint reply
  await db.from("homework_tutor_thread_messages").insert({
    thread_id: threadId,
    role: "assistant",
    content: hintResult.hint,
    task_id: task.id,
    task_order: currentOrder,
    message_kind: "ai_reply",
  });

  // Update scoring
  const newHintCount = ((activeState.hint_count as number) ?? 0) + 1;
  const newWrongCount = (activeState.wrong_answer_count as number) ?? 0;
  const newAvailableScore = computeAvailableScore(
    task.max_score ?? 1, newWrongCount, newHintCount,
  );

  await db.from("homework_tutor_task_states").update({
    hint_count: newHintCount,
    available_score: newAvailableScore,
    updated_at: new Date().toISOString(),
  }).eq("id", activeState.id);

  // Return updated thread (student-facing: filter hidden notes)
  const updatedThread = await fetchStudentThread(db, threadId);
  return jsonOk(cors, {
    hint: hintResult.hint,
    available_score: newAvailableScore,
    max_score: task.max_score ?? 1,
    hint_count: newHintCount,
    wrong_answer_count: newWrongCount,
    thread: updatedThread,
  });
}

// ─── Endpoint: GET /assignments/:id/students/:studentId/thread (tutor) ──────

async function handleGetTutorStudentThread(
  db: SupabaseClient,
  tutorUserId: string,
  assignmentId: string,
  studentId: string,
  cors: Record<string, string>,
): Promise<Response> {
  if (!isUUID(studentId)) {
    return jsonError(cors, 400, "VALIDATION", "Invalid student ID");
  }

  const assignmentOrErr = await getOwnedAssignmentOrThrow(db, assignmentId, tutorUserId, cors);
  if (assignmentOrErr instanceof Response) return assignmentOrErr;

  const { data: studentAssignment, error: studentAssignmentError } = await db
    .from("homework_tutor_student_assignments")
    .select("id")
    .eq("assignment_id", assignmentId)
    .eq("student_id", studentId)
    .maybeSingle();

  if (studentAssignmentError) {
    return jsonError(cors, 500, "DB_ERROR", "Failed to load student assignment");
  }
  if (!studentAssignment) {
    return jsonError(cors, 404, "NOT_FOUND", "Student is not assigned to this homework");
  }

  let thread: Record<string, unknown> | null;
  {
    const { data, error: threadError } = await db
      .from("homework_tutor_threads")
      .select(THREAD_SELECT)
      .eq("student_assignment_id", studentAssignment.id)
      .order("created_at", { referencedTable: "homework_tutor_thread_messages", ascending: true })
      .maybeSingle();

    if (threadError) {
      return jsonError(cors, 500, "DB_ERROR", "Failed to load thread");
    }
    thread = data as Record<string, unknown> | null;
  }

  // Lazy provisioning: create thread if it doesn't exist yet
  if (!thread) {
    thread = await provisionGuidedThread(db, assignmentId, studentAssignment.id);
  }

  if (!thread) {
    return jsonError(cors, 404, "NOT_FOUND", "Thread not found");
  }

  const { data: tasks, error: tasksError } = await db
    .from("homework_tutor_tasks")
    .select("id, order_num, task_text, task_image_url, max_score, check_format")
    .eq("assignment_id", assignmentId)
    .order("order_num", { ascending: true });

  if (tasksError) {
    return jsonError(cors, 500, "DB_ERROR", "Failed to load tasks for thread");
  }

  const { data: profile } = await db
    .from("profiles")
    .select("id, full_name, username")
    .eq("id", studentId)
    .maybeSingle();

  return jsonOk(cors, {
    thread,
    tasks: tasks ?? [],
    student: profile ?? { id: studentId, full_name: null, username: null },
  });
}

// ─── Endpoint: POST /assignments/:id/students/:studentId/thread/messages (tutor) ──

async function handleTutorPostMessage(
  db: SupabaseClient,
  tutorUserId: string,
  assignmentId: string,
  studentId: string,
  body: unknown,
  cors: Record<string, string>,
): Promise<Response> {
  if (!isUUID(studentId)) {
    return jsonError(cors, 400, "VALIDATION", "Invalid student ID");
  }

  const assignmentOrErr = await getOwnedAssignmentOrThrow(db, assignmentId, tutorUserId, cors);
  if (assignmentOrErr instanceof Response) return assignmentOrErr;

  // Find student assignment
  const { data: sa } = await db
    .from("homework_tutor_student_assignments")
    .select("id")
    .eq("assignment_id", assignmentId)
    .eq("student_id", studentId)
    .maybeSingle();

  if (!sa) {
    return jsonError(cors, 404, "NOT_FOUND", "Student is not assigned to this homework");
  }

  // Find thread
  const { data: thread } = await db
    .from("homework_tutor_threads")
    .select("id, status, current_task_order, current_task_id")
    .eq("student_assignment_id", sa.id)
    .maybeSingle();

  if (!thread) {
    return jsonError(cors, 404, "NOT_FOUND", "Thread not found");
  }

  // Parse body
  const b = (body && typeof body === "object") ? body as Record<string, unknown> : {};
  if (!isNonEmptyString(b.content)) {
    return jsonError(cors, 400, "VALIDATION", "content is required");
  }
  const content = (b.content as string).trim();
  const visibleToStudent = b.visible_to_student !== false; // default true
  const requestedTaskOrder = typeof b.task_order === "number" ? b.task_order : undefined;
  const requestedTaskId = isUUID(b.task_id) ? b.task_id as string : undefined;
  const imageUrl = typeof b.image_url === "string" && b.image_url.trim() ? b.image_url.trim() : null;

  const { data: assignmentTasks, error: assignmentTasksError } = await db
    .from("homework_tutor_tasks")
    .select("id, order_num")
    .eq("assignment_id", assignmentId)
    .order("order_num", { ascending: true });
  if (assignmentTasksError || !assignmentTasks) {
    return jsonError(cors, 500, "DB_ERROR", "Failed to resolve task reference");
  }

  const resolvedTask = resolveTaskReference(
    assignmentTasks as GuidedTaskIdentityRow[],
    {
      taskId: requestedTaskId,
      taskOrder: requestedTaskOrder,
      fallbackTaskId: typeof thread.current_task_id === "string" ? thread.current_task_id as string : null,
      fallbackTaskOrder: thread.current_task_order as number,
    },
  );
  if (!resolvedTask) {
    return jsonError(cors, 400, "VALIDATION", "Invalid task reference");
  }
  const taskOrder = resolvedTask.order_num;
  const taskId = resolvedTask.id;

  // Insert message with role = 'tutor'
  const { data: msg, error: msgErr } = await db
    .from("homework_tutor_thread_messages")
    .insert({
      thread_id: thread.id,
      role: "tutor",
      content,
      image_url: imageUrl,
      task_id: taskId,
      task_order: taskOrder,
      message_kind: visibleToStudent ? "tutor_message" : "tutor_note",
      visible_to_student: visibleToStudent,
      author_user_id: tutorUserId,
    })
    .select("id, created_at")
    .single();

  if (msgErr) {
    console.error("tutor_post_message_error", { error: msgErr.message });
    return jsonError(cors, 500, "DB_ERROR", "Failed to save message");
  }

  // Update last_tutor_message_at
  await db
    .from("homework_tutor_threads")
    .update({ last_tutor_message_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", thread.id);

  return jsonOk(cors, { id: msg.id, created_at: msg.created_at }, 201);
}

// ─── Main Handler ────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  const cors = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: cors });
  }

  const route = parseRoute(req);
  const startTime = Date.now();

  console.log("homework_api_request_start", {
    method: route.method,
    segments: route.segments,
  });

  try {
    const authResult = await authenticateUser(req, cors);
    if (authResult instanceof Response) return authResult;
    const { userId } = authResult;

    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const seg = route.segments;

    // GET /threads/:id (student endpoint)
    if (seg.length === 2 && seg[0] === "threads" && route.method === "GET") {
      return await handleGetThread(db, userId, seg[1], cors);
    }

    // POST /threads/:id/transcribe-voice (student endpoint)
    if (seg.length === 3 && seg[0] === "threads" && seg[2] === "transcribe-voice" && route.method === "POST") {
      return await handleTranscribeThreadVoice(db, userId, seg[1], req, cors);
    }

    // POST /threads/:id/messages (student endpoint)
    if (seg.length === 3 && seg[0] === "threads" && seg[2] === "messages" && route.method === "POST") {
      const body = await parseJsonBody(req);
      return await handlePostThreadMessage(db, userId, seg[1], body, cors);
    }

    // POST /threads/:id/advance (student endpoint)
    if (seg.length === 3 && seg[0] === "threads" && seg[2] === "advance" && route.method === "POST") {
      const body = await parseJsonBody(req);
      return await handleAdvanceTask(db, userId, seg[1], body, cors);
    }

    // POST /threads/:id/check (student endpoint — Phase 3)
    if (seg.length === 3 && seg[0] === "threads" && seg[2] === "check" && route.method === "POST") {
      const body = await parseJsonBody(req);
      return await handleCheckAnswer(db, userId, seg[1], body, cors);
    }

    // POST /threads/:id/hint (student endpoint — Phase 3)
    if (seg.length === 3 && seg[0] === "threads" && seg[2] === "hint" && route.method === "POST") {
      const body = await parseJsonBody(req);
      return await handleRequestHint(db, userId, seg[1], body, cors);
    }

    // GET /assignments/:id/student (student endpoint)
    if (seg.length === 3 && seg[0] === "assignments" && seg[2] === "student" && route.method === "GET") {
      return await handleGetStudentAssignment(db, userId, seg[1], cors);
    }

    // GET /assignments/:id/tasks/:taskId/image-url (tutor + student)
    if (seg.length === 5 && seg[0] === "assignments" && seg[2] === "tasks" && seg[4] === "image-url" && route.method === "GET") {
      return await handleTaskImageSignedUrl(db, userId, seg[1], seg[3], cors);
    }

    // GET /assignments/:id/tasks/:taskId/images (tutor + student)
    if (seg.length === 5 && seg[0] === "assignments" && seg[2] === "tasks" && seg[4] === "images" && route.method === "GET") {
      return await handleTaskImagesSignedUrls(db, userId, seg[1], seg[3], cors);
    }

    // GET /formula-rounds/:roundId (student endpoint)
    if (seg.length === 2 && seg[0] === "formula-rounds" && route.method === "GET") {
      return await handleGetFormulaRound(db, userId, seg[1], cors);
    }

    // GET /formula-rounds/:roundId/results (student endpoint)
    if (seg.length === 3 && seg[0] === "formula-rounds" && seg[2] === "results" && route.method === "GET") {
      return await handleListFormulaRoundResults(db, userId, seg[1], cors);
    }

    // POST /formula-rounds/:roundId/results (student endpoint)
    if (seg.length === 3 && seg[0] === "formula-rounds" && seg[2] === "results" && route.method === "POST") {
      const body = await parseJsonBody(req);
      return await handleCreateFormulaRoundResult(db, userId, seg[1], body, cors);
    }

    const tutorResult = await getTutorOrThrow(db, userId, cors);
    if (tutorResult instanceof Response) return tutorResult;
    const tutor = tutorResult;

    // POST /assignments
    if (seg.length === 1 && seg[0] === "assignments" && route.method === "POST") {
      const body = await parseJsonBody(req);
      return await handleCreateAssignment(db, userId, body, cors);
    }

    // GET /assignments
    if (seg.length === 1 && seg[0] === "assignments" && route.method === "GET") {
      return await handleListAssignments(db, userId, route.searchParams, cors);
    }

    // GET /assignments/:id
    if (seg.length === 2 && seg[0] === "assignments" && route.method === "GET") {
      return await handleGetAssignment(db, userId, seg[1], cors);
    }

    // GET /assignments/:id/tasks/:taskId/rubric-images (tutor only)
    if (seg.length === 5 && seg[0] === "assignments" && seg[2] === "tasks" && seg[4] === "rubric-images" && route.method === "GET") {
      return await handleRubricImagesSignedUrls(db, userId, seg[1], seg[3], cors);
    }

    // GET /assignments/:id/students/:studentId/thread
    if (seg.length === 5 && seg[0] === "assignments" && seg[2] === "students" && seg[4] === "thread" && route.method === "GET") {
      return await handleGetTutorStudentThread(db, userId, seg[1], seg[3], cors);
    }

    // POST /assignments/:id/students/:studentId/thread/messages (tutor)
    if (seg.length === 6 && seg[0] === "assignments" && seg[2] === "students" && seg[4] === "thread" && seg[5] === "messages" && route.method === "POST") {
      const body = await parseJsonBody(req);
      return await handleTutorPostMessage(db, userId, seg[1], seg[3], body, cors);
    }



    // PUT /assignments/:id
    if (seg.length === 2 && seg[0] === "assignments" && route.method === "PUT") {
      const body = await parseJsonBody(req);
      return await handleUpdateAssignment(db, userId, seg[1], body, cors);
    }

    // DELETE /assignments/:id
    if (seg.length === 2 && seg[0] === "assignments" && route.method === "DELETE") {
      return await handleDeleteAssignment(db, userId, seg[1], cors);
    }

    // POST /assignments/:id/assign
    if (seg.length === 3 && seg[0] === "assignments" && seg[2] === "assign" && route.method === "POST") {
      const body = await parseJsonBody(req);
      return await handleAssignStudents(db, userId, tutor.id, seg[1], body, cors);
    }

    // POST /assignments/:id/notify
    if (seg.length === 3 && seg[0] === "assignments" && seg[2] === "notify" && route.method === "POST") {
      const body = await parseJsonBody(req);
      return await handleNotifyStudents(db, userId, seg[1], body, cors);
    }

    // POST /assignments/:id/students/:sid/remind
    if (seg.length === 5 && seg[0] === "assignments" && seg[2] === "students" && seg[4] === "remind" && route.method === "POST") {
      const body = await parseJsonBody(req);
      return await handleRemindStudent(db, userId, seg[1], seg[3], body, cors);
    }

    // GET /assignments/:id/results
    if (seg.length === 3 && seg[0] === "assignments" && seg[2] === "results" && route.method === "GET") {
      return await handleGetResults(db, userId, seg[1], cors);
    }

    // PATCH /assignments/:id/students/:sid/tasks/:tid/score-override
    if (
      seg.length === 7 &&
      seg[0] === "assignments" &&
      seg[2] === "students" &&
      seg[4] === "tasks" &&
      seg[6] === "score-override" &&
      route.method === "PATCH"
    ) {
      const body = await parseJsonBody(req) as Record<string, unknown>;
      return await handleSetTutorScoreOverride(db, userId, seg[1], seg[3], seg[5], body, cors);
    }

    // POST /assignments/:id/materials
    if (seg.length === 3 && seg[0] === "assignments" && seg[2] === "materials" && route.method === "POST") {
      const body = await parseJsonBody(req);
      return await handleAddMaterial(db, userId, seg[1], body, cors);
    }

    // DELETE /assignments/:id/materials/:mid
    if (seg.length === 4 && seg[0] === "assignments" && seg[2] === "materials" && route.method === "DELETE") {
      return await handleDeleteMaterial(db, userId, seg[1], seg[3], cors);
    }

    // GET /assignments/:id/materials/:mid/signed-url
    if (seg.length === 5 && seg[0] === "assignments" && seg[2] === "materials" && seg[4] === "signed-url" && route.method === "GET") {
      return await handleMaterialSignedUrl(db, userId, seg[1], seg[3], cors);
    }

    // GET /templates
    if (seg.length === 1 && seg[0] === "templates" && route.method === "GET") {
      return await handleListTemplates(db, userId, route.searchParams, cors);
    }

    // POST /templates
    if (seg.length === 1 && seg[0] === "templates" && route.method === "POST") {
      const body = await parseJsonBody(req);
      return await handleCreateTemplate(db, userId, body, cors);
    }

    // GET /templates/:id
    if (seg.length === 2 && seg[0] === "templates" && route.method === "GET") {
      return await handleGetTemplate(db, userId, seg[1], cors);
    }

    // DELETE /templates/:id
    if (seg.length === 2 && seg[0] === "templates" && route.method === "DELETE") {
      return await handleDeleteTemplate(db, userId, seg[1], cors);
    }

    return jsonError(cors, 404, "NOT_FOUND", `Route not found: ${route.method} /${seg.join("/")}`);
  } catch (err) {
    const elapsed = Date.now() - startTime;
    console.error("homework_api_request_error", {
      error: String(err),
      elapsed_ms: elapsed,
    });
    return jsonError(cors, 500, "INTERNAL_ERROR", "Internal server error");
  }
});
