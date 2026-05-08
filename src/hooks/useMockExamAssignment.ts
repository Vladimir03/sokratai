// Mock Exams v1 — React Query hook for tutor detail page (TASK-10).
//
// Spec: docs/delivery/features/mock-exams-v1/spec.md AC-5
// Backend: supabase/functions/mock-exam-tutor-api/index.ts → GET /assignments/:id
// Pattern mirrors `useMockExamAssignments` (см. .claude/rules/performance.md
// §2c — все tutor-query keys обязаны начинаться с `['tutor', ...]`).

import { useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getMockExamAssignment } from '@/lib/mockExamApi';
import type { MockExamAssignmentDetail } from '@/types/mockExam';
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
      const hasData = Boolean(data);
      return getTutorBackgroundRefetchInterval(
        hasData,
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
