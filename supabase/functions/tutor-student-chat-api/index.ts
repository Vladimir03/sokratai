// tutor-student-chat-api — чат репетитор ↔ ученик (Telegram-like, 1:1).
//
// Беседа = 1:1 с линком tutor_students (lazy-create). ВСЕ записи идут через эту
// функцию (service_role) — у authenticated только SELECT (RLS в миграции
// 20260712150000). Реалтайм доставляет INSERT/UPDATE клиентам напрямую.
//
// Роуты:
//   GET  /conversations?role=tutor|student        — список бесед с identity партнёра
//   POST /conversations {tutor_student_id}        — get-or-create беседы
//   GET  /conversations/:id/messages?before=&limit= — keyset-пагинация
//   POST /conversations/:id/messages              — отправка (+notify, +@СократAI)
//   POST /conversations/:id/read                  — mark-read своей стороны
//   POST /internal/notify                         — (service-role) delayed-уведомление
//   POST /internal/ai-reply                       — (service-role) ответ @СократAI
//
// verify_jwt=true в config.toml; внутренние роуты аутентифицируются exact-match
// service-role bearer (зеркало homework-generate-reference). Fire-and-forget =
// un-awaited fetch на self-invocation (паттерн enqueueReferenceGeneration,
// rule 95: EdgeRuntime.waitUntil в кодовой базе не используется).
//
// План: ~/.claude/plans/functional-frolicking-flute.md

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  base64UrlDecode,
  createVapidJwt,
  importVapidPrivateKey,
  sendPushNotification,
  type PushPayload,
  type PushSubscriptionData,
} from "../_shared/push-sender.ts";
import {
  MAX_GUIDED_CHAT_ATTACHMENTS,
  parseAttachmentUrls,
  serializeAttachmentUrls,
} from "../_shared/attachment-refs.ts";
import { checkAiQuota } from "../_shared/subscription-limits.ts";
import {
  callLovableJson,
  inlineImageUrlToBase64,
  type LovableImagePart,
  type LovableMessage,
  type LovableTextPart,
} from "../_shared/ai-lovable.ts";
import { makeUsageLogger } from "../_shared/token-usage.ts";
import { logAnalyticsEvent } from "../_shared/analytics.ts";
import { resolveTutorPkId } from "../_shared/student-progress-build.ts";

// ─── Constants ───────────────────────────────────────────────────────────────

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:support@sokratai.ru";

const FALLBACK_ORIGINS = [
  "https://sokratai.ru",
  "https://sokratai.lovable.app",
  "http://localhost:8080",
  "http://localhost:5173",
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_MESSAGE_CHARS = 4000; // = DB CHECK на content
const MESSAGES_PAGE_DEFAULT = 50;
const MESSAGES_PAGE_MAX = 100;
const PREVIEW_MAX_CHARS = 140;
const RATE_LIMIT_MESSAGES = 20; // сообщений за окно
const RATE_LIMIT_WINDOW_MS = 60_000;

// Уведомления: delayed re-check (анти-спам активной переписки) + троттлинг.
const NOTIFY_DELAY_MS = 15_000;
const NOTIFY_THROTTLE_MS = 5 * 60_000;
const NOTIFY_PREVIEW_CHARS = 80;

// @СократAI: детект БЕЗ lookbehind (единообразно с фронтом, rule 80).
const MENTION_RE = /@\s?(сократ\s?ai|sokrat\s?ai)/iu;
const AI_CONTEXT_MESSAGES = 15;
const AI_MAX_IMAGES = 2;
const TUTOR_CHAT_AI_DAILY_CAP = 30; // rule 99: свой per-tutor cap, не ученическая квота

// ─── CORS (mirror tutor-progress-api) ────────────────────────────────────────

function getAllowedOrigins(): string[] {
  const envOrigins = Deno.env.get("TUTOR_STUDENT_CHAT_API_ALLOWED_ORIGINS") ??
    Deno.env.get("HOMEWORK_API_ALLOWED_ORIGINS");
  if (envOrigins) {
    return envOrigins.split(",").map((o) => o.trim()).filter(Boolean);
  }
  return FALLBACK_ORIGINS;
}

function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const allowed = getAllowedOrigins();
  const isLovableOrigin = origin.endsWith(".lovableproject.com") ||
    origin.endsWith(".lovable.app");
  const matchedOrigin = allowed.includes(origin) || isLovableOrigin ? origin : allowed[0];
  return {
    "Access-Control-Allow-Origin": matchedOrigin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

// ─── Response helpers (rule 97 flat shape) ───────────────────────────────────

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

// ─── Auth ────────────────────────────────────────────────────────────────────

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
    console.error("tutor_student_chat_auth_failed", { status: resp.status });
    return jsonError(cors, 401, "UNAUTHORIZED", "Сессия истекла. Войдите снова.");
  }
  const user = await resp.json();
  if (!user?.id) {
    return jsonError(cors, 401, "UNAUTHORIZED", "Сессия истекла. Войдите снова.");
  }
  return { userId: user.id };
}

/** Internal-only гейт: bearer = exact service-role key (fire-and-forget caller). */
function isInternalCaller(req: Request): boolean {
  const authHeader = req.headers.get("Authorization") ?? "";
  return authHeader === `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`;
}

// ─── Routing ─────────────────────────────────────────────────────────────────

function parseRoute(req: Request): {
  segments: string[];
  method: string;
  searchParams: URLSearchParams;
} {
  const url = new URL(req.url);
  const idx = url.pathname.indexOf("tutor-student-chat-api");
  const rest = idx >= 0 ? url.pathname.slice(idx + "tutor-student-chat-api".length) : "";
  return {
    segments: rest.split("/").filter(Boolean),
    method: req.method,
    searchParams: url.searchParams,
  };
}

async function parseJsonBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? body as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

// ─── Identity helpers ────────────────────────────────────────────────────────

/** Автогенерированные username (префиксы telegram_, user_, vk_) не показываем как имя. */
function filterUsername(username: string | null | undefined): string | null {
  if (!username) return null;
  const trimmed = username.trim();
  if (!trimmed) return null;
  if (/^(telegram_|user_|vk_|manual_)/i.test(trimmed)) return null;
  return trimmed;
}

function resolveStudentName(
  linkDisplayName: string | null | undefined,
  profileFullName: string | null | undefined,
  profileUsername: string | null | undefined,
): string {
  const display = linkDisplayName?.trim();
  if (display) return display;
  const full = profileFullName?.trim();
  if (full) return full;
  return filterUsername(profileUsername) ?? "Ученик";
}

