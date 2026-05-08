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
import type {
  MockExamMode,
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
    let errorBody: { error?: { code?: string; message?: string; details?: unknown } } = {};
    try {
      errorBody = await resp.json();
    } catch {
      // Fall through to default.
    }
    const code = errorBody?.error?.code ?? 'UNKNOWN';
    const message = errorBody?.error?.message ?? `HTTP ${resp.status}`;
    const details = errorBody?.error?.details;
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
  };
  variant: StudentMockExamVariantSummary | null;
  tasks: StudentMockExamVariantTask[];
  attempt: {
    id: string;
    status: MockExamAttemptStatus;
    started_at: string | null;
    submitted_at: string | null;
    blank_photo_url: string | null;
    total_part1_score: number | null;
    total_part2_score: number | null;
    total_score: number | null;
  };
  part1_answers: StudentMockExamPart1Saved[];
  part2_solutions: StudentMockExamPart2Saved[];
}

export interface StartAttemptResponse {
  ok: true;
  attempt_id: string;
}

export interface AutosaveAnswerResponse {
  ok: true;
  attempt_id: string;
  kim_number: number;
  saved_at: string;
}

export interface UploadPhotoResponse {
  ok: true;
  attempt_id: string;
  kind: 'part2' | 'blank';
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
): Promise<StartAttemptResponse> {
  return requestStudent(`/attempts/${encodeURIComponent(attemptId)}/start`, {
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
