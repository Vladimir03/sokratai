import { parseISO } from 'date-fns';
import { supabase } from '@/lib/supabaseClient';
import type {
  StudentHomeworkAssignment,
  StudentHomeworkAssignmentDetails,
  HomeworkThread,
  GuidedMessageKind,
  CheckAnswerResponse,
  RequestHintResponse,
} from '@/types/homework';
import {
  MAX_GUIDED_CHAT_ATTACHMENT_FILE_BYTES,
  serializeThreadAttachmentRefs,
} from '@/lib/homeworkThreadAttachments';
import { extractApiErrorMessage } from '@/lib/apiErrorMessage';

const HOMEWORK_IMAGES_BUCKET = 'homework-images';
const HOMEWORK_SUBMISSIONS_BUCKET = 'homework-submissions';
const HOMEWORK_TASK_IMAGES_BUCKET = 'homework-task-images';
const STORAGE_REF_PREFIX = 'storage://';
// HARDCODED — see src/lib/supabaseClient.ts for rationale (RU bypass, ignore Lovable auto-env).
const SUPABASE_URL = 'https://api.sokratai.ru';
const SUPABASE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZyc3Nlb3RyZm1zeHBiY2l5cXpjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk0MjEzMDYsImV4cCI6MjA3NDk5NzMwNn0.fDleU99ULnIvtbiJqlKtgaabZzIWqqw6gZLWQOFAcKw';

export class StudentHomeworkApiError extends Error {
  /**
   * Stable error code for branch-able callers. Currently used for
   * `SESSION_EXPIRED` (set by `requestStudentHomeworkApi` when a 401 cannot
   * be recovered via session refresh — caller should show a session-expired
   * message and rely on `AuthGuard.onAuthStateChange` to redirect to /login).
   * Free-form for future codes; backward-compat: undefined when not set.
   */
  code?: string;
  constructor(message: string, opts?: { code?: string }) {
    super(message);
    this.code = opts?.code;
    this.name = 'StudentHomeworkApiError';
  }
}

function ensureUserId(userId: string | undefined): string {
  if (!userId) {
    throw new StudentHomeworkApiError('Пользователь не авторизован');
  }
  return userId;
}

async function getCurrentUserId(): Promise<string> {
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();
  if (sessionError) {
    throw new StudentHomeworkApiError(sessionError.message);
  }
  if (session?.user?.id) {
    return session.user.id;
  }

  const { data, error } = await supabase.auth.getUser();
  if (error) {
    throw new StudentHomeworkApiError(error.message);
  }
  return ensureUserId(data.user?.id);
}

function translateSupabaseError(message: string): string {
  const lower = message.toLowerCase();
  if (message.includes('DEADLINE_PASSED')) return 'Дедлайн уже прошёл. Сдача недоступна.';
  if (lower.includes('row-level security')) {
    return 'Недостаточно прав для выполнения операции.';
  }
  if (lower.includes('permission denied')) {
    return 'Доступ запрещён для этой операции.';
  }
  return message;
}

export async function requestStudentHomeworkApi<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  // Helper: build + fire the actual fetch using the current cached session
  // token. Used twice — first attempt, then retry after a refresh.
  const doFetch = async (): Promise<Response> => {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) {
      throw new StudentHomeworkApiError('Нет активной сессии', {
        code: 'NO_SESSION',
      });
    }
    return fetch(`${SUPABASE_URL}/functions/v1/homework-api${path}`, {
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

  // 401 → cached access_token expired between the local getSession() read
  // and the server-side GoTrue validation (autoRefreshToken can fall behind
  // after device sleep, network blips during background refresh, etc.).
  // Try a one-shot refreshSession() + retry before surfacing the error.
  // Bug 2026-05-12: previously this case bubbled up as "Invalid or expired
  // token" and the user was stuck on the error screen until manual reload.
  if (response.status === 401) {
    const { data: refreshData, error: refreshError } =
      await supabase.auth.refreshSession();
    if (refreshError || !refreshData?.session) {
      // Persistent 401 — refresh_token also dead or revoked. Sign out so
      // AuthGuard's `onAuthStateChange` listener redirects to /login. Throw
      // with stable code so the UI can show a session-expired hint instead
      // of the cryptic upstream message.
      await supabase.auth.signOut().catch(() => undefined);
      throw new StudentHomeworkApiError(
        'Сессия истекла. Перенаправляем на вход…',
        { code: 'SESSION_EXPIRED' },
      );
    }
    response = await doFetch();
  }

  if (!response.ok) {
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // ignore parse errors
    }
    throw new StudentHomeworkApiError(
      extractApiErrorMessage(body, `HTTP ${response.status}`),
    );
  }

  return response.json() as Promise<T>;
}

