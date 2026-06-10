// tutor-progress-api — tutor «прогресс по ученикам» edge function.
//
// R1 (student-progress): tutor подтверждение «проверено» — тонкие обёртки над
// атомарными RPC (`hw_tutor_review_task` / `hw_tutor_review_all_ai` /
// `hw_tutor_reopen_review`, миграция 20260602090100). Ownership проверяется внутри
// RPC (`assignment.tutor_id = p_tutor_id`); здесь резолвим userId из JWT и
// маппим RPC RAISE EXCEPTION коды на HTTP + русские фразы (rule 97 flat shape
// `{ error: "<рус>", code }`).
//
// verify_jwt=true в config.toml (spec §3) — Supabase gateway отклоняет невалидный
// JWT до вызова функции; функция дополнительно валидирует Bearer через GoTrue,
// чтобы извлечь userId (defense-in-depth), затем работает под service_role.
//
// Будущие R2-эндпоинты (агрегат ученика / обзор «Успеваемость» / цель) добавляются
// в этот же роутер (TASK-6).

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { egePrimaryToScaled, ogeMark } from "../_shared/score-scales.ts";
import {
  BEHIND_GOAL_PCT,
  HW_CONFIRMED_MOCK,
  MOCK_PENDING_REVIEW,
  aggregateHwWork,
  buildStudentProgress,
  gradeClass,
  loadHomeworkForStudents,
  resolveTutorPkId,
} from "../_shared/student-progress-build.ts";

// ─── Constants ───────────────────────────────────────────────────────────────

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const FALLBACK_ORIGINS = [
  "https://sokratai.ru",
  "https://sokratai.lovable.app",
  "http://localhost:8080",
  "http://localhost:5173",
];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── CORS ────────────────────────────────────────────────────────────────────

function getAllowedOrigins(): string[] {
  const envOrigins = Deno.env.get("TUTOR_PROGRESS_API_ALLOWED_ORIGINS") ??
    Deno.env.get("HOMEWORK_API_ALLOWED_ORIGINS");
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
      "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

// ─── Response helpers (rule 97 flat shape) ─────────────────────────────────────

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

/**
 * rule 97: non-2xx = JSON `{ error: "<русская фраза>", code }`. `error` —
 * human-readable RU; `code` — SCREAMING_SNAKE для machine handling.
 */
function jsonError(
  cors: Record<string, string>,
  status: number,
  code: string,
  error: string,
): Response {
  return new Response(JSON.stringify({ error, code }), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

// ─── Auth (GoTrue, mirror homework-api) ────────────────────────────────────────

async function authenticateUser(
  req: Request,
  cors: Record<string, string>,
): Promise<{ userId: string } | Response> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonError(cors, 401, "UNAUTHORIZED", "Нет активной сессии. Войдите снова.");
  }
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: authHeader, apikey: SUPABASE_ANON_KEY },
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    console.error("tutor_progress_api_auth_failed", {
      status: resp.status,
      body: body.slice(0, 200),
    });
    return jsonError(cors, 401, "UNAUTHORIZED", "Сессия истекла. Войдите снова.");
  }
  const user = await resp.json();
  if (!user?.id) {
    return jsonError(cors, 401, "UNAUTHORIZED", "Сессия истекла. Войдите снова.");
  }
  return { userId: user.id };
}

// ─── Routing ───────────────────────────────────────────────────────────────────

interface RouteMatch {
  segments: string[];
  method: string;
  searchParams: URLSearchParams;
}

function parseRoute(req: Request): RouteMatch {
  const url = new URL(req.url);
  const pathname = url.pathname;
  const idx = pathname.indexOf("tutor-progress-api");
  const rest = idx >= 0
    ? pathname.slice(idx + "tutor-progress-api".length)
    : "";
  const segments = rest.split("/").filter(Boolean);
  return { segments, method: req.method, searchParams: url.searchParams };
}

async function parseJsonBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? body as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/**
 * Map RPC RAISE EXCEPTION codes (text in error.message) to HTTP + RU phrase.
 * Mirror homework-api `handleSetTutorScoreOverride` RPC error mapping.
 */
