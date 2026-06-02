// Mock Exams v1 — student-side API client.
//
// Backend: supabase/functions/mock-exam-student-api/index.ts
// Spec: docs/delivery/features/mock-exams-v1/spec.md
//
// Anti-leak invariant:
// - In-progress endpoints (taking surface) compile-time не содержат
//   `correct_answer`, `solution_text`, `rubric_text`, `rubric_image_urls`,
//   `ai_draft`.
// - Result endpoint state-aware: post-submit reveal'ит `correct_answer`
//   (Часть 1) — это feedback ученику; post-approval reveal'ит
//   `tutor_score`, `tutor_comment`, `solution_text` (Часть 2). `ai_draft`
//   НИКОГДА не возвращается ученику ни в одной стадии (TASK-5 invariant).

import { supabase } from '@/lib/supabaseClient';
import { extractApiErrorCode, extractApiErrorMessage } from '@/lib/apiErrorMessage';
import type {
  MockExamMode,
  MockExamExamMode,
  MockExamAnswerMethod,
  MockExamAssignmentStatus,
  MockExamAttemptStatus,
  MockExamPart2SolutionStatus,
  MockExamCheckMode,
  MockExamType,
} from '@/types/mockExam';

// HARDCODED — RU bypass (см. src/lib/supabaseClient.ts).
const SUPABASE_URL = 'https://api.sokratai.ru';
const SUPABASE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZyc3Nlb3RyZm1zeHBiY2l5cXpjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk0MjEzMDYsImV4cCI6MjA3NDk5NzMwNn0.fDleU99ULnIvtbiJqlKtgaabZzIWqqw6gZLWQOFAcKw';

export class StudentMockExamApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'StudentMockExamApiError';
  }
}

async function requestStudent<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new StudentMockExamApiError(401, 'UNAUTHORIZED', 'Нет активной сессии');

  const url = `${SUPABASE_URL}/functions/v1/mock-exam-student-api${path}`;
  const baseHeaders = {
    Authorization: `Bearer ${token}`,
    apikey: SUPABASE_KEY,
  };
  // Don't override Content-Type for FormData — browser must set boundary.
  const headers: Record<string, string> = options.body instanceof FormData
    ? { ...baseHeaders, ...(options.headers as Record<string, string> ?? {}) }
    : {
      ...baseHeaders,
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> ?? {}),
    };

  const resp = await fetch(url, { ...options, headers });

  if (!resp.ok) {
    let errorBody: unknown = {};
    try {
      errorBody = await resp.json();
    } catch {
      // Fall through to default.
    }
    const code = extractApiErrorCode(errorBody);
    const message = extractApiErrorMessage(errorBody, `HTTP ${resp.status}`);
    const details = (errorBody as { error?: { details?: unknown } } | null | undefined)?.error?.details;
    throw new StudentMockExamApiError(resp.status, code, message, details);
  }
  return resp.json() as Promise<T>;
}

// ─── Wire types (anti-leak: NO correct_answer / solution_text / ai_draft) ────

export interface StudentMockExamVariantTask {
  id: string;
  kim_number: number;
  part: 1 | 2;
  order_num: number;
  task_text: string;
  task_image_url: string | null;
  check_mode: MockExamCheckMode | null;
  max_score: number;
  topic: string | null;
}

export interface StudentMockExamVariantSummary {
  id: string;
  title: string;
  exam_type: MockExamType;
  duration_minutes: number;
  total_max_score: number;
  part1_max: number;
  part2_max: number;
  task_count: number;
  /** Public URL to PDF with the variant's task list (download for student). */
  variant_pdf_url: string | null;
}

export interface StudentMockExamPart1Saved {
  kim_number: number;
  student_answer: string | null;
  updated_at: string;
}

export interface StudentMockExamPart2Saved {
  kim_number: number;
  /** Browser-facing signed URL (already proxy-rewritten). NULL while no upload. */
  photo_url: string | null;
  status: MockExamPart2SolutionStatus;
  updated_at: string;
}

