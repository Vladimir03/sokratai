import { parseISO } from 'date-fns';
import { supabase } from '@/lib/supabaseClient';
import type { HomeworkThread } from '@/types/homework';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ModernHomeworkSubject =
  | 'maths'
  | 'physics'
  | 'informatics'
  | 'russian'
  | 'literature'
  | 'history'
  | 'social'
  | 'english'
  | 'french'
  | 'chemistry'
  | 'biology'
  | 'geography'
  | 'spanish'
  | 'other';

export type LegacyHomeworkSubject = 'math' | 'cs' | 'rus' | 'algebra' | 'geometry';
export type HomeworkSubject = ModernHomeworkSubject | LegacyHomeworkSubject;
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
  /**
   * Кол-во учеников, приступивших к ДЗ (есть хотя бы одно user-сообщение
   * в guided chat thread). Не считается по самому факту provisioned thread.
   * Включает и сдавших, и в процессе. Для отображения «submitted(started)/total»
   * на карточке ДЗ. Optional — backend может не вернуть при старых клиентах.
   */
  started_count?: number;
  avg_score: number | null;
  /** Sum of max_score for all tasks in this assignment. Used to display "X/Y" format. */
  max_score_total?: number | null;
  delivered_count?: number;
  not_connected_count?: number;
}

export interface CreateAssignmentTask {
  order_num?: number;
  task_text: string;
  /**
   * Storage refs для фото условия. Dual-format — single ref ИЛИ JSON-array.
   * Лимит 5. См. `@/lib/attachmentRefs`.
   */
  task_image_url?: string | null;
  correct_answer?: string | null;
  rubric_text?: string | null;
  /**
   * Storage refs для фото критериев (рубрики). Dual-format. Лимит 3.
   * Видимость только репетитор (бэк не возвращает в getStudentAssignment).
   */
  rubric_image_urls?: string | null;
  /**
   * Эталонное решение от репетитора (текст). Единое поле "Решение для AI":
   * видно AI на check/hint/chat, НИКОГДА не возвращается ученику.
   */
  solution_text?: string | null;
  /**
   * Storage refs для фото эталонного решения. Dual-format. Лимит `MAX_SOLUTION_IMAGES` (5).
   * Видимость: только репетитор + AI-промпт.
   */
  solution_image_urls?: string | null;
  max_score?: number;
  check_format?: 'short_answer' | 'detailed_solution';
}

export interface CreateAssignmentPayload {
  title: string;
  subject: ModernHomeworkSubject;
  topic?: string | null;
  description?: string | null;
  deadline?: string | null;
  tasks: CreateAssignmentTask[];
  group_id?: string | null;
  save_as_template?: boolean;
  disable_ai_bootstrap?: boolean;
  exam_type?: 'ege' | 'oge';
}

// ─── Templates ───────────────────────────────────────────────────────────────

export interface HomeworkTemplateTask {
  task_text: string;
  /** Dual-format — см. `@/lib/attachmentRefs`. Лимит 5. */
  task_image_url?: string | null;
  correct_answer?: string | null;
  rubric_text?: string | null;
  /** Dual-format — см. `@/lib/attachmentRefs`. Лимит 3. */
  rubric_image_urls?: string | null;
  /** Эталонное решение от репетитора (текст). Видно AI на check/hint/chat. */
  solution_text?: string | null;
  /** Dual-format — см. `@/lib/attachmentRefs`. Лимит 5. */
  solution_image_urls?: string | null;
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
  subject: ModernHomeworkSubject;
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
  options?: {
    messageTemplate?: string;
    studentIds?: string[];
  },
): Promise<NotifyStudentsResponse> {
  const body: Record<string, unknown> = {};
  if (options?.messageTemplate) {
    body.message_template = options.messageTemplate;
  }
  if (options?.studentIds && options.studentIds.length > 0) {
    body.student_ids = options.studentIds;
  }
  return requestHomeworkApi<NotifyStudentsResponse>(
    `/assignments/${encodeURIComponent(assignmentId)}/notify`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
  );
}

