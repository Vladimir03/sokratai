import { useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getTutorGroupMemberships, getTutorGroups } from '@/lib/tutors';
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
import type { TutorGroup } from '@/types/tutor';

export type TutorGroupMemberRef = {
  tutor_student_id: string;
  is_active: boolean;
};

export type TutorGroupWithMembers = TutorGroup & {
  members: TutorGroupMemberRef[];
};

export async function listActiveGroupsWithMembers(): Promise<TutorGroupWithMembers[]> {
  const [groups, memberships] = await Promise.all([
    getTutorGroups(true),
    getTutorGroupMemberships(true),
  ]);

  const membersByGroupId = new Map<string, TutorGroupMemberRef[]>();
  for (const membership of memberships) {
    const groupId = membership.tutor_group_id;
    if (!groupId) continue;

    const nextMember = {
      tutor_student_id: membership.tutor_student_id,
      is_active: membership.is_active,
    };
    const existingMembers = membersByGroupId.get(groupId);
    if (existingMembers) {
      existingMembers.push(nextMember);
    } else {
      membersByGroupId.set(groupId, [nextMember]);
    }
  }

  return groups.map((group) => ({
    ...group,
    members: membersByGroupId.get(group.id) ?? [],
  }));
}

export function useTutorGroups(enabled = true) {
  const queryKey = useMemo(() => ['tutor', 'groups'] as const, []);
  const queryKeyText = useMemo(() => tutorQueryKeyToString(queryKey), [queryKey]);

  const query = useQuery<TutorGroupWithMembers[], unknown>({
    queryKey,
    queryFn: () => withTutorTimeout(queryKey, listActiveGroupsWithMembers()),
    enabled,
    staleTime: TUTOR_STALE_TIME_MS,
    gcTime: TUTOR_GC_TIME_MS,
    retry: createTutorRetry(queryKey),
    retryDelay: tutorRetryDelay,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: (currentQuery) => {
      const data = currentQuery.state.data as TutorGroupWithMembers[] | undefined;
      return getTutorBackgroundRefetchInterval(data !== undefined, Boolean(currentQuery.state.error));
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

  if (!enabled) {
    return {
      groups: [] as TutorGroupWithMembers[],
      loading: false,
      error: null,
      refetch: () => {},
      isFetching: false,
      isRecovering: false,
      failureCount: 0,
    };
  }

  return {
    groups: query.data ?? [],
    loading: query.isLoading,
    error: query.error ? toTutorErrorMessage('Не удалось загрузить мини-группы', query.error) : null,
    refetch: () => {
      void query.refetch();
    },
    isFetching: query.isFetching,
    isRecovering,
    failureCount: query.failureCount,
  };
}
