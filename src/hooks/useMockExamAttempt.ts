// Mock Exams v1 — React Query hook for tutor review surface (TASK-11).
//
// Spec: docs/delivery/features/mock-exams-v1/spec.md AC-5
// Backend: supabase/functions/mock-exam-tutor-api/index.ts → GET /attempts/:id
// Pattern mirrors `useMockExamAssignment` (см. .claude/rules/performance.md
// §2c — все tutor-query keys обязаны начинаться с `['tutor', ...]`).

import { useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getMockExamAttempt } from '@/lib/mockExamApi';
import type { MockExamAttemptDetail } from '@/types/mockExam';
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

export const MOCK_EXAM_ATTEMPT_QUERY_KEY = (attemptId: string) =>
  ['tutor', 'mock-exams', 'attempt', attemptId] as const;

export function useMockExamAttempt(attemptId: string | null | undefined) {
  const queryKey = useMemo(
    () => MOCK_EXAM_ATTEMPT_QUERY_KEY(attemptId ?? ''),
    [attemptId],
  );
  const queryKeyText = useMemo(() => tutorQueryKeyToString(queryKey), [queryKey]);

  const query = useQuery<MockExamAttemptDetail, unknown>({
    queryKey,
    queryFn: () =>
      withTutorTimeout(queryKey, getMockExamAttempt(attemptId as string)),
    enabled: typeof attemptId === 'string' && attemptId.length > 0,
    staleTime: TUTOR_STALE_TIME_MS,
    gcTime: TUTOR_GC_TIME_MS,
    retry: createTutorRetry(queryKey),
    retryDelay: tutorRetryDelay,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: (currentQuery) => {
      const data = currentQuery.state.data;
      const hasData = Boolean(data);
      // TASK-OCR-2 Round 2 (2026-05-21): active polling каждые 5 сек когда AI
      // в процессе работы — tutor видит progress без manual refresh. Останавливаем
      // poll когда status переходит в awaiting_review / approved / manually_entered.
      // Защита от runaway polling: эти статусы terminal для AI pipeline.
      const status = data?.status as string | undefined;
      if (status === 'submitted' || status === 'ai_checking') {
        return 5000;
      }
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
    attempt: query.data ?? null,
    loading: query.isLoading,
    error: query.error
      ? toTutorErrorMessage('Не удалось загрузить попытку', query.error)
      : null,
    refetch: () => {
      void query.refetch();
    },
    isFetching: query.isFetching,
    isRecovering,
    failureCount: query.failureCount,
  };
}
