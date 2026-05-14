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

// ─── Deterministic Part 1 checker (Deno mirror of src/lib/mockExamPart1Checker.ts) ──
//
// Канонический источник: src/lib/mockExamPart1Checker.ts (с unit-тестами в
// scripts/test-mockexam-checker.mjs). Этот файл — Deno-mirror без import-ов
// (Supabase Edge Functions не разрешают cross-file relative imports выше
// `_shared/`). Любое изменение логики ОБЯЗАНО синхронно править оба файла.

type CheckMode =
  | "strict" | "ordered" | "unordered" | "multi_choice"
  | "task20" | "pair" | "manual";

function normalizeBasic(s: string): string {
  // \s+ matches non-breaking space (U+00A0) too — JS regex spec.
  return s.replace(/\s+/g, "").trim();
}

function normalizeNumber(s: string): number | null {
  const cleaned = s.replace(/\s+/g, "").replace(/,/g, ".");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function numbersEqual(expected: number, actual: number): boolean {
  if (Number.isInteger(expected) && Number.isInteger(actual)) return expected === actual;
  const tol = Math.max(0.01, Math.abs(expected) * 0.01);
  return Math.abs(expected - actual) <= tol;
}

// F3 (mock-exams-v1-pilot-polish AC-P3) — numeric tolerance for strict mode.
// Mirror of src/lib/mockExamPart1Checker.ts::numericRoundingMatch /
// countDecimals. Любое изменение логики — синхронно править оба файла.
function countDecimals(s: string): number {
  const m = s.trim().match(/[.,](\d+)/);
  return m ? m[1].length : 0;
}

function numericRoundingMatch(student: string, correct: string): boolean | null {
  const studentNum = normalizeNumber(student);
  const correctNum = normalizeNumber(correct);
  if (studentNum === null || correctNum === null) return null;
  const scale = countDecimals(correct);
  const factor = 10 ** scale;
  const studentRounded = Math.round(studentNum * factor) / factor;
  return Math.abs(studentRounded - correctNum) < 1e-9;
}

function checkStrict(c: string, s: string): boolean {
  const a = normalizeBasic(c), b = normalizeBasic(s);
  if (!a || !b) return false;
  const na = normalizeNumber(a), nb = normalizeNumber(b);
  if (na !== null && nb !== null) return numbersEqual(na, nb);
  return a.toLowerCase() === b.toLowerCase();
}

function checkOrdered(c: string, s: string): boolean {
  const ac = normalizeBasic(c).split(",").map((x) => x.toLowerCase()).filter(Boolean);
  const as = normalizeBasic(s).split(",").map((x) => x.toLowerCase()).filter(Boolean);
  if (ac.length === 0 || ac.length !== as.length) return false;
  for (let i = 0; i < ac.length; i++) if (ac[i] !== as[i]) return false;
  return true;
}

function checkUnordered(c: string, s: string): boolean {
  const ac = normalizeBasic(c).split(",").map((x) => x.toLowerCase()).filter(Boolean);
  const as = normalizeBasic(s).split(",").map((x) => x.toLowerCase()).filter(Boolean);
  if (ac.length === 0 || ac.length !== as.length) return false;
  const sc = [...ac].sort(), ss = [...as].sort();
  for (let i = 0; i < sc.length; i++) if (sc[i] !== ss[i]) return false;
  return true;
}

function checkMultiChoice(c: string, s: string): boolean {
  const toSet = (raw: string): Set<string> => {
    const tokens = normalizeBasic(raw)
      .split(/[,;]/)
      .flatMap((part) => (/^\d+$/.test(part) ? part.split("") : [part]))
      .map((x) => x.toLowerCase())
      .filter(Boolean);
    return new Set(tokens);
  };
  const setC = toSet(c), setS = toSet(s);
  if (setC.size === 0 || setC.size !== setS.size) return false;
  for (const item of setC) if (!setS.has(item)) return false;
  return true;
}

function checkTask20(c: string, s: string): boolean {
  const onlyDigits = (r: string) => normalizeBasic(r).replace(/[,;.\s]/g, "").toLowerCase();
  const ac = onlyDigits(c), as = onlyDigits(s);
  if (!ac || !as) return false;
  if (!/^\d+$/.test(ac) || !/^\d+$/.test(as)) return false;
  return ac === as;
}

function checkPair(c: string, s: string): boolean {
  const compactMeasurement = (r: string): string =>
    r
      .replace(/\s+/g, "")
      .replace(/[()±;]/g, "")
      .replace(/[^\d,.-]/g, "")
      .replace(/\./g, ",");

  const compactCorrect = compactMeasurement(c);
  if (/^-?\d+,\d+,\d+$/.test(compactCorrect)) {
    return compactMeasurement(s) === compactCorrect;
  }

  const split = (r: string): { value: string; unit: string } | null => {
    const t = r.trim();
    if (!t) return null;
    if (t.includes(";")) {
      const [v, u] = t.split(";", 2);
      return { value: v.trim(), unit: u.trim() };
    }
    const m = t.match(/^(-?\d+(?:[.,]\d+)?)\s*(.+)$/);
    if (!m) return null;
    return { value: m[1].trim(), unit: m[2].trim() };
  };
  const pc = split(c), ps = split(s);
  if (!pc || !ps) return false;
  const cn = normalizeNumber(pc.value), sn = normalizeNumber(ps.value);
  if (cn === null || sn === null) return false;
  if (!numbersEqual(cn, sn)) return false;
  const norm = (u: string) => u.replace(/\s+/g, "").toLowerCase();
  return norm(pc.unit) === norm(ps.unit);
}

function checkPart1(
  correctAnswer: string | null | undefined,
  studentAnswer: string | null | undefined,
  checkMode: CheckMode | null | undefined,
  maxScore: number,
  kimNumber?: number,
): { earned: number; correct: boolean } {
  if (!studentAnswer || !correctAnswer || !checkMode || checkMode === "manual") {
    return { earned: 0, correct: false };
  }
  let ok = false;
  switch (checkMode) {
    case "strict":
      ok = checkStrict(correctAnswer, studentAnswer);
      // F3 fallback: rounding tolerance ONLY for strict.
      if (!ok) {
        const rounding = numericRoundingMatch(studentAnswer, correctAnswer);
        if (rounding === true) {
          console.info("[mock-exam-checker] numeric_rounding_match", {
            kim: kimNumber,
            student: studentAnswer,
            correct: correctAnswer,
            scale: countDecimals(correctAnswer),
          });
          ok = true;
        }
      }
      break;
    case "ordered": ok = checkOrdered(correctAnswer, studentAnswer); break;
    case "unordered": ok = checkUnordered(correctAnswer, studentAnswer); break;
    case "multi_choice": ok = checkMultiChoice(correctAnswer, studentAnswer); break;
    case "task20": ok = checkTask20(correctAnswer, studentAnswer); break;
    case "pair": ok = checkPair(correctAnswer, studentAnswer); break;
    default: ok = false;
  }
  return { earned: ok ? maxScore : 0, correct: ok };
}

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
  const ATTEMPT_SELECT =
    "id, assignment_id, status, started_at, submitted_at, blank_photo_url, " +
    "part1_blank_photo_url, part2_bulk_photo_urls, answer_method, " +
    "total_part1_score, total_part2_score, total_score";
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
    .select("id, variant_id, variant_title, title, mode, deadline, status")
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
        variant_pdf_url: variant.variant_pdf_url ?? null,
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
    "total_time_minutes, blank_photo_url, total_part1_score, " +
    "total_part2_score, total_score, manual_entered_date, manual_comment";
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

  // Block in_progress — result page is post-submit only.
  if (attempt.status === "in_progress") {
    return jsonError(
      cors,
      409,
      "NOT_SUBMITTED",
      "Attempt is still in progress",
      { status: "in_progress" },
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

  let variant: Record<string, unknown> | null = null;
  let variantTasksByKim: Record<number, Record<string, unknown>> = {};
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

    // Variant tasks WITH correct_answer + solution_text — server-side join
    // material. Каждое поле гейтится по статусу attempt'а ниже.
    const { data: variantTasks } = await db
      .from("mock_exam_variant_tasks")
      .select(
        "kim_number, part, order_num, task_text, task_image_url, " +
          "correct_answer, check_mode, max_score, solution_text, topic",
      )
      .eq("variant_id", assignment.variant_id as string)
      .order("order_num", { ascending: true });
    for (const t of variantTasks ?? []) {
      variantTasksByKim[t.kim_number as number] = t as Record<string, unknown>;
    }
  }

  const isApproved = attempt.status === "approved";
  const isManualEntered = attempt.status === "manually_entered";
  const isPostSubmit = !isManualEntered; // submitted | ai_checking | awaiting_review | approved

  // Part 1 — reveal post-submit. Manual_entered не имеет per-task records.
  let part1Answers: unknown[] = [];
  if (isPostSubmit) {
    const { data: part1Rows } = await db
      .from("mock_exam_attempt_part1_answers")
      .select("kim_number, student_answer, earned_score")
      .eq("attempt_id", attempt.id)
      .order("kim_number", { ascending: true });

    part1Answers = (part1Rows ?? []).map((row) => {
      const v = variantTasksByKim[row.kim_number as number];
      return {
        kim_number: row.kim_number,
        student_answer: row.student_answer,
        earned_score: row.earned_score,
        correct_answer: (v?.correct_answer as string | null) ?? null,
        max_score: (v?.max_score as number | undefined) ?? 0,
        check_mode: (v?.check_mode as string | null) ?? null,
      };
    });
  }

  // Part 2 — reveal ONLY when approved. Pre-approval: photo only (own upload),
  // no tutor_score / tutor_comment / solution_text / task_text. ai_draft_json
  // never exposed (tutor-only artifact).
  let part2Solutions: unknown[] = [];
  if (isPostSubmit) {
    const { data: part2Rows } = await db
      .from("mock_exam_attempt_part2_solutions")
      .select(
        isApproved
          ? "kim_number, photo_url, tutor_score, tutor_comment, status"
          : "kim_number, photo_url, status",
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
        if (isApproved) {
          // Resolve task image too — student sees task context post-approval.
          let taskImageSigned: string | null = null;
          const taskImageRef = (v?.task_image_url as string | null) ?? null;
          if (taskImageRef) {
            // Variant task images live in mock-exam-variant-tasks bucket;
            // use parseStorageRef which honours bucket prefix from ref.
            taskImageSigned = await resolveSignedUrl(db, taskImageRef);
          }
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
            topic: (v?.topic as string | null) ?? null,
          };
        }
        return {
          kim_number: row.kim_number,
          photo_url: photoSigned,
          status: row.status,
          max_score: (v?.max_score as number | undefined) ?? 0,
        };
      }),
    );
  }

  const blankPhotoSigned = await resolveSignedUrl(
    db,
    attempt.blank_photo_url as string | null,
  );

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
      total_part1_score: attempt.total_part1_score,
      total_part2_score: attempt.total_part2_score,
      total_score: attempt.total_score,
      manual_entered_date: attempt.manual_entered_date,
      manual_comment: attempt.manual_comment,
    },
    part1_answers: part1Answers,
    part2_solutions: part2Solutions,
  });
}

