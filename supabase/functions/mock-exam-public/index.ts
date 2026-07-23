// Mock Exams v1 — public anonymous flows (TASK-6 of mock-exams-v1).
//
// Endpoints:
//   GET  /share/mock-invite/:slug          — anonymous read invite metadata
//                                             (tutor card + variant + tasks
//                                             БЕЗ correct_answer / solution_text)
//   POST /share/mock-invite/:slug/start    — anonymous attempt creation +
//                                             lead capture (имя/контакт/consent)
//   GET  /share/mock-result/:slug          — read approved result (parent share)
//
// Spec: docs/delivery/features/mock-exams-v1/spec.md §5 API public + AC-6/AC-7
// Migration: supabase/migrations/20260508120000_mock_exams_v1_schema.sql
//
// Architecture decisions (mirrors public-homework-share/index.ts):
//   - service_role client (auth.persistSession=false) — обходит RLS
//     намеренно. Authenticated PostgREST доступ защищён отдельными RLS policies
//     (см. миграцию §10).
//   - CORS: permissive `*` — public endpoint без cookies/auth.
//   - Slug regex /^[a-z0-9]{8}$/i проверяется ДО любого DB-запроса —
//     не leak'аем существование slug'ов произвольным запросом.
//   - Anti-leak SELECT column whitelists. Никогда `select("*")`. Tutor
//     never exposes telegram_id / telegram_username / booking_link / email
//     через public read. Variant tasks для invite read'а никогда не
//     включают correct_answer / solution_text.
//   - Signed URLs обёрнуты в rewriteToProxy() — RU bypass (AGENTS.md (Network & RU bypass)).
//   - Telemetry: console.warn JSON server-side, без PII (только slug + event).

import { createClient } from "npm:@supabase/supabase-js@2";
import type { SupabaseClient as SupabaseClientType } from "npm:@supabase/supabase-js@2";
import { rewriteToProxy } from "../_shared/proxy-url.ts";
import {
  sendPushNotification,
  type PushPayload,
  type PushSubscriptionData,
} from "../_shared/push-sender.ts";

// ─── Constants ───────────────────────────────────────────────────────────────

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT =
  Deno.env.get("VAPID_SUBJECT") ?? "mailto:support@sokratai.ru";
const PUBLIC_APP_URL =
  Deno.env.get("PUBLIC_APP_URL")?.trim().replace(/\/$/, "") ??
  "https://sokratai.ru";
const SLUG_RE = /^[a-z0-9]{8}$/i;
const SIGNED_URL_TTL_SEC = 3600;
const LEAD_NAME_MAX = 200;
const LEAD_CONTACT_MAX = 200;
const VALID_CONTACT_TYPES = new Set(["telegram", "email"]);
const VARIANT_TASK_BUCKET = "mock-exam-variant-tasks";
const PART2_PHOTO_BUCKET = "mock-exam-part2-photos";
const BLANK_BUCKET = "mock-exam-blanks";

// ─── CORS / response helpers ─────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const jsonHeaders = {
  ...corsHeaders,
  "Content-Type": "application/json",
};

type SupabaseClient = SupabaseClientType<any, any, any>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

// ─── Telemetry — server-side only, PII-free ──────────────────────────────────

function logEvent(
  event: string,
  slug: string,
  extra?: Record<string, unknown>,
): void {
  // Slug сам по себе достаточен для корреляции (он ≠ user identity).
  // Никаких lead_name / lead_contact / IP / user_id здесь.
  console.warn(JSON.stringify({
    event,
    slug,
    timestamp: new Date().toISOString(),
    ...extra,
  }));
}

// ─── Routing ─────────────────────────────────────────────────────────────────

interface RouteMatch {
  segments: string[];
  method: string;
}

function parseRoute(req: Request): RouteMatch {
  const url = new URL(req.url);
  const idx = url.pathname.indexOf("mock-exam-public");
  const rest = idx >= 0
    ? url.pathname.slice(idx + "mock-exam-public".length)
    : url.pathname;
  return {
    segments: rest.split("/").filter(Boolean),
    method: req.method,
  };
}

// ─── Storage helpers (path-traversal safe + RU proxy rewrite) ────────────────

