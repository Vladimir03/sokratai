import { supabase } from '@/lib/supabaseClient';

// ─── Types ───────────────────────────────────────────────────────────────────

export type HomeworkSubject = 'math' | 'physics' | 'history' | 'social' | 'english' | 'cs';
export type HomeworkAssignmentStatus = 'draft' | 'active' | 'closed';
export type HomeworkAssignmentsFilter = 'all' | 'active' | 'closed';

export interface TutorHomeworkAssignmentListItem {
  id: string;
  title: string;
  subject: HomeworkSubject;
  topic: string | null;
  deadline: string | null;
  status: HomeworkAssignmentStatus;
  created_at: string;
  assigned_count: number;
  submitted_count: number;
  avg_score: number | null;
}

export interface CreateAssignmentTask {
  order_num?: number;
  task_text: string;
  task_image_url?: string | null;
  correct_answer?: string | null;
  solution_steps?: string | null;
  max_score?: number;
}

export interface CreateAssignmentPayload {
  title: string;
  subject: HomeworkSubject;
  topic?: string | null;
  description?: string | null;
  deadline?: string | null;
  tasks: CreateAssignmentTask[];
}

export interface CreateAssignmentResponse {
  assignment_id: string;
}

export interface AssignStudentsResponse {
  added: number;
}

export interface NotifyStudentsResponse {
  sent: number;
  failed: number;
}

// ─── API Error ───────────────────────────────────────────────────────────────

export class HomeworkApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'HomeworkApiError';
  }
}

// ─── Base request helper ─────────────────────────────────────────────────────

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || 'https://vrsseotrfmsxpbciyqzc.supabase.co';

const SUPABASE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZyc3Nlb3RyZm1zeHBiY2l5cXpjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk0MjEzMDYsImV4cCI6MjA3NDk5NzMwNn0.fDleU99ULnIvtbiJqlKtgaabZzIWqqw6gZLWQOFAcKw';

async function requestHomeworkApi<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) {
    throw new HomeworkApiError(401, 'UNAUTHORIZED', 'Нет активной сессии');
  }

  const url = `${SUPABASE_URL}/functions/v1/homework-api${path}`;

  const resp = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_KEY,
      ...(options.headers ?? {}),
    },
  });

  if (!resp.ok) {
    let errorBody: { error?: { code?: string; message?: string; details?: unknown } } = {};
    try {
      errorBody = await resp.json();
    } catch {
      // ignore parse error
    }
    const code = errorBody?.error?.code ?? 'UNKNOWN';
    const message = errorBody?.error?.message ?? `HTTP ${resp.status}`;
    const details = errorBody?.error?.details;
    throw new HomeworkApiError(resp.status, code, message, details);
  }

  return resp.json() as Promise<T>;
}

// ─── Public API functions ────────────────────────────────────────────────────

export async function listTutorHomeworkAssignments(
  filter: HomeworkAssignmentsFilter = 'all',
): Promise<TutorHomeworkAssignmentListItem[]> {
  return requestHomeworkApi<TutorHomeworkAssignmentListItem[]>(
    `/assignments?status=${encodeURIComponent(filter)}`,
  );
}

export async function createTutorHomeworkAssignment(
  payload: CreateAssignmentPayload,
): Promise<CreateAssignmentResponse> {
  return requestHomeworkApi<CreateAssignmentResponse>('/assignments', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function assignTutorHomeworkStudents(
  assignmentId: string,
  studentIds: string[],
): Promise<AssignStudentsResponse> {
  return requestHomeworkApi<AssignStudentsResponse>(
    `/assignments/${encodeURIComponent(assignmentId)}/assign`,
    {
      method: 'POST',
      body: JSON.stringify({ student_ids: studentIds }),
    },
  );
}

export async function notifyTutorHomeworkStudents(
  assignmentId: string,
  messageTemplate?: string,
): Promise<NotifyStudentsResponse> {
  return requestHomeworkApi<NotifyStudentsResponse>(
    `/assignments/${encodeURIComponent(assignmentId)}/notify`,
    {
      method: 'POST',
      body: JSON.stringify(
        messageTemplate ? { message_template: messageTemplate } : {},
      ),
    },
  );
}

// ─── Storage: task image upload/delete ───────────────────────────────────────

function generateFileExt(file: File): string {
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext && ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return ext;
  if (file.type === 'image/png') return 'png';
  if (file.type === 'image/gif') return 'gif';
  if (file.type === 'image/webp') return 'webp';
  return 'jpg';
}

export async function uploadTutorHomeworkTaskImage(
  file: File,
): Promise<{ objectPath: string }> {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;
  if (!userId) {
    throw new HomeworkApiError(401, 'UNAUTHORIZED', 'Нет активной сессии');
  }

  const ext = generateFileExt(file);
  const uuid = crypto.randomUUID();
  const objectPath = `tutor/${userId}/${uuid}.${ext}`;

  const { error } = await supabase.storage
    .from('homework-task-images')
    .upload(objectPath, file, {
      contentType: file.type || 'image/jpeg',
      upsert: false,
    });

  if (error) {
    throw new HomeworkApiError(500, 'UPLOAD_ERROR', error.message);
  }

  return { objectPath };
}

export async function deleteTutorHomeworkTaskImage(
  objectPath: string,
): Promise<void> {
  await supabase.storage
    .from('homework-task-images')
    .remove([objectPath])
    .catch((err) => {
      console.warn('homework_task_image_delete_failed', { objectPath, error: String(err) });
    });
}
