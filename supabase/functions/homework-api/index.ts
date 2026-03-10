import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { runHomeworkAiCheck } from "./ai_check.ts";
import {
  computeAvailableScore,
  evaluateStudentAnswer,
  generateHint,
} from "./guided_ai.ts";

// ─── Constants ───────────────────────────────────────────────────────────────

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";

const VALID_SUBJECTS = ["math", "physics", "history", "social", "english", "cs"] as const;
const VALID_STATUSES = ["draft", "active", "closed"] as const;
const VALID_STATUS_FILTERS = ["draft", "active", "closed", "all"] as const;
const VALID_SUBMISSION_STATUSES = ["in_progress", "submitted", "ai_checked", "tutor_reviewed"] as const;
type NotifyFailureReason = "missing_telegram_link" | "telegram_send_failed" | "telegram_send_error";

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
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
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

function isMissingColumnError(message: string, column: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes(column.toLowerCase()) && (
    lower.includes("schema cache") ||
    (lower.includes("column") && lower.includes("does not exist"))
  );
}

async function parseJsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
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
  if (!authHeader) {
    return jsonError(cors, 401, "UNAUTHORIZED", "Missing Authorization header");
  }
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) {
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

async function getOwnedSubmissionOrThrow(
  db: SupabaseClient,
  submissionId: string,
  tutorUserId: string,
  cors: Record<string, string>,
): Promise<Record<string, unknown> | Response> {
  if (!isUUID(submissionId)) {
    return jsonError(cors, 400, "INVALID_ID", "Invalid submission ID format");
  }
  const { data, error } = await db
    .from("homework_tutor_submissions")
    .select("*, homework_tutor_assignments!inner(tutor_id)")
    .eq("id", submissionId)
    .maybeSingle();
  if (error || !data) {
    return jsonError(cors, 404, "NOT_FOUND", "Submission not found");
  }
  const assignment = data.homework_tutor_assignments as { tutor_id: string };
  if (assignment.tutor_id !== tutorUserId) {
    return jsonError(cors, 403, "FORBIDDEN", "Submission does not belong to your assignment");
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
  if (!isNonEmptyString(b.subject) || !(VALID_SUBJECTS as readonly string[]).includes(b.subject)) {
    return jsonError(cors, 400, "VALIDATION", `subject must be one of: ${VALID_SUBJECTS.join(", ")}`);
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
  if (!Array.isArray(b.tasks) || b.tasks.length === 0) {
    return jsonError(cors, 400, "VALIDATION", "tasks must be a non-empty array");
  }
  const workflowMode = b.workflow_mode === "guided_chat" ? "guided_chat" : "classic";
  for (let i = 0; i < b.tasks.length; i++) {
    const t = b.tasks[i];
    if (!t || typeof t !== "object") {
      return jsonError(cors, 400, "VALIDATION", `tasks[${i}] must be an object`);
    }
    if (!isNonEmptyString(t.task_text)) {
      return jsonError(cors, 400, "VALIDATION", `tasks[${i}].task_text is required`);
    }
    if (t.max_score !== undefined && t.max_score !== null && !isPositiveInt(t.max_score)) {
      return jsonError(cors, 400, "VALIDATION", `tasks[${i}].max_score must be a positive integer`);
    }
    if (t.order_num !== undefined && t.order_num !== null && !isPositiveInt(t.order_num)) {
      return jsonError(cors, 400, "VALIDATION", `tasks[${i}].order_num must be a positive integer`);
    }
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
      workflow_mode: workflowMode,
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
    task_text: (t.task_text as string).trim(),
    task_image_url: isNonEmptyString(t.task_image_url) ? (t.task_image_url as string).trim() : null,
    correct_answer: isNonEmptyString(t.correct_answer) ? (t.correct_answer as string).trim() : null,
    max_score: isPositiveInt(t.max_score) ? t.max_score : 1,
    rubric_text: isNonEmptyString(t.rubric_text) ? (t.rubric_text as string).trim() : null,
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
    .select("id, title, subject, topic, deadline, status, workflow_mode, created_at")
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
    .select("assignment_id, delivery_status")
    .in("assignment_id", assignmentIds);

  const { data: submissions } = await db
    .from("homework_tutor_submissions")
    .select("assignment_id, status, total_score, total_max_score")
    .in("assignment_id", assignmentIds);

  const assignedMap: Record<string, number> = {};
  const deliveredMap: Record<string, number> = {};
  const notConnectedMap: Record<string, number> = {};
  for (const r of assignedCounts ?? []) {
    assignedMap[r.assignment_id] = (assignedMap[r.assignment_id] ?? 0) + 1;
    if (r.delivery_status === "delivered") {
      deliveredMap[r.assignment_id] = (deliveredMap[r.assignment_id] ?? 0) + 1;
    } else if (r.delivery_status === "failed_not_connected") {
      notConnectedMap[r.assignment_id] = (notConnectedMap[r.assignment_id] ?? 0) + 1;
    }
  }

  const submittedMap: Record<string, number> = {};
  const scoreMap: Record<string, { sum: number; count: number }> = {};
  for (const s of submissions ?? []) {
    if (["submitted", "ai_checked", "tutor_reviewed"].includes(s.status)) {
      submittedMap[s.assignment_id] = (submittedMap[s.assignment_id] ?? 0) + 1;
    }
    if (s.total_score != null && s.total_max_score != null && s.total_max_score > 0) {
      if (!scoreMap[s.assignment_id]) {
        scoreMap[s.assignment_id] = { sum: 0, count: 0 };
      }
      scoreMap[s.assignment_id].sum += (s.total_score / s.total_max_score) * 100;
      scoreMap[s.assignment_id].count += 1;
    }
  }

  // Guided chat: count completed threads as "submissions" for stats
  const guidedAssignmentIds = assignments
    .filter((a) => a.workflow_mode === "guided_chat")
    .map((a) => a.id);

  if (guidedAssignmentIds.length > 0) {
    // Get student assignments for guided chat assignments
    const { data: guidedSAs } = await db
      .from("homework_tutor_student_assignments")
      .select("id, assignment_id")
      .in("assignment_id", guidedAssignmentIds);

    if (guidedSAs && guidedSAs.length > 0) {
      const saIds = guidedSAs.map((sa) => sa.id);
      const saToAssignment: Record<string, string> = {};
      for (const sa of guidedSAs) {
        saToAssignment[sa.id] = sa.assignment_id;
      }

      // Get completed threads
      const { data: completedThreads } = await db
        .from("homework_tutor_threads")
        .select("id, student_assignment_id")
        .in("student_assignment_id", saIds)
        .eq("status", "completed");

      if (completedThreads && completedThreads.length > 0) {
        const threadIds = completedThreads.map((t) => t.id);

        // Get task states for completed threads
        const { data: taskStates } = await db
          .from("homework_tutor_task_states")
          .select("thread_id, earned_score, available_score")
          .in("thread_id", threadIds)
          .eq("status", "completed");

        // Aggregate scores per thread, then per assignment
        const threadScores: Record<string, { earned: number; available: number }> = {};
        for (const ts of taskStates ?? []) {
          if (!threadScores[ts.thread_id]) {
            threadScores[ts.thread_id] = { earned: 0, available: 0 };
          }
          threadScores[ts.thread_id].earned += Number(ts.earned_score ?? 0);
          threadScores[ts.thread_id].available += Number(ts.available_score ?? 0);
        }

        for (const thread of completedThreads) {
          const aId = saToAssignment[thread.student_assignment_id];
          if (!aId) continue;

          submittedMap[aId] = (submittedMap[aId] ?? 0) + 1;

          const scores = threadScores[thread.id];
          if (scores && scores.available > 0) {
            if (!scoreMap[aId]) {
              scoreMap[aId] = { sum: 0, count: 0 };
            }
            scoreMap[aId].sum += (scores.earned / scores.available) * 100;
            scoreMap[aId].count += 1;
          }
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
    avg_score: scoreMap[a.id]
      ? Math.round((scoreMap[a.id].sum / scoreMap[a.id].count) * 100) / 100
      : null,
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
    .select("id, order_num, task_text, task_image_url, correct_answer, max_score, rubric_text")
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
      .select("id, username")
      .in("id", studentIds);

    const profileMap: Record<string, string | null> = {};
    for (const p of profiles ?? []) {
      profileMap[p.id] = p.username;
    }

    assignedStudents = studentAssignments.map((sa) => ({
      student_id: sa.student_id,
      name: profileMap[sa.student_id] ?? null,
      notified: sa.notified,
      notified_at: sa.notified_at,
      delivery_status: sa.delivery_status,
      delivery_error_code: sa.delivery_error_code,
    }));
  }

  const { data: materials } = await db
    .from("homework_tutor_materials")
    .select("id, type, storage_ref, url, title, created_at")
    .eq("assignment_id", assignmentId)
    .order("created_at", { ascending: true });

  const { data: submissions } = await db
    .from("homework_tutor_submissions")
    .select("status, total_score, total_max_score")
    .eq("assignment_id", assignmentId);

  const statusCounts: Record<string, number> = {};
  let scoreSum = 0;
  let scoreCount = 0;
  for (const s of submissions ?? []) {
    statusCounts[s.status] = (statusCounts[s.status] ?? 0) + 1;
    if (s.total_score != null && s.total_max_score != null && s.total_max_score > 0) {
      scoreSum += (s.total_score / s.total_max_score) * 100;
      scoreCount += 1;
    }
  }

  // Guided chat: add completed thread data to submissions summary
  let guidedCompletedCount = 0;
  if ((assignment as Record<string, unknown>).workflow_mode === "guided_chat" && studentAssignments && studentAssignments.length > 0) {
    const saIds = studentAssignments.map((sa) => sa.id);

    const { data: completedThreads } = await db
      .from("homework_tutor_threads")
      .select("id, student_assignment_id")
      .in("student_assignment_id", saIds)
      .eq("status", "completed");

    if (completedThreads && completedThreads.length > 0) {
      const threadIds = completedThreads.map((t) => t.id);

      const { data: taskStates } = await db
        .from("homework_tutor_task_states")
        .select("thread_id, earned_score, available_score")
        .in("thread_id", threadIds)
        .eq("status", "completed");

      const threadScores: Record<string, { earned: number; available: number }> = {};
      for (const ts of taskStates ?? []) {
        if (!threadScores[ts.thread_id]) {
          threadScores[ts.thread_id] = { earned: 0, available: 0 };
        }
        threadScores[ts.thread_id].earned += Number(ts.earned_score ?? 0);
        threadScores[ts.thread_id].available += Number(ts.available_score ?? 0);
      }

      for (const thread of completedThreads) {
        guidedCompletedCount++;
        statusCounts["completed"] = (statusCounts["completed"] ?? 0) + 1;

        const scores = threadScores[thread.id];
        if (scores && scores.available > 0) {
          scoreSum += (scores.earned / scores.available) * 100;
          scoreCount += 1;
        }
      }
    }
  }

  const submissionsSummary = {
    total: (submissions ?? []).length + guidedCompletedCount,
    by_status: statusCounts,
    avg_percent: scoreCount > 0 ? Math.round((scoreSum / scoreCount) * 100) / 100 : null,
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
    if (!isNonEmptyString(b.subject) || !(VALID_SUBJECTS as readonly string[]).includes(b.subject)) {
      return jsonError(cors, 400, "VALIDATION", `subject must be one of: ${VALID_SUBJECTS.join(", ")}`);
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
  if (b.status !== undefined) {
    if (!isNonEmptyString(b.status) || !(VALID_STATUSES as readonly string[]).includes(b.status)) {
      return jsonError(cors, 400, "VALIDATION", `status must be one of: ${VALID_STATUSES.join(", ")}`);
    }
    patch.status = b.status;
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
      if (!isNonEmptyString(t.task_text)) {
        return jsonError(cors, 400, "VALIDATION", `tasks[${i}].task_text is required`);
      }
      if (t.max_score !== undefined && t.max_score !== null && !isPositiveInt(t.max_score)) {
        return jsonError(cors, 400, "VALIDATION", `tasks[${i}].max_score must be a positive integer`);
      }
    }

    const { count: submissionCount } = await db
      .from("homework_tutor_submissions")
      .select("id", { count: "exact", head: true })
      .eq("assignment_id", assignmentId);

    const hasSubmissions = (submissionCount ?? 0) > 0;

    const { data: existingTasks } = await db
      .from("homework_tutor_tasks")
      .select("id, order_num")
      .eq("assignment_id", assignmentId);
    const existingIds = new Set((existingTasks ?? []).map((t) => t.id));

    const incomingTasks = b.tasks as Record<string, unknown>[];
    const incomingIds = new Set(
      incomingTasks.filter((t) => isUUID(t.id)).map((t) => t.id as string),
    );

    if (hasSubmissions) {
      const newTasks = incomingTasks.filter((t) => !isUUID(t.id) || !existingIds.has(t.id as string));
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

      for (let i = 0; i < incomingTasks.length; i++) {
        const t = incomingTasks[i];
        if (!isUUID(t.id)) continue;
        const updateFields: Record<string, unknown> = {};
        updateFields.task_text = (t.task_text as string).trim();
        updateFields.order_num = isPositiveInt(t.order_num) ? t.order_num : i + 1;
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

        const { error } = await db
          .from("homework_tutor_tasks")
          .update(updateFields)
          .eq("id", t.id)
          .eq("assignment_id", assignmentId);
        if (error) {
          console.error("homework_api_request_error", { route: "PUT /assignments/:id tasks update", error: error.message });
        }
      }
    } else {
      const toUpdate = incomingTasks.filter((t) => isUUID(t.id) && existingIds.has(t.id as string));
      const toInsert = incomingTasks.filter((t) => !isUUID(t.id) || !existingIds.has(t.id as string));
      const toDeleteIds = [...existingIds].filter((id) => !incomingIds.has(id));

      if (toDeleteIds.length > 0) {
        const { error } = await db
          .from("homework_tutor_tasks")
          .delete()
          .in("id", toDeleteIds)
          .eq("assignment_id", assignmentId);
        if (error) {
          console.error("homework_api_request_error", { route: "PUT /assignments/:id tasks delete", error: error.message });
        }
      }

      for (let i = 0; i < toUpdate.length; i++) {
        const t = toUpdate[i];
        const updateFields: Record<string, unknown> = {
          task_text: (t.task_text as string).trim(),
          order_num: isPositiveInt(t.order_num) ? t.order_num : i + 1,
          task_image_url: isNonEmptyString(t.task_image_url) ? (t.task_image_url as string).trim() : null,
          correct_answer: isNonEmptyString(t.correct_answer) ? (t.correct_answer as string).trim() : null,
          max_score: isPositiveInt(t.max_score) ? t.max_score : 1,
          rubric_text: isNonEmptyString(t.rubric_text) ? (t.rubric_text as string).trim() : null,
        };
        const { error } = await db
          .from("homework_tutor_tasks")
          .update(updateFields)
          .eq("id", t.id)
          .eq("assignment_id", assignmentId);
        if (error) {
          console.error("homework_api_request_error", { route: "PUT /assignments/:id tasks update", error: error.message });
        }
      }

      if (toInsert.length > 0) {
        const maxExistingOrder = Math.max(
          0,
          ...toUpdate.map((t) => (isPositiveInt(t.order_num) ? (t.order_num as number) : 0)),
        );
        const insertRows = toInsert.map((t, i) => ({
          assignment_id: assignmentId,
          order_num: isPositiveInt(t.order_num) ? t.order_num : maxExistingOrder + i + 1,
          task_text: (t.task_text as string).trim(),
          task_image_url: isNonEmptyString(t.task_image_url) ? (t.task_image_url as string).trim() : null,
          correct_answer: isNonEmptyString(t.correct_answer) ? (t.correct_answer as string).trim() : null,
          max_score: isPositiveInt(t.max_score) ? t.max_score : 1,
          rubric_text: isNonEmptyString(t.rubric_text) ? (t.rubric_text as string).trim() : null,
        }));
        const { error } = await db
          .from("homework_tutor_tasks")
          .insert(insertRows);
        if (error) {
          console.error("homework_api_request_error", { route: "PUT /assignments/:id tasks insert", error: error.message });
          return jsonError(cors, 500, "DB_ERROR", "Failed to insert new tasks");
        }
      }
    }
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

  // Provision threads for guided_chat assignments (eager)
  if (assignment.workflow_mode === "guided_chat" && upserted && upserted.length > 0) {
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

  const profileTgMap: Record<string, number> = {};
  for (const p of profiles ?? []) {
    if (p.telegram_user_id) {
      profileTgMap[p.id] = p.telegram_user_id;
    }
  }

  const sessionTgMap: Record<string, number> = {};
  for (const s of sessions ?? []) {
    if (s.telegram_user_id) {
      sessionTgMap[s.user_id] = s.telegram_user_id;
    }
  }

  const appUrl = Deno.env.get("PUBLIC_APP_URL")?.trim().replace(/\/$/, "") ?? null;
  const homeworkUrl = appUrl ? `${appUrl}/homework/${assignmentId}` : null;
  const defaultMessage = `📚 Новое домашнее задание: <b>${escapeHtmlEntities(assignment.title as string)}</b>\n\nПредмет: ${escapeHtmlEntities(assignment.subject as string)}${homeworkUrl ? `\n<a href="${escapeHtmlEntities(homeworkUrl)}">Открыть ДЗ</a>` : "\nИспользуй /homework чтобы начать."}`;
  const text = messageTemplate ?? defaultMessage;

  let sent = 0;
  let failed = 0;
  const notifiedStudentIds: string[] = [];
  const failedStudentIds: string[] = [];
  const failedByReason: Record<string, NotifyFailureReason> = {};

  for (const sid of studentIds) {
    const profileChatId = profileTgMap[sid];
    const sessionChatId = sessionTgMap[sid];
    const chatId = profileChatId ?? sessionChatId;

    const hasProfileTelegramId = Boolean(profileChatId);
    const hasSession = typeof sessionChatId !== "undefined";

    console.log("homework_assignment_delivery_diagnostics", {
      assignment_id: assignmentId,
      student_id: sid,
      has_profile_telegram_id: hasProfileTelegramId,
      has_session: hasSession,
      session_user_id: hasSession ? sid : null,
      canonical_user_id: sid,
      reason: chatId ? "ready_to_send" : "missing_telegram_link",
    });

    if (!chatId) {
      failed++;
      failedStudentIds.push(sid);
      failedByReason[sid] = "missing_telegram_link";
      console.warn("homework_notify_student_failed", {
        assignment_id: assignmentId,
        student_id: sid,
        reason: "missing_telegram_link",
      });
      continue;
    }
    try {
      const payload: Record<string, unknown> = {
        chat_id: chatId,
        text,
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
        sent++;
        notifiedStudentIds.push(sid);
      } else {
        failed++;
        failedStudentIds.push(sid);
        failedByReason[sid] = "telegram_send_failed";
        const errBody = await lastResp?.text().catch(() => "unknown");
        console.error("homework_api_telegram_send_failed", {
          assignment_id: assignmentId,
          student_id: sid,
          chat_id: chatId,
          status: lastResp?.status,
          error: errBody,
        });
        console.warn("homework_notify_student_failed", {
          assignment_id: assignmentId,
          student_id: sid,
          reason: "telegram_send_failed",
        });
      }
    } catch (err) {
      failed++;
      failedStudentIds.push(sid);
      failedByReason[sid] = "telegram_send_error";
      console.error("homework_api_telegram_send_error", {
        assignment_id: assignmentId,
        student_id: sid,
        error: String(err),
      });
      console.warn("homework_notify_student_failed", {
        assignment_id: assignmentId,
        student_id: sid,
        reason: "telegram_send_error",
      });
    }
  }

  if (notifiedStudentIds.length > 0) {
    const now = new Date().toISOString();
    await db
      .from("homework_tutor_student_assignments")
      .update({ notified: true, notified_at: now, delivery_status: "delivered", delivery_error_code: null })
      .eq("assignment_id", assignmentId)
      .in("student_id", notifiedStudentIds);
  }

  // Update delivery_status for students who failed due to missing telegram link
  const noLinkStudents = failedStudentIds.filter((sid) => failedByReason[sid] === "missing_telegram_link");
  if (noLinkStudents.length > 0) {
    await db
      .from("homework_tutor_student_assignments")
      .update({ delivery_status: "failed_not_connected" })
      .eq("assignment_id", assignmentId)
      .in("student_id", noLinkStudents);
  }

  // Update delivery_status for students who had Telegram send errors
  const sendFailedStudents = failedStudentIds.filter((sid) =>
    failedByReason[sid] === "telegram_send_failed" || failedByReason[sid] === "telegram_send_error"
  );
  if (sendFailedStudents.length > 0) {
    await db
      .from("homework_tutor_student_assignments")
      .update({ delivery_status: "failed_blocked_or_other" })
      .eq("assignment_id", assignmentId)
      .in("student_id", sendFailedStudents);
  }

  console.log("homework_api_request_success", {
    route: "POST /assignments/:id/notify",
    tutor_id: tutorUserId,
    assignment_id: assignmentId,
    sent,
    failed,
    failed_student_ids: failedStudentIds,
    failed_by_reason: failedByReason,
  });
  return jsonOk(cors, {
    sent,
    failed,
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

  const { data: submissions } = await db
    .from("homework_tutor_submissions")
    .select("id, student_id, status, total_score, total_max_score, submitted_at")
    .eq("assignment_id", assignmentId)
    .order("submitted_at", { ascending: true });

  const submissionIds = (submissions ?? []).map((s) => s.id);

  let items: Record<string, unknown>[] = [];
  if (submissionIds.length > 0) {
    const { data } = await db
      .from("homework_tutor_submission_items")
      .select("id, submission_id, task_id, student_text, student_image_urls, recognized_text, ai_is_correct, ai_confidence, ai_feedback, ai_score, ai_error_type, tutor_override_correct, tutor_comment")
      .in("submission_id", submissionIds);
    items = (data ?? []) as Record<string, unknown>[];
  }

  const studentIds = [...new Set((submissions ?? []).map((s) => s.student_id))];
  let profileMap: Record<string, string | null> = {};
  if (studentIds.length > 0) {
    const { data: profiles } = await db
      .from("profiles")
      .select("id, username")
      .in("id", studentIds);
    for (const p of profiles ?? []) {
      profileMap[p.id] = p.username;
    }
  }

  let totalScoreSum = 0;
  let totalScoreCount = 0;
  const distribution = { "0-24": 0, "25-49": 0, "50-74": 0, "75-100": 0 };
  const errorTypeCounts: Record<string, number> = {};

  for (const s of submissions ?? []) {
    if (s.total_score != null && s.total_max_score != null && s.total_max_score > 0) {
      const pct = (s.total_score / s.total_max_score) * 100;
      totalScoreSum += pct;
      totalScoreCount++;

      if (pct < 25) distribution["0-24"]++;
      else if (pct < 50) distribution["25-49"]++;
      else if (pct < 75) distribution["50-74"]++;
      else distribution["75-100"]++;
    }
  }

  for (const item of items) {
    if (item.ai_error_type && item.ai_error_type !== "correct") {
      const et = item.ai_error_type as string;
      errorTypeCounts[et] = (errorTypeCounts[et] ?? 0) + 1;
    }
  }

  // Guided chat: gather completed thread data for summary, perStudent, perTask
  const assignmentRecord = assignmentOrErr as Record<string, unknown>;
  // deno-lint-ignore no-explicit-any
  const guidedPerStudent: any[] = [];
  const guidedTaskScores: Record<string, { scoreSum: number; scoreCount: number; total: number }> = {};

  if (assignmentRecord.workflow_mode === "guided_chat") {
    const { data: studentAssignments } = await db
      .from("homework_tutor_student_assignments")
      .select("id, student_id")
      .eq("assignment_id", assignmentId);

    if (studentAssignments && studentAssignments.length > 0) {
      const saIds = studentAssignments.map((sa) => sa.id);
      const saToStudent: Record<string, string> = {};
      for (const sa of studentAssignments) {
        saToStudent[sa.id] = sa.student_id;
      }

      const { data: completedThreads } = await db
        .from("homework_tutor_threads")
        .select("id, student_assignment_id, updated_at")
        .in("student_assignment_id", saIds)
        .eq("status", "completed");

      if (completedThreads && completedThreads.length > 0) {
        const threadIds = completedThreads.map((t) => t.id);

        const { data: allTaskStates } = await db
          .from("homework_tutor_task_states")
          .select("thread_id, task_id, earned_score, available_score, status")
          .in("thread_id", threadIds);

        // Group task states by thread
        const statesByThread: Record<string, typeof allTaskStates> = {};
        for (const ts of allTaskStates ?? []) {
          if (!statesByThread[ts.thread_id]) statesByThread[ts.thread_id] = [];
          statesByThread[ts.thread_id]!.push(ts);
        }

        // Collect student IDs for profile lookup
        const guidedStudentIds = completedThreads.map((t) => saToStudent[t.student_assignment_id]);
        const uniqueGuidedStudentIds = [...new Set(guidedStudentIds)].filter((id) => !profileMap[id]);
        if (uniqueGuidedStudentIds.length > 0) {
          const { data: profiles } = await db
            .from("profiles")
            .select("id, username")
            .in("id", uniqueGuidedStudentIds);
          for (const p of profiles ?? []) {
            profileMap[p.id] = p.username;
          }
        }

        for (const thread of completedThreads) {
          const studentId = saToStudent[thread.student_assignment_id];
          const states = statesByThread[thread.id] ?? [];

          let threadEarned = 0;
          let threadAvailable = 0;
          const taskItems: { task_id: string; task_order_num: number; task_text: string; max_score: number; ai_score: number | null }[] = [];

          for (const ts of states) {
            const earned = Number(ts.earned_score ?? 0);
            const available = Number(ts.available_score ?? 0);
            threadEarned += earned;
            threadAvailable += available;

            const taskInfo = taskMap[ts.task_id];
            if (taskInfo) {
              taskItems.push({
                task_id: ts.task_id,
                task_order_num: taskInfo.order_num,
                task_text: taskInfo.task_text,
                max_score: taskInfo.max_score,
                ai_score: earned,
              });

              // Aggregate for perTask
              if (!guidedTaskScores[ts.task_id]) {
                guidedTaskScores[ts.task_id] = { scoreSum: 0, scoreCount: 0, total: 0 };
              }
              guidedTaskScores[ts.task_id].total++;
              if (ts.status === "completed") {
                guidedTaskScores[ts.task_id].scoreSum += earned;
                guidedTaskScores[ts.task_id].scoreCount++;
              }
            }
          }

          const pct = threadAvailable > 0
            ? Math.round((threadEarned / threadAvailable) * 100 * 100) / 100
            : null;

          // Add to summary distribution
          if (pct != null) {
            totalScoreSum += (threadEarned / threadAvailable) * 100;
            totalScoreCount++;

            if (pct < 25) distribution["0-24"]++;
            else if (pct < 50) distribution["25-49"]++;
            else if (pct < 75) distribution["50-74"]++;
            else distribution["75-100"]++;
          }

          guidedPerStudent.push({
            student_id: studentId,
            name: profileMap[studentId] ?? null,
            status: "completed",
            submitted_at: thread.updated_at ?? null,
            total_score: threadEarned,
            total_max_score: threadAvailable,
            percent: pct,
            submission_id: thread.id,
            top_error_types: [],
            submission_items: taskItems.sort((a, b) => a.task_order_num - b.task_order_num).map((ti) => ({
              task_id: ti.task_id,
              task_order_num: ti.task_order_num,
              task_text: ti.task_text,
              max_score: ti.max_score,
              student_text: null,
              student_image_urls: null,
              recognized_text: null,
              ai_is_correct: null,
              ai_confidence: null,
              ai_feedback: null,
              ai_error_type: null,
              ai_score: ti.ai_score,
              tutor_override_correct: null,
              tutor_comment: null,
            })),
          });
        }
      }
    }
  }

  const summary = {
    avg_score: totalScoreCount > 0
      ? Math.round((totalScoreSum / totalScoreCount) * 100) / 100
      : null,
    distribution,
    common_error_types: Object.entries(errorTypeCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => ({ type, count })),
  };

  const submissionItemsBySubmission: Record<string, Record<string, unknown>[]> = {};
  for (const item of items) {
    const sid = item.submission_id as string;
    if (!submissionItemsBySubmission[sid]) submissionItemsBySubmission[sid] = [];
    submissionItemsBySubmission[sid].push(item);
  }

  const perStudentClassic = (submissions ?? []).map((s) => {
    const pct = (s.total_score != null && s.total_max_score != null && s.total_max_score > 0)
      ? Math.round((s.total_score / s.total_max_score) * 100 * 100) / 100
      : null;

    const sItems = submissionItemsBySubmission[s.id] ?? [];
    const topErrors: Record<string, number> = {};
    for (const it of sItems) {
      if (it.ai_error_type && it.ai_error_type !== "correct") {
        const et = it.ai_error_type as string;
        topErrors[et] = (topErrors[et] ?? 0) + 1;
      }
    }

    const submissionItems = sItems.map((it) => {
      const taskInfo = taskMap[it.task_id as string];
      return {
        task_id: it.task_id,
        task_order_num: taskInfo?.order_num ?? 0,
        task_text: taskInfo?.task_text ?? "",
        max_score: taskInfo?.max_score ?? 1,
        student_text: it.student_text ?? null,
        student_image_urls: it.student_image_urls ?? null,
        recognized_text: it.recognized_text ?? null,
        ai_is_correct: it.ai_is_correct ?? null,
        ai_confidence: it.ai_confidence ?? null,
        ai_feedback: it.ai_feedback ?? null,
        ai_error_type: it.ai_error_type ?? null,
        ai_score: it.ai_score ?? null,
        tutor_override_correct: it.tutor_override_correct ?? null,
        tutor_comment: it.tutor_comment ?? null,
      };
    }).sort((a, b) => a.task_order_num - b.task_order_num);

    return {
      student_id: s.student_id,
      name: profileMap[s.student_id] ?? null,
      status: s.status,
      submitted_at: s.submitted_at ?? null,
      total_score: s.total_score,
      total_max_score: s.total_max_score,
      percent: pct,
      submission_id: s.id,
      top_error_types: Object.entries(topErrors)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([type, count]) => ({ type, count })),
      submission_items: submissionItems,
    };
  });

  const perStudent = [...perStudentClassic, ...guidedPerStudent];

  const perTask = (tasks ?? []).map((t) => {
    const taskItems = items.filter((it) => it.task_id === t.id);
    let scoreSum = 0;
    let scoreCount = 0;
    let correctCount = 0;
    let totalCount = taskItems.length;
    const taskErrorCounts: Record<string, number> = {};

    for (const it of taskItems) {
      const isCorrect = it.tutor_override_correct ?? it.ai_is_correct;
      if (isCorrect === true) correctCount++;

      const score = it.ai_score as number | null;
      if (score != null) {
        scoreSum += score;
        scoreCount++;
      }

      if (it.ai_error_type && it.ai_error_type !== "correct") {
        const et = it.ai_error_type as string;
        taskErrorCounts[et] = (taskErrorCounts[et] ?? 0) + 1;
      }
    }

    // Add guided chat task scores
    const guidedData = guidedTaskScores[t.id];
    if (guidedData) {
      scoreSum += guidedData.scoreSum;
      scoreCount += guidedData.scoreCount;
      totalCount += guidedData.total;
    }

    return {
      task_id: t.id,
      order_num: t.order_num,
      max_score: t.max_score,
      avg_score: scoreCount > 0 ? Math.round((scoreSum / scoreCount) * 100) / 100 : null,
      correct_rate: totalCount > 0
        ? Math.round((correctCount / totalCount) * 100 * 100) / 100
        : null,
      error_type_histogram: Object.entries(taskErrorCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([type, count]) => ({ type, count })),
    };
  });

  console.log("homework_api_request_success", {
    route: "GET /assignments/:id/results",
    tutor_id: tutorUserId,
    assignment_id: assignmentId,
  });

  return jsonOk(cors, { summary, per_student: perStudent, per_task: perTask });
}

// ─── Endpoint: POST /submissions/:id/review ──────────────────────────────────

async function handleReviewSubmission(
  db: SupabaseClient,
  tutorUserId: string,
  submissionId: string,
  body: unknown,
  cors: Record<string, string>,
): Promise<Response> {
  const submissionOrErr = await getOwnedSubmissionOrThrow(db, submissionId, tutorUserId, cors);
  if (submissionOrErr instanceof Response) return submissionOrErr;
  const submission = submissionOrErr;

  if (!body || typeof body !== "object") {
    return jsonError(cors, 400, "INVALID_BODY", "Request body must be a JSON object");
  }
  const b = body as Record<string, unknown>;

  if (!Array.isArray(b.items) || b.items.length === 0) {
    return jsonError(cors, 400, "VALIDATION", "items must be a non-empty array");
  }

  for (let i = 0; i < b.items.length; i++) {
    const item = b.items[i];
    if (!item || typeof item !== "object") {
      return jsonError(cors, 400, "VALIDATION", `items[${i}] must be an object`);
    }
    if (!isUUID(item.task_id)) {
      return jsonError(cors, 400, "VALIDATION", `items[${i}].task_id must be a valid UUID`);
    }
    if (item.tutor_override_correct !== undefined && typeof item.tutor_override_correct !== "boolean") {
      return jsonError(cors, 400, "VALIDATION", `items[${i}].tutor_override_correct must be boolean`);
    }
    if (item.tutor_comment !== undefined && item.tutor_comment !== null && !isString(item.tutor_comment)) {
      return jsonError(cors, 400, "VALIDATION", `items[${i}].tutor_comment must be a string`);
    }
    if (item.tutor_score !== undefined && item.tutor_score !== null && !isNonNegativeInt(item.tutor_score)) {
      return jsonError(cors, 400, "VALIDATION", `items[${i}].tutor_score must be a non-negative integer`);
    }
  }

  const { data: taskInfos } = await db
    .from("homework_tutor_tasks")
    .select("id, max_score")
    .eq("assignment_id", submission.assignment_id);
  const taskMaxScoreMap: Record<string, number> = {};
  for (const t of taskInfos ?? []) {
    taskMaxScoreMap[t.id] = t.max_score;
  }

  for (const item of b.items as Record<string, unknown>[]) {
    const taskId = item.task_id as string;
    const maxScore = taskMaxScoreMap[taskId] ?? 1;

    const updateFields: Record<string, unknown> = {};

    if (item.tutor_override_correct !== undefined) {
      updateFields.tutor_override_correct = item.tutor_override_correct;
    }
    if (item.tutor_comment !== undefined) {
      updateFields.tutor_comment = isNonEmptyString(item.tutor_comment)
        ? (item.tutor_comment as string).trim()
        : null;
    }

    if (item.tutor_score !== undefined && item.tutor_score !== null) {
      updateFields.ai_score = item.tutor_score;
    } else if (item.tutor_override_correct !== undefined && (item.tutor_score === undefined || item.tutor_score === null)) {
      updateFields.ai_score = item.tutor_override_correct ? maxScore : 0;
    }

    if (Object.keys(updateFields).length > 0) {
      const { error } = await db
        .from("homework_tutor_submission_items")
        .update(updateFields)
        .eq("submission_id", submissionId)
        .eq("task_id", taskId);
      if (error) {
        console.error("homework_api_request_error", {
          route: "POST /submissions/:id/review",
          error: error.message,
          task_id: taskId,
        });
      }
    }
  }

  const { data: allItems } = await db
    .from("homework_tutor_submission_items")
    .select("ai_score, task_id")
    .eq("submission_id", submissionId);

  let totalScore = 0;
  let totalMaxScore = 0;
  for (const it of allItems ?? []) {
    const maxS = taskMaxScoreMap[it.task_id] ?? 1;
    totalMaxScore += maxS;
    totalScore += it.ai_score ?? 0;
  }

  const newStatus = isNonEmptyString(b.status) &&
      (VALID_SUBMISSION_STATUSES as readonly string[]).includes(b.status as string)
    ? b.status
    : "tutor_reviewed";

  const { error: subUpdateErr } = await db
    .from("homework_tutor_submissions")
    .update({
      total_score: totalScore,
      total_max_score: totalMaxScore,
      status: newStatus,
    })
    .eq("id", submissionId);

  if (subUpdateErr) {
    console.error("homework_api_request_error", {
      route: "POST /submissions/:id/review submission update",
      error: subUpdateErr.message,
    });
    return jsonError(cors, 500, "DB_ERROR", "Failed to update submission totals");
  }

  console.log("homework_api_request_success", {
    route: "POST /submissions/:id/review",
    tutor_id: tutorUserId,
    submission_id: submissionId,
    total_score: totalScore,
    total_max_score: totalMaxScore,
  });
  return jsonOk(cors, { ok: true });
}

// ─── Endpoint: GET /templates ────────────────────────────────────────────────

async function handleListTemplates(
  db: SupabaseClient,
  tutorUserId: string,
  searchParams: URLSearchParams,
  cors: Record<string, string>,
): Promise<Response> {
  const subject = searchParams.get("subject");
  if (subject && !(VALID_SUBJECTS as readonly string[]).includes(subject)) {
    return jsonError(cors, 400, "VALIDATION", `subject must be one of: ${VALID_SUBJECTS.join(", ")}`);
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
  if (!isNonEmptyString(b.subject) || !(VALID_SUBJECTS as readonly string[]).includes(b.subject)) {
    return jsonError(cors, 400, "VALIDATION", `subject must be one of: ${VALID_SUBJECTS.join(", ")}`);
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

  const { data: submissionRows, error: submissionRowsError } = await db
    .from("homework_tutor_submissions")
    .select("id")
    .eq("assignment_id", assignmentId);
  if (submissionRowsError) {
    console.error("homework_api_request_error", { route: "DELETE /assignments/:id", error: submissionRowsError.message });
    return jsonError(cors, 500, "DB_ERROR", "Failed to delete assignment");
  }
  const submissionIds = (submissionRows ?? []).map((row) => row.id);

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

      const { error: deleteSubmissionItemsByTaskError } = await db
        .from("homework_tutor_submission_items")
        .delete()
        .in("task_id", taskIds);
      if (deleteSubmissionItemsByTaskError) throw deleteSubmissionItemsByTaskError;
    }

    if (submissionIds.length > 0) {
      const { error: deleteSubmissionItemsBySubmissionError } = await db
        .from("homework_tutor_submission_items")
        .delete()
        .in("submission_id", submissionIds);
      if (deleteSubmissionItemsBySubmissionError) throw deleteSubmissionItemsBySubmissionError;
    }

    await deleteByAssignment("homework_tutor_submissions");

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

// ─── Endpoint: GET /assignments/:id/tasks/:taskId/image-url ──────────────────

async function handleTaskImageSignedUrl(
  db: SupabaseClient,
  userId: string,
  assignmentId: string,
  taskId: string,
  cors: Record<string, string>,
): Promise<Response> {
  if (!isUUID(assignmentId)) {
    return jsonError(cors, 400, "INVALID_ID", "Invalid assignment ID format");
  }
  if (!isUUID(taskId)) {
    return jsonError(cors, 400, "INVALID_ID", "Invalid task ID format");
  }

  // Access check: tutor who owns the assignment OR student assigned to it
  const { data: assignment } = await db
    .from("homework_tutor_assignments")
    .select("id, tutor_id")
    .eq("id", assignmentId)
    .maybeSingle();

  if (!assignment) {
    return jsonError(cors, 404, "NOT_FOUND", "Assignment not found");
  }

  const isTutor = assignment.tutor_id === userId;
  if (!isTutor) {
    // Check if user is an assigned student
    const { data: studentAssignment } = await db
      .from("homework_tutor_student_assignments")
      .select("id")
      .eq("assignment_id", assignmentId)
      .eq("student_id", userId)
      .maybeSingle();

    if (!studentAssignment) {
      return jsonError(cors, 403, "FORBIDDEN", "Not authorized to access this assignment");
    }
  }

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

// ─── Endpoint: GET /assignments/:id/attempts ─────────────────────────────────

async function handleListAttempts(
  db: SupabaseClient,
  tutorUserId: string,
  assignmentId: string,
  searchParams: URLSearchParams,
  cors: Record<string, string>,
): Promise<Response> {
  const assignmentOrErr = await getOwnedAssignmentOrThrow(db, assignmentId, tutorUserId, cors);
  if (assignmentOrErr instanceof Response) return assignmentOrErr;

  const studentId = searchParams.get("student_id");
  if (studentId && !isUUID(studentId)) {
    return jsonError(cors, 400, "INVALID_ID", "Invalid student_id format");
  }

  let query = db
    .from("homework_tutor_submissions")
    .select("id, student_id, status, total_score, total_max_score, submitted_at")
    .eq("assignment_id", assignmentId)
    .order("submitted_at", { ascending: true });

  if (studentId) {
    query = query.eq("student_id", studentId);
  }

  const { data, error } = await query;
  if (error) {
    console.error("homework_api_request_error", { route: "GET /assignments/:id/attempts", error: error.message });
    return jsonError(cors, 500, "DB_ERROR", "Failed to fetch attempts");
  }

  return jsonOk(cors, data ?? []);
}

// ─── Endpoint: POST /student/submissions/:id/ai-check ───────────────────────

async function handleStudentSubmissionAiCheck(
  db: SupabaseClient,
  studentUserId: string,
  submissionId: string,
  cors: Record<string, string>,
): Promise<Response> {
  if (!isUUID(submissionId)) {
    return jsonError(cors, 400, "INVALID_ID", "Invalid submission ID format");
  }

  const { data: submission, error: submissionError } = await db
    .from("homework_tutor_submissions")
    .select("id, student_id, status, total_score, total_max_score")
    .eq("id", submissionId)
    .maybeSingle();

  if (submissionError || !submission) {
    return jsonError(cors, 404, "NOT_FOUND", "Submission not found");
  }

  if (submission.student_id !== studentUserId) {
    return jsonError(cors, 403, "FORBIDDEN", "Submission does not belong to current user");
  }

  const status = submission.status as string;
  if (status === "ai_checked" || status === "tutor_reviewed") {
    return jsonOk(cors, {
      status,
      total_score: submission.total_score ?? null,
      total_max_score: submission.total_max_score ?? null,
    });
  }

  if (status !== "submitted") {
    return jsonError(cors, 409, "INVALID_STATE", "Submission is not ready for AI check");
  }

  let summary: Awaited<ReturnType<typeof runHomeworkAiCheck>>;
  try {
    summary = await runHomeworkAiCheck(db, submissionId);
  } catch (error) {
    console.error("homework_api_student_ai_check_failed", {
      submission_id: submissionId,
      student_id: studentUserId,
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonError(cors, 500, "AI_CHECK_FAILED", "Failed to run AI check");
  }

  const { data: updatedSubmission, error: updateError } = await db
    .from("homework_tutor_submissions")
    .update({
      status: "ai_checked",
      total_score: summary.total_score,
      total_max_score: summary.total_max_score,
    })
    .eq("id", submissionId)
    .eq("student_id", studentUserId)
    .in("status", ["submitted", "ai_checked"])
    .select("status, total_score, total_max_score")
    .maybeSingle();

  if (updateError) {
    return jsonError(cors, 500, "DB_ERROR", "Failed to update submission after AI check");
  }

  if (!updatedSubmission) {
    const { data: existingSubmission, error: existingError } = await db
      .from("homework_tutor_submissions")
      .select("status, total_score, total_max_score")
      .eq("id", submissionId)
      .eq("student_id", studentUserId)
      .maybeSingle();

    if (existingError || !existingSubmission) {
      return jsonError(cors, 500, "DB_ERROR", "Failed to verify submission status");
    }

    return jsonOk(cors, {
      status: existingSubmission.status,
      total_score: existingSubmission.total_score ?? null,
      total_max_score: existingSubmission.total_max_score ?? null,
    });
  }

  return jsonOk(cors, {
    status: updatedSubmission.status,
    total_score: updatedSubmission.total_score ?? null,
    total_max_score: updatedSubmission.total_max_score ?? null,
  });
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
    .select("student_id")
    .eq("id", thread.student_assignment_id)
    .single();

  if (!sa || sa.student_id !== userId) {
    return jsonError(cors, 403, "FORBIDDEN", "Not your thread");
  }

  // Filter out hidden tutor notes (service-role bypasses RLS)
  return jsonOk(cors, stripHiddenMessages(thread as Record<string, unknown>));
}

// ─── Endpoint: POST /threads/:id/messages (student) ─────────────────────────

async function verifyThreadOwnership(
  db: SupabaseClient,
  threadId: string,
  userId: string,
  cors: Record<string, string>,
): Promise<{ thread: Record<string, unknown> } | Response> {
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
    .select("student_id")
    .eq("id", thread.student_assignment_id)
    .single();

  if (!sa || sa.student_id !== userId) {
    return jsonError(cors, 403, "FORBIDDEN", "Not your thread");
  }

  return { thread: thread as Record<string, unknown> };
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
  const { thread } = ownershipResult;

  if (!body || typeof body !== "object") {
    return jsonError(cors, 400, "INVALID_BODY", "Request body must be a JSON object");
  }
  const b = body as Record<string, unknown>;

  if (!isNonEmptyString(b.content)) {
    return jsonError(cors, 400, "VALIDATION", "content is required (non-empty string)");
  }
  const role = b.role === "assistant" ? "assistant" : "user";
  const imageUrl = isString(b.image_url) ? (b.image_url as string) : null;
  const taskOrder = typeof b.task_order === "number" ? b.task_order : (thread.current_task_order as number);
  const messageKindRaw = isString(b.message_kind) ? (b.message_kind as string).trim() : "";
  const validMessageKinds = new Set(["answer", "hint_request", "question", "ai_reply", "system"]);
  const messageKind = validMessageKinds.has(messageKindRaw)
    ? messageKindRaw
    : (role === "assistant" ? "ai_reply" : "answer");

  // Integrity check: assistant messages can only follow a user message
  if (role === "assistant") {
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
    image_url: imageUrl,
    task_order: taskOrder,
    message_kind: messageKind,
  };
  const payloadLegacy = {
    thread_id: threadId,
    role,
    content: b.content,
    image_url: imageUrl,
    task_order: taskOrder,
  };

  let savedMsg: Record<string, unknown> | null = null;
  let insertErr: { message?: string } | null = null;

  const withKindResult = await db
    .from("homework_tutor_thread_messages")
    .insert(payloadWithKind)
    .select("id, role, content, image_url, task_order, created_at")
    .single();

  if (withKindResult.error && isMissingColumnError(withKindResult.error.message, "message_kind")) {
    const legacyResult = await db
      .from("homework_tutor_thread_messages")
      .insert(payloadLegacy)
      .select("id, role, content, image_url, task_order, created_at")
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
  const { thread } = ownershipResult;

  if (thread.status === "completed") {
    return jsonError(cors, 400, "ALREADY_COMPLETED", "Thread is already completed");
  }

  const b = (body && typeof body === "object") ? body as Record<string, unknown> : {};
  // Clamp score to 0-100 if provided
  const rawScore = typeof b.score === "number" ? b.score : null;
  const score = rawScore !== null ? Math.max(0, Math.min(100, rawScore)) : null;

  // Guard: require at least 1 AI reply for the current task before allowing advance
  const { count: assistantMsgCount } = await db
    .from("homework_tutor_thread_messages")
    .select("id", { count: "exact", head: true })
    .eq("thread_id", threadId)
    .eq("role", "assistant")
    .eq("task_order", thread.current_task_order as number);

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
  id, status, current_task_order, created_at, updated_at,
  student_assignment_id, last_student_message_at, last_tutor_message_at,
  homework_tutor_thread_messages(id, role, content, image_url, task_order, message_kind, created_at, author_user_id, visible_to_student),
  homework_tutor_task_states(id, task_id, status, attempts, best_score, available_score, earned_score, wrong_answer_count, hint_count)
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
  return thread ? stripHiddenMessages(thread) : null;
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
      { student_assignment_id: studentAssignmentId, status: "active", current_task_order: 1 },
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

  const taskStateRows = tasks.map((task: { id: string; max_score?: number }, idx: number) => ({
    thread_id: thread.id,
    task_id: task.id,
    status: idx === 0 ? "active" : "locked",
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

  // Find next task
  const currentIdx = sortedOrders.indexOf(currentOrder);
  const nextOrder = currentIdx < sortedOrders.length - 1 ? sortedOrders[currentIdx + 1] : null;

  if (nextOrder !== null) {
    // Unlock next task
    const nextState = stateByOrder.get(nextOrder);
    if (nextState) {
      await db
        .from("homework_tutor_task_states")
        .update({
          status: "active",
          updated_at: new Date().toISOString(),
        })
        .eq("id", nextState.id);
    }

    // Update thread current_task_order
    await db
      .from("homework_tutor_threads")
      .update({
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
        task_order: nextOrder,
        message_kind: "system",
      });

    return { nextOrder, threadCompleted: false };
  } else {
    // All tasks completed
    await db
      .from("homework_tutor_threads")
      .update({
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
        task_order: currentOrder,
        message_kind: "system",
      });

    return { nextOrder: null, threadCompleted: true };
  }
}

// ─── Helper: load advance context (shared between /advance and /check) ──────

async function loadAdvanceContext(
  db: SupabaseClient,
  threadId: string,
  thread: Record<string, unknown>,
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

  const currentOrder = thread.current_task_order as number;
  const currentState = stateByOrder.get(currentOrder);
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
  const { thread } = ownershipResult;

  if (thread.status === "completed") {
    return jsonError(cors, 400, "ALREADY_COMPLETED", "Thread is already completed");
  }

  const b = (body && typeof body === "object") ? body as Record<string, unknown> : {};
  const answer = typeof b.answer === "string" ? b.answer.trim() : "";
  if (!answer) {
    return jsonError(cors, 400, "VALIDATION", "answer is required");
  }

  // Load advance context
  const ctx = await loadAdvanceContext(db, threadId, thread);
  if (!ctx) {
    return jsonError(cors, 400, "NO_ACTIVE_TASK", "No active task to check");
  }

  const { currentState, currentOrder, stateByOrder, sortedOrders, tasks } = ctx;

  // Load the full task (with correct_answer, rubric)
  const { data: task } = await db
    .from("homework_tutor_tasks")
    .select("id, order_num, task_text, task_image_url, correct_answer, rubric_text, max_score")
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
    .select("role, content, visible_to_student")
    .eq("thread_id", threadId)
    .eq("task_order", currentOrder)
    .order("created_at", { ascending: true })
    .limit(15);

  // Initialize available_score if null (backward compat for old threads)
  const currentAvailableScore: number =
    currentState.available_score != null
      ? Number(currentState.available_score)
      : (task.max_score ?? 1);

  // Save user answer message
  await db.from("homework_tutor_thread_messages").insert({
    thread_id: threadId,
    role: "user",
    content: answer,
    task_order: currentOrder,
    message_kind: "answer",
  });

  // Update last_student_message_at
  await db.from("homework_tutor_threads")
    .update({ last_student_message_at: new Date().toISOString() })
    .eq("id", threadId);

  // Increment attempts
  await db
    .from("homework_tutor_task_states")
    .update({
      attempts: ((currentState.attempts as number) ?? 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", currentState.id);

  // Call AI evaluation
  const totalTasks = tasks.length;
  const result = await evaluateStudentAnswer({
    studentAnswer: answer,
    taskText: task.task_text ?? "",
    taskImageUrl: task.task_image_url ?? null,
    correctAnswer: task.correct_answer,
    rubricText: task.rubric_text,
    subject: assignment.subject ?? "math",
    conversationHistory: recentMessages ?? [],
    wrongAnswerCount: (currentState.wrong_answer_count as number) ?? 0,
    hintCount: (currentState.hint_count as number) ?? 0,
    availableScore: currentAvailableScore,
    maxScore: task.max_score ?? 1,
  });

  // Save AI feedback message
  await db.from("homework_tutor_thread_messages").insert({
    thread_id: threadId,
    role: "assistant",
    content: result.feedback,
    task_order: currentOrder,
    message_kind: "ai_reply",
  });

  let responseData: Record<string, unknown>;

  if (result.verdict === "CORRECT") {
    // Set earned_score, mark completed, advance
    const earnedScore = currentAvailableScore;

    await db.from("homework_tutor_task_states").update({
      status: "completed",
      earned_score: earnedScore,
      available_score: currentAvailableScore,
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
      earned_score: earnedScore,
      available_score: currentAvailableScore,
      max_score: task.max_score ?? 1,
      wrong_answer_count: (currentState.wrong_answer_count as number) ?? 0,
      hint_count: (currentState.hint_count as number) ?? 0,
      task_completed: true,
      next_task_order: advanceResult.nextOrder,
      thread_completed: advanceResult.threadCompleted,
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
      wrong_answer_count: newWrongCount,
      available_score: newAvailableScore,
      last_ai_feedback: result.feedback,
      updated_at: new Date().toISOString(),
    }).eq("id", currentState.id);

    responseData = {
      verdict: "INCORRECT",
      feedback: result.feedback,
      earned_score: null,
      available_score: newAvailableScore,
      max_score: task.max_score ?? 1,
      wrong_answer_count: newWrongCount,
      hint_count: newHintCount,
      task_completed: false,
      next_task_order: null,
      thread_completed: false,
      total_tasks: totalTasks,
    };
  }

  // Return updated thread (student-facing: filter hidden notes)
  const updatedThread = await fetchStudentThread(db, threadId);
  return jsonOk(cors, { ...responseData, thread: updatedThread });
}

// ─── Endpoint: POST /threads/:id/hint (student — Phase 3) ──────────────────

async function handleRequestHint(
  db: SupabaseClient,
  userId: string,
  threadId: string,
  cors: Record<string, string>,
): Promise<Response> {
  const ownershipResult = await verifyThreadOwnership(db, threadId, userId, cors);
  if (ownershipResult instanceof Response) return ownershipResult;
  const { thread } = ownershipResult;

  if (thread.status === "completed") {
    return jsonError(cors, 400, "ALREADY_COMPLETED", "Thread is already completed");
  }

  // Get active task_state
  const { data: activeState } = await db
    .from("homework_tutor_task_states")
    .select("id, task_id, status, attempts, best_score, available_score, wrong_answer_count, hint_count")
    .eq("thread_id", threadId)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (!activeState) {
    return jsonError(cors, 400, "NO_ACTIVE_TASK", "No active task for hint");
  }

  const currentOrder = thread.current_task_order as number;

  // Load task
  const { data: task } = await db
    .from("homework_tutor_tasks")
    .select("id, order_num, task_text, task_image_url, correct_answer, max_score")
    .eq("id", activeState.task_id)
    .single();

  if (!task) {
    return jsonError(cors, 500, "DB_ERROR", "Task not found");
  }

  // Load assignment for subject
  const { data: sa } = await db
    .from("homework_tutor_student_assignments")
    .select("assignment_id")
    .eq("id", thread.student_assignment_id)
    .single();

  const { data: assignment } = await db
    .from("homework_tutor_assignments")
    .select("subject")
    .eq("id", sa?.assignment_id)
    .single();

  // Load conversation history
  const { data: recentMessages } = await db
    .from("homework_tutor_thread_messages")
    .select("role, content, visible_to_student")
    .eq("thread_id", threadId)
    .eq("task_order", currentOrder)
    .order("created_at", { ascending: true })
    .limit(15);

  // Save hint request message from user
  await db.from("homework_tutor_thread_messages").insert({
    thread_id: threadId,
    role: "user",
    content: "Подсказка",
    task_order: currentOrder,
    message_kind: "hint_request",
  });

  // Update last_student_message_at
  await db.from("homework_tutor_threads")
    .update({ last_student_message_at: new Date().toISOString() })
    .eq("id", threadId);

  // Call AI for hint
  const hintResult = await generateHint({
    taskText: task.task_text ?? "",
    taskImageUrl: task.task_image_url ?? null,
    correctAnswer: task.correct_answer,
    subject: assignment?.subject ?? "math",
    conversationHistory: recentMessages ?? [],
    wrongAnswerCount: (activeState.wrong_answer_count as number) ?? 0,
    hintCount: (activeState.hint_count as number) ?? 0,
  });

  // Save hint reply
  await db.from("homework_tutor_thread_messages").insert({
    thread_id: threadId,
    role: "assistant",
    content: hintResult.hint,
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

  // Lazy provisioning: create thread if assignment is guided_chat but thread doesn't exist yet
  if (!thread && assignmentOrErr.workflow_mode === "guided_chat") {
    thread = await provisionGuidedThread(db, assignmentId, studentAssignment.id);
  }

  if (!thread) {
    return jsonError(cors, 404, "NOT_FOUND", "Thread not found");
  }

  const { data: tasks, error: tasksError } = await db
    .from("homework_tutor_tasks")
    .select("id, order_num, task_text, task_image_url, max_score")
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
    .select("id, status, current_task_order")
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
  const taskOrder = typeof b.task_order === "number"
    ? b.task_order
    : (thread.current_task_order as number);

  // Insert message with role = 'tutor'
  const { data: msg, error: msgErr } = await db
    .from("homework_tutor_thread_messages")
    .insert({
      thread_id: thread.id,
      role: "tutor",
      content,
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

    // POST /student/submissions/:id/ai-check
    if (seg.length === 4 && seg[0] === "student" && seg[1] === "submissions" && seg[3] === "ai-check" && route.method === "POST") {
      return await handleStudentSubmissionAiCheck(db, userId, seg[2], cors);
    }

    // GET /threads/:id (student endpoint)
    if (seg.length === 2 && seg[0] === "threads" && route.method === "GET") {
      return await handleGetThread(db, userId, seg[1], cors);
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
      return await handleRequestHint(db, userId, seg[1], cors);
    }

    // GET /assignments/:id/tasks/:taskId/image-url (tutor + student)
    if (seg.length === 5 && seg[0] === "assignments" && seg[2] === "tasks" && seg[4] === "image-url" && route.method === "GET") {
      return await handleTaskImageSignedUrl(db, userId, seg[1], seg[3], cors);
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

    // GET /assignments/:id/results
    if (seg.length === 3 && seg[0] === "assignments" && seg[2] === "results" && route.method === "GET") {
      return await handleGetResults(db, userId, seg[1], cors);
    }

    // GET /assignments/:id/attempts
    if (seg.length === 3 && seg[0] === "assignments" && seg[2] === "attempts" && route.method === "GET") {
      return await handleListAttempts(db, userId, seg[1], route.searchParams, cors);
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

    // POST /submissions/:id/review
    if (seg.length === 3 && seg[0] === "submissions" && seg[2] === "review" && route.method === "POST") {
      const body = await parseJsonBody(req);
      return await handleReviewSubmission(db, userId, seg[1], body, cors);
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
