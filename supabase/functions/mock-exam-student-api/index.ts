// Redeploy trigger 2026-06-08: form-mode Часть-1 derive-on-read
// (`student_answer ?? OCR`, handleGetResult) уже КОРРЕКТЕН в коде — на проде
// ученик/репетитор видел «без ответа» из-за STALE edge-функции (деплой через
// Lovable на push, не deploy-sokratai). Этот no-op комментарий гарантирует
// редеплой при push. Логику НЕ меняет. См. rule 45 «Результат пробника … 2026-06-08».
//
// Mock Exams v1 — student-side API (TASK-4 of mock-exams-v1).
//
// Endpoints:
//   GET   /student/:id                    — assignment + variant + tasks (anti-leak: no correct_answer / solution_text / rubric_*)
//   GET   /student/:id/result             — state-aware result view (TASK-13)
//   POST  /attempts/:id/start             — sets started_at if NULL; returns attempt snapshot
//   PATCH /attempts/:id/answer            — auto-save single Part 1 answer (debounced 500ms client-side)
//   POST  /attempts/:id/photo             — multipart upload Part 2 photo
//   POST  /attempts/:id/submit            — final: deterministic checker + INSERT 6 pending part2 + AI grading enqueue
//
// Spec: docs/delivery/features/mock-exams-v1/spec.md §5 API
// AC-2: state восстанавливается после reload
// AC-3: deterministic checker для всех 5+ типов
// AC-4: AI grading edge function вызывается после submit
// AC-5: tutor approval публикует Часть 2 ученику
//
// Anti-leak invariant (КРИТИЧНО): student endpoints НЕ возвращают
// `correct_answer`, `solution_text`, `rubric_text`, `rubric_image_urls`,
// `ai_draft_json` пока ученик ещё решает (in_progress). После submit
// ОТКРЫВАЕМ только Часть 1 reveal данных (correct_answer + earned_score).
// После approval ОТКРЫВАЕМ Часть 2 (tutor_score / tutor_comment / solution_text).
// `ai_draft_json` НИКОГДА не возвращается ученику ни в одной из стадий.

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { rewriteToProxy } from "../_shared/proxy-url.ts";

// ─── Constants ───────────────────────────────────────────────────────────────

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const PART2_PHOTO_BUCKET = "mock-exam-part2-photos";
const BLANK_PHOTO_BUCKET = "mock-exam-blanks";
const SIGNED_URL_TTL_SEC = 3600;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_PHOTO_MIME = new Set([
  "image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif",
]);

const FALLBACK_ORIGINS = [
  "https://sokratai.ru",
  "https://sokratai.lovable.app",
  "http://localhost:8080",
  "http://localhost:5173",
];

// ─── CORS ────────────────────────────────────────────────────────────────────

function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const envOrigins = Deno.env.get("MOCK_EXAM_API_ALLOWED_ORIGINS");
  const allowed = envOrigins
    ? envOrigins.split(",").map((o) => o.trim()).filter(Boolean)
    : FALLBACK_ORIGINS;
  const isLovableOrigin =
    origin.endsWith(".lovableproject.com") || origin.endsWith(".lovable.app");
  const matched = allowed.includes(origin) || isLovableOrigin ? origin : allowed[0];
  return {
    "Access-Control-Allow-Origin": matched,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

// ─── Response helpers ────────────────────────────────────────────────────────

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

function isPositiveInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0;
}

async function parseJsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

// ─── Auth ────────────────────────────────────────────────────────────────────

async function authenticateUser(
  req: Request,
  cors: Record<string, string>,
): Promise<{ userId: string } | Response> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonError(cors, 401, "UNAUTHORIZED", "Missing Authorization header");
  }
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: authHeader, apikey: SUPABASE_ANON_KEY },
  });
  if (!resp.ok) return jsonError(cors, 401, "UNAUTHORIZED", "Invalid or expired token");
  const user = await resp.json();
  if (!user?.id) return jsonError(cors, 401, "UNAUTHORIZED", "Invalid or expired token");
  return { userId: user.id };
}

// ─── Ownership ──────────────────────────────────────────────────────────────

async function getOwnedAttemptOrThrow(
  db: SupabaseClient,
  attemptId: string,
  studentUserId: string,
  cors: Record<string, string>,
): Promise<Record<string, unknown> | Response> {
  if (!isUUID(attemptId)) {
    return jsonError(cors, 400, "INVALID_ID", "Invalid attempt ID");
  }
  const { data, error } = await db
    .from("mock_exam_attempts")
    .select("*")
    .eq("id", attemptId)
    .maybeSingle();
  if (error) return jsonError(cors, 500, "DB_ERROR", "Failed to load attempt");
  if (!data) return jsonError(cors, 404, "NOT_FOUND", "Attempt not found");
  if (data.student_id !== studentUserId) {
    // Don't leak existence — same 404.
    return jsonError(cors, 404, "NOT_FOUND", "Attempt not found");
  }
  return data as Record<string, unknown>;
}

// ─── Storage helpers ────────────────────────────────────────────────────────

function parseStorageRef(ref: string | null | undefined): { bucket: string; path: string } | null {
  if (!ref || typeof ref !== "string") return null;
  const trimmed = ref.trim();
  if (!trimmed.startsWith("storage://")) return null;
  const rest = trimmed.slice("storage://".length);
  const slashIdx = rest.indexOf("/");
  if (slashIdx <= 0) return null;
  return { bucket: rest.slice(0, slashIdx), path: rest.slice(slashIdx + 1) };
}

function toStorageRef(bucket: string, path: string): string {
  return `storage://${bucket}/${path}`;
}

async function resolveSignedUrl(db: SupabaseClient, ref: string | null): Promise<string | null> {
  const parsed = parseStorageRef(ref);
  if (!parsed) return null;
  const { data, error } = await db.storage
    .from(parsed.bucket)
    .createSignedUrl(parsed.path, SIGNED_URL_TTL_SEC);
  if (error || !data?.signedUrl) {
    console.warn("mock_exam_student_signed_url_failed", { error: error?.message });
    return null;
  }
  return rewriteToProxy(data.signedUrl);
}

function inferExtension(mimeType: string, fallback = "jpg"): string {
  switch (mimeType) {
    case "image/png": return "png";
    case "image/webp": return "webp";
    case "image/heic": return "heic";
    case "image/heif": return "heif";
    case "image/jpeg":
    case "image/jpg": return "jpg";
    default: return fallback;
  }
}

// ─── Deterministic Part 1 checker ───────────────────────────────────────────
//
// Phase 6 (2026-05-15): inline mirror был вынесен в
// `../_shared/mock-exam-part1-checker.ts` чтобы переиспользовать в
// `mock-exam-grade` (для AI OCR result grading в blank mode). Деление-
// mirror invariant (.claude/rules/45-mock-exams.md): _shared/mock-exam-part1-checker.ts
// — single Deno source of truth. Frontend canonical:
// `src/lib/mockExamPart1Checker.ts`.

import {
  checkPart1,
  type CheckMode,
} from "../_shared/mock-exam-part1-checker.ts";
import { parseAttachmentUrls } from "../_shared/attachment-refs.ts";

// ─── Routing ─────────────────────────────────────────────────────────────────

interface RouteMatch {
  segments: string[];
  method: string;
}

function parseRoute(req: Request): RouteMatch {
  const url = new URL(req.url);
  const idx = url.pathname.indexOf("mock-exam-student-api");
  const rest = idx >= 0
    ? url.pathname.slice(idx + "mock-exam-student-api".length)
    : "";
  const segments = rest.split("/").filter(Boolean);
  return { segments, method: req.method };
}

// ────────────────────────────────────────────────────────────────────────────
// GET /student/:id  — assignment view (anti-leak)
// ────────────────────────────────────────────────────────────────────────────

