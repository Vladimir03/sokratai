// student-lessons-api — student-facing "Занятия" feed (schedule-materials P0, TASK-4).
// Spec: docs/delivery/features/schedule-materials/spec.md §5.3, §7 AC-5/AC-7, §8.
//
// Routes (verify_jwt=true; gateway rejects anon, function extracts uid via GoTrue
// then reads under a SERVICE_ROLE DB client to apply a column-whitelist + ownership
// manually — RLS is bypassed by service_role on purpose):
//   GET /student/lessons        — feed: lessons (own + group via participants) + materials
//   GET /student/lessons/:id     — single lesson detail (404 if not attended — privacy)
//
// Anti-leak (rule 40 / §8): NEVER select tutor_lessons.notes or tutor-only fields;
// tutor_id is resolved to { name, avatar_url } server-side and dropped from the
// response. Homework status is scoped to THIS student (uid) — group members never
// leak each other's progress. PDFs → signed URL (TTL 3600) via rewriteToProxy.
// Score chip reuses _shared/score-compute.ts (no duplicated formula).

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { computeFinalScore } from "../_shared/score-compute.ts";
import { parseAttachmentUrls } from "../_shared/attachment-refs.ts";
import { rewriteToProxy } from "../_shared/proxy-url.ts";

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

const LESSON_MATERIAL_BUCKET = "lesson-materials";
const SIGNED_URL_TTL_SEC = 3600;

// Column whitelist — NEVER `notes`, `tutor_student_id`, `cancelled_*`, `payment_*`,
// `group_source_tutor_group_id`. `tutor_id` (→ name/avatar) and `student_id`
// (→ membership check; always == uid or NULL for the rows a student can see) are
// used server-side only and dropped from the response (mapping is explicit).
const LESSON_SELECT =
  "id, student_id, start_at, duration_min, subject, status, lesson_type, group_session_id, group_title_snapshot, tutor_id";

// ─── CORS ────────────────────────────────────────────────────────────────────

