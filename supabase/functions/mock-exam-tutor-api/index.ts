// Redeploy trigger 2026-06-08: form-mode Часть-1 derive-on-read
// (`student_answer ?? OCR`, handleGetAttempt) уже КОРРЕКТЕН в коде — на проде
// репетитор видел «без ответа» из-за STALE edge-функции (деплой через Lovable
// на push, не deploy-sokratai). Этот no-op комментарий гарантирует редеплой при
// push. Логику НЕ меняет. См. rule 45 «Результат пробника … 2026-06-08».
//
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
import { checkPart1, type CheckMode } from "../_shared/mock-exam-part1-checker.ts";
import { parseAttachmentUrls } from "../_shared/attachment-refs.ts";
import { SUBJECT_IDS } from "../_shared/subjects.generated.ts";

// ─── Constants ───────────────────────────────────────────────────────────────

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:support@sokratai.ru";

const VALID_MODES = ["blank", "form", "manual_entry"] as const;

// ─── Фаза 2 (2026-07-20): репетиторские варианты ────────────────────────────
// Канонический словарь предметов — из СГЕНЕРИРОВАННОГО зеркала единого реестра
// (`src/lib/subjects/registry.ts` → `_shared/subjects.generated.ts`, 2026-07-23).
// Ручная копия здесь была ещё одним источником дрейфа: добавленный в реестр
// предмет молча не проходил бы валидацию вариантов пробника.
// Легаси-id намеренно НЕ принимаем — варианты пробников новые, легаси-значений
// в `mock_exam_variants.subject` не существует (зеркало его CHECK'а).
const VALID_VARIANT_SUBJECTS = new Set<string>(SUBJECT_IDS);
// Часть 1 — режимы детерминированного чекера (без 'manual' — тот для Части 2).
const VALID_PART1_CHECK_MODES = new Set([
  "strict", "ordered", "ordered_lenient", "unordered", "multi_choice",
  "multi_choice_strict", "task20", "pair",
]);
const VARIANT_TASKS_MAX = 60;
const VARIANT_TITLE_MAX = 200;
const VARIANT_TASK_TEXT_MAX = 8000;
const VARIANT_ANSWER_MAX = 500;
const VARIANT_SOLUTION_MAX = 12000;
const VARIANT_DURATION_MAX_MIN = 600;
// Бакеты, из которых личный вариант может ссылаться на картинки:
// kb-attachments — клиентские загрузки (строго own-namespace {userId}/...),
// mock-exam-variant-tasks — каталожный контент (копии при duplicate).
const VARIANT_IMAGE_BUCKETS = new Set(["kb-attachments", "mock-exam-variant-tasks"]);

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
  /** Фаза 2: NULL = каталожный; non-NULL = личный вариант репетитора. */
  owner_id: string | null;
  /** Канонический id предмета; NULL у легаси-строк → читатели берут 'physics'. */
  subject: string | null;
}