/**
 * Per-student re-engagement reminder authored by the tutor (Homework Results v2,
 * AC-6 / AC-7). Backend resolves Telegram first; if unavailable, falls back to
 * the transactional email queue. Does NOT mutate notified / notified_at /
 * delivery_status — this is a re-engagement, not initial delivery.
 */
export interface RemindHomeworkStudentResponse {
  success: boolean;
  channel: 'telegram' | 'email';
}

export type RemindChannelPreference = 'auto' | 'telegram' | 'email';

export async function remindHomeworkStudent(
  assignmentId: string,
  studentId: string,
  message: string,
  channel: RemindChannelPreference = 'auto',
): Promise<RemindHomeworkStudentResponse> {
  return requestHomeworkApi<RemindHomeworkStudentResponse>(
    `/assignments/${encodeURIComponent(assignmentId)}/students/${encodeURIComponent(studentId)}/remind`,
    {
      method: 'POST',
      body: JSON.stringify({ message, channel }),
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
    disable_ai_bootstrap?: boolean;
    exam_type?: 'ege' | 'oge';
    created_at: string;
  };
  tasks: {
    id: string;
    order_num: number;
    task_text: string;
    task_image_url: string | null;
    correct_answer: string | null;
    rubric_text: string | null;
    rubric_image_urls?: string | null;
    /** Эталонное решение (текст). Только tutor-surface; student-API не возвращает. */
    solution_text?: string | null;
    /** Эталонное решение (фото). Dual-format. Только tutor-surface. */
    solution_image_urls?: string | null;
    max_score: number;
    check_format?: 'short_answer' | 'detailed_solution';
    kb_task_id?: string | null;
    kb_snapshot_text?: string | null;
    kb_snapshot_answer?: string | null;
    kb_snapshot_solution?: string | null;
    kb_snapshot_edited?: boolean;
    kb_snapshot_solution_image_refs?: string | null;
    kb_source_label?: string | null;
  }[];
  assigned_students: {
    student_id: string;
    name: string | null;
    notified: boolean;
    notified_at: string | null;
    delivery_status: DeliveryStatus;
    delivery_error_code: string | null;
    /**
     * True if backend resolved either profiles.telegram_user_id OR an active
     * telegram_sessions row for this student. Drives RemindStudentDialog
     * channel selection (telegram vs email fallback) per AC-7.
     */
    has_telegram_link: boolean;
    /**
     * True if auth.users.email exists AND is not a `@temp.sokratai.ru`
     * placeholder. Drives the email tab availability in RemindStudentDialog.
     */
    has_email: boolean;
  }[];
  materials: HomeworkMaterial[];
  submissions_summary: {
    total: number;
    by_status: Record<string, number>;
    avg_percent: number | null;
    /**
     * True if any student has posted at least one user message in the guided
     * thread for this assignment. Mirrors the destructive-change gate in
     * PUT /assignments/:id and drives "lock task edits" in the tutor editor.
     */
    has_interactions: boolean;
  };
}

export interface TutorHomeworkResultsPerTask {
  task_id: string;
  order_num: number;
  max_score: number;
  avg_score: number | null;
  correct_rate: number | null;
  error_type_histogram: { type: string; count: number }[];
}

export interface TutorHomeworkResultsPerStudent {
  student_id: string;
  submitted: boolean;
  final_score_total: number;
  max_score_total: number;
  hint_total: number;
  needs_attention: boolean;
  /**
   * Per-task breakdown for the heatmap grid (Results v2 TASK-5).
   *
   * Only **individually completed** task_states appear in the array — absence
   * means "не приступал к этой задаче" and the frontend renders a grey cell
   * with an em-dash. For active (in-progress) threads, only tasks the student
   * has actually solved are included; precreated "active" stubs are omitted.
   *
   * `final_score` follows the priority chain
   * `tutor_score_override → earned_score → ai_score → status fallback`
   * (same as `computeFinalScore` on the backend). `earned_score` takes
   * precedence over `ai_score` so the tutor sees the same hint-degraded
   * score as the student.
   *
   * For not-started students (no thread) this is always `[]`.
   * For in-progress students, it contains only their solved tasks.
   */
  task_scores: {
    task_id: string;
    final_score: number;
    hint_count: number;
    /**
     * True if `tutor_score_override` is set on the underlying task_state.
     * Drives the small "правка репетитора" indicator on TaskMiniCard
     * (Homework Results v2 P0-5). `final_score` already reflects the override.
     */
    has_override?: boolean;
    /** Original AI-evaluated score, independent of tutor override. */
    ai_score?: number | null;
  }[];

  /**
   * Σ final_score across task_states for this student, computed via
   * `computeFinalScore` (`tutor_score_override → earned_score → ai_score →
   * status fallback`). For submitted students: sum over completed thread.
   * For in-progress students: sum over individually-completed tasks only.
   * 0 for not-started students. 0 if `total_max === 0` (empty assignment).
   *
   * Known gap: when a tutor sets `tutor_score_override`, this value reflects
   * the override, but the student-side UI still shows `earned_score`. Full
   * unification of override visibility is a separate slice.
   */
  total_score: number;

  /**
   * Σ max_score across ALL tasks of the assignment (NOT per task_states).
   * Stable per assignment — same value for every student. 0 only if the
   * assignment has no tasks (empty-assignment guard).
   */
  total_max: number;

  /**
   * Wall-clock minutes from the first to the last `homework_tutor_thread_messages.created_at`
   * across the student's threads (any status — completed OR in-progress),
   * rounded with `Math.max(1, round(diff_ms / 60000))`. `null` if the student
   * has no thread or no messages.
   *
   * Frontend (`HeatmapGrid` TASK-2) uses this together with `submitted` to
   * derive 3-state rendering:
   * - `submitted=true`                              → `{N} мин`
   * - `submitted=false, total_time_minutes !== null` → «— в процессе»
   * - `submitted=false, total_time_minutes === null` → «—»
   */
  total_time_minutes: number | null;
}

// ─── Manual score override (Homework Results v2 P0-5 / AC-5) ─────────────────

export interface SetTutorScoreOverrideResponse {
  ok: true;
  task_state: {
    id: string;
    thread_id: string;
    task_id: string;
    ai_score: number | null;
    tutor_score_override: number | null;
    tutor_score_override_comment: string | null;
    tutor_score_override_at: string | null;
    final_score: number;
    max_score: number;
  };
}

export async function setTutorScoreOverride(params: {
  assignmentId: string;
  studentId: string;
  taskId: string;
  tutorScoreOverride: number | null;
  comment?: string | null;
}): Promise<SetTutorScoreOverrideResponse> {
  const { assignmentId, studentId, taskId, tutorScoreOverride, comment } = params;
  return requestHomeworkApi<SetTutorScoreOverrideResponse>(
    `/assignments/${encodeURIComponent(assignmentId)}/students/${encodeURIComponent(studentId)}/tasks/${encodeURIComponent(taskId)}/score-override`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        tutor_score_override: tutorScoreOverride,
        tutor_score_override_comment: tutorScoreOverride === null ? null : (comment ?? null),
      }),
    },
  );
}

