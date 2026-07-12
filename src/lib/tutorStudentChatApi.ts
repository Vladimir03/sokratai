import { supabase } from '@/lib/supabaseClient';
import { compressForUpload } from '@/lib/imageCompression';
import { parseISO } from 'date-fns';
import type {
  ChatConversationListItem,
  ChatConversationMeta,
  ChatPerspective,
  TutorStudentChatMessage,
} from '@/types/tutorStudentChat';

// ─── tutor-student-chat-api client (чат репетитор↔ученик) ──────────────────────
//
// Transport mirrors `studentScheduleApi.requestStudentLessonsApi` (тот же
// 401 → refreshSession + retry-once flow + rule-97 flat `{error, code}` parsing),
// но со СВОИМ error-классом: клиент shared между student и tutor поверхностями
// (module isolation — не тянем student-side StudentHomeworkApiError в кабинет).

// HARDCODED — see src/lib/supabaseClient.ts (RU bypass, ignore Lovable auto-env).
const SUPABASE_URL = 'https://api.sokratai.ru';
const SUPABASE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZyc3Nlb3RyZm1zeHBiY2l5cXpjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk0MjEzMDYsImV4cCI6MjA3NDk5NzMwNn0.fDleU99ULnIvtbiJqlKtgaabZzIWqqw6gZLWQOFAcKw';

export class ChatApiError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'ChatApiError';
    this.code = code;
  }
}

