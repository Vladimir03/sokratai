// lesson-materials-api — tutor CRUD for materials attached to a lesson
// (schedule-materials P0, TASK-2). Spec: docs/delivery/features/schedule-materials/spec.md §5.3.
//
// Routes (verify_jwt=true; gateway rejects anon, function extracts userId via
// GoTrue then works under service_role):
//   GET    /lessons/:lessonId/materials          — list
//   POST   /lessons/:lessonId/materials          — add { kind, url?, homework_assignment_id?, title? }
//   DELETE /materials/:id                         — delete (+ storage.remove for pdf)
//   POST   /lessons/:lessonId/materials/notify    — TASK-7 notify STUB (ownership-checked)
//
// Ownership (rule 40 FK-drift): tutor_lessons.tutor_id → tutors.id (resolveTutorPkId);
// homework_tutor_assignments.tutor_id → auth.users.id (compare to auth.uid directly).
// Errors: flat { error: <рус>, code } (rule 97). Logs: ids/status only, never urls/PII.

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { parseAttachmentUrls, serializeAttachmentUrls } from "../_shared/attachment-refs.ts";

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
// PDF size (≤20 МБ) + MIME (application/pdf) are enforced by the bucket's
// file_size_limit / allowed_mime_types at upload time (migration 20260602140100,
// authoritative — Supabase Storage rejects oversized/non-PDF before the ref exists)
// plus a client-side pre-check (lessonMaterialsApi MAX_LESSON_PDF_BYTES). No edge byte-check needed.
const MAX_RECORDINGS = 3;
const MAX_PDFS = 5;
const MAX_TITLE_LEN = 200;
const MAX_URL_LEN = 2048;

// ─── CORS ────────────────────────────────────────────────────────────────────