export interface TutorHomeworkResultsResponse {
  summary: {
    avg_score: number | null;
    distribution: Record<string, number>;
    common_error_types: { type: string; count: number }[];
  };
  per_task: TutorHomeworkResultsPerTask[];
  per_student: TutorHomeworkResultsPerStudent[];
}

export interface TutorStudentGuidedThreadResponse {
  thread: HomeworkThread;
  tasks: {
    id: string;
    order_num: number;
    task_text: string;
    task_image_url: string | null;
    max_score: number;
    check_format: 'short_answer' | 'detailed_solution';
  }[];
  student: {
    id: string;
    full_name: string | null;
    username: string | null;
  };
}

export function mergeThreadMessage(
  prev: TutorStudentGuidedThreadResponse | null | undefined,
  newMessage: HomeworkThread['homework_tutor_thread_messages'][number],
): TutorStudentGuidedThreadResponse | null | undefined {
  if (prev == null) return prev;

  const messages = prev.thread.homework_tutor_thread_messages ?? [];
  if (messages.some((message) => message.id === newMessage.id)) {
    return prev;
  }

  const nextMessages = [...messages, newMessage].sort(
    (a, b) => parseISO(a.created_at).getTime() - parseISO(b.created_at).getTime(),
  );

  return {
    ...prev,
    thread: {
      ...prev.thread,
      homework_tutor_thread_messages: nextMessages,
    },
  };
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
    task_id?: string;
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
        task_id: options?.task_id,
        image_url: options?.image_url,
      }),
    },
  );
}