async function handleGetStudentAssignment(
  db: SupabaseClient,
  studentUserId: string,
  rawId: string,
  cors: Record<string, string>,
): Promise<Response> {
  if (!isUUID(rawId)) {
    return jsonError(cors, 400, "INVALID_ID", "Invalid assignment ID");
  }

  // Defensive lookup — `rawId` ОБЫЧНО assignment_id (стандартный contract),
  // но если фронт передал attempt_id (e.g. cached bundle до FIX-5,
  // bookmarked URL, ручная вставка пути) — резолвим и его. Это защищает
  // ученика от ошибки «Assignment not found» при stale browser cache.
  // Любая попытка (по assignment_id или по attempt_id) обязательно делает
  // ownership check `student_id = auth.uid()` — ученик не сможет открыть
  // чужой пробник.
  // AC-P10 hotfix (2026-05-25 P0 #2): include exam_mode + sessions +
  // total_active_ms в response. Без этого frontend timer считает wall-clock
  // от started_at вместо active time для training mode → после resume через
  // неделю timer показывает «-5 дней» или auto-submit срабатывает мгновенно.
  const ATTEMPT_SELECT =
    "id, assignment_id, status, started_at, submitted_at, blank_photo_url, " +
    "part1_blank_photo_url, part2_bulk_photo_urls, answer_method, " +
    "total_part1_score, total_part2_score, total_score, " +
    "exam_mode, sessions, total_active_ms";
  let attempt: Record<string, unknown> | null = null;
  {
    const byAssignment = await db
      .from("mock_exam_attempts")
      .select(ATTEMPT_SELECT)
      .eq("assignment_id", rawId)
      .eq("student_id", studentUserId)
      .maybeSingle();
    if (byAssignment.error) {
      return jsonError(cors, 500, "DB_ERROR", "Failed to load attempt");
    }
    attempt = byAssignment.data;
  }
  if (!attempt) {
    // Fallback: пытаемся как attempt_id.
    const byAttemptId = await db
      .from("mock_exam_attempts")
      .select(ATTEMPT_SELECT)
      .eq("id", rawId)
      .eq("student_id", studentUserId)
      .maybeSingle();
    if (byAttemptId.error) {
      return jsonError(cors, 500, "DB_ERROR", "Failed to load attempt");
    }
    attempt = byAttemptId.data;
    if (attempt) {
      console.warn("mock_exam_student_assignment_id_fallback_attempt_id", {
        student_id: studentUserId,
        passed_id: rawId,
        resolved_assignment_id: attempt.assignment_id,
      });
    }
  }
  if (!attempt) {
    console.warn("mock_exam_student_assignment_not_found", {
      student_id: studentUserId,
      passed_id: rawId,
    });
    return jsonError(
      cors,
      404,
      "NOT_FOUND",
      "Пробник не найден или не назначен этому ученику",
      { passed_id: rawId },
    );
  }

  const assignmentId = attempt.assignment_id as string;

  const { data: assignment, error: assignmentErr } = await db
    .from("mock_exam_assignments")
    .select("id, variant_id, variant_title, title, mode, deadline, status, default_exam_mode")
    .eq("id", assignmentId)
    .maybeSingle();
  if (assignmentErr || !assignment) {
    return jsonError(cors, 404, "NOT_FOUND", "Assignment not found");
  }

  let variant: Record<string, unknown> | null = null;
  let tasks: Record<string, unknown>[] = [];
  if (assignment.variant_id) {
    const { data: variantRow } = await db
      .from("mock_exam_variants")
      .select("id, title, exam_type, duration_minutes, total_max_score, part1_max, part2_max, task_count, variant_pdf_url")
      .eq("id", assignment.variant_id as string)
      .maybeSingle();
    variant = variantRow;

    // Anti-leak: SELECT explicitly omits correct_answer, solution_text.
    const { data: variantTasks, error: tasksErr } = await db
      .from("mock_exam_variant_tasks")
      .select("id, kim_number, part, order_num, task_text, task_image_url, check_mode, max_score, topic")
      .eq("variant_id", assignment.variant_id as string)
      .order("order_num", { ascending: true });
    if (tasksErr) return jsonError(cors, 500, "DB_ERROR", "Failed to load variant tasks");
    tasks = variantTasks ?? [];
  }

  // Load existing answers (auto-save state restore — AC-2).
  const { data: part1Rows } = await db
    .from("mock_exam_attempt_part1_answers")
    .select("kim_number, student_answer, updated_at")
    .eq("attempt_id", attempt.id);

  const { data: part2Rows } = await db
    .from("mock_exam_attempt_part2_solutions")
    .select("kim_number, photo_url, status, updated_at")
    .eq("attempt_id", attempt.id);

  const part2WithSignedUrls = await Promise.all(
    (part2Rows ?? []).map(async (row) => ({
      kim_number: row.kim_number,
      photo_url: await resolveSignedUrl(db, row.photo_url as string | null),
      status: row.status,
      updated_at: row.updated_at,
    })),
  );

  const blankPhotoSigned = await resolveSignedUrl(
    db,
    attempt.blank_photo_url as string | null,
  );

  const part1BlankPhotoSigned = await resolveSignedUrl(
    db,
    attempt.part1_blank_photo_url as string | null,
  );

  // part2_bulk_photo_urls — dual-format (single ref OR JSON-array string).
  // Match invariant from homework_tutor_tasks.task_image_url (см.
  // .claude/rules/40-homework-system.md Multi-photo). Returned to client as
  // resolved signed URL array, never raw storage:// refs.
  const part2BulkPhotoRefs: string[] = (() => {
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
      } catch {
        // Fall through — corrupted JSON treated as no photos
      }
      return [];
    }
    return [trimmed];
  })();
  const part2BulkPhotoSigned = (
    await Promise.all(part2BulkPhotoRefs.map((ref) => resolveSignedUrl(db, ref)))
  ).filter((url): url is string => typeof url === "string");

  return jsonOk(cors, {
    assignment: {
      id: assignment.id,
      variant_id: assignment.variant_id,
      title: assignment.title,
      mode: assignment.mode,
      deadline: assignment.deadline,
      status: assignment.status,
      // AC-P10 Phase 2 (PAUSE-7/PAUSE-4): tutor recommendation для start modal.
      // Default 'training' для backward compat с pre-migration assignments.
      default_exam_mode:
        (assignment.default_exam_mode as "simulation" | "training" | null) ?? "training",
    },
    variant: variant
      ? {
        id: variant.id,
        title: variant.title,
        exam_type: variant.exam_type,
        duration_minutes: variant.duration_minutes,
        total_max_score: variant.total_max_score,
        part1_max: variant.part1_max,
        part2_max: variant.part2_max,
        task_count: variant.task_count,
        variant_pdf_url: variant.variant_pdf_url
          ? rewriteToProxy(variant.variant_pdf_url as string)
          : null,
      }
      : null,
    tasks,
    attempt: {
      id: attempt.id,
      status: attempt.status,
      started_at: attempt.started_at,
      submitted_at: attempt.submitted_at,
      answer_method: attempt.answer_method ?? null,
      blank_photo_url: blankPhotoSigned,
      part1_blank_photo_url: part1BlankPhotoSigned,
      part2_bulk_photo_urls: part2BulkPhotoSigned,
      total_part1_score: attempt.total_part1_score,
      total_part2_score: attempt.total_part2_score,
      total_score: attempt.total_score,
      // AC-P10 hotfix: timer fields для active-time computation в frontend.
      exam_mode: (attempt.exam_mode as string | null) ?? "training",
      sessions: Array.isArray(attempt.sessions) ? attempt.sessions : [],
      total_active_ms:
        typeof attempt.total_active_ms === "number" ? attempt.total_active_ms : 0,
    },
    part1_answers: part1Rows ?? [],
    part2_solutions: part2WithSignedUrls,
  });
}


// ────────────────────────────────────────────────────────────────────────────
// GET /student/:id/result  — state-aware result view (TASK-13)
// ────────────────────────────────────────────────────────────────────────────
//
// Hard contract:
//   - status='in_progress' → 409 NOT_SUBMITTED. Result page нельзя смотреть
//     пока ученик не сдал. Frontend redirect'ит обратно на /student/mock-exams/:id.
//   - status='submitted' | 'ai_checking' | 'awaiting_review' →
//     Часть 1 reveal (earned_score + correct_answer per task), Часть 2 hidden
//     (только photo_url, никаких tutor_score / tutor_comment / solution_text /
//     ai_draft_json). Это AC-5: AI never shown to student.
//   - status='approved' → Часть 1 reveal + Часть 2 reveal (tutor_score,
//     tutor_comment, solution_text, task_text). ai_draft_json по-прежнему НЕ
//     возвращается — он tutor-only artifact, ученик его не должен видеть
//     (он мог отличаться от tutor approval).
//   - status='manually_entered' → только totals + manual_entered_date +
//     manual_comment, без per-task разбора (по дизайну: manual entry = backfill
//     прошлого пробника, AI/tasks нет).

