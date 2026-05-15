// Mock Exams v1 — tutor-side API (TASK-3 of mock-exams-v1).
//
// Endpoints:
//   POST   /assignments                              — create (auto + manual_entry)
//   GET    /assignments                              — list по tutor_id (RLS)
//   GET    /assignments/:id                          — detail с attempts + ученики
//   GET    /attempts/:id                             — single attempt + AI draft + photos signed URLs
//   POST   /attempts/:id/approve-task                — approve один Часть-2 task
//   POST   /attempts/:id/approve-all                 — все 6 закрыты + status → approved
//   POST   /assignments/:id/invite-link              — 8-char slug → mock_exam_public_links
//   GET    /assignments/:id/invite-links             — список ссылок (FIX-4b)
//
// Spec: docs/delivery/features/mock-exams-v1/spec.md §5 API
// Migration: supabase/migrations/20260508120000_mock_exams_v1_schema.sql
//
// Architecture decisions:
//   - service_role client (auth.persistSession=false) — обходит RLS, валидируем ownership вручную
//   - Auth через GoTrue REST (как в homework-api/index.ts) — стабильнее SDK
//   - signed URLs для photo обёрнуты в rewriteToProxy() — RU bypass
//   - Approve-task / approve-all требуют explicit ownership-check + part-1 completed gate
//   - Cascade delivery (push → telegram → email) при approve-all — best-effort, не блокирует ответ

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  sendPushNotification,
  type PushPayload,
  type PushSubscriptionData,
} from "../_shared/push-sender.ts";
import { rewriteToProxy } from "../_shared/proxy-url.ts";

// ─── Constants ───────────────────────────────────────────────────────────────

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:support@sokratai.ru";

const VALID_MODES = ["blank", "form", "manual_entry"] as const;
const SLUG_RE = /^[a-z0-9]{8}$/i;
const SLUG_MAX_RETRIES = 5;
const SLUG_EXPIRY_MAX_DAYS = 365;
const SIGNED_URL_TTL_SEC = 3600;
const BLANK_BUCKET = "mock-exam-blanks";
const PART2_PHOTO_BUCKET = "mock-exam-part2-photos";

const FALLBACK_ORIGINS = [
  "https://sokratai.ru",
  "https://sokratai.lovable.app",
  "http://localhost:8080",
  "http://localhost:5173",
];

// ─── CORS ────────────────────────────────────────────────────────────────────

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
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

// ─── Helpers: response ───────────────────────────────────────────────────────

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

// ─── Helpers: validation ─────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUUID(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
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

// Phase 6 review-fix #4: compare two number arrays as sets (order-independent,
// duplicate-tolerant). Used to detect actual assignment changes in
// /assign-part2-photos.
function arraysEqualAsSets(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  for (const x of b) if (!set.has(x)) return false;
  return true;
}

function isISODate(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const d = new Date(v);
  return !Number.isNaN(d.getTime());
}

async function parseJsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

// ─── Helpers: auth ───────────────────────────────────────────────────────────

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
  // Validate via GoTrue REST — same pattern as homework-api.
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
  return { userId: user.id };
}

// ─── Helpers: ownership + feature flag ───────────────────────────────────────

async function ensureMockExamFlagEnabled(
  db: SupabaseClient,
  tutorUserId: string,
  cors: Record<string, string>,
): Promise<true | Response> {
  const { data, error } = await db
    .from("tutors")
    .select("feature_mock_exams_enabled")
    .eq("user_id", tutorUserId)
    .maybeSingle();
  if (error) {
    console.error("mock_exam_api_flag_check_failed", { error: error.message });
    return jsonError(cors, 500, "DB_ERROR", "Failed to check feature flag");
  }
  if (!data) {
    return jsonError(cors, 403, "NOT_TUTOR", "Tutor profile not found");
  }
  if (!data.feature_mock_exams_enabled) {
    // AC-8: tutor without flag must see 404, not 403, чтобы не утечь
    // существование фичи. SideNav прячет entry self-side.
    return jsonError(cors, 404, "NOT_FOUND", "Resource not found");
  }
  return true;
}

async function getOwnedAssignmentOrThrow(
  db: SupabaseClient,
  assignmentId: string,
  tutorUserId: string,
  cors: Record<string, string>,
): Promise<Record<string, unknown> | Response> {
  if (!isUUID(assignmentId)) {
    return jsonError(cors, 400, "INVALID_ID", "Invalid assignment ID");
  }
  const { data, error } = await db
    .from("mock_exam_assignments")
    .select("*")
    .eq("id", assignmentId)
    .maybeSingle();
  if (error) {
    return jsonError(cors, 500, "DB_ERROR", "Failed to load assignment");
  }
  if (!data) {
    return jsonError(cors, 404, "NOT_FOUND", "Assignment not found");
  }
  if (data.tutor_id !== tutorUserId) {
    return jsonError(cors, 403, "FORBIDDEN", "Assignment does not belong to you");
  }
  return data as Record<string, unknown>;
}

async function getOwnedAttemptOrThrow(
  db: SupabaseClient,
  attemptId: string,
  tutorUserId: string,
  cors: Record<string, string>,
): Promise<{ attempt: Record<string, unknown>; assignment: Record<string, unknown> } | Response> {
  if (!isUUID(attemptId)) {
    return jsonError(cors, 400, "INVALID_ID", "Invalid attempt ID");
  }
  const { data: attempt, error } = await db
    .from("mock_exam_attempts")
    .select("*")
    .eq("id", attemptId)
    .maybeSingle();
  if (error) return jsonError(cors, 500, "DB_ERROR", "Failed to load attempt");
  if (!attempt) return jsonError(cors, 404, "NOT_FOUND", "Attempt not found");

  const assignmentOrErr = await getOwnedAssignmentOrThrow(
    db,
    attempt.assignment_id as string,
    tutorUserId,
    cors,
  );
  if (assignmentOrErr instanceof Response) return assignmentOrErr;

  return { attempt, assignment: assignmentOrErr };
}

// ─── Helpers: variant lookup ─────────────────────────────────────────────────

interface VariantRow {
  id: string;
  title: string;
  exam_type: string;
  duration_minutes: number;
  total_max_score: number;
  part1_max: number;
  part2_max: number;
  task_count: number;
}

async function getVariantOrThrow(
  db: SupabaseClient,
  variantId: string,
  cors: Record<string, string>,
): Promise<VariantRow | Response> {
  const { data, error } = await db
    .from("mock_exam_variants")
    .select("id, title, exam_type, duration_minutes, total_max_score, part1_max, part2_max, task_count")
    .eq("id", variantId)
    .maybeSingle();
  if (error) return jsonError(cors, 500, "DB_ERROR", "Failed to load variant");
  if (!data) return jsonError(cors, 404, "NOT_FOUND", "Variant not found");
  return data as VariantRow;
}

// ─── Helpers: storage ───────────────────────────────────────────────────────

function parseStorageRef(ref: string | null | undefined): { bucket: string; path: string } | null {
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

async function resolveSignedUrl(
  db: SupabaseClient,
  ref: string | null,
): Promise<string | null> {
  const parsed = parseStorageRef(ref);
  if (!parsed) return null;
  const { data, error } = await db.storage
    .from(parsed.bucket)
    .createSignedUrl(parsed.path, SIGNED_URL_TTL_SEC);
  if (error || !data?.signedUrl) {
    console.warn("mock_exam_api_signed_url_failed", {
      bucket: parsed.bucket,
      error: error?.message,
    });
    return null;
  }
  // RU bypass — see CLAUDE.md «Network & Infrastructure».
  return rewriteToProxy(data.signedUrl);
}

// ─── Helpers: student display name ───────────────────────────────────────────

const AUTO_USERNAME_RE = /^(telegram_|user_)\d+$/i;

interface StudentNameRow {
  user_id: string;
  display_name: string | null;
}

async function resolveStudentDisplayNames(
  db: SupabaseClient,
  tutorUserId: string,
  studentIds: string[],
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (studentIds.length === 0) return out;

  // Primary: tutor_students.display_name (tutor-owned).
  const { data: tutorStudents } = await db
    .from("tutor_students")
    .select("user_id, display_name")
    .eq("tutor_user_id", tutorUserId)
    .in("user_id", studentIds);
  for (const row of (tutorStudents ?? []) as StudentNameRow[]) {
    if (isNonEmptyString(row.display_name)) {
      out.set(row.user_id, row.display_name);
    }
  }

  // Fallback: profiles.username (filter auto-generated).
  const missing = studentIds.filter((id) => !out.has(id));
  if (missing.length > 0) {
    const { data: profiles } = await db
      .from("profiles")
      .select("id, username")
      .in("id", missing);
    for (const p of profiles ?? []) {
      const username = p.username as string | null;
      if (username && !AUTO_USERNAME_RE.test(username)) {
        out.set(p.id as string, username);
      } else {
        out.set(p.id as string, null);
      }
    }
  }

  for (const id of studentIds) {
    if (!out.has(id)) out.set(id, null);
  }
  return out;
}

// ─── Slug generation ─────────────────────────────────────────────────────────

function generateSlug(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 8).toLowerCase();
}

