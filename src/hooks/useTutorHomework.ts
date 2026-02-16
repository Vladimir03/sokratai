import { useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  listTutorHomeworkAssignments,
  type HomeworkAssignmentsFilter,
  type TutorHomeworkAssignmentListItem,
} from '@/lib/tutorHomeworkApi';
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

export function useTutorHomeworkAssignments(filter: HomeworkAssignmentsFilter = 'all') {
  const queryKey = useMemo(
    () => ['tutor', 'homework', 'assignments', filter] as const,
    [filter],
  );
  const queryKeyText = useMemo(() => tutorQueryKeyToString(queryKey), [queryKey]);

  const query = useQuery<TutorHomeworkAssignmentListItem[], unknown>({
    queryKey,
    queryFn: () =>
      withTutorTimeout(queryKey, listTutorHomeworkAssignments(filter)),
    staleTime: TUTOR_STALE_TIME_MS,
    gcTime: TUTOR_GC_TIME_MS,
    retry: createTutorRetry(queryKey),
    retryDelay: tutorRetryDelay,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: (currentQuery) => {
      const data = currentQuery.state.data;
      const hasData = Array.isArray(data);
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
        queryKey: queryKeyText,
        failureCount: lastFailureCountRef.current,
      });
      wasRecoveringRef.current = false;
      lastFailureCountRef.current = 0;
    }
  }, [isRecovering, query.failureCount, query.isSuccess, queryKeyText]);

  return {
    assignments: query.data ?? [],
    loading: query.isLoading,
    error: query.error
      ? toTutorErrorMessage('Не удалось загрузить домашние задания', query.error)
      : null,
    refetch: () => {
      void query.refetch();
    },
    isFetching: query.isFetching,
    isRecovering,
    failureCount: query.failureCount,
  };
}