function escapeHtmlEntities(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildPreview(content: string, hasAttachments: boolean): string | null {
  const collapsed = content.replace(/\s+/g, " ").trim();
  if (!collapsed) return hasAttachments ? "📷 Фото" : null;
  return collapsed.length > PREVIEW_MAX_CHARS
    ? `${collapsed.slice(0, PREVIEW_MAX_CHARS - 1)}…`
    : collapsed;
}

function getAppUrl(): string {
  return Deno.env.get("PUBLIC_APP_URL")?.trim().replace(/\/$/, "") ?? "https://sokratai.ru";
}

// ─── DB row shapes (column whitelists — никогда select('*')) ─────────────────

const CONVERSATION_SELECT =
  "id, tutor_student_id, last_message_at, last_message_preview, last_message_sender, " +
  "tutor_last_read_at, student_last_read_at, tutor_unread_count, student_unread_count, " +
  "tutor_last_notified_at, student_last_notified_at";

const MESSAGE_SELECT =
  "id, conversation_id, sender_role, author_user_id, content, attachment_url, client_msg_id, created_at";

interface ConversationRow {
  id: string;
  tutor_student_id: string;
  last_message_at: string | null;
  last_message_preview: string | null;
  last_message_sender: string | null;
  tutor_last_read_at: string | null;
  student_last_read_at: string | null;
  tutor_unread_count: number;
  student_unread_count: number;
  tutor_last_notified_at: string | null;
  student_last_notified_at: string | null;
}

interface LinkRow {
  id: string;
  tutor_id: string;
  student_id: string;
  display_name: string | null;
  archived_at: string | null;
}

interface TutorRow {
  id: string;
  user_id: string;
  name: string | null;
  avatar_url: string | null;
  gender: string | null;
  telegram_id: string | null;
}

interface MemberContext {
  conversation: ConversationRow;
  link: LinkRow;
  tutor: TutorRow;
  role: "tutor" | "student";
}

async function loadLinkAndTutor(
  db: SupabaseClient,
  tutorStudentId: string,
): Promise<{ link: LinkRow; tutor: TutorRow } | null> {
  const { data: link, error: linkErr } = await db
    .from("tutor_students")
    .select("id, tutor_id, student_id, display_name, archived_at")
    .eq("id", tutorStudentId)
    .maybeSingle();
  if (linkErr || !link) return null;
  const { data: tutor, error: tutorErr } = await db
    .from("tutors")
    .select("id, user_id, name, avatar_url, gender, telegram_id")
    .eq("id", (link as LinkRow).tutor_id)
    .maybeSingle();
  if (tutorErr || !tutor) return null;
  return { link: link as LinkRow, tutor: tutor as TutorRow };
}

/** Беседа + линк + роль вызывающего; null = не участник / не найдено. */
async function resolveMemberContext(
  db: SupabaseClient,
  conversationId: string,
  userId: string,
): Promise<MemberContext | null> {
  const { data: conv, error } = await db
    .from("tutor_student_conversations")
    .select(CONVERSATION_SELECT)
    .eq("id", conversationId)
    .maybeSingle();
  if (error || !conv) return null;
  const loaded = await loadLinkAndTutor(db, (conv as ConversationRow).tutor_student_id);
  if (!loaded) return null;
  const { link, tutor } = loaded;
  let role: "tutor" | "student" | null = null;
  if (link.student_id === userId) role = "student";
  else if (tutor.user_id === userId) role = "tutor";
  if (!role) return null;
  return { conversation: conv as ConversationRow, link, tutor, role };
}

/** Identity партнёра для header/списка (column whitelist, никаких telegram-полей). */
async function buildPartnerIdentity(
  db: SupabaseClient,
  ctx: MemberContext,
): Promise<{ name: string; avatar_url: string | null; gender: string | null }> {
  if (ctx.role === "student") {
    return {
      name: ctx.tutor.name?.trim() || "Репетитор",
      avatar_url: ctx.tutor.avatar_url ?? null,
      gender: ctx.tutor.gender ?? null,
    };
  }
  const { data: profile } = await db
    .from("profiles")
    .select("full_name, username, avatar_url, gender")
    .eq("id", ctx.link.student_id)
    .maybeSingle();
  return {
    name: resolveStudentName(
      ctx.link.display_name,
      profile?.full_name as string | null,
      profile?.username as string | null,
    ),
    avatar_url: (profile?.avatar_url as string | null) ?? null,
    gender: (profile?.gender as string | null) ?? null,
  };
}

// ─── Fire-and-forget self-invocation (pattern: enqueueReferenceGeneration) ───

function enqueueInternal(path: string, body: Record<string, unknown>): void {
  try {
    fetch(`${SUPABASE_URL}/functions/v1/tutor-student-chat-api/internal/${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: SUPABASE_SERVICE_ROLE_KEY,
      },
      body: JSON.stringify(body),
    }).catch((err) => {
      console.warn("tsc_internal_enqueue_failed", { path, error: String(err) });
    });
  } catch (err) {
    console.warn("tsc_internal_enqueue_throw", { path, error: String(err) });
  }
}

/** Broadcast в typing-канал беседы через Realtime REST (без WS-подключения). */
async function broadcastAssistantTyping(
  conversationId: string,
  expiresInMs: number,
): Promise<void> {
  try {
    await fetch(`${SUPABASE_URL}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        messages: [{
          topic: `tsc-typing-${conversationId}`,
          event: "typing",
          payload: {
            role: "assistant",
            display_name: "СократAI",
            expires_at: new Date(Date.now() + expiresInMs).toISOString(),
          },
          private: false,
        }],
      }),
    });
  } catch (err) {
    // typing — degrade-safe, сбой не ломает ответ
    console.warn("tsc_typing_broadcast_failed", { error: String(err) });
  }
}

// ─── Message insert helpers ──────────────────────────────────────────────────

interface PostMessageResult {
  message: Record<string, unknown>;
  deduped: boolean;
}

/**
 * Атомарная вставка сообщения + денорм одной транзакцией (RPC tsc_post_message):
 * идемпотентность по client_msg_id, монотонный preview, инкремент счётчиков.
 * null = ошибка (caller решает, фатальна ли она).
 */
