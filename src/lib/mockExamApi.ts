// Mock Exams v1 — tutor-side API client.
//
// Spec: docs/delivery/features/mock-exams-v1/spec.md §5 API
// Backend: supabase/functions/mock-exam-tutor-api/index.ts
//
// Hard-coded SUPABASE_URL — RU bypass через Selectel VPS proxy. См.
// `src/lib/supabaseClient.ts` для rationale.

import { supabase } from '@/lib/supabaseClient';
import type {
  ApproveAllResponse,
  ApproveTaskPayload,
  ApproveTaskResponse,
  CreateInviteLinkPayload,
  CreateMockExamAssignmentPayload,
  CreateMockExamAssignmentResponse,
  MockExamAssignmentDetail,
  MockExamAssignmentListItem,
  MockExamAttemptDetail,
  MockExamInviteLink,
} from '@/types/mockExam';

// HARDCODED — see src/lib/supabaseClient.ts (RU bypass, ignore Lovable auto-env).
const SUPABASE_URL = 'https://api.sokratai.ru';

const SUPABASE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZyc3Nlb3RyZm1zeHBiY2l5cXpjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk0MjEzMDYsImV4cCI6MjA3NDk5NzMwNn0.fDleU99ULnIvtbiJqlKtgaabZzIWqqw6gZLWQOFAcKw';

export class MockExamApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'MockExamApiError';
  }
}

async function requestTutorMockExamApi<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) {
    throw new MockExamApiError(401, 'UNAUTHORIZED', 'Нет активной сессии');
  }

  const url = `${SUPABASE_URL}/functions/v1/mock-exam-tutor-api${path}`;
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
      // Ignore parse error — fall through to default message.
    }
    const code = errorBody?.error?.code ?? 'UNKNOWN';
    const message = errorBody?.error?.message ?? `HTTP ${resp.status}`;
    const details = errorBody?.error?.details;
    throw new MockExamApiError(resp.status, code, message, details);
  }

  return resp.json() as Promise<T>;
}

// ─── Assignments ─────────────────────────────────────────────────────────────

export async function createMockExamAssignment(
  payload: CreateMockExamAssignmentPayload,
): Promise<CreateMockExamAssignmentResponse> {
  return requestTutorMockExamApi('/assignments', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function listMockExamAssignments(): Promise<MockExamAssignmentListItem[]> {
  const resp = await requestTutorMockExamApi<{ items: MockExamAssignmentListItem[] }>(
    '/assignments',
  );
  return resp.items ?? [];
}

export async function getMockExamAssignment(
  assignmentId: string,
): Promise<MockExamAssignmentDetail> {
  return requestTutorMockExamApi(`/assignments/${encodeURIComponent(assignmentId)}`);
}

// ─── Attempts ────────────────────────────────────────────────────────────────

export async function getMockExamAttempt(
  attemptId: string,
): Promise<MockExamAttemptDetail> {
  return requestTutorMockExamApi(`/attempts/${encodeURIComponent(attemptId)}`);
}

export async function approveMockExamTask(
  attemptId: string,
  payload: ApproveTaskPayload,
): Promise<ApproveTaskResponse> {
  return requestTutorMockExamApi(
    `/attempts/${encodeURIComponent(attemptId)}/approve-task`,
    { method: 'POST', body: JSON.stringify(payload) },
  );
}

export async function approveMockExamAll(
  attemptId: string,
): Promise<ApproveAllResponse> {
  return requestTutorMockExamApi(
    `/attempts/${encodeURIComponent(attemptId)}/approve-all`,
    { method: 'POST' },
  );
}

/**
 * TASK-11 — tutor вводит earned_score для одного KIM Часть 1 (blank mode flow).
 * Auto-save per row. Aggregate через `finalizeMockExamPart1`.
 */
export async function setMockExamPart1ManualScore(
  attemptId: string,
  payload: { kim_number: number; earned_score: number },
): Promise<{ ok: true; attempt_id: string; kim_number: number; earned_score: number }> {
  return requestTutorMockExamApi(
    `/attempts/${encodeURIComponent(attemptId)}/part1-manual-score`,
    { method: 'POST', body: JSON.stringify(payload) },
  );
}

/**
 * TASK-11 — пересчитать `total_part1_score` после ручной проверки tutor'ом.
 * Idempotent. Можно вызывать многократно по мере правок.
 */
export async function finalizeMockExamPart1(
  attemptId: string,
): Promise<{ ok: true; attempt_id: string; total_part1_score: number }> {
  return requestTutorMockExamApi(
    `/attempts/${encodeURIComponent(attemptId)}/part1-finalize`,
    { method: 'POST' },
  );
}

// ─── Invite link ─────────────────────────────────────────────────────────────

export async function createMockExamInviteLink(
  assignmentId: string,
  payload: CreateInviteLinkPayload = {},
): Promise<MockExamInviteLink> {
  return requestTutorMockExamApi(
    `/assignments/${encodeURIComponent(assignmentId)}/invite-link`,
    { method: 'POST', body: JSON.stringify(payload) },
  );
}

/**
 * FIX-4b — список публичных invite-links для assignment'а. Сортировка
 * created_at DESC. Используется в TutorMockExamDetail (секция «Публичные
 * ссылки»). Backend column-whitelist: slug, scope, expires_at, created_at,
 * URL генерируется server-side через PUBLIC_APP_URL.
 */
export async function listMockExamInviteLinks(
  assignmentId: string,
): Promise<MockExamInviteLink[]> {
  const resp = await requestTutorMockExamApi<{ items: MockExamInviteLink[] }>(
    `/assignments/${encodeURIComponent(assignmentId)}/invite-links`,
  );
  return resp.items ?? [];
}