function getAllowedOrigins(): string[] {
  const envOrigins = Deno.env.get("STUDENT_LESSONS_API_ALLOWED_ORIGINS") ??
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
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

// ─── Response helpers (rule 97 flat shape) ─────────────────────────────────────

function jsonOk(cors: Record<string, string>, payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

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

// ─── Auth (GoTrue, mirror tutor-progress-api) ──────────────────────────────────

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
    console.error("student_lessons_api_auth_failed", {
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

function parseRoute(req: Request): { segments: string[]; method: string } {
  const url = new URL(req.url);
  const idx = url.pathname.indexOf("student-lessons-api");
  const rest = idx >= 0 ? url.pathname.slice(idx + "student-lessons-api".length) : "";
  return { segments: rest.split("/").filter(Boolean), method: req.method };
}

// ─── Storage-ref helpers (mirror homework-api) ─────────────────────────────────

function hasUnsafeObjectPath(path: string): boolean {
  return path
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .some((segment) => segment === ".." || segment.includes("\\") || segment.includes("\0"));
}

function parseStorageRef(value: string | null | undefined): { bucket: string; objectPath: string } | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith("storage://")) return null;
  const rest = trimmed.slice("storage://".length);
  const slashIdx = rest.indexOf("/");
  if (slashIdx <= 0 || slashIdx === rest.length - 1) return null;
  const objectPath = rest.slice(slashIdx + 1).replace(/^\/+/, "");
  if (!objectPath || hasUnsafeObjectPath(objectPath)) return null;
  return { bucket: rest.slice(0, slashIdx), objectPath };
}

async function signPdfUrls(db: SupabaseClient, objectPaths: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (objectPaths.length === 0) return map;
  const { data, error } = await db.storage
    .from(LESSON_MATERIAL_BUCKET)
    .createSignedUrls(objectPaths, SIGNED_URL_TTL_SEC);
  if (error || !data) {
    console.error("student_lessons_api_sign_failed", { error: error?.message });
    return map;
  }
  data.forEach((item, i) => {
    if (item.signedUrl) map.set(objectPaths[i], rewriteToProxy(item.signedUrl));
  });
  return map;
}

// ─── Homework status (per-student; mirrors tutor-progress-api aggregate, uid-scoped) ──

interface HwState {
  task_id: string;
  status: string | null;
  ai_score: number | null;
  earned_score: number | null;
  tutor_score_override: number | null;
  tutor_reviewed_at: string | null;
}
interface HwInfo {
  title: string;
  status: "assigned" | "submitted" | "reviewed";
  score: number | null;
  max: number;
  /** Resolved task for one-hop deep-link (AC-6): current → first-unfinished → first.
   *  null when no thread/tasks yet (caller falls back to the redirect entry). */
  entry_task_id: string | null;
}

/** Resolve per-assignment status/score for THIS student. Returns Map<assignmentId, HwInfo>;
 *  assignments the student is not assigned to are absent (caller omits the chip). */
async function loadHomeworkInfo(
  db: SupabaseClient,
  uid: string,
  hwIds: string[],
): Promise<Map<string, HwInfo>> {
  const result = new Map<string, HwInfo>();
  if (hwIds.length === 0) return result;

  const { data: assignments } = await db
    .from("homework_tutor_assignments")
    .select("id, title")
    .in("id", hwIds);
  const titleById = new Map<string, string>();
  for (const a of assignments ?? []) titleById.set(a.id as string, (a.title as string) ?? "");

  // Student-assignments scoped to uid (anti cross-student leak).
  const { data: saRows } = await db
    .from("homework_tutor_student_assignments")
    .select("id, assignment_id")
    .in("assignment_id", hwIds)
    .eq("student_id", uid);
  const saByAssignment = new Map<string, string>(); // assignmentId → saId
  const assignmentBySa = new Map<string, string>(); // saId → assignmentId
  for (const sa of saRows ?? []) {
    saByAssignment.set(sa.assignment_id as string, sa.id as string);
    assignmentBySa.set(sa.id as string, sa.assignment_id as string);
  }
  const saIds = [...assignmentBySa.keys()];

  // Tasks (whitelist; max_score for Σ, order_num for entry-task resolution).
  const { data: taskRows } = await db
    .from("homework_tutor_tasks")
    .select("id, assignment_id, max_score, order_num")
    .in("assignment_id", hwIds);
  const tasksByAssignment = new Map<string, { id: string; max_score: number; order_num: number }[]>();
  for (const t of taskRows ?? []) {
    const aid = t.assignment_id as string;
    if (!tasksByAssignment.has(aid)) tasksByAssignment.set(aid, []);
    tasksByAssignment.get(aid)!.push({
      id: t.id as string,
      max_score: Number(t.max_score ?? 1),
      order_num: Number(t.order_num ?? 0),
    });
  }
  for (const list of tasksByAssignment.values()) list.sort((a, b) => a.order_num - b.order_num);

  // Threads + states.
  const threadBySa = new Map<string, { id: string; status: string; current_task_id: string | null }>();
  const statesByThread = new Map<string, HwState[]>();
  if (saIds.length > 0) {
    const { data: threadRows } = await db
      .from("homework_tutor_threads")
      .select("id, student_assignment_id, status, current_task_id")
      .in("student_assignment_id", saIds);
    for (const th of threadRows ?? []) {
      threadBySa.set(th.student_assignment_id as string, {
        id: th.id as string,
        status: (th.status as string) ?? "active",
        current_task_id: (th.current_task_id as string | null) ?? null,
      });
    }
    const threadIds = [...threadBySa.values()].map((t) => t.id);
    if (threadIds.length > 0) {
      const { data: stateRows } = await db
        .from("homework_tutor_task_states")
        .select("thread_id, task_id, status, ai_score, earned_score, tutor_score_override, tutor_reviewed_at")
        .in("thread_id", threadIds);
      for (const s of stateRows ?? []) {
        const tid = s.thread_id as string;
        if (!statesByThread.has(tid)) statesByThread.set(tid, []);
        statesByThread.get(tid)!.push({
          task_id: s.task_id as string,
          status: (s.status as string | null) ?? null,
          ai_score: s.ai_score != null ? Number(s.ai_score) : null,
          earned_score: s.earned_score != null ? Number(s.earned_score) : null,
          tutor_score_override: s.tutor_score_override != null ? Number(s.tutor_score_override) : null,
          tutor_reviewed_at: (s.tutor_reviewed_at as string | null) ?? null,
        });
      }
    }
  }

  for (const hwId of hwIds) {
    const saId = saByAssignment.get(hwId);
    if (!saId) continue; // not assigned to this student → caller omits the chip
    const thread = threadBySa.get(saId);
    const states = thread ? (statesByThread.get(thread.id) ?? []) : [];
    const stateByTask = new Map(states.map((s) => [s.task_id, s]));
    const tasks = tasksByAssignment.get(hwId) ?? [];

    const submitted = thread?.status === "completed" ||
      states.some((s) => s.status === "completed" || s.ai_score != null);
    const pendingReview = states.some((s) => s.ai_score != null && s.tutor_reviewed_at == null);
    const reviewed = submitted && !pendingReview && states.some((s) => s.tutor_reviewed_at != null);
    const status: HwInfo["status"] = !submitted ? "assigned" : reviewed ? "reviewed" : "submitted";

    let score = 0;
    let max = 0;
    let anySignal = false;
    for (const t of tasks) {
      max += t.max_score;
      const st = stateByTask.get(t.id);
      if (st && (st.status === "completed" || st.ai_score != null || st.tutor_score_override != null)) {
        anySignal = true;
        score += computeFinalScore(st, t.max_score);
      }
    }

    // Entry task for one-hop deep-link (AC-6). Same resolution chain as
    // StudentHomeworkDetail (current_task_id → first task without a completed
    // state → first task); the all-completed case resolves to the first task
    // here rather than redirecting to the list — suits the «Занятия» context.
    let entryTaskId: string | null = null;
    if (thread?.current_task_id && tasks.some((t) => t.id === thread.current_task_id)) {
      entryTaskId = thread.current_task_id;
    }
    if (!entryTaskId) {
      const firstUnfinished = tasks.find((t) => {
        const st = stateByTask.get(t.id);
        return !st || st.status !== "completed";
      });
      if (firstUnfinished) entryTaskId = firstUnfinished.id;
    }
    if (!entryTaskId && tasks.length > 0) entryTaskId = tasks[0].id;

    result.set(hwId, {
      title: titleById.get(hwId) ?? "",
      status,
      score: submitted && anySignal ? Math.round(score * 100) / 100 : null,
      max,
      entry_task_id: entryTaskId,
    });
  }

  return result;
}

// ─── Feed assembly ───────────────────────────────────────────────────────────

interface LessonRow {
  id: string;
  student_id: string | null; // server-side only (membership); never in response
  start_at: string;
  duration_min: number | null;
  subject: string | null;
  status: string;
  lesson_type: string | null;
  group_session_id: string | null;
  group_title_snapshot: string | null;
  tutor_id: string;
}

async function assembleFeedItems(
  db: SupabaseClient,
  uid: string,
  lessons: LessonRow[],
  cors: Record<string, string>,
): Promise<Response> {
  if (lessons.length === 0) return jsonOk(cors, { items: [] });

  const lessonIds = lessons.map((l) => l.id);
  const groupSessionIds = [...new Set(lessons.map((l) => l.group_session_id).filter(Boolean) as string[])];
  const tutorIds = [...new Set(lessons.map((l) => l.tutor_id))];

  // Materials: by lesson_id, plus by group_session_id (two queries, merge + dedupe by id).
  const materialSelect =
    "id, lesson_id, group_session_id, material_kind, url, homework_assignment_id, title, sort_order, created_at";
  const materialById = new Map<string, Record<string, unknown>>();
  const { data: byLesson } = await db
    .from("tutor_lesson_materials")
    .select(materialSelect)
    .in("lesson_id", lessonIds);
  for (const m of byLesson ?? []) materialById.set(m.id as string, m);
  if (groupSessionIds.length > 0) {
    const { data: bySession } = await db
      .from("tutor_lesson_materials")
      .select(materialSelect)
      .in("group_session_id", groupSessionIds);
    for (const m of bySession ?? []) materialById.set(m.id as string, m);
  }
  const materials = [...materialById.values()];

  // Tutor name/avatar (whitelist).
  const tutorById = new Map<string, { name: string | null; avatar_url: string | null }>();
  if (tutorIds.length > 0) {
    const { data: tutors } = await db.from("tutors").select("id, name, avatar_url").in("id", tutorIds);
    for (const t of tutors ?? []) {
      tutorById.set(t.id as string, {
        name: (t.name as string | null) ?? null,
        avatar_url: (t.avatar_url as string | null) ?? null,
      });
    }
  }

  // Homework status (batch, uid-scoped).
  const hwIds = [
    ...new Set(
      materials
        .filter((m) => m.material_kind === "homework_ref" && m.homework_assignment_id)
        .map((m) => m.homework_assignment_id as string),
    ),
  ];
  const hwInfoById = await loadHomeworkInfo(db, uid, hwIds);

  // PDF signed URLs (batch).
  const pdfPathByMaterial = new Map<string, string>(); // materialId → objectPath
  for (const m of materials) {
    if (m.material_kind !== "pdf") continue;
    const ref = parseAttachmentUrls(m.url as string | null)[0];
    const parsed = ref ? parseStorageRef(ref) : null;
    if (parsed && parsed.bucket === LESSON_MATERIAL_BUCKET) {
      pdfPathByMaterial.set(m.id as string, parsed.objectPath);
    }
  }
  const signedByPath = await signPdfUrls(db, [...new Set(pdfPathByMaterial.values())]);

  // Index materials by the lesson they belong to (lesson_id primary, group_session_id fallback).
  const lessonIdSet = new Set(lessonIds);
  const lessonByGroupSession = new Map<string, string>(); // groupSessionId → lessonId (one row per group in feed)
  for (const l of lessons) {
    if (l.group_session_id && !lessonByGroupSession.has(l.group_session_id)) {
      lessonByGroupSession.set(l.group_session_id, l.id);
    }
  }
  const materialsByLesson = new Map<string, Record<string, unknown>[]>();
  const seenPerLesson = new Map<string, Set<string>>(); // lessonId → material ids (dedupe)
  for (const m of materials) {
    let targetLessonId: string | null = null;
    if (m.lesson_id && lessonIdSet.has(m.lesson_id as string)) {
      targetLessonId = m.lesson_id as string;
    } else if (m.group_session_id && lessonByGroupSession.has(m.group_session_id as string)) {
      targetLessonId = lessonByGroupSession.get(m.group_session_id as string)!;
    }
    if (!targetLessonId) continue;

    // homework_ref not assigned to this student → omit (anti-leak + non-actionable).
    if (m.material_kind === "homework_ref") {
      const info = hwInfoById.get(m.homework_assignment_id as string);
      if (!info) continue;
    }

    if (!seenPerLesson.has(targetLessonId)) seenPerLesson.set(targetLessonId, new Set());
    const seen = seenPerLesson.get(targetLessonId)!;
    if (seen.has(m.id as string)) continue;
    seen.add(m.id as string);
    if (!materialsByLesson.has(targetLessonId)) materialsByLesson.set(targetLessonId, []);
    materialsByLesson.get(targetLessonId)!.push(m);
  }

  // Build response items (start_at desc).
  const items = lessons
    .slice()
    .sort((a, b) => Date.parse(b.start_at) - Date.parse(a.start_at))
    .map((l) => {
      const rawMaterials = (materialsByLesson.get(l.id) ?? [])
        .slice()
        .sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0));
      const mappedMaterials = rawMaterials.map((m) => {
        const base = { id: m.id, kind: m.material_kind, title: (m.title as string | null) ?? null };
        if (m.material_kind === "recording") {
          return { ...base, url: m.url as string };
        }
        if (m.material_kind === "pdf") {
          const objectPath = pdfPathByMaterial.get(m.id as string);
          return { ...base, url: objectPath ? (signedByPath.get(objectPath) ?? null) : null };
        }
        // homework_ref (info present — checked above)
        const info = hwInfoById.get(m.homework_assignment_id as string)!;
        return {
          id: m.id,
          kind: "homework_ref",
          assignment_id: m.homework_assignment_id,
          title: info.title,
          status: info.status,
          score: info.score,
          max: info.max,
          entry_task_id: info.entry_task_id,
        };
      });
      const tutor = tutorById.get(l.tutor_id) ?? null;
      return {
        id: l.id,
        start_at: l.start_at,
        duration_min: l.duration_min,
        subject: l.subject,
        status: l.status,
        lesson_type: l.lesson_type,
        group_session_id: l.group_session_id,
        group_title_snapshot: l.group_title_snapshot,
        tutor: tutor ? { name: tutor.name, avatar_url: tutor.avatar_url } : null,
        materials: mappedMaterials,
      };
    });

  return jsonOk(cors, { items });
}