// ────────────────────────────────────────────────────────────────────────────
// POST /attempts/:id/start
// ────────────────────────────────────────────────────────────────────────────

async function handleStartAttempt(
  db: SupabaseClient,
  studentUserId: string,
  attemptId: string,
  cors: Record<string, string>,
): Promise<Response> {
  const ownedOrErr = await getOwnedAttemptOrThrow(db, attemptId, studentUserId, cors);
  if (ownedOrErr instanceof Response) return ownedOrErr;
  const attempt = ownedOrErr;

  if (attempt.status === "approved" || attempt.status === "manually_entered") {
    return jsonError(cors, 409, "ALREADY_FINAL", "Attempt is already finalized");
  }

  // Idempotent: only set started_at if NULL. Re-calling /start is safe — used
  // for "I just opened the exam tab again" recovery flow.
  if (!attempt.started_at) {
    const { error } = await db
      .from("mock_exam_attempts")
      .update({ started_at: new Date().toISOString() })
      .eq("id", attemptId)
      .eq("student_id", studentUserId)
      .eq("status", "in_progress");
    if (error) return jsonError(cors, 500, "DB_ERROR", "Failed to start attempt");
  }

  return jsonOk(cors, { ok: true, attempt_id: attemptId });
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
  const { error } = await db
    .from("mock_exam_attempt_part1_answers")
    .upsert(
      {
        attempt_id: attemptId,
        kim_number: b.kim_number,
        student_answer: typeof b.answer === "string" ? b.answer : null,
        earned_score: null,
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
  const MAX_PART2_BULK_PHOTOS = 7;
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
    // Append to existing dual-format refs (max 7). Re-read current value
    // to avoid stale-write under concurrent uploads.
    const { data: cur } = await db
      .from("mock_exam_attempts")
      .select("part2_bulk_photo_urls")
      .eq("id", attemptId)
      .eq("student_id", studentUserId)
      .maybeSingle();
    const existing: string[] = (() => {
      const raw = (cur?.part2_bulk_photo_urls as string | null) ?? null;
      if (!raw) return [];
      const trimmed = raw.trim();
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
      return jsonError(cors, 409, "BULK_LIMIT_REACHED",
        `Bulk Part 2 photos limit reached (${MAX_PART2_BULK_PHOTOS}). Удали лишнее перед загрузкой.`);
    }
    const next = [...existing, ref];
    const serialized = next.length === 1 ? next[0] : JSON.stringify(next);
    const { error } = await db
      .from("mock_exam_attempts")
      .update({ part2_bulk_photo_urls: serialized })
      .eq("id", attemptId)
      .eq("student_id", studentUserId);
    if (error) return jsonError(cors, 500, "DB_ERROR", "Failed to persist bulk Part 2 photo");
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

  if (attempt.status !== "in_progress") {
    return jsonError(cors, 409, "NOT_IN_PROGRESS",
      `Cannot submit attempt with status=${attempt.status}`);
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

  // Run deterministic checker per part1 task.
  let totalPart1 = 0;
  const part1Updates: Array<{
    attempt_id: string;
    kim_number: number;
    student_answer: string | null;
    earned_score: number;
    updated_at: string;
  }> = [];
  const now = new Date().toISOString();

  const part1Tasks = variantTasks.filter((t) => t.part === 1);
  const part2Tasks = variantTasks.filter((t) => t.part === 2);

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

  // Compute total_time_minutes from started_at.
  let totalTimeMinutes: number | null = null;
  if (attempt.started_at) {
    const startedMs = Date.parse(attempt.started_at as string);
    if (Number.isFinite(startedMs)) {
      const diffMs = Date.now() - startedMs;
      totalTimeMinutes = Math.max(1, Math.round(diffMs / 60_000));
    }
  }

  // Flip status → ai_checking. submitted_at = now.
  const { error: updateErr } = await db
    .from("mock_exam_attempts")
    .update({
      status: "ai_checking",
      submitted_at: now,
      total_time_minutes: totalTimeMinutes,
      total_part1_score: totalPart1,
    })
    .eq("id", attemptId)
    .eq("student_id", studentUserId);
  if (updateErr) {
    console.error("mock_exam_submit_status_update_failed", { error: updateErr.message });
    return jsonError(cors, 500, "DB_ERROR", "Failed to finalize submission");
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
    status: "ai_checking",
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
      return await handleStartAttempt(db, userId, seg[1], cors);
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