function hasUnsafeObjectPath(path: string): boolean {
  return path
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean)
    .some((s) => s === ".." || s.includes("\\") || s.includes("\0"));
}

function parseStorageRef(
  value: string | null | undefined,
  defaultBucket: string,
): { bucket: string; objectPath: string } | null {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Already an absolute URL (e.g. external image): caller skips signing.
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return null;
  }
  if (trimmed.startsWith("storage://")) {
    const rest = trimmed.slice("storage://".length);
    const slashIdx = rest.indexOf("/");
    if (slashIdx <= 0 || slashIdx === rest.length - 1) return null;
    const objectPath = rest.slice(slashIdx + 1).replace(/^\/+/, "");
    if (hasUnsafeObjectPath(objectPath)) return null;
    return { bucket: rest.slice(0, slashIdx), objectPath };
  }
  const objectPath = trimmed.replace(/^\/+/, "");
  if (hasUnsafeObjectPath(objectPath)) return null;
  return { bucket: defaultBucket, objectPath };
}

async function resolveSignedUrl(
  db: SupabaseClient,
  ref: string | null | undefined,
  defaultBucket: string,
): Promise<string | null> {
  if (!ref) return null;
  // Pass-through absolute HTTPS URLs (e.g. external image hosting).
  if (ref.startsWith("http://") || ref.startsWith("https://")) return ref;
  const parsed = parseStorageRef(ref, defaultBucket);
  if (!parsed) return null;
  const { data, error } = await db.storage
    .from(parsed.bucket)
    .createSignedUrl(parsed.objectPath, SIGNED_URL_TTL_SEC);
  if (error || !data?.signedUrl) {
    console.warn("mock_exam_public_signed_url_failed", {
      bucket: parsed.bucket,
      error: error?.message,
    });
    return null;
  }
  return rewriteToProxy(data.signedUrl);
}

// ─── Validation helpers ──────────────────────────────────────────────────────

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

async function parseJsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

// ─── Tutor card whitelist ────────────────────────────────────────────────────
//
// HARD anti-leak invariant: только публично-безопасные поля. Никогда
// telegram_id / telegram_username / booking_link / id / user_id / email.
// Если расширяешь — обоснуй каждое новое поле. Default = NOT EXPOSE.

interface PublicTutorCard {
  name: string;
  avatar_url: string | null;
  bio: string | null;
  subjects: string[];
}

async function loadTutorCard(
  db: SupabaseClient,
  tutorUserId: string,
): Promise<PublicTutorCard | null> {
  const { data, error } = await db
    .from("tutors")
    .select("name, avatar_url, bio, subjects")
    .eq("user_id", tutorUserId)
    .maybeSingle();
  if (error) {
    console.warn("mock_exam_public_tutor_card_failed", { error: error.message });
    return null;
  }
  if (!data) return null;
  return {
    name: (data.name as string) ?? "",
    avatar_url: (data.avatar_url as string | null) ?? null,
    bio: (data.bio as string | null) ?? null,
    subjects: Array.isArray(data.subjects) ? (data.subjects as string[]) : [],
  };
}

// ─── GET /share/mock-invite/:slug ────────────────────────────────────────────