function rpcErrorToResponse(
  cors: Record<string, string>,
  rpcErr: { message?: string } | null,
  route: string,
): Response {
  const msg = rpcErr?.message ?? "Не удалось выполнить операцию";
  console.error("tutor_progress_api_rpc_error", { route, error: msg });
  if (msg.includes("ASSIGNMENT_NOT_OWNED")) {
    return jsonError(cors, 403, "ASSIGNMENT_NOT_OWNED", "Это домашнее задание принадлежит другому репетитору.");
  }
  if (msg.includes("TASK_STATE_NOT_FOUND")) {
    return jsonError(cors, 404, "TASK_STATE_NOT_FOUND", "Состояние задачи не найдено.");
  }
  if (msg.includes("TASK_NOT_FOUND")) {
    return jsonError(cors, 404, "TASK_NOT_FOUND", "Задача не найдена.");
  }
  if (msg.includes("THREAD_NOT_FOUND")) {
    return jsonError(cors, 404, "THREAD_NOT_FOUND", "Диалог по этому ДЗ ещё не создан.");
  }
  if (msg.includes("ALREADY_REVIEWED")) {
    return jsonError(cors, 409, "ALREADY_REVIEWED", "Задача уже подтверждена — обновите страницу.");
  }
  if (msg.includes("NOTHING_TO_REVIEW")) {
    return jsonError(cors, 409, "NOTHING_TO_REVIEW", "Нет задач для подтверждения — обновите страницу.");
  }
  if (msg.includes("NOT_REVIEWED")) {
    return jsonError(cors, 409, "NOT_REVIEWED", "Задача ещё не подтверждена.");
  }
  if (msg.includes("TASK_NOT_ACTIVE")) {
    return jsonError(cors, 409, "TASK_NOT_ACTIVE", "Задача уже закрыта другим действием — обновите страницу.");
  }
  if (msg.includes("SCORE_OUT_OF_RANGE")) {
    return jsonError(cors, 400, "SCORE_OUT_OF_RANGE", "Балл вне допустимого диапазона.");
  }
  if (msg.includes("SCORE_STEP_INVALID")) {
    return jsonError(cors, 400, "SCORE_STEP_INVALID", "Балл должен быть кратен 0.1.");
  }
  return jsonError(cors, 500, "DB_ERROR", "Не удалось выполнить операцию. Попробуйте ещё раз.");
}

// ─── Score validation (mirror EditScoreDialog / RPC) ────────────────────────────

function parseOptionalScore(
  raw: unknown,
): { ok: true; value: number | null } | { ok: false; message: string } {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) {
    return { ok: false, message: "Балл должен быть числом." };
  }
  if (n < 0) return { ok: false, message: "Балл не может быть отрицательным." };
  const scaled = n * 10;
  if (Math.abs(scaled - Math.round(scaled)) > 1e-9) {
    return { ok: false, message: "Балл должен быть кратен 0.1." };
  }
  return { ok: true, value: n };
}

// ─── Handlers ───────────────────────────────────────────────────────────────────

async function handleReviewTask(
  db: SupabaseClient,
  tutorUserId: string,
  assignmentId: string,
  studentId: string,
  body: Record<string, unknown> | null,
  cors: Record<string, string>,
): Promise<Response> {
  const taskId = typeof body?.task_id === "string" ? body.task_id : "";
  if (!UUID_RE.test(assignmentId) || !UUID_RE.test(studentId) || !UUID_RE.test(taskId)) {
    return jsonError(cors, 400, "VALIDATION", "Некорректные идентификаторы задания/ученика/задачи.");
  }
  const score = parseOptionalScore(body?.score);
  if (!score.ok) {
    return jsonError(cors, 400, "VALIDATION", score.message);
  }
  const comment = typeof body?.comment === "string" && body.comment.trim().length > 0
    ? body.comment.trim().slice(0, 1000)
    : null;

  const { data, error } = await db.rpc("hw_tutor_review_task", {
    p_assignment_id: assignmentId,
    p_student_id: studentId,
    p_task_id: taskId,
    p_tutor_id: tutorUserId,
    p_score: score.value,
    p_comment: score.value === null ? null : comment,
  });
  if (error || !data) {
    return rpcErrorToResponse(cors, error, "POST review-task");
  }
  console.log("tutor_progress_api_request_success", {
    route: "POST review-task",
    tutor_id: tutorUserId,
    assignment_id: assignmentId,
    student_id: studentId,
    task_id: taskId,
    had_override: score.value !== null,
  });
  return jsonOk(cors, { ok: true, ...(data as Record<string, unknown>) });
}

