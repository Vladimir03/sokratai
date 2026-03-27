import { supabase } from '@/lib/supabaseClient';
import type { HomeworkThread } from '@/types/homework';

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
  delivered_count?: number;
  not_connected_count?: number;
}

export interface CreateAssignmentTask {
  order_num?: number;
  task_text: string;
  task_image_url?: string | null;
  correct_answer?: string | null;
  rubric_text?: string | null;
  max_score?: number;
}

export interface CreateAssignmentPayload {
  title: string;
  subject: HomeworkSubject;
  topic?: string | null;
  description?: string | null;
  deadline?: string | null;
  tasks: CreateAssignmentTask[];
  group_id?: string | null;
  save_as_template?: boolean;
  workflow_mode?: 'classic' | 'guided_chat';
}

// ─── Templates ───────────────────────────────────────────────────────────────

export interface HomeworkTemplateTask {
  task_text: string;
  task_image_url?: string | null;
  correct_answer?: string | null;
  rubric_text?: string | null;
  max_score?: number;
}

export interface HomeworkTemplateListItem {
  id: string;
  title: string;
  subject: HomeworkSubject;
  topic: string | null;
  tags: string[];
  created_at: string;
  task_count?: number;
}

export interface HomeworkTemplate {
  id: string;
  title: string;
  subject: HomeworkSubject;
  topic: string | null;
  tags: string[];
  tasks_json: HomeworkTemplateTask[];
  created_at: string;
}

export interface CreateTemplatePayload {
  title: string;
  subject: HomeworkSubject;
  topic?: string | null;
  tags?: string[];
  tasks_json: HomeworkTemplateTask[];
}

// ─── Materials ───────────────────────────────────────────────────────────────

export type MaterialType = 'pdf' | 'image' | 'link';

export interface HomeworkMaterial {
  id: string;
  type: MaterialType;
  storage_ref: string | null;
  url: string | null;
  title: string;
  created_at: string;
}

export interface AddMaterialPayload {
  type: MaterialType;
  title: string;
  storage_ref?: string | null;
  url?: string | null;
}

export interface UploadTutorHomeworkMaterialResult {
  storageRef: string;
  bucket: string;
  objectPath: string;
}

// ─── Delivery tracking ───────────────────────────────────────────────────────

export type DeliveryStatus =
  | 'pending' | 'delivered'
  | 'delivered_push' | 'delivered_telegram' | 'delivered_email'
  | 'failed_not_connected' | 'failed_blocked_or_other'
  | 'failed_all_channels' | 'failed_no_channel';

export interface CreateAssignmentResponse {
  assignment_id: string;
}

export interface AssignStudentsResponse {
  added: number;
  assignment_status: HomeworkAssignmentStatus;
  assigned_group_id?: string | null;
  students_without_telegram?: string[];
  students_without_telegram_names?: string[];
}

export type NotifyFailureReason =
  | 'missing_telegram_link'
  | 'telegram_send_failed'
  | 'telegram_send_error'
  | 'push_expired'
  | 'push_send_failed'
  | 'email_send_failed'
  | 'no_channels_available'
  | 'all_channels_failed';

