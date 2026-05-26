import { supabase } from "@/lib/supabaseClient";

/* ─── Types ─── */

export interface TutorOverview {
  tutorId: string;
  tutorName: string;
  telegramUsername: string | null;
  totalAssignments: number;
  activeAssignments: number;
  completedAssignments: number;
  totalStudents: number;
  activeStudents7d: number;
  lastActivityAt: string | null;
  lastActivityStudentName: string | null;
  lastActivityPreview: string | null;
}

export interface AssignmentOverview {
  assignmentId: string;
  title: string;
  subject: string;
  examType: string | null;
  status: string;
  totalStudents: number;
  completedStudents: number;
  inProgressStudents: number;
  notStartedStudents: number;
  lastMessageAt: string | null;
  lastMessageStudentName: string | null;
  lastMessagePreview: string | null;
}

export interface AssignmentStudentRow {
  threadId: string | null;
  studentAssignmentId: string;
  studentId: string;
  studentName: string;
  status: string; // 'active' | 'completed' | 'not_started'
  messageCount: number;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
}

export interface AdminThreadMessage {
  id: string;
  role: string;
  content: string;
  created_at: string;
  message_kind: string | null;
  visible_to_student: boolean;
  /** Сырой dual-format ref string из БД (storage:// или JSON-array). Для debug-view. */
  image_url: string | null;
  /** Уже резолвленные backend'ом signed URLs (с rewriteToProxy). Готовы для <img src>. */
  image_urls?: string[];
  task_id?: string | null;
  task_order: number | null;
  author_user_id: string | null;
  submission_payload?: Record<string, unknown> | null;
  message_delivery_status?: string | null;
}

export interface AdminTaskState {
  id: string;
  status: string;
  hint_count: number;
  wrong_answer_count: number;
  earned_score: number | null;
  available_score: number | null;
  attempts?: number | null;
  best_score?: number | null;
  ai_score?: number | null;
  ai_score_comment?: string | null;
  tutor_score_override?: number | null;
  tutor_score_override_comment?: string | null;
  tutor_score_override_at?: string | null;
  tutor_force_completed_at?: string | null;
  task_id: string;
}

export interface AdminThreadMeta {
  id: string;
  student_assignment_id: string | null;
  current_task_id: string | null;
  status: string;
  last_student_message_at: string | null;
  tutor_last_viewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdminAssignmentMeta {
  assignment_id: string | null;
  student_id: string | null;
  tutor_id: string | null;
  student_assignment_id: string | null;
}

export interface AdminTaskMeta {
  id: string;
  order_num: number;
  max_score: number;
  kim_number: number | null;
  task_kind: string;
  check_format: string;
}

export interface TutorExtras {
  lessons_total: number;
  lessons_done: number;
  lessons_cancelled: number;
  lessons_no_show: number;
  lessons_recurring: number;
  gmv_paid: number;
  gmv_pending: number;
  payments_count: number;
  mock_exams_count: number;
  // Period-scoped homework metrics (опциональны для backward-compat со старым деплоем).
  assignments_in_period?: number;
  assignments_active_in_period?: number;
  assignments_completed_in_period?: number;
  students_in_period?: number;
  active_students_in_period?: number;
  /** Distinct days (YYYY-MM-DD) с любой активностью репетитора: уроки, оплаты, ДЗ, пробники. */
  distinct_active_days?: number;
}

/* ─── API (delegates to admin-homework edge function) ─── */

async function invokeAdminHomework<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("admin-homework", { body });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data as T;
}

export async function fetchTutorsOverview(): Promise<TutorOverview[]> {
  const data = await invokeAdminHomework<{ tutors: TutorOverview[] }>({ action: "tutors" });
  return data.tutors || [];
}

/** Aggregates schedule + payments + mock-exams per tutor for the given date range. */
export async function fetchTutorExtras(start: string, end: string): Promise<Record<string, TutorExtras>> {
  const data = await invokeAdminHomework<{ extras: Record<string, TutorExtras> }>({
    action: "tutor_extras",
    start,
    end,
  });
  return data.extras || {};
}

export async function fetchAssignmentsByTutor(tutorId: string): Promise<AssignmentOverview[]> {
  const data = await invokeAdminHomework<{ assignments: AssignmentOverview[] }>({
    action: "assignments",
    tutorId,
  });
  return data.assignments || [];
}

export async function fetchStudentsInAssignment(assignmentId: string): Promise<AssignmentStudentRow[]> {
  const data = await invokeAdminHomework<{ students: AssignmentStudentRow[] }>({
    action: "students",
    assignmentId,
  });
  return data.students || [];
}

export async function fetchThreadDetails(threadId: string): Promise<{
  messages: AdminThreadMessage[];
  taskStates: AdminTaskState[];
  thread?: AdminThreadMeta | null;
  assignmentMeta?: AdminAssignmentMeta;
  tasks?: AdminTaskMeta[];
}> {
  return invokeAdminHomework({ action: "thread", threadId });
}

/* ─── Helpers exported ─── */

export function formatRelativeTime(iso: string | null): string {
  if (!iso) return "—";
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return "—";
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "только что";
  if (mins < 60) return `${mins} мин назад`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "вчера";
  if (days < 7) return `${days} д назад`;
  const date = new Date(ts);
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}