export interface TranscribeThreadVoiceResult {
  text: string;
}

export async function transcribeThreadVoice(
  threadId: string,
  audioBlob: Blob,
  fileName = 'voice.webm',
  timeoutMs = 45_000,
): Promise<TranscribeThreadVoiceResult> {
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError) {
    throw new StudentHomeworkApiError(sessionError.message);
  }

  const token = session?.access_token;
  if (!token) {
    throw new StudentHomeworkApiError('Нет активной сессии');
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const formData = new FormData();
    formData.append('file', audioBlob, fileName);

    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/homework-api/threads/${encodeURIComponent(threadId)}/transcribe-voice`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: SUPABASE_KEY,
        },
        body: formData,
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        // ignore malformed error body
      }
      throw new StudentHomeworkApiError(
        extractApiErrorMessage(body, `HTTP ${response.status}`),
      );
    }

    const data = await response.json();
    const text = typeof data?.text === 'string' ? data.text.trim() : '';
    if (!text) {
      throw new StudentHomeworkApiError('Не удалось распознать речь');
    }

    return { text };
  } catch (error) {
    if (error instanceof StudentHomeworkApiError) {
      throw error;
    }

    if (error instanceof Error && error.name === 'AbortError') {
      throw new StudentHomeworkApiError('Расшифровка заняла слишком много времени. Попробуй ещё раз.');
    }

    throw new StudentHomeworkApiError('Не удалось отправить голосовое сообщение на расшифровку.');
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function toStorageRef(bucket: string, objectPath: string): string {
  return `${STORAGE_REF_PREFIX}${bucket}/${objectPath}`;
}

function generateStorageObjectId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function sanitizeObjectPath(path: string): string {
  return path.replace(/^\/+/, '').trim();
}

function parseStorageRef(
  value: string | null | undefined,
  defaultBucket = HOMEWORK_TASK_IMAGES_BUCKET,
): { bucket: string; objectPath: string } | null {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith(STORAGE_REF_PREFIX)) {
    const raw = trimmed.slice(STORAGE_REF_PREFIX.length);
    const slashIdx = raw.indexOf('/');
    if (slashIdx <= 0 || slashIdx === raw.length - 1) {
      return null;
    }
    const bucket = raw.slice(0, slashIdx);
    const objectPath = sanitizeObjectPath(raw.slice(slashIdx + 1));
    if (!bucket || !objectPath) return null;
    return { bucket, objectPath };
  }

  const objectPath = sanitizeObjectPath(trimmed);
  if (!objectPath) return null;
  return { bucket: defaultBucket, objectPath };
}

export async function listStudentAssignments(): Promise<StudentHomeworkAssignment[]> {
  const studentId = await getCurrentUserId();

  const { data, error } = await supabase
    .from('homework_tutor_student_assignments')
    .select(`
      id,
      assignment_id,
      homework_tutor_assignments!inner(
        id,
        title,
        subject,
        topic,
        description,
        deadline,
        status,
        created_at
      )
    `)
    .eq('student_id', studentId);

  if (error) {
    throw new StudentHomeworkApiError(error.message);
  }

  type AssignmentJoinRow = {
    id: string;
    assignment_id: string;
    homework_tutor_assignments: {
      id: string;
      title: string;
      subject: string;
      topic: string | null;
      description: string | null;
      deadline: string | null;
      status: string;
      created_at: string;
    };
  };
  const assignmentRows = ((data ?? []) as AssignmentJoinRow[]).filter((row) => {
    const status = row?.homework_tutor_assignments?.status;
    return status === 'active' || status === 'closed';
  });

  const studentAssignmentIds = assignmentRows.map((row) => row.id);

  const threadMap = new Map<string, { status: string }>();
  if (studentAssignmentIds.length > 0) {
    const { data: threadRows } = await supabase
      .from('homework_tutor_threads')
      .select('student_assignment_id, status')
      .in('student_assignment_id', studentAssignmentIds);

    for (const t of threadRows ?? []) {
      threadMap.set(t.student_assignment_id as string, { status: t.status as string });
    }
  }

  return assignmentRows
    .map((row) => {
      const assignment = row.homework_tutor_assignments;
      const thread = threadMap.get(row.id);
      const latest_submission_status = thread
        ? (thread.status === 'completed' ? 'ai_checked' : 'in_progress')
        : null;

      return {
        id: assignment.id,
        title: assignment.title,
        subject: assignment.subject,
        topic: assignment.topic,
        description: assignment.description,
        deadline: assignment.deadline,
        status: assignment.status as StudentHomeworkAssignment['status'],
        latest_submission_status,
        created_at: assignment.created_at,
      } satisfies StudentHomeworkAssignment;
    })
    .sort((a, b) => {
      // Newest assignments first (by creation date descending)
      return parseISO(b.created_at).getTime() - parseISO(a.created_at).getTime();
    });
}

export async function getStudentAssignment(assignmentId: string): Promise<StudentHomeworkAssignmentDetails> {
  const studentId = await getCurrentUserId();

  const { data: assigned, error: assignedError } = await supabase
    .from('homework_tutor_student_assignments')
    .select('assignment_id')
    .eq('assignment_id', assignmentId)
    .eq('student_id', studentId)
    .maybeSingle();

  if (assignedError) throw new StudentHomeworkApiError(assignedError.message);
  if (!assigned) throw new StudentHomeworkApiError('Задание не найдено');

  const { data: assignment, error: assignmentError } = await supabase
    .from('homework_tutor_assignments')
    .select('id, title, subject, exam_type, topic, description, deadline, status, disable_ai_bootstrap, created_at, tutor_id')
    .eq('id', assignmentId)
    .single();

  if (assignmentError || !assignment) {
    throw new StudentHomeworkApiError(assignmentError?.message ?? 'Задание не найдено');
  }

  const [{ data: tasks, error: tasksError }, { data: materials, error: materialsError }] =
    await Promise.all([
      supabase
        .from('homework_tutor_tasks')
        // task_kind added 2026-05-09 (Phase 1 student problem screen).
        // Legacy /homework/:id route still uses this fetch + the desktop
        // GuidedHomeworkWorkspace; without task_kind in the SELECT, any
        // future task_kind-aware UI on that path silently sees `undefined`
        // and defaults to `extended`. Anti-leak: solution_*/rubric_*
        // deliberately excluded — student-facing endpoint.
        .select(
          'id, assignment_id, order_num, task_text, task_image_url, max_score, check_format, task_kind',
        )
        .eq('assignment_id', assignmentId)
        .order('order_num', { ascending: true }),
      supabase
        .from('homework_tutor_materials')
        .select('id, assignment_id, type, title, storage_ref, url, created_at')
        .eq('assignment_id', assignmentId)
        .order('created_at', { ascending: true }),
    ]);

  if (tasksError) throw new StudentHomeworkApiError(tasksError.message);
  if (materialsError) throw new StudentHomeworkApiError(materialsError.message);

  // Resolve student display name for AI system prompts.
  // Priority: tutor_students.display_name → profiles.username (non-auto-generated) → null.
  // Both queries are best-effort: RLS may deny tutor_students read; we catch gracefully.
  let studentDisplayName: string | null = null;
  try {
    const assignmentRecord = assignment as Record<string, unknown>;
    const tutorId =
      typeof assignmentRecord.tutor_id === 'string' ? assignmentRecord.tutor_id : undefined;
    const [tsResult, profResult] = await Promise.all([
      tutorId
        ? supabase
          .from('tutor_students')
          .select('display_name')
          .eq('tutor_id', tutorId)
          .eq('student_id', studentId)
          .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from('profiles').select('username').eq('id', studentId).maybeSingle(),
    ]);
    const tsData = tsResult.data as { display_name?: string | null } | null;
    const profData = profResult.data as { username?: string | null } | null;
    const curated = tsData?.display_name?.trim() ?? '';
    const username = profData?.username?.trim() ?? '';
    if (curated) {
      studentDisplayName = curated;
    } else if (username && !/^(telegram_|user_)\d+$/i.test(username)) {
      studentDisplayName = username;
    }
  } catch {
    // Non-critical — AI will use neutral forms if name is unavailable
  }

  const assignmentRecord = assignment as Record<string, unknown>;
  const result = {
    ...assignmentRecord,
    updated_at: assignmentRecord.created_at,
    tasks: (tasks ?? []) as StudentHomeworkAssignmentDetails['tasks'],
    materials: (materials ?? []) as StudentHomeworkAssignmentDetails['materials'],
    studentDisplayName,
  } as unknown as StudentHomeworkAssignmentDetails;
  return result;
}

export async function getStudentTaskImageSignedUrl(taskImageRef: string): Promise<string | null> {
  const parsed = parseStorageRef(taskImageRef, HOMEWORK_TASK_IMAGES_BUCKET);
  if (!parsed) return null;

  const { data, error } = await supabase.storage
    .from(parsed.bucket)
    .createSignedUrl(parsed.objectPath, 3600);

  if (error || !data?.signedUrl) {
    return null;
  }

  return data.signedUrl;
}

export async function getStudentTaskImageSignedUrlViaBackend(
  assignmentId: string,
  taskId: string,
): Promise<string | null> {
  try {
    const result = await requestStudentHomeworkApi<{ url: string }>(
      `/assignments/${encodeURIComponent(assignmentId)}/tasks/${encodeURIComponent(taskId)}/image-url`,
    );
    return result.url ?? null;
  } catch {
    return null;
  }
}

export async function getStudentTaskImagesSignedUrlsViaBackend(
  assignmentId: string,
  taskId: string,
): Promise<string[]> {
  // Mirror refresh+retry pattern из `requestStudentHomeworkApi` (Phase 3.1
  // Bug #3 fix). Раньше эта функция имела свой inline fetch без refresh —
  // при истечении токена в фоне (изображения load'ятся через signed URL
  // эндпоинт после auth fix endpoint'а), картинки не загружались до тех
  // пор пока юзер не сделает hard refresh. Phase 3.1 Bug #3 image-tail
  // hotfix 2026-05-13.
  const doFetch = async (): Promise<Response> => {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) {
      throw new StudentHomeworkApiError('Нет активной сессии', {
        code: 'NO_SESSION',
      });
    }
    return fetch(
      `${SUPABASE_URL}/functions/v1/homework-api/assignments/${encodeURIComponent(assignmentId)}/tasks/${encodeURIComponent(taskId)}/images`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          apikey: SUPABASE_KEY,
        },
      },
    );
  };

  let response = await doFetch();

  if (response.status === 401) {
    const { data: refreshData, error: refreshError } =
      await supabase.auth.refreshSession();
    if (refreshError || !refreshData?.session) {
      await supabase.auth.signOut().catch(() => undefined);
      throw new StudentHomeworkApiError(
        'Сессия истекла. Перенаправляем на вход…',
        { code: 'SESSION_EXPIRED' },
      );
    }
    response = await doFetch();
  }

  if (response.status === 404) {
    return [];
  }

  if (!response.ok) {
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // ignore parse errors
    }
    throw new StudentHomeworkApiError(
      extractApiErrorMessage(body, `HTTP ${response.status}`),
    );
  }

  const result = await response.json() as { signed_urls?: unknown };
  return Array.isArray(result?.signed_urls)
    ? result.signed_urls.filter((url): url is string => typeof url === 'string' && url.trim().length > 0)
    : [];
}

export async function getStudentHomeworkThread(
  threadId: string,
): Promise<HomeworkThread> {
  return requestStudentHomeworkApi<HomeworkThread>(
    `/threads/${encodeURIComponent(threadId)}`,
  );
}

/**
 * Find the thread for a given assignment by looking up the student_assignment
 * and querying homework_tutor_threads directly via RLS.
 */
export async function getStudentThreadByAssignment(
  assignmentId: string,
): Promise<HomeworkThread | null> {
  // Routes through the edge function so the response includes tutor_profile
  // (display_name + avatar_url + gender) computed server-side via JOIN on
  // assignment.tutor_id → tutors. Direct PostgREST SELECT cannot compute
  // this — see ChatGPT-5.5 review BLOCKER 1 and the rationale comment in
  // homework-api/index.ts::fetchStudentThread.
  //
  // Endpoint also lazy-provisions the thread if it doesn't exist yet
  // (matches handleCheckAnswer / handleRequestHint behavior).
  return await requestStudentHomeworkApi<HomeworkThread | null>(
    `/assignments/${encodeURIComponent(assignmentId)}/thread`,
    { method: 'GET' },
  );
}

/**
 * Upload a file from guided chat to Supabase Storage.
 * Returns a storage:// ref suitable for persisting in thread messages.
 */
export async function uploadStudentThreadImage(
  file: File,
  assignmentId: string,
  _threadId: string,
  taskOrder: number,
): Promise<string> {
  if (file.size > MAX_GUIDED_CHAT_ATTACHMENT_FILE_BYTES) {
    throw new StudentHomeworkApiError('Файл слишком большой. Максимум 5 МБ');
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) {
    throw new StudentHomeworkApiError(sessionError.message);
  }

  const studentId = ensureUserId(sessionData.session?.user?.id);
  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
  const fileId = generateStorageObjectId();
  const objectPath = `${studentId}/${assignmentId}/threads/${taskOrder}/${fileId}.${ext}`;
  const contentType = file.type || 'application/octet-stream';

  const { error: primaryError } = await supabase.storage
    .from(HOMEWORK_SUBMISSIONS_BUCKET)
    .upload(objectPath, file, { upsert: false, contentType });

  if (!primaryError) {
    return toStorageRef(HOMEWORK_SUBMISSIONS_BUCKET, objectPath);
  }

  const isBucketMissing =
    primaryError.message?.toLowerCase().includes('bucket not found') ||
    (primaryError as unknown as { statusCode?: number }).statusCode === 404;

  if (!isBucketMissing) {
    throw new StudentHomeworkApiError(
      `Ошибка загрузки файла: ${translateSupabaseError(primaryError.message)}`,
    );
  }

  const fallbackPath = `${studentId}/${assignmentId}/threads/${taskOrder}/${fileId}.${ext}`;
  const { error: fallbackError } = await supabase.storage
    .from(HOMEWORK_IMAGES_BUCKET)
    .upload(fallbackPath, file, { upsert: false, contentType });

  if (fallbackError) {
    throw new StudentHomeworkApiError(
      `Ошибка загрузки файла: ${translateSupabaseError(fallbackError.message)}`,
    );
  }

  return toStorageRef(HOMEWORK_IMAGES_BUCKET, fallbackPath);
}

/**
 * Save a message to a thread via the homework-api edge function.
 */
export async function saveThreadMessage(
  threadId: string,
  role: 'user' | 'assistant',
  content: string,
  taskOrder?: number,
  messageKind?: GuidedMessageKind,
  taskId?: string,
  attachmentRefs?: string[],
): Promise<{ id: string }> {
  const normalizedAttachmentRefs = (attachmentRefs ?? []).map((ref) => ref.trim()).filter(Boolean);
  const serializedAttachments = serializeThreadAttachmentRefs(normalizedAttachmentRefs);
  return requestStudentHomeworkApi<{ id: string }>(
    `/threads/${encodeURIComponent(threadId)}/messages`,
    {
      method: 'POST',
      body: JSON.stringify({
        content,
        role,
        task_order: taskOrder,
        task_id: taskId,
        message_kind: messageKind,
        image_url: serializedAttachments,
        image_urls: normalizedAttachmentRefs.length > 0 ? normalizedAttachmentRefs : undefined,
      }),
    },
  );
}

/**
 * Advance to the next task in a guided homework thread.
 */
export async function advanceTask(
  threadId: string,
  score?: number,
): Promise<HomeworkThread> {
  return requestStudentHomeworkApi<HomeworkThread>(
    `/threads/${encodeURIComponent(threadId)}/advance`,
    {
      method: 'POST',
      body: JSON.stringify(score !== undefined ? { score } : {}),
    },
  );
}

/**
 * Phase 3: Submit answer for AI evaluation.
 * Server checks correctness, updates scores, auto-advances on correct.
 */
export async function checkAnswer(
  threadId: string,
  answer: string,
  taskOrder?: number,
  taskId?: string,
  attachmentRefs?: string[],
): Promise<CheckAnswerResponse> {
  const normalizedAttachmentRefs = (attachmentRefs ?? []).map((ref) => ref.trim()).filter(Boolean);
  const serializedAttachments = serializeThreadAttachmentRefs(normalizedAttachmentRefs);
  return requestStudentHomeworkApi<CheckAnswerResponse>(
    `/threads/${encodeURIComponent(threadId)}/check`,
    {
      method: 'POST',
      body: JSON.stringify({
        answer,
        ...(taskOrder != null && { task_order: taskOrder }),
        ...(taskId != null && { task_id: taskId }),
        ...(serializedAttachments && { image_url: serializedAttachments }),
        ...(normalizedAttachmentRefs.length > 0 && { image_urls: normalizedAttachmentRefs }),
      }),
    },
  );
}

/**
 * Phase 3: Request a hint for the current task.
 * Server generates hint, degrades available_score.
 */
export async function requestHint(
  threadId: string,
  taskOrder?: number,
  taskId?: string,
): Promise<RequestHintResponse> {
  return requestStudentHomeworkApi<RequestHintResponse>(
    `/threads/${encodeURIComponent(threadId)}/hint`,
    {
      method: 'POST',
      body: JSON.stringify({
        ...(taskOrder != null ? { task_order: taskOrder } : {}),
        ...(taskId != null ? { task_id: taskId } : {}),
      }),
    },
  );
}