// ─── Handlers ───────────────────────────────────────────────────────────────────

async function handleListLessons(
  db: SupabaseClient,
  uid: string,
  cors: Record<string, string>,
): Promise<Response> {
  const lessonById = new Map<string, LessonRow>();

  // (a) Individual + legacy-group rows (student_id = uid).
  const { data: own, error: ownErr } = await db
    .from("tutor_lessons")
    .select(LESSON_SELECT)
    .eq("student_id", uid)
    .neq("status", "cancelled");
  if (ownErr) {
    console.error("student_lessons_api_db_error", { route: "GET lessons (own)", error: ownErr.message });
    return jsonError(cors, 500, "DB_ERROR", "Не удалось загрузить занятия.");
  }
  for (const l of own ?? []) lessonById.set(l.id as string, l as LessonRow);

  // (b) Unified-group rows via participants.
  const { data: parts } = await db
    .from("tutor_lesson_participants")
    .select("lesson_id")
    .eq("student_id", uid);
  const groupLessonIds = [...new Set((parts ?? []).map((p) => p.lesson_id as string))].filter(
    (id) => !lessonById.has(id),
  );
  if (groupLessonIds.length > 0) {
    const { data: groupLessons } = await db
      .from("tutor_lessons")
      .select(LESSON_SELECT)
      .in("id", groupLessonIds)
      .neq("status", "cancelled");
    for (const l of groupLessons ?? []) lessonById.set(l.id as string, l as LessonRow);
  }

  return await assembleFeedItems(db, uid, [...lessonById.values()], cors);
}

