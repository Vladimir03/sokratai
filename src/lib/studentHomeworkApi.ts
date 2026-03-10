import { parseISO } from 'date-fns';
import { supabase } from '@/lib/supabaseClient';
import type {
  StudentHomeworkAssignment,
  StudentHomeworkAssignmentDetails,
  StudentHomeworkSubmission,
  HomeworkThread,
  GuidedMessageKind,
  CheckAnswerResponse,
  RequestHintResponse,
} from '@/types/homework';

const HOMEWORK_IMAGES_BUCKET = 'homework-images';
const HOMEWORK_SUBMISSIONS_BUCKET = 'homework-submissions';
const HOMEWORK_TASK_IMAGES_BUCKET = 'homework-task-images';
const STORAGE_REF_PREFIX = 'storage://';
const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || 'https://vrsseotrfmsxpbciyqzc.supabase.co';
const SUPABASE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZyc3Nlb3RyZm1zeHBiY2l5cXpjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk0MjEzMDYsImV4cCI6MjA3NDk5NzMwNn0.fDleU99ULnIvtbiJqlKtgaabZzIWqqw6gZLWQOFAcKw';

const SUBMISSION_SELECT = `
  id,
  assignment_id,
  student_id,
  status,
  total_score,
  total_max_score,
  submitted_at,
  homework_tutor_submission_items(
    id,
    task_id,
    student_text,
    student_image_urls,
    ai_feedback,
    ai_score,
    ai_is_correct,
    tutor_comment,
    tutor_override_correct
  )
`;

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
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    throw new StudentHomeworkApiError(error.message);
  }
  return ensureUserId(data.user?.id);
}

function isDeadlinePassed(deadline: string | null | undefined): boolean {
  if (!deadline) return false;
  return parseISO(deadline).getTime() <= Date.now();
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

function isMissingAnswerTypeColumnError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('answer_type') && (
    lower.includes('schema cache') ||
    (lower.includes('column') && lower.includes('does not exist'))
  );
}

function isMissingThreadMessageKindColumnError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('message_kind') && (
    lower.includes('schema cache') ||
    (lower.includes('column') && lower.includes('does not exist'))
  );
}

function isTelegramChatIdNotNullError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('telegram_chat_id') &&
    lower.includes('null value') &&
    (lower.includes('not-null') || lower.includes('not null'));
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