async function handleReviewAllAi(
  db: SupabaseClient,
  tutorUserId: string,
  assignmentId: string,
  studentId: string,
  cors: Record<string, string>,
): Promise<Response> {
  if (!UUID_RE.test(assignmentId) || !UUID_RE.test(studentId)) {
    return jsonError(cors, 400, "VALIDATION", "Некорректные идентификаторы задания/ученика.");
  }
  const { data, error } = await db.rpc("hw_tutor_review_all_ai", {
    p_assignment_id: assignmentId,
    p_student_id: studentId,
    p_tutor_id: tutorUserId,
  });
  if (error || !data) {
    return rpcErrorToResponse(cors, error, "POST review-all-ai");
  }
  const result = data as Record<string, unknown>;
  console.log("tutor_progress_api_request_success", {
    route: "POST review-all-ai",
    tutor_id: tutorUserId,
    assignment_id: assignmentId,
    student_id: studentId,
    reviewed_count: result.reviewed_count,
  });
  return jsonOk(cors, { ok: true, reviewed_count: result.reviewed_count ?? 0 });
}

async function handleReopenReview(
  db: SupabaseClient,
  tutorUserId: string,
  assignmentId: string,
  studentId: string,
  body: Record<string, unknown> | null,
  cors: Record<string, string>,
): Promise<Response> {
  const taskId = typeof body?.task_id === "string" ? body.task_id : "";
  if (!UUID_RE.test(assignmentId) || !UUID_RE.test(studentId) || !UUID_RE.test(taskId)) {
    return jsonError(cors, 400, "VALIDATION", "Некорректные идентификаторы задания/ученика/задачи.");
  }
  const { data, error } = await db.rpc("hw_tutor_reopen_review", {
    p_assignment_id: assignmentId,
    p_student_id: studentId,
    p_task_id: taskId,
    p_tutor_id: tutorUserId,
  });
  if (error || !data) {
    return rpcErrorToResponse(cors, error, "POST reopen-review");
  }
  console.log("tutor_progress_api_request_success", {
    route: "POST reopen-review",
    tutor_id: tutorUserId,
    assignment_id: assignmentId,
    student_id: studentId,
    task_id: taskId,
  });
  return jsonOk(cors, { ok: true });
}

// ─── R2: progress aggregate (overview / per-student / target) ──────────────────
//
// Read-only агрегат ДЗ + пробников «по ученику». Service_role queries + Deno-
// агрегация (без N+1). FK: `auth.uid → tutors.id` для tutor_students/групп;
// `auth.uid` напрямую для homework/mock assignments (rule 40/45).
//
// Anti-leak (spec §5): НИКОГДА не селектим solution_*/rubric_*/ai_score_comment/
// hints. cells = только score/max. Пробник — только агрегаты подтверждённого.

// Shared helpers (resolveTutorPkId / loadHomeworkForStudents / aggregateHwWork /
// gradeClass / константы) вынесены в _shared/student-progress-build.ts — реюз
// публичным «Отчётом родителю» (public-student-report, 2c). Single source.

