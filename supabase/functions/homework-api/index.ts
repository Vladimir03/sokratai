import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

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
  if (b.max_attempts !== undefined && b.max_attempts !== null && !isPositiveInt(b.max_attempts)) {
    return jsonError(cors, 400, "VALIDATION", "max_attempts must be a positive integer");
  }
  if (b.group_id !== undefined && b.group_id !== null && !isUUID(b.group_id)) {
    return jsonError(cors, 400, "VALIDATION", "group_id must be a UUID or null");
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
      max_attempts: isPositiveInt(b.max_attempts) ? b.max_attempts : 3,
      group_id: isUUID(b.group_id) ? b.group_id : null,
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
    solution_steps: isNonEmptyString(t.solution_steps) ? (t.solution_steps as string).trim() : null,
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
      solution_steps: t.solution_steps,
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
    .select("id, order_num, task_text, task_image_url, correct_answer, solution_steps, max_score, rubric_text")
    .eq("assignment_id", assignmentId)
    .order("order_num", { ascending: true });

  const { data: studentAssignments } = await db
    .from("homework_tutor_student_assignments")
    .select("student_id, notified, notified_at, delivery_status, delivery_error_code")
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

  const submissionsSummary = {
    total: (submissions ?? []).length,
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
        if (t.solution_steps !== undefined) {
          updateFields.solution_steps = isNonEmptyString(t.solution_steps) ? (t.solution_steps as string).trim() : null;
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
          solution_steps: isNonEmptyString(t.solution_steps) ? (t.solution_steps as string).trim() : null,
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
          solution_steps: isNonEmptyString(t.solution_steps) ? (t.solution_steps as string).trim() : null,
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

  const { data: studentProfiles, error: studentProfilesError } = await db
    .from("profiles")
    .select("id, username, telegram_username, telegram_user_id")
    .in("id", studentIds);

  if (studentProfilesError) {
    console.error("homework_api_request_error", {
      route: "POST /assignments/:id/assign",
      assignment_id: assignmentId,
      error: studentProfilesError.message,
    });
    return jsonError(cors, 500, "DB_ERROR", "Failed to validate students telegram linkage");
  }

  const profileById = new Map((studentProfiles ?? []).map((p: any) => [p.id as string, p]));
  const studentsWithoutTelegram = studentIds.filter((sid) => {
    const profile = profileById.get(sid);
    return !profile?.telegram_user_id;
  });

  if (studentsWithoutTelegram.length > 0) {
    const invalidStudentNames = studentsWithoutTelegram.map((sid) => {
      const profile = profileById.get(sid);
      if (profile?.username && String(profile.username).trim().length > 0) {
        return String(profile.username);
      }
      if (profile?.telegram_username && String(profile.telegram_username).trim().length > 0) {
        return `@${String(profile.telegram_username).replace(/^@/, "")}`;
      }
      return sid;
    });

    return jsonError(
      cors,
      400,
      "STUDENTS_TELEGRAM_NOT_CONNECTED",
      "Some selected students do not have Telegram linked",
      {
        invalid_student_ids: studentsWithoutTelegram,
        invalid_student_names: invalidStudentNames,
      },
    );
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

  const appUrl = Deno.env.get("PUBLIC_APP_URL")?.trim().replace(/\\/$/, "") ?? null;
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
    .select("id, student_id, status, total_score, total_max_score, attempt_no")
    .eq("assignment_id", assignmentId)
    .order("attempt_no", { ascending: true });

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

  const taskMap: Record<string, { order_num: number; task_text: string; max_score: number }> = {};
  for (const t of tasks ?? []) {
    taskMap[t.id] = { order_num: t.order_num, task_text: t.task_text, max_score: t.max_score };
  }

  const perStudent = (submissions ?? []).map((s) => {
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
      attempt_no: s.attempt_no ?? 1,
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


  const perTask = (tasks ?? []).map((t) => {
    const taskItems = items.filter((it) => it.task_id === t.id);
    let scoreSum = 0;
    let scoreCount = 0;
    let correctCount = 0;
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

    return {
      task_id: t.id,
      order_num: t.order_num,
      max_score: t.max_score,
      avg_score: scoreCount > 0 ? Math.round((scoreSum / scoreCount) * 100) / 100 : null,
      correct_rate: taskItems.length > 0
        ? Math.round((correctCount / taskItems.length) * 100 * 100) / 100
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
    .select("id, student_id, attempt_no, status, total_score, total_max_score, submitted_at")
    .eq("assignment_id", assignmentId)
    .order("attempt_no", { ascending: true });

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

    const tutorResult = await getTutorOrThrow(db, userId, cors);
    if (tutorResult instanceof Response) return tutorResult;
    const tutor = tutorResult;

    const seg = route.segments;

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

    // PUT /assignments/:id
    if (seg.length === 2 && seg[0] === "assignments" && route.method === "PUT") {
      const body = await parseJsonBody(req);
      return await handleUpdateAssignment(db, userId, seg[1], body, cors);
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