export interface StudentMockExamAssignmentView {
  assignment: {
    id: string;
    variant_id: string | null;
    title: string;
    mode: MockExamMode;
    deadline: string | null;
    status: MockExamAssignmentStatus;
    /**
     * AC-P10 Phase 2 (PAUSE-7, 2026-05-25): tutor recommendation для start
     * modal. Pre-selected в picker; student override allowed (приоритет
     * student wins, см. `attempt.exam_mode`).
     */
    default_exam_mode: MockExamExamMode;
  };
  variant: StudentMockExamVariantSummary | null;
  tasks: StudentMockExamVariantTask[];
  attempt: {
    id: string;
    status: MockExamAttemptStatus;
    started_at: string | null;
    submitted_at: string | null;
    /** Per-attempt student choice (TASK-10). NULL = student hasn't picked yet → modal. */
    answer_method: MockExamAnswerMethod | null;
    /** ФИПИ-бланк photo (signed URL). Used in answer_method='blank' as primary upload. */
    blank_photo_url: string | null;
    /** Fallback Часть 1 photo (signed URL) — для случая когда ученик не на ФИПИ бланке. */
    part1_blank_photo_url: string | null;
    /** Optional bulk Part 2 photos (signed URL array, max 10). Additive to per-task. */
    part2_bulk_photo_urls: string[];
    total_part1_score: number | null;
    total_part2_score: number | null;
    total_score: number | null;
    /**
     * AC-P10 hotfix (2026-05-25 P0 #2 from code review): timer fields для
     * active-time computation. Без них frontend timer считает wall-clock
     * от started_at вместо active time для training mode → после resume
     * через неделю timer показывает «-5 дней».
     */
    exam_mode: MockExamExamMode;
    sessions: Array<{ started_at: string; ended_at: string | null }>;
    total_active_ms: number;
  };
  part1_answers: StudentMockExamPart1Saved[];
  part2_solutions: StudentMockExamPart2Saved[];
}

export interface StartAttemptResponse {
  ok: true;
  attempt_id: string;
  /** AC-P10 (2026-05-25): server-confirmed mode (may differ if student overrode). */
  exam_mode?: MockExamExamMode;
}

/**
 * AC-P10 (2026-05-25): Pause endpoint response. Returns updated attempt
 * state — frontend invalidates query / redirects to list.
 */
export interface PauseAttemptResponse {
  ok: true;
  attempt_id: string;
  status: 'paused';
  total_active_ms: number;
}

/**
 * AC-P10: Resume endpoint response.
 */
export interface ResumeAttemptResponse {
  ok: true;
  attempt_id: string;
  status: 'in_progress';
}

export interface AutosaveAnswerResponse {
  ok: true;
  attempt_id: string;
  kim_number: number;
  saved_at: string;
}

export type UploadPhotoKind = 'part2' | 'blank' | 'part1_fallback' | 'part2_bulk';

export interface UploadPhotoResponse {
  ok: true;
  attempt_id: string;
  kind: UploadPhotoKind;
  kim_number: number | null;
  storage_ref: string;
  signed_url: string | null;
}

export interface SubmitAttemptResponse {
  ok: true;
  attempt_id: string;
  status: MockExamAttemptStatus;
  total_part1_score: number;
  part1_max: number;
  submitted_at: string;
}

// ─── Result view types (post-submit only; state-aware reveal) ───────────────

/** Tutor card whitelist — strict public-safe fields. */
export interface StudentMockExamResultTutor {
  name: string;
  avatar_url: string | null;
}

/**
 * Per-task Часть 1 row, populated post-submit. `correct_answer` revealed for
 * student feedback. `earned_score` computed by deterministic checker on submit.
 */