async function getVariantOrThrow(
  db: SupabaseClient,
  variantId: string,
  cors: Record<string, string>,
  // Фаза 2 (2026-07-20): гейт «каталожный ИЛИ мой». До появления личных
  // вариантов дыры не было (все варианты каталожные); теперь без гейта
  // репетитор мог бы назначить ЧУЖОЙ личный вариант по угаданному UUID.
  tutorUserId: string,
): Promise<VariantRow | Response> {
  if (!isUUID(variantId)) {
    return jsonError(cors, 400, "INVALID_ID", "Invalid variant ID");
  }
  const { data, error } = await db
    .from("mock_exam_variants")
    .select("id, title, exam_type, duration_minutes, total_max_score, part1_max, part2_max, task_count, owner_id, subject")
    .eq("id", variantId)
    .maybeSingle();
  if (error) return jsonError(cors, 500, "DB_ERROR", "Failed to load variant");
  // Чужой личный вариант → 404 (не палим существование), как и несуществующий.
  if (!data || (data.owner_id !== null && data.owner_id !== tutorUserId)) {
    return jsonError(cors, 404, "NOT_FOUND", "Variant not found");
  }
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

// 2026-06-05 (review P1): atomic totals resync. Recomputes total_part1_score
// (always) + total_part2_score/total_score (only when finalized) from child
// tables in ONE statement → last-writer-correct под concurrent правками.
// Вызывать ПОСЛЕ любой записи per-task балла (approve-task / part1 manual /
// finalize / recheck). Non-fatal: child score уже сохранён, следующий resync
// исправит при сбое.
async function resyncAttemptTotals(
  db: SupabaseClient,
  attemptId: string,
): Promise<void> {
  const { error } = await db.rpc("mock_exam_resync_attempt_totals", {
    _attempt_id: attemptId,
  });
  if (error) {
    console.warn("mock_exam_resync_totals_failed", {
      attempt_id: attemptId,
      error: error.message,
    });
  }
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

/**
 * TASK-17 (2026-05-17, sprint «Recipient Management»): notify student when
 * tutor добавляет их в existing пробник через `/assignments/:id/assign-students`.
 * Mirror `notifyStudentApproved` cascade: push → telegram fallback. Email
 * отложено (см. .claude/rules/45-mock-exams.md + tutor-improvements-spec.md §9).
 *
 * Deep-link идёт на `/student/mock-exams/:assignmentId` (taking surface).
 */
async function notifyStudentAssigned(
  db: SupabaseClient,
  studentId: string,
  assignmentId: string,
  assignmentTitle: string,
  variantTitle: string,
  deadline: string | null,
  tutorName: string | null,
): Promise<CascadeResult> {
  const appUrl = getAppBaseUrl();
  const url = `${appUrl}/student/mock-exams/${assignmentId}`;
  const deadlineHint = deadline
    ? ` Дедлайн: ${new Date(deadline).toLocaleDateString("ru-RU")}.`
    : "";
  const tutorHint = tutorName ? `${tutorName} назначил` : "Тебе назначили";
  const pushPayload: PushPayload = {
    title: `Новый пробник: ${variantTitle}`,
    body: `${tutorHint} пробник «${assignmentTitle}».${deadlineHint}`,
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
        console.warn("mock_exam_assign_push_send_error", { error: String(err) });
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
        const text = `📝 Новый пробник: <b>${assignmentTitle}</b>\n` +
          `Вариант: ${variantTitle}` +
          (deadline
            ? `\nДедлайн: ${new Date(deadline).toLocaleDateString("ru-RU")}`
            : "") +
          `\n\n${url}`;
        const tgResp = await fetch(
          `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              text,
              parse_mode: "HTML",
              disable_web_page_preview: false,
            }),
          },
        );
        if (tgResp.ok) {
          return { channel: "telegram", failed_reason: null };
        }
      } catch (err) {
        console.warn("mock_exam_assign_telegram_send_error", { error: String(err) });
      }
    }
  }

  // 3) Email — out of scope (Vladimir's UX choice: push+telegram only для пилот).
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
  const variantOrErr = await getVariantOrThrow(db, b.variant_id as string, cors, tutorUserId);
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

  // H2 hotfix [P1] (ChatGPT-5.5 review, 2026-05-26): validate + persist
  // default_exam_mode (AC-P10 Phase 2). Раньше field принимался во frontend
  // payload но не валидировался / не писался в DB — toggle "Симуляция ЕГЭ"
  // silently сбрасывался к DB default 'training'. Override indicator
  // никогда не triggers'ил.
  let defaultExamMode: "training" | "simulation" = "training";
  if (b.default_exam_mode !== undefined && b.default_exam_mode !== null) {
    if (b.default_exam_mode === "training" || b.default_exam_mode === "simulation") {
      defaultExamMode = b.default_exam_mode;
    } else {
      return jsonError(cors, 400, "VALIDATION",
        "default_exam_mode must be 'training' or 'simulation'");
    }
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
      // H2 hotfix [P1]: tutor recommendation для start modal pre-selection.
      default_exam_mode: defaultExamMode,
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

  // 2026-06-02 (item 3): notify initially-assigned students «как по ДЗ». Раньше
  // уведомление слал только `assign-students` (добавление в существующий пробник),
  // а CREATE-flow — нет. Mirror тот же push→telegram cascade (email отложен, rule 45).
  // Best-effort: сбой уведомления НЕ валит создание пробника.
  const notifyOnCreate = b.notify === undefined || b.notify === true;
  let createNotify = { sent_push: 0, sent_telegram: 0, failed: 0, failed_no_channel: 0 };
  if (notifyOnCreate && studentIds.length > 0) {
    try {
      const [{ data: tutorRow }, { data: variantRow }] = await Promise.all([
        db.from("tutors").select("name").eq("user_id", tutorUserId).maybeSingle(),
        db.from("mock_exam_variants").select("title").eq("id", b.variant_id as string).maybeSingle(),
      ]);
      const tutorName = (tutorRow?.name as string | null) ?? null;
      const variantTitle = (variantRow?.title as string | null) ?? "пробник";
      const assignmentTitle = (b.title as string).trim();
      const deadlineStr = (b.deadline as string | null | undefined) ?? null;
      const results = await Promise.all(
        studentIds.map((sid) =>
          notifyStudentAssigned(
            db, sid, assignment.id as string, assignmentTitle, variantTitle, deadlineStr, tutorName,
          ).catch((err): CascadeResult => {
            console.warn("mock_exam_create_notify_student_failed", { student_id: sid, error: String(err) });
            return { channel: null, failed_reason: "exception" };
          })
        ),
      );
      for (const r of results) {
        if (r.channel === "push") createNotify.sent_push += 1;
        else if (r.channel === "telegram") createNotify.sent_telegram += 1;
        else if (r.failed_reason === "no_channels_available") createNotify.failed_no_channel += 1;
        else createNotify.failed += 1;
      }
    } catch (err) {
      console.warn("mock_exam_create_notify_cascade_failed", { error: String(err) });
    }
  }

  return jsonOk(
    cors,
    { assignment_id: assignment.id, attempts_created: studentIds.length, notify: createNotify },
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

  // TASK-16 (2026-05-15): batch-load per-task scores для всех attempts чтобы
  // MockExamHeatmap мог рендерить colored cells. Two extra SELECT queries
  // (Часть 1 + Часть 2), GROUP BY attempt_id в JS. На pilot scale (5-10
  // учеников × 26 task слотов) → 130-260 rows total — приемлемо без RPC.
  // Anti-leak: НЕ возвращаем student_answer (form-mode legacy data,
  // не нужно tutor heatmap'у) и НЕ возвращаем ai_draft_json (tutor-only
  // artifact, в heatmap нужен только final tutor_score).
  const attemptIdList = (attemptRows ?? []).map((a) => a.id as string);
  const part1ByAttempt = new Map<
    string,
    Array<{ kim_number: number; earned_score: number | null }>
  >();
  const part2ByAttempt = new Map<
    string,
    Array<{
      kim_number: number;
      tutor_score: number | null;
      status: string;
    }>
  >();
  if (attemptIdList.length > 0) {
    const [part1Rows, part2Rows] = await Promise.all([
      db
        .from("mock_exam_attempt_part1_answers")
        .select("attempt_id, kim_number, earned_score")
        .in("attempt_id", attemptIdList),
      db
        .from("mock_exam_attempt_part2_solutions")
        .select("attempt_id, kim_number, tutor_score, status")
        .in("attempt_id", attemptIdList),
    ]);
    for (const row of (part1Rows.data ?? []) as Array<{
      attempt_id: string;
      kim_number: number;
      earned_score: number | null;
    }>) {
      if (!part1ByAttempt.has(row.attempt_id)) {
        part1ByAttempt.set(row.attempt_id, []);
      }
      part1ByAttempt.get(row.attempt_id)!.push({
        kim_number: row.kim_number,
        earned_score: row.earned_score,
      });
    }
    for (const row of (part2Rows.data ?? []) as Array<{
      attempt_id: string;
      kim_number: number;
      tutor_score: number | null;
      status: string;
    }>) {
      if (!part2ByAttempt.has(row.attempt_id)) {
        part2ByAttempt.set(row.attempt_id, []);
      }
      part2ByAttempt.get(row.attempt_id)!.push({
        kim_number: row.kim_number,
        tutor_score: row.tutor_score,
        status: row.status,
      });
    }
  }

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
    // TASK-16: per-task scores для heatmap rendering. Empty arrays для
    // not-started / not-yet-submitted attempts — frontend null-safe ??.
    part1_answers: part1ByAttempt.get(a.id as string) ?? [],
    part2_solutions: part2ByAttempt.get(a.id as string) ?? [],
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

/**
 * TASK-16-R3 fix #2 (ChatGPT-5.5 review, 2026-05-17): legacy OCR JSON compat.
 *
 * Pre-R2 attempts могут содержать `ai_part1_ocr_json` в старых shape'ах:
 *   - Legacy success: `{ 1: {value, confidence}, ..., 20: {...}, __meta: {...} }`
 *     (numeric keys на верхнем уровне + __meta как sibling)
 *   - Legacy failure: `{ cells: {}, raw_response, error, gemini_model, failed_at }`
 *     (top-level error fields, без __meta namespace)
 *
 * Frontend (TutorMockExamReview Part1BlankReviewPanel) после R2 ожидает
 * только canonical `{ cells: Record<number, Cell>, __meta: { status, ... } }`.
 * Без normalizer'а pilot attempts (Egor 2026-05-15+) после R2 deploy теряют
 * cell display и не получают правильный failure banner.
 *
 * Этот helper normalize'ит legacy → canonical. Идемпотентен — applied to
 * already-canonical JSON это no-op.
 */
function normalizePart1OCRJson(raw: unknown): unknown | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;

  // Case 0: already canonical — return as-is.
  const hasMeta = obj.__meta && typeof obj.__meta === "object";
  const hasCells = obj.cells && typeof obj.cells === "object";
  if (hasMeta && hasCells) {
    const meta = obj.__meta as Record<string, unknown>;
    if (meta.status === "success" || meta.status === "failed") {
      return obj;
    }
    // Has __meta + cells, но __meta.status missing — patch его.
    return {
      cells: obj.cells,
      __meta: { ...meta, status: meta.status ?? "success" },
    };
  }

  // Case 1: legacy failure shape — `{ cells: {}, error, raw_response, gemini_model, failed_at }`.
  if (hasCells && ("error" in obj || "raw_response" in obj)) {
    const nowIso = new Date().toISOString();
    return {
      cells: obj.cells,
      __meta: {
        status: "failed",
        gemini_model: typeof obj.gemini_model === "string" ? obj.gemini_model : "unknown",
        error: typeof obj.error === "string" ? obj.error : "Unknown error",
        raw_response: typeof obj.raw_response === "string" ? obj.raw_response : null,
        failed_at: typeof obj.failed_at === "string" ? obj.failed_at : nowIso,
        generated_at: typeof obj.failed_at === "string" ? obj.failed_at : nowIso,
      },
    };
  }

  // Case 2: legacy success shape — `{ 1: {...}, ..., 20: {...}, __meta: {...}? }`.
  // Numeric keys at top, optional __meta sibling. Extract cells, build canonical.
  const cells: Record<string, unknown> = {};
  let legacyMeta: Record<string, unknown> | null = null;
  for (const [key, value] of Object.entries(obj)) {
    if (key === "__meta") {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        legacyMeta = value as Record<string, unknown>;
      }
      continue;
    }
    if (/^\d+$/.test(key) && value && typeof value === "object") {
      cells[key] = value;
    }
  }
  const recognizedCount = Object.values(cells).filter(
    (c) =>
      c && typeof c === "object" && "value" in c &&
      typeof (c as { value: unknown }).value === "string" &&
      ((c as { value: string }).value).length > 0,
  ).length;
  const nowIso = new Date().toISOString();
  return {
    cells,
    __meta: {
      status: "success",
      gemini_model:
        legacyMeta && typeof legacyMeta.gemini_model === "string"
          ? legacyMeta.gemini_model
          : "legacy",
      recognized_cells:
        legacyMeta && typeof legacyMeta.recognized_cells === "number"
          ? legacyMeta.recognized_cells
          : recognizedCount,
      raw_length:
        legacyMeta && typeof legacyMeta.raw_length === "number"
          ? legacyMeta.raw_length
          : 0,
      generated_at:
        legacyMeta && typeof legacyMeta.generated_at === "string"
          ? legacyMeta.generated_at
          : nowIso,
    },
  };
}

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
    solution_image_urls: string | null;
    part: number;
  }> = {};
  let examType: string | null = null;
  let totalMaxScore: number | null = null;

  if (assignment.variant_id) {
    const { data: tasks } = await db
      .from("mock_exam_variant_tasks")
      .select("kim_number, part, task_text, task_image_url, correct_answer, check_mode, max_score, solution_text, solution_image_urls")
      .eq("variant_id", assignment.variant_id as string);
    for (const t of tasks ?? []) {
      variantTasks[t.kim_number as number] = {
        task_text: t.task_text as string,
        task_image_url: t.task_image_url as string | null,
        correct_answer: t.correct_answer as string | null,
        check_mode: t.check_mode as string | null,
        max_score: t.max_score as number,
        solution_text: t.solution_text as string | null,
        solution_image_urls: t.solution_image_urls as string | null,
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
  // AC-P11 (2026-05-26): + tutor_comment в SELECT для drill-down dialog.
  // tutor_comment (per-KIM коммент репетитора, AC-P11) — колонка добавлена миграцией
  // 20260608120000. Раньше колонки НЕ было → её SELECT молча ронял весь запрос
  // (PostgREST error → data=null), репетитор в обзоре видел «без ответа» в
  // form-режиме. Ошибку логируем, не глотаем. Зеркало handleGetResult.
  const { data: part1Rows, error: part1RowsErr } = await db
    .from("mock_exam_attempt_part1_answers")
    .select("kim_number, student_answer, earned_score, tutor_comment, score_source")
    .eq("attempt_id", attemptId)
    .order("kim_number", { ascending: true });
  if (part1RowsErr) {
    console.error(JSON.stringify({
      event: "mock_attempt_part1_select_failed",
      message: part1RowsErr.message,
    }));
  }
  const answersByKim = new Map<number, {
    student_answer: string | null;
    earned_score: number | null;
    tutor_comment: string | null;
    score_source: string | null;
  }>();
  for (const row of part1Rows ?? []) {
    answersByKim.set(row.kim_number as number, {
      student_answer: row.student_answer as string | null,
      earned_score: row.earned_score as number | null,
      tutor_comment: row.tutor_comment as string | null,
      score_source: row.score_source as string | null,
    });
  }
  const part1VariantTasks = Object.entries(variantTasks)
    .filter(([, t]) => t.part === 1)
    .map(([kimStr, t]) => ({ kim: Number(kimStr), variant: t }))
    .sort((a, b) => a.kim - b.kim);

  // Derive-on-read fallback (2026-06-06): для blank/OCR-попыток, оценённых до
  // редеплоя per-KIM персистинга, строки могут не иметь earned_score, хотя
  // ai_part1_ocr_json.cells заполнен → у тутора поле балла пустое («—») и он не
  // видит, сколько назначил ИИ. Восстанавливаем earned_score ТОЛЬКО для
  // отображения (подстановка в инпут + строка «Балл AI»): recognized value →
  // checkPart1. Stored row всегда в приоритете; персист по-прежнему на действие
  // тутора (save / finalize / recheck).
  const normalizedOcr = normalizePart1OCRJson(attempt.ai_part1_ocr_json);
  const ocrCells = ((normalizedOcr as Record<string, unknown> | null)?.cells ?? null) as
    Record<string, { value?: string | null }> | null;
  const ocrValueForKim = (kim: number): string | null => {
    const cell = ocrCells?.[kim] ?? ocrCells?.[String(kim)] ?? null;
    const v = cell && typeof cell.value === "string" ? cell.value.trim() : "";
    return v !== "" ? v : null;
  };

  // AC-P11 hotfix H4: resolve task_image_url to signed URL для drill-down dialog.
  // variant.task_image_url хранится как `storage://mock-exam-variant-tasks/...` ref;
  // frontend `<img src={taskImageUrl}>` ожидает direct URL. Mirror student-api
  // pattern (lines 657-668). Variant tasks канонически single ref (см. §11 seed
  // generator), не dual-format JSON-array — поэтому inline single resolve.
  const part1Answers = await Promise.all(
    part1VariantTasks.map(async ({ kim, variant }) => {
      const ans = answersByKim.get(kim);
      const taskImageSigned = await resolveSignedUrl(
        db,
        (variant.task_image_url as string | null) ?? null,
      );
      // earned_score: stored wins; иначе derive из ответа ученика.
      // value = typed `student_answer` (form) ?? OCR-распознанное (blank).
      // score_source отличает балл AI ('ocr'/'student_form'/'finalize_default')
      // от ручного балла тутора ('tutor') — фронт по нему подписывает строку
      // «Балл AI» vs «Ваш балл».
      let earnedScore = ans?.earned_score ?? null;
      let scoreSource = ans?.score_source ?? null;
      const typed =
        ans?.student_answer && ans.student_answer.trim() !== "" ? ans.student_answer : null;
      const resolvedValue = typed ?? ocrValueForKim(kim);
      if (earnedScore === null && resolvedValue !== null) {
        earnedScore = checkPart1(
          variant.correct_answer,
          resolvedValue,
          (variant.check_mode as CheckMode | null) ?? null,
          variant.max_score,
          kim,
        ).earned;
        // derived → балл AI (не tutor): form → 'student_form', blank → 'ocr'.
        scoreSource = scoreSource ?? (typed !== null ? "student_form" : "ocr");
      }
      return {
        kim_number: kim,
        student_answer: ans?.student_answer ?? null,
        earned_score: earnedScore,
        score_source: scoreSource,
        tutor_comment: ans?.tutor_comment ?? null,
        correct_answer: variant.correct_answer,
        max_score: variant.max_score,
        check_mode: variant.check_mode,
        // AC-P11: include task_text + task_image_url для drill-down dialog
        task_text: variant.task_text,
        task_image_url: taskImageSigned,
      };
    }),
  );

  // Part 2 solutions + signed photo URLs.
  const { data: part2Rows } = await db
    .from("mock_exam_attempt_part2_solutions")
    .select("kim_number, photo_url, ai_draft_json, tutor_score, tutor_comment, status, hide_ai_feedback")
    .eq("attempt_id", attemptId)
    .order("kim_number", { ascending: true });

  const part2Solutions = await Promise.all(
    (part2Rows ?? []).map(async (row) => {
      const variant = variantTasks[row.kim_number as number];
      const signed = await resolveSignedUrl(db, row.photo_url as string | null);
      // 2026-06-05 (item 5): solution images (dual-format) → signed URL array.
      const solutionImageRefs = parseAttachmentUrls(variant?.solution_image_urls ?? null);
      const solutionImagesSigned = (
        await Promise.all(solutionImageRefs.map((r) => resolveSignedUrl(db, r)))
      ).filter((u): u is string => typeof u === "string");
      return {
        kim_number: row.kim_number,
        photo_url: signed,
        ai_draft: row.ai_draft_json,
        tutor_score: row.tutor_score,
        tutor_comment: row.tutor_comment,
        status: row.status,
        hide_ai_feedback: row.hide_ai_feedback === true,
        task_text: variant?.task_text ?? "",
        task_image_url: variant?.task_image_url ?? null,
        max_score: variant?.max_score ?? 0,
        solution_text: variant?.solution_text ?? null,
        solution_image_urls: solutionImagesSigned,
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
    //
    // TASK-16-R3 fix #2 (2026-05-17): normalize legacy flat OCR JSON
    // → canonical `{cells, __meta}` shape. Pre-R2 pilot attempts (Egor)
    // могут содержать legacy success (top-level numeric keys) или legacy
    // failure ({cells:{}, error, raw_response, ...}) — оба варианта
    // нормализуются. Already-canonical → no-op.
    ai_part1_ocr_json: normalizedOcr ?? null,
    // AC-P10 Phase 2 (PAUSE-8): expose pause/session fields для tutor review.
    // - exam_mode: final mode после student override (immutable после первого start)
    // - default_exam_mode: assignment-level tutor recommendation; UI показывает
    //   indicator если они differ («ученик выбрал»)
    // - sessions: per-session breakdown («Solo time: 50+30+70 мин»)
    // - total_active_ms: cached sum для quick KPI без recomputation
    exam_mode: (attempt.exam_mode as string | null) ?? "training",
    default_exam_mode: (assignment.default_exam_mode as string | null) ?? "training",
    sessions: Array.isArray(attempt.sessions) ? attempt.sessions : [],
    total_active_ms:
      typeof attempt.total_active_ms === "number" ? attempt.total_active_ms : 0,
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

  // 2026-06-02 (item 4): allow re-editing a Part 2 score AFTER approval — тутор
  // правит баллы после обсуждения с учеником. totals ресинкаются ниже. Только
  // manually_entered терминален (нет per-task AI данных).
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

  // 2026-06-05 (review P1): atomic resync через RPC — пересчитывает обе части из
  // дочерних таблиц одним UPDATE (last-writer-correct под concurrent post-approval
  // правками). Заменил JS read-sum-update (был подвержен stale-snapshot гонке).
  // RPC сам гейтит total_part2_score/total_score на «уже finalized».
  await resyncAttemptTotals(db, attemptId);

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

  // TASK-OCR Round 3 (2026-05-21) — Vladimir's UX rewrite: «Подтвердить и
  // отправить» теперь ВСЕГДА активна (no INCOMPLETE_PART2 hard gate). Для
  // kim где tutor_score=null AND ai_draft.suggested_score=null → auto-fill
  // tutor_score=0 + transparent comment чтобы student видел в result page
  // что AI не оценил эту задачу из-за missing photo.
  //
  // Risk mitigation: добавляем `auto_zeroed_kims` в response чтобы UI мог
  // показать toast «AI не оценил задачи №X, Y — выставлено 0. Отправлено.»
  const finalScores = new Map<number, number>();
  const autoZeroedKims: number[] = []; // Для tutor visibility в response.
  for (const kim of expectedKimNumbers) {
    const sol = solutionsByKim[kim];
    if (!sol) {
      // Solution row не существует — обычно для bulk attempts placeholder
      // создаётся на submit. Если отсутствует — fall through к auto-zero.
      finalScores.set(kim, 0);
      autoZeroedKims.push(kim);
      continue;
    }
    const finalScore = sol.tutor_score ?? sol.ai_suggested;
    if (finalScore === null) {
      // Ни tutor ни AI не выставили — auto-0 с комментарием. Tutor сделал
      // explicit decision (нажал approve), backend честно это исполняет.
      finalScores.set(kim, 0);
      autoZeroedKims.push(kim);
      continue;
    }
    finalScores.set(kim, finalScore);
  }

  // TASK-OCR Round 3 (2026-05-21): для blank-mode attempts — auto-fill 0 для
  // missing Часть 1 KIM (вместо hard-block INCOMPLETE_PART1). Параллель к
  // Часть 2 auto-zero logic. Tutor sees autoZeroedPart1Kims в response чтобы
  // показать toast «Часть 1: KIM №X, Y без баллов → 0».
  //
  // Background: handleFinalize endpoint УЖЕ делает INSERT-on-missing для form
  // mode (.claude/rules/45-mock-exams.md R2) — но для blank-mode tutor может не нажать
  // «Часть 1 проверена» а сразу approve-all. Backend защищает.
  const autoZeroedPart1Kims: number[] = [];
  if (attempt.answer_method === "blank") {
    const { data: variantPart1Tasks, error: part1VariantErr } = await db
      .from("mock_exam_variant_tasks")
      .select("kim_number, max_score")
      .eq("variant_id", assignment.variant_id as string)
      .eq("part", 1);
    if (part1VariantErr || !variantPart1Tasks) {
      return jsonError(cors, 500, "DB_ERROR", "Failed to load variant Part 1 tasks");
    }

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

    // Auto-INSERT 0 для отсутствующих/null KIM (mirror handleFinalize).
    // TASK-OCR Round 6 (2026-05-21): схема mock_exam_attempt_part1_answers
    // НЕ имеет колонки max_score (см. mock-exam-grade::runPart1OCR
    // comment). Раньше autoFillPart1 пытался писать max_score → Postgres
    // 42703 → upsert failed silently → KIM остаётся без earned_score →
    // tutor approve фиксирует 0 в total_part1_score, но per-row data
    // отсутствует → result page показывает «—» вместо «0».
    const autoFillPart1: Array<{
      attempt_id: string;
      kim_number: number;
      student_answer: null;
      earned_score: 0;
      score_source: "finalize_default";
      updated_at: string;
    }> = [];
    const nowIso = new Date().toISOString();
    for (const t of variantPart1Tasks) {
      const kim = t.kim_number as number;
      const score = part1ScoreByKim.get(kim);
      if (score === undefined || score === null) {
        autoZeroedPart1Kims.push(kim);
        autoFillPart1.push({
          attempt_id: attemptId,
          kim_number: kim,
          student_answer: null,
          earned_score: 0,
          // max_score колонки нет в схеме — НЕ писать!
          score_source: "finalize_default",
          updated_at: nowIso,
        });
      }
    }
    if (autoFillPart1.length > 0) {
      const { error: fillErr } = await db
        .from("mock_exam_attempt_part1_answers")
        .upsert(autoFillPart1, { onConflict: "attempt_id,kim_number" });
      if (fillErr) {
        console.error("mock_exam_approve_all_part1_autofill_failed", {
          attempt_id: attemptId,
          error: fillErr.message,
        });
        return jsonError(
          cors,
          500,
          "DB_ERROR",
          "Не удалось зафиксировать пустые задачи Часть 1 как 0",
        );
      }
    }
  }

  // Auto-finalize Часть 2 rows: для каждой задачи где tutor не выставил
  // вручную, используем AI's suggested_score как final tutor_score. Status:
  // 'tutor_approved' (default) если ai === final, 'tutor_modified' если
  // override (это уже произошло через explicit edit раньше — мы здесь не
  // меняем status у уже tutor_approved/tutor_modified rows).
  //
  // TASK-OCR Round 3 (2026-05-21): для auto-zeroed kims (AI suggested=null,
  // tutor=null) пишем tutor_score=0 + status='tutor_modified' + transparent
  // tutor_comment. Tutor сделал explicit decision (нажал approve), мы
  // фиксируем 0 с явным комментарием — student увидит в result page.
  const autoFinalize: Array<{
    attempt_id: string;
    kim_number: number;
    tutor_score: number;
    tutor_comment?: string | null;
    status: string;
    updated_at: string;
  }> = [];
  const nowAutoFinalizeIso = new Date().toISOString();
  const autoZeroedKimsSet = new Set(autoZeroedKims);
  for (const [kim, score] of finalScores.entries()) {
    const sol = solutionsByKim[kim];
    // Если sol существует и tutor_score уже выставлен вручную — пропускаем
    // (не overwrite explicit tutor decision).
    if (sol && sol.tutor_score !== null) continue;

    // Auto-zeroed kim: явный комментарий чтобы student понял.
    if (autoZeroedKimsSet.has(kim)) {
      autoFinalize.push({
        attempt_id: attemptId,
        kim_number: kim,
        tutor_score: 0,
        tutor_comment: "AI не смог оценить эту задачу (фото не загружено или нечитаемо). Балл выставлен 0 при подтверждении.",
        status: "tutor_modified",
        updated_at: nowAutoFinalizeIso,
      });
      continue;
    }

    // AI default — accept suggested_score, status=tutor_approved (no override).
    autoFinalize.push({
      attempt_id: attemptId,
      kim_number: kim,
      tutor_score: score,
      status: "tutor_approved",
      updated_at: nowAutoFinalizeIso,
    });
  }
  if (autoFinalize.length > 0) {
    const { error: autoErr } = await db
      .from("mock_exam_attempt_part2_solutions")
      .upsert(autoFinalize, { onConflict: "attempt_id,kim_number" });
    if (autoErr) {
      console.error("mock_exam_approve_all_auto_finalize_failed", { error: autoErr.message });
      return jsonError(cors, 500, "DB_ERROR", "Не удалось зафиксировать баллы Часть 2");
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
    // TASK-OCR Round 3 (2026-05-21): transparency для tutor UI. Показываем
    // какие kim были auto-zeroed без явной tutor decision — это позволяет
    // показать toast «Готово. Задачи №X, Y без фото — выставлено 0.»
    auto_zeroed_part1_kims: autoZeroedPart1Kims,
    auto_zeroed_part2_kims: autoZeroedKims,
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

  // 2026-06-02 (item 4): allow editing Part 1 score AFTER approval — тутор правит
  // баллы после обсуждения с учеником. Только manually_entered терминален (нет
  // per-task данных). total_score ресинкается ниже (invariant part1+part2).
  if (attempt.status === "manually_entered") {
    return jsonError(cors, 409, "ALREADY_FINALIZED",
      "Внесённый вручную пробник нельзя редактировать по задачам");
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
  // AC-P11 (2026-05-26): optional `comment` field — tutor comment к KIM,
  // видим ученику после approval. Max 600 chars defensive.
  let comment: string | null | undefined = undefined; // undefined = не обновлять, null = clear
  if (b.comment !== undefined) {
    if (b.comment === null) {
      comment = null;
    } else if (typeof b.comment === "string") {
      const trimmed = b.comment.trim();
      if (trimmed.length === 0) {
        comment = null;
      } else if (trimmed.length > 600) {
        return jsonError(cors, 400, "VALIDATION",
          "Комментарий слишком длинный (максимум 600 символов)");
      } else {
        comment = trimmed;
      }
    } else {
      return jsonError(cors, 400, "VALIDATION", "comment must be string or null");
    }
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

  // AC-P11: preserve existing student_answer (form mode уже имеет ответ).
  // Раньше handler хардкодил `student_answer: null` — это работало для blank mode
  // где answer всегда null. Для form mode (drill-down editing) — student_answer
  // уже set от auto-check, не должен теряться при tutor override.
  const { data: existingRow } = await db
    .from("mock_exam_attempt_part1_answers")
    .select("student_answer")
    .eq("attempt_id", attemptId)
    .eq("kim_number", b.kim_number as number)
    .maybeSingle();
  const preservedStudentAnswer =
    (existingRow?.student_answer as string | null) ?? null;

  const upsertPayload: Record<string, unknown> = {
    attempt_id: attemptId,
    kim_number: b.kim_number,
    student_answer: preservedStudentAnswer,
    earned_score: b.earned_score,
    // TASK-16-R2 fix #1: explicit provenance — runPart1OCR retry preserves
    // только rows со score_source='tutor' (см. .claude/rules/45-mock-exams.md R2 invariants).
    score_source: "tutor",
    updated_at: new Date().toISOString(),
  };
  // Only include `tutor_comment` in payload если client передал field
  // (undefined = не обновлять; null = explicit clear).
  if (comment !== undefined) {
    upsertPayload.tutor_comment = comment;
  }

  const { error: upsertErr } = await db
    .from("mock_exam_attempt_part1_answers")
    .upsert(upsertPayload, { onConflict: "attempt_id,kim_number" });
  if (upsertErr) {
    console.error("mock_exam_part1_manual_score_failed", { error: upsertErr.message });
    return jsonError(cors, 500, "DB_ERROR", "Failed to persist manual score");
  }

  // 2026-06-05 (review P1): atomic resync через RPC — пересчитывает total_part1_score
  // (always) + total_score (когда finalized) из дочерней таблицы одним UPDATE,
  // last-writer-correct под concurrent правками. Заменил прежний JS read-sum-update
  // (H5), который был подвержен stale-snapshot гонке.
  await resyncAttemptTotals(db, attemptId);
  // Read back recomputed total_part1_score для ответа (frontend показывает свежее «X/28»).
  const { data: refreshed } = await db
    .from("mock_exam_attempts")
    .select("total_part1_score")
    .eq("id", attemptId)
    .maybeSingle();
  const totalPart1 = (refreshed?.total_part1_score as number | null) ?? null;

  return jsonOk(cors, {
    ok: true,
    attempt_id: attemptId,
    kim_number: b.kim_number,
    earned_score: b.earned_score,
    tutor_comment: comment === undefined ? null : comment,
    // AC-P11 hotfix H5: expose updated totals → frontend invalidates cache and
    // shows fresh «X/28» immediately. null если recompute fail'нул (non-fatal).
    total_part1_score: totalPart1,
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
  const { attempt, assignment } = ownedOrErr;

  // 2026-06-02 (item 4): allow finalize/re-edit Part 1 AFTER approval. total_score
  // ресинкается в этом handler'е (invariant). Только manually_entered терминален.
  if (attempt.status === "manually_entered") {
    return jsonError(cors, 409, "ALREADY_FINALIZED",
      "Внесённый вручную пробник нельзя финализировать по задачам");
  }
  if (attempt.status === "in_progress") {
    return jsonError(cors, 409, "NOT_SUBMITTED",
      "Cannot finalize Part 1 before student submitted the attempt");
  }

  // TASK-16 (2026-05-15): для каждого Часть 1 KIM в variant'е, у которого
  // нет row в mock_exam_attempt_part1_answers → INSERT.
  // Vladimir UX: «если репетитор ничего не ввёл — поставить 0». Result page
  // теперь покажет «0/max» вместо «—» для пропущенных KIM.
  // 2026-06-06: OCR-aware finalize — если у пропущенного KIM есть распознанный
  // ответ в ai_part1_ocr_json.cells, ставим балл checkPart1 (= балл AI, который
  // тутор УЖЕ видит через derive-on-read), а не 0. Иначе «finalize» молча
  // обнулил бы видимый балл AI на старых попытках без per-KIM строк. 0 остаётся
  // только для реально нераспознанных клеток (score_source='finalize_default').
  if (assignment.variant_id) {
    const { data: variantPart1Tasks } = await db
      .from("mock_exam_variant_tasks")
      .select("kim_number, max_score, correct_answer, check_mode")
      .eq("variant_id", assignment.variant_id as string)
      .eq("part", 1)
      .order("kim_number", { ascending: true });

    const { data: existingAnswers } = await db
      .from("mock_exam_attempt_part1_answers")
      .select("kim_number, student_answer, earned_score, score_source")
      .eq("attempt_id", attemptId);
    const existingByKim = new Map<
      number,
      { student_answer: string | null; earned_score: number | null; score_source: string | null }
    >();
    for (const r of existingAnswers ?? []) {
      existingByKim.set(r.kim_number as number, {
        student_answer: r.student_answer as string | null,
        earned_score: r.earned_score as number | null,
        score_source: r.score_source as string | null,
      });
    }

    const finalizeOcr = normalizePart1OCRJson(attempt.ai_part1_ocr_json);
    const finalizeOcrCells = ((finalizeOcr as Record<string, unknown> | null)?.cells ?? null) as
      Record<string, { value?: string | null }> | null;
    const finalizeOcrValue = (kim: number): string | null => {
      const cell = finalizeOcrCells?.[kim] ?? finalizeOcrCells?.[String(kim)] ?? null;
      const v = cell && typeof cell.value === "string" ? cell.value.trim() : "";
      return v !== "" ? v : null;
    };

    const missingInserts: Array<{
      attempt_id: string;
      kim_number: number;
      student_answer: string | null;
      earned_score: number;
      score_source: "finalize_default" | "ocr" | "student_form";
    }> = [];
    // 2026-06-07: пересчёт СУЩЕСТВУЮЩИХ строк с earned_score=null И score_source !=
    // 'tutor' (типично form-режим: autosave писал student_answer + earned_score=null).
    // Иначе approve/итог по дочерней таблице был бы неверен. Ручные баллы тутора
    // ('tutor') не трогаем. Payload без student_answer → upsert обновит только
    // earned_score + score_source, остальные колонки строки сохранятся.
    const recomputeUpdates: Array<{
      attempt_id: string;
      kim_number: number;
      earned_score: number;
      score_source: "ocr" | "student_form";
    }> = [];
    for (const t of (variantPart1Tasks ?? []) as Array<{
      kim_number: number;
      max_score: number;
      correct_answer: string | null;
      check_mode: string | null;
    }>) {
      const existing = existingByKim.get(t.kim_number);
      if (!existing) {
        // Нет строки → INSERT (OCR-aware: распознанный ответ → балл AI, иначе 0).
        const ocrValue = finalizeOcrValue(t.kim_number);
        if (ocrValue !== null) {
          missingInserts.push({
            attempt_id: attemptId,
            kim_number: t.kim_number,
            student_answer: ocrValue,
            earned_score: checkPart1(
              t.correct_answer,
              ocrValue,
              (t.check_mode as CheckMode | null) ?? null,
              t.max_score,
              t.kim_number,
            ).earned,
            score_source: "ocr",
          });
        } else {
          missingInserts.push({
            attempt_id: attemptId,
            kim_number: t.kim_number,
            student_answer: null,
            earned_score: 0,
            // TASK-16-R2 fix #1: provenance — finalize_default = "tutor не ввёл,
            // ставим 0 чтобы result page показал '0/max', не '—'". runPart1OCR
            // retry будет перезаписывать эти rows (только score_source='tutor' preserved).
            score_source: "finalize_default",
          });
        }
      } else if (existing.earned_score === null && existing.score_source !== "tutor") {
        // Строка есть, но не оценена и НЕ ручная правка → пересчитать из
        // ответа ученика (typed student_answer ?? OCR-распознанное).
        const typed =
          existing.student_answer && existing.student_answer.trim() !== ""
            ? existing.student_answer
            : null;
        const value = typed ?? finalizeOcrValue(t.kim_number);
        if (value !== null) {
          recomputeUpdates.push({
            attempt_id: attemptId,
            kim_number: t.kim_number,
            earned_score: checkPart1(
              t.correct_answer,
              value,
              (t.check_mode as CheckMode | null) ?? null,
              t.max_score,
              t.kim_number,
            ).earned,
            score_source: (existing.score_source as "ocr" | "student_form" | null) ??
              (typed !== null ? "student_form" : "ocr"),
          });
        }
        // value === null (нет ответа) → оставляем earned_score=null; resync
        // трактует null как 0.
      }
    }
    if (missingInserts.length > 0) {
      // onConflict NOTHING — не перезаписываем existing rows (race safety).
      const { error: insertErr } = await db
        .from("mock_exam_attempt_part1_answers")
        .upsert(missingInserts, {
          onConflict: "attempt_id,kim_number",
          ignoreDuplicates: true,
        });
      if (insertErr) {
        console.warn("mock_exam_part1_finalize_default_insert_failed", {
          attempt_id: attemptId,
          missing_count: missingInserts.length,
          error: insertErr.message,
        });
        // Non-fatal — продолжаем с aggregation. Sum может быть partial.
      }
    }
    if (recomputeUpdates.length > 0) {
      // onConflict MERGE — обновляет earned_score + score_source у существующих
      // (payload без student_answer → та колонка сохраняется).
      const { error: updateErr } = await db
        .from("mock_exam_attempt_part1_answers")
        .upsert(recomputeUpdates, { onConflict: "attempt_id,kim_number" });
      if (updateErr) {
        console.warn("mock_exam_part1_finalize_recompute_failed", {
          attempt_id: attemptId,
          recompute_count: recomputeUpdates.length,
          error: updateErr.message,
        });
        // Non-fatal — продолжаем с aggregation.
      }
    }
  }

  // 2026-06-05 (review P1): atomic resync via RPC (last-writer-correct). После
  // missing-kim инсертов выше — пересчёт total_part1_score (always) + total_score
  // (когда finalized) из дочерней таблицы одним UPDATE.
  await resyncAttemptTotals(db, attemptId);
  const { data: refreshed } = await db
    .from("mock_exam_attempts")
    .select("total_part1_score")
    .eq("id", attemptId)
    .maybeSingle();
  const totalPart1 = (refreshed?.total_part1_score as number | null) ?? 0;

  return jsonOk(cors, {
    ok: true,
    attempt_id: attemptId,
    total_part1_score: totalPart1,
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Endpoint: POST /attempts/:id/retry-part1-ocr  (TASK-16, 2026-05-15)
// ────────────────────────────────────────────────────────────────────────────
//
// Tutor force-re-runs AI Part 1 OCR (Gemini 2.5-pro). Используется когда
// first OCR call failed или дал плохой результат. Workflow:
//   1. Clear `ai_part1_ocr_json` (idempotent reset).
//   2. Fire-and-forget call на mock-exam-grade с `force_retry_ocr: true`.
//   3. Tutor refetch attempt через 5-10 sec → новые OCR values pre-fill inputs.
//
// Status guard: только pre-approval (submitted | ai_checking | awaiting_review).
// Ownership: assignment.tutor_id === auth.uid().

async function handleRetryPart1OCR(
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
      "Работа уже подтверждена и отправлена ученику. Перепроверка OCR недоступна.");
  }
  if (attempt.status === "in_progress") {
    return jsonError(cors, 409, "NOT_SUBMITTED",
      "Ученик ещё не сдал работу. OCR запустится автоматически после отправки.");
  }
  // TASK-16-R2 fix #2 (ChatGPT-5.5 review Finding 2): reject `ai_checking`
  // because another grader run is in flight. Без этого guard'а race: retry
  // → clear ocr → fire-and-forget → grader CAS returns 202 ALREADY_GRADING
  // → retry endpoint вернул "queued" (false success), но OCR не enqueue'нулся.
  //
  // TASK-OCR-3 (2026-05-21) recovery extension: accept `ai_checking` IF lock
  // is stale (updated_at > 120s ago). Stale = либо grader crashed (e.g.
  // before my P0 fix attempts stuck because submit pre-set ai_checking),
  // либо real timeout. mock-exam-grade::handleGrade does its own atomic
  // stale-claim — we just unblock the retry path.
  if (attempt.status === "ai_checking") {
    const updatedAt = attempt.updated_at as string | null;
    const ageMs = updatedAt
      ? Date.now() - new Date(updatedAt).getTime()
      : Infinity;
    const STALE_LOCK_AGE_MS = 120_000;
    if (Number.isFinite(ageMs) && ageMs < STALE_LOCK_AGE_MS) {
      return jsonError(cors, 409, "GRADING_IN_PROGRESS",
        "AI ещё проверяет работу. Подожди 30-60 секунд и обнови страницу — результат появится автоматически.");
    }
    console.info(JSON.stringify({
      event: "mock_exam_retry_ocr_stale_lock_proceed",
      attempt_id: attemptId,
      lock_age_ms: ageMs,
    }));
    // Fall through — grader's own stale-lock recovery will reclaim the row.
  }
  if (attempt.answer_method !== "blank") {
    return jsonError(cors, 400, "WRONG_METHOD",
      "Перезапуск AI OCR доступен только для работ с фото (режим «Бланк»). Ученик отвечал в цифровом режиме — баллы Часть 1 уже посчитаны автоматически.");
  }
  // TASK-OCR-3/4 (2026-05-21): OCR теперь работает на любом Часть 1 фото —
  // canonical ФИПИ-бланк (`blank_photo_url`) ИЛИ произвольное фото ответов
  // (`part1_blank_photo_url`, например тетрадный лист). Раньше handler
  // отвергал второй случай → tutor не мог triggers retry для freeform
  // attempts.
  if (!attempt.blank_photo_url && !attempt.part1_blank_photo_url) {
    return jsonError(cors, 400, "NO_PART1_PHOTO",
      "Ученик не загрузил фото ответов Часть 1 — ни на ФИПИ-бланке, ни на произвольном листе. Попроси переснять и сдать заново.");
  }

  // TASK-OCR Round 5 (2026-05-21) — НЕ очищаем ai_part1_ocr_json перед
  // fire-and-forget. Раньше UI делал dramatic re-render (все «AI: X» строки
  // исчезали → пустые карточки → 60 сек ожидания → новые значения). Это
  // плохой UX — tutor думает что система сломалась.
  //
  // `force_retry_ocr: true` уже override'ит idempotency check в grader
  // (см. mock-exam-grade::shouldRunPart1OCR — `options?.forceRetryOCR === true ||
  // !attemptRow.ai_part1_ocr_json`). Grader сам перезапишет ai_part1_ocr_json
  // и upsert'нёт mock_exam_attempt_part1_answers с новыми earned_score.
  //
  // Старая логика «clear → fire» создавала окно неконсистентности. Новая —
  // grader атомарно overwrite'ит. Tutor видит старый OCR пока новый не готов.

  // Fire-and-forget call на mock-exam-grade с force_retry_ocr.
  // Service-role bypass'ит ownership check там.
  try {
    fetch(`${SUPABASE_URL}/functions/v1/mock-exam-grade`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: SUPABASE_SERVICE_ROLE_KEY,
      },
      body: JSON.stringify({ attempt_id: attemptId, force_retry_ocr: true }),
    }).catch((err) => {
      console.warn("mock_exam_retry_ocr_enqueue_failed", { error: String(err) });
    });
  } catch (err) {
    console.warn("mock_exam_retry_ocr_enqueue_throw", { error: String(err) });
  }

  return jsonOk(cors, {
    ok: true,
    attempt_id: attemptId,
    status: "queued",
    message: "AI OCR запущен заново. Подожди 5–15 секунд и обнови страницу.",
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Endpoint: POST /attempts/:id/recheck-part1  (AC-P4, 2026-05-25)
// ────────────────────────────────────────────────────────────────────────────
//
// Tutor пересчитывает Часть 1 по обновлённым ФИПИ 2026 partial credit
// критериям. Use-case: pilot attempts с partial-correct ответами получили
// earned_score=0 со старым binary checker'ом; после deploy partial credit
// logic нужно манульно re-grade existing attempts (UX выбор Vladimir —
// «tutor-controlled» через explicit button).
//
// Логика:
//   1. Ownership-check через getOwnedAttemptOrThrow
//   2. SELECT всех Часть 1 KIM из mock_exam_variant_tasks (correct_answer + check_mode + max_score)
//   3. SELECT всех existing rows mock_exam_attempt_part1_answers
//   4. Для каждой row: ЕСЛИ score_source === 'tutor' → skip (preserve manual edits)
//      ИНАЧЕ → recompute earned_score через checkPart1(...) с partial credit logic
//   5. Upsert только rows где earned_score изменился (минимум noise)
//   6. Recompute total_part1_score через SUM
//
// Status guard: submitted/ai_checking/awaiting_review/approved (НЕ in_progress / manually_entered).
// approved разрешён — tutor может захотеть пересчитать УЖЕ approved attempt
// (Егор pilot — несколько approved с binary scoring). total_part1_score
// обновится; tutor сам решает нужно ли вернуть status на awaiting_review.

async function handleRecheckPart1(
  db: SupabaseClient,
  tutorUserId: string,
  attemptId: string,
  cors: Record<string, string>,
): Promise<Response> {
  const ownedOrErr = await getOwnedAttemptOrThrow(db, attemptId, tutorUserId, cors);
  if (ownedOrErr instanceof Response) return ownedOrErr;
  const { attempt, assignment } = ownedOrErr;

  if (attempt.status === "in_progress") {
    return jsonError(cors, 409, "NOT_SUBMITTED",
      "Ученик ещё не сдал работу. Пересчёт Часть 1 будет доступен после submit.");
  }
  if (attempt.status === "manually_entered") {
    return jsonError(cors, 409, "MANUAL_ENTRY",
      "Этот пробник был занесён вручную — в нём нет per-task ответов для пересчёта.");
  }
  if (!assignment.variant_id) {
    return jsonError(cors, 400, "INVALID_STATE", "Assignment has no variant_id");
  }

  // SELECT Часть 1 tasks с эталонами
  const { data: variantTasks, error: tasksErr } = await db
    .from("mock_exam_variant_tasks")
    .select("kim_number, correct_answer, check_mode, max_score")
    .eq("variant_id", assignment.variant_id as string)
    .eq("part", 1)
    .order("kim_number", { ascending: true });
  if (tasksErr) {
    console.error("mock_exam_recheck_part1_tasks_select_failed", { error: tasksErr.message });
    return jsonError(cors, 500, "DB_ERROR", "Не удалось загрузить эталонные ответы Часть 1");
  }

  // SELECT existing answers
  const { data: existingAnswers, error: answersErr } = await db
    .from("mock_exam_attempt_part1_answers")
    .select("kim_number, student_answer, earned_score, score_source")
    .eq("attempt_id", attemptId);
  if (answersErr) {
    console.error("mock_exam_recheck_part1_answers_select_failed", { error: answersErr.message });
    return jsonError(cors, 500, "DB_ERROR", "Не удалось загрузить ответы ученика");
  }

  const tasksByKim = new Map(
    (variantTasks ?? []).map((t) => [
      t.kim_number as number,
      {
        correctAnswer: t.correct_answer as string | null,
        checkMode: t.check_mode as string | null,
        maxScore: t.max_score as number,
      },
    ]),
  );

  const now = new Date().toISOString();
  let updatedCount = 0;
  let skippedTutorCount = 0;
  let skippedNoChangeCount = 0;
  const updates: Array<{
    attempt_id: string;
    kim_number: number;
    student_answer: string | null;
    earned_score: number;
    score_source: string;
    updated_at: string;
  }> = [];

  for (const ans of existingAnswers ?? []) {
    const scoreSource = ans.score_source as string | null;
    // Preserve manual tutor edits — explicit invariant из плана.
    if (scoreSource === "tutor") {
      skippedTutorCount += 1;
      continue;
    }
    const kim = ans.kim_number as number;
    const task = tasksByKim.get(kim);
    if (!task || !task.correctAnswer || !task.checkMode) continue;
    const studentAnswer = ans.student_answer as string | null;
    const newResult = checkPart1(
      task.correctAnswer,
      studentAnswer,
      task.checkMode as CheckMode,
      task.maxScore,
      kim,
    );
    const oldScore = (ans.earned_score as number | null) ?? 0;
    if (newResult.earned === oldScore) {
      skippedNoChangeCount += 1;
      continue;
    }
    updates.push({
      attempt_id: attemptId,
      kim_number: kim,
      student_answer: studentAnswer,
      earned_score: newResult.earned,
      score_source: scoreSource ?? "ocr",  // preserve original provenance
      updated_at: now,
    });
    updatedCount += 1;
  }

  if (updates.length > 0) {
    const { error: upsertErr } = await db
      .from("mock_exam_attempt_part1_answers")
      .upsert(updates, { onConflict: "attempt_id,kim_number" });
    if (upsertErr) {
      console.error("mock_exam_recheck_part1_upsert_failed", {
        attempt_id: attemptId,
        updates_count: updates.length,
        error: upsertErr.message,
      });
      return jsonError(cors, 500, "DB_ERROR", "Не удалось сохранить обновлённые баллы");
    }

    // 2026-06-05 (review P1): atomic resync via RPC. handleRecheckPart1 allows
    // approved attempts (Егор пересчитывает старые binary-scored пробники
    // кнопкой «Применить критерии ФИПИ») — пересчёт total_part1_score (always)
    // + total_score (когда finalized) из дочерней таблицы одним UPDATE,
    // last-writer-correct. Заменил JS read-sum-update (был the drift culprit).
    await resyncAttemptTotals(db, attemptId);
  }

  console.info(JSON.stringify({
    event: "mock_exam_recheck_part1_completed",
    attempt_id: attemptId,
    updated_count: updatedCount,
    skipped_tutor_count: skippedTutorCount,
    skipped_no_change_count: skippedNoChangeCount,
    total_part1_answers: existingAnswers?.length ?? 0,
  }));

  return jsonOk(cors, {
    ok: true,
    attempt_id: attemptId,
    updated_count: updatedCount,
    skipped_tutor_count: skippedTutorCount,
    skipped_no_change_count: skippedNoChangeCount,
    total_part1_answers: existingAnswers?.length ?? 0,
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

// 2026-06-11: per-task курирование Части 2 репетитором (скрыть AI разбор от ученика
// + свой комментарий ученику) — БЕЗ approval. Отдельный endpoint, а НЕ extend
// approve-task: handleApproveTask требует tutor_score, флипает status (heuristic:
// непустой comment → tutor_modified) и зовёт resyncAttemptTotals — курирование не
// должно делать НИЧЕГО из этого. Прецедент — handleAssignPart2Photos. UPDATE (не
// UPSERT): строка создаётся submit/grade'ом; UPSERT мог бы вставить фантом с status
// DEFAULT 'awaiting_review' на нерешённый KIM. Без status/score → totals не трогаем,
// status preservation цел. `tutor_comment` пишут ДВА пути (этот + диалог approve) —
// одна колонка, оба инвалидируют один query key → last-write-wins, single source.
async function handleCuratePart2Task(
  db: SupabaseClient,
  tutorUserId: string,
  attemptId: string,
  body: unknown,
  cors: Record<string, string>,
): Promise<Response> {
  const ownedOrErr = await getOwnedAttemptOrThrow(db, attemptId, tutorUserId, cors);
  if (ownedOrErr instanceof Response) return ownedOrErr;
  const { attempt } = ownedOrErr;
  if (attempt.status === "manually_entered") {
    return jsonError(cors, 409, "MANUALLY_ENTERED", "Это запись прошлого пробника — нечего курировать.");
  }

  const b = (body && typeof body === "object") ? body as Record<string, unknown> : null;
  if (!b) {
    return jsonError(cors, 400, "INVALID_BODY", "Тело запроса должно быть JSON-объектом");
  }
  if (!isPositiveInt(b.kim_number)) {
    return jsonError(cors, 400, "VALIDATION", "kim_number должен быть положительным целым");
  }
  const hasComment = Object.prototype.hasOwnProperty.call(b, "tutor_comment");
  const hasHide = Object.prototype.hasOwnProperty.call(b, "hide_ai_feedback");
  if (!hasComment && !hasHide) {
    return jsonError(cors, 400, "VALIDATION", "Передайте tutor_comment и/или hide_ai_feedback");
  }
  if (hasHide && typeof b.hide_ai_feedback !== "boolean") {
    return jsonError(cors, 400, "VALIDATION", "hide_ai_feedback должен быть boolean");
  }
  if (hasComment && b.tutor_comment !== null && typeof b.tutor_comment !== "string") {
    return jsonError(cors, 400, "VALIDATION", "tutor_comment должен быть строкой или null");
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (hasComment) {
    const c = b.tutor_comment;
    patch.tutor_comment = (typeof c === "string" && c.trim() !== "") ? c.trim() : null;
  }
  if (hasHide) patch.hide_ai_feedback = b.hide_ai_feedback;

  const { data: updated, error } = await db
    .from("mock_exam_attempt_part2_solutions")
    .update(patch)
    .eq("attempt_id", attemptId)
    .eq("kim_number", b.kim_number as number)
    .select("attempt_id, kim_number, tutor_comment, hide_ai_feedback, status")
    .maybeSingle();
  if (error) {
    console.error("mock_exam_curate_part2_failed", { error: error.message, attempt_id: attemptId });
    return jsonError(cors, 500, "DB_ERROR", "Не удалось сохранить");
  }
  if (!updated) {
    return jsonError(cors, 404, "TASK_NOT_FOUND", "Задача не найдена для этой попытки");
  }
  return jsonOk(cors, updated);
}

// 2026-06-11: bulk «скрыть/показать AI по всем задачам Части 2». Один UPDATE всех
// part2-строк попытки. Идемпотентно + двунаправленно. Только hide_ai_feedback.
async function handleCuratePart2HideAll(
  db: SupabaseClient,
  tutorUserId: string,
  attemptId: string,
  body: unknown,
  cors: Record<string, string>,
): Promise<Response> {
  const ownedOrErr = await getOwnedAttemptOrThrow(db, attemptId, tutorUserId, cors);
  if (ownedOrErr instanceof Response) return ownedOrErr;
  const { attempt } = ownedOrErr;
  if (attempt.status === "manually_entered") {
    return jsonError(cors, 409, "MANUALLY_ENTERED", "Это запись прошлого пробника — нечего курировать.");
  }

  const b = (body && typeof body === "object") ? body as Record<string, unknown> : {};
  if (typeof b.hide_ai_feedback !== "boolean") {
    return jsonError(cors, 400, "VALIDATION", "hide_ai_feedback должен быть boolean");
  }
  const { data, error } = await db
    .from("mock_exam_attempt_part2_solutions")
    .update({ hide_ai_feedback: b.hide_ai_feedback, updated_at: new Date().toISOString() })
    .eq("attempt_id", attemptId)
    .select("kim_number");
  if (error) {
    console.error("mock_exam_curate_hide_all_failed", { error: error.message, attempt_id: attemptId });
    return jsonError(cors, 500, "DB_ERROR", "Не удалось обновить");
  }
  return jsonOk(cors, {
    attempt_id: attemptId,
    updated_kim_count: (data ?? []).length,
    hide_ai_feedback: b.hide_ai_feedback,
  });
}

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
      // 2026-06-02 review fix (P2a): feedback (shared student+tutor) обязателен,
      // иначе ученик увидит «AI проверяет…» навсегда. Нейтральная фраза.
      feedback: "Репетитор пересчитывает баллы по этой задаче.",
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

  // Persist-only. Пересчёт баллов запускает фронт единым pipeline (save→regrade)
  // после idle — Variant A (mock-exam-grading-v2). Здесь авто-fire НЕ делаем
  // (review: backend fire-and-forget на каждый save + ручной dirty создавали
  // гонки — P0 #1/#2).
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
    return jsonError(cors, 409, "ALREADY_APPROVED",
      "Работа уже подтверждена и отправлена ученику. Перепроверка AI недоступна.");
  }
  if (attempt.status === "manually_entered") {
    return jsonError(cors, 409, "MANUALLY_ENTERED",
      "Это запись прошлого пробника, AI не использовался. Перепроверка недоступна.");
  }
  if (attempt.status === "in_progress") {
    return jsonError(cors, 400, "NOT_SUBMITTED",
      "Ученик ещё не сдал работу. Перепроверка станет доступна после отправки.");
  }
  // Round 3 review-fix P1 #3 (2026-05-15): /regrade-part2 принимает ТОЛЬКО
  // `awaiting_review`. Раньше пропускали `ai_checking` (через service_role
  // bypass в grader), что создавало race с initial fire-and-forget grading
  // от `handleSubmitAttempt`: tutor мог нажать «Перепроверить AI» во время
  // первичного run → два grader'а параллельно. Теперь явный state-machine
  // gate: regrade имеет смысл только когда AI уже закончил первый pass.
  //
  // TASK-OCR-2 (2026-05-21) recovery extension: mirror retry-part1-ocr —
  // accept stale `ai_checking` (updated_at > 120s ago) для recovery stuck
  // attempts. Старая контракт сохранён для fresh ai_checking (< 120s) и
  // для submitted (там grader должен сам подхватить через CAS-claim из
  // submit fire-and-forget).
  if (attempt.status === "submitted") {
    return jsonError(
      cors,
      409,
      "GRADING_IN_PROGRESS",
      "AI grader сейчас обрабатывает этот пробник. Перепроверка станет доступна, когда он закончит.",
    );
  }
  if (attempt.status === "ai_checking") {
    const updatedAt = attempt.updated_at as string | null;
    const ageMs = updatedAt
      ? Date.now() - new Date(updatedAt).getTime()
      : Infinity;
    const STALE_LOCK_AGE_MS = 120_000;
    if (Number.isFinite(ageMs) && ageMs < STALE_LOCK_AGE_MS) {
      return jsonError(
        cors,
        409,
        "GRADING_IN_PROGRESS",
        "AI grader сейчас обрабатывает этот пробник. Перепроверка станет доступна, когда он закончит.",
      );
    }
    console.info(JSON.stringify({
      event: "mock_exam_regrade_stale_lock_proceed",
      attempt_id: attemptId,
      lock_age_ms: ageMs,
    }));
    // Fall through — grader's own stale-lock recovery will reclaim the row.
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
    // P0 #2 (mock-exam-grading-v2): grader атомарно клеймит awaiting_review →
    // ai_checking. 202 = другой runner уже грейдит (multi-tab / ручной+авто).
    // Привязка сохранена (save прошёл раньше), но пересчёт сейчас не выполнен →
    // сообщаем busy, чтобы UI не делал вид, что всё пересчитано.
    if (resp.status === 202) {
      console.info(JSON.stringify({ event: "mock_exam_regrade_busy", attempt_id: attemptId }));
      return jsonOk(cors, { attempt_id: attemptId, regraded: false, busy: true });
    }
    if (!resp.ok) {
      const errText = await resp.text();
      console.error("mock_exam_regrade_failed", {
        attempt_id: attemptId,
        status: resp.status,
        error: errText.slice(0, 500),
      });
      return jsonError(cors, 502, "REGRADE_FAILED",
        "AI не успел проверить или вернул ошибку. Подожди 30 секунд и попробуй ещё раз. Если повторяется — напиши в чат.");
    }
    const body = await resp.json();
    return jsonOk(cors, {
      attempt_id: attemptId,
      regraded: true,
      busy: false,
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
//     producer (см. .claude/rules/45-mock-exams.md).
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

// ────────────────────────────────────────────────────────────────────────────
// Endpoint: POST /assignments/:id/assign-students  (TASK-17 «Recipient Management»)
// ────────────────────────────────────────────────────────────────────────────
//
// Tutor добавляет дополнительных учеников в existing активный пробник вместо
// создания дубликата. Body: { student_ids[], notify }. Idempotent: skip
// уже-assigned учеников. Если notify=true → push + telegram cascade (без
// email — Vladimir UX choice для пилота).
//
// Validation:
//  - mode !== 'manual_entry' (нечего assign — это single-student backfill)
//  - status !== 'closed' (frontend disable, defense-in-depth)
//  - variant_id IS NOT NULL (manual entry case без варианта)
//  - all student_ids must be UUIDs
//
// Response: { added, skipped_existing, deadline_passed, notify: {...} }
//   - `deadline_passed` сигнал frontend для amber toast
//   - `notify.failed_no_channel` — у учеников ни push subscription, ни telegram

async function handleAssignStudents(
  db: SupabaseClient,
  tutorUserId: string,
  assignmentId: string,
  body: unknown,
  cors: Record<string, string>,
): Promise<Response> {
  const assignmentOrErr = await getOwnedAssignmentOrThrow(
    db,
    assignmentId,
    tutorUserId,
    cors,
  );
  if (assignmentOrErr instanceof Response) return assignmentOrErr;
  const assignment = assignmentOrErr;

  if (assignment.mode === "manual_entry") {
    return jsonError(cors, 400, "INVALID_MODE",
      "Cannot add students to manual_entry assignment");
  }
  if (assignment.status === "closed") {
    return jsonError(cors, 409, "ASSIGNMENT_CLOSED",
      "Cannot add students to closed assignment. Reactivate first.");
  }
  if (!assignment.variant_id) {
    return jsonError(cors, 400, "NO_VARIANT",
      "Cannot add students: assignment has no variant");
  }

  if (!body || typeof body !== "object") {
    return jsonError(cors, 400, "INVALID_BODY", "Request body must be a JSON object");
  }
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.student_ids) || b.student_ids.length === 0) {
    return jsonError(cors, 400, "VALIDATION", "student_ids must be non-empty array");
  }
  const requestedIds = Array.from(new Set(b.student_ids as string[]));
  const invalidIds = requestedIds.filter((id) => !isUUID(id));
  if (invalidIds.length > 0) {
    return jsonError(cors, 400, "VALIDATION", "student_ids must be UUIDs", {
      invalid_student_ids: invalidIds,
    });
  }
  if (requestedIds.length > 100) {
    return jsonError(cors, 400, "VALIDATION", "Cannot assign more than 100 students at once");
  }
  const notify = b.notify === true || b.notify === undefined; // default true

  // Find already-assigned (idempotent): filter them out.
  const { data: existingAttempts, error: existingErr } = await db
    .from("mock_exam_attempts")
    .select("student_id")
    .eq("assignment_id", assignmentId)
    .in("student_id", requestedIds);
  if (existingErr) {
    console.error("mock_exam_assign_students_load_existing_failed", {
      error: existingErr.message,
    });
    return jsonError(cors, 500, "DB_ERROR", "Failed to load existing attempts");
  }
  const existingIds = new Set(
    (existingAttempts ?? [])
      .map((r) => r.student_id as string | null)
      .filter((id): id is string => id !== null),
  );
  const newStudentIds = requestedIds.filter((id) => !existingIds.has(id));
  const skippedExisting = requestedIds.length - newStudentIds.length;

  if (newStudentIds.length === 0) {
    return jsonOk(cors, {
      added: 0,
      skipped_existing: skippedExisting,
      deadline_passed: false,
      notify: { sent_push: 0, sent_telegram: 0, failed: 0, failed_no_channel: 0 },
    });
  }

  // Bulk insert new attempts (status='in_progress', started_at=null, mirror
  // handleCreateAssignment baseline).
  const attemptRows = newStudentIds.map((sid) => ({
    assignment_id: assignmentId,
    student_id: sid,
    anonymous_id: null,
    status: "in_progress" as const,
    started_at: null,
  }));
  const { error: insertErr } = await db
    .from("mock_exam_attempts")
    .insert(attemptRows);
  if (insertErr) {
    console.error("mock_exam_assign_students_insert_failed", {
      error: insertErr.message,
    });
    return jsonError(cors, 500, "DB_ERROR", "Failed to create attempts", {
      detail: insertErr.message,
    });
  }

  // Check deadline status для frontend toast.
  const deadlineStr = assignment.deadline as string | null;
  const deadlinePassed = deadlineStr !== null && new Date(deadlineStr) < new Date();

  // Notify cascade — only если notify=true.
  let sentPush = 0;
  let sentTelegram = 0;
  let failed = 0;
  let failedNoChannel = 0;

  if (notify) {
    // Load tutor name + variant title для push body.
    const [{ data: tutorRow }, { data: variantRow }] = await Promise.all([
      db.from("tutors").select("name").eq("user_id", tutorUserId).maybeSingle(),
      db
        .from("mock_exam_variants")
        .select("title")
        .eq("id", assignment.variant_id as string)
        .maybeSingle(),
    ]);
    const tutorName = (tutorRow?.name as string | null) ?? null;
    const variantTitle = (variantRow?.title as string | null) ?? "пробник";
    const assignmentTitle = assignment.title as string;

    // Parallel cascade per new student. Best-effort — никаких abort'ов.
    const results = await Promise.all(
      newStudentIds.map((sid) =>
        notifyStudentAssigned(
          db,
          sid,
          assignmentId,
          assignmentTitle,
          variantTitle,
          deadlineStr,
          tutorName,
        ).catch((err): CascadeResult => {
          console.warn("mock_exam_assign_notify_student_failed", {
            student_id: sid,
            error: String(err),
          });
          return { channel: null, failed_reason: "exception" };
        })
      ),
    );

    for (const r of results) {
      if (r.channel === "push") sentPush += 1;
      else if (r.channel === "telegram") sentTelegram += 1;
      else if (r.failed_reason === "no_channels_available") failedNoChannel += 1;
      else failed += 1;
    }
  }

  console.info("mock_exam_assign_students_completed", {
    assignment_id: assignmentId,
    added: newStudentIds.length,
    skipped_existing: skippedExisting,
    deadline_passed: deadlinePassed,
    notify,
    sent_push: sentPush,
    sent_telegram: sentTelegram,
    failed,
    failed_no_channel: failedNoChannel,
  });

  return jsonOk(cors, {
    added: newStudentIds.length,
    skipped_existing: skippedExisting,
    deadline_passed: deadlinePassed,
    notify: {
      sent_push: sentPush,
      sent_telegram: sentTelegram,
      failed,
      failed_no_channel: failedNoChannel,
    },
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Endpoint: DELETE /assignments/:id  (TASK-17 «Recipient Management»)
// ────────────────────────────────────────────────────────────────────────────
//
// Tutor удаляет пробник целиком. Cascade FK удалит:
//   - mock_exam_attempts (FK ON DELETE CASCADE)
//   - mock_exam_attempt_part1_answers (FK на attempt)
//   - mock_exam_attempt_part2_solutions (FK на attempt)
//   - mock_exam_public_links (FK на assignment)
//   - mock_exam_anonymous_leads (если есть, FK через public_link)
//
// Storage cleanup (best-effort, non-fatal): blank_photo_url, part2_bulk_photo_urls.
// .claude/rules/45-mock-exams.md: tutor выбрал «никогда не блокировать — strong confirmation
// на frontend». Backend не делает status guard; полагается на UI confirmation.

async function handleDeleteAssignment(
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

  // Collect storage refs ДО delete (FK cascade удалит rows).
  const { data: attempts } = await db
    .from("mock_exam_attempts")
    .select("blank_photo_url, part1_blank_photo_url, part2_bulk_photo_urls")
    .eq("assignment_id", assignmentId);

  const storagePaths: Array<{ bucket: string; path: string }> = [];
  for (const row of (attempts ?? []) as Array<{
    blank_photo_url: string | null;
    part1_blank_photo_url: string | null;
    part2_bulk_photo_urls: string | null;
  }>) {
    for (const ref of [row.blank_photo_url, row.part1_blank_photo_url]) {
      if (typeof ref === "string" && ref.startsWith("storage://")) {
        const parsed = parseStorageRef(ref);
        if (parsed) storagePaths.push(parsed);
      }
    }
    // part2_bulk_photo_urls — dual-format (single ref OR JSON array).
    if (typeof row.part2_bulk_photo_urls === "string") {
      const raw = row.part2_bulk_photo_urls;
      try {
        if (raw.startsWith("[")) {
          const arr = JSON.parse(raw) as unknown;
          if (Array.isArray(arr)) {
            for (const item of arr) {
              if (typeof item === "string" && item.startsWith("storage://")) {
                const parsed = parseStorageRef(item);
                if (parsed) storagePaths.push(parsed);
              }
            }
          }
        } else if (raw.startsWith("storage://")) {
          const parsed = parseStorageRef(raw);
          if (parsed) storagePaths.push(parsed);
        }
      } catch {
        // ignore malformed
      }
    }
  }

  // Cascade DELETE (FK chain handles attempts + part1_answers + part2_solutions
  // + public_links automatically).
  const { error: deleteErr } = await db
    .from("mock_exam_assignments")
    .delete()
    .eq("id", assignmentId);
  if (deleteErr) {
    console.error("mock_exam_delete_assignment_failed", {
      assignment_id: assignmentId,
      error: deleteErr.message,
    });
    return jsonError(cors, 500, "DB_ERROR", "Failed to delete assignment", {
      detail: deleteErr.message,
    });
  }

  // Best-effort storage cleanup. Group by bucket для batch remove.
  const byBucket = new Map<string, string[]>();
  for (const { bucket, path } of storagePaths) {
    if (!byBucket.has(bucket)) byBucket.set(bucket, []);
    byBucket.get(bucket)!.push(path);
  }
  let storageCleanedCount = 0;
  for (const [bucket, paths] of byBucket.entries()) {
    if (paths.length === 0) continue;
    try {
      const { error: removeErr } = await db.storage.from(bucket).remove(paths);
      if (removeErr) {
        console.warn("mock_exam_delete_storage_cleanup_partial", {
          bucket,
          error: removeErr.message,
        });
      } else {
        storageCleanedCount += paths.length;
      }
    } catch (err) {
      console.warn("mock_exam_delete_storage_cleanup_exception", {
        bucket,
        error: String(err),
      });
    }
  }

  console.info("mock_exam_assignment_deleted", {
    assignment_id: assignmentId,
    attempts_cleaned: (attempts ?? []).length,
    storage_objects_removed: storageCleanedCount,
  });

  return jsonOk(cors, {
    deleted: true,
    attempts_removed: (attempts ?? []).length,
    storage_objects_removed: storageCleanedCount,
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Endpoint: DELETE /attempts/:id  (TASK-17 «Recipient Management»)
// ────────────────────────────────────────────────────────────────────────────
//
// Tutor убирает одного ученика из пробника (case: «по ошибке назначил
// 9-класснику»). Ownership через assignment.tutor_id. FK ON DELETE CASCADE
// удаляет part1_answers + part2_solutions для этого attempt.
//
// Storage cleanup: blank_photo + part2_bulk_photo_urls этого attempt'а.
// Best-effort, non-fatal.

async function handleDeleteAttempt(
  db: SupabaseClient,
  tutorUserId: string,
  attemptId: string,
  cors: Record<string, string>,
): Promise<Response> {
  const ownedOrErr = await getOwnedAttemptOrThrow(db, attemptId, tutorUserId, cors);
  if (ownedOrErr instanceof Response) return ownedOrErr;
  const { attempt } = ownedOrErr;

  const attemptStatusAtDelete = attempt.status as string;
  const studentId = (attempt.student_id as string | null) ?? null;

  // Collect storage refs ДО delete.
  const storagePaths: Array<{ bucket: string; path: string }> = [];
  for (
    const ref of [
      attempt.blank_photo_url as string | null,
      attempt.part1_blank_photo_url as string | null,
    ]
  ) {
    if (typeof ref === "string" && ref.startsWith("storage://")) {
      const parsed = parseStorageRef(ref);
      if (parsed) storagePaths.push(parsed);
    }
  }
  const bulkRaw = attempt.part2_bulk_photo_urls as string | null;
  if (typeof bulkRaw === "string") {
    try {
      if (bulkRaw.startsWith("[")) {
        const arr = JSON.parse(bulkRaw) as unknown;
        if (Array.isArray(arr)) {
          for (const item of arr) {
            if (typeof item === "string" && item.startsWith("storage://")) {
              const parsed = parseStorageRef(item);
              if (parsed) storagePaths.push(parsed);
            }
          }
        }
      } else if (bulkRaw.startsWith("storage://")) {
        const parsed = parseStorageRef(bulkRaw);
        if (parsed) storagePaths.push(parsed);
      }
    } catch {
      // ignore malformed
    }
  }

  // Cascade DELETE (FK chain handles part1_answers + part2_solutions).
  const { error: deleteErr } = await db
    .from("mock_exam_attempts")
    .delete()
    .eq("id", attemptId);
  if (deleteErr) {
    console.error("mock_exam_delete_attempt_failed", {
      attempt_id: attemptId,
      error: deleteErr.message,
    });
    return jsonError(cors, 500, "DB_ERROR", "Failed to delete attempt", {
      detail: deleteErr.message,
    });
  }

  // Best-effort storage cleanup.
  const byBucket = new Map<string, string[]>();
  for (const { bucket, path } of storagePaths) {
    if (!byBucket.has(bucket)) byBucket.set(bucket, []);
    byBucket.get(bucket)!.push(path);
  }
  let storageCleanedCount = 0;
  for (const [bucket, paths] of byBucket.entries()) {
    if (paths.length === 0) continue;
    try {
      const { error: removeErr } = await db.storage.from(bucket).remove(paths);
      if (removeErr) {
        console.warn("mock_exam_delete_attempt_storage_cleanup_partial", {
          bucket,
          error: removeErr.message,
        });
      } else {
        storageCleanedCount += paths.length;
      }
    } catch (err) {
      console.warn("mock_exam_delete_attempt_storage_cleanup_exception", {
        bucket,
        error: String(err),
      });
    }
  }

  console.info("mock_exam_attempt_deleted", {
    attempt_id: attemptId,
    student_id: studentId,
    attempt_status_at_delete: attemptStatusAtDelete,
    storage_objects_removed: storageCleanedCount,
  });

  return jsonOk(cors, {
    deleted: true,
    student_id: studentId,
    attempt_status_at_delete: attemptStatusAtDelete,
    storage_objects_removed: storageCleanedCount,
  });
}

// ─── Фаза 2 (2026-07-20): CRUD личных вариантов ─────────────────────────────
// «Один загрузчик — N назначений», пуш 1. Репетитор создаёт СВОЙ вариант
// (с нуля / дублированием каталожного); все записи в mock_exam_variants /
// mock_exam_variant_tasks идут ТОЛЬКО здесь (единственный write-path — урок
// rule 40; клиентских write-политик нет). Чтения — клиентский PostgREST под
// RLS «каталог ∪ мои» (миграция 20260720150000).
//
// Защиты: каталожный (owner_id IS NULL) → 403 CATALOG_READONLY на правки;
// чужой личный → 404 (не палим существование); «вариант в работе» (есть
// назначения) → 409 VARIANT_IN_USE на контент-правки — детерминизм чекера и
// «что видел ученик = что проверялось» важнее удобства; UI предлагает копию.

interface VariantTaskInput {
  kim_number: number;
  part: 1 | 2;
  order_num: number;
  task_text: string;
  task_image_url: string | null;
  correct_answer: string | null;
  check_mode: string;
  max_score: number;
  solution_text: string | null;
  solution_image_urls: string | null;
  topic: string | null;
}

/** Валидация dual-format image-поля: только storage:// из белого списка бакетов.
 *  Own-namespace НЕ требуем: легитимные refs бывают чужого namespace —
 *  каталожные KB-задачи (blobs модераторов в kb-attachments) через корзину
 *  «Создать пробник» и копии каталожных вариантов (mock-exam-variant-tasks).
 *  Оба бакета содержат только платформенный контент, читаемый репетитору;
 *  SSRF невозможен (storage-ref, не URL); path traversal режет parseStorageRef.
 *  Ревью 5.6 P1 #7: капы — maxRefs (student result подписывает КАЖДЫЙ ref через
 *  Promise.all) + длина serialized-строки (анти-мусор в TEXT-колонке).
 *  Known debt: blob шарится с KB-задачей — удаление её из Базы убьёт картинку
 *  пробника (server-side blob-copy — отложенный шаг). */
const VARIANT_IMAGE_FIELD_MAX_CHARS = 4000;

function validateVariantImageField(
  raw: unknown,
  maxRefs: number,
): { ok: true; value: string | null } | { ok: false; message: string } {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== "string") return { ok: false, message: "ссылка на изображение должна быть строкой" };
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: null };
  if (trimmed.length > VARIANT_IMAGE_FIELD_MAX_CHARS) {
    return { ok: false, message: "слишком длинная ссылка на изображения" };
  }
  const refs = parseAttachmentUrls(trimmed);
  if (refs.length === 0) {
    return { ok: false, message: "некорректная ссылка на изображение" };
  }
  if (refs.length > maxRefs) {
    return { ok: false, message: `не больше ${maxRefs} фото` };
  }
  for (const ref of refs) {
    const parsed = parseStorageRef(ref);
    if (!parsed || !VARIANT_IMAGE_BUCKETS.has(parsed.bucket)) {
      return { ok: false, message: "изображение должно быть загружено через Сократ (storage://)" };
    }
  }
  return { ok: true, value: trimmed };
}

/** Маппинг RAISE-кодов вариант-RPC → HTTP (rule 97: русские фразы). */
function mapVariantRpcError(
  message: string | undefined,
  cors: Record<string, string>,
): Response | null {
  const msg = message ?? "";
  if (msg.includes("VARIANT_IN_USE")) {
    return jsonError(cors, 409, "VARIANT_IN_USE",
      "Вариант уже назначен ученикам — состав и параметры менять нельзя (ученики должны видеть то, что проверялось). Создайте копию.");
  }
  if (msg.includes("VARIANT_NOT_FOUND")) {
    return jsonError(cors, 404, "NOT_FOUND", "Variant not found");
  }
  return null;
}

/** Бизнес-валидация задач варианта. order_num назначает сервер (index+1). */
function validateVariantTasksPayload(
  rawTasks: unknown,
):
  | { ok: true; tasks: VariantTaskInput[]; part1Max: number; part2Max: number; totalMax: number }
  | { ok: false; message: string } {
  if (!Array.isArray(rawTasks) || rawTasks.length === 0) {
    return { ok: false, message: "Добавьте хотя бы одну задачу" };
  }
  if (rawTasks.length > VARIANT_TASKS_MAX) {
    return { ok: false, message: `Слишком много задач (максимум ${VARIANT_TASKS_MAX})` };
  }
  const tasks: VariantTaskInput[] = [];
  const seenKims = new Set<number>();
  let part1Max = 0;
  let part2Max = 0;
  for (let i = 0; i < rawTasks.length; i++) {
    const t = rawTasks[i];
    const label = `Задача ${i + 1}`;
    if (!t || typeof t !== "object" || Array.isArray(t)) {
      return { ok: false, message: `${label}: неверный формат` };
    }
    const row = t as Record<string, unknown>;

    const part = row.part;
    if (part !== 1 && part !== 2) {
      return { ok: false, message: `${label}: укажите часть (1 или 2)` };
    }

    const kim = row.kim_number;
    if (!isPositiveInt(kim) || kim > 99) {
      return { ok: false, message: `${label}: № КИМ должен быть целым числом 1–99` };
    }
    if (seenKims.has(kim)) {
      return { ok: false, message: `№ КИМ ${kim} повторяется — номера в варианте должны быть уникальны` };
    }
    seenKims.add(kim);

    // Капы — канон homework (MAX_TASK_IMAGES=5 / MAX_SOLUTION_IMAGES=5).
    const imageCheck = validateVariantImageField(row.task_image_url, 5);
    if (!imageCheck.ok) return { ok: false, message: `${label}: ${imageCheck.message}` };
    const solutionImagesCheck = validateVariantImageField(row.solution_image_urls, 5);
    if (!solutionImagesCheck.ok) return { ok: false, message: `${label}: ${solutionImagesCheck.message}` };

    const taskTextRaw = typeof row.task_text === "string" ? row.task_text.trim() : "";
    if (taskTextRaw.length > VARIANT_TASK_TEXT_MAX) {
      return { ok: false, message: `${label}: условие слишком длинное (максимум ${VARIANT_TASK_TEXT_MAX} символов)` };
    }
    if (!taskTextRaw && !imageCheck.value) {
      return { ok: false, message: `${label}: добавьте текст условия или фото` };
    }
    // Image-only задача — конвенция KB/ДЗ: плейсхолдер вместо пустого текста
    // (task_text NOT NULL в схеме; плейсхолдер понимают карточки и AI-пути).
    const taskText = taskTextRaw || "[Задача на фото]";

    const answerRaw = typeof row.correct_answer === "string" ? row.correct_answer.trim() : "";
    if (answerRaw.length > VARIANT_ANSWER_MAX) {
      return { ok: false, message: `${label}: ответ слишком длинный (максимум ${VARIANT_ANSWER_MAX} символов)` };
    }

    let checkMode: string;
    if (part === 1) {
      const cm = row.check_mode;
      if (typeof cm !== "string" || !VALID_PART1_CHECK_MODES.has(cm)) {
        return { ok: false, message: `${label}: для Части 1 выберите режим проверки ответа` };
      }
      checkMode = cm;
      if (!answerRaw) {
        return { ok: false, message: `${label}: для Части 1 обязателен правильный ответ (авто-проверка)` };
      }
    } else {
      // Часть 2 — всегда ручная/AI-проверка; клиентское значение игнорируем.
      checkMode = "manual";
    }

    const maxScore = row.max_score;
    if (!isPositiveInt(maxScore) || maxScore > 25) {
      return { ok: false, message: `${label}: макс. балл должен быть целым числом 1–25` };
    }

    const solutionText = typeof row.solution_text === "string" ? row.solution_text.trim() : "";
    if (solutionText.length > VARIANT_SOLUTION_MAX) {
      return { ok: false, message: `${label}: эталонное решение слишком длинное` };
    }
    const topic = typeof row.topic === "string" ? row.topic.trim().slice(0, 200) : "";

    if (part === 1) part1Max += maxScore;
    else part2Max += maxScore;

    tasks.push({
      kim_number: kim,
      part,
      order_num: i + 1,
      task_text: taskText,
      task_image_url: imageCheck.value,
      correct_answer: answerRaw || null,
      check_mode: checkMode,
      max_score: maxScore,
      solution_text: solutionText || null,
      solution_image_urls: solutionImagesCheck.value,
      topic: topic || null,
    });
  }
  return { ok: true, tasks, part1Max, part2Max, totalMax: part1Max + part2Max };
}

/** exam_type: физика пишется ЛЕГАСИ-значениями (гейт getEgePhysicsBenchmarks). */
function resolveVariantExamType(subject: string, exam: "ege" | "oge"): string {
  return subject === "physics" ? `${exam}_physics` : exam;
}

function variantExamFromExamType(examType: string): "ege" | "oge" {
  return examType.startsWith("oge") ? "oge" : "ege";
}

/** Личный вариант текущего репетитора: каталожный → 403, чужой → 404. */
async function getOwnedPersonalVariantOrThrow(
  db: SupabaseClient,
  variantId: string,
  tutorUserId: string,
  cors: Record<string, string>,
): Promise<Record<string, unknown> | Response> {
  if (!isUUID(variantId)) {
    return jsonError(cors, 400, "INVALID_ID", "Invalid variant ID");
  }
  const { data, error } = await db
    .from("mock_exam_variants")
    .select("*")
    .eq("id", variantId)
    .maybeSingle();
  if (error) return jsonError(cors, 500, "DB_ERROR", "Failed to load variant");
  if (!data || (data.owner_id !== null && data.owner_id !== tutorUserId)) {
    return jsonError(cors, 404, "NOT_FOUND", "Variant not found");
  }
  if (data.owner_id === null) {
    return jsonError(cors, 403, "CATALOG_READONLY",
      "Каталожный вариант нельзя изменить — создайте копию («Дублировать») и правьте её.");
  }
  return data as Record<string, unknown>;
}

/** «Вариант в работе» = есть хотя бы одно назначение (attempts создаются при назначении). */
async function variantHasAssignments(
  db: SupabaseClient,
  variantId: string,
): Promise<boolean | null> {
  const { data, error } = await db
    .from("mock_exam_assignments")
    .select("id")
    .eq("variant_id", variantId)
    .limit(1);
  if (error) {
    console.error("mock_exam_variant_inuse_check_failed", { error: error.message });
    return null;
  }
  return (data ?? []).length > 0;
}

// POST /variants — создать личный вариант (мета + задачи одним телом).
async function handleCreateVariant(
  db: SupabaseClient,
  tutorUserId: string,
  body: unknown,
  cors: Record<string, string>,
): Promise<Response> {
  if (!body || typeof body !== "object") {
    return jsonError(cors, 400, "INVALID_BODY", "Request body must be a JSON object");
  }
  const b = body as Record<string, unknown>;

  const title = typeof b.title === "string" ? b.title.trim() : "";
  if (!title || title.length > VARIANT_TITLE_MAX) {
    return jsonError(cors, 400, "VALIDATION", "Укажите название варианта (до 200 символов)");
  }
  const subject = typeof b.subject === "string" ? b.subject : "";
  if (!VALID_VARIANT_SUBJECTS.has(subject)) {
    return jsonError(cors, 400, "VALIDATION", "Укажите предмет варианта");
  }
  const exam = b.exam;
  if (exam !== "ege" && exam !== "oge") {
    return jsonError(cors, 400, "VALIDATION", "Укажите экзамен (ЕГЭ или ОГЭ)");
  }
  const duration = b.duration_minutes;
  if (!isPositiveInt(duration) || duration > VARIANT_DURATION_MAX_MIN) {
    return jsonError(cors, 400, "VALIDATION", `Длительность — целое число минут (1–${VARIANT_DURATION_MAX_MIN})`);
  }

  const tasksCheck = validateVariantTasksPayload(b.tasks);
  if (!tasksCheck.ok) {
    return jsonError(cors, 400, "VALIDATION", tasksCheck.message);
  }

  // Ревью 5.6 P1 #5: мета + задачи ОДНОЙ транзакцией (RPC) — двухфазный
  // insert с best-effort rollback-delete мог оставить назначаемый «пустой»
  // вариант с ненулевыми тоталами.
  const { data: createdId, error: createErr } = await db.rpc(
    "mock_exam_variant_create_with_tasks",
    {
      _meta: {
        title,
        exam_type: resolveVariantExamType(subject, exam),
        source: "tutor",
        source_attribution: null,
        duration_minutes: duration,
        created_by: tutorUserId,
        owner_id: tutorUserId,
        subject,
        variant_pdf_url: null,
      },
      _tasks: tasksCheck.tasks,
    },
  );
  if (createErr || !createdId) {
    console.error("mock_exam_variant_create_failed", { error: createErr?.message });
    return jsonError(cors, 500, "DB_ERROR", "Не удалось создать вариант. Попробуйте ещё раз.");
  }
  const variantId = createdId as string;

  console.log("mock_exam_variant_created", {
    variant_id: variantId,
    task_count: tasksCheck.tasks.length,
    subject,
  });
  return jsonOk(cors, { variant_id: variantId }, 201);
}

// PATCH /variants/:id — мета личного варианта. title — всегда; subject/exam/
// duration — только пока вариант не «в работе».
async function handleUpdateVariantMeta(
  db: SupabaseClient,
  tutorUserId: string,
  variantId: string,
  body: unknown,
  cors: Record<string, string>,
): Promise<Response> {
  const variantOrErr = await getOwnedPersonalVariantOrThrow(db, variantId, tutorUserId, cors);
  if (variantOrErr instanceof Response) return variantOrErr;
  const variant = variantOrErr;

  if (!body || typeof body !== "object") {
    return jsonError(cors, 400, "INVALID_BODY", "Request body must be a JSON object");
  }
  const b = body as Record<string, unknown>;

  // Жёсткий whitelist ключей (урок PATCH /templates, rule 40): неизвестный
  // ключ → 400, а не silent ignore.
  const ALLOWED = new Set(["title", "subject", "exam", "duration_minutes"]);
  const unknownKey = Object.keys(b).find((k) => !ALLOWED.has(k));
  if (unknownKey !== undefined) {
    return jsonError(cors, 400, "VALIDATION", `Неизвестное поле: ${unknownKey}`);
  }
  if (Object.keys(b).length === 0) {
    return jsonError(cors, 400, "VALIDATION", "Нет полей для обновления");
  }

  const patch: Record<string, unknown> = {};

  if (b.title !== undefined) {
    const title = typeof b.title === "string" ? b.title.trim() : "";
    if (!title || title.length > VARIANT_TITLE_MAX) {
      return jsonError(cors, 400, "VALIDATION", "Название — непустая строка до 200 символов");
    }
    patch.title = title;
  }

  const touchesContentMeta =
    b.subject !== undefined || b.exam !== undefined || b.duration_minutes !== undefined;

  if (touchesContentMeta) {
    // Ревью 5.6 P1 #3: content-мета — через ту же RPC (_tasks NULL = meta-only):
    // FOR UPDATE + in-use гард в одной транзакции (никакого TOCTOU-окна между
    // pre-check и UPDATE). Дружелюбный pre-check — для быстрого 409.
    const inUse = await variantHasAssignments(db, variantId);
    if (inUse === null) return jsonError(cors, 500, "DB_ERROR", "Failed to check variant usage");
    if (inUse) {
      return jsonError(cors, 409, "VARIANT_IN_USE",
        "Вариант уже назначен ученикам — предмет, экзамен и длительность менять нельзя. Создайте копию.");
    }

    let subject = (variant.subject as string | null) ?? "physics";
    if (b.subject !== undefined) {
      if (typeof b.subject !== "string" || !VALID_VARIANT_SUBJECTS.has(b.subject)) {
        return jsonError(cors, 400, "VALIDATION", "Неверный предмет");
      }
      subject = b.subject;
    }
    let exam = variantExamFromExamType(variant.exam_type as string);
    if (b.exam !== undefined) {
      if (b.exam !== "ege" && b.exam !== "oge") {
        return jsonError(cors, 400, "VALIDATION", "Экзамен — ege или oge");
      }
      exam = b.exam;
    }
    let duration: number | null = null;
    if (b.duration_minutes !== undefined) {
      if (!isPositiveInt(b.duration_minutes) || b.duration_minutes > VARIANT_DURATION_MAX_MIN) {
        return jsonError(cors, 400, "VALIDATION", `Длительность — целое число минут (1–${VARIANT_DURATION_MAX_MIN})`);
      }
      duration = b.duration_minutes;
    }

    const { error: rpcErr } = await db.rpc("mock_exam_variant_replace_tasks", {
      _variant_id: variantId,
      _tasks: null,
      _title: (patch.title as string | undefined) ?? null,
      _subject: b.subject !== undefined ? subject : null,
      // exam_type пересчитывается при любой смене subject/exam (легаси-гейт физики).
      _exam_type: resolveVariantExamType(subject, exam),
      _duration_minutes: duration,
    });
    if (rpcErr) {
      const mapped = mapVariantRpcError(rpcErr.message, cors);
      if (mapped) return mapped;
      console.error("mock_exam_variant_update_failed", { error: rpcErr.message });
      return jsonError(cors, 500, "DB_ERROR", "Не удалось сохранить изменения. Попробуйте ещё раз.");
    }
    return jsonOk(cors, { updated: true });
  }

  // Title-only (разрешён и для назначенного варианта) — прямой UPDATE.
  const { error: updErr } = await db
    .from("mock_exam_variants")
    .update(patch)
    .eq("id", variantId);
  if (updErr) {
    console.error("mock_exam_variant_update_failed", { error: updErr.message });
    return jsonError(cors, 500, "DB_ERROR", "Не удалось сохранить изменения. Попробуйте ещё раз.");
  }
  return jsonOk(cors, { updated: true });
}

// PUT /variants/:id/tasks — атомарное сохранение контента: задачи + опц. мета
// (ревью 5.6 P1 #4: PATCH меты и PUT задач по отдельности оставляли вариант
// частично изменённым — «предмет сменился, задачи не доехали» грейдился бы не
// той рубрикой). Редактор шлёт всё одним вызовом; RPC — одна транзакция с
// FOR UPDATE + in-use гардом (P1 #3 TOCTOU: pre-check здесь — только для
// быстрого дружелюбного 409, авторитет — гард ВНУТРИ RPC).
async function handleReplaceVariantTasks(
  db: SupabaseClient,
  tutorUserId: string,
  variantId: string,
  body: unknown,
  cors: Record<string, string>,
): Promise<Response> {
  const variantOrErr = await getOwnedPersonalVariantOrThrow(db, variantId, tutorUserId, cors);
  if (variantOrErr instanceof Response) return variantOrErr;
  const variant = variantOrErr;

  const inUse = await variantHasAssignments(db, variantId);
  if (inUse === null) return jsonError(cors, 500, "DB_ERROR", "Failed to check variant usage");
  if (inUse) {
    return jsonError(cors, 409, "VARIANT_IN_USE",
      "Вариант уже назначен ученикам — состав задач менять нельзя (ученики должны видеть то, что проверялось). Создайте копию.");
  }

  if (!body || typeof body !== "object") {
    return jsonError(cors, 400, "INVALID_BODY", "Request body must be a JSON object");
  }
  const b = body as Record<string, unknown>;
  const tasksCheck = validateVariantTasksPayload(b.tasks);
  if (!tasksCheck.ok) {
    return jsonError(cors, 400, "VALIDATION", tasksCheck.message);
  }

  // Опциональная мета (редактор шлёт полный набор; отсутствие поля = не менять).
  let metaTitle: string | null = null;
  if (b.title !== undefined) {
    const title = typeof b.title === "string" ? b.title.trim() : "";
    if (!title || title.length > VARIANT_TITLE_MAX) {
      return jsonError(cors, 400, "VALIDATION", "Название — непустая строка до 200 символов");
    }
    metaTitle = title;
  }
  let metaSubject: string | null = null;
  if (b.subject !== undefined) {
    if (typeof b.subject !== "string" || !VALID_VARIANT_SUBJECTS.has(b.subject)) {
      return jsonError(cors, 400, "VALIDATION", "Неверный предмет");
    }
    metaSubject = b.subject;
  }
  let metaExam: "ege" | "oge" | null = null;
  if (b.exam !== undefined) {
    if (b.exam !== "ege" && b.exam !== "oge") {
      return jsonError(cors, 400, "VALIDATION", "Экзамен — ege или oge");
    }
    metaExam = b.exam;
  }
  let metaDuration: number | null = null;
  if (b.duration_minutes !== undefined) {
    if (!isPositiveInt(b.duration_minutes) || b.duration_minutes > VARIANT_DURATION_MAX_MIN) {
      return jsonError(cors, 400, "VALIDATION", `Длительность — целое число минут (1–${VARIANT_DURATION_MAX_MIN})`);
    }
    metaDuration = b.duration_minutes;
  }
  // exam_type пересчитывается из ФИНАЛЬНЫХ subject+exam (легаси-гейт физики).
  let metaExamType: string | null = null;
  if (metaSubject !== null || metaExam !== null) {
    const effSubject = metaSubject ?? ((variant.subject as string | null) ?? "physics");
    const effExam = metaExam ?? variantExamFromExamType(variant.exam_type as string);
    metaExamType = resolveVariantExamType(effSubject, effExam);
  }

  const { error: rpcErr } = await db.rpc("mock_exam_variant_replace_tasks", {
    _variant_id: variantId,
    _tasks: tasksCheck.tasks,
    _title: metaTitle,
    _subject: metaSubject,
    _exam_type: metaExamType,
    _duration_minutes: metaDuration,
  });
  if (rpcErr) {
    const mapped = mapVariantRpcError(rpcErr.message, cors);
    if (mapped) return mapped;
    console.error("mock_exam_variant_replace_failed", { error: rpcErr.message });
    return jsonError(cors, 500, "DB_ERROR", "Не удалось сохранить задачи. Попробуйте ещё раз.");
  }
  return jsonOk(cors, {
    updated: true,
    task_count: tasksCheck.tasks.length,
    total_max_score: tasksCheck.totalMax,
  });
}

// POST /variants/:id/duplicate — копия каталожного ИЛИ своего варианта.
// Закрывает запрос Елены/Ульяны: дубль → замена задач → назначение.
async function handleDuplicateVariant(
  db: SupabaseClient,
  tutorUserId: string,
  variantId: string,
  cors: Record<string, string>,
): Promise<Response> {
  if (!isUUID(variantId)) {
    return jsonError(cors, 400, "INVALID_ID", "Invalid variant ID");
  }
  const { data: source, error: srcErr } = await db
    .from("mock_exam_variants")
    .select("*")
    .eq("id", variantId)
    .maybeSingle();
  if (srcErr) return jsonError(cors, 500, "DB_ERROR", "Failed to load variant");
  if (!source || (source.owner_id !== null && source.owner_id !== tutorUserId)) {
    return jsonError(cors, 404, "NOT_FOUND", "Variant not found");
  }

  const { data: sourceTasks, error: tasksErr } = await db
    .from("mock_exam_variant_tasks")
    .select("kim_number, part, order_num, task_text, task_image_url, correct_answer, check_mode, max_score, solution_text, solution_image_urls, topic")
    .eq("variant_id", variantId)
    .order("order_num", { ascending: true });
  if (tasksErr || !sourceTasks || sourceTasks.length === 0) {
    return jsonError(cors, 500, "DB_ERROR", "Failed to load variant tasks");
  }

  const copyTitle = `Копия — ${source.title as string}`.slice(0, VARIANT_TITLE_MAX);
  // Ревью 5.6 P1 #5: копия создаётся ОДНОЙ транзакцией (мета + задачи).
  // Задачи копируются со ссылками на ТЕ ЖЕ storage-объекты (blob-copy —
  // отложенный шаг; каталожный бакет read-only для клиента).
  const { data: createdId, error: createErr } = await db.rpc(
    "mock_exam_variant_create_with_tasks",
    {
      _meta: {
        title: copyTitle,
        exam_type: source.exam_type,
        source: "tutor",
        // Провенанс контента сохраняем (копия каталожного = контент Егора/ФИПИ).
        source_attribution: source.source_attribution ?? null,
        duration_minutes: source.duration_minutes,
        created_by: tutorUserId,
        owner_id: tutorUserId,
        subject: (source.subject as string | null) ?? "physics",
        // PDF условий НЕ копируем: после замены задач он стал бы враньём.
        variant_pdf_url: null,
      },
      _tasks: sourceTasks,
    },
  );
  if (createErr || !createdId) {
    console.error("mock_exam_variant_duplicate_failed", { error: createErr?.message });
    return jsonError(cors, 500, "DB_ERROR", "Не удалось создать копию. Попробуйте ещё раз.");
  }
  const newVariantId = createdId as string;

  console.log("mock_exam_variant_duplicated", {
    source_variant_id: variantId,
    variant_id: newVariantId,
    source_is_catalog: source.owner_id === null,
  });
  return jsonOk(cors, { variant_id: newVariantId }, 201);
}

// DELETE /variants/:id — только личный, не назначенный.
async function handleDeleteVariant(
  db: SupabaseClient,
  tutorUserId: string,
  variantId: string,
  cors: Record<string, string>,
): Promise<Response> {
  const variantOrErr = await getOwnedPersonalVariantOrThrow(db, variantId, tutorUserId, cors);
  if (variantOrErr instanceof Response) return variantOrErr;

  const inUse = await variantHasAssignments(db, variantId);
  if (inUse === null) return jsonError(cors, 500, "DB_ERROR", "Failed to check variant usage");
  if (inUse) {
    return jsonError(cors, 409, "VARIANT_IN_USE",
      "Вариант уже назначен ученикам — удалить нельзя (история результатов сломается). Сначала удалите назначения.");
  }

  // Storage-блобы НЕ трогаем: kb-attachments может шариться с задачами Базы
  // (KB storage-protection триггер — backstop), каталожный бакет — не наш.
  const { error: delErr } = await db
    .from("mock_exam_variants")
    .delete()
    .eq("id", variantId);
  if (delErr) {
    // FK RESTRICT от mock_exam_assignments — backstop при гонке с назначением.
    console.error("mock_exam_variant_delete_failed", { error: delErr.message });
    return jsonError(cors, 409, "VARIANT_IN_USE",
      "Вариант уже назначен ученикам — удалить нельзя.");
  }
  return jsonOk(cors, { deleted: true });
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

    // DELETE /assignments/:id (TASK-17 «Recipient Management»)
    if (seg.length === 2 && seg[0] === "assignments" && route.method === "DELETE") {
      return await handleDeleteAssignment(db, userId, seg[1], cors);
    }

    // POST /assignments/:id/assign-students (TASK-17 «Recipient Management»)
    if (
      seg.length === 3 && seg[0] === "assignments" &&
      seg[2] === "assign-students" && route.method === "POST"
    ) {
      const body = await parseJsonBody(req);
      return await handleAssignStudents(db, userId, seg[1], body, cors);
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

    // DELETE /attempts/:id (TASK-17 «Recipient Management» — remove individual student)
    if (seg.length === 2 && seg[0] === "attempts" && route.method === "DELETE") {
      return await handleDeleteAttempt(db, userId, seg[1], cors);
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

    // POST /attempts/:id/retry-part1-ocr  (TASK-16 — force-re-run AI OCR)
    if (
      seg.length === 3 && seg[0] === "attempts" &&
      seg[2] === "retry-part1-ocr" && route.method === "POST"
    ) {
      return await handleRetryPart1OCR(db, userId, seg[1], cors);
    }

    // POST /attempts/:id/recheck-part1  (AC-P4 2026-05-25 — partial credit re-grade)
    // Tutor manually re-grades Часть 1 по обновлённым ФИПИ 2026 critериям
    // (gradeMultiChoice / gradeOrdered partial credit). Preserves manual tutor edits.
    if (
      seg.length === 3 && seg[0] === "attempts" &&
      seg[2] === "recheck-part1" && route.method === "POST"
    ) {
      return await handleRecheckPart1(db, userId, seg[1], cors);
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

    // 2026-06-11 — POST /attempts/:id/curate-part2-task
    // Per-task курирование Части 2: скрыть AI разбор + комментарий ученику (без approval).
    if (
      seg.length === 3 && seg[0] === "attempts" &&
      seg[2] === "curate-part2-task" && route.method === "POST"
    ) {
      const body = await parseJsonBody(req);
      return await handleCuratePart2Task(db, userId, seg[1], body, cors);
    }

    // 2026-06-11 — POST /attempts/:id/curate-part2-hide-all
    if (
      seg.length === 3 && seg[0] === "attempts" &&
      seg[2] === "curate-part2-hide-all" && route.method === "POST"
    ) {
      const body = await parseJsonBody(req);
      return await handleCuratePart2HideAll(db, userId, seg[1], body, cors);
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

    // ── Фаза 2 (2026-07-20): CRUD личных вариантов ──
    // Чтения (список/prefill) — клиентский PostgREST под RLS «каталог ∪ мои».

    // POST /variants — создать личный вариант (мета + задачи одним телом)
    if (seg.length === 1 && seg[0] === "variants" && route.method === "POST") {
      const body = await parseJsonBody(req);
      return await handleCreateVariant(db, userId, body, cors);
    }

    // PATCH /variants/:id — мета (title всегда; subject/exam/duration — пока не в работе)
    if (seg.length === 2 && seg[0] === "variants" && route.method === "PATCH") {
      const body = await parseJsonBody(req);
      return await handleUpdateVariantMeta(db, userId, seg[1], body, cors);
    }

    // DELETE /variants/:id — только личный, не назначенный
    if (seg.length === 2 && seg[0] === "variants" && route.method === "DELETE") {
      return await handleDeleteVariant(db, userId, seg[1], cors);
    }

    // PUT /variants/:id/tasks — полная замена задач (атомарная RPC)
    if (
      seg.length === 3 && seg[0] === "variants" &&
      seg[2] === "tasks" && route.method === "PUT"
    ) {
      const body = await parseJsonBody(req);
      return await handleReplaceVariantTasks(db, userId, seg[1], body, cors);
    }

    // POST /variants/:id/duplicate — копия каталожного или своего
    if (
      seg.length === 3 && seg[0] === "variants" &&
      seg[2] === "duplicate" && route.method === "POST"
    ) {
      return await handleDuplicateVariant(db, userId, seg[1], cors);
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