async function requestChatApi<T>(path: string, options: RequestInit = {}): Promise<T> {
  const doFetch = async (): Promise<Response> => {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) {
      throw new ChatApiError('Нет активной сессии', 'NO_SESSION');
    }
    return fetch(`${SUPABASE_URL}/functions/v1/tutor-student-chat-api${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_KEY,
        ...(options.headers ?? {}),
      },
    });
  };

  let response = await doFetch();

  if (response.status === 401) {
    const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError || !refreshData?.session) {
      await supabase.auth.signOut().catch(() => undefined);
      throw new ChatApiError('Сессия истекла. Перенаправляем на вход…', 'SESSION_EXPIRED');
    }
    response = await doFetch();
  }

  if (!response.ok) {
    let body: { error?: unknown; code?: unknown } = {};
    try {
      body = await response.json();
    } catch {
      // ignore parse errors — fall back to HTTP status
    }
    const message =
      typeof body.error === 'string' && body.error.trim().length > 0
        ? body.error.trim()
        : `HTTP ${response.status}`;
    const code = typeof body.code === 'string' ? body.code : undefined;
    throw new ChatApiError(message, code);
  }

  return response.json() as Promise<T>;
}

// ─── API calls ──────────────────────────────────────────────────────────────────

export async function listChatConversations(
  role: ChatPerspective,
): Promise<ChatConversationListItem[]> {
  const res = await requestChatApi<{ items: ChatConversationListItem[] }>(
    `/conversations?role=${role}`,
    { method: 'GET' },
  );
  return res.items ?? [];
}

export async function ensureChatConversation(
  tutorStudentId: string,
): Promise<{ conversation_id: string; role: ChatPerspective }> {
  return requestChatApi(`/conversations`, {
    method: 'POST',
    body: JSON.stringify({ tutor_student_id: tutorStudentId }),
  });
}

export interface FetchChatMessagesResult {
  messages: TutorStudentChatMessage[];
  has_more: boolean;
  conversation: ChatConversationMeta;
}

export async function fetchChatMessages(
  conversationId: string,
  opts: { before?: string; beforeId?: string; limit?: number } = {},
): Promise<FetchChatMessagesResult> {
  const params = new URLSearchParams();
  if (opts.before) params.set('before', opts.before);
  // Составной keyset (created_at, id) — иначе сообщения с одинаковым timestamp
  // на границе страницы теряются (ревью 5.6 P1).
  if (opts.beforeId) params.set('before_id', opts.beforeId);
  if (opts.limit) params.set('limit', String(opts.limit));
  const qs = params.toString();
  return requestChatApi(
    `/conversations/${encodeURIComponent(conversationId)}/messages${qs ? `?${qs}` : ''}`,
    { method: 'GET' },
  );
}

export async function sendChatMessageApi(
  conversationId: string,
  input: { content: string; attachment_refs?: string[]; client_msg_id: string },
): Promise<{ message: TutorStudentChatMessage; deduped?: boolean }> {
  return requestChatApi(`/conversations/${encodeURIComponent(conversationId)}/messages`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function markChatRead(
  conversationId: string,
): Promise<{ ok: boolean; read_at: string }> {
  return requestChatApi(`/conversations/${encodeURIComponent(conversationId)}/read`, {
    method: 'POST',
  });
}

// ─── Upload (bucket tutor-chat-uploads, path {conversationId}/{uid}/{fileId}) ──

const CHAT_UPLOAD_BUCKET = 'tutor-chat-uploads';
export const MAX_CHAT_ATTACHMENTS = 5;
export const MAX_CHAT_IMAGE_BYTES = 10 * 1024 * 1024;

/** Загружает фото беседы, возвращает storage:// ref (contract POST /messages). */
export async function uploadChatImage(file: File, conversationId: string): Promise<string> {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;
  if (!userId) throw new ChatApiError('Нет активной сессии', 'NO_SESSION');

  const uploadFile = await compressForUpload(file, { maxLongSide: 1600 });
  if (uploadFile.size > MAX_CHAT_IMAGE_BYTES) {
    throw new ChatApiError('Фото больше 10 МБ — выберите файл поменьше.', 'FILE_TOO_LARGE');
  }

  const ext = (uploadFile.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  // НЕ crypto.randomUUID — Safari < 15.4 (rule 80).
  const fileId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const path = `${conversationId}/${userId}/${fileId}.${ext}`;

  const { error } = await supabase.storage.from(CHAT_UPLOAD_BUCKET).upload(path, uploadFile, {
    contentType: uploadFile.type || 'image/jpeg',
    upsert: false,
  });
  if (error) {
    throw new ChatApiError('Не удалось загрузить фото. Попробуйте ещё раз.', 'UPLOAD_FAILED');
  }
  return `storage://${CHAT_UPLOAD_BUCKET}/${path}`;
}

/** Удаление залитых фото при сбое отправки (не плодим сирот в storage). */
export async function deleteChatUploads(refs: string[]): Promise<void> {
  const paths = refs
    .map((ref) => ref.replace(`storage://${CHAT_UPLOAD_BUCKET}/`, ''))
    .filter((path, i) => path !== refs[i]); // только наш bucket
  if (paths.length === 0) return;
  try {
    await supabase.storage.from(CHAT_UPLOAD_BUCKET).remove(paths);
  } catch {
    // best-effort: сирота дочистится TTL-cleanup'ом (follow-up)
  }
}

// Signed-URL кэш: refs контент-адресуемы, TTL 55 мин (сам URL живёт 60).
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();
const SIGNED_URL_TTL_MS = 55 * 60 * 1000;

/** storage:// ref → https signed URL (клиентский supabase → RU-safe api.sokratai.ru). */
export async function resolveChatAttachmentUrl(ref: string): Promise<string | null> {
  const cached = signedUrlCache.get(ref);
  if (cached && cached.expiresAt > Date.now()) return cached.url;

  const path = ref.replace(`storage://${CHAT_UPLOAD_BUCKET}/`, '');
  if (path === ref) return null; // не наш bucket
  const { data, error } = await supabase.storage
    .from(CHAT_UPLOAD_BUCKET)
    .createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) return null;
  signedUrlCache.set(ref, { url: data.signedUrl, expiresAt: Date.now() + SIGNED_URL_TTL_MS });
  return data.signedUrl;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** UUID v4 с fallback — `crypto.randomUUID` есть только с Safari 15.4 (rule 80). */
export function generateClientMsgId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  let uuid = '';
  const hex = '0123456789abcdef';
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) uuid += '-';
    else if (i === 14) uuid += '4';
    else if (i === 19) uuid += hex[(Math.random() * 4 + 8) | 0];
    else uuid += hex[(Math.random() * 16) | 0];
  }
  return uuid;
}

/**
 * Канонический merge realtime/optimistic сообщений в flat-кэш (mirror
 * `mergeThreadMessage` из tutorHomeworkApi): дедуп по id И по client_msg_id
 * (realtime INSERT может прийти раньше ответа POST — заменяет оптимистичный
 * пузырь), сортировка по created_at. НИКОГДА не invalidateQueries из realtime.
 */
export function mergeChatMessage(
  prev: TutorStudentChatMessage[],
  incoming: TutorStudentChatMessage,
): TutorStudentChatMessage[] {
  if (prev.some((m) => m.id === incoming.id)) return prev;
  let next: TutorStudentChatMessage[];
  const optimisticIdx = incoming.client_msg_id
    ? prev.findIndex((m) => m.client_msg_id === incoming.client_msg_id)
    : -1;
  if (optimisticIdx >= 0) {
    next = [...prev];
    next[optimisticIdx] = { ...incoming };
  } else {
    next = [...prev, incoming];
  }
  next.sort((a, b) => parseISO(a.created_at).getTime() - parseISO(b.created_at).getTime());
  return next;
}

/** Regex упоминания AI — БЕЗ lookbehind (Safari < 16.4, rule 80). Зеркало edge. */
export const AI_MENTION_RE = /@\s?(сократ\s?ai|sokrat\s?ai)/iu;
export const AI_MENTION_TOKEN = '@СократAI';