async function handleLessonDetail(
  db: SupabaseClient,
  uid: string,
  lessonId: string,
  cors: Record<string, string>,
): Promise<Response> {
  if (!UUID_RE.test(lessonId)) {
    return jsonError(cors, 400, "VALIDATION", "Некорректный идентификатор занятия.");
  }
  const { data: lesson } = await db
    .from("tutor_lessons")
    .select(LESSON_SELECT)
    .eq("id", lessonId)
    .maybeSingle();
  if (!lesson) return jsonError(cors, 404, "NOT_FOUND", "Занятие не найдено.");

  // Membership: individual (student_id) OR group participant. 404 (not 403) — privacy.
  let attends = (lesson as LessonRow).student_id === uid;
  if (!attends) {
    const { data: part } = await db
      .from("tutor_lesson_participants")
      .select("id")
      .eq("lesson_id", lessonId)
      .eq("student_id", uid)
      .limit(1);
    attends = !!(part && part.length > 0);
  }
  if (!attends) return jsonError(cors, 404, "NOT_FOUND", "Занятие не найдено.");

  const resp = await assembleFeedItems(db, uid, [lesson as LessonRow], cors);
  // assembleFeedItems returns { items: [...] }; unwrap to a single lesson for the detail route.
  const body = await resp.json();
  const item = Array.isArray(body.items) && body.items.length > 0 ? body.items[0] : null;
  if (!item) return jsonError(cors, 404, "NOT_FOUND", "Занятие не найдено.");
  return jsonOk(cors, { lesson: item });
}

// ─── Entry point ────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: cors });
  }

  const route = parseRoute(req);
  console.log("student_lessons_api_request_start", { method: route.method, segments: route.segments });

  try {
    const authResult = await authenticateUser(req, cors);
    if (authResult instanceof Response) return authResult;
    const { userId } = authResult;

    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const seg = route.segments;

    // GET /student/lessons
    if (seg.length === 2 && seg[0] === "student" && seg[1] === "lessons" && route.method === "GET") {
      return await handleListLessons(db, userId, cors);
    }

    // GET /student/lessons/:id
    if (seg.length === 3 && seg[0] === "student" && seg[1] === "lessons" && route.method === "GET") {
      return await handleLessonDetail(db, userId, seg[2], cors);
    }

    return jsonError(cors, 404, "NOT_FOUND", "Маршрут не найден.");
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("student_lessons_api_unhandled_error", { message });
    return jsonError(cors, 500, "INTERNAL", `Внутренняя ошибка: ${message}`);
  }
});