async function handleProgressOverview(
  db: SupabaseClient,
  userId: string,
  cors: Record<string, string>,
): Promise<Response> {
  const tutorPkId = await resolveTutorPkId(db, userId);
  if (!tutorPkId) return jsonOk(cors, { items: [] });

  // Students (active).
  const { data: students, error: studentsErr } = await db
    .from("tutor_students")
    .select("id, student_id, display_name, exam_type, target_score, status")
    .eq("tutor_id", tutorPkId)
    .eq("status", "active")
    .limit(500);
  if (studentsErr) {
    return jsonError(cors, 500, "DB_ERROR", "Не удалось загрузить список учеников.");
  }
  const studentRows = students ?? [];
  if (studentRows.length === 0) return jsonOk(cors, { items: [] });
  const studentIds = studentRows.map((s) => s.student_id as string);

  // Profiles (name/avatar/grade).
  const { data: profiles } = await db
    .from("profiles")
    .select("id, full_name, username, avatar_url, grade")
    .in("id", studentIds);
  const profileById = new Map<string, { full_name: string | null; username: string | null; avatar_url: string | null; grade: number | null }>();
  for (const p of profiles ?? []) {
    profileById.set(p.id as string, {
      full_name: (p.full_name as string | null) ?? null,
      username: (p.username as string | null) ?? null,
      avatar_url: (p.avatar_url as string | null) ?? null,
      grade: p.grade != null ? Number(p.grade) : null,
    });
  }

  // Groups (active membership → group).
  const { data: memberships } = await db
    .from("tutor_group_memberships")
    .select("tutor_student_id, tutor_group_id")
    .eq("tutor_id", tutorPkId)
    .eq("is_active", true);
  const groupIdByTs = new Map<string, string>();
  const groupIds = new Set<string>();
  for (const m of memberships ?? []) {
    groupIdByTs.set(m.tutor_student_id as string, m.tutor_group_id as string);
    groupIds.add(m.tutor_group_id as string);
  }
  const groupById = new Map<string, string>();
  if (groupIds.size > 0) {
    const { data: groups } = await db
      .from("tutor_groups")
      .select("id, name, short_name")
      .in("id", [...groupIds]);
    for (const g of groups ?? []) {
      groupById.set(g.id as string, ((g.short_name as string | null) || (g.name as string)) ?? "");
    }
  }

  // Homework (batched).
  const hw = await loadHomeworkForStudents(db, userId, studentIds);
  // Precompute O(1) lookups: saId → thread+states, studentId → saIds (avoid O(n³)).
  const threadBySa = new Map<string, { threadStatus: string; states: { status: string | null; ai_score: number | null; tutor_reviewed_at: string | null }[] }>();
  for (const [tid, th] of hw.threadById) {
    threadBySa.set(th.saId, { threadStatus: th.status, states: hw.statesByThread.get(tid) ?? [] });
  }
  const saIdsByStudent = new Map<string, string[]>();
  for (const [saId, sa] of hw.saById) {
    if (!saIdsByStudent.has(sa.studentId)) saIdsByStudent.set(sa.studentId, []);
    saIdsByStudent.get(sa.studentId)!.push(saId);
  }

  // Mock (batched).
  const { data: mockAssignments } = await db
    .from("mock_exam_assignments")
    .select("id, variant_id, deadline")
    .eq("tutor_id", userId);
  const mockAssignmentIds = (mockAssignments ?? []).map((a) => a.id as string);
  const mockDeadlineById = new Map<string, string | null>();
  for (const a of mockAssignments ?? []) {
    mockDeadlineById.set(a.id as string, (a.deadline as string | null) ?? null);
  }
  // v1 overview: pct_to_goal computed for ege track via egePrimaryToScaled(total_score)
  // directly (variant exam_type not needed here — per-work exam_type is resolved in the
  // detail endpoint). total_score is primary regardless of variant.
  const mockByStudent = new Map<string, { status: string; total_score: number | null; date: number; assignment_id: string }[]>();
  if (mockAssignmentIds.length > 0) {
    const { data: attempts } = await db
      .from("mock_exam_attempts")
      .select("assignment_id, student_id, status, total_score, submitted_at, manual_entered_date, created_at")
      .in("assignment_id", mockAssignmentIds)
      .in("student_id", studentIds);
    for (const at of attempts ?? []) {
      const sid = at.student_id as string;
      if (!mockByStudent.has(sid)) mockByStudent.set(sid, []);
      const dateStr = (at.submitted_at as string | null) ?? (at.manual_entered_date as string | null) ?? (at.created_at as string | null);
      mockByStudent.get(sid)!.push({
        status: at.status as string,
        total_score: at.total_score != null ? Number(at.total_score) : null,
        date: dateStr ? Date.parse(dateStr) : 0,
        assignment_id: at.assignment_id as string,
      });
    }
  }

  // Per-student compute.
  const items = studentRows.map((s) => {
    const studentId = s.student_id as string;
    const tutorStudentId = s.id as string;
    const track = (s.exam_type as string | null) ?? "ege";
    const targetScore = s.target_score != null ? Number(s.target_score) : null;
    const prof = profileById.get(studentId);
    const name = (s.display_name as string | null) ||
      prof?.full_name ||
      (prof?.username && !/^user_/i.test(prof.username) ? prof.username : null) ||
      "Ученик";

    // Homework work aggregates for this student (O(theirSaIds) via precomputed maps).
    let hwSubmitted = 0, hwReviewed = 0, hwBacklog = 0;
    let hwOverdue = false;
    for (const saId of saIdsByStudent.get(studentId) ?? []) {
      const sa = hw.saById.get(saId);
      if (!sa) continue;
      const tinfo = threadBySa.get(saId) ?? { threadStatus: "active", states: [] };
      const deadline = hw.assignmentById.get(sa.assignmentId)?.deadline ?? null;
      const agg = aggregateHwWork(tinfo.states, deadline, tinfo.threadStatus);
      if (agg.submitted) hwSubmitted++;
      if (agg.reviewed) hwReviewed++;
      if (agg.pendingReview) hwBacklog++;
      if (agg.overdue) hwOverdue = true;
    }

    // Mock aggregates for this student.
    const mocks = (mockByStudent.get(studentId) ?? []).slice().sort((a, b) => a.date - b.date);
    let mockSubmitted = 0, mockReviewed = 0, mockBacklog = 0;
    let mockOverdue = false;
    const confirmedScaled: number[] = [];
    for (const m of mocks) {
      const isConfirmed = HW_CONFIRMED_MOCK.has(m.status);
      const isPending = MOCK_PENDING_REVIEW.has(m.status);
      if (m.status !== "in_progress" && m.status !== "paused") mockSubmitted++;
      if (isConfirmed) {
        mockReviewed++;
        const scaled = egePrimaryToScaled(m.total_score);
        if (scaled != null) confirmedScaled.push(scaled);
      }
      if (isPending) mockBacklog++;
      const deadline = mockDeadlineById.get(m.assignment_id) ?? null;
      if (deadline != null && Date.parse(deadline) < Date.now() && isPending) mockOverdue = true;
    }

    const submittedWorks = hwSubmitted + mockSubmitted;
    const reviewedWorks = hwReviewed + mockReviewed;
    const reviewedPct = submittedWorks > 0 ? Math.round((reviewedWorks / submittedWorks) * 100) : null;

    // current_level + pct_to_goal (scale-agnostic, по треку).
    let currentLevel: number | null = null;
    if (confirmedScaled.length > 0) currentLevel = confirmedScaled[confirmedScaled.length - 1];
    let pctToGoal: number | null = null;
    if (track === "ege" && currentLevel != null && targetScore && targetScore > 0) {
      pctToGoal = Math.max(0, Math.min(100, Math.round((currentLevel / targetScore) * 100)));
    }
    // declining: последний confirmed scaled < предыдущего.
    const declining = confirmedScaled.length >= 2 &&
      confirmedScaled[confirmedScaled.length - 1] < confirmedScaled[confirmedScaled.length - 2];
    const behindGoal = pctToGoal != null && pctToGoal < BEHIND_GOAL_PCT;

    return {
      student_id: studentId,
      tutor_student_id: tutorStudentId,
      name,
      avatar_url: prof?.avatar_url ?? null,
      track,
      grade_class: gradeClass(prof?.grade, track),
      group_id: groupIdByTs.get(tutorStudentId) ?? null,
      group_name: groupById.get(groupIdByTs.get(tutorStudentId) ?? "") ?? null,
      pct_to_goal: pctToGoal,
      reviewed_pct: reviewedPct,
      signals: {
        review_backlog: hwBacklog + mockBacklog,
        overdue: hwOverdue || mockOverdue,
        behind_goal: behindGoal,
        declining,
      },
    };
  });

  return jsonOk(cors, { items });
}

