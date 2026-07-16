import { supabase } from '@/lib/supabaseClient';
import { HomeworkApiError } from '@/lib/tutorHomeworkApi';

// ─── tutor-progress-api client (student-progress R1: «галочка проверено») ──────
//
// Тонкий клиент над edge function `tutor-progress-api`. Отдельный от
// `tutorHomeworkApi` (другая edge function), но переиспользует `HomeworkApiError`
// для единообразного toast.error(err.message).
//
// Контракт ошибок — rule 97 FLAT shape `{ error: "<русская фраза>", code }`.
// ВНИМАНИЕ: НЕ использовать `extractApiErrorMessage` (apiErrorMessage.ts) — там
// строковый `error` трактуется как code (subscription-limits стиль), что
// исказило бы русскую фразу. Парсим flat-shape напрямую.

// HARDCODED — RU bypass (см. supabaseClient.ts). Не использовать VITE_SUPABASE_URL.
const SUPABASE_URL = 'https://api.sokratai.ru';
const SUPABASE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZyc3Nlb3RyZm1zeHBiY2l5cXpjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk0MjEzMDYsImV4cCI6MjA3NDk5NzMwNn0.fDleU99ULnIvtbiJqlKtgaabZzIWqqw6gZLWQOFAcKw';

async function requestTutorProgressApi<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) {
    throw new HomeworkApiError(401, 'UNAUTHORIZED', 'Нет активной сессии');
  }

  const url = `${SUPABASE_URL}/functions/v1/tutor-progress-api${path}`;
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
    let body: { error?: unknown; code?: unknown } = {};
    try {
      body = await resp.json();
    } catch {
      // ignore parse error — fall back to HTTP status
    }
    const message =
      typeof body.error === 'string' && body.error.trim().length > 0
        ? body.error.trim()
        : `HTTP ${resp.status}`;
    const code = typeof body.code === 'string' ? body.code : 'UNKNOWN';
    throw new HomeworkApiError(resp.status, code, message);
  }

  return resp.json() as Promise<T>;
}

/**
 * Fire-and-forget beacon «клик по community-CTA» (воронка QR-онбординга, item 6).
 * Не блокирует навигацию (ссылки target=_blank → страница жива; `keepalive`
 * подстраховывает). Сбой телеметрии молча игнорируется — на UX не влияет.
 */
export function trackCommunityCtaClicked(channel: 'telegram' | 'vk'): void {
  void (async () => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) return;
      await fetch(`${SUPABASE_URL}/functions/v1/tutor-progress-api/track`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          apikey: SUPABASE_KEY,
        },
        body: JSON.stringify({ event: 'community_cta_clicked', channel }),
        keepalive: true,
      });
    } catch {
      // best-effort — телеметрия не критична
    }
  })();
}

// ─── Review «проверено» ────────────────────────────────────────────────────────

export interface ReviewTaskResponse {
  ok: true;
  task_state_id: string;
  thread_id: string;
  task_id: string;
  tutor_reviewed_at: string;
  final_score: number;
  max_score: number;
  advanced_to_task_id: string | null;
  thread_completed: boolean;
}

/**
 * Подтвердить задачу («проверено»). `score`/`comment` опциональны — задаются,
 * только если репетитор реально правит балл (иначе AI-балл не перезаписывается).
 * Для active-задачи backend дополнительно закрывает её (status='completed' +
 * advance) — единый атомарный RPC. Race-guard: повторный confirm → 409.
 */
export async function reviewTask(params: {
  assignmentId: string;
  studentId: string;
  taskId: string;
  score?: number | null;
  comment?: string | null;
}): Promise<ReviewTaskResponse> {
  const { assignmentId, studentId, taskId, score, comment } = params;
  return requestTutorProgressApi<ReviewTaskResponse>(
    `/assignments/${encodeURIComponent(assignmentId)}/students/${encodeURIComponent(studentId)}/review-task`,
    {
      method: 'POST',
      body: JSON.stringify({
        task_id: taskId,
        score: score ?? null,
        comment: score == null ? null : (comment ?? null),
      }),
    },
  );
}

export interface ReviewAllAiResponse {
  ok: true;
  reviewed_count: number;
}

/**
 * Bulk-подтвердить всё, что AI проверил (`ai_score != null && reviewed_at == null`).
 * Баллы/статус НЕ трогает.
 */
export async function reviewAllAi(params: {
  assignmentId: string;
  studentId: string;
}): Promise<ReviewAllAiResponse> {
  const { assignmentId, studentId } = params;
  return requestTutorProgressApi<ReviewAllAiResponse>(
    `/assignments/${encodeURIComponent(assignmentId)}/students/${encodeURIComponent(studentId)}/review-all-ai`,
    { method: 'POST', body: JSON.stringify({}) },
  );
}

/** Снять подтверждение («открыть проверку обратно»). status НЕ трогает. */
export async function reopenReview(params: {
  assignmentId: string;
  studentId: string;
  taskId: string;
}): Promise<{ ok: true }> {
  const { assignmentId, studentId, taskId } = params;
  return requestTutorProgressApi<{ ok: true }>(
    `/assignments/${encodeURIComponent(assignmentId)}/students/${encodeURIComponent(studentId)}/reopen-review`,
    { method: 'POST', body: JSON.stringify({ task_id: taskId }) },
  );
}

// ─── R2: успеваемость + страница ученика ───────────────────────────────────────