async function postMessageAtomic(
  db: SupabaseClient,
  input: {
    conversationId: string;
    senderRole: string;
    authorUserId: string | null;
    content: string;
    attachmentUrl: string | null;
    clientMsgId: string | null;
  },
): Promise<PostMessageResult | null> {
  const { data, error } = await db.rpc("tsc_post_message", {
    _conversation_id: input.conversationId,
    _sender_role: input.senderRole,
    _author_user_id: input.authorUserId,
    _content: input.content,
    _attachment_url: input.attachmentUrl,
    _client_msg_id: input.clientMsgId,
    _preview: buildPreview(input.content, Boolean(input.attachmentUrl)),
  });
  if (error || !data) {
    console.error("tsc_post_message_rpc_failed", { error: error?.message });
    return null;
  }
  const parsed = data as { message?: Record<string, unknown>; deduped?: boolean };
  if (!parsed.message) return null;
  return { message: parsed.message, deduped: Boolean(parsed.deduped) };
}

/** Вставка assistant-сообщения (ответ/лимит/ошибка @СократAI). */
async function insertAssistantMessage(
  db: SupabaseClient,
  conversationId: string,
  content: string,
): Promise<void> {
  const safe = content.slice(0, MAX_MESSAGE_CHARS);
  const res = await postMessageAtomic(db, {
    conversationId,
    senderRole: "assistant",
    authorUserId: null,
    content: safe,
    attachmentUrl: null,
    clientMsgId: null,
  });
  if (!res) {
    console.error("tsc_assistant_insert_failed", {});
  }
}

// ─── Endpoint: GET /conversations ────────────────────────────────────────────

async function handleListConversations(
  db: SupabaseClient,
  userId: string,
  cors: Record<string, string>,
  searchParams: URLSearchParams,
): Promise<Response> {
  const roleParam = searchParams.get("role");
  let role: "tutor" | "student";
  if (roleParam === "tutor" || roleParam === "student") {
    role = roleParam;
  } else {
    role = (await resolveTutorPkId(db, userId)) ? "tutor" : "student";
  }

  if (role === "tutor") {
    const tutorPk = await resolveTutorPkId(db, userId);
    if (!tutorPk) {
      return jsonError(cors, 403, "NOT_A_TUTOR", "Этот аккаунт не репетиторский.");
    }
    const { data: links, error: linksErr } = await db
      .from("tutor_students")
      .select("id, student_id, display_name, archived_at")
      .eq("tutor_id", tutorPk);
    if (linksErr) {
      console.error("tsc_list_links_failed", { error: linksErr.message });
      return jsonError(cors, 500, "DB_ERROR", "Не удалось загрузить список чатов.");
    }
    const linkRows = (links ?? []) as Array<
      { id: string; student_id: string; display_name: string | null; archived_at: string | null }
    >;
    if (linkRows.length === 0) return jsonOk(cors, { items: [], role });

    const linkIds = linkRows.map((l) => l.id);
    const studentIds = [...new Set(linkRows.map((l) => l.student_id))];
    const [convsRes, profilesRes] = await Promise.all([
      db.from("tutor_student_conversations").select(CONVERSATION_SELECT).in("tutor_student_id", linkIds),
      db.from("profiles").select("id, full_name, username, avatar_url, gender").in("id", studentIds),
    ]);
    // Частичный сбой НЕ маскируем 200-кой с «пустыми» диалогами (ревью 5.6 P1:
    // клиент затирал бы хороший кэш деградировавшим списком).
    if (convsRes.error || profilesRes.error) {
      console.error("tsc_list_batch_failed", {
        convs: convsRes.error?.message ?? null,
        profiles: profilesRes.error?.message ?? null,
      });
      return jsonError(cors, 500, "DB_ERROR", "Не удалось загрузить список чатов.");
    }
    const convs = convsRes.data;
    const profiles = profilesRes.data;
    const convByLink = new Map(
      ((convs ?? []) as ConversationRow[]).map((c) => [c.tutor_student_id, c]),
    );
    const profileById = new Map(
      ((profiles ?? []) as Array<
        { id: string; full_name: string | null; username: string | null; avatar_url: string | null; gender: string | null }
      >).map((p) => [p.id, p]),
    );

    const items = linkRows
      .map((l) => {
        const conv = convByLink.get(l.id) ?? null;
        // Архивные ученики видны в списке только если переписка реально была.
        if (l.archived_at && !conv?.last_message_at) return null;
        const profile = profileById.get(l.student_id);
        return {
          tutor_student_id: l.id,
          conversation_id: conv?.id ?? null,
          partner_name: resolveStudentName(l.display_name, profile?.full_name, profile?.username),
          partner_avatar_url: profile?.avatar_url ?? null,
          partner_gender: profile?.gender ?? null,
          last_message_at: conv?.last_message_at ?? null,
          last_message_preview: conv?.last_message_preview ?? null,
          last_message_sender: conv?.last_message_sender ?? null,
          unread_count: conv?.tutor_unread_count ?? 0,
          peer_last_read_at: conv?.student_last_read_at ?? null,
          archived: Boolean(l.archived_at),
        };
      })
      .filter(Boolean) as Array<{ last_message_at: string | null; partner_name: string }>;

    items.sort((a, b) => {
      const at = a.last_message_at ? Date.parse(a.last_message_at) : 0;
      const bt = b.last_message_at ? Date.parse(b.last_message_at) : 0;
      if (at !== bt) return bt - at;
      return a.partner_name.localeCompare(b.partner_name, "ru");
    });
    return jsonOk(cors, { items, role });
  }

  // student side
  const { data: links, error: linksErr } = await db
    .from("tutor_students")
    .select("id, tutor_id, archived_at")
    .eq("student_id", userId);
  if (linksErr) {
    console.error("tsc_list_student_links_failed", { error: linksErr.message });
    return jsonError(cors, 500, "DB_ERROR", "Не удалось загрузить список чатов.");
  }
  const linkRows = (links ?? []) as Array<
    { id: string; tutor_id: string; archived_at: string | null }
  >;
  if (linkRows.length === 0) return jsonOk(cors, { items: [], role });

  const linkIds = linkRows.map((l) => l.id);
  const tutorIds = [...new Set(linkRows.map((l) => l.tutor_id))];
  const [convsRes, tutorsRes] = await Promise.all([
    db.from("tutor_student_conversations").select(CONVERSATION_SELECT).in("tutor_student_id", linkIds),
    db.from("tutors").select("id, name, avatar_url, gender").in("id", tutorIds),
  ]);
  if (convsRes.error || tutorsRes.error) {
    console.error("tsc_list_student_batch_failed", {
      convs: convsRes.error?.message ?? null,
      tutors: tutorsRes.error?.message ?? null,
    });
    return jsonError(cors, 500, "DB_ERROR", "Не удалось загрузить список чатов.");
  }
  const convs = convsRes.data;
  const tutors = tutorsRes.data;
  const convByLink = new Map(
    ((convs ?? []) as ConversationRow[]).map((c) => [c.tutor_student_id, c]),
  );
  const tutorById = new Map(
    ((tutors ?? []) as Array<
      { id: string; name: string | null; avatar_url: string | null; gender: string | null }
    >).map((t) => [t.id, t]),
  );

  const items = linkRows
    .map((l) => {
      const conv = convByLink.get(l.id) ?? null;
      if (l.archived_at && !conv?.last_message_at) return null;
      const tutor = tutorById.get(l.tutor_id);
      return {
        tutor_student_id: l.id,
        conversation_id: conv?.id ?? null,
        partner_name: tutor?.name?.trim() || "Репетитор",
        partner_avatar_url: tutor?.avatar_url ?? null,
        partner_gender: tutor?.gender ?? null,
        last_message_at: conv?.last_message_at ?? null,
        last_message_preview: conv?.last_message_preview ?? null,
        last_message_sender: conv?.last_message_sender ?? null,
        unread_count: conv?.student_unread_count ?? 0,
        peer_last_read_at: conv?.tutor_last_read_at ?? null,
        archived: Boolean(l.archived_at),
      };
    })
    .filter(Boolean) as Array<{ last_message_at: string | null; partner_name: string }>;

  items.sort((a, b) => {
    const at = a.last_message_at ? Date.parse(a.last_message_at) : 0;
    const bt = b.last_message_at ? Date.parse(b.last_message_at) : 0;
    if (at !== bt) return bt - at;
    return a.partner_name.localeCompare(b.partner_name, "ru");
  });
  return jsonOk(cors, { items, role });
}

