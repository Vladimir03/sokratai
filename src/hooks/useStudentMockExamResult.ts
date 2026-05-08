// Mock Exams v1 — student result React Query hook (TASK-13).
//
// Spec: docs/delivery/features/mock-exams-v1/spec.md AC-5
// Backend: supabase/functions/mock-exam-student-api/index.ts
//   GET /student/:assignmentId/result
//
// Invalidation: when tutor approves part2 (server-side flips status →
// 'approved' + sends push), student returns via push deep-link → window
// regains focus → react-query refetches by `refetchOnWindowFocus`. Same
// for `awaiting_review` → `approved` transitions while the page is open.

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import {
  getStudentMockExamResult,
  StudentMockExamApiError,
  type StudentMockExamResultView,
} from '@/lib/studentMockExamApi';

export const STUDENT_MOCK_EXAM_RESULT_QUERY_KEY = (assignmentId: string) =>
  ['student', 'mock-exam', 'result', assignmentId] as const;

const STALE_TIME_MS = 30_000;
const GC_TIME_MS = 5 * 60_000;

/**
 * 409 NOT_SUBMITTED → still in progress; result page must redirect.
 * 404 NOT_FOUND → not assigned to this student.
 */
export interface StudentMockExamResultQuery {
  data: StudentMockExamResultView | undefined;
  isLoading: boolean;
  isFetching: boolean;
  error: StudentMockExamApiError | Error | null;
  /** True when backend returns 409 NOT_SUBMITTED — caller should redirect to exam page. */
  isStillInProgress: boolean;
  /** True when backend returns 404 NOT_FOUND. */
  isNotFound: boolean;
  refetch: () => void;
}

export function useStudentMockExamResult(
  assignmentId: string | null | undefined,
): StudentMockExamResultQuery {
  const queryClient = useQueryClient();
  const enabled = typeof assignmentId === 'string' && assignmentId.length > 0;

  const query = useQuery<StudentMockExamResultView, StudentMockExamApiError | Error>({
    queryKey: STUDENT_MOCK_EXAM_RESULT_QUERY_KEY(assignmentId ?? ''),
    queryFn: () => getStudentMockExamResult(assignmentId as string),
    enabled,
    staleTime: STALE_TIME_MS,
    gcTime: GC_TIME_MS,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: (failureCount, err) => {
      // Don't retry deterministic state errors.
      if (err instanceof StudentMockExamApiError) {
        if (err.status === 404 || err.status === 409 || err.status === 401) {
          return false;
        }
      }
      return failureCount < 2;
    },
  });

  const isStillInProgress =
    query.error instanceof StudentMockExamApiError &&
    query.error.status === 409 &&
    query.error.code === 'NOT_SUBMITTED';

  const isNotFound =
    query.error instanceof StudentMockExamApiError && query.error.status === 404;

  const refetch = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: STUDENT_MOCK_EXAM_RESULT_QUERY_KEY(assignmentId ?? ''),
    });
  }, [assignmentId, queryClient]);

  return {
    data: query.data,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    isStillInProgress,
    isNotFound,
    refetch,
  };
}
