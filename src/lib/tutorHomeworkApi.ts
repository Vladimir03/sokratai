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

// ─── L3: Assignment details + results + review ──────────────────────────────

export interface TutorHomeworkAssignmentDetails {
  assignment: {
    id: string;
    tutor_id: string;
    title: string;
    subject: HomeworkSubject;
    topic: string | null;
    description: string | null;
    deadline: string | null;
    status: HomeworkAssignmentStatus;
    created_at: string;
  };
  tasks: {
    id: string;
    order_num: number;
    task_text: string;
    task_image_url: string | null;
    correct_answer: string | null;
    solution_steps: string | null;
    max_score: number;
  }[];
  assigned_students: {
    student_id: string;
    name: string | null;
    notified: boolean;
    notified_at: string | null;
  }[];
  submissions_summary: {
    total: number;
    by_status: Record<string, number>;
    avg_percent: number | null;
  };
}

export interface TutorHomeworkSubmissionItem {
  task_id: string;
  task_order_num: number;
  task_text: string;
  max_score: number;
  student_text: string | null;
  student_image_urls: string[] | null;
  recognized_text: string | null;
  ai_is_correct: boolean | null;
  ai_confidence: number | null;
  ai_feedback: string | null;
  ai_error_type: string | null;
  ai_score: number | null;
  tutor_override_correct: boolean | null;
  tutor_comment: string | null;
}

export interface TutorHomeworkResultsPerStudent {
  student_id: string;
  name: string | null;
  status: string;
  total_score: number | null;
  total_max_score: number | null;
  percent: number | null;
  submission_id: string;
  top_error_types: { type: string; count: number }[];
  submission_items: TutorHomeworkSubmissionItem[];
}

export interface TutorHomeworkResultsPerTask {
  task_id: string;
  order_num: number;
  max_score: number;
  avg_score: number | null;
  correct_rate: number | null;
  error_type_histogram: { type: string; count: number }[];
}

export interface TutorHomeworkResultsResponse {
  summary: {
    avg_score: number | null;
    distribution: Record<string, number>;
    common_error_types: { type: string; count: number }[];
  };
  per_student: TutorHomeworkResultsPerStudent[];
  per_task: TutorHomeworkResultsPerTask[];
}

export interface ReviewItem {
  task_id: string;
  tutor_override_correct?: boolean;
  tutor_comment?: string | null;
  tutor_score?: number | null;
}

export interface ReviewPayload {
  items: ReviewItem[];
  status?: string;
}

export async function getTutorHomeworkAssignment(
  assignmentId: string,
): Promise<TutorHomeworkAssignmentDetails> {
  return requestHomeworkApi<TutorHomeworkAssignmentDetails>(
    `/assignments/${encodeURIComponent(assignmentId)}`,
  );
}

export async function getTutorHomeworkResults(
  assignmentId: string,
): Promise<TutorHomeworkResultsResponse> {
  return requestHomeworkApi<TutorHomeworkResultsResponse>(
    `/assignments/${encodeURIComponent(assignmentId)}/results`,
  );
}

export async function reviewTutorHomeworkSubmission(
  submissionId: string,
  payload: ReviewPayload,
): Promise<{ ok: boolean }> {
  return requestHomeworkApi<{ ok: boolean }>(
    `/submissions/${encodeURIComponent(submissionId)}/review`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    },
  );
}

export async function getHomeworkImageSignedUrl(
  objectPath: string,
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from('homework-images')
    .createSignedUrl(objectPath, 3600);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