async function handleStudentProgress(
  db: SupabaseClient,
  userId: string,
  tutorStudentId: string,
  cors: Record<string, string>,
): Promise<Response> {
  if (!UUID_RE.test(tutorStudentId)) {
    return jsonError(cors, 400, "VALIDATION", "Некорректный идентификатор ученика.");
  }
  const tutorPkId = await resolveTutorPkId(db, userId);
  if (!tutorPkId) return jsonError(cors, 404, "NOT_FOUND", "Ученик не найден.");

  // Агрегат вынесен VERBATIM в _shared/student-progress-build.ts (реюз публичным
  // «Отчётом родителю»). Поведение/anti-leak whitelist не менялись.
  const payload = await buildStudentProgress(db, userId, tutorPkId, tutorStudentId);
  if (!payload) return jsonError(cors, 404, "NOT_FOUND", "Ученик не найден.");
  return jsonOk(cors, payload);
}

async function handleUpdateTarget(
  db: SupabaseClient,
  userId: string,
  tutorStudentId: string,
  body: Record<string, unknown> | null,
  cors: Record<string, string>,
): Promise<Response> {
  if (!UUID_RE.test(tutorStudentId)) {
    return jsonError(cors, 400, "VALIDATION", "Некорректный идентификатор ученика.");
  }
  const track = typeof body?.track === "string" ? body.track : "ege";
  if (track !== "ege" && track !== "oge") {
    // school-трек — UI-каркас в v1; tutor_students.exam_type не хранит 'school'.
    return jsonError(cors, 400, "TRACK_NOT_SUPPORTED", "Школьный трек цели пока в разработке.");
  }
  const rawTarget = body?.target_score;
  const target = rawTarget == null ? null : Number(rawTarget);
  if (target != null) {
    if (!Number.isFinite(target)) {
      return jsonError(cors, 400, "VALIDATION", "Цель должна быть числом.");
    }
    if (track === "ege" && (target < 0 || target > 100)) {
      return jsonError(cors, 400, "VALIDATION", "Цель ЕГЭ — от 0 до 100.");
    }
    if (track === "oge" && (target < 2 || target > 5)) {
      return jsonError(cors, 400, "VALIDATION", "Цель ОГЭ — оценка от 2 до 5.");
    }
  }

  const tutorPkId = await resolveTutorPkId(db, userId);
  if (!tutorPkId) return jsonError(cors, 404, "NOT_FOUND", "Ученик не найден.");

  const { data: updated, error } = await db
    .from("tutor_students")
    .update({ target_score: target, exam_type: track })
    .eq("id", tutorStudentId)
    .eq("tutor_id", tutorPkId)
    .select("id, target_score, exam_type")
    .maybeSingle();
  if (error) {
    return jsonError(cors, 500, "DB_ERROR", "Не удалось сохранить цель.");
  }
  if (!updated) return jsonError(cors, 404, "NOT_FOUND", "Ученик не найден.");

  return jsonOk(cors, {
    ok: true,
    target: { track: updated.exam_type, target_score: updated.target_score, scale_year: 2026 },
  });
}