async function handleGetResult(
  db: SupabaseClient,
  studentUserId: string,
  rawId: string,
  cors: Record<string, string>,
): Promise<Response> {
  if (!isUUID(rawId)) {
    return jsonError(cors, 400, "INVALID_ID", "Invalid assignment ID");
  }

  // Auth ownership: load attempt by assignment_id (primary) или attempt_id
  // (fallback для stale frontend bundle / bookmarked URL). См. defensive
  // logic в handleGetStudentAssignment выше.
  const SELECT_COLS =
    "id, assignment_id, status, started_at, submitted_at, " +
    "total_time_minutes, blank_photo_url, part2_bulk_photo_urls, " +
    "total_part1_score, total_part2_score, total_score, " +
    "manual_entered_date, manual_comment, ai_part1_ocr_json";
  let attempt: Record<string, unknown> | null = null;
  {
    const byAssignment = await db
      .from("mock_exam_attempts")
      .select(SELECT_COLS)
      .eq("assignment_id", rawId)
      .eq("student_id", studentUserId)
      .maybeSingle();
    if (byAssignment.error) {
      return jsonError(cors, 500, "DB_ERROR", "Failed to load attempt");
    }
    attempt = byAssignment.data;
  }
  if (!attempt) {
    const byAttemptId = await db
      .from("mock_exam_attempts")
      .select(SELECT_COLS)
      .eq("id", rawId)
      .eq("student_id", studentUserId)
      .maybeSingle();
    if (byAttemptId.error) {
      return jsonError(cors, 500, "DB_ERROR", "Failed to load attempt");
    }
    attempt = byAttemptId.data;
  }
  if (!attempt) {
    return jsonError(
      cors,
      404,
      "NOT_FOUND",
      "Пробник не найден или не назначен этому ученику",
      { passed_id: rawId },
    );
  }
  const assignmentId = attempt.assignment_id as string;

  // H1 hotfix [P0] (ChatGPT-5.5 review, 2026-05-26): block in_progress AND paused.
  // AC-P10 ввёл новый pre-submit статус `paused`. Без этого guard ученик может:
  // 1. Pause attempt (в середине решения)
  // 2. Открыть /student/mock-exams/:id/result URL напрямую
  // 3. Получить correct_answers для всех Часть 1 KIM
  // 4. Resume → ввести правильные ответы
  // → Exam integrity полностью сломана.
  if (attempt.status === "in_progress" || attempt.status === "paused") {
    return jsonError(
      cors,
      409,
      "NOT_SUBMITTED",
      "Attempt is still in progress",
      { status: attempt.status as string },
    );
  }

  // Assignment whitelist (no tutor_id leak — резолвим отдельно через ownership).
  const { data: assignment, error: assignmentErr } = await db
    .from("mock_exam_assignments")
    .select("id, variant_id, variant_title, title, mode, deadline, status, tutor_id")
    .eq("id", assignmentId)
    .maybeSingle();
  if (assignmentErr || !assignment) {
    return jsonError(cors, 404, "NOT_FOUND", "Assignment not found");
  }

  // Tutor card — public-safe whitelist (mirrors mock-exam-public/loadTutorCard).
  // Никаких telegram_id / telegram_username / booking_link / email.
  let tutorCard: { name: string; avatar_url: string | null } | null = null;
  if (assignment.tutor_id) {
    const { data: tutorRow } = await db
      .from("tutors")
      .select("name, avatar_url")
      .eq("user_id", assignment.tutor_id as string)
      .maybeSingle();
    if (tutorRow) {
      tutorCard = {
        name: (tutorRow.name as string | null) ?? "",
        avatar_url: (tutorRow.avatar_url as string | null) ?? null,
      };
    }
  }

  const isApproved = attempt.status === "approved";
  const isManualEntered = attempt.status === "manually_entered";
  // H1 hotfix [P0] (ChatGPT-5.5 review, 2026-05-26): explicit allowlist вместо
  // `!isManualEntered`. Защита defense-in-depth от новых статусов (как `paused`
  // после AC-P10) которые могли бы fall-through в isPostSubmit. Если добавится
  // новый pre-submit status в будущем — здесь он автоматически НЕ попадёт.
  const isPostSubmit =
    attempt.status === "submitted" ||
    attempt.status === "ai_checking" ||
    attempt.status === "awaiting_review" ||
    attempt.status === "approved";

  let variant: Record<string, unknown> | null = null;
  const variantTasksByKim: Record<number, Record<string, unknown>> = {};
  if (assignment.variant_id) {
    const { data: variantRow } = await db
      .from("mock_exam_variants")
      .select(
        "id, title, exam_type, duration_minutes, total_max_score, " +
          "part1_max, part2_max, task_count",
      )
      .eq("id", assignment.variant_id as string)
      .maybeSingle();
    variant = variantRow;

    // State-aware task SELECT.
    //   2026-06-02 (item 2): post-submit (submitted/ai_checking/awaiting_review/
    //     approved) теперь грузит ПОЛНЫЙ набор, т.к. ученик видит предварительный
    //     разбор Части 2 (solution_text + task_text) сразу после сдачи — продуктовое
    //     решение Vladimir (one-shot exam, без пересдач). `correct_answer` (Часть 1)
    //     остаётся revealed post-submit как раньше.
    //   manually_entered — нет per-task rows, минимальный select.
    // Pre-SUBMIT (in_progress/paused) сюда не доходит — early-reject 409 выше.
    const taskSelect = isPostSubmit
      ? "kim_number, part, order_num, task_text, task_image_url, " +
        "correct_answer, check_mode, max_score, solution_text, solution_image_urls, topic"
      : "kim_number, part, correct_answer, check_mode, max_score";
    const { data: variantTasks } = await db
      .from("mock_exam_variant_tasks")
      .select(taskSelect)
      .eq("variant_id", assignment.variant_id as string)
      .order("order_num", { ascending: true });
    for (const t of variantTasks ?? []) {
      variantTasksByKim[t.kim_number as number] = t as Record<string, unknown>;
    }
  }

  // Part 1 — reveal post-submit. Manual_entered не имеет per-task records.
  // AC-P11 (2026-05-26): + tutor_comment в SELECT + response payload. Visible
  // post-submit (когда part1 уже scored). Ученик видит «Комментарий репетитора»
  // в Part1Card row под balance.
  let part1Answers: unknown[] = [];
  if (isPostSubmit) {
    // КРИТИЧНО (2026-06-08): колонки tutor_comment в mock_exam_attempt_part1_answers
    // НЕТ (schema 20260508120000 — tutor_comment живёт на part2_solutions). Её SELECT
    // молча ронял ВЕСЬ запрос: PostgREST возвращал error «column does not exist»,
    // `data`=null, part1Rows пустой → form-режим показывал «без ответа» у ученика И
    // репетитора (blank выживал на OCR-фолбэке). Колонку убрали; ошибку теперь
    // ЛОГИРУЕМ, а не глотаем. Per-KIM коммент Части 1 (AC-P11) — потребуется миграция
    // ADD COLUMN tutor_comment + повторный select.
    const { data: part1Rows, error: part1RowsErr } = await db
      .from("mock_exam_attempt_part1_answers")
      .select("kim_number, student_answer, earned_score")
      .eq("attempt_id", attempt.id)
      .order("kim_number", { ascending: true });
    if (part1RowsErr) {
      console.error(JSON.stringify({
        event: "mock_result_part1_select_failed",
        message: part1RowsErr.message,
      }));
    }

    const rowsByKim = new Map<number, Record<string, unknown>>();
    for (const r of part1Rows ?? []) {
      rowsByKim.set(r.kim_number as number, r as Record<string, unknown>);
    }

    // Derive-on-read fallback (2026-06-06/07): строки могут отсутствовать /
    // иметь earned_score=null (попытки до редеплоя per-KIM персистинга, обе
    // режима). Восстанавливаем разбалловку ТОЛЬКО для отображения:
    //   value  = ответ ученика: typed `student_answer` (form) ?? OCR-распознанное
    //            (blank) — единый источник через resolve.
    //   earned = stored ?? checkPart1(value) ?? null.
    // Stored row всегда в приоритете. Итерируем ВСЕ Part-1 задачи варианта (даже
    // без ответа) → ученик всегда видит полную таблицу разбалловки в обоих
    // режимах (form/blank). `ai_part1_ocr_json` НЕ возвращается ученику (tutor-only
    // artifact, rule 45) — читаем server-side, наружу отдаём только value+score.
    const ocrCells = ((attempt.ai_part1_ocr_json as Record<string, unknown> | null)
      ?.cells ?? null) as Record<string, { value?: string | null }> | null;
    const ocrValueForKim = (kim: number): string | null => {
      const cell = ocrCells?.[kim] ?? ocrCells?.[String(kim)] ?? null;
      const v = cell && typeof cell.value === "string" ? cell.value.trim() : "";
      return v !== "" ? v : null;
    };

    const part1VariantTasks = Object.values(variantTasksByKim)
      .filter((v) => (v.part as number | undefined) === 1)
      .sort((a, b) => ((a.kim_number as number) ?? 0) - ((b.kim_number as number) ?? 0));

    if (part1VariantTasks.length > 0) {
      const out: unknown[] = [];
      for (const v of part1VariantTasks) {
        const kim = v.kim_number as number;
        const row = rowsByKim.get(kim) ?? null;
        const storedScore =
          row != null && row.earned_score !== null && row.earned_score !== undefined
            ? (row.earned_score as number)
            : null;
        const typed =
          row && typeof row.student_answer === "string" && row.student_answer.trim() !== ""
            ? (row.student_answer as string)
            : null;
        // value = ответ ученика: typed (form) ?? OCR-распознанное (blank).
        const value = typed ?? ocrValueForKim(kim);

        let earnedScore: number | null;
        if (storedScore !== null) {
          earnedScore = storedScore;
        } else if (value !== null) {
          earnedScore = checkPart1(
            (v.correct_answer as string | null) ?? null,
            value,
            (v.check_mode as CheckMode | null) ?? null,
            (v.max_score as number | undefined) ?? 0,
            kim,
          ).earned;
        } else {
          earnedScore = null;
        }

        out.push({
          kim_number: kim,
          student_answer: value,
          earned_score: earnedScore,
          tutor_comment: (row?.tutor_comment as string | null) ?? null,
          correct_answer: (v.correct_answer as string | null) ?? null,
          max_score: (v.max_score as number | undefined) ?? 0,
          check_mode: (v.check_mode as string | null) ?? null,
        });
      }
      part1Answers = out;
    } else {
      // Defensive: variant tasks не загрузились (нет variant_id) → старое
      // row-based поведение без regression.
      part1Answers = (part1Rows ?? []).map((row) => {
        const v = variantTasksByKim[row.kim_number as number];
        return {
          kim_number: row.kim_number,
          student_answer: row.student_answer,
          earned_score: row.earned_score,
          tutor_comment: row.tutor_comment,
          correct_answer: (v?.correct_answer as string | null) ?? null,
          max_score: (v?.max_score as number | undefined) ?? 0,
          check_mode: (v?.check_mode as string | null) ?? null,
        };
      });
    }
  }

  // Part 2 reveal (2026-06-02, item 2 — state-aware, see rule 45):
  //   approved          → FINAL: tutor_score + tutor_comment + solution + task.
  //   pre-approval       → PRELIMINARY: AI suggested_score + AI feedback (из
  //     ai_draft_json — ТОЛЬКО эти два поля) + solution + task. Помечается
  //     «предварительно — репетитор подтвердит». НИКОГДА не отдаём ученику
  //     comment_for_tutor / flags / elements_check.
  let part2Solutions: unknown[] = [];
  if (isPostSubmit) {
    const { data: part2Rows } = await db
      .from("mock_exam_attempt_part2_solutions")
      .select(
        isApproved
          ? "kim_number, photo_url, tutor_score, tutor_comment, status"
          : "kim_number, photo_url, status, ai_draft_json",
      )
      .eq("attempt_id", attempt.id)
      .order("kim_number", { ascending: true });

    part2Solutions = await Promise.all(
      (part2Rows ?? []).map(async (row) => {
        const v = variantTasksByKim[row.kim_number as number];
        const photoSigned = await resolveSignedUrl(
          db,
          row.photo_url as string | null,
        );
        // Task image (signed) — shown for context both pre- and post-approval.
        let taskImageSigned: string | null = null;
        const taskImageRef = (v?.task_image_url as string | null) ?? null;
        if (taskImageRef) {
          taskImageSigned = await resolveSignedUrl(db, taskImageRef);
        }
        // 2026-06-05 (item 5): solution images (dual-format) → signed URL array.
        const solutionImageRefs = parseAttachmentUrls((v?.solution_image_urls as string | null) ?? null);
        const solutionImagesSigned = (
          await Promise.all(solutionImageRefs.map((r) => resolveSignedUrl(db, r)))
        ).filter((u): u is string => typeof u === "string");
        if (isApproved) {
          return {
            kim_number: row.kim_number,
            photo_url: photoSigned,
            tutor_score: row.tutor_score,
            tutor_comment: row.tutor_comment,
            status: row.status,
            max_score: (v?.max_score as number | undefined) ?? 0,
            task_text: (v?.task_text as string | null) ?? null,
            task_image_url: taskImageSigned,
            solution_text: (v?.solution_text as string | null) ?? null,
            solution_image_urls: solutionImagesSigned,
            topic: (v?.topic as string | null) ?? null,
          };
        }
        // Pre-approval — extract ONLY suggested_score + feedback from ai_draft_json.
        const draft = (row.ai_draft_json && typeof row.ai_draft_json === "object")
          ? row.ai_draft_json as Record<string, unknown>
          : null;
        const aiScore = typeof draft?.suggested_score === "number" ? draft.suggested_score : null;
        let aiFeedback = (typeof draft?.feedback === "string" && draft.feedback.trim() !== "")
          ? draft.feedback
          : null;
        // 2026-06-02 review fix (P2a): graceful default — если AI УЖЕ отработал
        // (draft есть), но балл null И feedback пуст (legacy до feedback-поля,
        // или фото нечитаемо / переназначено), НЕ оставляем карточку в «AI
        // проверяет…» навсегда. Genuinely-pending = draft отсутствует (AI ещё
        // не запускался) → aiFeedback остаётся null → клиент крутит спиннер.
        if (draft !== null && aiFeedback === null && aiScore === null) {
          aiFeedback = "Предварительная проверка по этой задаче недоступна — репетитор оценит вручную.";
        }
        return {
          kim_number: row.kim_number,
          photo_url: photoSigned,
          status: row.status,
          max_score: (v?.max_score as number | undefined) ?? 0,
          // PRELIMINARY AI result — клиент помечает «предварительно».
          ai_suggested_score: aiScore,
          ai_feedback: aiFeedback,
          task_text: (v?.task_text as string | null) ?? null,
          task_image_url: taskImageSigned,
          solution_text: (v?.solution_text as string | null) ?? null,
          solution_image_urls: solutionImagesSigned,
          topic: (v?.topic as string | null) ?? null,
        };
      }),
    );
  }

  const blankPhotoSigned = await resolveSignedUrl(
    db,
    attempt.blank_photo_url as string | null,
  );

  // TASK-15 (ChatGPT-5.5 review): bulk Part 2 photos появились в taking flow
  // (Phase 5 «9 слотов → 1 bulk»), но result page их не возвращал — ученик
  // post-submit видел «нет фото» хотя загружал. Resolve dual-format ref'ы
  // в signed URLs.
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

  return jsonOk(cors, {
    assignment: {
      id: assignment.id,
      variant_id: assignment.variant_id,
      variant_title: assignment.variant_title,
      title: assignment.title,
      mode: assignment.mode,
      deadline: assignment.deadline,
      status: assignment.status,
    },
    tutor: tutorCard,
    variant: variant
      ? {
        id: variant.id,
        title: variant.title,
        exam_type: variant.exam_type,
        duration_minutes: variant.duration_minutes,
        total_max_score: variant.total_max_score,
        part1_max: variant.part1_max,
        part2_max: variant.part2_max,
        task_count: variant.task_count,
      }
      : null,
    attempt: {
      id: attempt.id,
      status: attempt.status,
      started_at: attempt.started_at,
      submitted_at: attempt.submitted_at,
      total_time_minutes: attempt.total_time_minutes,
      blank_photo_url: blankPhotoSigned,
      part2_bulk_photo_urls: part2BulkPhotoUrls,
      total_part1_score: attempt.total_part1_score,
      total_part2_score: attempt.total_part2_score,
      total_score: attempt.total_score,
      manual_entered_date: attempt.manual_entered_date,
      manual_comment: attempt.manual_comment,
    },
    part1_answers: part1Answers,
    part2_solutions: part2Solutions,
    // TEMP ДИАГНОСТИКА деплоя (2026-06-08) — УДАЛИТЬ после подтверждения.
    // Если этих полей НЕТ в ответе /result → задеплоен старый код (деплой не
    // доехал до рантайма). Если `_deploy_marker` есть, а `_debug_part1_with_answer`
    // > 0 → новый код + derive работает (ответы Части 1 отдаются).
    _deploy_marker: "form-fix-2026-06-08",
    _debug_part1_with_answer: part1Answers.filter(
      (a) =>
        a !== null &&
        typeof a === "object" &&
        (a as Record<string, unknown>).student_answer != null,
    ).length,
  });
}