// ─── Endpoint: POST /conversations (get-or-create) ───────────────────────────

async function handleCreateConversation(
  db: SupabaseClient,
  userId: string,
  cors: Record<string, string>,
  body: Record<string, unknown> | null,
): Promise<Response> {
  const tutorStudentId = typeof body?.tutor_student_id === "string" ? body.tutor_student_id : "";
  if (!UUID_RE.test(tutorStudentId)) {
    return jsonError(cors, 400, "VALIDATION", "Не указан ученик для чата.");
  }
  const loaded = await loadLinkAndTutor(db, tutorStudentId);
  if (!loaded) {
    return jsonError(cors, 404, "NOT_FOUND", "Связь репетитор–ученик не найдена.");
  }
  const { link, tutor } = loaded;
  const isMember = link.student_id === userId || tutor.user_id === userId;
  if (!isMember) {
    return jsonError(cors, 403, "FORBIDDEN", "Этот чат принадлежит другой паре репетитор–ученик.");
  }

  // Race-free get-or-create: UNIQUE(tutor_student_id) + ignoreDuplicates.
  const { error: upsertErr } = await db
    .from("tutor_student_conversations")
    .upsert({ tutor_student_id: tutorStudentId }, {
      onConflict: "tutor_student_id",
      ignoreDuplicates: true,
    });
  if (upsertErr) {
    console.error("tsc_create_conversation_failed", { error: upsertErr.message });
    return jsonError(cors, 500, "DB_ERROR", "Не удалось создать чат. Попробуйте ещё раз.");
  }
  const { data: conv, error: selErr } = await db
    .from("tutor_student_conversations")
    .select("id")
    .eq("tutor_student_id", tutorStudentId)
    .single();
  if (selErr || !conv) {
    console.error("tsc_create_conversation_select_failed", { error: selErr?.message });
    return jsonError(cors, 500, "DB_ERROR", "Не удалось создать чат. Попробуйте ещё раз.");
  }
  const role = link.student_id === userId ? "student" : "tutor";
  return jsonOk(cors, { conversation_id: (conv as { id: string }).id, role });
}

// ─── Endpoint: GET /conversations/:id/messages ───────────────────────────────

async function handleGetMessages(
  db: SupabaseClient,
  userId: string,
  cors: Record<string, string>,
  conversationId: string,
  searchParams: URLSearchParams,
): Promise<Response> {
  const ctx = await resolveMemberContext(db, conversationId, userId);
  if (!ctx) return jsonError(cors, 404, "NOT_FOUND", "Чат не найден.");

  const before = searchParams.get("before");
  const beforeId = searchParams.get("before_id");
  const limitRaw = Number(searchParams.get("limit") ?? MESSAGES_PAGE_DEFAULT);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(Math.trunc(limitRaw), 1), MESSAGES_PAGE_MAX)
    : MESSAGES_PAGE_DEFAULT;

  let query = db
    .from("tutor_student_chat_messages")
    .select(MESSAGE_SELECT)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);
  if (before && !Number.isNaN(Date.parse(before))) {
    if (beforeId && UUID_RE.test(beforeId)) {
      // Составной keyset (created_at, id) — сортировка использует id как
      // tie-breaker, курсор обязан тоже (ревью 5.6 P1: lt(created_at) терял
      // сообщения с одинаковым timestamp на границе страницы).
      query = query.or(
        `created_at.lt."${before}",and(created_at.eq."${before}",id.lt."${beforeId}")`,
      );
    } else {
      query = query.lt("created_at", before);
    }
  }
  const { data: rows, error } = await query;
  if (error) {
    console.error("tsc_get_messages_failed", { error: error.message });
    return jsonError(cors, 500, "DB_ERROR", "Не удалось загрузить сообщения.");
  }
  const page = (rows ?? []) as Array<Record<string, unknown>>;
  const hasMore = page.length > limit;
  const messages = page.slice(0, limit).reverse();

  const partner = await buildPartnerIdentity(db, ctx);

  return jsonOk(cors, {
    messages,
    has_more: hasMore,
    conversation: {
      id: ctx.conversation.id,
      tutor_student_id: ctx.link.id,
      my_role: ctx.role,
      archived: Boolean(ctx.link.archived_at),
      tutor_last_read_at: ctx.conversation.tutor_last_read_at,
      student_last_read_at: ctx.conversation.student_last_read_at,
      my_last_read_at: ctx.role === "tutor"
        ? ctx.conversation.tutor_last_read_at
        : ctx.conversation.student_last_read_at,
      peer_last_read_at: ctx.role === "tutor"
        ? ctx.conversation.student_last_read_at
        : ctx.conversation.tutor_last_read_at,
      partner,
    },
  });
}

// ─── Endpoint: POST /conversations/:id/messages ──────────────────────────────