export interface NotifyStudentsResponse {
  sent: number;
  failed: number;
  sent_by_channel?: { push: number; telegram: number; email: number };
  failed_student_ids: string[];
  failed_by_reason?: Record<string, NotifyFailureReason>;
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
  groupId?: string | null,
): Promise<AssignStudentsResponse> {
  return requestHomeworkApi<AssignStudentsResponse>(
    `/assignments/${encodeURIComponent(assignmentId)}/assign`,
    {
      method: 'POST',
      body: JSON.stringify({ student_ids: studentIds, group_id: groupId ?? null }),
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

const STORAGE_REF_PREFIX = 'storage://';
const HOMEWORK_TASK_IMAGES_BUCKET = 'homework-task-images';
const HOMEWORK_TASK_IMAGES_FALLBACK_BUCKET = 'chat-images';

export interface ParsedStorageRef {
  bucket: string;
  objectPath: string;
}

export interface UploadTutorHomeworkTaskImageResult {
  storageRef: string;
  bucket: string;
  objectPath: string;
  usedFallback: boolean;
}

function sanitizeObjectPath(path: string): string {
  return path.replace(/^\/+/, '').trim();
}

export function toStorageRef(bucket: string, objectPath: string): string {
  return `${STORAGE_REF_PREFIX}${bucket}/${sanitizeObjectPath(objectPath)}`;
}

export function parseStorageRef(
  value: string | null | undefined,
  defaultBucket = HOMEWORK_TASK_IMAGES_BUCKET,
): ParsedStorageRef | null {
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

function isBucketNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const maybeError = error as { message?: string; statusCode?: number; status?: number };
  const message = (maybeError.message ?? '').toLowerCase();
  const statusCode = maybeError.statusCode ?? maybeError.status;
  return message.includes('bucket not found') || statusCode === 404;
}

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
): Promise<UploadTutorHomeworkTaskImageResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;
  if (!userId) {
    throw new HomeworkApiError(401, 'UNAUTHORIZED', 'Нет активной сессии');
  }

  const ext = generateFileExt(file);
  const uuid = crypto.randomUUID();
  const primaryPath = `tutor/${userId}/${uuid}.${ext}`;

  const { error: primaryError } = await supabase.storage
    .from(HOMEWORK_TASK_IMAGES_BUCKET)
    .upload(primaryPath, file, {
      contentType: file.type || 'image/jpeg',
      upsert: false,
    });

  if (!primaryError) {
    return {
      storageRef: toStorageRef(HOMEWORK_TASK_IMAGES_BUCKET, primaryPath),
      bucket: HOMEWORK_TASK_IMAGES_BUCKET,
      objectPath: primaryPath,
      usedFallback: false,
    };
  }

  if (!isBucketNotFoundError(primaryError)) {
    throw new HomeworkApiError(500, 'UPLOAD_ERROR', primaryError.message);
  }

  const fallbackPath = `${userId}/homework-task/${uuid}.${ext}`;
  const { error: fallbackError } = await supabase.storage
    .from(HOMEWORK_TASK_IMAGES_FALLBACK_BUCKET)
    .upload(fallbackPath, file, {
      contentType: file.type || 'image/jpeg',
      upsert: false,
    });

  if (fallbackError) {
    throw new HomeworkApiError(500, 'UPLOAD_ERROR', fallbackError.message);
  }

  return {
    storageRef: toStorageRef(HOMEWORK_TASK_IMAGES_FALLBACK_BUCKET, fallbackPath),
    bucket: HOMEWORK_TASK_IMAGES_FALLBACK_BUCKET,
    objectPath: fallbackPath,
    usedFallback: true,
  };
}

export async function deleteTutorHomeworkTaskImage(
  storageRefOrPath: string,
): Promise<void> {
  const parsed = parseStorageRef(storageRefOrPath, HOMEWORK_TASK_IMAGES_BUCKET);
  if (!parsed) return;

  await supabase.storage
    .from(parsed.bucket)
    .remove([parsed.objectPath])
    .catch((err) => {
      console.warn('homework_task_image_delete_failed', {
        bucket: parsed.bucket,
        objectPath: parsed.objectPath,
        error: String(err),
      });
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
    workflow_mode?: 'classic' | 'guided_chat';
    created_at: string;
  };
  tasks: {
    id: string;
    order_num: number;
    task_text: string;
    task_image_url: string | null;
    correct_answer: string | null;
    rubric_text: string | null;
    max_score: number;
  }[];
  assigned_students: {
    student_id: string;
    name: string | null;
    notified: boolean;
    notified_at: string | null;
    delivery_status: DeliveryStatus;
    delivery_error_code: string | null;
  }[];
  materials: HomeworkMaterial[];
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
  submitted_at: string | null;
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

export interface TutorStudentGuidedThreadResponse {
  thread: HomeworkThread;
  tasks: {
    id: string;
    order_num: number;
    task_text: string;
    task_image_url: string | null;
    max_score: number;
  }[];
  student: {
    id: string;
    full_name: string | null;
    username: string | null;
  };
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

export async function getTutorStudentGuidedThread(
  assignmentId: string,
  studentId: string,
): Promise<TutorStudentGuidedThreadResponse> {
  return requestHomeworkApi<TutorStudentGuidedThreadResponse>(
    `/assignments/${encodeURIComponent(assignmentId)}/students/${encodeURIComponent(studentId)}/thread`,
  );
}

export async function postTutorThreadMessage(
  assignmentId: string,
  studentId: string,
  content: string,
  options?: {
    visible_to_student?: boolean;
    task_order?: number;
    image_url?: string;
  },
): Promise<{ id: string; created_at: string }> {
  return requestHomeworkApi<{ id: string; created_at: string }>(
    `/assignments/${encodeURIComponent(assignmentId)}/students/${encodeURIComponent(studentId)}/thread/messages`,
    {
      method: 'POST',
      body: JSON.stringify({
        content,
        visible_to_student: options?.visible_to_student ?? true,
        task_order: options?.task_order,
        image_url: options?.image_url,
      }),
    },
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
  storageRefOrPath: string,
  options?: {
    defaultBucket?: string;
  },
): Promise<string | null> {
  const parsed = parseStorageRef(
    storageRefOrPath,
    options?.defaultBucket ?? 'homework-images',
  );
  if (!parsed) return null;

  const { data, error } = await supabase.storage
    .from(parsed.bucket)
    .createSignedUrl(parsed.objectPath, 3600);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

export async function getTaskImageSignedUrl(
  assignmentId: string,
  taskId: string,
): Promise<string | null> {
  try {
    const result = await requestHomeworkApi<{ url: string }>(
      `/assignments/${encodeURIComponent(assignmentId)}/tasks/${encodeURIComponent(taskId)}/image-url`,
    );
    return result.url ?? null;
  } catch {
    return null;
  }
}

// ─── Templates API ────────────────────────────────────────────────────────────

export async function listTutorHomeworkTemplates(
  subject?: HomeworkSubject,
): Promise<HomeworkTemplateListItem[]> {
  const qs = subject ? `?subject=${encodeURIComponent(subject)}` : '';
  return requestHomeworkApi<HomeworkTemplateListItem[]>(`/templates${qs}`);
}

export async function getTutorHomeworkTemplate(id: string): Promise<HomeworkTemplate> {
  return requestHomeworkApi<HomeworkTemplate>(`/templates/${encodeURIComponent(id)}`);
}

export async function createTutorHomeworkTemplate(
  payload: CreateTemplatePayload,
): Promise<{ template_id: string }> {
  return requestHomeworkApi<{ template_id: string }>('/templates', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function deleteTutorHomeworkTemplate(id: string): Promise<void> {
  await requestHomeworkApi<{ ok: boolean }>(`/templates/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

// ─── Materials API ────────────────────────────────────────────────────────────

const HOMEWORK_MATERIALS_BUCKET = 'homework-materials';

export async function uploadTutorHomeworkMaterial(
  file: File,
): Promise<UploadTutorHomeworkMaterialResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;
  if (!userId) {
    throw new HomeworkApiError(401, 'UNAUTHORIZED', 'Нет активной сессии');
  }

  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'bin';
  const uuid = crypto.randomUUID();
  const objectPath = `materials/${userId}/${uuid}.${ext}`;

  const { error } = await supabase.storage
    .from(HOMEWORK_MATERIALS_BUCKET)
    .upload(objectPath, file, { contentType: file.type, upsert: false });

  if (error) {
    throw new HomeworkApiError(500, 'UPLOAD_ERROR', error.message);
  }

  return {
    storageRef: toStorageRef(HOMEWORK_MATERIALS_BUCKET, objectPath),
    bucket: HOMEWORK_MATERIALS_BUCKET,
    objectPath,
  };
}

export async function addTutorHomeworkMaterial(
  assignmentId: string,
  payload: AddMaterialPayload,
): Promise<{ material_id: string }> {
  return requestHomeworkApi<{ material_id: string }>(
    `/assignments/${encodeURIComponent(assignmentId)}/materials`,
    { method: 'POST', body: JSON.stringify(payload) },
  );
}

export async function deleteTutorHomeworkMaterial(
  assignmentId: string,
  materialId: string,
): Promise<void> {
  await requestHomeworkApi<{ ok: boolean }>(
    `/assignments/${encodeURIComponent(assignmentId)}/materials/${encodeURIComponent(materialId)}`,
    { method: 'DELETE' },
  );
}

export async function getMaterialSignedUrl(
  assignmentId: string,
  materialId: string,
): Promise<string | null> {
  try {
    const result = await requestHomeworkApi<{ url: string }>(
      `/assignments/${encodeURIComponent(assignmentId)}/materials/${encodeURIComponent(materialId)}/signed-url`,
    );
    return result.url ?? null;
  } catch {
    return null;
  }
}

// ─── Assignment update / delete ───────────────────────────────────────────────

export interface UpdateAssignmentTask {
  id?: string;
  task_text: string;
  order_num?: number;
  task_image_url?: string | null;
  correct_answer?: string | null;
  max_score?: number;
  rubric_text?: string | null;
}

export async function updateTutorHomeworkAssignment(
  assignmentId: string,
  patch: {
    title?: string;
    subject?: string;
    topic?: string | null;
    description?: string | null;
    deadline?: string | null;
    status?: string;
    workflow_mode?: 'classic' | 'guided_chat';
    tasks?: UpdateAssignmentTask[];
  },
): Promise<void> {
  await requestHomeworkApi<{ ok: boolean }>(
    `/assignments/${encodeURIComponent(assignmentId)}`,
    { method: 'PUT', body: JSON.stringify(patch) },
  );
}

export async function deleteTutorHomeworkAssignment(
  assignmentId: string,
): Promise<void> {
  await requestHomeworkApi<{ ok: boolean }>(
    `/assignments/${encodeURIComponent(assignmentId)}`,
    { method: 'DELETE' },
  );
}

// ─── Attempts API ─────────────────────────────────────────────────────────────

export interface TutorHomeworkAttemptSummary {
  id: string;
  assignment_id: string;
  student_id: string;
  status: string;
  attempt_no: number;
  submitted_at: string | null;
  total_score: number | null;
  total_max_score: number | null;
}

export async function listTutorHomeworkAttempts(
  assignmentId: string,
  studentId?: string,
): Promise<TutorHomeworkAttemptSummary[]> {
  const qs = studentId ? `?student_id=${encodeURIComponent(studentId)}` : '';
  return requestHomeworkApi<TutorHomeworkAttemptSummary[]>(
    `/assignments/${encodeURIComponent(assignmentId)}/attempts${qs}`,
  );
}
