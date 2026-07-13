// tutor-student-chat-api — чат репетитор ↔ ученик (Telegram-like, 1:1 + группы).
//
// Direct-беседа = 1:1 с линком tutor_students (lazy-create). Групповая беседа
// (kind='group') = 1:1 с УЧЕБНОЙ группой tutor_groups (is_primary=true);
// членство НЕ копируется — живьём из tutor_group_memberships (миграция
// 20260713120000). ВСЕ записи идут через эту функцию (service_role) — у
// authenticated только SELECT (RLS в 20260712150000). Реалтайм доставляет
// INSERT/UPDATE клиентам напрямую.
//
// Роуты:
//   GET  /conversations?role=tutor|student        — список бесед (direct + группы)
//   POST /conversations {tutor_student_id | tutor_group_id} — get-or-create беседы
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
  "id, kind, tutor_student_id, tutor_group_id, last_message_at, last_message_preview, " +
  "last_message_sender, last_message_author_user_id, " +
  "tutor_last_read_at, student_last_read_at, tutor_unread_count, student_unread_count, " +
  "tutor_last_notified_at, student_last_notified_at";

const MESSAGE_SELECT =
  "id, conversation_id, sender_role, author_user_id, content, attachment_url, client_msg_id, created_at";

interface ConversationRow {
  id: string;
  kind: "direct" | "group";
  tutor_student_id: string | null;
  tutor_group_id: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  last_message_sender: string | null;
  last_message_author_user_id: string | null;
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

interface GroupRow {
  id: string;
  tutor_id: string;
  name: string;
  is_primary: boolean;
  is_active: boolean;
}

/** Активный не-архивный член группы (живое членство, mirror is_chat_conversation_member). */
interface GroupMemberRow {
  tutor_student_id: string;
  student_id: string;
  display_name: string | null;
}

interface MemberContext {
  conversation: ConversationRow;
  kind: "direct" | "group";
  /** direct only */
  link: LinkRow | null;
  /** group only */
  group: GroupRow | null;
  /** group only — активные не-архивные ученики группы */
  members: GroupMemberRow[] | null;
  tutor: TutorRow;
  role: "tutor" | "student";
}

/** Per-member state строка групповой беседы (tutor_chat_members). */
interface ChatMemberStateRow {
  conversation_id: string;
  user_id: string;
  last_read_at: string | null;
  unread_count: number;
  last_notified_at: string | null;
}

const MEMBER_STATE_SELECT =
  "conversation_id, user_id, last_read_at, unread_count, last_notified_at";

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

/** Группа + её репетитор + активные не-архивные члены (живое членство). */
async function loadGroupContext(
  db: SupabaseClient,
  tutorGroupId: string,
): Promise<{ group: GroupRow; tutor: TutorRow; members: GroupMemberRow[] } | null> {
  const { data: group, error: groupErr } = await db
    .from("tutor_groups")
    .select("id, tutor_id, name, is_primary, is_active")
    .eq("id", tutorGroupId)
    .maybeSingle();
  if (groupErr || !group) return null;
  const { data: tutor, error: tutorErr } = await db
    .from("tutors")
    .select("id, user_id, name, avatar_url, gender, telegram_id")
    .eq("id", (group as GroupRow).tutor_id)
    .maybeSingle();
  if (tutorErr || !tutor) return null;
  const { data: rows, error: memErr } = await db
    .from("tutor_group_memberships")
    .select("tutor_student_id, tutor_students!inner(id, student_id, display_name, archived_at)")
    .eq("tutor_group_id", tutorGroupId)
    .eq("is_active", true);
  if (memErr) return null;
  const members: GroupMemberRow[] = [];
  for (const r of (rows ?? []) as Array<Record<string, unknown>>) {
    const ts = r.tutor_students as
      | { id: string; student_id: string; display_name: string | null; archived_at: string | null }
      | null;
    if (!ts || ts.archived_at) continue;
    members.push({
      tutor_student_id: ts.id,
      student_id: ts.student_id,
      display_name: ts.display_name,
    });
  }
  return { group: group as GroupRow, tutor: tutor as TutorRow, members };
}

/** Беседа + линк/группа + роль вызывающего; null = не участник / не найдено. */
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
  const conversation = conv as ConversationRow;

  if (conversation.kind === "group" && conversation.tutor_group_id) {
    const loaded = await loadGroupContext(db, conversation.tutor_group_id);
    if (!loaded) return null;
    const { group, tutor, members } = loaded;
    let role: "tutor" | "student" | null = null;
    if (tutor.user_id === userId) role = "tutor";
    else if (members.some((m) => m.student_id === userId)) role = "student";
    if (!role) return null;
    return { conversation, kind: "group", link: null, group, members, tutor, role };
  }

  if (!conversation.tutor_student_id) return null;
  const loaded = await loadLinkAndTutor(db, conversation.tutor_student_id);
  if (!loaded) return null;
  const { link, tutor } = loaded;
  let role: "tutor" | "student" | null = null;
  if (link.student_id === userId) role = "student";
  else if (tutor.user_id === userId) role = "tutor";
  if (!role) return null;
  return { conversation, kind: "direct", link, group: null, members: null, tutor, role };
}