async function handlePostMessage(
  db: SupabaseClient,
  userId: string,
  cors: Record<string, string>,
  conversationId: string,
  body: Record<string, unknown> | null,
): Promise<Response> {
  const ctx = await resolveMemberContext(db, conversationId, userId);
  if (!ctx) return jsonError(cors, 404, "NOT_FOUND", "Чат не найден.");
  if (ctx.link.archived_at) {
    return jsonError(
      cors,
      403,
      "CHAT_ARCHIVED",
      "Ученик в архиве — отправка сообщений недоступна. История сохранена.",
    );
  }

  const content = typeof body?.content === "string" ? body.content : "";
  const trimmed = content.trim();
  if (trimmed.length > MAX_MESSAGE_CHARS) {
    return jsonError(
      cors,
      400,
      "VALIDATION",
      `Сообщение слишком длинное (максимум ${MAX_MESSAGE_CHARS} символов).`,
    );
  }

  // Вложения: только свой namespace своей беседы (anti-injection чужих ref'ов).
  const rawRefs = Array.isArray(body?.attachment_refs) ? body.attachment_refs : [];
  const refs: string[] = [];
  for (const r of rawRefs) {
    if (typeof r !== "string") continue;
    if (r.includes("..")) {
      return jsonError(cors, 400, "INVALID_ATTACHMENT_REF", "Недопустимая ссылка на фото.");
    }
    const prefix = `storage://tutor-chat-uploads/${conversationId}/${userId}/`;
    if (!r.startsWith(prefix)) {
      return jsonError(cors, 400, "INVALID_ATTACHMENT_REF", "Недопустимая ссылка на фото.");
    }
    refs.push(r);
  }
  if (refs.length > MAX_GUIDED_CHAT_ATTACHMENTS) {
    return jsonError(
      cors,
      400,
      "VALIDATION",
      `Не больше ${MAX_GUIDED_CHAT_ATTACHMENTS} фото в одном сообщении.`,
    );
  }
  if (!trimmed && refs.length === 0) {
    return jsonError(cors, 400, "VALIDATION", "Пустое сообщение не отправить.");
  }

  const clientMsgId = typeof body?.client_msg_id === "string" && UUID_RE.test(body.client_msg_id)
    ? body.client_msg_id
    : null;

  // Rate-limit: N сообщений за окно на автора в беседе.
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
  const { count: recentCount } = await db
    .from("tutor_student_chat_messages")
    .select("id", { count: "exact", head: true })
    .eq("conversation_id", conversationId)
    .eq("author_user_id", userId)
    .gte("created_at", windowStart);
  if ((recentCount ?? 0) >= RATE_LIMIT_MESSAGES) {
    return jsonError(cors, 429, "RATE_LIMITED", "Слишком много сообщений подряд. Подождите минуту.");
  }

  // Атомарно: insert + идемпотентный дедуп + денорм одной транзакцией (RPC).
  const posted = await postMessageAtomic(db, {
    conversationId,
    senderRole: ctx.role,
    authorUserId: userId,
    content: trimmed,
    attachmentUrl: serializeAttachmentUrls(refs),
    clientMsgId,
  });
  if (!posted) {
    return jsonError(cors, 500, "DB_ERROR", "Не удалось отправить сообщение. Попробуйте ещё раз.");
  }
  const { message } = posted;
  if (posted.deduped) {
    // Retry уже отправленного — notify/AI-каскад НЕ повторяем.
    return jsonOk(cors, { message, deduped: true });
  }

  // Воронка привычки: первое сообщение в беседе.
  if (!ctx.conversation.last_message_at) {
    void logAnalyticsEvent(db, {
      event_name: "chat_first_message_sent",
      actor_user_id: userId,
      tutor_id: ctx.link.tutor_id,
      student_id: ctx.link.student_id,
      tutor_student_id: ctx.link.id,
      source: ctx.role,
    });
  }

  // Delayed-уведомление получателю (не await — отдельный isolate спит 15с).
  enqueueInternal("notify", {
    conversation_id: conversationId,
    message_id: message.id,
    recipient: ctx.role === "tutor" ? "student" : "tutor",
  });

  // @СократAI → фоновый AI-ответ.
  if (MENTION_RE.test(trimmed)) {
    enqueueInternal("ai-reply", {
      conversation_id: conversationId,
      message_id: message.id,
    });
  }

  return jsonOk(cors, { message });
}

// ─── Endpoint: POST /conversations/:id/read ──────────────────────────────────

async function handleMarkRead(
  db: SupabaseClient,
  userId: string,
  cors: Record<string, string>,
  conversationId: string,
): Promise<Response> {
  const ctx = await resolveMemberContext(db, conversationId, userId);
  if (!ctx) return jsonError(cors, 404, "NOT_FOUND", "Чат не найден.");

  const nowIso = new Date().toISOString();
  const patch = ctx.role === "tutor"
    ? { tutor_last_read_at: nowIso, tutor_unread_count: 0 }
    : { student_last_read_at: nowIso, student_unread_count: 0 };
  const { error } = await db
    .from("tutor_student_conversations")
    .update(patch)
    .eq("id", conversationId);
  if (error) {
    console.error("tsc_mark_read_failed", { error: error.message });
    return jsonError(cors, 500, "DB_ERROR", "Не удалось отметить прочитанным.");
  }
  return jsonOk(cors, { ok: true, read_at: nowIso });
}

// ─── Internal: POST /internal/notify ─────────────────────────────────────────