function getAppBaseUrl(): string {
  return (
    Deno.env.get("PUBLIC_APP_URL")?.trim().replace(/\/$/, "") ??
    "https://sokratai.ru"
  );
}

// ─── Cascade delivery (best-effort) ──────────────────────────────────────────

interface CascadeResult {
  channel: "push" | "telegram" | "email" | null;
  failed_reason: string | null;
}

async function notifyStudentApproved(
  db: SupabaseClient,
  studentId: string,
  assignmentId: string,
  attemptId: string,
  assignmentTitle: string,
): Promise<CascadeResult> {
  const appUrl = getAppBaseUrl();
  const url = `${appUrl}/student/mock-exams/${attemptId}/result`;
  const pushPayload: PushPayload = {
    title: `Пробник проверен: ${assignmentTitle}`,
    body: "Репетитор подтвердил результат — открой разбор.",
    url,
  };

  // 1) Push
  if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    const { data: subs } = await db
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth")
      .eq("user_id", studentId);
    for (const sub of (subs ?? []) as PushSubscriptionData[]) {
      try {
        const result = await sendPushNotification(
          sub,
          pushPayload,
          VAPID_PUBLIC_KEY,
          VAPID_PRIVATE_KEY,
          VAPID_SUBJECT,
        );
        if (result.success) {
          return { channel: "push", failed_reason: null };
        }
      } catch (err) {
        console.warn("mock_exam_push_send_error", { error: String(err) });
      }
    }
  }

  // 2) Telegram fallback
  if (TELEGRAM_BOT_TOKEN) {
    const { data: profile } = await db
      .from("profiles")
      .select("telegram_user_id")
      .eq("id", studentId)
      .maybeSingle();
    let chatId = (profile?.telegram_user_id as number | null) ?? null;
    if (!chatId) {
      const { data: session } = await db
        .from("telegram_sessions")
        .select("telegram_user_id")
        .eq("user_id", studentId)
        .maybeSingle();
      chatId = (session?.telegram_user_id as number | null) ?? null;
    }
    if (chatId) {
      try {
        const tgResp = await fetch(
          `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              text: `📊 Пробник проверен: ${assignmentTitle}\n\n${url}`,
              parse_mode: "HTML",
              disable_web_page_preview: false,
            }),
          },
        );
        if (tgResp.ok) {
          return { channel: "telegram", failed_reason: null };
        }
      } catch (err) {
        console.warn("mock_exam_telegram_send_error", { error: String(err) });
      }
    }
  }

  // 3) Email — left to homework-style email-sender follow-up; for now report no channel.
  return { channel: null, failed_reason: "no_channels_available" };
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
  const idx = pathname.indexOf("mock-exam-tutor-api");
  const rest = idx >= 0 ? pathname.slice(idx + "mock-exam-tutor-api".length) : "";
  const segments = rest.split("/").filter(Boolean);
  return { segments, method: req.method, searchParams: url.searchParams };
}

// ────────────────────────────────────────────────────────────────────────────
// Endpoint: POST /assignments
// ────────────────────────────────────────────────────────────────────────────

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

  const mode = b.mode as string | undefined;
  if (!mode || !VALID_MODES.includes(mode as typeof VALID_MODES[number])) {
    return jsonError(cors, 400, "VALIDATION", `mode must be one of ${VALID_MODES.join(", ")}`);
  }
  if (!isNonEmptyString(b.title)) {
    return jsonError(cors, 400, "VALIDATION", "title is required");
  }
  if ((b.title as string).length > 200) {
    return jsonError(cors, 400, "VALIDATION", "title is too long (max 200 chars)");
  }

  // ─── manual_entry branch ──────────────────────────────────────────────────
  if (mode === "manual_entry") {
    if (b.variant_id) {
      return jsonError(cors, 400, "VALIDATION", "variant_id must be null for manual_entry");
    }
    if (!isNonEmptyString(b.variant_title)) {
      return jsonError(cors, 400, "VALIDATION", "variant_title is required for manual_entry");
    }
    if (b.deadline) {
      return jsonError(cors, 400, "VALIDATION", "deadline must be null for manual_entry");
    }
    const me = b.manual_entry as Record<string, unknown> | undefined;
    if (!me || typeof me !== "object") {
      return jsonError(cors, 400, "VALIDATION", "manual_entry payload is required");
    }
    if (!isUUID(me.student_id)) {
      return jsonError(cors, 400, "VALIDATION", "manual_entry.student_id must be a UUID");
    }
    if (!isNonEmptyString(me.manual_entered_date) || !isISODate(me.manual_entered_date)) {
      return jsonError(cors, 400, "VALIDATION", "manual_entry.manual_entered_date must be an ISO date");
    }
    if (!isNonNegativeInt(me.total_score)) {
      return jsonError(cors, 400, "VALIDATION", "manual_entry.total_score must be a non-negative integer");
    }
    if (!isPositiveInt(me.total_max_score)) {
      return jsonError(cors, 400, "VALIDATION", "manual_entry.total_max_score must be a positive integer");
    }
    if ((me.total_score as number) > (me.total_max_score as number)) {
      return jsonError(cors, 400, "VALIDATION", "total_score cannot exceed total_max_score");
    }

    // Insert assignment.
    const { data: assignment, error: insertErr } = await db
      .from("mock_exam_assignments")
      .insert({
        variant_id: null,
        variant_title: (b.variant_title as string).trim(),
        tutor_id: tutorUserId,
        title: (b.title as string).trim(),
        mode: "manual_entry",
        deadline: null,
        status: "active",
      })
      .select("id")
      .single();
    if (insertErr || !assignment) {
      console.error("mock_exam_create_manual_failed", { error: insertErr?.message });
      return jsonError(cors, 500, "DB_ERROR", "Failed to create manual entry");
    }

    // Attempt: terminal manually_entered.
    const { error: attemptErr } = await db
      .from("mock_exam_attempts")
      .insert({
        assignment_id: assignment.id,
        student_id: me.student_id,
        anonymous_id: null,
        status: "manually_entered",
        started_at: null,
        submitted_at: null,
        total_part1_score: null,
        total_part2_score: null,
        total_score: me.total_score,
        manual_entered_date: me.manual_entered_date,
        manual_comment: isNonEmptyString(me.manual_comment) ? (me.manual_comment as string).trim() : null,
      });
    if (attemptErr) {
      // Roll back the assignment to avoid orphans (best-effort).
      await db.from("mock_exam_assignments").delete().eq("id", assignment.id);
      console.error("mock_exam_create_manual_attempt_failed", { error: attemptErr.message });
      return jsonError(cors, 500, "DB_ERROR", "Failed to create manual attempt");
    }

    return jsonOk(cors, { assignment_id: assignment.id, attempts_created: 1 }, 201);
  }

  // ─── auto branch (blank | form) ───────────────────────────────────────────
  if (!isUUID(b.variant_id)) {
    return jsonError(cors, 400, "VALIDATION", "variant_id is required for blank/form");
  }
  if (b.variant_title) {
    return jsonError(cors, 400, "VALIDATION", "variant_title must be null for blank/form");
  }
  const variantOrErr = await getVariantOrThrow(db, b.variant_id as string, cors);
  if (variantOrErr instanceof Response) return variantOrErr;

  if (b.deadline !== undefined && b.deadline !== null && !isISODate(b.deadline)) {
    return jsonError(cors, 400, "VALIDATION", "deadline must be null or ISO timestamp");
  }
  if (!Array.isArray(b.student_ids) || b.student_ids.length === 0) {
    return jsonError(cors, 400, "VALIDATION", "student_ids is required and non-empty for blank/form");
  }
  const studentIds = Array.from(new Set(b.student_ids as string[]));
  const invalidIds = studentIds.filter((id) => !isUUID(id));
  if (invalidIds.length > 0) {
    return jsonError(cors, 400, "VALIDATION", "student_ids must be UUIDs", { invalid_student_ids: invalidIds });
  }

  // Insert assignment.
  const { data: assignment, error: insertErr } = await db
    .from("mock_exam_assignments")
    .insert({
      variant_id: b.variant_id,
      variant_title: null,
      tutor_id: tutorUserId,
      title: (b.title as string).trim(),
      mode,
      deadline: (b.deadline as string | null | undefined) ?? null,
      status: "active",
    })
    .select("id")
    .single();
  if (insertErr || !assignment) {
    console.error("mock_exam_create_failed", { error: insertErr?.message });
    return jsonError(cors, 500, "DB_ERROR", "Failed to create assignment");
  }

  // Bulk-insert attempts in 'in_progress' state. Per AC-1: spec говорит
  // not_started, но real DB enum использует in_progress как initial — это
  // ровный baseline, started_at NULL до первого student start.
  const attemptRows = studentIds.map((sid) => ({
    assignment_id: assignment.id,
    student_id: sid,
    anonymous_id: null,
    status: "in_progress" as const,
    started_at: null,
  }));
  const { error: attemptsErr } = await db
    .from("mock_exam_attempts")
    .insert(attemptRows);
  if (attemptsErr) {
    // Roll back assignment to avoid orphan.
    await db.from("mock_exam_assignments").delete().eq("id", assignment.id);
    console.error("mock_exam_create_attempts_failed", { error: attemptsErr.message });
    return jsonError(cors, 500, "DB_ERROR", "Failed to create attempts", {
      detail: attemptsErr.message,
    });
  }

  return jsonOk(
    cors,
    { assignment_id: assignment.id, attempts_created: studentIds.length },
    201,
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Endpoint: GET /assignments
// ────────────────────────────────────────────────────────────────────────────

async function handleListAssignments(
  db: SupabaseClient,
  tutorUserId: string,
  cors: Record<string, string>,
): Promise<Response> {
  const { data: assignments, error } = await db
    .from("mock_exam_assignments")
    .select("id, variant_id, variant_title, tutor_id, title, mode, deadline, status, created_at")
    .eq("tutor_id", tutorUserId)
    .order("created_at", { ascending: false });
  if (error) {
    return jsonError(cors, 500, "DB_ERROR", "Failed to list assignments");
  }

  const rows = assignments ?? [];
  const variantIds = Array.from(
    new Set(rows.map((r) => r.variant_id).filter((v): v is string => typeof v === "string")),
  );
  const variantsById: Record<string, VariantRow> = {};
  if (variantIds.length > 0) {
    const { data: variants } = await db
      .from("mock_exam_variants")
      .select("id, title, exam_type, duration_minutes, total_max_score, part1_max, part2_max, task_count")
      .in("id", variantIds);
    for (const v of (variants ?? []) as VariantRow[]) {
      variantsById[v.id] = v;
    }
  }

  const assignmentIds = rows.map((r) => r.id as string);
  // Counters (TASK-11 review fix 2026-05-14):
  //   - total:               all attempt rows
  //   - in_progress:         status='in_progress' AND started_at IS NOT NULL
  //   - not_started:         status='in_progress' AND started_at IS NULL
  //   - submitted:           status IN ('submitted', 'ai_checking')
  //   - awaiting_review:     status='awaiting_review'
  //   - approved:            status IN ('approved', 'manually_entered')
  //   - completed_total:     submitted + awaiting_review + approved (= «Сдали»)
  //   - pending_review:      submitted + awaiting_review (= «Требует проверки»)
  // Frontend reads these fields DIRECTLY — no NaN-prone subtraction formula.
  type Counts = {
    total: number; in_progress: number; not_started: number;
    submitted: number; awaiting: number; approved: number;
  };
  const counts: Record<string, Counts> = {};
  for (const id of assignmentIds) {
    counts[id] = {
      total: 0, in_progress: 0, not_started: 0,
      submitted: 0, awaiting: 0, approved: 0,
    };
  }
  if (assignmentIds.length > 0) {
    const { data: attempts } = await db
      .from("mock_exam_attempts")
      .select("assignment_id, status, started_at")
      .in("assignment_id", assignmentIds);
    for (const a of attempts ?? []) {
      const aid = a.assignment_id as string;
      const bucket = counts[aid];
      if (!bucket) continue;
      bucket.total += 1;
      if (a.status === "submitted" || a.status === "ai_checking") bucket.submitted += 1;
      else if (a.status === "awaiting_review") bucket.awaiting += 1;
      else if (a.status === "approved" || a.status === "manually_entered") bucket.approved += 1;
      else if (a.status === "in_progress") {
        if (a.started_at === null) bucket.not_started += 1;
        else bucket.in_progress += 1;
      }
    }
  }

  const items = rows.map((r) => {
    const variant = r.variant_id ? variantsById[r.variant_id as string] : null;
    const c = counts[r.id as string] ?? {
      total: 0, in_progress: 0, not_started: 0,
      submitted: 0, awaiting: 0, approved: 0,
    };
    const completedTotal = c.submitted + c.awaiting + c.approved;
    const pendingReview = c.submitted + c.awaiting;
    return {
      id: r.id,
      variant_id: r.variant_id,
      variant_title: r.variant_title,
      tutor_id: r.tutor_id,
      title: r.title,
      mode: r.mode,
      deadline: r.deadline,
      status: r.status,
      created_at: r.created_at,
      display_title: r.variant_title ?? variant?.title ?? r.title,
      exam_type: variant?.exam_type ?? null,
      // Legacy fields (kept for backward compat — old frontend bundles).
      attempts_total: c.total,
      attempts_submitted: c.submitted,
      attempts_awaiting_review: c.awaiting,
      attempts_approved: c.approved,
      attempts_not_started: c.not_started,
      // New fields (TASK-11) — frontend reads directly, no math.
      attempts_in_progress: c.in_progress,
      attempts_completed_total: completedTotal,
      attempts_pending_review: pendingReview,
    };
  });

  return jsonOk(cors, { items });
}

// ────────────────────────────────────────────────────────────────────────────
// Endpoint: GET /assignments/:id
// ────────────────────────────────────────────────────────────────────────────

async function handleGetAssignment(
  db: SupabaseClient,
  tutorUserId: string,
  assignmentId: string,
  cors: Record<string, string>,
): Promise<Response> {
  const assignmentOrErr = await getOwnedAssignmentOrThrow(db, assignmentId, tutorUserId, cors);
  if (assignmentOrErr instanceof Response) return assignmentOrErr;
  const assignment = assignmentOrErr;

  let variant: VariantRow | null = null;
  if (assignment.variant_id) {
    const { data } = await db
      .from("mock_exam_variants")
      .select("id, title, exam_type, duration_minutes, total_max_score, part1_max, part2_max, task_count")
      .eq("id", assignment.variant_id as string)
      .maybeSingle();
    if (data) variant = data as VariantRow;
  }

  const { data: attemptRows, error: attemptsErr } = await db
    .from("mock_exam_attempts")
    .select(
      "id, assignment_id, student_id, anonymous_id, status, started_at, submitted_at, " +
      "total_time_minutes, total_part1_score, total_part2_score, total_score, " +
      "manual_entered_date, manual_comment, created_at, answer_method",
    )
    .eq("assignment_id", assignmentId)
    .order("created_at", { ascending: true });
  if (attemptsErr) {
    return jsonError(cors, 500, "DB_ERROR", "Failed to load attempts");
  }

  const studentIds = (attemptRows ?? [])
    .map((a) => a.student_id as string | null)
    .filter((id): id is string => Boolean(id));
  const namesByStudent = await resolveStudentDisplayNames(db, tutorUserId, studentIds);

  const attempts = (attemptRows ?? []).map((a) => ({
    id: a.id,
    assignment_id: a.assignment_id,
    student_id: a.student_id,
    anonymous_id: a.anonymous_id,
    student_display_name: a.student_id ? namesByStudent.get(a.student_id as string) ?? null : null,
    status: a.status,
    started_at: a.started_at,
    submitted_at: a.submitted_at,
    total_time_minutes: a.total_time_minutes,
    total_part1_score: a.total_part1_score,
    total_part2_score: a.total_part2_score,
    total_score: a.total_score,
    manual_entered_date: a.manual_entered_date,
    manual_comment: a.manual_comment,
    answer_method: a.answer_method ?? null,
  }));

  // Aggregate counts (TASK-11) — same semantics как в handleGetAssignmentsList.
  // Frontend читает напрямую, без NaN-prone subtraction.
  let aggInProgress = 0, aggNotStarted = 0, aggSubmitted = 0,
    aggAwaiting = 0, aggApproved = 0;
  for (const a of attempts) {
    if (a.status === "submitted" || a.status === "ai_checking") aggSubmitted++;
    else if (a.status === "awaiting_review") aggAwaiting++;
    else if (a.status === "approved" || a.status === "manually_entered") aggApproved++;
    else if (a.status === "in_progress") {
      if (a.started_at === null) aggNotStarted++;
      else aggInProgress++;
    }
  }
  const aggregate = {
    attempts_total: attempts.length,
    attempts_in_progress: aggInProgress,
    attempts_not_started: aggNotStarted,
    attempts_submitted: aggSubmitted,
    attempts_awaiting_review: aggAwaiting,
    attempts_approved: aggApproved,
    attempts_completed_total: aggSubmitted + aggAwaiting + aggApproved,
    attempts_pending_review: aggSubmitted + aggAwaiting,
  };

  return jsonOk(cors, {
    id: assignment.id,
    variant_id: assignment.variant_id,
    variant_title: assignment.variant_title,
    tutor_id: assignment.tutor_id,
    title: assignment.title,
    mode: assignment.mode,
    deadline: assignment.deadline,
    status: assignment.status,
    created_at: assignment.created_at,
    display_title: (assignment.variant_title as string | null) ?? variant?.title ?? (assignment.title as string),
    exam_type: variant?.exam_type ?? null,
    duration_minutes: variant?.duration_minutes ?? null,
    total_max_score: variant?.total_max_score ?? null,
    attempts,
    aggregate,
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Endpoint: GET /attempts/:id
// ────────────────────────────────────────────────────────────────────────────

async function handleGetAttempt(
  db: SupabaseClient,
  tutorUserId: string,
  attemptId: string,
  cors: Record<string, string>,
): Promise<Response> {
  const ownedOrErr = await getOwnedAttemptOrThrow(db, attemptId, tutorUserId, cors);
  if (ownedOrErr instanceof Response) return ownedOrErr;
  const { attempt, assignment } = ownedOrErr;

  // Variant-driven canonical task data (text + correct answer + max_score).
  const variantTasks: Record<number, {
    task_text: string;
    task_image_url: string | null;
    correct_answer: string | null;
    check_mode: string | null;
    max_score: number;
    solution_text: string | null;
    part: number;
  }> = {};
  let examType: string | null = null;
  let totalMaxScore: number | null = null;

  if (assignment.variant_id) {
    const { data: tasks } = await db
      .from("mock_exam_variant_tasks")
      .select("kim_number, part, task_text, task_image_url, correct_answer, check_mode, max_score, solution_text")
      .eq("variant_id", assignment.variant_id as string);
    for (const t of tasks ?? []) {
      variantTasks[t.kim_number as number] = {
        task_text: t.task_text as string,
        task_image_url: t.task_image_url as string | null,
        correct_answer: t.correct_answer as string | null,
        check_mode: t.check_mode as string | null,
        max_score: t.max_score as number,
        solution_text: t.solution_text as string | null,
        part: t.part as number,
      };
    }
    const { data: variant } = await db
      .from("mock_exam_variants")
      .select("exam_type, total_max_score")
      .eq("id", assignment.variant_id as string)
      .maybeSingle();
    if (variant) {
      examType = variant.exam_type as string;
      totalMaxScore = variant.total_max_score as number;
    }
  }

  // Part 1 answers. Backend выдаёт row на КАЖДЫЙ KIM из variant'a (1..20 для
  // ЕГЭ физики), даже если ученик не ответил — frontend (review surface)
  // нуждается в полном списке для manual scoring inputs blank-mode (TASK-11).
  // Existing answers переопределяют placeholders.
  const { data: part1Rows } = await db
    .from("mock_exam_attempt_part1_answers")
    .select("kim_number, student_answer, earned_score")
    .eq("attempt_id", attemptId)
    .order("kim_number", { ascending: true });
  const answersByKim = new Map<number, { student_answer: string | null; earned_score: number | null }>();
  for (const row of part1Rows ?? []) {
    answersByKim.set(row.kim_number as number, {
      student_answer: row.student_answer as string | null,
      earned_score: row.earned_score as number | null,
    });
  }
  const part1VariantTasks = Object.entries(variantTasks)
    .filter(([, t]) => t.part === 1)
    .map(([kimStr, t]) => ({ kim: Number(kimStr), variant: t }))
    .sort((a, b) => a.kim - b.kim);
  const part1Answers = part1VariantTasks.map(({ kim, variant }) => {
    const ans = answersByKim.get(kim);
    return {
      kim_number: kim,
      student_answer: ans?.student_answer ?? null,
      earned_score: ans?.earned_score ?? null,
      correct_answer: variant.correct_answer,
      max_score: variant.max_score,
      check_mode: variant.check_mode,
    };
  });

  // Part 2 solutions + signed photo URLs.
  const { data: part2Rows } = await db
    .from("mock_exam_attempt_part2_solutions")
    .select("kim_number, photo_url, ai_draft_json, tutor_score, tutor_comment, status")
    .eq("attempt_id", attemptId)
    .order("kim_number", { ascending: true });

  const part2Solutions = await Promise.all(
    (part2Rows ?? []).map(async (row) => {
      const variant = variantTasks[row.kim_number as number];
      const signed = await resolveSignedUrl(db, row.photo_url as string | null);
      return {
        kim_number: row.kim_number,
        photo_url: signed,
        ai_draft: row.ai_draft_json,
        tutor_score: row.tutor_score,
        tutor_comment: row.tutor_comment,
        status: row.status,
        task_text: variant?.task_text ?? "",
        task_image_url: variant?.task_image_url ?? null,
        max_score: variant?.max_score ?? 0,
        solution_text: variant?.solution_text ?? null,
      };
    }),
  );

  // Resolve photo signed URLs (TASK-10/11).
  const blankPhotoUrl = await resolveSignedUrl(db, attempt.blank_photo_url as string | null);
  const part1BlankPhotoUrl = await resolveSignedUrl(db, attempt.part1_blank_photo_url as string | null);

  // part2_bulk_photo_urls — dual-format (single ref OR JSON-array string)
  const part2BulkRefs: string[] = (() => {
    const raw = attempt.part2_bulk_photo_urls as string | null;
    if (!raw) return [];
    const trimmed = raw.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.filter((x): x is string => typeof x === "string" && x.length > 0);
        }
      } catch { /* corrupted → empty */ }
      return [];
    }
    return [trimmed];
  })();
  const part2BulkPhotoUrls = (
    await Promise.all(part2BulkRefs.map((ref) => resolveSignedUrl(db, ref)))
  ).filter((url): url is string => typeof url === "string");

  // Resolve student name.
  let studentDisplayName: string | null = null;
  if (attempt.student_id) {
    const namesByStudent = await resolveStudentDisplayNames(db, tutorUserId, [attempt.student_id as string]);
    studentDisplayName = namesByStudent.get(attempt.student_id as string) ?? null;
  }

  return jsonOk(cors, {
    id: attempt.id,
    assignment_id: attempt.assignment_id,
    assignment_title: assignment.title,
    variant_id: assignment.variant_id,
    exam_type: examType,
    mode: assignment.mode,
    student_id: attempt.student_id,
    anonymous_id: attempt.anonymous_id,
    student_display_name: studentDisplayName,
    status: attempt.status,
    started_at: attempt.started_at,
    submitted_at: attempt.submitted_at,
    total_time_minutes: attempt.total_time_minutes,
    blank_photo_url: blankPhotoUrl,
    // NEW (TASK-11): expose per-attempt mode + extended photo fields для review UI.
    answer_method: attempt.answer_method ?? null,
    part1_blank_photo_url: part1BlankPhotoUrl,
    part2_bulk_photo_urls: part2BulkPhotoUrls,
    total_part1_score: attempt.total_part1_score,
    total_part2_score: attempt.total_part2_score,
    total_score: attempt.total_score,
    total_max_score: totalMaxScore,
    manual_entered_date: attempt.manual_entered_date,
    manual_comment: attempt.manual_comment,
    part1_answers: part1Answers,
    part2_solutions: part2Solutions,
    // Phase 6 (2026-05-15) — review-fix #5: expose tutor-only OCR result для
    // Part1BlankReviewPanel. Frontend type `MockExamAttemptDetail.ai_part1_ocr_json`
    // ожидает этот field. Anti-leak: tutor-only по контракту §22 — student endpoint
    // (handleGetResult в mock-exam-student-api) НЕ селектит это поле.
    ai_part1_ocr_json: attempt.ai_part1_ocr_json ?? null,
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Endpoint: POST /attempts/:id/approve-task
// ────────────────────────────────────────────────────────────────────────────

async function handleApproveTask(
  db: SupabaseClient,
  tutorUserId: string,
  attemptId: string,
  body: unknown,
  cors: Record<string, string>,
): Promise<Response> {
  const ownedOrErr = await getOwnedAttemptOrThrow(db, attemptId, tutorUserId, cors);
  if (ownedOrErr instanceof Response) return ownedOrErr;
  const { attempt, assignment } = ownedOrErr;

  if (attempt.status === "approved") {
    return jsonError(cors, 409, "ALREADY_APPROVED", "Attempt is already approved");
  }
  if (attempt.status === "manually_entered") {
    return jsonError(cors, 409, "MANUALLY_ENTERED", "Manual entry attempts cannot be approved");
  }

  if (!body || typeof body !== "object") {
    return jsonError(cors, 400, "INVALID_BODY", "Request body must be a JSON object");
  }
  const b = body as Record<string, unknown>;
  if (!isPositiveInt(b.kim_number)) {
    return jsonError(cors, 400, "VALIDATION", "kim_number must be a positive integer");
  }
  if (!isNonNegativeInt(b.score)) {
    return jsonError(cors, 400, "VALIDATION", "score must be a non-negative integer");
  }

  // Validate kim_number is a Часть 2 task and score ≤ max.
  if (!assignment.variant_id) {
    return jsonError(cors, 400, "INVALID_STATE", "Assignment has no variant — cannot approve");
  }
  const { data: variantTask } = await db
    .from("mock_exam_variant_tasks")
    .select("part, max_score")
    .eq("variant_id", assignment.variant_id as string)
    .eq("kim_number", b.kim_number as number)
    .maybeSingle();
  if (!variantTask) {
    return jsonError(cors, 404, "TASK_NOT_FOUND", "Task with this kim_number not found in variant");
  }
  if (variantTask.part !== 2) {
    return jsonError(cors, 400, "VALIDATION", "approve-task only valid for Часть 2 (part=2)");
  }
  if ((b.score as number) > (variantTask.max_score as number)) {
    return jsonError(cors, 400, "VALIDATION",
      `score exceeds max_score (${variantTask.max_score})`);
  }

  // Determine status — было ли AI отклонение или ручная правка.
  // Минимум: tutor явно подтвердил → tutor_modified если tutor_score не равен AI suggested,
  // иначе tutor_approved. Без поля сравнения сейчас → берём tutor_modified когда
  // tutor_comment непустой; иначе tutor_approved.
  const { data: existing } = await db
    .from("mock_exam_attempt_part2_solutions")
    .select("ai_draft_json")
    .eq("attempt_id", attemptId)
    .eq("kim_number", b.kim_number as number)
    .maybeSingle();

  const aiDraft = existing?.ai_draft_json as { suggested_score?: number } | null;
  const aiSuggested = typeof aiDraft?.suggested_score === "number" ? aiDraft.suggested_score : null;
  const isModified =
    (aiSuggested !== null && aiSuggested !== (b.score as number)) ||
    isNonEmptyString(b.comment);
  const newStatus = isModified ? "tutor_modified" : "tutor_approved";
  const tutorComment = isNonEmptyString(b.comment) ? (b.comment as string).trim() : null;

  const { data: upserted, error: upsertErr } = await db
    .from("mock_exam_attempt_part2_solutions")
    .upsert(
      {
        attempt_id: attemptId,
        kim_number: b.kim_number,
        tutor_score: b.score,
        tutor_comment: tutorComment,
        status: newStatus,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "attempt_id,kim_number" },
    )
    .select("attempt_id, kim_number, status, tutor_score, tutor_comment")
    .single();
  if (upsertErr || !upserted) {
    console.error("mock_exam_approve_task_failed", { error: upsertErr?.message });
    return jsonError(cors, 500, "DB_ERROR", "Failed to approve task");
  }

  return jsonOk(cors, upserted);
}

// ────────────────────────────────────────────────────────────────────────────
// Endpoint: POST /attempts/:id/approve-all
// ────────────────────────────────────────────────────────────────────────────
//
// Enforces: все Часть 2 задачи должны быть в статусе 'tutor_approved' OR
// 'tutor_modified' AND part 1 завершён (status в submitted/ai_checking/
// awaiting_review). Иначе 400 с детализацией.

async function handleApproveAll(
  db: SupabaseClient,
  tutorUserId: string,
  attemptId: string,
  cors: Record<string, string>,
): Promise<Response> {
  const ownedOrErr = await getOwnedAttemptOrThrow(db, attemptId, tutorUserId, cors);
  if (ownedOrErr instanceof Response) return ownedOrErr;
  const { attempt, assignment } = ownedOrErr;

  if (attempt.status === "approved") {
    return jsonError(cors, 409, "ALREADY_APPROVED", "Attempt is already approved");
  }
  if (attempt.status === "manually_entered") {
    return jsonError(cors, 409, "MANUALLY_ENTERED", "Manual entries are terminal — nothing to approve");
  }
  if (attempt.status === "in_progress") {
    return jsonError(cors, 400, "NOT_SUBMITTED", "Attempt has not been submitted yet");
  }

  if (!assignment.variant_id) {
    return jsonError(cors, 400, "INVALID_STATE", "Assignment has no variant");
  }

  // Get all Часть 2 KIM numbers from variant.
  const { data: variantPart2Tasks, error: variantErr } = await db
    .from("mock_exam_variant_tasks")
    .select("kim_number, max_score")
    .eq("variant_id", assignment.variant_id as string)
    .eq("part", 2);
  if (variantErr || !variantPart2Tasks) {
    return jsonError(cors, 500, "DB_ERROR", "Failed to load variant tasks");
  }
  const expectedKimNumbers = (variantPart2Tasks ?? []).map((t) => t.kim_number as number);

  // Get current part2 solutions. Phase 6 (2026-05-15): добавлен ai_draft_json
  // для relaxed validation — если tutor не выставил manual score, AI's
  // suggested_score используется как default.
  const { data: solutions, error: solutionsErr } = await db
    .from("mock_exam_attempt_part2_solutions")
    .select("kim_number, status, tutor_score, ai_draft_json")
    .eq("attempt_id", attemptId);
  if (solutionsErr) {
    return jsonError(cors, 500, "DB_ERROR", "Failed to load part2 solutions");
  }

  interface SolutionRowForApprove {
    status: string;
    tutor_score: number | null;
    ai_suggested: number | null;
  }
  const solutionsByKim: Record<number, SolutionRowForApprove> = {};
  for (const s of solutions ?? []) {
    const draft = s.ai_draft_json as { suggested_score?: number | null } | null;
    solutionsByKim[s.kim_number as number] = {
      status: s.status as string,
      tutor_score: s.tutor_score as number | null,
      ai_suggested: draft?.suggested_score ?? null,
    };
  }

  // Phase 6 relaxed validation (CLAUDE.md §22, 2026-05-15):
  // Old behavior: require status='tutor_approved'|'tutor_modified' + tutor_score IS NOT NULL.
  // New behavior: final_score = tutor_score ?? ai_draft.suggested_score. Если оба null
  // → blocked KIM (tutor должен выставить балл вручную перед approve).
  //
  // Это соответствует Vladimir's UX choice (Phase 6 AskUserQuestion #4):
  // «Блокировать approve пока не все задачи имеют балл» — force review.
  const blockedKims: number[] = [];
  const finalScores = new Map<number, number>();
  for (const kim of expectedKimNumbers) {
    const sol = solutionsByKim[kim];
    if (!sol) {
      blockedKims.push(kim);
      continue;
    }
    const finalScore = sol.tutor_score ?? sol.ai_suggested;
    if (finalScore === null) {
      blockedKims.push(kim);
      continue;
    }
    finalScores.set(kim, finalScore);
  }
  if (blockedKims.length > 0) {
    return jsonError(
      cors,
      400,
      "INCOMPLETE_PART2",
      "AI не оценил некоторые задачи — выставь балл вручную перед подтверждением",
      { missing_kim_numbers: blockedKims },
    );
  }

  // Phase 6 review-fix #6 (2026-05-15): для blank-mode attempts требуем чтобы
  // все Часть 1 KIM имели `earned_score`. Иначе silent 0 — если OCR не
  // сработал или tutor не открыл `Part1BlankReviewPanel`, ученик получает
  // approved attempt с total_part1_score=0 без warning. Form mode: Часть 1
  // checked deterministically на submit, gate не нужен.
  if (attempt.answer_method === "blank") {
    const { data: variantPart1Tasks, error: part1VariantErr } = await db
      .from("mock_exam_variant_tasks")
      .select("kim_number")
      .eq("variant_id", assignment.variant_id as string)
      .eq("part", 1);
    if (part1VariantErr || !variantPart1Tasks) {
      return jsonError(cors, 500, "DB_ERROR", "Failed to load variant Part 1 tasks");
    }
    const expectedPart1Kims = variantPart1Tasks.map((t) => t.kim_number as number);

    const { data: part1Rows, error: part1Err } = await db
      .from("mock_exam_attempt_part1_answers")
      .select("kim_number, earned_score")
      .eq("attempt_id", attemptId);
    if (part1Err) {
      return jsonError(cors, 500, "DB_ERROR", "Failed to load Part 1 answers");
    }
    const part1ScoreByKim = new Map<number, number | null>();
    for (const row of part1Rows ?? []) {
      part1ScoreByKim.set(
        row.kim_number as number,
        row.earned_score as number | null,
      );
    }
    const missingPart1Kims: number[] = [];
    for (const kim of expectedPart1Kims) {
      const score = part1ScoreByKim.get(kim);
      // `null` = row отсутствует ИЛИ earned_score не выставлен → требует tutor
      // attention (`0` валиден — tutor явно проставил «не ответил»).
      if (score === undefined || score === null) {
        missingPart1Kims.push(kim);
      }
    }
    if (missingPart1Kims.length > 0) {
      return jsonError(
        cors,
        400,
        "INCOMPLETE_PART1",
        "Не все задачи Часть 1 проверены. Открой панель «Часть 1 на бланке», проверь AI-распознавание и выставь баллы.",
        { missing_kim_numbers: missingPart1Kims },
      );
    }
  }

  // Auto-finalize Часть 2 rows: для каждой задачи где tutor не выставил
  // вручную, используем AI's suggested_score как final tutor_score. Status:
  // 'tutor_approved' (default) если ai === final, 'tutor_modified' если
  // override (это уже произошло через explicit edit раньше — мы здесь не
  // меняем status у уже tutor_approved/tutor_modified rows).
  const autoFinalize: Array<{
    attempt_id: string;
    kim_number: number;
    tutor_score: number;
    status: string;
    updated_at: string;
  }> = [];
  for (const [kim, score] of finalScores.entries()) {
    const sol = solutionsByKim[kim];
    if (sol.tutor_score !== null) continue; // Уже выставлено вручную, не трогаем
    autoFinalize.push({
      attempt_id: attemptId,
      kim_number: kim,
      tutor_score: score,
      status: "tutor_approved", // AI default = tutor_approved (no override)
      updated_at: new Date().toISOString(),
    });
  }
  if (autoFinalize.length > 0) {
    const { error: autoErr } = await db
      .from("mock_exam_attempt_part2_solutions")
      .upsert(autoFinalize, { onConflict: "attempt_id,kim_number" });
    if (autoErr) {
      console.error("mock_exam_approve_all_auto_finalize_failed", { error: autoErr.message });
      return jsonError(cors, 500, "DB_ERROR", "Failed to auto-finalize tutor scores");
    }
  }

  // Compute totals.
  let totalPart2 = 0;
  for (const kim of expectedKimNumbers) {
    totalPart2 += finalScores.get(kim) ?? 0;
  }

  // Part 1 — already populated by deterministic checker on submit (TASK-4).
  // Use existing value if present, else recompute (defensive).
  let totalPart1 = (attempt.total_part1_score as number | null) ?? null;
  if (totalPart1 === null) {
    const { data: part1Rows } = await db
      .from("mock_exam_attempt_part1_answers")
      .select("earned_score")
      .eq("attempt_id", attemptId);
    totalPart1 = (part1Rows ?? []).reduce(
      (acc, row) => acc + ((row.earned_score as number | null) ?? 0),
      0,
    );
  }

  const totalScore = totalPart1 + totalPart2;

  // Update attempt → approved.
  const { error: updateErr } = await db
    .from("mock_exam_attempts")
    .update({
      status: "approved",
      total_part1_score: totalPart1,
      total_part2_score: totalPart2,
      total_score: totalScore,
    })
    .eq("id", attemptId);
  if (updateErr) {
    console.error("mock_exam_approve_all_update_failed", { error: updateErr.message });
    return jsonError(cors, 500, "DB_ERROR", "Failed to approve attempt");
  }

  // Cascade delivery — best-effort, не блокирует ответ при ошибке.
  let delivery: CascadeResult = { channel: null, failed_reason: null };
  if (attempt.student_id) {
    try {
      delivery = await notifyStudentApproved(
        db,
        attempt.student_id as string,
        assignment.id as string,
        attemptId,
        assignment.title as string,
      );
    } catch (err) {
      console.warn("mock_exam_approve_all_notify_failed", { error: String(err) });
      delivery = { channel: null, failed_reason: "delivery_error" };
    }
  } else {
    // anonymous lead — отдельный flow в TASK-6 (mock-exam-public).
    delivery = { channel: null, failed_reason: "anonymous_attempt" };
  }

  return jsonOk(cors, {
    attempt_id: attemptId,
    status: "approved",
    total_part1_score: totalPart1,
    total_part2_score: totalPart2,
    total_score: totalScore,
    delivery,
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Endpoint: POST /attempts/:id/part1-manual-score  (TASK-11)
// ────────────────────────────────────────────────────────────────────────────
//
// Used when student answered Part 1 on ФИПИ бланка от руки (answer_method='blank').
// Auto-check невозможен — tutor вводит earned_score вручную по каждому KIM,
// просматривая фото бланка. Upsert per kim_number; финализация суммарного
// total_part1_score через `/part1-finalize`.

async function handlePart1ManualScore(
  db: SupabaseClient,
  tutorUserId: string,
  attemptId: string,
  body: unknown,
  cors: Record<string, string>,
): Promise<Response> {
  const ownedOrErr = await getOwnedAttemptOrThrow(db, attemptId, tutorUserId, cors);
  if (ownedOrErr instanceof Response) return ownedOrErr;
  const { attempt, assignment } = ownedOrErr;

  if (attempt.status === "approved" || attempt.status === "manually_entered") {
    return jsonError(cors, 409, "ALREADY_FINALIZED",
      `Cannot edit Part 1 manual score after status=${attempt.status}`);
  }
  if (attempt.status === "in_progress") {
    return jsonError(cors, 409, "NOT_SUBMITTED",
      "Cannot grade Part 1 before student submitted the attempt");
  }

  if (!body || typeof body !== "object") {
    return jsonError(cors, 400, "INVALID_BODY", "Request body must be a JSON object");
  }
  const b = body as Record<string, unknown>;
  if (!isPositiveInt(b.kim_number)) {
    return jsonError(cors, 400, "VALIDATION", "kim_number must be a positive integer");
  }
  if (!isNonNegativeInt(b.earned_score)) {
    return jsonError(cors, 400, "VALIDATION", "earned_score must be a non-negative integer");
  }

  if (!assignment.variant_id) {
    return jsonError(cors, 400, "INVALID_STATE", "Assignment has no variant");
  }
  const { data: variantTask } = await db
    .from("mock_exam_variant_tasks")
    .select("part, max_score")
    .eq("variant_id", assignment.variant_id as string)
    .eq("kim_number", b.kim_number as number)
    .maybeSingle();
  if (!variantTask) {
    return jsonError(cors, 404, "TASK_NOT_FOUND", "Task with this kim_number not found in variant");
  }
  if (variantTask.part !== 1) {
    return jsonError(cors, 400, "VALIDATION",
      "part1-manual-score only valid for Часть 1 (part=1)");
  }
  if ((b.earned_score as number) > (variantTask.max_score as number)) {
    return jsonError(cors, 400, "VALIDATION",
      `earned_score exceeds max_score (${variantTask.max_score})`);
  }

  const { error: upsertErr } = await db
    .from("mock_exam_attempt_part1_answers")
    .upsert(
      {
        attempt_id: attemptId,
        kim_number: b.kim_number,
        student_answer: null, // student didn't enter digital answer (blank mode)
        earned_score: b.earned_score,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "attempt_id,kim_number" },
    );
  if (upsertErr) {
    console.error("mock_exam_part1_manual_score_failed", { error: upsertErr.message });
    return jsonError(cors, 500, "DB_ERROR", "Failed to persist manual score");
  }

  return jsonOk(cors, {
    ok: true,
    attempt_id: attemptId,
    kim_number: b.kim_number,
    earned_score: b.earned_score,
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Endpoint: POST /attempts/:id/part1-finalize  (TASK-11)
// ────────────────────────────────────────────────────────────────────────────
//
// Aggregates manually-entered Part 1 scores → updates attempt.total_part1_score.
// Idempotent; can be called multiple times as tutor edits scores.

async function handlePart1Finalize(
  db: SupabaseClient,
  tutorUserId: string,
  attemptId: string,
  cors: Record<string, string>,
): Promise<Response> {
  const ownedOrErr = await getOwnedAttemptOrThrow(db, attemptId, tutorUserId, cors);
  if (ownedOrErr instanceof Response) return ownedOrErr;
  const { attempt } = ownedOrErr;

  if (attempt.status === "approved" || attempt.status === "manually_entered") {
    return jsonError(cors, 409, "ALREADY_FINALIZED",
      `Cannot finalize Part 1 after status=${attempt.status}`);
  }
  if (attempt.status === "in_progress") {
    return jsonError(cors, 409, "NOT_SUBMITTED",
      "Cannot finalize Part 1 before student submitted the attempt");
  }

  const { data: rows } = await db
    .from("mock_exam_attempt_part1_answers")
    .select("earned_score")
    .eq("attempt_id", attemptId);

  const totalPart1 = (rows ?? []).reduce(
    (sum, r) => sum + (typeof r.earned_score === "number" ? r.earned_score : 0),
    0,
  );

  const { error: updateErr } = await db
    .from("mock_exam_attempts")
    .update({ total_part1_score: totalPart1 })
    .eq("id", attemptId);
  if (updateErr) {
    console.error("mock_exam_part1_finalize_failed", { error: updateErr.message });
    return jsonError(cors, 500, "DB_ERROR", "Failed to finalize Part 1 score");
  }

  return jsonOk(cors, {
    ok: true,
    attempt_id: attemptId,
    total_part1_score: totalPart1,
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Phase 6 (2026-05-15) — POST /attempts/:id/assign-part2-photos
// Tutor вручную привязывает фото из bulk-pack к Часть 2 задачам через
// select dropdown в TutorMockExamReview. Body: `{ assignments: { kim: [photo_indices], ... } }`.
// Persistится в `ai_draft_json.assigned_photo_indices` per kim row.
// После изменений tutor нажимает «Перепроверить AI» (POST /regrade-part2)
// чтобы AI пересчитал баллы с новой привязкой.
// ────────────────────────────────────────────────────────────────────────────

async function handleAssignPart2Photos(
  db: SupabaseClient,
  tutorUserId: string,
  attemptId: string,
  body: unknown,
  cors: Record<string, string>,
): Promise<Response> {
  const ownedOrErr = await getOwnedAttemptOrThrow(db, attemptId, tutorUserId, cors);
  if (ownedOrErr instanceof Response) return ownedOrErr;
  const { attempt } = ownedOrErr;

  if (attempt.status === "approved") {
    return jsonError(cors, 409, "ALREADY_APPROVED", "Attempt is already approved");
  }
  if (attempt.status === "manually_entered") {
    return jsonError(cors, 409, "MANUALLY_ENTERED", "Manual entries — nothing to reassign");
  }

  const b = (body && typeof body === "object") ? body as Record<string, unknown> : {};
  const assignmentsRaw = b.assignments;
  if (!assignmentsRaw || typeof assignmentsRaw !== "object" || Array.isArray(assignmentsRaw)) {
    return jsonError(cors, 400, "VALIDATION", "`assignments` must be an object { kim_number: [photo_indices] }");
  }

  // Determine valid range для photo indices (= bulk photos count).
  const bulkPhotoCount = (() => {
    const raw = (attempt.part2_bulk_photo_urls as string | null) ?? null;
    if (!raw) return 0;
    const trimmed = raw.trim();
    if (!trimmed) return 0;
    if (trimmed.startsWith("[")) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        return Array.isArray(parsed) ? parsed.length : 0;
      } catch { /* fall through */ }
    }
    return 1; // single ref
  })();

  if (bulkPhotoCount === 0) {
    return jsonError(cors, 400, "NO_BULK_PHOTOS", "Attempt has no bulk Часть 2 photos to assign");
  }

  // Validate + sanitize assignments map.
  const cleanAssignments = new Map<number, number[]>();
  for (const [rawKey, rawValue] of Object.entries(assignmentsRaw as Record<string, unknown>)) {
    const kim = Number.parseInt(rawKey.trim(), 10);
    if (!Number.isFinite(kim) || kim < 21 || kim > 26) continue;
    if (!Array.isArray(rawValue)) continue;
    const seen = new Set<number>();
    const indices: number[] = [];
    for (const item of rawValue) {
      const idx = typeof item === "number"
        ? Math.trunc(item)
        : typeof item === "string"
          ? Number.parseInt(item.trim(), 10)
          : NaN;
      if (!Number.isFinite(idx)) continue;
      if (idx < 0 || idx >= bulkPhotoCount) continue;
      if (seen.has(idx)) continue;
      seen.add(idx);
      indices.push(idx);
    }
    cleanAssignments.set(kim, indices);
  }

  if (cleanAssignments.size === 0) {
    return jsonError(cors, 400, "VALIDATION", "No valid kim numbers in `assignments`");
  }

  // Load existing solutions для обновления ai_draft_json в-place.
  const { data: solutions, error: solutionsErr } = await db
    .from("mock_exam_attempt_part2_solutions")
    .select("kim_number, ai_draft_json, status")
    .eq("attempt_id", attemptId);
  if (solutionsErr) {
    return jsonError(cors, 500, "DB_ERROR", "Failed to load part2 solutions");
  }

  const solutionsByKim = new Map<number, { ai_draft_json: unknown; status: string }>();
  for (const s of (solutions ?? []) as Array<{
    kim_number: number;
    ai_draft_json: unknown;
    status: string;
  }>) {
    solutionsByKim.set(s.kim_number, { ai_draft_json: s.ai_draft_json, status: s.status });
  }

  // Upsert каждой changed kim: merge assigned_photo_indices в существующий
  // ai_draft_json (или создать row с минимальным draft если её ещё нет).
  //
  // Phase 6 review-fix #4: если assignment РЕАЛЬНО изменился И row не
  // tutor_approved/tutor_modified → инвалидируем `suggested_score=null` +
  // `confidence='low'` + добавляем flag `awaiting_regrade`. Это блокирует
  // `/approve-all` от silent отправки старого AI score: после смены фото
  // tutor ДОЛЖЕН либо нажать «Перепроверить AI», либо вручную «Изменить балл».
  const upserts: Array<Record<string, unknown>> = [];
  for (const [kim, indices] of cleanAssignments.entries()) {
    const existing = solutionsByKim.get(kim);
    const baseDraft = (existing?.ai_draft_json as Record<string, unknown> | null) ?? {
      suggested_score: null,
      confidence: "low",
      elements_check: { I: false, II: false, III: false, IV: false },
      comment_for_tutor: "Назначено tutor'ом — AI ещё не пересчитал баллы.",
      flags: ["awaiting_regrade"],
    };

    // Detect: assignment изменился?
    const prevIndices = Array.isArray(
      (baseDraft as { assigned_photo_indices?: unknown }).assigned_photo_indices,
    )
      ? ((baseDraft as { assigned_photo_indices?: number[] }).assigned_photo_indices ?? [])
      : [];
    const assignmentChanged = !arraysEqualAsSets(prevIndices, indices);

    // Tutor preservation: tutor_approved/tutor_modified rows — assignment
    // меняем (UI хочет это), но `suggested_score` НЕ инвалидируем (tutor сам
    // явно зафиксировал балл, AI re-grade не запустится — см. mock-exam-grade
    // conditional UPDATE).
    const preserveTutorScore =
      existing?.status === "tutor_approved" || existing?.status === "tutor_modified";

    let updatedDraft: Record<string, unknown>;
    if (assignmentChanged && !preserveTutorScore) {
      const existingFlags = Array.isArray((baseDraft as { flags?: unknown }).flags)
        ? ((baseDraft as { flags?: unknown[] }).flags as unknown[]).filter(
          (f): f is string => typeof f === "string" && f !== "awaiting_regrade",
        )
        : [];
      updatedDraft = {
        ...baseDraft,
        assigned_photo_indices: indices,
        suggested_score: null,
        confidence: "low",
        flags: [...existingFlags, "awaiting_regrade"].slice(0, 6), // cap as per frozen contract
      };
    } else {
      // No change OR tutor-locked row — keep existing score, just update indices.
      updatedDraft = {
        ...baseDraft,
        assigned_photo_indices: indices,
      };
    }

    upserts.push({
      attempt_id: attemptId,
      kim_number: kim,
      ai_draft_json: updatedDraft,
      // status сохраняется как был (не трогаем tutor_approved / tutor_modified)
      ...(existing ? {} : { status: "awaiting_review" as const }),
      updated_at: new Date().toISOString(),
    });
  }

  if (upserts.length > 0) {
    const { error: upsertErr } = await db
      .from("mock_exam_attempt_part2_solutions")
      .upsert(upserts, { onConflict: "attempt_id,kim_number" });
    if (upsertErr) {
      console.error("mock_exam_assign_part2_photos_upsert_failed", { error: upsertErr.message });
      return jsonError(cors, 500, "DB_ERROR", "Failed to update assignments");
    }
  }

  return jsonOk(cors, {
    attempt_id: attemptId,
    updated_kim_count: upserts.length,
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Phase 6 (2026-05-15) — POST /attempts/:id/regrade-part2
// Tutor click «Перепроверить AI» после изменения photo assignment. Service-
// role internal call к mock-exam-grade::handleGrade. State machine pre-check:
// not approved/manually_entered. Tutor preservation: tutor_approved/modified
// rows не перезаписываются (mock-exam-grade сам это уважает).
// ────────────────────────────────────────────────────────────────────────────

async function handleRegradePart2(
  db: SupabaseClient,
  tutorUserId: string,
  attemptId: string,
  cors: Record<string, string>,
): Promise<Response> {
  const ownedOrErr = await getOwnedAttemptOrThrow(db, attemptId, tutorUserId, cors);
  if (ownedOrErr instanceof Response) return ownedOrErr;
  const { attempt } = ownedOrErr;

  if (attempt.status === "approved") {
    return jsonError(cors, 409, "ALREADY_APPROVED", "Attempt is already approved — re-grade not allowed");
  }
  if (attempt.status === "manually_entered") {
    return jsonError(cors, 409, "MANUALLY_ENTERED", "Manual entries — nothing to re-grade");
  }
  if (attempt.status === "in_progress") {
    return jsonError(cors, 400, "NOT_SUBMITTED", "Attempt has not been submitted yet");
  }
  // Round 3 review-fix P1 #3 (2026-05-15): /regrade-part2 принимает ТОЛЬКО
  // `awaiting_review`. Раньше пропускали `ai_checking` (через service_role
  // bypass в grader), что создавало race с initial fire-and-forget grading
  // от `handleSubmitAttempt`: tutor мог нажать «Перепроверить AI» во время
  // первичного run → два grader'а параллельно. Теперь явный state-machine
  // gate: regrade имеет смысл только когда AI уже закончил первый pass.
  if (attempt.status === "submitted" || attempt.status === "ai_checking") {
    return jsonError(
      cors,
      409,
      "GRADING_IN_PROGRESS",
      "AI grader сейчас обрабатывает этот пробник. Перепроверка станет доступна когда он закончит.",
    );
  }

  // Call mock-exam-grade internally через service_role.
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  if (!serviceRoleKey || !supabaseUrl) {
    return jsonError(cors, 500, "ENV_ERROR", "Service role keys not configured");
  }

  const gradeUrl = `${supabaseUrl}/functions/v1/mock-exam-grade`;
  const startTime = Date.now();
  try {
    const resp = await fetch(gradeUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ attempt_id: attemptId }),
    });
    const latency = Date.now() - startTime;
    if (!resp.ok) {
      const errText = await resp.text();
      console.error("mock_exam_regrade_failed", {
        attempt_id: attemptId,
        status: resp.status,
        error: errText.slice(0, 500),
      });
      return jsonError(cors, 502, "REGRADE_FAILED", "AI grader не успел или вернул ошибку. Попробуй ещё раз.");
    }
    const body = await resp.json();
    return jsonOk(cors, {
      attempt_id: attemptId,
      regraded: true,
      latency_ms: latency,
      grade_response: body,
    });
  } catch (err) {
    console.error("mock_exam_regrade_exception", {
      attempt_id: attemptId,
      error: err instanceof Error ? err.message : String(err),
    });
    return jsonError(cors, 502, "REGRADE_FAILED", "AI grader не успел или вернул ошибку. Попробуй ещё раз.");
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Endpoint: POST /assignments/:id/invite-link
// ────────────────────────────────────────────────────────────────────────────

async function handleCreateInviteLink(
  db: SupabaseClient,
  tutorUserId: string,
  assignmentId: string,
  body: unknown,
  cors: Record<string, string>,
): Promise<Response> {
  const assignmentOrErr = await getOwnedAssignmentOrThrow(db, assignmentId, tutorUserId, cors);
  if (assignmentOrErr instanceof Response) return assignmentOrErr;
  const assignment = assignmentOrErr;

  if (assignment.mode === "manual_entry") {
    return jsonError(cors, 400, "INVALID_MODE", "manual_entry assignments don't support invite links");
  }

  const b = (body && typeof body === "object") ? body as Record<string, unknown> : {};
  let expiresAtIso: string | null = null;
  if (b.expires_in_days !== undefined && b.expires_in_days !== null) {
    if (!isPositiveInt(b.expires_in_days) || b.expires_in_days > SLUG_EXPIRY_MAX_DAYS) {
      return jsonError(
        cors,
        400,
        "VALIDATION",
        `expires_in_days must be 1..${SLUG_EXPIRY_MAX_DAYS}`,
      );
    }
    const expiresAt = new Date(Date.now() + (b.expires_in_days as number) * 86400000);
    expiresAtIso = expiresAt.toISOString();
  }

  for (let attempt = 0; attempt < SLUG_MAX_RETRIES; attempt++) {
    const slug = generateSlug();
    const { data, error } = await db
      .from("mock_exam_public_links")
      .insert({
        slug,
        scope: "invite",
        attempt_id: null,
        mock_exam_id: assignmentId,
        tutor_id: tutorUserId,
        expires_at: expiresAtIso,
      })
      .select("slug, scope, mock_exam_id, expires_at, created_at")
      .single();

    if (!error && data) {
      const url = `${getAppBaseUrl()}/p/mock-invite/${data.slug}`;
      return jsonOk(
        cors,
        {
          slug: data.slug,
          url,
          scope: "invite",
          assignment_id: data.mock_exam_id,
          expires_at: data.expires_at,
          created_at: data.created_at,
        },
        201,
      );
    }

    const msg = (error?.message ?? "").toLowerCase();
    const isUniqueViolation =
      msg.includes("duplicate key") ||
      msg.includes("unique constraint") ||
      (error as unknown as { code?: string })?.code === "23505";
    if (!isUniqueViolation) {
      console.error("mock_exam_invite_link_failed", { error: error?.message });
      return jsonError(cors, 500, "DB_ERROR", "Failed to create invite link");
    }
  }
  return jsonError(cors, 500, "DB_ERROR", "Slug collision exhausted");
}

// ────────────────────────────────────────────────────────────────────────────
// Endpoint: GET /assignments/:id/invite-links
//
// FIX-4b — история публичных ссылок в кабинете репетитора. Список всех
// scope='invite' ссылок, созданных репетитором для assignment'а. Сортировка
// created_at DESC (свежие сверху).
//
// Anti-leak invariants (mirror handleCreateInviteLink + homework-reuse-v1
// share-links pattern):
//   • Column whitelist: slug, expires_at, created_at, scope. tutor_id уже
//     проверен через ownership (ниже), не возвращаем. attempt_id опускаем —
//     для scope='invite' он null, для parent_result понадобится отдельный
//     producer (см. CLAUDE.md §10).
//   • URL builds server-side через getAppBaseUrl() — клиент не склеивает.
//   • Filter `tutor_id = tutorUserId` дублирует ownership-check (defense in
//     depth — shared mock_exam_id с другим tutor'ом теоретически невозможен
//     из-за RLS на assignments, но дешевле чем не дублировать).
// ────────────────────────────────────────────────────────────────────────────

async function handleListInviteLinks(
  db: SupabaseClient,
  tutorUserId: string,
  assignmentId: string,
  cors: Record<string, string>,
): Promise<Response> {
  const assignmentOrErr = await getOwnedAssignmentOrThrow(
    db,
    assignmentId,
    tutorUserId,
    cors,
  );
  if (assignmentOrErr instanceof Response) return assignmentOrErr;

  const { data, error } = await db
    .from("mock_exam_public_links")
    .select("slug, scope, expires_at, created_at")
    .eq("mock_exam_id", assignmentId)
    .eq("tutor_id", tutorUserId)
    .eq("scope", "invite")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("mock_exam_invite_links_list_failed", {
      error: error.message,
    });
    return jsonError(cors, 500, "DB_ERROR", "Failed to list invite links");
  }

  const baseUrl = getAppBaseUrl();
  const items = (data ?? []).map((row) => ({
    slug: row.slug,
    url: `${baseUrl}/p/mock-invite/${row.slug}`,
    scope: row.scope,
    assignment_id: assignmentId,
    expires_at: row.expires_at,
    created_at: row.created_at,
  }));

  return jsonOk(cors, { items });
}

// ─── Server ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  const cors = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: cors });
  }

  const route = parseRoute(req);
  const startTime = Date.now();
  console.log("mock_exam_api_request_start", {
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

    // Per-tutor feature flag gate (AC-8).
    const flagOk = await ensureMockExamFlagEnabled(db, userId, cors);
    if (flagOk !== true) return flagOk;

    const seg = route.segments;

    // POST /assignments
    if (seg.length === 1 && seg[0] === "assignments" && route.method === "POST") {
      const body = await parseJsonBody(req);
      return await handleCreateAssignment(db, userId, body, cors);
    }

    // GET /assignments
    if (seg.length === 1 && seg[0] === "assignments" && route.method === "GET") {
      return await handleListAssignments(db, userId, cors);
    }

    // GET /assignments/:id
    if (seg.length === 2 && seg[0] === "assignments" && route.method === "GET") {
      return await handleGetAssignment(db, userId, seg[1], cors);
    }

    // POST /assignments/:id/invite-link
    if (
      seg.length === 3 && seg[0] === "assignments" &&
      seg[2] === "invite-link" && route.method === "POST"
    ) {
      const body = await parseJsonBody(req);
      return await handleCreateInviteLink(db, userId, seg[1], body, cors);
    }

    // GET /assignments/:id/invite-links — FIX-4b история ссылок
    if (
      seg.length === 3 && seg[0] === "assignments" &&
      seg[2] === "invite-links" && route.method === "GET"
    ) {
      return await handleListInviteLinks(db, userId, seg[1], cors);
    }

    // GET /attempts/:id
    if (seg.length === 2 && seg[0] === "attempts" && route.method === "GET") {
      return await handleGetAttempt(db, userId, seg[1], cors);
    }

    // POST /attempts/:id/approve-task
    if (
      seg.length === 3 && seg[0] === "attempts" &&
      seg[2] === "approve-task" && route.method === "POST"
    ) {
      const body = await parseJsonBody(req);
      return await handleApproveTask(db, userId, seg[1], body, cors);
    }

    // POST /attempts/:id/approve-all
    if (
      seg.length === 3 && seg[0] === "attempts" &&
      seg[2] === "approve-all" && route.method === "POST"
    ) {
      return await handleApproveAll(db, userId, seg[1], cors);
    }

    // POST /attempts/:id/part1-manual-score  (TASK-11 — blank mode tutor grading)
    if (
      seg.length === 3 && seg[0] === "attempts" &&
      seg[2] === "part1-manual-score" && route.method === "POST"
    ) {
      const body = await parseJsonBody(req);
      return await handlePart1ManualScore(db, userId, seg[1], body, cors);
    }

    // POST /attempts/:id/part1-finalize  (TASK-11 — aggregate manual scores)
    if (
      seg.length === 3 && seg[0] === "attempts" &&
      seg[2] === "part1-finalize" && route.method === "POST"
    ) {
      return await handlePart1Finalize(db, userId, seg[1], cors);
    }

    // Phase 6 (2026-05-15) — POST /attempts/:id/assign-part2-photos
    // Tutor вручную привязывает фото из bulk-pack к задачам через
    // select dropdown. Persistится в ai_draft_json.assigned_photo_indices.
    if (
      seg.length === 3 && seg[0] === "attempts" &&
      seg[2] === "assign-part2-photos" && route.method === "POST"
    ) {
      const body = await parseJsonBody(req);
      return await handleAssignPart2Photos(db, userId, seg[1], body, cors);
    }

    // Phase 6 (2026-05-15) — POST /attempts/:id/regrade-part2
    // Tutor click «Перепроверить AI» после изменения photo assignment.
    // Service-role internal call к mock-exam-grade::handleGrade.
    if (
      seg.length === 3 && seg[0] === "attempts" &&
      seg[2] === "regrade-part2" && route.method === "POST"
    ) {
      return await handleRegradePart2(db, userId, seg[1], cors);
    }

    return jsonError(cors, 404, "NOT_FOUND", `Route not found: ${route.method} /${seg.join("/")}`);
  } catch (err) {
    const elapsed = Date.now() - startTime;
    console.error("mock_exam_api_request_error", {
      error: String(err),
      elapsed_ms: elapsed,
    });
    return jsonError(cors, 500, "INTERNAL_ERROR", "Internal server error");
  }
});

// Suppress unused warning for tutor-side bucket constants — referenced in tasks
// downstream when blank/photo upload is wired (TASK-12).
void BLANK_BUCKET;
void PART2_PHOTO_BUCKET;