/** Identity партнёра для header/списка (column whitelist, никаких telegram-полей). */
async function buildPartnerIdentity(
  db: SupabaseClient,
  ctx: MemberContext,
): Promise<{ name: string; avatar_url: string | null; gender: string | null }> {
  if (ctx.kind === "group") {
    // «Партнёр» групповой беседы = сама группа (аватар рисует клиент).
    return { name: ctx.group?.name ?? "Группа", avatar_url: null, gender: null };
  }
  if (ctx.role === "student") {
    return {
      name: ctx.tutor.name?.trim() || "Репетитор",
      avatar_url: ctx.tutor.avatar_url ?? null,
      gender: ctx.tutor.gender ?? null,
    };
  }
  const link = ctx.link!;
  const { data: profile } = await db
    .from("profiles")
    .select("full_name, username, avatar_url, gender")
    .eq("id", link.student_id)
    .maybeSingle();
  return {
    name: resolveStudentName(
      link.display_name,
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
    /** Группы: «Вася: » перед превью (список различает авторов). */
    previewPrefix?: string;
  },
): Promise<PostMessageResult | null> {
  const basePreview = buildPreview(input.content, Boolean(input.attachmentUrl));
  const preview = basePreview && input.previewPrefix
    ? `${input.previewPrefix}${basePreview}`
    : basePreview;
  const { data, error } = await db.rpc("tsc_post_message", {
    _conversation_id: input.conversationId,
    _sender_role: input.senderRole,
    _author_user_id: input.authorUserId,
    _content: input.content,
    _attachment_url: input.attachmentUrl,
    _client_msg_id: input.clientMsgId,
    _preview: preview,
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

type ListItem = Record<string, unknown> & {
  last_message_at: string | null;
  partner_name: string;
};

function byListOrder(a: ListItem, b: ListItem): number {
  const at = a.last_message_at ? Date.parse(a.last_message_at) : 0;
  const bt = b.last_message_at ? Date.parse(b.last_message_at) : 0;
  if (at !== bt) return bt - at;
  return a.partner_name.localeCompare(b.partner_name, "ru");
}

/**
 * Синтез групповых строк списка (lazy: группа видна сразу после создания,
 * физическая беседа создаётся при первом открытии). null = db-ошибка
 * (частичный сбой НЕ маскируем — mirror батч-инварианта direct-веток).
 */
async function buildGroupListItems(
  db: SupabaseClient,
  groups: Array<{ id: string; name: string }>,
  myUserId: string,
): Promise<ListItem[] | null> {
  if (groups.length === 0) return [];
  const groupIds = groups.map((g) => g.id);
  const [convsRes, memsRes] = await Promise.all([
    db.from("tutor_student_conversations").select(CONVERSATION_SELECT).in("tutor_group_id", groupIds),
    db
      .from("tutor_group_memberships")
      .select("tutor_group_id, tutor_students!inner(student_id, archived_at)")
      .eq("is_active", true)
      .in("tutor_group_id", groupIds),
  ]);
  if (convsRes.error || memsRes.error) {
    console.error("tsc_list_groups_batch_failed", {
      convs: convsRes.error?.message ?? null,
      mems: memsRes.error?.message ?? null,
    });
    return null;
  }
  const convByGroup = new Map(
    ((convsRes.data ?? []) as ConversationRow[]).map((c) => [c.tutor_group_id, c]),
  );
  // member_count = активные не-архивные ученики + репетитор.
  const countByGroup = new Map<string, number>();
  for (const r of (memsRes.data ?? []) as Array<Record<string, unknown>>) {
    const ts = r.tutor_students as { archived_at: string | null } | null;
    if (!ts || ts.archived_at) continue;
    const gid = r.tutor_group_id as string;
    countByGroup.set(gid, (countByGroup.get(gid) ?? 0) + 1);
  }

  const convIds = [...convByGroup.values()].map((c) => c.id);
  let stateRows: ChatMemberStateRow[] = [];
  if (convIds.length > 0) {
    const { data: states, error: statesErr } = await db
      .from("tutor_chat_members")
      .select(MEMBER_STATE_SELECT)
      .in("conversation_id", convIds);
    if (statesErr) {
      console.error("tsc_list_groups_states_failed", { error: statesErr.message });
      return null;
    }
    stateRows = (states ?? []) as ChatMemberStateRow[];
  }
  const myStateByConv = new Map<string, ChatMemberStateRow>();
  const peerReadMaxByConv = new Map<string, string>();
  for (const s of stateRows) {
    if (s.user_id === myUserId) {
      myStateByConv.set(s.conversation_id, s);
    } else if (s.last_read_at) {
      const prev = peerReadMaxByConv.get(s.conversation_id);
      if (!prev || Date.parse(s.last_read_at) > Date.parse(prev)) {
        peerReadMaxByConv.set(s.conversation_id, s.last_read_at);
      }
    }
  }

  return groups.map((g) => {
    const conv = convByGroup.get(g.id) ?? null;
    const memberCount = (countByGroup.get(g.id) ?? 0) + 1;
    return {
      kind: "group",
      tutor_student_id: null,
      tutor_group_id: g.id,
      conversation_id: conv?.id ?? null,
      partner_name: g.name,
      partner_avatar_url: null,
      partner_gender: null,
      group: { id: g.id, name: g.name, member_count: memberCount },
      last_message_at: conv?.last_message_at ?? null,
      last_message_preview: conv?.last_message_preview ?? null,
      last_message_sender: conv?.last_message_sender ?? null,
      last_message_author_user_id: conv?.last_message_author_user_id ?? null,
      unread_count: conv ? (myStateByConv.get(conv.id)?.unread_count ?? 0) : 0,
      peer_last_read_at: conv ? (peerReadMaxByConv.get(conv.id) ?? null) : null,
      archived: false,
    };
  });
}

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
  // Capability opt-in (ревью 5.6 р.2 #5, deploy-skew): групповые строки отдаём
  // ТОЛЬКО клиенту, который их понимает (?groups=1). Старый бандл/stale PWA
  // ронял бы на них React-ключи (tutor_student_id=null) и direct-create без
  // ученика. Убрать флаг после стабилизации PWA-кэшей (отдельный коммит).
  const groupsEnabled = searchParams.get("groups") === "1";

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

    // Групповые чаты: все учебные (is_primary) активные группы репетитора.
    let groupItems: ListItem[] = [];
    if (groupsEnabled) {
      const { data: groupRows, error: groupsErr } = await db
        .from("tutor_groups")
        .select("id, name")
        .eq("tutor_id", tutorPk)
        .eq("is_primary", true)
        .eq("is_active", true);
      if (groupsErr) {
        console.error("tsc_list_tutor_groups_failed", { error: groupsErr.message });
        return jsonError(cors, 500, "DB_ERROR", "Не удалось загрузить список чатов.");
      }
      const built = await buildGroupListItems(
        db,
        (groupRows ?? []) as Array<{ id: string; name: string }>,
        userId,
      );
      if (built === null) {
        return jsonError(cors, 500, "DB_ERROR", "Не удалось загрузить список чатов.");
      }
      groupItems = built;
    }

    if (linkRows.length === 0) {
      groupItems.sort(byListOrder);
      return jsonOk(cors, { items: groupItems, role });
    }

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
          kind: "direct",
          tutor_student_id: l.id,
          tutor_group_id: null,
          conversation_id: conv?.id ?? null,
          partner_name: resolveStudentName(l.display_name, profile?.full_name, profile?.username),
          partner_avatar_url: profile?.avatar_url ?? null,
          partner_gender: profile?.gender ?? null,
          group: null,
          last_message_at: conv?.last_message_at ?? null,
          last_message_preview: conv?.last_message_preview ?? null,
          last_message_sender: conv?.last_message_sender ?? null,
          last_message_author_user_id: conv?.last_message_author_user_id ?? null,
          unread_count: conv?.tutor_unread_count ?? 0,
          peer_last_read_at: conv?.student_last_read_at ?? null,
          archived: Boolean(l.archived_at),
        };
      })
      .filter(Boolean) as ListItem[];

    items.push(...groupItems);
    items.sort(byListOrder);
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

  // Групповые чаты ученика: активные учебные группы, где он не-архивный член.
  let studentGroups: Array<{ id: string; name: string }> = [];
  const activeLinkIds = groupsEnabled
    ? linkRows.filter((l) => !l.archived_at).map((l) => l.id)
    : [];
  if (activeLinkIds.length > 0) {
    const { data: mems, error: memsErr } = await db
      .from("tutor_group_memberships")
      .select("tutor_group_id")
      .in("tutor_student_id", activeLinkIds)
      .eq("is_active", true);
    if (memsErr) {
      console.error("tsc_list_student_mems_failed", { error: memsErr.message });
      return jsonError(cors, 500, "DB_ERROR", "Не удалось загрузить список чатов.");
    }
    const groupIds = [...new Set(((mems ?? []) as Array<{ tutor_group_id: string }>).map((m) => m.tutor_group_id))];
    if (groupIds.length > 0) {
      const { data: groups, error: groupsErr } = await db
        .from("tutor_groups")
        .select("id, name")
        .in("id", groupIds)
        .eq("is_primary", true)
        .eq("is_active", true);
      if (groupsErr) {
        console.error("tsc_list_student_groups_failed", { error: groupsErr.message });
        return jsonError(cors, 500, "DB_ERROR", "Не удалось загрузить список чатов.");
      }
      studentGroups = (groups ?? []) as Array<{ id: string; name: string }>;
    }
  }
  const groupItems = await buildGroupListItems(db, studentGroups, userId);
  if (groupItems === null) {
    return jsonError(cors, 500, "DB_ERROR", "Не удалось загрузить список чатов.");
  }

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
        kind: "direct",
        tutor_student_id: l.id,
        tutor_group_id: null,
        conversation_id: conv?.id ?? null,
        partner_name: tutor?.name?.trim() || "Репетитор",
        partner_avatar_url: tutor?.avatar_url ?? null,
        partner_gender: tutor?.gender ?? null,
        group: null,
        last_message_at: conv?.last_message_at ?? null,
        last_message_preview: conv?.last_message_preview ?? null,
        last_message_sender: conv?.last_message_sender ?? null,
        last_message_author_user_id: conv?.last_message_author_user_id ?? null,
        unread_count: conv?.student_unread_count ?? 0,
        peer_last_read_at: conv?.tutor_last_read_at ?? null,
        archived: Boolean(l.archived_at),
      };
    })
    .filter(Boolean) as ListItem[];

  items.push(...groupItems);
  items.sort(byListOrder);
  return jsonOk(cors, { items, role });
}