async function handleInviteRead(
  db: SupabaseClient,
  slug: string,
): Promise<Response> {
  const { data: link, error: linkErr } = await db
    .from("mock_exam_public_links")
    .select("slug, scope, mock_exam_id, tutor_id, expires_at")
    .eq("slug", slug)
    .eq("scope", "invite")
    .maybeSingle();

  if (linkErr) {
    console.error("mock_exam_public_invite_link_failed", {
      error: linkErr.message,
    });
    return jsonResponse({ error: "internal_error" }, 500);
  }
  if (!link || !link.mock_exam_id) {
    return jsonResponse({ error: "not_found" }, 404);
  }
  if (link.expires_at && new Date(link.expires_at).getTime() < Date.now()) {
    logEvent("mock_exam_invite_visited_expired", slug);
    return jsonResponse({ expired: true, error: "expired" }, 410);
  }

  // Assignment whitelist — НЕ селектим tutor_id напрямую в публичном payload
  // (мы уже знаем его из link). Закрытые / draft назначения не показываем.
  const { data: assignment, error: asgErr } = await db
    .from("mock_exam_assignments")
    .select("id, title, mode, status, variant_id")
    .eq("id", link.mock_exam_id)
    .maybeSingle();
  if (asgErr) {
    console.error("mock_exam_public_invite_assignment_failed", {
      error: asgErr.message,
    });
    return jsonResponse({ error: "internal_error" }, 500);
  }
  if (!assignment) {
    return jsonResponse({ error: "not_found" }, 404);
  }
  if (
    assignment.status !== "active" ||
    assignment.mode === "manual_entry" ||
    !assignment.variant_id
  ) {
    // Manual entry / closed / draft не имеют публичного потока.
    return jsonResponse({ error: "not_available" }, 410);
  }

  // Variant metadata — public-safe (catalog item).
  const { data: variant } = await db
    .from("mock_exam_variants")
    .select(
      // `subject` — ревью 5.6 P1 #4: публичное приглашение обязано знать предмет,
      // иначе ученик обществознания читает «пробник по физике».
      "title, exam_type, subject, source, source_attribution, " +
        "duration_minutes, total_max_score, part1_max, part2_max, task_count",
    )
    .eq("id", assignment.variant_id)
    .maybeSingle();

  // Tasks: КОЛОНОЧНЫЙ whitelist без correct_answer / solution_text. Это
  // anonymous student exam surface — не должен видеть ответы. После
  // approval (parent_result) ответы открываются отдельным endpoint'ом.
  const { data: variantTasks, error: tasksErr } = await db
    .from("mock_exam_variant_tasks")
    .select(
      "id, kim_number, part, order_num, task_text, task_image_url, check_mode, max_score",
    )
    .eq("variant_id", assignment.variant_id)
    .order("order_num", { ascending: true });
  if (tasksErr) {
    console.error("mock_exam_public_invite_tasks_failed", {
      error: tasksErr.message,
    });
    return jsonResponse({ error: "internal_error" }, 500);
  }

  const tasks = await Promise.all(
    (variantTasks ?? []).map(async (t) => ({
      id: t.id,
      kim_number: t.kim_number,
      part: t.part,
      order_num: t.order_num,
      task_text: t.task_text,
      task_image_url: await resolveSignedUrl(
        db,
        t.task_image_url as string | null,
        VARIANT_TASK_BUCKET,
      ),
      check_mode: t.check_mode,
      max_score: t.max_score,
    })),
  );

  const tutor = await loadTutorCard(db, link.tutor_id as string);

  logEvent("mock_exam_invite_visited", slug);

  return jsonResponse({
    expired: false,
    assignment: {
      id: assignment.id,
      title: assignment.title,
      mode: assignment.mode,
    },
    tutor,
    variant: variant
      ? {
        title: variant.title,
        exam_type: variant.exam_type,
        source: variant.source,
        source_attribution: variant.source_attribution,
        duration_minutes: variant.duration_minutes,
        total_max_score: variant.total_max_score,
        part1_max: variant.part1_max,
        part2_max: variant.part2_max,
        task_count: variant.task_count,
      }
      : null,
    tasks,
    expires_at: link.expires_at,
  });
}

// ─── POST /share/mock-invite/:slug/start ─────────────────────────────────────
//
// AC-6: anonymous flow создаёт mock_exam_anonymous_leads запись + attempt.
// Body shape:
//   {
//     lead_name: string (1..200),
//     lead_contact: string (1..200),
//     contact_type: 'telegram' | 'email',
//     consent: true                           — boolean (gate, must be true)
//   }
// Server-recorded consent_at = now() (audit trail; client-side timestamps
// не доверяем для юридического trail).
//
// Returns 201 with { attempt_id, anonymous_id } on success.