// ────────────────────────────────────────────────────────────────────────────
// POST /attempts/:id/start
// ────────────────────────────────────────────────────────────────────────────

// AC-P10 helper (2026-05-25): compute total active ms from sessions array.
// sessions: [{started_at: ISO, ended_at: ISO|null}, ...]
// Returns sum of (ended_at - started_at) for closed sessions; open session
// (ended_at=null) excluded — caller adds (now - started_at) when needed.
function computeTotalActiveMs(sessions: unknown): number {
  if (!Array.isArray(sessions)) return 0;
  let total = 0;
  for (const s of sessions) {
    if (!s || typeof s !== "object") continue;
    const session = s as Record<string, unknown>;
    const startStr = session.started_at;
    const endStr = session.ended_at;
    if (typeof startStr !== "string") continue;
    if (typeof endStr !== "string") continue; // open session — skip
    const startMs = Date.parse(startStr);
    const endMs = Date.parse(endStr);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
    const diff = endMs - startMs;
    if (diff > 0) total += diff;
  }
  return total;
}

async function handleStartAttempt(
  db: SupabaseClient,
  studentUserId: string,
  attemptId: string,
  body: unknown,
  cors: Record<string, string>,
): Promise<Response> {
  const ownedOrErr = await getOwnedAttemptOrThrow(db, attemptId, studentUserId, cors);
  if (ownedOrErr instanceof Response) return ownedOrErr;
  const attempt = ownedOrErr;

  if (attempt.status === "approved" || attempt.status === "manually_entered") {
    return jsonError(cors, 409, "ALREADY_FINAL", "Работа уже завершена");
  }

  // AC-P10 (2026-05-25): exam_mode picker — student override or tutor default.
  // Mode immutable после первого start (sessions != []). При повторном /start
  // существующего attempt — игнорируем body.exam_mode, возвращаем existing mode.
  const b = (body && typeof body === "object") ? body as Record<string, unknown> : {};
  const requestedMode = b.exam_mode;
  let examMode: "simulation" | "training" = (attempt.exam_mode as "simulation" | "training" | null) ?? "training";
  if (requestedMode === "simulation" || requestedMode === "training") {
    // Allow override only on first start (sessions empty + started_at NULL).
    const sessions = Array.isArray(attempt.sessions) ? attempt.sessions : [];
    if (sessions.length === 0 && !attempt.started_at) {
      examMode = requestedMode;
    }
  }

  const nowIso = new Date().toISOString();

  // Idempotent: only initialize on first call (started_at IS NULL && sessions=[]).
  // Re-calling /start safe для tab reopen flow — возвращаем existing state.
  if (!attempt.started_at) {
    const initialSessions = [{ started_at: nowIso, ended_at: null }];
    const { error } = await db
      .from("mock_exam_attempts")
      .update({
        started_at: nowIso,
        exam_mode: examMode,
        sessions: initialSessions,
        total_active_ms: 0,
      })
      .eq("id", attemptId)
      .eq("student_id", studentUserId)
      .eq("status", "in_progress");
    if (error) {
      console.error("mock_exam_start_failed", { attempt_id: attemptId, error: error.message });
      return jsonError(cors, 500, "DB_ERROR", "Не удалось запустить пробник");
    }
  }

  return jsonOk(cors, {
    ok: true,
    attempt_id: attemptId,
    exam_mode: examMode,
  });
}

// ────────────────────────────────────────────────────────────────────────────
// POST /attempts/:id/pause  — pause training mode attempt (AC-P10, 2026-05-25)
// ────────────────────────────────────────────────────────────────────────────
//
// Останавливает active timer для training mode пробников. Idempotent: повторный
// call не плодит сессий, возвращает paused state.
//
// Logic:
//   1. Owner check (student.id === attempt.student_id)
//   2. Status guard: in_progress only
//   3. Mode guard: exam_mode='training' only (simulation НЕ позволяет pause)
//   4. Latest session.ended_at = now (закрыть)
//   5. Recompute total_active_ms
//   6. UPDATE status='paused', sessions, total_active_ms
//
// Симптом отсутствия инварианта: ученик в simulation mode видит кнопку pause
// и нажимает → 400 PAUSE_NOT_ALLOWED. Frontend обязан скрывать кнопку для
// simulation; backend защищает as defense-in-depth.

