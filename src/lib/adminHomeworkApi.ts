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
  image_url: string | null;
  task_order: number | null;
  author_user_id: string | null;
}

export interface AdminTaskState {
  id: string;
  status: string;
  hint_count: number;
  wrong_answer_count: number;
  earned_score: number | null;
  available_score: number | null;
  task_id: string;
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