export type ProgressTrack = 'ege' | 'oge' | 'school';
export type ProgressScoreKind = 'primary' | 'ege_scaled' | 'oge_grade' | 'school_grade';

export interface ProgressOverviewSignals {
  /** Кол-во сданных работ с непроверенным AI (мой бэклог проверки). */
  review_backlog: number;
  /** Есть просрочка дедлайна (непроверено/не сдано). */
  overdue: boolean;
  /** Далеко от цели (pct_to_goal < 50). */
  behind_goal: boolean;
  /** Падающая динамика по подтверждённым пробникам. */
  declining: boolean;
}

export interface ProgressOverviewItem {
  student_id: string;
  tutor_student_id: string;
  name: string;
  avatar_url: string | null;
  track: ProgressTrack;
  grade_class: string | null;
  group_id: string | null;
  group_name: string | null;
  /** Нормализ. % к цели по треку (единственная scale-agnostic кросс-метрика). null = нет пробника. */
  pct_to_goal: number | null;
  reviewed_pct: number | null;
  signals: ProgressOverviewSignals;
}

export interface ProgressWorkCell {
  score: number | null;
  max: number;
}

export interface ProgressWork {
  id: string;
  /** Для mock — id попытки; assignment_id отдельно (для drill-down / навигации). */
  assignment_id?: string;
  kind: 'homework' | 'mock';
  title: string;
  subject: string | null;
  date: string;
  created_at: string;
  deadline: string | null;
  overdue: boolean;
  score_kind: ProgressScoreKind;
  /** Сырой балл в родной единице (primary). null если ещё не оценено/не подтверждено. */
  raw: number | null;
  raw_max: number;
  /** Мини-карта задач (цвет = score/max). Для mock — coarse Часть1/Часть2 при reviewed. */
  cells: ProgressWorkCell[];
  reviewed: boolean;
  /** 'verified' | 'review' | 'manual' | 'none'. */
  status: string;
  pending_review_count?: number;
}

export interface StudentProgress {
  student: {
    id: string;
    student_id: string;
    name: string;
    avatar_url: string | null;
    track: ProgressTrack;
    grade_class: string | null;
  };
  target: { track: ProgressTrack; target_score: number | null; scale_year: number };
  works: ProgressWork[];
  summary: {
    done: number;
    total: number;
    reviewed_pct: number | null;
    needs_attention: boolean;
    /** Тестовый балл последнего подтверждённого пробника (Q2). null = нужен пробник. */
    current_level: number | null;
    target: number | null;
    /** Ряд scaled по подтверждённым пробникам (для спарклайна). */
    trend: number[];
  };
}

/** Кросс-ученический обзор «Успеваемость». Только scale-agnostic метрики. */
export async function getStudentsProgressOverview(): Promise<{ items: ProgressOverviewItem[] }> {
  return requestTutorProgressApi<{ items: ProgressOverviewItem[] }>(
    '/students/progress-overview',
    { method: 'GET' },
  );
}

/** Агрегат по одному ученику (все работы в родной шкале). `id` = tutor_students.id. */
export async function getStudentProgress(tutorStudentId: string): Promise<StudentProgress> {
  return requestTutorProgressApi<StudentProgress>(
    `/students/${encodeURIComponent(tutorStudentId)}/progress`,
    { method: 'GET' },
  );
}

/** Обновить цель ученика (пишет tutor_students.target_score + exam_type). */
export async function updateStudentTarget(params: {
  tutorStudentId: string;
  targetScore: number | null;
  track: ProgressTrack;
}): Promise<{ ok: true; target: { track: ProgressTrack; target_score: number | null; scale_year: number } }> {
  const { tutorStudentId, targetScore, track } = params;
  return requestTutorProgressApi(
    `/students/${encodeURIComponent(tutorStudentId)}/target`,
    { method: 'PATCH', body: JSON.stringify({ target_score: targetScore, track }) },
  );
}

// ─── Рефералка v1 (Stage 3 CEO-аналитики, rule 101) ─────────────────────────────

export type ReferralInvitedStage = 'registered' | 'working' | 'value';

export interface ReferralInvitedRow {
  name: string;
  registered_at: string;
  stage: ReferralInvitedStage;
  is_paying: boolean;
}

export interface ReferralsResponse {
  code: string;
  link: string;
  referred_by: { attributed: boolean; referrer_name: string | null };
  invited: ReferralInvitedRow[];
  invited_total: number;
}

/** Кабинет реферера: код + ссылка + список приглашённых (анти-лик: только имя/дата/этап/платит). */
export async function getReferrals(): Promise<ReferralsResponse> {
  return requestTutorProgressApi<ReferralsResponse>('/referrals', { method: 'GET' });
}

/** Новичок вводит код коллеги позже (пока не привязан). 404/409 — русские фразы rule 97. */
export async function claimReferralCode(
  code: string,
): Promise<{ ok: true; referrer_name: string | null }> {
  return requestTutorProgressApi('/referrals/claim', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}

/** Fire-and-forget: клик «Скопировать» в кабинете реферера (повторы легальны). */
export function trackReferralCodeCopied(kind: 'link' | 'text'): void {
  void (async () => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) return;
      await fetch(`${SUPABASE_URL}/functions/v1/tutor-progress-api/track`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          apikey: SUPABASE_KEY,
        },
        body: JSON.stringify({ event: 'referral_code_copied', kind }),
        keepalive: true,
      });
    } catch {
      // best-effort — телеметрия не критична
    }
  })();
}