// ─── Endpoint: POST /conversations (get-or-create) ───────────────────────────

async function handleCreateConversation(
  db: SupabaseClient,
  userId: string,
  cors: Record<string, string>,
  body: Record<string, unknown> | null,
): Promise<Response> {
  // ── Групповая беседа: get-or-create по учебной группе ──
  const tutorGroupId = typeof body?.tutor_group_id === "string" ? body.tutor_group_id : "";
  if (UUID_RE.test(tutorGroupId)) {
    const loadedGroup = await loadGroupContext(db, tutorGroupId);
    if (!loadedGroup || !loadedGroup.group.is_primary || !loadedGroup.group.is_active) {
      return jsonError(cors, 404, "NOT_FOUND", "Группа не найдена.");
    }
    const { group, tutor, members } = loadedGroup;
    const role = tutor.user_id === userId
      ? "tutor"
      : members.some((m) => m.student_id === userId)
        ? "student"
        : null;
    if (!role) {
      return jsonError(cors, 403, "FORBIDDEN", "Вы не состоите в этой группе.");
    }
    const { error: upsertErr } = await db
      .from("tutor_student_conversations")
      .upsert({ kind: "group", tutor_group_id: group.id }, {
        onConflict: "tutor_group_id",
        ignoreDuplicates: true,
      });
    if (upsertErr) {
      console.error("tsc_create_group_conversation_failed", { error: upsertErr.message });
      return jsonError(cors, 500, "DB_ERROR", "Не удалось создать чат. Попробуйте ещё раз.");
    }
    const { data: conv, error: selErr } = await db
      .from("tutor_student_conversations")
      .select("id")
      .eq("tutor_group_id", group.id)
      .single();
    if (selErr || !conv) {
      console.error("tsc_create_group_conversation_select_failed", { error: selErr?.message });
      return jsonError(cors, 500, "DB_ERROR", "Не удалось создать чат. Попробуйте ещё раз.");
    }
    return jsonOk(cors, { conversation_id: (conv as { id: string }).id, role });
  }

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

  if (ctx.kind === "group" && ctx.group && ctx.members) {
    // Идентичности участников (репетитор + активные ученики) + read-state.
    const studentIds = ctx.members.map((m) => m.student_id);
    const [profilesRes, statesRes] = await Promise.all([
      studentIds.length > 0
        ? db.from("profiles").select("id, full_name, username, avatar_url, gender").in("id", studentIds)
        : Promise.resolve({ data: [], error: null }),
      db.from("tutor_chat_members").select(MEMBER_STATE_SELECT).eq("conversation_id", conversationId),
    ]);
    // Сбой батча НЕ маскируем 200-кой (ревью 5.6 р.2 #4): деградировавшая meta
    // (нулевые watermark'и) затёрла бы хороший клиентский кэш — ✓✓ бы «мигали».
    if (profilesRes.error || statesRes.error) {
      console.error("tsc_get_messages_group_batch_failed", {
        profiles: profilesRes.error?.message ?? null,
        states: statesRes.error?.message ?? null,
      });
      return jsonError(cors, 500, "DB_ERROR", "Не удалось загрузить сообщения.");
    }
    const profileById = new Map(
      ((profilesRes.data ?? []) as Array<
        { id: string; full_name: string | null; username: string | null; avatar_url: string | null; gender: string | null }
      >).map((p) => [p.id, p]),
    );
    const stateRows = (statesRes.data ?? []) as ChatMemberStateRow[];
    let myLastReadAt: string | null = null;
    let peerLastReadAt: string | null = null;
    for (const s of stateRows) {
      if (s.user_id === userId) {
        myLastReadAt = s.last_read_at;
      } else if (s.last_read_at) {
        // ✓✓ «прочитал хотя бы один» = MAX по остальным членам.
        if (!peerLastReadAt || Date.parse(s.last_read_at) > Date.parse(peerLastReadAt)) {
          peerLastReadAt = s.last_read_at;
        }
      }
    }
    const members = [
      {
        user_id: ctx.tutor.user_id,
        name: ctx.tutor.name?.trim() || "Репетитор",
        avatar_url: ctx.tutor.avatar_url ?? null,
        gender: ctx.tutor.gender ?? null,
        role: "tutor",
      },
      ...ctx.members.map((m) => {
        const profile = profileById.get(m.student_id);
        return {
          user_id: m.student_id,
          name: resolveStudentName(m.display_name, profile?.full_name, profile?.username),
          avatar_url: profile?.avatar_url ?? null,
          gender: profile?.gender ?? null,
          role: "student",
        };
      }),
    ];

    return jsonOk(cors, {
      messages,
      has_more: hasMore,
      conversation: {
        id: ctx.conversation.id,
        kind: "group",
        tutor_student_id: null,
        tutor_group_id: ctx.group.id,
        my_role: ctx.role,
        archived: !ctx.group.is_active,
        tutor_last_read_at: null,
        student_last_read_at: null,
        my_last_read_at: myLastReadAt,
        peer_last_read_at: peerLastReadAt,
        partner,
        group: { id: ctx.group.id, name: ctx.group.name, member_count: members.length },
        members,
      },
    });
  }

  const link = ctx.link!;
  return jsonOk(cors, {
    messages,
    has_more: hasMore,
    conversation: {
      id: ctx.conversation.id,
      kind: "direct",
      tutor_student_id: link.id,
      tutor_group_id: null,
      my_role: ctx.role,
      archived: Boolean(link.archived_at),
      tutor_last_read_at: ctx.conversation.tutor_last_read_at,
      student_last_read_at: ctx.conversation.student_last_read_at,
      my_last_read_at: ctx.role === "tutor"
        ? ctx.conversation.tutor_last_read_at
        : ctx.conversation.student_last_read_at,
      peer_last_read_at: ctx.role === "tutor"
        ? ctx.conversation.student_last_read_at
        : ctx.conversation.tutor_last_read_at,
      partner,
      group: null,
      members: null,
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
  if (ctx.kind === "direct" && ctx.link?.archived_at) {
    return jsonError(
      cors,
      403,
      "CHAT_ARCHIVED",
      "Ученик в архиве — отправка сообщений недоступна. История сохранена.",
    );
  }
  if (ctx.kind === "group" && ctx.group && !ctx.group.is_active) {
    return jsonError(
      cors,
      403,
      "CHAT_ARCHIVED",
      "Группа неактивна — отправка сообщений недоступна. История сохранена.",
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

  // Группа: имя автора печётся в превью списка («Вася: держите фото…») —
  // sender_role='student' не различает учеников группы.
  let previewPrefix: string | undefined;
  if (ctx.kind === "group") {
    let authorName: string;
    if (ctx.role === "tutor") {
      authorName = ctx.tutor.name?.trim() || "Репетитор";
    } else {
      const member = ctx.members?.find((m) => m.student_id === userId);
      authorName = member?.display_name?.trim() || "Ученик";
    }
    previewPrefix = `${authorName.split(/\s+/)[0]}: `;
  }

  // Атомарно: insert + идемпотентный дедуп + денорм одной транзакцией (RPC).
  const posted = await postMessageAtomic(db, {
    conversationId,
    senderRole: ctx.role,
    authorUserId: userId,
    content: trimmed,
    attachmentUrl: serializeAttachmentUrls(refs),
    clientMsgId,
    previewPrefix,
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
      tutor_id: ctx.kind === "group" ? ctx.group!.tutor_id : ctx.link!.tutor_id,
      student_id: ctx.kind === "group"
        ? (ctx.role === "student" ? userId : null)
        : ctx.link!.student_id,
      tutor_student_id: ctx.link?.id ?? null,
      source: ctx.role,
    });
  }

  // Delayed-уведомление (не await — отдельный isolate спит 15с). Группа —
  // без recipient: хендлер сам резолвит АКТУАЛЬНЫХ членов после сна.
  enqueueInternal(
    "notify",
    ctx.kind === "group"
      ? { conversation_id: conversationId, message_id: message.id }
      : {
        conversation_id: conversationId,
        message_id: message.id,
        recipient: ctx.role === "tutor" ? "student" : "tutor",
      },
  );

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

  if (ctx.kind === "group") {
    // Групповая беседа: своя member-строка (watermark + сброс бейджа).
    const { error } = await db
      .from("tutor_chat_members")
      .upsert(
        { conversation_id: conversationId, user_id: userId, last_read_at: nowIso, unread_count: 0 },
        { onConflict: "conversation_id,user_id" },
      );
    if (error) {
      console.error("tsc_mark_read_group_failed", { error: error.message });
      return jsonError(cors, 500, "DB_ERROR", "Не удалось отметить прочитанным.");
    }
    return jsonOk(cors, { ok: true, read_at: nowIso });
  }

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

/** Push на все подписки получателя; true = доставлено (first-success). */
async function deliverPush(
  db: SupabaseClient,
  recipientUserId: string,
  payload: PushPayload,
): Promise<boolean> {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false;
  const { data: subs } = await db
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("user_id", recipientUserId);
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
      if (result.success) return true;
    } catch (err) {
      console.warn("tsc_notify_push_error", { error: String(err) });
    }
  }
  return false;
}

/** Telegram chat_id ученика: profiles.telegram_user_id → telegram_sessions. */
async function resolveStudentTelegramChatId(
  db: SupabaseClient,
  studentUserId: string,
): Promise<number | null> {
  const { data: profile } = await db
    .from("profiles")
    .select("telegram_user_id")
    .eq("id", studentUserId)
    .maybeSingle();
  let chatId = (profile?.telegram_user_id as number | null) ?? null;
  if (!chatId) {
    const { data: session } = await db
      .from("telegram_sessions")
      .select("telegram_user_id")
      .eq("user_id", studentUserId)
      .maybeSingle();
    chatId = (session?.telegram_user_id as number | null) ?? null;
  }
  return chatId;
}

/** tutors.telegram_id — TEXT; NaN → канала нет. */
function parseTutorTelegramChatId(raw: string | null): number | null {
  const parsed = Number(raw ?? "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** HTML-сообщение в Telegram; true = отправлено. */
async function deliverTelegram(
  chatId: number | null,
  senderLabel: string,
  preview: string,
  url: string,
): Promise<boolean> {
  if (!chatId || !TELEGRAM_BOT_TOKEN) return false;
  try {
    const text = `💬 <b>${escapeHtmlEntities(senderLabel)}</b>: ${
      escapeHtmlEntities(preview)
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
    return tgResp.ok;
  } catch (err) {
    console.warn("tsc_notify_telegram_error", { error: String(err) });
    return false;
  }
}

async function handleInternalNotify(
  db: SupabaseClient,
  body: Record<string, unknown> | null,
): Promise<Response> {
  const conversationId = typeof body?.conversation_id === "string" ? body.conversation_id : "";
  const messageId = typeof body?.message_id === "string" ? body.message_id : "";
  // recipient задан для direct-бесед; группа резолвит получателей сама.
  const recipient = body?.recipient === "tutor" || body?.recipient === "student"
    ? body.recipient
    : null;
  if (!UUID_RE.test(conversationId) || !UUID_RE.test(messageId)) {
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
    .select("id, content, attachment_url, sender_role, author_user_id, created_at")
    .eq("id", messageId)
    .maybeSingle();
  if (!conv || !msg) return new Response(JSON.stringify({ ok: true }), { status: 200 });
  const conversation = conv as ConversationRow;
  const senderRole = msg.sender_role as string;
  if (senderRole === "assistant") {
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  const contentPreview = buildPreview(
    (msg.content as string) ?? "",
    parseAttachmentUrls(msg.attachment_url as string | null).length > 0,
  ) ?? "Новое сообщение";
  const shortPreview = contentPreview.length > NOTIFY_PREVIEW_CHARS
    ? `${contentPreview.slice(0, NOTIFY_PREVIEW_CHARS - 1)}…`
    : contentPreview;
  const appUrl = getAppUrl();

  // ── Групповая беседа: fan-out всем ТЕКУЩИМ членам, кроме автора ──
  if (conversation.kind === "group" && conversation.tutor_group_id) {
    const loaded = await loadGroupContext(db, conversation.tutor_group_id);
    if (!loaded) return new Response(JSON.stringify({ ok: true }), { status: 200 });
    const { group, tutor, members } = loaded;
    const authorUserId = (msg.author_user_id as string | null) ?? null;

    let senderName: string;
    if (senderRole === "tutor") {
      senderName = tutor.name?.trim() || "Репетитор";
    } else {
      const authorMember = members.find((m) => m.student_id === authorUserId);
      const { data: profile } = authorUserId
        ? await db
          .from("profiles")
          .select("full_name, username")
          .eq("id", authorUserId)
          .maybeSingle()
        : { data: null };
      senderName = resolveStudentName(
        authorMember?.display_name,
        (profile?.full_name as string | null) ?? null,
        (profile?.username as string | null) ?? null,
      );
    }
    const senderLabel = `${senderName} · ${group.name}`;

    const { data: states, error: statesErr } = await db
      .from("tutor_chat_members")
      .select(MEMBER_STATE_SELECT)
      .eq("conversation_id", conversationId);
    if (statesErr) {
      // Fail-closed (ревью 5.6 р.2 #4): без state нельзя проверить read/throttle —
      // лучше пропустить уведомление, чем спамить читающих и обойти троттлинг.
      console.error("tsc_notify_group_states_failed", { error: statesErr.message });
      return new Response(JSON.stringify({ ok: true, skipped: "state_error" }), { status: 200 });
    }
    const stateByUser = new Map(
      ((states ?? []) as ChatMemberStateRow[]).map((s) => [s.user_id, s]),
    );

    const targets: Array<{ userId: string; role: "tutor" | "student"; url: string }> = [];
    if (tutor.user_id !== authorUserId) {
      targets.push({
        userId: tutor.user_id,
        role: "tutor",
        url: `${appUrl}/tutor/chat/${conversationId}`,
      });
    }
    for (const m of members) {
      if (m.student_id === authorUserId) continue;
      targets.push({
        userId: m.student_id,
        role: "student",
        url: `${appUrl}/chat?id=group:${conversationId}`,
      });
    }

    const msgCreatedMs = Date.parse(msg.created_at as string);
    // Каскад одному получателю: push → telegram → отметка троттлинга.
    const deliverToTarget = async (
      t: { userId: string; role: "tutor" | "student"; url: string },
    ): Promise<boolean> => {
      const state = stateByUser.get(t.userId);
      // Per-member re-check + троттлинг (mirror direct, но по member-строке).
      if (state?.last_read_at && Date.parse(state.last_read_at) >= msgCreatedMs) return false;
      if (
        state?.last_notified_at &&
        Date.now() - Date.parse(state.last_notified_at) < NOTIFY_THROTTLE_MS
      ) return false;

      let delivered = await deliverPush(db, t.userId, {
        title: senderLabel,
        body: shortPreview,
        url: t.url,
      });
      if (!delivered) {
        const chatId = t.role === "student"
          ? await resolveStudentTelegramChatId(db, t.userId)
          : parseTutorTelegramChatId(tutor.telegram_id);
        delivered = await deliverTelegram(chatId, senderLabel, shortPreview, t.url);
      }
      if (delivered) {
        await db
          .from("tutor_chat_members")
          .upsert(
            {
              conversation_id: conversationId,
              user_id: t.userId,
              last_notified_at: new Date().toISOString(),
            },
            { onConflict: "conversation_id,user_id" },
          );
      }
      return delivered;
    };

    // Чанки по 4 (ревью 5.6 р.2 #12): последовательный каскад ×15 участников с
    // медленными push-endpoint'ами линейно растил задержку последним получателям.
    let deliveredCount = 0;
    const NOTIFY_CONCURRENCY = 4;
    for (let i = 0; i < targets.length; i += NOTIFY_CONCURRENCY) {
      const chunk = targets.slice(i, i + NOTIFY_CONCURRENCY);
      const results = await Promise.allSettled(chunk.map((t) => deliverToTarget(t)));
      for (const r of results) {
        if (r.status === "fulfilled" && r.value) deliveredCount += 1;
        if (r.status === "rejected") {
          console.warn("tsc_notify_group_target_failed", { error: String(r.reason) });
        }
      }
    }
    return new Response(JSON.stringify({ ok: true, delivered: deliveredCount }), { status: 200 });
  }

  // ── Direct-беседа: прежний одиночный recipient ──
  if (!recipient || !conversation.tutor_student_id) {
    return new Response(JSON.stringify({ ok: true, skipped: "no_recipient" }), { status: 200 });
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

  const recipientUserId = recipient === "tutor" ? tutor.user_id : link.student_id;
  const url = recipient === "tutor"
    ? `${appUrl}/tutor/chat/${conversationId}`
    : `${appUrl}/chat?id=tutor:${conversationId}`;

  let delivered = await deliverPush(db, recipientUserId, {
    title: `Сообщение от ${senderName}`,
    body: shortPreview,
    url,
  });
  if (!delivered) {
    const chatId = recipient === "student"
      ? await resolveStudentTelegramChatId(db, link.student_id)
      : parseTutorTelegramChatId(tutor.telegram_id);
    delivered = await deliverTelegram(chatId, senderName, shortPreview, url);
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

function buildChatAiSystemPrompt(params: {
  kind: "direct" | "group";
  tutorName: string;
  studentName?: string;
  groupName?: string;
  memberNames?: string[];
}): string {
  const whoLine = params.kind === "group"
    ? `Тебя позвали упоминанием @СократAI. Это ГРУППОВОЙ чат группы «${params.groupName ?? "Группа"}»: репетитор ${params.tutorName} и ученики: ${
      params.memberNames && params.memberNames.length > 0 ? params.memberNames.join(", ") : "участники группы"
    }.`
    : `Тебя позвали упоминанием @СократAI. В чате два человека: репетитор ${params.tutorName} и ученик ${params.studentName ?? "Ученик"}.`;
  const addressLine = params.kind === "group"
    ? "- Обращайся ПО ИМЕНИ к тому, кто задал вопрос. Не выдумывай сообщений за участников."
    : "- Обращайся к тому, кто задал вопрос. Не выдумывай сообщений за репетитора или ученика.";
  return [
    "Ты — Сократ AI, помощник в общем чате репетитора и ученика на платформе «Сократ AI».",
    whoLine,
    "Сообщения в истории помечены, кто их написал.",
    "",
    "Правила:",
    "- Отвечай по-русски, по существу и достаточно кратко (обычно до 150 слов).",
    "- Пиши обычным текстом БЕЗ markdown-разметки: никаких **звёздочек**, ## заголовков и списков со звёздочками. Нумерованные пункты «1. 2. 3.» — можно.",
    "- Формулы пиши в LaTeX с $...$ (inline) или $$...$$ (display).",
    "- Здесь МОЖНО давать полное решение и прямой ответ: репетитор присутствует в чате и сам решает, как использовать твой разбор.",
    addressLine,
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
    .select("id, kind, tutor_student_id, tutor_group_id")
    .eq("id", conversationId)
    .maybeSingle();
  const { data: trigger } = await db
    .from("tutor_student_chat_messages")
    .select("id, sender_role, author_user_id, content, attachment_url, created_at")
    .eq("id", messageId)
    .maybeSingle();
  if (!conv || !trigger) return new Response(JSON.stringify({ ok: true }), { status: 200 });

  const convRow = conv as {
    id: string;
    kind: "direct" | "group";
    tutor_student_id: string | null;
    tutor_group_id: string | null;
  };
  const isGroup = convRow.kind === "group" && Boolean(convRow.tutor_group_id);

  let link: LinkRow | null = null;
  let group: GroupRow | null = null;
  let members: GroupMemberRow[] = [];
  let tutor: TutorRow;
  if (isGroup) {
    const loadedGroup = await loadGroupContext(db, convRow.tutor_group_id!);
    if (!loadedGroup) return new Response(JSON.stringify({ ok: true }), { status: 200 });
    group = loadedGroup.group;
    tutor = loadedGroup.tutor;
    members = loadedGroup.members;
  } else {
    if (!convRow.tutor_student_id) {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    const loaded = await loadLinkAndTutor(db, convRow.tutor_student_id);
    if (!loaded) return new Response(JSON.stringify({ ok: true }), { status: 200 });
    link = loaded.link;
    tutor = loaded.tutor;
  }
  const tutorPkId = isGroup ? group!.tutor_id : link!.tutor_id;

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
      .eq("tutor_id", tutorPkId)
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
    tutor_id: tutorPkId,
    student_id: link?.student_id ?? (senderRole === "student" ? authorUserId : null),
    tutor_student_id: link?.id ?? null,
  });

  // «СократAI печатает…» — degrade-safe broadcast, пока ждём gateway.
  void broadcastAssistantTyping(conversationId, 40_000);

  // ── Контекст: последние N сообщений (ASC) с пометкой автора ──
  const { data: historyRows } = await db
    .from("tutor_student_chat_messages")
    .select("sender_role, author_user_id, content, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(AI_CONTEXT_MESSAGES);
  const history = ((historyRows ?? []) as Array<
    { sender_role: string; author_user_id: string | null; content: string; created_at: string }
  >).reverse();

  // Карта uid → имя (в группе различает учеников; в 1:1 — один ученик).
  const tutorName = tutor.name?.trim() || "Репетитор";
  const nameByUid = new Map<string, string>();
  nameByUid.set(tutor.user_id, tutorName);
  let studentName = "Ученик";
  if (isGroup) {
    const memberIds = members.map((m) => m.student_id);
    const { data: profs } = memberIds.length > 0
      ? await db.from("profiles").select("id, full_name, username").in("id", memberIds)
      : { data: [] };
    const profById = new Map(
      ((profs ?? []) as Array<{ id: string; full_name: string | null; username: string | null }>)
        .map((p) => [p.id, p]),
    );
    for (const m of members) {
      const p = profById.get(m.student_id);
      nameByUid.set(
        m.student_id,
        resolveStudentName(m.display_name, p?.full_name ?? null, p?.username ?? null),
      );
    }
  } else {
    const { data: studentProfile } = await db
      .from("profiles")
      .select("full_name, username")
      .eq("id", link!.student_id)
      .maybeSingle();
    studentName = resolveStudentName(
      link!.display_name,
      studentProfile?.full_name as string | null,
      studentProfile?.username as string | null,
    );
    nameByUid.set(link!.student_id, studentName);
  }

  const systemPrompt = buildChatAiSystemPrompt(
    isGroup
      ? {
        kind: "group",
        tutorName,
        groupName: group!.name,
        memberNames: members.map((m) => nameByUid.get(m.student_id) ?? "Ученик"),
      }
      : { kind: "direct", tutorName, studentName },
  );
  const aiMessages: LovableMessage[] = [{ role: "system", content: systemPrompt }];
  for (const h of history) {
    if (!h.content?.trim()) continue;
    if (h.sender_role === "assistant") {
      aiMessages.push({ role: "assistant", content: h.content });
    } else if (h.sender_role === "tutor") {
      aiMessages.push({ role: "user", content: `Репетитор ${tutorName}: ${h.content}` });
    } else {
      const name = (h.author_user_id ? nameByUid.get(h.author_user_id) : null) ??
        (isGroup ? null : studentName);
      const label = name ? `Ученик ${name}` : "Ученик";
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
