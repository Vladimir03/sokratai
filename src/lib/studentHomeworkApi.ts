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
import { serializeThreadAttachmentRefs } from '@/lib/homeworkThreadAttachments';

const HOMEWORK_IMAGES_BUCKET = 'homework-images';
const HOMEWORK_SUBMISSIONS_BUCKET = 'homework-submissions';
const HOMEWORK_TASK_IMAGES_BUCKET = 'homework-task-images';
const STORAGE_REF_PREFIX = 'storage://';
const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || 'https://vrsseotrfmsxpbciyqzc.supabase.co';
const SUPABASE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZyc3Nlb3RyZm1zeHBiY2l5cXpjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk0MjEzMDYsImV4cCI6MjA3NDk5NzMwNn0.fDleU99ULnIvtbiJqlKtgaabZzIWqqw6gZLWQOFAcKw';

export class StudentHomeworkApiError extends Error {
  constructor(message: string) {
    super(message);
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

function isMissingThreadMessageKindColumnError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('message_kind') && (
    lower.includes('schema cache') ||
    (lower.includes('column') && lower.includes('does not exist'))
  );
}

async function requestStudentHomeworkApi<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;

  if (!token) {
    throw new StudentHomeworkApiError('Нет активной сессии');
  }

  const response = await fetch(`${SUPABASE_URL}/functions/v1/homework-api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_KEY,
      ...(options.headers ?? {}),
    },
  });

  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const body = await response.json();
      const errorMessage = body?.error?.message;
      if (typeof errorMessage === 'string' && errorMessage.trim().length > 0) {
        message = errorMessage;
      }
    } catch {
      // ignore parse errors
    }
    throw new StudentHomeworkApiError(message);
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
      let message = `HTTP ${response.status}`;
      try {
        const body = await response.json();
        const errorMessage = body?.error?.message;
        if (typeof errorMessage === 'string' && errorMessage.trim().length > 0) {
          message = errorMessage;
        }
      } catch {
        // ignore malformed error body
      }

      throw new StudentHomeworkApiError(message);
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

  const assignmentRows = (data ?? []).filter((row: any) => {
    const status = row?.homework_tutor_assignments?.status;
    return status === 'active' || status === 'closed';
  });

  const studentAssignmentIds = assignmentRows.map((row: any) => row.id as string);

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
    .map((row: any) => {
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
        status: assignment.status,
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
    .select('id, title, subject, exam_type, topic, description, deadline, status, disable_ai_bootstrap, created_at')
    .eq('id', assignmentId)
    .single();

  if (assignmentError || !assignment) {
    throw new StudentHomeworkApiError(assignmentError?.message ?? 'Задание не найдено');
  }

  const { data: tasks, error: tasksError } = await supabase
    .from('homework_tutor_tasks')
    .select('id, assignment_id, order_num, task_text, task_image_url, max_score, check_format')
    .eq('assignment_id', assignmentId)
    .order('order_num', { ascending: true });

  if (tasksError) throw new StudentHomeworkApiError(tasksError.message);

  const { data: materials, error: materialsError } = await supabase
    .from('homework_tutor_materials')
    .select('id, assignment_id, type, title, storage_ref, url, created_at')
    .eq('assignment_id', assignmentId)
    .order('created_at', { ascending: true });

  if (materialsError) throw new StudentHomeworkApiError(materialsError.message);

  const result = {
    ...(assignment as any),
    updated_at: (assignment as any).created_at,
    tasks: (tasks ?? []) as StudentHomeworkAssignmentDetails['tasks'],
    materials: (materials ?? []) as StudentHomeworkAssignmentDetails['materials'],
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
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new StudentHomeworkApiError('Пользователь не авторизован');
  const studentId = session.user.id;

  // Find student_assignment_id
  const { data: sa, error: saErr } = await supabase
    .from('homework_tutor_student_assignments')
    .select('id')
    .eq('assignment_id', assignmentId)
    .eq('student_id', studentId)
    .maybeSingle();

  if (saErr) throw new StudentHomeworkApiError(saErr.message);
  if (!sa) return null;

  const selectWithKind = `
      id, status, current_task_order, created_at, updated_at,
      student_assignment_id,
      homework_tutor_thread_messages(id, role, content, image_url, task_order, message_kind, created_at),
      homework_tutor_task_states(id, task_id, status, attempts, best_score, available_score, earned_score, wrong_answer_count, hint_count)
    `;
  const selectLegacy = `
      id, status, current_task_order, created_at, updated_at,
      student_assignment_id,
      homework_tutor_thread_messages(id, role, content, image_url, task_order, created_at),
      homework_tutor_task_states(id, task_id, status, attempts, best_score)
    `;

  // Query thread with nested messages and task_states (RLS allows SELECT for own threads)
  const withKindResult = await (supabase
    .from('homework_tutor_threads' as any)
    .select(selectWithKind)
    .eq('student_assignment_id', sa.id)
    .order('created_at', { referencedTable: 'homework_tutor_thread_messages', ascending: true })
    .maybeSingle() as any);

  if (withKindResult.error && isMissingThreadMessageKindColumnError(withKindResult.error.message)) {
    const legacyResult = await (supabase
      .from('homework_tutor_threads' as any)
      .select(selectLegacy)
      .eq('student_assignment_id', sa.id)
      .order('created_at', { referencedTable: 'homework_tutor_thread_messages', ascending: true })
      .maybeSingle() as any);
    if (legacyResult.error) throw new StudentHomeworkApiError(legacyResult.error.message);
    return legacyResult.data as unknown as HomeworkThread | null;
  }

  if (withKindResult.error) throw new StudentHomeworkApiError(withKindResult.error.message);
  return withKindResult.data as unknown as HomeworkThread | null;
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
): Promise<RequestHintResponse> {
  return requestStudentHomeworkApi<RequestHintResponse>(
    `/threads/${encodeURIComponent(threadId)}/hint`,
    {
      method: 'POST',
      body: JSON.stringify(taskOrder != null ? { task_order: taskOrder } : {}),
    },
  );
}
