// Mock Exams v1 — tutor-side API client.
//
// Spec: docs/delivery/features/mock-exams-v1/spec.md §5 API
// Backend: supabase/functions/mock-exam-tutor-api/index.ts
//
// Hard-coded SUPABASE_URL — RU bypass через Selectel VPS proxy. См.
// `src/lib/supabaseClient.ts` для rationale.

import { supabase } from '@/lib/supabaseClient';
import { extractApiErrorCode, extractApiErrorMessage } from '@/lib/apiErrorMessage';
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
    let errorBody: unknown = {};
    try {
      errorBody = await resp.json();
    } catch {
      // Ignore parse error — fall through to default message.
    }
    const code = extractApiErrorCode(errorBody);
    const message = extractApiErrorMessage(errorBody, `HTTP ${resp.status}`);
    const details = (errorBody as { error?: { details?: unknown } } | null | undefined)?.error?.details;
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

/**
 * TASK-17 (2026-05-17, sprint «Recipient Management»): add students to existing
 * assignment без создания дубликата. Idempotent — backend skip уже-assigned.
 * Returns counts + notification cascade results (push/telegram).
 *
 * `notify=true` (default) → push + telegram per new student (email пока вне scope).
 * `deadline_passed=true` в response — frontend показывает amber toast.
 */
export interface AssignMockExamStudentsPayload {
  student_ids: string[];
  notify: boolean;
}

export interface AssignMockExamStudentsResponse {
  added: number;
  skipped_existing: number;
  deadline_passed: boolean;
  notify: {
    sent_push: number;
    sent_telegram: number;
    failed: number;
    failed_no_channel: number;
  };
}

export async function assignMockExamStudents(
  assignmentId: string,
  payload: AssignMockExamStudentsPayload,
): Promise<AssignMockExamStudentsResponse> {
  return requestTutorMockExamApi(
    `/assignments/${encodeURIComponent(assignmentId)}/assign-students`,
    { method: 'POST', body: JSON.stringify(payload) },
  );
}

/**
 * TASK-17: hard delete пробника целиком. Cascade FK удалит attempts +
 * part1_answers + part2_solutions + public_links. Best-effort storage cleanup.
 *
 * Frontend ОБЯЗАН использовать AlertDialog с strong confirmation для
 * approved/submitted attempts (см. .claude/rules/40-homework-system.md
 * и DeleteMockExamDialog).
 */
export interface DeleteMockExamAssignmentResponse {
  deleted: true;
  attempts_removed: number;
  storage_objects_removed: number;
}

export async function deleteMockExamAssignment(
  assignmentId: string,
): Promise<DeleteMockExamAssignmentResponse> {
  return requestTutorMockExamApi(
    `/assignments/${encodeURIComponent(assignmentId)}`,
    { method: 'DELETE' },
  );
}

// ─── Attempts ────────────────────────────────────────────────────────────────

export async function getMockExamAttempt(
  attemptId: string,
): Promise<MockExamAttemptDetail> {
  return requestTutorMockExamApi(`/attempts/${encodeURIComponent(attemptId)}`);
}

/**
 * TASK-17: remove individual student (attempt) из пробника. Use case:
 * репетитор по ошибке назначил пробник 9-класснику. Cascade FK удалит
 * part1_answers + part2_solutions. Best-effort storage cleanup.
 *
 * Frontend ОБЯЗАН использовать context-aware confirmation:
 * - not_started → neutral copy
 * - in_progress → amber «прогресс пропадёт»
 * - submitted/awaiting_review → strong «работа пропадёт»
 * - approved/manually_entered → red «{score} баллов пропадут навсегда»
 */
export interface DeleteMockExamAttemptResponse {
  deleted: true;
  student_id: string | null;
  attempt_status_at_delete: string;
  storage_objects_removed: number;
}