function toStorageRef(bucket: string, objectPath: string): string {
  return `${STORAGE_REF_PREFIX}${bucket}/${objectPath}`;
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
        workflow_mode,
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

  const assignmentIds = assignmentRows.map((row: any) => row.assignment_id as string);

  // For classic: fetch latest submission status per assignment
  const { data: submissionRows, error: submissionError } = await supabase
    .from('homework_tutor_submissions')
    .select('assignment_id, status, created_at')
    .eq('student_id', studentId)
    .in('assignment_id', assignmentIds.length > 0 ? assignmentIds : ['00000000-0000-0000-0000-000000000000'])
    .order('created_at', { ascending: false });

  if (submissionError) {
    throw new StudentHomeworkApiError(submissionError.message);
  }

  const latestSubmissionMap = new Map<string, string | null>();
  for (const row of submissionRows ?? []) {
    const assignmentId = row.assignment_id as string;
    if (!latestSubmissionMap.has(assignmentId)) {
      latestSubmissionMap.set(assignmentId, typeof row.status === 'string' ? row.status : null);
    }
  }

  // For guided_chat assignments, check thread status instead of submissions
  const guidedAssignmentStudentIds = assignmentRows
    .filter((row: any) => row.homework_tutor_assignments?.workflow_mode === 'guided_chat')
    .map((row: any) => row.id as string);

  const threadMap = new Map<string, { status: string }>();
  if (guidedAssignmentStudentIds.length > 0) {
    const { data: threadRows } = await supabase
      .from('homework_tutor_threads')
      .select('student_assignment_id, status')
      .in('student_assignment_id', guidedAssignmentStudentIds);

    for (const t of threadRows ?? []) {
      threadMap.set(t.student_assignment_id as string, { status: t.status as string });
    }
  }

  return assignmentRows
    .map((row: any) => {
      const assignment = row.homework_tutor_assignments;
      const isGuided = assignment.workflow_mode === 'guided_chat';

      let latest_submission_status: string | null;

      if (isGuided) {
        const thread = threadMap.get(row.id);
        latest_submission_status = thread
          ? (thread.status === 'completed' ? 'ai_checked' : 'in_progress')
          : null;
      } else {
        latest_submission_status = latestSubmissionMap.get(assignment.id) ?? null;
      }

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

export async function getStudentSubmissions(assignmentId: string): Promise<StudentHomeworkSubmission[]> {
  const studentId = await getCurrentUserId();
  const { data, error } = await supabase
    .from('homework_tutor_submissions')
    .select(SUBMISSION_SELECT)
    .eq('assignment_id', assignmentId)
    .eq('student_id', studentId)
    .order('created_at', { ascending: false });

  if (error) {
    throw new StudentHomeworkApiError(error.message);
  }

  return (data ?? []) as unknown as StudentHomeworkSubmission[];
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
    .select('id, title, subject, topic, description, deadline, status, workflow_mode, created_at')
    .eq('id', assignmentId)
    .single();

  if (assignmentError || !assignment) {
    throw new StudentHomeworkApiError(assignmentError?.message ?? 'Задание не найдено');
  }

  const { data: tasks, error: tasksError } = await supabase
    .from('homework_tutor_tasks')
    .select('id, assignment_id, order_num, task_text, task_image_url, max_score')
    .eq('assignment_id', assignmentId)
    .order('order_num', { ascending: true });

  if (tasksError) throw new StudentHomeworkApiError(tasksError.message);

  const { data: materials, error: materialsError } = await supabase
    .from('homework_tutor_materials')
    .select('id, assignment_id, type, title, storage_ref, url, created_at')
    .eq('assignment_id', assignmentId)
    .order('created_at', { ascending: true });

  if (materialsError) throw new StudentHomeworkApiError(materialsError.message);

  const submissions = await getStudentSubmissions(assignmentId);

  const result = {
    ...(assignment as any),
    workflow_mode: (assignment as any).workflow_mode ?? 'classic',
    updated_at: (assignment as any).created_at,
    tasks: (tasks ?? []) as StudentHomeworkAssignmentDetails['tasks'],
    materials: (materials ?? []) as StudentHomeworkAssignmentDetails['materials'],
    submissions,
  } as unknown as StudentHomeworkAssignmentDetails;
  return result;
}

export async function createStudentSubmission(assignmentId: string): Promise<StudentHomeworkSubmission> {
  const studentId = await getCurrentUserId();

  const { data: assignment, error: assignmentError } = await supabase
    .from('homework_tutor_assignments')
    .select('id, deadline')
    .eq('id', assignmentId)
    .single();

  if (assignmentError || !assignment) {
    throw new StudentHomeworkApiError('Задание не найдено');
  }

  if (isDeadlinePassed(assignment.deadline)) {
    throw new StudentHomeworkApiError('Дедлайн уже прошёл. Сдача недоступна.');
  }

  const createSubmission = async (telegramChatId: number | null) => supabase
    .from('homework_tutor_submissions')
    .insert({
      assignment_id: assignmentId,
      student_id: studentId,
      telegram_chat_id: telegramChatId,
      status: 'in_progress',
    })
    .select(SUBMISSION_SELECT)
    .single();

  const { data, error } = await createSubmission(null);
  if (!error && data) {
    return data as unknown as StudentHomeworkSubmission;
  }

  if (error && isTelegramChatIdNotNullError(error.message)) {
    // Legacy prod schema may still require telegram_chat_id. Use 0 as web sentinel.
    const { data: legacyData, error: legacyError } = await createSubmission(0);
    if (legacyError || !legacyData) {
      throw new StudentHomeworkApiError(
        translateSupabaseError(legacyError?.message ?? 'Не удалось создать работу'),
      );
    }
    return legacyData as unknown as StudentHomeworkSubmission;
  }

  throw new StudentHomeworkApiError(
    translateSupabaseError(error?.message ?? 'Не удалось создать работу'),
  );
}

export async function uploadStudentHomeworkFiles(
  studentId: string,
  assignmentId: string,
  submissionId: string,
  taskId: string,
  files: File[],
): Promise<string[]> {
  const uploadedPaths: string[] = [];

  for (const file of files) {
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    const ext = isPdf ? 'pdf' : (file.name.split('.').pop()?.toLowerCase() || 'jpg');
    const fileId = crypto.randomUUID();
    const primaryObjectPath = `${studentId}/${assignmentId}/${submissionId}/${taskId}/${fileId}.${ext}`;
    const contentType = file.type || (isPdf ? 'application/pdf' : 'application/octet-stream');

    const { error: primaryError } = await supabase.storage
      .from(HOMEWORK_SUBMISSIONS_BUCKET)
      .upload(primaryObjectPath, file, { upsert: false, contentType });

    if (!primaryError) {
      uploadedPaths.push(toStorageRef(HOMEWORK_SUBMISSIONS_BUCKET, primaryObjectPath));
      continue;
    }

    // Fallback to homework-images bucket if homework-submissions not yet created in this env
    const isBucketMissing =
      primaryError.message?.toLowerCase().includes('bucket not found') ||
      (primaryError as unknown as { statusCode?: number }).statusCode === 404;

    if (!isBucketMissing) {
      throw new StudentHomeworkApiError(
        `Ошибка загрузки файла: ${translateSupabaseError(primaryError.message)}`,
      );
    }

    // Legacy homework-images policies expect path prefix homework/{assignmentId}/...
    const fallbackObjectPath = `homework/${assignmentId}/${submissionId}/${taskId}/${fileId}.${ext}`;
    const { error: fallbackError } = await supabase.storage
      .from(HOMEWORK_IMAGES_BUCKET)
      .upload(fallbackObjectPath, file, { upsert: false, contentType });

    if (fallbackError) {
      throw new StudentHomeworkApiError(
        `Ошибка загрузки файла: ${translateSupabaseError(fallbackError.message)}`,
      );
    }
    uploadedPaths.push(fallbackObjectPath);
  }

  return uploadedPaths;
}

export async function submitStudentAnswer(
  submissionId: string,
  taskId: string,
  text?: string,
  files?: File[],
  answerType?: 'text' | 'image' | 'pdf',
): Promise<void> {
  let filePaths: string[] | null = null;

  if (files && files.length > 0) {
    const studentId = await getCurrentUserId();

    const { data: submission, error: submissionError } = await supabase
      .from('homework_tutor_submissions')
      .select('assignment_id')
      .eq('id', submissionId)
      .single();

    if (submissionError || !submission) {
      throw new StudentHomeworkApiError('Попытка не найдена');
    }

    filePaths = await uploadStudentHomeworkFiles(
      studentId,
      submission.assignment_id,
      submissionId,
      taskId,
      files,
    );
  }

  // Determine answer_type if not explicitly provided
  const resolvedAnswerType: 'text' | 'image' | 'pdf' | null = answerType ?? (
    files && files.length > 0
      ? (files.some(
          (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'),
        )
          ? 'pdf'
          : 'image')
      : (text?.trim() ? 'text' : null)
  );

  const basePayload = {
    submission_id: submissionId,
    task_id: taskId,
    student_text: text?.trim() || null,
    student_image_urls: filePaths,
  };

  const { error: withAnswerTypeError } = await supabase
    .from('homework_tutor_submission_items')
    .upsert(
      {
        ...basePayload,
        answer_type: resolvedAnswerType,
      },
      { onConflict: 'submission_id,task_id' },
    );

  if (withAnswerTypeError && isMissingAnswerTypeColumnError(withAnswerTypeError.message)) {
    const { error: legacyError } = await supabase
      .from('homework_tutor_submission_items')
      .upsert(basePayload, { onConflict: 'submission_id,task_id' });

    if (legacyError) {
      throw new StudentHomeworkApiError(translateSupabaseError(legacyError.message));
    }
    return;
  }

  if (withAnswerTypeError) {
    throw new StudentHomeworkApiError(translateSupabaseError(withAnswerTypeError.message));
  }
}

export async function finalizeSubmission(submissionId: string): Promise<void> {
  const { data: submission, error: submissionError } = await supabase
    .from('homework_tutor_submissions')
    .select('assignment_id')
    .eq('id', submissionId)
    .single();

  if (submissionError || !submission) {
    throw new StudentHomeworkApiError('Попытка не найдена');
  }

  const { data: assignment, error: assignmentError } = await supabase
    .from('homework_tutor_assignments')
    .select('deadline')
    .eq('id', submission.assignment_id)
    .single();

  if (assignmentError || !assignment) {
    throw new StudentHomeworkApiError('Задание не найдено');
  }

  if (isDeadlinePassed(assignment.deadline)) {
    throw new StudentHomeworkApiError('Дедлайн уже прошёл. Сдача недоступна.');
  }

  const { error } = await supabase
    .from('homework_tutor_submissions')
    .update({
      status: 'submitted',
      submitted_at: new Date().toISOString(),
    })
    .eq('id', submissionId);

  if (error) {
    throw new StudentHomeworkApiError(error.message);
  }
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

export interface StudentSubmissionAiCheckResponse {
  status: 'submitted' | 'ai_checked' | 'tutor_reviewed';
  total_score: number | null;
  total_max_score: number | null;
}

export async function runStudentSubmissionAiCheck(
  submissionId: string,
): Promise<StudentSubmissionAiCheckResponse> {
  return requestStudentHomeworkApi<StudentSubmissionAiCheckResponse>(
    `/student/submissions/${encodeURIComponent(submissionId)}/ai-check`,
    { method: 'POST', body: '{}' },
  );
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
 * Save a message to a thread via the homework-api edge function.
 */
export async function saveThreadMessage(
  threadId: string,
  role: 'user' | 'assistant',
  content: string,
  taskOrder?: number,
  messageKind?: GuidedMessageKind,
): Promise<{ id: string }> {
  return requestStudentHomeworkApi<{ id: string }>(
    `/threads/${encodeURIComponent(threadId)}/messages`,
    {
      method: 'POST',
      body: JSON.stringify({
        content,
        role,
        task_order: taskOrder,
        message_kind: messageKind,
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
): Promise<CheckAnswerResponse> {
  return requestStudentHomeworkApi<CheckAnswerResponse>(
    `/threads/${encodeURIComponent(threadId)}/check`,
    {
      method: 'POST',
      body: JSON.stringify({ answer }),
    },
  );
}

/**
 * Phase 3: Request a hint for the current task.
 * Server generates hint, degrades available_score.
 */
export async function requestHint(
  threadId: string,
): Promise<RequestHintResponse> {
  return requestStudentHomeworkApi<RequestHintResponse>(
    `/threads/${encodeURIComponent(threadId)}/hint`,
    {
      method: 'POST',
      body: '{}',
    },
  );
}
