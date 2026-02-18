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
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
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
  }));

  const { error: tasksErr } = await db
    .from("homework_tutor_tasks")
    .insert(taskRows);

  if (tasksErr) {
    console.error("homework_api_request_error", { route: "POST /assignments", error: tasksErr.message });
    await db.from("homework_tutor_assignments").delete().eq("id", assignment.id);
    return jsonError(cors, 500, "DB_ERROR", "Failed to create tasks");
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
    .select("assignment_id")
    .in("assignment_id", assignmentIds);

  const { data: submissions } = await db
    .from("homework_tutor_submissions")
    .select("assignment_id, status, total_score, total_max_score")
    .in("assignment_id", assignmentIds);

  const assignedMap: Record<string, number> = {};
  for (const r of assignedCounts ?? []) {
    assignedMap[r.assignment_id] = (assignedMap[r.assignment_id] ?? 0) + 1;
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
    .select("id, order_num, task_text, task_image_url, correct_answer, solution_steps, max_score")
    .eq("assignment_id", assignmentId)
    .order("order_num", { ascending: true });

  const { data: studentAssignments } = await db
    .from("homework_tutor_student_assignments")
    .select("student_id, notified, notified_at")
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
    }));
  }

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

  if (!Array.isArray(b.student_ids) || b.student_ids.length === 0) {
    return jsonError(cors, 400, "VALIDATION", "student_ids must be a non-empty array of UUIDs");
  }
  for (let i = 0; i < b.student_ids.length; i++) {
    if (!isUUID(b.student_ids[i])) {
      return jsonError(cors, 400, "VALIDATION", `student_ids[${i}] is not a valid UUID`);
    }
  }
  const studentIds = [...new Set(b.student_ids as string[])];

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

  const defaultMessage = `📚 Новое домашнее задание: <b>${escapeHtmlEntities(assignment.title as string)}</b>\n\nПредмет: ${escapeHtmlEntities(assignment.subject as string)}\nИспользуй /homework чтобы начать.`;
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
      .update({ notified: true, notified_at: now })
      .eq("assignment_id", assignmentId)
      .in("student_id", notifiedStudentIds);
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
    .select("id, student_id, status, total_score, total_max_score")
    .eq("assignment_id", assignmentId);

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