export interface StudentMockExamResultPart1Answer {
  kim_number: number;
  student_answer: string | null;
  earned_score: number | null;
  correct_answer: string | null;
  max_score: number;
  check_mode: MockExamCheckMode | null;
  /**
   * AC-P11 (2026-05-26): tutor comment к конкретной задаче Часть 1. Если
   * присутствует — ученик видит в Part1Card row под balance. null = нет
   * комментария от tutor'а к этому KIM.
   */
  tutor_comment?: string | null;
}

/**
 * Per-task Часть 2 row. Pre-approval — only photo + status (no AI draft, no
 * tutor scoring). Post-approval — full reveal with `tutor_score`,
 * `tutor_comment`, `solution_text`. `ai_draft_json` НИКОГДА не возвращается.
 */
export interface StudentMockExamResultPart2Solution {
  kim_number: number;
  photo_url: string | null;
  status: MockExamPart2SolutionStatus;
  max_score: number;
  /** Populated only when attempt.status === 'approved'. */
  tutor_score?: number | null;
  /** Populated only when attempt.status === 'approved'. */
  tutor_comment?: string | null;
  /** Populated only when attempt.status === 'approved'. */
  task_text?: string | null;
  /** Populated only when attempt.status === 'approved'. */
  task_image_url?: string | null;
  /** Populated only when attempt.status === 'approved'. */
  solution_text?: string | null;
  /** Populated only when attempt.status === 'approved'. */
  topic?: string | null;
}

export interface StudentMockExamResultView {
  assignment: {
    id: string;
    variant_id: string | null;
    variant_title: string | null;
    title: string;
    mode: MockExamMode;
    deadline: string | null;
    status: MockExamAssignmentStatus;
  };
  tutor: StudentMockExamResultTutor | null;
  variant: StudentMockExamVariantSummary | null;
  attempt: {
    id: string;
    status: MockExamAttemptStatus;
    started_at: string | null;
    submitted_at: string | null;
    total_time_minutes: number | null;
    blank_photo_url: string | null;
    /**
     * TASK-15 (ChatGPT-5.5 review): bulk Часть 2 photos уже Phase 5 -
     * единственный путь upload Часть 2. На result page показываем что
     * ученик загрузил (для verification + post-approval "Твоё решение").
     */
    part2_bulk_photo_urls: string[];
    total_part1_score: number | null;
    total_part2_score: number | null;
    total_score: number | null;
    manual_entered_date: string | null;
    manual_comment: string | null;
  };
  part1_answers: StudentMockExamResultPart1Answer[];
  part2_solutions: StudentMockExamResultPart2Solution[];
}

// ─── API functions ──────────────────────────────────────────────────────────

export async function getStudentMockExam(
  assignmentId: string,
): Promise<StudentMockExamAssignmentView> {
  return requestStudent(`/student/${encodeURIComponent(assignmentId)}`);
}

export async function startMockExamAttempt(
  attemptId: string,
  options?: { exam_mode?: MockExamExamMode },
): Promise<StartAttemptResponse> {
  // AC-P10: exam_mode picker. Server applies override only on first start
  // (sessions=[] && started_at=null). Re-call returns existing mode.
  const body = options?.exam_mode
    ? JSON.stringify({ exam_mode: options.exam_mode })
    : undefined;
  return requestStudent(`/attempts/${encodeURIComponent(attemptId)}/start`, {
    method: 'POST',
    body,
  });
}

/**
 * AC-P10 (2026-05-25): Pause attempt в режиме Тренировка. Останавливает timer,
 * закрывает последнюю активную сессию. Idempotent (повторный call возвращает
 * paused state). Frontend should redirect to /student/mock-exams после success.
 *
 * Throws StudentMockExamApiError(400, 'PAUSE_NOT_ALLOWED') если exam_mode='simulation'.
 */
export async function pauseMockExamAttempt(
  attemptId: string,
): Promise<PauseAttemptResponse> {
  return requestStudent(`/attempts/${encodeURIComponent(attemptId)}/pause`, {
    method: 'POST',
  });
}