// ─── Entry point ────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: cors });
  }

  const route = parseRoute(req);
  console.log("tutor_progress_api_request_start", {
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

    // POST /assignments/:id/students/:sid/review-task
    if (
      seg.length === 5 &&
      seg[0] === "assignments" &&
      seg[2] === "students" &&
      seg[4] === "review-task" &&
      route.method === "POST"
    ) {
      const body = await parseJsonBody(req);
      return await handleReviewTask(db, userId, seg[1], seg[3], body, cors);
    }

    // POST /assignments/:id/students/:sid/review-all-ai
    if (
      seg.length === 5 &&
      seg[0] === "assignments" &&
      seg[2] === "students" &&
      seg[4] === "review-all-ai" &&
      route.method === "POST"
    ) {
      return await handleReviewAllAi(db, userId, seg[1], seg[3], cors);
    }

    // POST /assignments/:id/students/:sid/reopen-review
    if (
      seg.length === 5 &&
      seg[0] === "assignments" &&
      seg[2] === "students" &&
      seg[4] === "reopen-review" &&
      route.method === "POST"
    ) {
      const body = await parseJsonBody(req);
      return await handleReopenReview(db, userId, seg[1], seg[3], body, cors);
    }

    // GET /students/progress-overview (R2)
    if (
      seg.length === 2 &&
      seg[0] === "students" &&
      seg[1] === "progress-overview" &&
      route.method === "GET"
    ) {
      return await handleProgressOverview(db, userId, cors);
    }

    // GET /students/:id/progress (R2)
    if (
      seg.length === 3 &&
      seg[0] === "students" &&
      seg[2] === "progress" &&
      route.method === "GET"
    ) {
      return await handleStudentProgress(db, userId, seg[1], cors);
    }

    // PATCH /students/:id/target (R2)
    if (
      seg.length === 3 &&
      seg[0] === "students" &&
      seg[2] === "target" &&
      route.method === "PATCH"
    ) {
      const body = await parseJsonBody(req);
      return await handleUpdateTarget(db, userId, seg[1], body, cors);
    }

    return jsonError(cors, 404, "NOT_FOUND", "Маршрут не найден.");
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("tutor_progress_api_unhandled_error", { message });
    return jsonError(cors, 500, "INTERNAL", `Внутренняя ошибка: ${message}`);
  }
});