async function handlePauseAttempt(
  db: SupabaseClient,
  studentUserId: string,
  attemptId: string,
  cors: Record<string, string>,
): Promise<Response> {
  const ownedOrErr = await getOwnedAttemptOrThrow(db, attemptId, studentUserId, cors);
  if (ownedOrErr instanceof Response) return ownedOrErr;
  const attempt = ownedOrErr;

  // Idempotent: уже paused → возвращаем current state.
  if (attempt.status === "paused") {
    const totalActiveMs = (attempt.total_active_ms as number | null) ?? 0;
    return jsonOk(cors, {
      ok: true,
      attempt_id: attemptId,
      status: "paused",
      total_active_ms: totalActiveMs,
    });
  }

  if (attempt.status !== "in_progress") {
    return jsonError(cors, 409, "NOT_IN_PROGRESS",
      `Нельзя приостановить пробник со статусом «${attempt.status}»`);
  }

  const examMode = (attempt.exam_mode as "simulation" | "training" | null) ?? "training";
  if (examMode === "simulation") {
    return jsonError(cors, 400, "PAUSE_NOT_ALLOWED",
      "Пауза недоступна в режиме «Симуляция ЕГЭ». Таймер идёт wall-clock как на реальном экзамене.");
  }

  const nowIso = new Date().toISOString();
  const sessions = Array.isArray(attempt.sessions) ? [...attempt.sessions] : [];

  // AC-P10 hotfix (2026-05-25 P0 #1): defensive synthesis для legacy attempts.
  // Если sessions=[] но started_at set (legacy attempt из pre-AC-P10 era ИЛИ
  // attempt создан между deploy и backfill migration 20260525140000) — синтезируем
  // open session из started_at. Migration backfill — primary fix, эта ветка —
  // belt-and-suspenders на edge cases.
  const startedAtStr = (attempt.started_at as string | null) ?? null;
  if (sessions.length === 0) {
    if (!startedAtStr) {
      return jsonError(cors, 409, "NO_ACTIVE_SESSION",
        "Не найдена активная сессия для паузы. Пробник ещё не начат.");
    }
    // Synthesize one session from started_at to now — equivalent to «пробник
    // был активен с момента старта». Это close-immediately pattern: добавляем
    // session с ended_at = now (закрытая на этом шаге).
    sessions.push({ started_at: startedAtStr, ended_at: nowIso });
    console.info(JSON.stringify({
      event: "mock_exam_pause_synthesized_legacy_session",
      attempt_id: attemptId,
      started_at: startedAtStr,
    }));
  } else {
    // Close latest session if open.
    const lastIdx = sessions.length - 1;
    const last = sessions[lastIdx] as Record<string, unknown> | null;
    if (!last || typeof last !== "object" || last.ended_at !== null) {
      return jsonError(cors, 409, "NO_OPEN_SESSION",
        "Активная сессия уже закрыта. Обнови страницу.");
    }
    sessions[lastIdx] = { ...last, ended_at: nowIso };
  }

  const totalActiveMs = computeTotalActiveMs(sessions);

  const { error } = await db
    .from("mock_exam_attempts")
    .update({
      status: "paused",
      sessions,
      total_active_ms: totalActiveMs,
    })
    .eq("id", attemptId)
    .eq("student_id", studentUserId)
    .eq("status", "in_progress"); // CAS guard against concurrent submit
  if (error) {
    console.error("mock_exam_pause_failed", { attempt_id: attemptId, error: error.message });
    return jsonError(cors, 500, "DB_ERROR", "Не удалось приостановить пробник. Попробуй ещё раз.");
  }

  console.info(JSON.stringify({
    event: "mock_exam_attempt_paused",
    attempt_id: attemptId,
    total_active_ms: totalActiveMs,
    sessions_count: sessions.length,
  }));

  return jsonOk(cors, {
    ok: true,
    attempt_id: attemptId,
    status: "paused",
    total_active_ms: totalActiveMs,
  });
}

// ────────────────────────────────────────────────────────────────────────────
// POST /attempts/:id/resume  — resume paused attempt (AC-P10, 2026-05-25)
// ────────────────────────────────────────────────────────────────────────────
//
// Возобновляет paused training-mode пробник. Idempotent: повторный call в
// in_progress возвращает current state без новой сессии.
//
// Logic:
//   1. Owner check
//   2. Status: paused (or in_progress for idempotency)
//   3. Append { started_at: now, ended_at: null }
//   4. UPDATE status='in_progress', sessions

async function handleResumeAttempt(
  db: SupabaseClient,
  studentUserId: string,
  attemptId: string,
  cors: Record<string, string>,
): Promise<Response> {
  const ownedOrErr = await getOwnedAttemptOrThrow(db, attemptId, studentUserId, cors);
  if (ownedOrErr instanceof Response) return ownedOrErr;
  const attempt = ownedOrErr;

  // Idempotent: уже in_progress → возвращаем current state.
  if (attempt.status === "in_progress") {
    return jsonOk(cors, {
      ok: true,
      attempt_id: attemptId,
      status: "in_progress",
    });
  }

  if (attempt.status !== "paused") {
    return jsonError(cors, 409, "NOT_PAUSED",
      `Нельзя возобновить пробник со статусом «${attempt.status}»`);
  }

  const nowIso = new Date().toISOString();
  const sessions = Array.isArray(attempt.sessions) ? [...attempt.sessions] : [];
  sessions.push({ started_at: nowIso, ended_at: null });

  const { error } = await db
    .from("mock_exam_attempts")
    .update({
      status: "in_progress",
      sessions,
    })
    .eq("id", attemptId)
    .eq("student_id", studentUserId)
    .eq("status", "paused"); // CAS guard against multi-tab race
  if (error) {
    console.error("mock_exam_resume_failed", { attempt_id: attemptId, error: error.message });
    return jsonError(cors, 500, "DB_ERROR", "Не удалось возобновить пробник. Попробуй ещё раз.");
  }

  console.info(JSON.stringify({
    event: "mock_exam_attempt_resumed",
    attempt_id: attemptId,
    sessions_count: sessions.length,
  }));

  return jsonOk(cors, {
    ok: true,
    attempt_id: attemptId,
    status: "in_progress",
  });
}

// ────────────────────────────────────────────────────────────────────────────
// PATCH /attempts/:id/answer  — auto-save Part 1 (debounced from client)
// ────────────────────────────────────────────────────────────────────────────

async function handleAutosaveAnswer(
  db: SupabaseClient,
  studentUserId: string,
  attemptId: string,
  body: unknown,
  cors: Record<string, string>,
): Promise<Response> {
  const ownedOrErr = await getOwnedAttemptOrThrow(db, attemptId, studentUserId, cors);
  if (ownedOrErr instanceof Response) return ownedOrErr;
  const attempt = ownedOrErr;

  if (attempt.status !== "in_progress") {
    return jsonError(cors, 409, "NOT_IN_PROGRESS",
      "Auto-save allowed only while attempt is in_progress");
  }

  if (!body || typeof body !== "object") {
    return jsonError(cors, 400, "INVALID_BODY", "Body must be JSON object");
  }
  const b = body as Record<string, unknown>;
  if (!isPositiveInt(b.kim_number)) {
    return jsonError(cors, 400, "VALIDATION", "kim_number must be a positive integer");
  }
  // student_answer can be empty string (to clear), but must be a string or null.
  if (b.answer !== null && typeof b.answer !== "string") {
    return jsonError(cors, 400, "VALIDATION", "answer must be string or null");
  }
  if (typeof b.answer === "string" && b.answer.length > 5000) {
    return jsonError(cors, 400, "VALIDATION", "answer too long");
  }

  // Upsert — debounced auto-save semantics. earned_score deliberately NULL
  // here; calculated only on submit (single source of truth = checker).
  // TASK-16-R2 fix #1: score_source='student_form' помечает provenance row'ов
  // form-mode autosave (даже когда earned_score=null до submit). На submit
  // checker upsert'ит то же row с earned_score=N, score_source остаётся.
  const { error } = await db
    .from("mock_exam_attempt_part1_answers")
    .upsert(
      {
        attempt_id: attemptId,
        kim_number: b.kim_number,
        student_answer: typeof b.answer === "string" ? b.answer : null,
        earned_score: null,
        score_source: "student_form",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "attempt_id,kim_number" },
    );
  if (error) {
    console.error("mock_exam_autosave_failed", {
      attempt_id: attemptId,
      kim: b.kim_number,
      error: error.message,
    });
    return jsonError(cors, 500, "DB_ERROR", "Failed to save answer");
  }

  return jsonOk(cors, {
    ok: true,
    attempt_id: attemptId,
    kim_number: b.kim_number,
    saved_at: new Date().toISOString(),
  });
}

// ────────────────────────────────────────────────────────────────────────────
// POST /attempts/:id/photo  — upload Part 2 photo (or blank photo)
// ────────────────────────────────────────────────────────────────────────────