// ─── Recent dialogs + unread tracking (TASK-7 follow-up) ─────────────────────

export interface RecentDialogItem {
  studentId: string;
  name: string;
  stream: 'ЕГЭ' | 'ОГЭ';
  lastAuthor: 'student' | 'tutor' | 'ai';
  unread: boolean;
  /**
   * Number of student messages with `created_at > tutor_last_viewed_at`.
   * 0 when there are no unread messages. Used by the «Последние диалоги»
   * block on /tutor/home to render a Telegram-style counter badge.
   * Optional in transit for backward compat with older edge function deploys
   * (frontend hooks default missing values to 0).
   */
  unreadCount: number;
  preview: string;
  at: string;
  hwId: string;
  hwTitle: string;
}

export async function getTutorRecentDialogs(): Promise<RecentDialogItem[]> {
  const resp = await requestHomeworkApi<{ items: RecentDialogItem[] }>(
    '/recent-dialogs',
  );
  return resp.items ?? [];
}

export async function markThreadViewedByTutor(
  threadId: string,
): Promise<{ ok: true; viewed_at: string }> {
  return requestHomeworkApi<{ ok: true; viewed_at: string }>(
    `/threads/${encodeURIComponent(threadId)}/viewed-by-tutor`,
    { method: 'POST' },
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
    options?.defaultBucket ?? HOMEWORK_TASK_IMAGES_BUCKET,
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

export async function getTutorTaskImagesSignedUrls(
  assignmentId: string,
  taskId: string,
): Promise<string[]> {
  try {
    const result = await requestHomeworkApi<{ signed_urls?: unknown }>(
      `/assignments/${encodeURIComponent(assignmentId)}/tasks/${encodeURIComponent(taskId)}/images`,
    );
    return Array.isArray(result.signed_urls)
      ? result.signed_urls.filter((value): value is string => typeof value === 'string' && value.length > 0)
      : [];
  } catch {
    return [];
  }
}

export async function getTutorRubricImagesSignedUrls(
  assignmentId: string,
  taskId: string,
): Promise<string[]> {
  try {
    const result = await requestHomeworkApi<{ signed_urls?: unknown }>(
      `/assignments/${encodeURIComponent(assignmentId)}/tasks/${encodeURIComponent(taskId)}/rubric-images`,
    );
    return Array.isArray(result.signed_urls)
      ? result.signed_urls.filter((value): value is string => typeof value === 'string' && value.length > 0)
      : [];
  } catch {
    return [];
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
  /** Dual-format — см. `@/lib/attachmentRefs`. Лимит 5. */
  task_image_url?: string | null;
  correct_answer?: string | null;
  max_score?: number;
  rubric_text?: string | null;
  /** Dual-format — см. `@/lib/attachmentRefs`. Лимит 3. Tutor-only. */
  rubric_image_urls?: string | null;
  /** Эталонное решение (текст). Tutor-only, видно AI на check/hint/chat. */
  solution_text?: string | null;
  /** Dual-format — см. `@/lib/attachmentRefs`. Лимит 5. Tutor-only. */
  solution_image_urls?: string | null;
  check_format?: 'short_answer' | 'detailed_solution';
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
    disable_ai_bootstrap?: boolean;
    exam_type?: 'ege' | 'oge';
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