/**
 * AC-P10: Resume paused attempt. Append новую active session, status →
 * in_progress. Idempotent.
 *
 * Frontend: после success navigate на /student/mock-exams/:assignmentId
 * (taking page).
 */
export async function resumeMockExamAttempt(
  attemptId: string,
): Promise<ResumeAttemptResponse> {
  return requestStudent(`/attempts/${encodeURIComponent(attemptId)}/resume`, {
    method: 'POST',
  });
}

/** Auto-save single Part 1 answer. Idempotent (upsert). Debounce client-side. */
export async function autosaveMockExamAnswer(
  attemptId: string,
  kimNumber: number,
  answer: string | null,
): Promise<AutosaveAnswerResponse> {
  return requestStudent(`/attempts/${encodeURIComponent(attemptId)}/answer`, {
    method: 'PATCH',
    body: JSON.stringify({ kim_number: kimNumber, answer }),
  });
}

export async function uploadMockExamPart2Photo(
  attemptId: string,
  kimNumber: number,
  file: File,
): Promise<UploadPhotoResponse> {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('kind', 'part2');
  fd.append('kim_number', String(kimNumber));
  return requestStudent(`/attempts/${encodeURIComponent(attemptId)}/photo`, {
    method: 'POST',
    body: fd,
  });
}

export async function uploadMockExamBlankPhoto(
  attemptId: string,
  file: File,
): Promise<UploadPhotoResponse> {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('kind', 'blank');
  return requestStudent(`/attempts/${encodeURIComponent(attemptId)}/photo`, {
    method: 'POST',
    body: fd,
  });
}

/**
 * Upload фото Части 1 «не на ФИПИ бланке» — fallback для ученика который
 * решал на черновике / в тетради. Single photo, перезаписывает предыдущий
 * на ту же attempt. Backend пишет в `attempts.part1_blank_photo_url`.
 */
export async function uploadMockExamPart1FallbackPhoto(
  attemptId: string,
  file: File,
): Promise<UploadPhotoResponse> {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('kind', 'part1_fallback');
  return requestStudent(`/attempts/${encodeURIComponent(attemptId)}/photo`, {
    method: 'POST',
    body: fd,
  });
}

/**
 * Append фото Часть 2 в общий bulk pack (макс 7). Backend re-reads
 * `attempts.part2_bulk_photo_urls` и атомарно append'ит ref. На 7-м
 * фото — 409 BULK_LIMIT_REACHED. Не заменяет per-task photos (UI показывает
 * оба ряда tutor'у в review).
 */
export async function uploadMockExamPart2BulkPhoto(
  attemptId: string,
  file: File,
): Promise<UploadPhotoResponse> {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('kind', 'part2_bulk');
  return requestStudent(`/attempts/${encodeURIComponent(attemptId)}/photo`, {
    method: 'POST',
    body: fd,
  });
}

/**
 * Persist student's per-attempt answer method choice. Idempotent. UI may
 * call repeatedly when user toggles back-and-forth — данные обоих режимов
 * (Часть 1 inputs + ФИПИ бланк photo) сохраняются параллельно.
 */
export async function setMockExamAnswerMethod(
  attemptId: string,
  method: MockExamAnswerMethod,
): Promise<{ ok: true; attempt_id: string; answer_method: MockExamAnswerMethod }> {
  return requestStudent(`/attempts/${encodeURIComponent(attemptId)}/answer-method`, {
    method: 'POST',
    body: JSON.stringify({ method }),
  });
}

export async function getStudentMockExamResult(
  assignmentId: string,
): Promise<StudentMockExamResultView> {
  return requestStudent(
    `/student/${encodeURIComponent(assignmentId)}/result`,
  );
}

export async function submitMockExamAttempt(
  attemptId: string,
): Promise<SubmitAttemptResponse> {
  return requestStudent(`/attempts/${encodeURIComponent(attemptId)}/submit`, {
    method: 'POST',
  });
}