async function handleUploadPhoto(
  db: SupabaseClient,
  studentUserId: string,
  attemptId: string,
  req: Request,
  cors: Record<string, string>,
): Promise<Response> {
  const ownedOrErr = await getOwnedAttemptOrThrow(db, attemptId, studentUserId, cors);
  if (ownedOrErr instanceof Response) return ownedOrErr;
  const attempt = ownedOrErr;

  if (attempt.status !== "in_progress") {
    return jsonError(cors, 409, "NOT_IN_PROGRESS", "Upload allowed only while in_progress");
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return jsonError(cors, 400, "INVALID_BODY", "Expected multipart/form-data");
  }

  const file = formData.get("file");
  const kindRaw = formData.get("kind");
  const kimRaw = formData.get("kim_number");

  if (!(file instanceof File)) {
    return jsonError(cors, 400, "VALIDATION", "field 'file' must be a File");
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return jsonError(cors, 413, "FILE_TOO_LARGE",
      `File exceeds ${MAX_PHOTO_BYTES / (1024 * 1024)} MB limit`);
  }
  if (!ALLOWED_PHOTO_MIME.has(file.type)) {
    return jsonError(cors, 400, "INVALID_MIME", `MIME type ${file.type} not allowed`);
  }

  const kind = typeof kindRaw === "string" ? kindRaw : "part2";
  // kinds:
  //   'blank'           — фото ФИПИ-бланка → attempt.blank_photo_url (single)
  //   'part1_fallback'  — фото Часть 1 «не на ФИПИ бланке» → attempt.part1_blank_photo_url (single)
  //   'part2'           — фото per-task Часть 2 → mock_exam_attempt_part2_solutions.photo_url (per kim)
  //   'part2_bulk'      — фото общий пак Часть 2 → attempt.part2_bulk_photo_urls (dual-format, до 7)
  if (kind !== "part2" && kind !== "blank" && kind !== "part1_fallback" && kind !== "part2_bulk") {
    return jsonError(cors, 400, "VALIDATION",
      "kind must be 'part2' | 'blank' | 'part1_fallback' | 'part2_bulk'");
  }

  const ext = inferExtension(file.type, "jpg");
  const fileId = crypto.randomUUID();

  let bucket: string;
  let path: string;
  let kimNumber: number | null = null;

  if (kind === "blank") {
    bucket = BLANK_PHOTO_BUCKET;
    path = `${studentUserId}/${attemptId}/blank-${fileId}.${ext}`;
  } else if (kind === "part1_fallback") {
    bucket = BLANK_PHOTO_BUCKET;
    path = `${studentUserId}/${attemptId}/part1-fallback-${fileId}.${ext}`;
  } else if (kind === "part2_bulk") {
    bucket = PART2_PHOTO_BUCKET;
    path = `${studentUserId}/${attemptId}/bulk/${fileId}.${ext}`;
  } else {
    if (!kimRaw || typeof kimRaw !== "string" || !/^\d+$/.test(kimRaw)) {
      return jsonError(cors, 400, "VALIDATION", "kim_number is required for kind='part2'");
    }
    kimNumber = Number.parseInt(kimRaw, 10);
    if (!isPositiveInt(kimNumber)) {
      return jsonError(cors, 400, "VALIDATION", "kim_number must be positive int");
    }
    bucket = PART2_PHOTO_BUCKET;
    path = `${studentUserId}/${attemptId}/${kimNumber}/${fileId}.${ext}`;
  }

  const arrayBuffer = await file.arrayBuffer();
  const { error: uploadErr } = await db.storage
    .from(bucket)
    .upload(path, new Uint8Array(arrayBuffer), {
      contentType: file.type,
      upsert: false,
    });
  if (uploadErr) {
    console.error("mock_exam_photo_upload_failed", { error: uploadErr.message });
    return jsonError(cors, 500, "STORAGE_ERROR", "Failed to upload photo");
  }

  const ref = toStorageRef(bucket, path);

  // Persist ref into the canonical column per kind.
  // 2026-06-01: raised 7 → 10 (Часть 2 = 6 задач, решения многостраничные).
  // Frontend MAX_BULK_PART2_PHOTOS (StudentMockExam.tsx) держит тот же лимит.
  const MAX_PART2_BULK_PHOTOS = 10;
  if (kind === "blank") {
    const { error } = await db
      .from("mock_exam_attempts")
      .update({ blank_photo_url: ref })
      .eq("id", attemptId)
      .eq("student_id", studentUserId);
    if (error) return jsonError(cors, 500, "DB_ERROR", "Failed to persist blank photo");
  } else if (kind === "part1_fallback") {
    const { error } = await db
      .from("mock_exam_attempts")
      .update({ part1_blank_photo_url: ref })
      .eq("id", attemptId)
      .eq("student_id", studentUserId);
    if (error) return jsonError(cors, 500, "DB_ERROR", "Failed to persist part1 fallback photo");
  } else if (kind === "part2_bulk") {
    // CAS retry append to dual-format refs (max 7). Two concurrent uploads
    // would both READ the same value and the later UPDATE would clobber the
    // earlier — race documented в ChatGPT-5.5 code review (TASK-15 fix).
    // Solution: read RAW value, append, UPDATE WHERE part2_bulk_photo_urls
    // IS [original raw value]. Retry up to 3 times on 0-rows-affected.
    // On final failure, rollback storage object to avoid orphans.
    const MAX_CAS_RETRIES = 3;
    let success = false;
    let lastErr: string | null = null;
    for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt++) {
      const { data: cur, error: readErr } = await db
        .from("mock_exam_attempts")
        .select("part2_bulk_photo_urls")
        .eq("id", attemptId)
        .eq("student_id", studentUserId)
        .maybeSingle();
      if (readErr) {
        lastErr = readErr.message;
        break;
      }
      const rawCurrent = (cur?.part2_bulk_photo_urls as string | null) ?? null;
      const existing: string[] = (() => {
        if (!rawCurrent) return [];
        const trimmed = rawCurrent.trim();
        if (!trimmed) return [];
        if (trimmed.startsWith("[")) {
          try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) {
              return parsed.filter((x): x is string => typeof x === "string" && x.length > 0);
            }
          } catch { /* corrupted → treat as empty */ }
          return [];
        }
        return [trimmed];
      })();
      if (existing.length >= MAX_PART2_BULK_PHOTOS) {
        // Limit reached — rollback uploaded storage object to avoid orphan.
        await db.storage.from(bucket).remove([path]).catch(() => null);
        return jsonError(cors, 409, "BULK_LIMIT_REACHED",
          `Bulk Part 2 photos limit reached (${MAX_PART2_BULK_PHOTOS}). Удали лишнее перед загрузкой.`);
      }
      const next = [...existing, ref];
      const serialized = next.length === 1 ? next[0] : JSON.stringify(next);
      // CAS: UPDATE only if column still matches rawCurrent (no concurrent
      // writer slipped in between our SELECT and this UPDATE).
      const updateQuery = db
        .from("mock_exam_attempts")
        .update({ part2_bulk_photo_urls: serialized })
        .eq("id", attemptId)
        .eq("student_id", studentUserId);
      const casQuery = rawCurrent === null
        ? updateQuery.is("part2_bulk_photo_urls", null)
        : updateQuery.eq("part2_bulk_photo_urls", rawCurrent);
      const { data: updated, error: updateErr } = await casQuery
        .select("id");
      if (updateErr) {
        lastErr = updateErr.message;
        break;
      }
      if (updated && updated.length > 0) {
        success = true;
        break;
      }
      // 0 rows affected → another writer slipped in. Retry loop.
      console.warn("mock_exam_bulk_cas_retry", { attempt, attempt_id: attemptId });
    }
    if (!success) {
      // Rollback uploaded blob to avoid storage orphan after persistence failure.
      await db.storage.from(bucket).remove([path]).catch(() => null);
      console.error("mock_exam_bulk_persist_failed", { last_error: lastErr });
      return jsonError(cors, 500, "DB_ERROR",
        "Не удалось сохранить фото пакета. Попробуй ещё раз.");
    }
  } else {
    const { error } = await db
      .from("mock_exam_attempt_part2_solutions")
      .upsert(
        {
          attempt_id: attemptId,
          kim_number: kimNumber,
          photo_url: ref,
          status: "awaiting_review",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "attempt_id,kim_number" },
      );
    if (error) {
      console.error("mock_exam_part2_persist_failed", { error: error.message });
      return jsonError(cors, 500, "DB_ERROR", "Failed to persist part2 photo");
    }
  }

  const signed = await resolveSignedUrl(db, ref);

  return jsonOk(cors, {
    ok: true,
    attempt_id: attemptId,
    kind,
    kim_number: kimNumber,
    storage_ref: ref,
    signed_url: signed,
  }, 201);
}