function getAllowedOrigins(): string[] {
  const envOrigins = Deno.env.get("LESSON_MATERIALS_API_ALLOWED_ORIGINS") ??
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
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
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
    console.error("lesson_materials_api_auth_failed", {
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

/** auth.users.id → tutors.id (FK-конверсия, rule 40). null если нет профиля тутора. */
async function resolveTutorPkId(db: SupabaseClient, userId: string): Promise<string | null> {
  const { data } = await db.from("tutors").select("id").eq("user_id", userId).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

// ─── Routing ───────────────────────────────────────────────────────────────────

interface RouteMatch {
  segments: string[];
  method: string;
}

function parseRoute(req: Request): RouteMatch {
  const url = new URL(req.url);
  const idx = url.pathname.indexOf("lesson-materials-api");
  const rest = idx >= 0 ? url.pathname.slice(idx + "lesson-materials-api".length) : "";
  return { segments: rest.split("/").filter(Boolean), method: req.method };
}

async function parseJsonBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? body as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

// ─── Storage-ref helpers (mirror homework-api parseStorageRef / hasUnsafeObjectPath) ──

function hasUnsafeObjectPath(path: string): boolean {
  return path
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .some((segment) => segment === ".." || segment.includes("\\") || segment.includes("\0"));
}

function parseStorageRef(
  value: string | null | undefined,
): { bucket: string; objectPath: string } | null {
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

/**
 * Validate a tutor-supplied PDF ref: must be `storage://lesson-materials/tutor/{uid}/{lessonId}/…pdf`.
 * Binds the upload to the requesting tutor (path segment) and to this lesson.
 */
function validateLessonPdfRef(
  ref: string,
  userId: string,
  lessonId: string,
): { objectPath: string } | null {
  const parsed = parseStorageRef(ref);
  if (!parsed) return null;
  if (parsed.bucket !== LESSON_MATERIAL_BUCKET) return null;
  if (!parsed.objectPath.startsWith(`tutor/${userId}/${lessonId}/`)) return null;
  if (!parsed.objectPath.toLowerCase().endsWith(".pdf")) return null;
  return { objectPath: parsed.objectPath };
}

function isValidRecordingUrl(raw: string): boolean {
  return /^https?:\/\/.+/i.test(raw) && raw.length <= MAX_URL_LEN;
}

function cleanTitle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t.length > 0 ? t.slice(0, MAX_TITLE_LEN) : null;
}

const MATERIAL_SELECT =
  "id, lesson_id, group_session_id, material_kind, url, homework_assignment_id, title, sort_order, created_at";

/** Load a lesson and confirm it belongs to the requesting tutor. */
async function loadOwnedLesson(
  db: SupabaseClient,
  lessonId: string,
  tutorPkId: string,
): Promise<{ id: string; tutor_id: string; student_id: string | null; group_session_id: string | null } | null> {
  const { data } = await db
    .from("tutor_lessons")
    .select("id, tutor_id, student_id, group_session_id")
    .eq("id", lessonId)
    .maybeSingle();
  if (!data || data.tutor_id !== tutorPkId) return null;
  return data as never;
}

// ─── Handlers ───────────────────────────────────────────────────────────────────

async function handleListMaterials(
  db: SupabaseClient,
  tutorPkId: string,
  lessonId: string,
  cors: Record<string, string>,
): Promise<Response> {
  if (!UUID_RE.test(lessonId)) {
    return jsonError(cors, 400, "VALIDATION", "Некорректный идентификатор занятия.");
  }
  const lesson = await loadOwnedLesson(db, lessonId, tutorPkId);
  if (!lesson) return jsonError(cors, 404, "NOT_FOUND", "Занятие не найдено.");

  const { data, error } = await db
    .from("tutor_lesson_materials")
    .select(MATERIAL_SELECT)
    .eq("lesson_id", lessonId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) {
    console.error("lesson_materials_api_db_error", { route: "GET materials", error: error.message });
    return jsonError(cors, 500, "DB_ERROR", "Не удалось загрузить материалы.");
  }
  return jsonOk(cors, { items: data ?? [] });
}

async function handleCreateMaterial(
  db: SupabaseClient,
  tutorPkId: string,
  userId: string,
  lessonId: string,
  body: Record<string, unknown> | null,
  cors: Record<string, string>,
): Promise<Response> {
  if (!UUID_RE.test(lessonId)) {
    return jsonError(cors, 400, "VALIDATION", "Некорректный идентификатор занятия.");
  }
  const lesson = await loadOwnedLesson(db, lessonId, tutorPkId);
  if (!lesson) return jsonError(cors, 404, "NOT_FOUND", "Занятие не найдено.");

  const kind = typeof body?.kind === "string" ? body.kind : "";
  const title = cleanTitle(body?.title);

  // Common insert row scaffold.
  const baseRow = {
    tutor_id: tutorPkId,
    lesson_id: lessonId,
    group_session_id: lesson.group_session_id,
    title,
    created_by: userId,
  };

  if (kind === "recording") {
    const url = typeof body?.url === "string" ? body.url.trim() : "";
    if (!isValidRecordingUrl(url)) {
      return jsonError(cors, 400, "VALIDATION", "Ссылка на запись должна начинаться с http:// или https://.");
    }
    const { count } = await db
      .from("tutor_lesson_materials")
      .select("id", { count: "exact", head: true })
      .eq("lesson_id", lessonId)
      .eq("material_kind", "recording");
    if ((count ?? 0) >= MAX_RECORDINGS) {
      return jsonError(cors, 409, "LIMIT_REACHED", `Можно добавить не более ${MAX_RECORDINGS} ссылок на запись.`);
    }
    return await insertMaterial(db, { ...baseRow, material_kind: "recording", url, homework_assignment_id: null }, cors);
  }

  if (kind === "pdf") {
    const ref = typeof body?.url === "string" ? body.url.trim() : "";
    const validated = validateLessonPdfRef(ref, userId, lessonId);
    if (!validated) {
      return jsonError(cors, 400, "INVALID_ATTACHMENT_REF", "Некорректная ссылка на PDF-файл.");
    }
    const { count } = await db
      .from("tutor_lesson_materials")
      .select("id", { count: "exact", head: true })
      .eq("lesson_id", lessonId)
      .eq("material_kind", "pdf");
    if ((count ?? 0) >= MAX_PDFS) {
      return jsonError(cors, 409, "LIMIT_REACHED", `Можно добавить не более ${MAX_PDFS} PDF-конспектов.`);
    }
    return await insertMaterial(
      db,
      { ...baseRow, material_kind: "pdf", url: serializeAttachmentUrls([ref]), homework_assignment_id: null },
      cors,
    );
  }

  if (kind === "homework_ref") {
    const hwId = typeof body?.homework_assignment_id === "string" ? body.homework_assignment_id : "";
    if (!UUID_RE.test(hwId)) {
      return jsonError(cors, 400, "VALIDATION", "Некорректный идентификатор домашнего задания.");
    }
    // (b) assignment ownership — FK-drift: assignment.tutor_id → auth.users.id.
    const { data: asg } = await db
      .from("homework_tutor_assignments")
      .select("id, tutor_id")
      .eq("id", hwId)
      .maybeSingle();
    if (!asg || asg.tutor_id !== userId) {
      return jsonError(cors, 403, "INVALID_HOMEWORK_REF", "Это ДЗ нельзя привязать к занятию.");
    }
    // (c) anti cross-student: assignment must be assigned to a student of this lesson.
    const studentSet = new Set<string>();
    if (lesson.student_id) studentSet.add(lesson.student_id);
    const { data: parts } = await db
      .from("tutor_lesson_participants")
      .select("student_id")
      .eq("lesson_id", lessonId);
    for (const p of parts ?? []) {
      if (p.student_id) studentSet.add(p.student_id as string);
    }
    if (studentSet.size === 0) {
      return jsonError(cors, 403, "INVALID_HOMEWORK_REF", "Это ДЗ нельзя привязать к занятию.");
    }
    const { data: match } = await db
      .from("homework_tutor_student_assignments")
      .select("id")
      .eq("assignment_id", hwId)
      .in("student_id", [...studentSet])
      .limit(1);
    if (!match || match.length === 0) {
      return jsonError(cors, 403, "INVALID_HOMEWORK_REF", "Это ДЗ не назначено ученику этого занятия.");
    }
    // 1:1 pre-check for a clean message (unique index is the authoritative guard).
    const { data: existingHw } = await db
      .from("tutor_lesson_materials")
      .select("id")
      .eq("lesson_id", lessonId)
      .eq("material_kind", "homework_ref")
      .limit(1);
    if (existingHw && existingHw.length > 0) {
      return jsonError(cors, 409, "HW_REF_EXISTS", "К этому занятию уже привязано домашнее задание.");
    }
    return await insertMaterial(
      db,
      { ...baseRow, material_kind: "homework_ref", url: null, homework_assignment_id: hwId },
      cors,
    );
  }

  return jsonError(cors, 400, "VALIDATION", "Неизвестный тип материала.");
}

async function insertMaterial(
  db: SupabaseClient,
  row: Record<string, unknown>,
  cors: Record<string, string>,
): Promise<Response> {
  const { data, error } = await db
    .from("tutor_lesson_materials")
    .insert(row)
    .select(MATERIAL_SELECT)
    .single();
  if (error) {
    if (error.code === "23505") {
      return jsonError(cors, 409, "HW_REF_EXISTS", "К этому занятию уже привязано домашнее задание.");
    }
    console.error("lesson_materials_api_db_error", {
      route: "POST materials",
      kind: row.material_kind,
      error: error.message,
    });
    return jsonError(cors, 500, "DB_ERROR", "Не удалось сохранить материал.");
  }
  console.log("lesson_materials_api_created", {
    lesson_id: row.lesson_id,
    kind: row.material_kind,
  });
  return jsonOk(cors, { material: data }, 201);
}

async function handleDeleteMaterial(
  db: SupabaseClient,
  tutorPkId: string,
  materialId: string,
  cors: Record<string, string>,
): Promise<Response> {
  if (!UUID_RE.test(materialId)) {
    return jsonError(cors, 400, "VALIDATION", "Некорректный идентификатор материала.");
  }
  const { data: material } = await db
    .from("tutor_lesson_materials")
    .select("id, tutor_id, material_kind, url")
    .eq("id", materialId)
    .maybeSingle();
  if (!material || material.tutor_id !== tutorPkId) {
    return jsonError(cors, 404, "NOT_FOUND", "Материал не найден.");
  }

  // rule 50: delete the DB ref FIRST, then the blob.
  const { error: delErr } = await db.from("tutor_lesson_materials").delete().eq("id", materialId);
  if (delErr) {
    console.error("lesson_materials_api_db_error", { route: "DELETE material", error: delErr.message });
    return jsonError(cors, 500, "DB_ERROR", "Не удалось удалить материал.");
  }

  if (material.material_kind === "pdf") {
    const ref = parseAttachmentUrls(material.url as string | null)[0];
    const parsed = ref ? parseStorageRef(ref) : null;
    if (parsed && parsed.bucket === LESSON_MATERIAL_BUCKET) {
      const { error: storageErr } = await db.storage
        .from(LESSON_MATERIAL_BUCKET)
        .remove([parsed.objectPath]);
      if (storageErr) {
        // Non-fatal: row is already gone; orphan blob is acceptable v1 debt.
        console.error("lesson_materials_api_storage_remove_failed", { error: storageErr.message });
      }
    }
  }

  console.log("lesson_materials_api_deleted", { material_id: materialId, kind: material.material_kind });
  return jsonOk(cors, { ok: true });
}

/**
 * TASK-7 STUB: digest notify (push→telegram→email) is P1. This validates
 * ownership and returns a stable shape so the client wiring can land early.
 */
async function handleNotifyStub(
  db: SupabaseClient,
  tutorPkId: string,
  lessonId: string,
  cors: Record<string, string>,
): Promise<Response> {
  if (!UUID_RE.test(lessonId)) {
    return jsonError(cors, 400, "VALIDATION", "Некорректный идентификатор занятия.");
  }
  const lesson = await loadOwnedLesson(db, lessonId, tutorPkId);
  if (!lesson) return jsonError(cors, 404, "NOT_FOUND", "Занятие не найдено.");
  console.info("lesson_materials_notify_stub", { lesson_id: lessonId });
  return jsonOk(cors, { ok: true, notify: { implemented: false } });
}

// ─── Entry point ────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: cors });
  }

  const route = parseRoute(req);
  console.log("lesson_materials_api_request_start", { method: route.method, segments: route.segments });

  try {
    const authResult = await authenticateUser(req, cors);
    if (authResult instanceof Response) return authResult;
    const { userId } = authResult;

    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const tutorPkId = await resolveTutorPkId(db, userId);
    if (!tutorPkId) {
      return jsonError(cors, 403, "NOT_A_TUTOR", "Доступ только для репетиторов.");
    }

    const seg = route.segments;

    // POST /lessons/:lessonId/materials/notify  (STUB — TASK-7)
    if (
      seg.length === 4 && seg[0] === "lessons" && seg[2] === "materials" &&
      seg[3] === "notify" && route.method === "POST"
    ) {
      return await handleNotifyStub(db, tutorPkId, seg[1], cors);
    }

    // GET /lessons/:lessonId/materials
    if (seg.length === 3 && seg[0] === "lessons" && seg[2] === "materials" && route.method === "GET") {
      return await handleListMaterials(db, tutorPkId, seg[1], cors);
    }

    // POST /lessons/:lessonId/materials
    if (seg.length === 3 && seg[0] === "lessons" && seg[2] === "materials" && route.method === "POST") {
      const body = await parseJsonBody(req);
      return await handleCreateMaterial(db, tutorPkId, userId, seg[1], body, cors);
    }

    // DELETE /materials/:id
    if (seg.length === 2 && seg[0] === "materials" && route.method === "DELETE") {
      return await handleDeleteMaterial(db, tutorPkId, seg[1], cors);
    }

    return jsonError(cors, 404, "NOT_FOUND", "Маршрут не найден.");
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("lesson_materials_api_unhandled_error", { message });
    return jsonError(cors, 500, "INTERNAL", `Внутренняя ошибка: ${message}`);
  }
});
