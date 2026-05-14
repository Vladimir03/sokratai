// Mock Exams v1 — React Query hook for tutor detail page (TASK-10).
//
// Spec: docs/delivery/features/mock-exams-v1/spec.md AC-5
// Backend: supabase/functions/mock-exam-tutor-api/index.ts → GET /assignments/:id
// Pattern mirrors `useMockExamAssignments` (см. .claude/rules/performance.md
// §2c — все tutor-query keys обязаны начинаться с `['tutor', ...]`).

import { useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getMockExamAssignment } from '@/lib/mockExamApi';
import type {
  MockExamAssignmentDetail,
  MockExamAttemptStatus,
} from '@/types/mockExam';
import {
  createTutorRetry,
  getTutorBackgroundRefetchInterval,
  toTutorErrorMessage,
  tutorQueryKeyToString,
  TUTOR_GC_TIME_MS,
  TUTOR_STALE_TIME_MS,
  tutorRetryDelay,
  withTutorTimeout,
} from '@/hooks/tutorQueryOptions';

export const MOCK_EXAM_ASSIGNMENT_QUERY_KEY = (assignmentId: string) =>
  ['tutor', 'mock-exams', 'assignment', assignmentId] as const;

const MOCK_EXAM_DETAIL_POLLING_INTERVAL_MS = 30_000;

// Non-terminal in-flight statuses that warrant active polling so the tutor
// sees attempts transition (started → submit → AI grading → awaiting review →
// approved) without manual refresh. iOS Safari often skips
// `refetchOnWindowFocus` on in-app tab switches, so polling is the durable
// signal for AC-P2.
//
// `in_progress` is included intentionally (pilot-polish review fix 2026-05-14):
// if the tutor opens the page while the student is still taking the exam, the
// initial fetch caches `attempts: [{status: 'in_progress', …}]`. The student
// then hits «Сдать» → DB attempt becomes 'submitted', but the tutor's cache is
// stale. Without polling on `in_progress` the tutor wouldn't see the submit
// until window-focus or manual refresh — direct AC-P2 violation.
//
// Terminal statuses (`approved`, `manually_entered`) are NOT here — once an
// attempt reaches a terminal state we stop polling that row. If all attempts
// are terminal, polling falls back to `getTutorBackgroundRefetchInterval`.
const POLLING_ATTEMPT_STATUSES: ReadonlySet<MockExamAttemptStatus> = new Set([
  'in_progress',
  'submitted',
  'ai_checking',
  'awaiting_review',
]);

function hasPollingActiveAttempts(
  detail: MockExamAssignmentDetail | undefined,
): boolean {
  return Boolean(
    detail?.attempts?.some((attempt) =>
      POLLING_ATTEMPT_STATUSES.has(attempt.status),
    ),
  );
}

export function useMockExamAssignment(assignmentId: string | null | undefined) {
  const queryKey = useMemo(
    () => MOCK_EXAM_ASSIGNMENT_QUERY_KEY(assignmentId ?? ''),
    [assignmentId],
  );
  const queryKeyText = useMemo(() => tutorQueryKeyToString(queryKey), [queryKey]);

  const query = useQuery<MockExamAssignmentDetail, unknown>({
    queryKey,
    queryFn: () =>
      withTutorTimeout(queryKey, getMockExamAssignment(assignmentId as string)),
    enabled: typeof assignmentId === 'string' && assignmentId.length > 0,
    staleTime: TUTOR_STALE_TIME_MS,
    gcTime: TUTOR_GC_TIME_MS,
    retry: createTutorRetry(queryKey),
    retryDelay: tutorRetryDelay,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: (currentQuery) => {
      const data = currentQuery.state.data;
      if (hasPollingActiveAttempts(data)) {
        return MOCK_EXAM_DETAIL_POLLING_INTERVAL_MS;
      }
      return getTutorBackgroundRefetchInterval(
        Boolean(data),
        Boolean(currentQuery.state.error),
      );
    },
  });

  const isRecovering = query.isFetching && query.failureCount > 0;
  const lastFailureCountRef = useRef(0);
  const wasRecoveringRef = useRef(false);

  useEffect(() => {
    if (query.failureCount > 0) {
      lastFailureCountRef.current = query.failureCount;
    }
    if (isRecovering) {
      wasRecoveringRef.current = true;
      return;
    }
    if (query.isSuccess && wasRecoveringRef.current) {
      console.info('tutor_query_recovered', {
        query: queryKeyText,
        prior_failures: lastFailureCountRef.current,
      });
      wasRecoveringRef.current = false;
      lastFailureCountRef.current = 0;
    }
  }, [isRecovering, query.isSuccess, query.failureCount, queryKeyText]);

  // Debug-only: log on transition OFF → ON of the polling window so we can
  // verify in devtools that conditional 30s polling actually engaged when a
  // student attempt entered submitted/ai_checking/awaiting_review.
  const pollingActive = hasPollingActiveAttempts(query.data);
  const wasPollingActiveRef = useRef(false);
  useEffect(() => {
    if (pollingActive && !wasPollingActiveRef.current) {
      const awaitingCount =
        query.data?.attempts?.filter((attempt) =>
          POLLING_ATTEMPT_STATUSES.has(attempt.status),
        ).length ?? 0;
      console.info('[mock-exam-detail-polling] active=true', {
        assignment_id: assignmentId,
        awaiting_count: awaitingCount,
      });
    }
    wasPollingActiveRef.current = pollingActive;
  }, [pollingActive, assignmentId, query.data]);

  return {
    detail: query.data ?? null,
    loading: query.isLoading,
    error: query.error
      ? toTutorErrorMessage('Не удалось загрузить пробник', query.error)
      : null,
    refetch: () => {
      void query.refetch();
    },
    isFetching: query.isFetching,
    isRecovering,
    failureCount: query.failureCount,
  };
}