// ────────────────────────────────────────────────────────────────────────────
// POST /attempts/:id/photo/delete  — remove one bulk Часть 2 photo by index
// ────────────────────────────────────────────────────────────────────────────
//
// 2026-06-02 (Вадим/Елена pilot): ученики не могли удалить лишнее фото Части 2 —
// delete-функции не существовало вовсе. Удаление по ИНДЕКСУ безопасно: загрузка
// append-only (`[...existing, ref]`), поэтому индексы 0..N-1 стабильны при
// параллельных upload'ах; только параллельные delete (один ученик из двух
// вкладок). Удаление по ИДЕНТИЧНОСТИ (storage path), не по индексу:
// (1) индекс небезопасен при параллельных delete (retry применил бы устаревший
//     индекс к изменившемуся массиву); (2) GET фильтрует не-подписавшиеся URL,
//     поэтому UI-индекс может не совпадать со stored-индексом. Match по path
//     устойчив к обоим. CAS-цикл re-матчит по path на каждой итерации.
async function handleDeleteBulkPhoto(
  db: SupabaseClient,
  studentUserId: string,
  attemptId: string,
  body: unknown,
  cors: Record<string, string>,
): Promise<Response> {
  const ownedOrErr = await getOwnedAttemptOrThrow(db, attemptId, studentUserId, cors);
  if (ownedOrErr instanceof Response) return ownedOrErr;

  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (b.kind !== "part2_bulk") {
    return jsonError(cors, 400, "VALIDATION", "kind must be 'part2_bulk'");
  }
  // Клиент шлёт `photo_url` — подписанный URL который он рендерит (или сырой
  // `storage://` ref из upload-ответа). Нормализуем обе формы к {bucket, path}.
  const photoUrl = b.photo_url;
  if (typeof photoUrl !== "string" || photoUrl.trim() === "") {
    return jsonError(cors, 400, "VALIDATION", "photo_url must be a non-empty string");
  }
  const target = (() => {
    const direct = parseStorageRef(photoUrl);
    if (direct) return direct;
    // .../storage/v1/object/sign/<bucket>/<path>?token=...
    const m = photoUrl.match(/\/storage\/v1\/object\/sign\/([^/]+)\/([^?]+)/);
    if (!m) return null;
    try {
      return { bucket: m[1], path: decodeURIComponent(m[2]) };
    } catch {
      return { bucket: m[1], path: m[2] };
    }
  })();
  if (!target) {
    return jsonError(cors, 400, "VALIDATION", "photo_url is not a recognizable storage URL");
  }
  const sameRef = (ref: string): boolean => {
    const p = parseStorageRef(ref);
    return !!p && p.bucket === target.bucket && p.path === target.path;
  };

  const parseBulk = (raw: string | null): string[] => {
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
  };

  const MAX_CAS_RETRIES = 3;
  let removedRef: string | null = null;
  let remaining = 0;
  let lastErr: string | null = null;
  let success = false;

  for (let attemptNo = 0; attemptNo < MAX_CAS_RETRIES; attemptNo++) {
    const { data: cur, error: readErr } = await db
      .from("mock_exam_attempts")
      .select("part2_bulk_photo_urls, status")
      .eq("id", attemptId)
      .eq("student_id", studentUserId)
      .maybeSingle();
    if (readErr) { lastErr = readErr.message; break; }

    // Status drift guard (P1 fix): submit может перевести attempt в 'submitted'
    // между ownership-check и UPDATE. Удалять из сданной работы нельзя (грейдер
    // уже стартовал по этим фото) → 409. Также явный guard в CAS ниже.
    const curStatus = (cur?.status as string | null) ?? null;
    if (curStatus !== "in_progress") {
      return jsonError(cors, 409, "NOT_IN_PROGRESS",
        "Удаление фото доступно только пока работа не сдана");
    }

    const rawCurrent = (cur?.part2_bulk_photo_urls as string | null) ?? null;
    const existing = parseBulk(rawCurrent);
    const matchIdx = existing.findIndex(sameRef);
    if (matchIdx === -1) {
      // Фото уже удалено (или never existed) — idempotent-friendly сигнал.
      return jsonError(cors, 409, "PHOTO_ALREADY_REMOVED",
        "Это фото уже удалено — обнови страницу");
    }

    const ref = existing[matchIdx];
    const next = existing.filter((_, i) => i !== matchIdx);
    const serialized = next.length === 0
      ? null
      : next.length === 1 ? next[0] : JSON.stringify(next);

    // CAS: UPDATE только если колонка всё ещё равна rawCurrent И статус всё ещё
    // in_progress (никакой concurrent writer / submit не вклинился).
    const updateQuery = db
      .from("mock_exam_attempts")
      .update({ part2_bulk_photo_urls: serialized })
      .eq("id", attemptId)
      .eq("student_id", studentUserId)
      .eq("status", "in_progress");
    const casQuery = rawCurrent === null
      ? updateQuery.is("part2_bulk_photo_urls", null)
      : updateQuery.eq("part2_bulk_photo_urls", rawCurrent);
    const { data: updated, error: updateErr } = await casQuery.select("id");
    if (updateErr) { lastErr = updateErr.message; break; }
    if (updated && updated.length > 0) {
      removedRef = ref;
      remaining = next.length;
      success = true;
      break;
    }
    // 0 rows → concurrent writer изменил массив ИЛИ статус сдвинулся. Re-read:
    // следующая итерация поймает status drift (→ 409) или re-матчит ref.
    console.warn("mock_exam_bulk_delete_cas_retry", { attempt: attemptNo, attempt_id: attemptId });
  }

  if (!success) {
    console.error("mock_exam_bulk_delete_failed", { last_error: lastErr });
    return jsonError(cors, 500, "DB_ERROR",
      "Не удалось удалить фото. Попробуй ещё раз.");
  }

  // Удаляем blob из storage — best-effort (как rollback в upload). Сбой не
  // фатален: ссылка из БД уже убрана, ученик не увидит фото; orphan-blob
  // вторичен (rule 50 order: сначала очищаем ref в БД, потом storage).
  const parsed = parseStorageRef(removedRef);
  if (parsed) {
    await db.storage.from(parsed.bucket).remove([parsed.path]).catch(() => null);
  }

  return jsonOk(cors, {
    ok: true,
    attempt_id: attemptId,
    removed_ref: removedRef,
    remaining,
  });
}

// ────────────────────────────────────────────────────────────────────────────
// POST /attempts/:id/submit
// ────────────────────────────────────────────────────────────────────────────

async function handleSubmitAttempt(
  db: SupabaseClient,
  studentUserId: string,
  attemptId: string,
  cors: Record<string, string>,
): Promise<Response> {
  const ownedOrErr = await getOwnedAttemptOrThrow(db, attemptId, studentUserId, cors);
  if (ownedOrErr instanceof Response) return ownedOrErr;
  const attempt = ownedOrErr;

  // AC-P10 (2026-05-25): allow submit из 'in_progress' AND 'paused'. Ученик
  // может нажать «Сдать» прямо из list-card paused state без обязательного
  // resume → submit. Backend закрывает session как при resume → submit chain.
  if (attempt.status !== "in_progress" && attempt.status !== "paused") {
    return jsonError(cors, 409, "NOT_IN_PROGRESS",
      `Нельзя сдать пробник со статусом «${attempt.status}»`);
  }

  // Per-attempt answer method (TASK-10/TASK-11). Default fallback 'form' для
  // legacy attempts без явного выбора (старые pilot rows backfilled из
  // assignment.mode, но если NULL — считаем form чтобы не блокировать submit).
  const answerMethod: "blank" | "form" =
    (attempt.answer_method as "blank" | "form" | null) ?? "form";
  const shouldAutoCheckPart1 = answerMethod === "form";

  // Blank mode validation: должен быть хотя бы одно фото бланка (ФИПИ или
  // fallback). Иначе tutor нечего проверять — soft-блокируем submit.
  if (answerMethod === "blank") {
    const hasFipiBlank = (attempt.blank_photo_url as string | null) !== null
      && (attempt.blank_photo_url as string | null) !== "";
    const hasFallback = (attempt.part1_blank_photo_url as string | null) !== null
      && (attempt.part1_blank_photo_url as string | null) !== "";
    if (!hasFipiBlank && !hasFallback) {
      return jsonError(cors, 400, "NO_BLANK_PHOTO",
        "В режиме бланка нужно загрузить хотя бы одно фото — ФИПИ-бланк или фото ответов Часть 1.");
    }
  }

  // Load assignment to find variant.
  const { data: assignment } = await db
    .from("mock_exam_assignments")
    .select("id, variant_id, mode")
    .eq("id", attempt.assignment_id as string)
    .maybeSingle();
  if (!assignment?.variant_id) {
    return jsonError(cors, 400, "INVALID_STATE", "Assignment has no variant — cannot grade");
  }
  if (assignment.mode === "manual_entry") {
    return jsonError(cors, 400, "INVALID_MODE", "Manual entry attempts cannot be submitted");
  }

  // Fetch ALL variant tasks (with correct_answer — server-side only).
  const { data: variantTasks, error: tasksErr } = await db
    .from("mock_exam_variant_tasks")
    .select("kim_number, part, correct_answer, check_mode, max_score")
    .eq("variant_id", assignment.variant_id as string);
  if (tasksErr || !variantTasks) {
    return jsonError(cors, 500, "DB_ERROR", "Failed to load variant tasks");
  }

  // Fetch student's part1 answers.
  const { data: part1Rows } = await db
    .from("mock_exam_attempt_part1_answers")
    .select("kim_number, student_answer")
    .eq("attempt_id", attemptId);

  const part1ByKim: Record<number, string | null> = {};
  for (const row of part1Rows ?? []) {
    part1ByKim[row.kim_number as number] = row.student_answer as string | null;
  }

  // Run deterministic checker per part1 task ТОЛЬКО для form-режима.
  // В blank-режиме ученик отвечал на ФИПИ бланке от руки — auto-check
  // невозможен (Phase 3 = AI OCR). Tutor поставит баллы вручную через
  // `/part1-manual-score` endpoint (см. mock-exam-tutor-api).
  let totalPart1: number | null = 0;
  const part1Updates: Array<{
    attempt_id: string;
    kim_number: number;
    student_answer: string | null;
    earned_score: number;
    score_source: "student_form";
    updated_at: string;
  }> = [];
  const now = new Date().toISOString();

  const part1Tasks = variantTasks.filter((t) => t.part === 1);
  const part2Tasks = variantTasks.filter((t) => t.part === 2);

  if (shouldAutoCheckPart1) {
    for (const task of part1Tasks) {
      const studentAns = part1ByKim[task.kim_number as number] ?? null;
      const result = checkPart1(
        task.correct_answer as string | null,
        studentAns,
        task.check_mode as CheckMode | null,
        task.max_score as number,
        task.kim_number as number,
      );
      totalPart1 += result.earned;
      part1Updates.push({
        attempt_id: attemptId,
        kim_number: task.kim_number as number,
        student_answer: studentAns,
        earned_score: result.earned,
        // TASK-16-R2 fix #1: provenance — student form-mode auto-check.
        score_source: "student_form",
        updated_at: now,
      });
    }

    if (part1Updates.length > 0) {
      const { error: upsertErr } = await db
        .from("mock_exam_attempt_part1_answers")
        .upsert(part1Updates, { onConflict: "attempt_id,kim_number" });
      if (upsertErr) {
        console.error("mock_exam_submit_part1_upsert_failed", { error: upsertErr.message });
        return jsonError(cors, 500, "DB_ERROR", "Failed to persist part1 scores");
      }
    }
  } else {
    // Blank-режим: totalPart1 = null означает «требует ручной проверки тутора».
    // НЕ путать с 0 (auto-check вернул нули). Tutor увидит фото бланка и
    // введёт баллы по KIM через manual scoring endpoint.
    totalPart1 = null;
  }

  // Ensure pending records exist for every Часть 2 task. Photo refs already
  // populated via /photo upload — здесь только заполняем недостающие placeholder
  // строки чтобы AI grading edge function (TASK-5) их подхватил.
  const { data: existingPart2 } = await db
    .from("mock_exam_attempt_part2_solutions")
    .select("kim_number")
    .eq("attempt_id", attemptId);
  const existingKims = new Set(
    (existingPart2 ?? []).map((r) => r.kim_number as number),
  );

  const missingPart2 = part2Tasks
    .filter((t) => !existingKims.has(t.kim_number as number))
    .map((t) => ({
      attempt_id: attemptId,
      kim_number: t.kim_number as number,
      photo_url: null,
      ai_draft_json: null,
      status: "awaiting_review" as const,
      updated_at: now,
    }));

  if (missingPart2.length > 0) {
    const { error: insertErr } = await db
      .from("mock_exam_attempt_part2_solutions")
      .insert(missingPart2);
    if (insertErr) {
      console.error("mock_exam_submit_part2_insert_failed", { error: insertErr.message });
      // Non-fatal — tutor может загрузить позже; продолжаем.
    }
  }

  // AC-P10 (2026-05-25): close last open session if status was in_progress.
  // Compute final total_active_ms (sum of session durations).
  // For simulation mode — total_time_minutes остаётся wall-clock (как раньше),
  // т.к. simulation mode не использует pause: time spent == time on exam.
  const finalSessions = Array.isArray(attempt.sessions) ? [...attempt.sessions] : [];
  if (finalSessions.length > 0) {
    const lastIdx = finalSessions.length - 1;
    const last = finalSessions[lastIdx] as Record<string, unknown> | null;
    if (last && typeof last === "object" && last.ended_at === null) {
      finalSessions[lastIdx] = { ...last, ended_at: now };
    }
  }
  const finalTotalActiveMs = computeTotalActiveMs(finalSessions);

  // total_time_minutes — wall-clock от started_at (для backward compat + tutor
  // analytics). Для AC-P10: tutor дополнительно видит total_active_ms +
  // sessions detail в TutorMockExamReview.
  let totalTimeMinutes: number | null = null;
  if (attempt.started_at) {
    const startedMs = Date.parse(attempt.started_at as string);
    if (Number.isFinite(startedMs)) {
      const diffMs = Date.now() - startedMs;
      totalTimeMinutes = Math.max(1, Math.round(diffMs / 60_000));
    }
  }

  // Flip status → 'submitted' (queued for AI). submitted_at = now.
  //
  // TASK-OCR-1 (2026-05-21) P0 race fix: previously this handler set status
  // directly to 'ai_checking'. Combined with the BEFORE UPDATE trigger that
  // refreshes `updated_at`, the fresh `ai_checking` row caused mock-exam-grade
  // to treat it as «another grader already running» (ageMs < 120s stale-lock
  // threshold) and return 202 ALREADY_GRADING — grading never started.
  //
  // Canonical state-machine: in_progress → submitted → ai_checking →
  //   awaiting_review → approved. submit handler leaves attempt in `submitted`;
  // mock-exam-grade::handleGrade does the CAS-claim submitted → ai_checking
  // (line ~1242 in mock-exam-grade/index.ts). This restores the dependency-
  // free hand-off and removes the race.
  //
  // See: docs/delivery/features/mock-exams-v1-pilot-polish/ocr-grading-recovery-spec.md
  // AC-P10: include sessions + total_active_ms в UPDATE. CAS guard теперь
  // принимает оба ('in_progress' OR 'paused') — submit allowed from either state.
  const { error: updateErr } = await db
    .from("mock_exam_attempts")
    .update({
      status: "submitted",
      submitted_at: now,
      total_time_minutes: totalTimeMinutes,
      total_part1_score: totalPart1,
      sessions: finalSessions,
      total_active_ms: finalTotalActiveMs,
    })
    .eq("id", attemptId)
    .eq("student_id", studentUserId)
    .in("status", ["in_progress", "paused"]); // CAS: prev status
  if (updateErr) {
    console.error("mock_exam_submit_status_update_failed", { error: updateErr.message });
    return jsonError(cors, 500, "DB_ERROR", "Не удалось завершить отправку. Попробуй ещё раз.");
  }

  // Fire-and-forget AI grading job (TASK-5 — edge function `mock-exam-grade`).
  // Если функция ещё не задеплоена — запрос свалится молча, и tutor сможет
  // вручную перезапустить grading позже. Не блокируем submit.
  try {
    fetch(`${SUPABASE_URL}/functions/v1/mock-exam-grade`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: SUPABASE_SERVICE_ROLE_KEY,
      },
      body: JSON.stringify({ attempt_id: attemptId }),
    }).catch((err) => {
      console.warn("mock_exam_grade_enqueue_failed", { error: String(err) });
    });
  } catch (err) {
    console.warn("mock_exam_grade_enqueue_throw", { error: String(err) });
  }

  return jsonOk(cors, {
    ok: true,
    attempt_id: attemptId,
    // TASK-OCR-1: report queued status to client. Grader will CAS-claim
    // submitted → ai_checking → awaiting_review. Frontend's /result page
    // (handleGetResult) accepts both 'submitted' и 'ai_checking' as
    // "AI is working" UI state.
    status: "submitted",
    answer_method: answerMethod,
    auto_checked_part1: shouldAutoCheckPart1,
    total_part1_score: totalPart1,
    part1_max: part1Tasks.reduce((acc, t) => acc + (t.max_score as number), 0),
    submitted_at: now,
  });
}