export async function deleteMockExamAttempt(
  attemptId: string,
): Promise<DeleteMockExamAttemptResponse> {
  return requestTutorMockExamApi(
    `/attempts/${encodeURIComponent(attemptId)}`,
    { method: 'DELETE' },
  );
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
 * Phase 6 (2026-05-15) — tutor вручную привязывает фото из bulk-pack
 * к Часть 2 задачам через select dropdown в TutorMockExamReview.
 * Body: `{ assignments: { kim: [photo_indices], ... } }`. Backend
 * persistит в `ai_draft_json.assigned_photo_indices` per kim.
 *
 * После изменений tutor нажимает «Перепроверить AI» (regradeMockExamPart2)
 * чтобы AI пересчитал баллы с новой привязкой.
 */
export async function assignMockExamPart2Photos(
  attemptId: string,
  payload: { assignments: Record<number, number[]> },
): Promise<{ attempt_id: string; updated_kim_count: number }> {
  return requestTutorMockExamApi(
    `/attempts/${encodeURIComponent(attemptId)}/assign-part2-photos`,
    { method: 'POST', body: JSON.stringify(payload) },
  );
}

/**
 * Phase 6 (2026-05-15) — tutor click «Перепроверить AI». Backend
 * (mock-exam-tutor-api) делает internal service-role call к
 * `mock-exam-grade::handleGrade` который запускает Pass 1 + Pass 2.
 * Tutor preservation invariant: rows со status='tutor_approved' или
 * 'tutor_modified' не перезаписываются.
 */
export async function regradeMockExamPart2(
  attemptId: string,
): Promise<{
  attempt_id: string;
  regraded: boolean;
  latency_ms: number;
  grade_response: unknown;
}> {
  return requestTutorMockExamApi(
    `/attempts/${encodeURIComponent(attemptId)}/regrade-part2`,
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
 *
 * TASK-16: backend теперь INSERT'ит earned_score=0 для KIM без row (где tutor
 * не вводил балл). После finalize result page показывает «0/max» вместо «—».
 */
export async function finalizeMockExamPart1(
  attemptId: string,
): Promise<{ ok: true; attempt_id: string; total_part1_score: number }> {
  return requestTutorMockExamApi(
    `/attempts/${encodeURIComponent(attemptId)}/part1-finalize`,
    { method: 'POST' },
  );
}

/**
 * TASK-16 (2026-05-15) — force-re-run AI Part 1 OCR (Gemini 2.5-pro).
 * Workflow: backend сначала clear'ит ai_part1_ocr_json, потом fire-and-forget
 * call на mock-exam-grade с force_retry_ocr. Tutor refetch'ает attempt через
 * 5-15 секунд → новые OCR values pre-fill inputs в Part1BlankReviewPanel.
 *
 * Status guard: только pre-approval (submitted | ai_checking | awaiting_review).
 * answer_method='blank' и blank_photo_url IS NOT NULL.
 */
export async function retryMockExamPart1OCR(
  attemptId: string,
): Promise<{ ok: true; attempt_id: string; status: 'queued'; message: string }> {
  return requestTutorMockExamApi(
    `/attempts/${encodeURIComponent(attemptId)}/retry-part1-ocr`,
    { method: 'POST' },
  );
}

/**
 * AC-P4 (mock-exams-v1-pilot-polish 2026-05-25) — tutor пересчитывает
 * Часть 1 по обновлённым ФИПИ 2026 partial credit критериям
 * (gradeMultiChoice / gradeOrdered). Use-case: pilot attempts с partial-correct
 * ответами получили binary 0/2 со старым checker'ом, нужно re-grade.
 *
 * Preserves manual tutor edits (`score_source='tutor'`).
 * После пересчёта обновляет `total_part1_score`.
 *
 * Spec: docs/delivery/features/mock-exams-v1-pilot-polish/spec.md AC-P4
 */
export async function recheckMockExamPart1(
  attemptId: string,
): Promise<{
  ok: true;
  attempt_id: string;
  updated_count: number;
  skipped_tutor_count: number;
  skipped_no_change_count: number;
  total_part1_answers: number;
}> {
  return requestTutorMockExamApi(
    `/attempts/${encodeURIComponent(attemptId)}/recheck-part1`,
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