async function handleInternalNotify(
  db: SupabaseClient,
  body: Record<string, unknown> | null,
): Promise<Response> {
  const conversationId = typeof body?.conversation_id === "string" ? body.conversation_id : "";
  const messageId = typeof body?.message_id === "string" ? body.message_id : "";
  const recipient = body?.recipient === "tutor" || body?.recipient === "student"
    ? body.recipient
    : null;
  if (!UUID_RE.test(conversationId) || !UUID_RE.test(messageId) || !recipient) {
    return new Response(JSON.stringify({ error: "bad_request" }), { status: 400 });
  }

  // Delayed re-check: получатель, читающий чат вживую, уведомление не получит.
  await new Promise((resolve) => setTimeout(resolve, NOTIFY_DELAY_MS));

  const { data: conv } = await db
    .from("tutor_student_conversations")
    .select(CONVERSATION_SELECT)
    .eq("id", conversationId)
    .maybeSingle();
  const { data: msg } = await db
    .from("tutor_student_chat_messages")
    .select("id, content, attachment_url, sender_role, created_at")
    .eq("id", messageId)
    .maybeSingle();
  if (!conv || !msg) return new Response(JSON.stringify({ ok: true }), { status: 200 });
  const conversation = conv as ConversationRow;
  const senderRole = msg.sender_role as string;
  if (senderRole === "assistant") {
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  const readAt = recipient === "tutor"
    ? conversation.tutor_last_read_at
    : conversation.student_last_read_at;
  if (readAt && Date.parse(readAt) >= Date.parse(msg.created_at as string)) {
    return new Response(JSON.stringify({ ok: true, skipped: "read" }), { status: 200 });
  }
  const notifiedAt = recipient === "tutor"
    ? conversation.tutor_last_notified_at
    : conversation.student_last_notified_at;
  if (notifiedAt && Date.now() - Date.parse(notifiedAt) < NOTIFY_THROTTLE_MS) {
    return new Response(JSON.stringify({ ok: true, skipped: "throttled" }), { status: 200 });
  }

  const loaded = await loadLinkAndTutor(db, conversation.tutor_student_id);
  if (!loaded) return new Response(JSON.stringify({ ok: true }), { status: 200 });
  const { link, tutor } = loaded;

  // Имя отправителя для заголовка.
  let senderName: string;
  if (senderRole === "tutor") {
    senderName = tutor.name?.trim() || "Репетитор";
  } else {
    const { data: profile } = await db
      .from("profiles")
      .select("full_name, username")
      .eq("id", link.student_id)
      .maybeSingle();
    senderName = resolveStudentName(
      link.display_name,
      profile?.full_name as string | null,
      profile?.username as string | null,
    );
  }

  const contentPreview = buildPreview(
    (msg.content as string) ?? "",
    parseAttachmentUrls(msg.attachment_url as string | null).length > 0,
  ) ?? "Новое сообщение";
  const shortPreview = contentPreview.length > NOTIFY_PREVIEW_CHARS
    ? `${contentPreview.slice(0, NOTIFY_PREVIEW_CHARS - 1)}…`
    : contentPreview;

  const appUrl = getAppUrl();
  const recipientUserId = recipient === "tutor" ? tutor.user_id : link.student_id;
  const url = recipient === "tutor"
    ? `${appUrl}/tutor/chat/${conversationId}`
    : `${appUrl}/chat?id=tutor:${conversationId}`;

  let delivered = false;

  // 1) Push
  if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    const { data: subs } = await db
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth")
      .eq("user_id", recipientUserId);
    const payload: PushPayload = {
      title: `Сообщение от ${senderName}`,
      body: shortPreview,
      url,
    };
    for (const sub of (subs ?? []) as PushSubscriptionData[]) {
      try {
        const result = await sendPushNotification(
          sub,
          payload,
          VAPID_PUBLIC_KEY,
          VAPID_PRIVATE_KEY,
          VAPID_SUBJECT,
        );
        if (result.gone) {
          await db
            .from("push_subscriptions")
            .delete()
            .eq("user_id", recipientUserId)
            .eq("endpoint", sub.endpoint);
          continue;
        }
        if (result.success) {
          delivered = true;
          break;
        }
      } catch (err) {
        console.warn("tsc_notify_push_error", { error: String(err) });
      }
    }
  }

  // 2) Telegram fallback
  if (!delivered && TELEGRAM_BOT_TOKEN) {
    let chatId: number | null = null;
    if (recipient === "student") {
      const { data: profile } = await db
        .from("profiles")
        .select("telegram_user_id")
        .eq("id", link.student_id)
        .maybeSingle();
      chatId = (profile?.telegram_user_id as number | null) ?? null;
      if (!chatId) {
        const { data: session } = await db
          .from("telegram_sessions")
          .select("telegram_user_id")
          .eq("user_id", link.student_id)
          .maybeSingle();
        chatId = (session?.telegram_user_id as number | null) ?? null;
      }
    } else {
      // tutors.telegram_id — TEXT; NaN → канала нет.
      const parsed = Number(tutor.telegram_id ?? "");
      chatId = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }
    if (chatId) {
      try {
        const text = `💬 <b>${escapeHtmlEntities(senderName)}</b>: ${
          escapeHtmlEntities(shortPreview)
        }\n\n<a href="${escapeHtmlEntities(url)}">Открыть чат в Сократе</a>`;
        const tgResp = await fetch(
          `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: chatId,
              text,
              parse_mode: "HTML",
              disable_web_page_preview: true,
            }),
          },
        );
        if (tgResp.ok) delivered = true;
      } catch (err) {
        console.warn("tsc_notify_telegram_error", { error: String(err) });
      }
    }
  }

  if (delivered) {
    const patch = recipient === "tutor"
      ? { tutor_last_notified_at: new Date().toISOString() }
      : { student_last_notified_at: new Date().toISOString() };
    await db.from("tutor_student_conversations").update(patch).eq("id", conversationId);
  }

  return new Response(JSON.stringify({ ok: true, delivered }), { status: 200 });
}

// ─── Internal: POST /internal/ai-reply (@СократAI) ───────────────────────────

function buildChatAiSystemPrompt(tutorName: string, studentName: string): string {
  return [
    "Ты — Сократ AI, помощник в общем чате репетитора и ученика на платформе «Сократ AI».",
    `Тебя позвали упоминанием @СократAI. В чате два человека: репетитор ${tutorName} и ученик ${studentName}.`,
    "Сообщения в истории помечены, кто их написал.",
    "",
    "Правила:",
    "- Отвечай по-русски, по существу и достаточно кратко (обычно до 150 слов).",
    "- Формулы пиши в LaTeX с $...$ (inline) или $$...$$ (display).",
    "- Здесь МОЖНО давать полное решение и прямой ответ: репетитор присутствует в чате и сам решает, как использовать твой разбор.",
    "- Обращайся к тому, кто задал вопрос. Не выдумывай сообщений за репетитора или ученика.",
    "- Если вопрос неясен — задай один короткий уточняющий вопрос.",
    "",
    'Верни СТРОГО JSON без пояснений: {"reply": "<твой ответ>"}',
  ].join("\n");
}

async function handleInternalAiReply(
  db: SupabaseClient,
  body: Record<string, unknown> | null,
): Promise<Response> {
  const conversationId = typeof body?.conversation_id === "string" ? body.conversation_id : "";
  const messageId = typeof body?.message_id === "string" ? body.message_id : "";
  if (!UUID_RE.test(conversationId) || !UUID_RE.test(messageId)) {
    return new Response(JSON.stringify({ error: "bad_request" }), { status: 400 });
  }

  const { data: conv } = await db
    .from("tutor_student_conversations")
    .select("id, tutor_student_id")
    .eq("id", conversationId)
    .maybeSingle();
  const { data: trigger } = await db
    .from("tutor_student_chat_messages")
    .select("id, sender_role, author_user_id, content, attachment_url, created_at")
    .eq("id", messageId)
    .maybeSingle();
  if (!conv || !trigger) return new Response(JSON.stringify({ ok: true }), { status: 200 });

  const loaded = await loadLinkAndTutor(db, (conv as { tutor_student_id: string }).tutor_student_id);
  if (!loaded) return new Response(JSON.stringify({ ok: true }), { status: 200 });
  const { link, tutor } = loaded;

  const senderRole = trigger.sender_role as string;
  const authorUserId = trigger.author_user_id as string | null;
  if (senderRole === "assistant" || !authorUserId) {
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  // ── Квота ДО вызова AI (rule 99) ──
  if (senderRole === "student") {
    const quota = await checkAiQuota(authorUserId, db, {
      context: "chat",
      incrementUsage: true,
    });
    if (!quota.allowed) {
      const upgradeHint = quota.tutorCanUpgrade
        ? " Репетитор может подключить тариф «AI-старт», чтобы увеличить лимит."
        : "";
      await insertAssistantMessage(
        db,
        conversationId,
        `Дневной лимит AI-сообщений исчерпан (${quota.limit} в день). Лимит обновится завтра.${upgradeHint}`,
      );
      return new Response(JSON.stringify({ ok: true, skipped: "quota" }), { status: 200 });
    }
  } else {
    // tutor: свой per-tutor дневной cap (зеркало demo_check, rule 99).
    const midnight = new Date();
    midnight.setUTCHours(0, 0, 0, 0);
    const { count: ranToday } = await db
      .from("analytics_events")
      .select("id", { count: "exact", head: true })
      .eq("event_name", "tutor_chat_ai_ran")
      .eq("tutor_id", link.tutor_id)
      .gte("occurred_at", midnight.toISOString());
    if ((ranToday ?? 0) >= TUTOR_CHAT_AI_DAILY_CAP) {
      await insertAssistantMessage(
        db,
        conversationId,
        `Дневной лимит вызовов СократAI в чате исчерпан (${TUTOR_CHAT_AI_DAILY_CAP} в день). Попробуйте завтра.`,
      );
      return new Response(JSON.stringify({ ok: true, skipped: "tutor_cap" }), { status: 200 });
    }
  }

  // Резервация cap ДО вызова gateway (ревью 5.6 P1: post-hoc fire-and-forget
  // лог позволял параллельным упоминаниям и потерянным insert'ам обходить cap).
  // Неудачный AI-вызов тоже расходует слот — анти-retry-спам; сузившаяся гонка
  // COUNT↔INSERT при cap=30 приемлема (mirror fail-open философии checkAiQuota).
  await logAnalyticsEvent(db, {
    event_name: senderRole === "tutor" ? "tutor_chat_ai_ran" : "student_chat_ai_ran",
    actor_user_id: authorUserId,
    tutor_id: link.tutor_id,
    student_id: link.student_id,
    tutor_student_id: link.id,
  });

  // «СократAI печатает…» — degrade-safe broadcast, пока ждём gateway.
  void broadcastAssistantTyping(conversationId, 40_000);

  // ── Контекст: последние N сообщений (ASC) с пометкой автора ──
  const { data: historyRows } = await db
    .from("tutor_student_chat_messages")
    .select("sender_role, content, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(AI_CONTEXT_MESSAGES);
  const history = ((historyRows ?? []) as Array<
    { sender_role: string; content: string; created_at: string }
  >).reverse();

  const tutorName = tutor.name?.trim() || "Репетитор";
  const { data: studentProfile } = await db
    .from("profiles")
    .select("full_name, username")
    .eq("id", link.student_id)
    .maybeSingle();
  const studentName = resolveStudentName(
    link.display_name,
    studentProfile?.full_name as string | null,
    studentProfile?.username as string | null,
  );

  const aiMessages: LovableMessage[] = [
    { role: "system", content: buildChatAiSystemPrompt(tutorName, studentName) },
  ];
  for (const h of history) {
    if (!h.content?.trim()) continue;
    if (h.sender_role === "assistant") {
      aiMessages.push({ role: "assistant", content: h.content });
    } else {
      const label = h.sender_role === "tutor" ? `Репетитор ${tutorName}` : `Ученик ${studentName}`;
      aiMessages.push({ role: "user", content: `${label}: ${h.content}` });
    }
  }

  // Фото из ТРИГГЕРНОГО сообщения (≤2): signed URL → base64 inline.
  const triggerRefs = parseAttachmentUrls(trigger.attachment_url as string | null)
    .slice(0, AI_MAX_IMAGES);
  if (triggerRefs.length > 0 && aiMessages.length > 1) {
    const imageParts: LovableImagePart[] = [];
    for (const ref of triggerRefs) {
      const path = ref.replace(/^storage:\/\/tutor-chat-uploads\//, "");
      if (path === ref) continue; // не наш bucket — пропускаем
      try {
        const { data: signed } = await db.storage
          .from("tutor-chat-uploads")
          .createSignedUrl(path, 600);
        const inlined = await inlineImageUrlToBase64(signed?.signedUrl, "tsc_ai_inline");
        if (inlined) imageParts.push({ type: "image_url", image_url: { url: inlined } });
      } catch (err) {
        console.warn("tsc_ai_image_inline_failed", { error: String(err) });
      }
    }
    if (imageParts.length > 0) {
      const last = aiMessages[aiMessages.length - 1];
      const textPart: LovableTextPart = {
        type: "text",
        text: typeof last.content === "string" ? last.content : "",
      };
      last.content = [textPart, ...imageParts];
    }
  }

  // ── Вызов AI (буферизованный; realtime доставит строку обоим) ──
  let replyText: string | null = null;
  try {
    const result = await callLovableJson(
      aiMessages,
      "tutor_student_chat_ai",
      makeUsageLogger(db, { userId: authorUserId, source: "tutor_student_chat" }),
    );
    const raw = typeof result.reply === "string" ? result.reply.trim() : "";
    replyText = raw || null;
  } catch (err) {
    console.error("tsc_ai_call_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  if (!replyText) {
    await insertAssistantMessage(
      db,
      conversationId,
      "Не получилось ответить 😔 Попробуйте ещё раз: напишите @СократAI и свой вопрос.",
    );
    return new Response(JSON.stringify({ ok: true, failed: true }), { status: 200 });
  }

  await insertAssistantMessage(db, conversationId, replyText);
  // Usage-event уже записан ДО вызова (reservation) — здесь не дублируем.

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}

// ─── Server ──────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  const { segments, method, searchParams } = parseRoute(req);
  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  try {
    // ── Internal (service-role bearer only, до user-auth) ──
    if (segments[0] === "internal" && method === "POST") {
      if (!isInternalCaller(req)) {
        return jsonError(cors, 401, "UNAUTHORIZED", "Недостаточно прав.");
      }
      const body = await parseJsonBody(req);
      if (segments[1] === "notify") return await handleInternalNotify(db, body);
      if (segments[1] === "ai-reply") return await handleInternalAiReply(db, body);
      return jsonError(cors, 404, "NOT_FOUND", "Маршрут не найден.");
    }

    // ── User routes ──
    const auth = await authenticateUser(req, cors);
    if (auth instanceof Response) return auth;
    const { userId } = auth;

    if (segments.length === 1 && segments[0] === "conversations") {
      if (method === "GET") {
        return await handleListConversations(db, userId, cors, searchParams);
      }
      if (method === "POST") {
        const body = await parseJsonBody(req);
        return await handleCreateConversation(db, userId, cors, body);
      }
    }

    if (segments.length === 3 && segments[0] === "conversations" && UUID_RE.test(segments[1])) {
      const conversationId = segments[1];
      if (segments[2] === "messages" && method === "GET") {
        return await handleGetMessages(db, userId, cors, conversationId, searchParams);
      }
      if (segments[2] === "messages" && method === "POST") {
        const body = await parseJsonBody(req);
        return await handlePostMessage(db, userId, cors, conversationId, body);
      }
      if (segments[2] === "read" && method === "POST") {
        return await handleMarkRead(db, userId, cors, conversationId);
      }
    }

    // Диагностика push (2026-07-13): шлёт тестовый push ВЫЗЫВАЮЩЕМУ на его же
    // сохранённые подписки и возвращает точный статус от пуш-сервиса + префикс
    // серверного VAPID-ключа — снимает неоднозначность «подписка есть, а push
    // в telegram» (мисматч VAPID vs stale-подписка vs фокус/markRead).
    // Безопасно: только свои подписки, ничего не пишет.
    if (segments.length === 1 && segments[0] === "push-test" && method === "POST") {
      const { data: subs } = await db
        .from("push_subscriptions")
        .select("endpoint, p256dh, auth")
        .eq("user_id", userId);
      const list = (subs ?? []) as PushSubscriptionData[];
      const results: Array<Record<string, unknown>> = [];
      for (const sub of list) {
        try {
          const r = await sendPushNotification(
            sub,
            {
              title: "Сократ: тест уведомлений",
              body: "Если ты это видишь — push работает 🎉",
              url: getAppUrl(),
            },
            VAPID_PUBLIC_KEY,
            VAPID_PRIVATE_KEY,
            VAPID_SUBJECT,
          );
          results.push({
            endpoint_host: new URL(sub.endpoint).host,
            status: r.status,
            success: r.success,
            gone: r.gone,
            error: r.error ?? null,
          });
        } catch (e) {
          results.push({ error: e instanceof Error ? e.message : String(e) });
        }
      }
      // Изоляция InvalidEncoding: длины ключей (public P-256 = 65 байт,
      // private = 32, sub.p256dh = 65, sub.auth = 16) + отдельный импорт
      // приватного VAPID. Определяет, битый ли приватный ключ на сервере
      // (Lovable мог сохранить с обрезкой/пробелом) vs ключи подписки.
      let vapidPrivLen = -1;
      let vapidPubLen = -1;
      let vapidPrivImport = "not-run";
      try {
        vapidPrivLen = base64UrlDecode(VAPID_PRIVATE_KEY).length;
        vapidPubLen = base64UrlDecode(VAPID_PUBLIC_KEY).length;
      } catch (e) {
        vapidPrivImport = "decode-error: " + (e instanceof Error ? e.message : String(e));
      }
      if (vapidPrivImport === "not-run") {
        try {
          await importVapidPrivateKey(VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY);
          vapidPrivImport = "ok";
        } catch (e) {
          vapidPrivImport = "import-error: " + (e instanceof Error ? `${e.name}: ${e.message}` : String(e));
        }
      }
      const firstSub = list[0];
      // Пошаговая изоляция send-пайплайна: какой именно шаг даёт InvalidEncoding
      // (Node прошёл весь код с валидным ключом → баг Deno-специфичный либо в
      // конкретной подписке). jwt = createVapidJwt; subpub = raw ECDH import
      // публичного ключа подписки (главный подозреваемый — Deno strict).
      let jwtStep = "not-run";
      let subpubStep = "not-run";
      if (firstSub) {
        try {
          await createVapidJwt(new URL(firstSub.endpoint).origin, VAPID_SUBJECT, VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY);
          jwtStep = "ok";
        } catch (e) {
          jwtStep = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
        }
        try {
          const raw = base64UrlDecode(firstSub.p256dh);
          await crypto.subtle.importKey(
            "raw",
            raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer,
            { name: "ECDH", namedCurve: "P-256" },
            false,
            [],
          );
          subpubStep = "ok";
        } catch (e) {
          subpubStep = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
        }
      }
      return jsonOk(cors, {
        subscriptions_found: list.length,
        vapid_configured: Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY),
        vapid_public_prefix: VAPID_PUBLIC_KEY.slice(0, 16),
        vapid_public_len: vapidPubLen, // ожидается 65
        vapid_private_len: vapidPrivLen, // ожидается 32
        vapid_private_import: vapidPrivImport, // ожидается "ok"
        sub_p256dh_len: firstSub ? base64UrlDecode(firstSub.p256dh).length : null, // 65
        sub_auth_len: firstSub ? base64UrlDecode(firstSub.auth).length : null, // 16
        step_create_vapid_jwt: jwtStep, // ожидается "ok"
        step_import_sub_pubkey: subpubStep, // ← если тут ошибка, виновник найден
        results,
      });
    }

    return jsonError(cors, 404, "NOT_FOUND", "Маршрут не найден.");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // msg — только в серверный лог: текст исключения может раскрывать схему БД
    // (ревью 5.6 P2). Клиенту — стабильная rule-97 фраза.
    console.error("tutor_student_chat_api_unhandled", { error: msg });
    return jsonError(cors, 500, "INTERNAL", "Не удалось выполнить операцию. Попробуйте ещё раз.");
  }
});