async function handleInviteStart(
  db: SupabaseClient,
  slug: string,
  body: unknown,
): Promise<Response> {
  if (!body || typeof body !== "object") {
    return jsonResponse({ error: "invalid_body" }, 400);
  }
  const b = body as Record<string, unknown>;

  if (!isNonEmptyString(b.lead_name)) {
    return jsonResponse(
      { error: "validation", field: "lead_name", message: "required" },
      400,
    );
  }
  const leadName = (b.lead_name as string).trim();
  if (leadName.length > LEAD_NAME_MAX) {
    return jsonResponse(
      { error: "validation", field: "lead_name", message: "too_long" },
      400,
    );
  }

  if (!isNonEmptyString(b.lead_contact)) {
    return jsonResponse(
      { error: "validation", field: "lead_contact", message: "required" },
      400,
    );
  }
  const leadContact = (b.lead_contact as string).trim();
  if (leadContact.length > LEAD_CONTACT_MAX) {
    return jsonResponse(
      { error: "validation", field: "lead_contact", message: "too_long" },
      400,
    );
  }

  if (
    !isNonEmptyString(b.contact_type) ||
    !VALID_CONTACT_TYPES.has(b.contact_type as string)
  ) {
    return jsonResponse(
      { error: "validation", field: "contact_type", message: "invalid" },
      400,
    );
  }

  // Consent gate: accept either { consent: true } OR { consent_at: true } —
  // обе формы юридически означают «дал согласие». Server stores now().
  const consentGiven =
    b.consent === true || b.consent_at === true ||
    (isNonEmptyString(b.consent_at));
  if (!consentGiven) {
    return jsonResponse(
      { error: "validation", field: "consent", message: "consent_required" },
      400,
    );
  }

  // Resolve link + assignment (re-checked vs invite-read because invite link
  // could expire / assignment could be closed between read и start).
  const { data: link, error: linkErr } = await db
    .from("mock_exam_public_links")
    .select("slug, scope, mock_exam_id, tutor_id, expires_at")
    .eq("slug", slug)
    .eq("scope", "invite")
    .maybeSingle();
  if (linkErr) {
    console.error("mock_exam_public_invite_start_link_failed", {
      error: linkErr.message,
    });
    return jsonResponse({ error: "internal_error" }, 500);
  }
  if (!link || !link.mock_exam_id) {
    return jsonResponse({ error: "not_found" }, 404);
  }
  if (link.expires_at && new Date(link.expires_at).getTime() < Date.now()) {
    logEvent("mock_exam_invite_start_expired", slug);
    return jsonResponse({ expired: true, error: "expired" }, 410);
  }

  const { data: assignment } = await db
    .from("mock_exam_assignments")
    .select("id, status, mode, variant_id")
    .eq("id", link.mock_exam_id)
    .maybeSingle();
  if (
    !assignment ||
    assignment.status !== "active" ||
    assignment.mode === "manual_entry" ||
    !assignment.variant_id
  ) {
    return jsonResponse({ error: "not_available" }, 410);
  }

  // Create attempt + lead. 2-step с manual rollback при ошибке lead
  // (Postgres транзакции через PostgREST не доступны; rollback
  // best-effort для избежания сирот в attempt-таблице).
  const anonymousId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const consentAt = startedAt;

  const { data: attempt, error: attemptErr } = await db
    .from("mock_exam_attempts")
    .insert({
      assignment_id: assignment.id,
      student_id: null,
      anonymous_id: anonymousId,
      status: "in_progress",
      started_at: startedAt,
    })
    .select("id, anonymous_id")
    .single();
  if (attemptErr || !attempt) {
    console.error("mock_exam_public_invite_start_attempt_failed", {
      error: attemptErr?.message,
    });
    return jsonResponse({ error: "internal_error" }, 500);
  }

  const { error: leadErr } = await db
    .from("mock_exam_anonymous_leads")
    .insert({
      attempt_id: attempt.id,
      lead_name: leadName,
      lead_contact: leadContact,
      contact_type: b.contact_type,
      tutor_id: link.tutor_id,
      consent_at: consentAt,
    });
  if (leadErr) {
    // Rollback attempt to avoid orphan row.
    await db.from("mock_exam_attempts").delete().eq("id", attempt.id);
    console.error("mock_exam_public_invite_start_lead_failed", {
      error: leadErr.message,
    });
    return jsonResponse({ error: "internal_error" }, 500);
  }

  // AC-6: notify tutor of the new anonymous lead. Best-effort, swallows
  // errors — the lead row is already persisted, that's the source of truth
  // tutor will see in dashboard regardless of push delivery.
  try {
    await notifyTutorOfNewLead(
      db,
      link.tutor_id as string,
      assignment.id as string,
      slug,
      b.contact_type as string,
    );
  } catch (err) {
    console.warn("mock_exam_lead_push_outer_throw", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  logEvent("mock_exam_invite_started", slug, {
    contact_type: b.contact_type as string,
  });

  return jsonResponse(
    {
      attempt_id: attempt.id,
      anonymous_id: attempt.anonymous_id,
    },
    201,
  );
}

// ─── Tutor push on new anonymous lead (AC-6) ────────────────────────────────
//
// Best-effort push fan-out на все subscriptions репетитора. Никогда не
// блокирует и не ломает ответ клиенту. VAPID env missing → silent skip
// (consistent с homework-api pattern).
//
// PII discipline: payload **не содержит** lead_name / lead_contact —
// service worker'у не нужно знать кто конкретно. Tutor увидит детали
// в dashboard по deep-link'у. Мы лишь сигналим что lead появился.
//
// Не реализовано здесь намеренно (fast follow-up):
// - Telegram leg cascade (требует resolution tutor.telegram_user_id из
//   profiles + sessions). Push покрывает AC-6 strict; Telegram добавится
//   когда понадобится для tutors без push opt-in (см. follow-ups в
//   project_mock_exams_v1.md).
// - In-app notification badge на /tutor/home (P1, отдельный TASK).

async function notifyTutorOfNewLead(
  db: SupabaseClient,
  tutorUserId: string,
  assignmentId: string,
  slug: string,
  contactType: string,
): Promise<void> {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.warn(JSON.stringify({
      event: "mock_exam_lead_push_skipped",
      reason: "vapid_not_configured",
      slug,
    }));
    return;
  }

  const { data: subs, error: subsErr } = await db
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("user_id", tutorUserId);

  if (subsErr) {
    console.warn("mock_exam_lead_push_subs_query_failed", {
      error: subsErr.message,
    });
    return;
  }
  if (!subs || subs.length === 0) {
    console.warn(JSON.stringify({
      event: "mock_exam_lead_push_skipped",
      reason: "no_subscriptions",
      slug,
    }));
    return;
  }

  const payload: PushPayload = {
    title: "Новый лид на пробник",
    // PII-free body: имя/контакт не попадают в notification preview.
    body:
      contactType === "telegram"
        ? "Кто-то прошёл инвайт и оставил Telegram. Откройте, чтобы связаться."
        : "Кто-то прошёл инвайт и оставил email. Откройте, чтобы связаться.",
    url: `${PUBLIC_APP_URL}/tutor/mock-exams/${assignmentId}`,
  };

  let delivered = 0;
  let removedExpired = 0;
  for (const row of subs) {
    const sub: PushSubscriptionData = {
      endpoint: row.endpoint as string,
      p256dh: row.p256dh as string,
      auth: row.auth as string,
    };
    let res;
    try {
      res = await sendPushNotification(
        sub,
        payload,
        VAPID_PUBLIC_KEY,
        VAPID_PRIVATE_KEY,
        VAPID_SUBJECT,
      );
    } catch (err) {
      console.warn("mock_exam_lead_push_send_throw", {
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    if (res.success) {
      delivered += 1;
      continue;
    }

    if (res.gone) {
      // 410 Gone — clean up dead subscription
      await db
        .from("push_subscriptions")
        .delete()
        .eq("endpoint", sub.endpoint)
        .eq("user_id", tutorUserId);
      removedExpired += 1;
      continue;
    }

    if (res.status >= 500) {
      // Single retry on 5xx (mirror homework-api pattern)
      try {
        const retry = await sendPushNotification(
          sub,
          payload,
          VAPID_PUBLIC_KEY,
          VAPID_PRIVATE_KEY,
          VAPID_SUBJECT,
        );
        if (retry.success) {
          delivered += 1;
          continue;
        }
        if (retry.gone) {
          await db
            .from("push_subscriptions")
            .delete()
            .eq("endpoint", sub.endpoint)
            .eq("user_id", tutorUserId);
          removedExpired += 1;
        }
      } catch (err) {
        console.warn("mock_exam_lead_push_retry_throw", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  console.warn(JSON.stringify({
    event: "mock_exam_lead_push_dispatched",
    slug,
    sub_count: subs.length,
    delivered,
    removed_expired: removedExpired,
  }));
}

// ─── GET /share/mock-result/:slug ────────────────────────────────────────────
//
// AC-7: parent share-link 200 OK без auth, 403 если status != approved.
// Manual_entry attempts (terminal status='manually_entered') считаются
// approved-equivalent — у них total_score сразу заполнен tutor'ом. Но
// part1_answers / part2_solutions у них пусты по дизайну.

async function handleResultRead(
  db: SupabaseClient,
  slug: string,
): Promise<Response> {
  const { data: link, error: linkErr } = await db
    .from("mock_exam_public_links")
    .select("slug, scope, attempt_id, tutor_id, expires_at")
    .eq("slug", slug)
    .eq("scope", "parent_result")
    .maybeSingle();

  if (linkErr) {
    console.error("mock_exam_public_result_link_failed", {
      error: linkErr.message,
    });
    return jsonResponse({ error: "internal_error" }, 500);
  }
  if (!link || !link.attempt_id) {
    return jsonResponse({ error: "not_found" }, 404);
  }
  if (link.expires_at && new Date(link.expires_at).getTime() < Date.now()) {
    logEvent("mock_exam_result_visited_expired", slug);
    return jsonResponse({ expired: true, error: "expired" }, 410);
  }

  const { data: attempt, error: attemptErr } = await db
    .from("mock_exam_attempts")
    .select(
      "id, assignment_id, status, started_at, submitted_at, " +
        "total_time_minutes, blank_photo_url, total_part1_score, " +
        "total_part2_score, total_score, manual_entered_date, manual_comment",
    )
    .eq("id", link.attempt_id)
    .maybeSingle();
  if (attemptErr) {
    console.error("mock_exam_public_result_attempt_failed", {
      error: attemptErr.message,
    });
    return jsonResponse({ error: "internal_error" }, 500);
  }
  if (!attempt) {
    return jsonResponse({ error: "not_found" }, 404);
  }

  // AC-7: status gate. Только terminal-approved состояния видны parent'у.
  const isApprovedAuto = attempt.status === "approved";
  const isManualEntered = attempt.status === "manually_entered";
  if (!isApprovedAuto && !isManualEntered) {
    logEvent("mock_exam_result_visited_not_ready", slug, {
      status: attempt.status as string,
    });
    return jsonResponse(
      { error: "not_ready", status: attempt.status },
      403,
    );
  }

  // Assignment whitelist (id, title, mode, variant_id, variant_title).
  // tutor_id уже у нас из link — НЕ добавляем в payload.
  const { data: assignment } = await db
    .from("mock_exam_assignments")
    .select("id, title, mode, variant_id, variant_title")
    .eq("id", attempt.assignment_id)
    .maybeSingle();
  if (!assignment) {
    return jsonResponse({ error: "not_found" }, 404);
  }

  const tutor = await loadTutorCard(db, link.tutor_id as string);

  // Variant info + per-task variant data (для join-а к ответам / решениям).
  let variantSummary: Record<string, unknown> | null = null;
  const variantTasksByKim: Record<number, Record<string, unknown>> = {};
  if (assignment.variant_id) {
    const { data: vData } = await db
      .from("mock_exam_variants")
      .select("title, exam_type, total_max_score, part1_max, part2_max")
      .eq("id", assignment.variant_id)
      .maybeSingle();
    variantSummary = (vData as Record<string, unknown> | null) ?? null;

    const { data: vt } = await db
      .from("mock_exam_variant_tasks")
      .select(
        "kim_number, part, order_num, task_text, task_image_url, " +
          "correct_answer, max_score, solution_text, check_mode",
      )
      .eq("variant_id", assignment.variant_id)
      .order("order_num", { ascending: true });
    for (const t of vt ?? []) {
      variantTasksByKim[t.kim_number as number] = t as Record<string, unknown>;
    }
  }

  // Part 1 + Part 2 — только для approved (auto). Для manually_entered
  // нет per-task разбора, только totals + manual_comment.
  let part1Answers: unknown[] = [];
  let part2Solutions: unknown[] = [];

  if (isApprovedAuto) {
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

    const { data: part2Rows } = await db
      .from("mock_exam_attempt_part2_solutions")
      .select("kim_number, photo_url, tutor_score, tutor_comment, status")
      .eq("attempt_id", attempt.id)
      .order("kim_number", { ascending: true });

    part2Solutions = await Promise.all(
      (part2Rows ?? []).map(async (row) => {
        const v = variantTasksByKim[row.kim_number as number];
        const photoSigned = await resolveSignedUrl(
          db,
          row.photo_url as string | null,
          PART2_PHOTO_BUCKET,
        );
        const taskImageSigned = await resolveSignedUrl(
          db,
          (v?.task_image_url as string | null) ?? null,
          VARIANT_TASK_BUCKET,
        );
        return {
          kim_number: row.kim_number,
          photo_url: photoSigned,
          tutor_score: row.tutor_score,
          tutor_comment: row.tutor_comment,
          status: row.status,
          task_text: (v?.task_text as string | null) ?? null,
          task_image_url: taskImageSigned,
          max_score: (v?.max_score as number | undefined) ?? 0,
          // solution_text безопасно показывать parent'у пост-approval —
          // ученик уже видит её в своём StudentMockExamResult; parent
          // share получает тот же контент. tutor_comment — отдельный
          // канал для personal коментария.
          solution_text: (v?.solution_text as string | null) ?? null,
        };
      }),
    );
  }

  const blankPhotoUrl = await resolveSignedUrl(
    db,
    attempt.blank_photo_url as string | null,
    BLANK_BUCKET,
  );

  logEvent("mock_exam_result_visited", slug, {
    status: attempt.status as string,
  });

  return jsonResponse({
    expired: false,
    tutor,
    assignment: {
      id: assignment.id,
      title: assignment.title,
      mode: assignment.mode,
      display_title:
        (assignment.variant_title as string | null) ??
          (variantSummary?.title as string | null) ??
          (assignment.title as string),
    },
    variant: variantSummary
      ? {
        title: variantSummary.title,
        exam_type: variantSummary.exam_type,
        total_max_score: variantSummary.total_max_score,
        part1_max: variantSummary.part1_max,
        part2_max: variantSummary.part2_max,
      }
      : null,
    attempt: {
      id: attempt.id,
      status: attempt.status,
      started_at: attempt.started_at,
      submitted_at: attempt.submitted_at,
      total_time_minutes: attempt.total_time_minutes,
      total_part1_score: attempt.total_part1_score,
      total_part2_score: attempt.total_part2_score,
      total_score: attempt.total_score,
      manual_entered_date: attempt.manual_entered_date,
      manual_comment: attempt.manual_comment,
      blank_photo_url: blankPhotoUrl,
    },
    part1_answers: part1Answers,
    part2_solutions: part2Solutions,
    expires_at: link.expires_at,
  });
}

// ─── Server ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const route = parseRoute(req);
  const seg = route.segments;

  try {
    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // GET /share/mock-invite/:slug
    if (
      route.method === "GET" &&
      seg.length === 3 &&
      seg[0] === "share" &&
      seg[1] === "mock-invite"
    ) {
      const slug = seg[2].toLowerCase();
      if (!SLUG_RE.test(slug)) {
        return jsonResponse({ error: "invalid_slug" }, 400);
      }
      return await handleInviteRead(db, slug);
    }

    // POST /share/mock-invite/:slug/start
    if (
      route.method === "POST" &&
      seg.length === 4 &&
      seg[0] === "share" &&
      seg[1] === "mock-invite" &&
      seg[3] === "start"
    ) {
      const slug = seg[2].toLowerCase();
      if (!SLUG_RE.test(slug)) {
        return jsonResponse({ error: "invalid_slug" }, 400);
      }
      const body = await parseJsonBody(req);
      return await handleInviteStart(db, slug, body);
    }

    // GET /share/mock-result/:slug
    if (
      route.method === "GET" &&
      seg.length === 3 &&
      seg[0] === "share" &&
      seg[1] === "mock-result"
    ) {
      const slug = seg[2].toLowerCase();
      if (!SLUG_RE.test(slug)) {
        return jsonResponse({ error: "invalid_slug" }, 400);
      }
      return await handleResultRead(db, slug);
    }

    return jsonResponse({ error: "route_not_found" }, 404);
  } catch (err) {
    console.error("mock_exam_public_unhandled_error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return jsonResponse({ error: "internal_error" }, 500);
  }
});
