import { supabase } from '@/lib/supabaseClient';
import { StudentHomeworkApiError } from '@/lib/studentHomeworkApi';

// ─── student-lessons-api client («Занятия» feed + detail) ──────────────────────
//
// Transport mirrors `requestStudentHomeworkApi` (studentHomeworkApi.ts:82) — same
// 401 → refreshSession + retry-once → signOut flow (rule Phase 3.1), same hardcoded
// RU-bypass host. Only the function path differs (`student-lessons-api`). Reuses
// `StudentHomeworkApiError` so callers branch on `code` (NO_SESSION / SESSION_EXPIRED
// / NOT_FOUND) uniformly. Errors are rule-97 flat `{ error, code }` server-side.

// HARDCODED — see src/lib/supabaseClient.ts (RU bypass, ignore Lovable auto-env).
const SUPABASE_URL = 'https://api.sokratai.ru';
const SUPABASE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZyc3Nlb3RyZm1zeHBiY2l5cXpjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk0MjEzMDYsImV4cCI6MjA3NDk5NzMwNn0.fDleU99ULnIvtbiJqlKtgaabZzIWqqw6gZLWQOFAcKw';

async function requestStudentLessonsApi<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const doFetch = async (): Promise<Response> => {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) {
      throw new StudentHomeworkApiError('Нет активной сессии', { code: 'NO_SESSION' });
    }
    return fetch(`${SUPABASE_URL}/functions/v1/student-lessons-api${path}`, {
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

  // 401 → cached token stale; one-shot refresh + retry, else signOut (AuthGuard
  // onAuthStateChange redirects to /login). Mirror of requestStudentHomeworkApi.
  if (response.status === 401) {
    const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError || !refreshData?.session) {
      await supabase.auth.signOut().catch(() => undefined);
      throw new StudentHomeworkApiError('Сессия истекла. Перенаправляем на вход…', {
        code: 'SESSION_EXPIRED',
      });
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
    // rule 97 flat shape `{ error: "<ru>", code }`. Parse directly (mirror
    // tutorProgressApi) — NOT extractApiErrorMessage, which treats a top-level
    // string `error` as a code and would drop the Russian phrase.
    const message =
      typeof body.error === 'string' && body.error.trim().length > 0
        ? body.error.trim()
        : `HTTP ${response.status}`;
    const bodyCode = typeof body.code === 'string' ? body.code : undefined;
    // Status-based stable codes win (404 → NOT_FOUND drives «Занятие не найдено»).
    const code =
      response.status === 404 ? 'NOT_FOUND' : response.status === 403 ? 'FORBIDDEN' : bodyCode;
    throw new StudentHomeworkApiError(message, code ? { code } : undefined);
  }

  return response.json() as Promise<T>;
}

// ─── Types (mirror student-lessons-api response) ───────────────────────────────

export type StudentLessonMaterialKind = 'recording' | 'pdf' | 'homework_ref';
export type HomeworkRefStatus = 'assigned' | 'submitted' | 'reviewed';

export interface StudentLessonMaterial {
  id: string;
  kind: StudentLessonMaterialKind;
  title: string | null;
  /** recording → generic URL; pdf → signed URL (may be null if signing failed). */
  url?: string | null;
  // homework_ref only:
  assignment_id?: string;
  status?: HomeworkRefStatus;
  score?: number | null;
  max?: number;
  /** Resolved entry task for one-hop deep-link (AC-6); null → use redirect entry. */
  entry_task_id?: string | null;
}

export interface StudentLessonTutor {
  name: string | null;
  avatar_url: string | null;
}

export interface StudentLesson {
  id: string;
  start_at: string;
  duration_min: number | null;
  subject: string | null;
  status: string;
  lesson_type: string | null;
  group_session_id: string | null;
  group_title_snapshot: string | null;
  tutor: StudentLessonTutor | null;
  materials: StudentLessonMaterial[];
}

/** Single source of truth for the homework_ref chip/badge (feed + detail). Mirrors
 *  StudentHomework STATUS_COLORS (assigned=blue / submitted=amber / reviewed=green). */
export const HW_REF_STATUS_CONFIG: Record<HomeworkRefStatus, { label: string; className: string }> = {
  assigned: { label: 'Назначено', className: 'bg-blue-100 text-blue-700 border-blue-200' },
  submitted: { label: 'Сдано', className: 'bg-amber-100 text-amber-700 border-amber-200' },
  reviewed: { label: 'Проверено', className: 'bg-green-100 text-green-700 border-green-200' },
};

// ─── API ───────────────────────────────────────────────────────────────────────

export async function listStudentLessons(): Promise<StudentLesson[]> {
  const res = await requestStudentLessonsApi<{ items: StudentLesson[] }>('/student/lessons', {
    method: 'GET',
  });
  return res.items ?? [];
}

export async function getStudentLesson(lessonId: string): Promise<StudentLesson> {
  const res = await requestStudentLessonsApi<{ lesson: StudentLesson }>(
    `/student/lessons/${encodeURIComponent(lessonId)}`,
    { method: 'GET' },
  );
  return res.lesson;
}