// ────────────────────────────────────────────────────────────────────────────
// POST /attempts/:id/answer-method  — set student's choice (blank | form)
// ────────────────────────────────────────────────────────────────────────────
//
// Per-attempt choice (NOT assignment.mode). Ученик может переключаться в любой
// момент пока status='in_progress'. Данные обоих режимов сохраняются
// параллельно — submit берёт по финальному answer_method.

async function handleSetAnswerMethod(
  db: SupabaseClient,
  studentUserId: string,
  attemptId: string,
  body: unknown,
  cors: Record<string, string>,
): Promise<Response> {
  const ownedOrErr = await getOwnedAttemptOrThrow(db, attemptId, studentUserId, cors);
  if (ownedOrErr instanceof Response) return ownedOrErr;
  const attempt = ownedOrErr;

  if (attempt.status !== "in_progress") {
    return jsonError(cors, 409, "NOT_IN_PROGRESS",
      `Cannot change answer_method when status=${attempt.status}`);
  }

  const b = body as Record<string, unknown> | null;
  const method = b?.method ?? b?.answer_method;
  if (method !== "blank" && method !== "form") {
    return jsonError(cors, 400, "VALIDATION", "method must be 'blank' or 'form'");
  }

  const { error } = await db
    .from("mock_exam_attempts")
    .update({ answer_method: method })
    .eq("id", attemptId)
    .eq("student_id", studentUserId);
  if (error) {
    console.error("mock_exam_set_answer_method_failed", {
      attempt_id: attemptId,
      error: error.message,
    });
    return jsonError(cors, 500, "DB_ERROR", "Failed to persist answer method");
  }

  return jsonOk(cors, {
    ok: true,
    attempt_id: attemptId,
    answer_method: method,
  });
}

// ─── Server ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  const cors = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: cors });
  }

  const route = parseRoute(req);
  const startTime = Date.now();
  console.log("mock_exam_student_request_start", {
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

    // GET /student/:id/result  — state-aware result view (TASK-13)
    if (
      seg.length === 3 && seg[0] === "student" &&
      seg[2] === "result" && route.method === "GET"
    ) {
      return await handleGetResult(db, userId, seg[1], cors);
    }

    // GET /student/:id
    if (seg.length === 2 && seg[0] === "student" && route.method === "GET") {
      return await handleGetStudentAssignment(db, userId, seg[1], cors);
    }

    // POST /attempts/:id/start
    if (
      seg.length === 3 && seg[0] === "attempts" &&
      seg[2] === "start" && route.method === "POST"
    ) {
      const body = await parseJsonBody(req);
      return await handleStartAttempt(db, userId, seg[1], body, cors);
    }

    // POST /attempts/:id/pause  (AC-P10, 2026-05-25 — Training mode multi-session)
    if (
      seg.length === 3 && seg[0] === "attempts" &&
      seg[2] === "pause" && route.method === "POST"
    ) {
      return await handlePauseAttempt(db, userId, seg[1], cors);
    }

    // POST /attempts/:id/resume  (AC-P10)
    if (
      seg.length === 3 && seg[0] === "attempts" &&
      seg[2] === "resume" && route.method === "POST"
    ) {
      return await handleResumeAttempt(db, userId, seg[1], cors);
    }

    // PATCH /attempts/:id/answer
    if (
      seg.length === 3 && seg[0] === "attempts" &&
      seg[2] === "answer" && route.method === "PATCH"
    ) {
      const body = await parseJsonBody(req);
      return await handleAutosaveAnswer(db, userId, seg[1], body, cors);
    }

    // POST /attempts/:id/photo
    if (
      seg.length === 3 && seg[0] === "attempts" &&
      seg[2] === "photo" && route.method === "POST"
    ) {
      return await handleUploadPhoto(db, userId, seg[1], req, cors);
    }

    // POST /attempts/:id/photo/delete  — remove one bulk Часть 2 photo by index
    if (
      seg.length === 4 && seg[0] === "attempts" &&
      seg[2] === "photo" && seg[3] === "delete" && route.method === "POST"
    ) {
      const body = await parseJsonBody(req);
      return await handleDeleteBulkPhoto(db, userId, seg[1], body, cors);
    }

    // POST /attempts/:id/submit
    if (
      seg.length === 3 && seg[0] === "attempts" &&
      seg[2] === "submit" && route.method === "POST"
    ) {
      return await handleSubmitAttempt(db, userId, seg[1], cors);
    }

    // POST /attempts/:id/answer-method
    if (
      seg.length === 3 && seg[0] === "attempts" &&
      seg[2] === "answer-method" && route.method === "POST"
    ) {
      const body = await parseJsonBody(req);
      return await handleSetAnswerMethod(db, userId, seg[1], body, cors);
    }

    return jsonError(cors, 404, "NOT_FOUND",
      `Route not found: ${route.method} /${seg.join("/")}`);
  } catch (err) {
    const elapsed = Date.now() - startTime;
    console.error("mock_exam_student_request_error", {
      error: String(err),
      elapsed_ms: elapsed,
    });
    return jsonError(cors, 500, "INTERNAL_ERROR", "Internal server error");
  }
});
