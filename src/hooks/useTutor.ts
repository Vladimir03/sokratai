import { useEffect, useMemo, useRef } from 'react';
import { useInfiniteQuery, useQuery, type InfiniteData } from '@tanstack/react-query';
import {
  getCurrentTutor,
  getTutorGroupMemberships,
  getTutorStudents,
  getTutorStudent,
  getMockExams,
  getStudentChats,
  getStudentChatMessages,
  getTutorPayments,
} from '@/lib/tutors';
import {
  getTutorWeeklySlots,
  getTutorLessons,
  getReminderSettings,
  getCalendarSettings,
  getAvailabilityExceptions,
  getTutorPublicInfo,
  getAvailableBookingSlots,
} from '@/lib/tutorSchedule';
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
import type {
  Tutor,
  TutorGroupMembership,
  TutorStudentWithProfile,
  MockExam,
  StudentChat,
  StudentChatMessage,
  TutorPaymentWithStudent,
  TutorWeeklySlot,
  TutorLessonWithStudent,
  TutorReminderSettings,
  TutorCalendarSettings,
  TutorAvailabilityException,
  TutorPublicInfo,
  BookingSlot,
} from '@/types/tutor';
import { useTutorGroups as useTutorGroupsWithMembers } from '@/hooks/useTutorGroups';

type TutorQueryKey = readonly unknown[];

type TutorDiagnostics = {
  loading: boolean;
  error: string | null;
  refetch: () => void;
  isFetching: boolean;
  isRecovering: boolean;
  failureCount: number;
};

type UseTutorQueryParams<TData> = {
  queryKey: TutorQueryKey;
  queryFn: () => Promise<TData>;
  defaultValue: TData;
  errorMessage: string;
  enabled?: boolean;
  hasData?: (data: TData | undefined) => boolean;
};

type UseTutorQueryResult<TData> = {
  data: TData;
} & TutorDiagnostics;

function useTutorQuery<TData>({
  queryKey,
  queryFn,
  defaultValue,
  errorMessage,
  enabled = true,
  hasData,
}: UseTutorQueryParams<TData>): UseTutorQueryResult<TData> {
  const queryKeyText = useMemo(() => tutorQueryKeyToString(queryKey), [queryKey]);

  const query = useQuery<TData, unknown>({
    queryKey,
    queryFn: () => withTutorTimeout(queryKey, queryFn()),
    enabled,
    staleTime: TUTOR_STALE_TIME_MS,
    gcTime: TUTOR_GC_TIME_MS,
    retry: createTutorRetry(queryKey),
    retryDelay: tutorRetryDelay,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: (currentQuery) => {
      const data = currentQuery.state.data as TData | undefined;
      const hasQueryData = hasData ? hasData(data) : data !== undefined && data !== null;
      return getTutorBackgroundRefetchInterval(hasQueryData, Boolean(currentQuery.state.error));
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
    data: query.data ?? defaultValue,
    loading: query.isLoading,
    error: query.error ? toTutorErrorMessage(errorMessage, query.error) : null,
    refetch: () => {
      void query.refetch();
    },
    isFetching: query.isFetching,
    isRecovering,
    failureCount: query.failureCount,
  };
}

export function useTutor() {
  const queryKey = useMemo(() => ['tutor', 'profile'] as const, []);
  const result = useTutorQuery<Tutor | null>({
    queryKey,
    queryFn: getCurrentTutor,
    defaultValue: null,
    errorMessage: 'Не удалось загрузить профиль',
    hasData: (data) => data !== undefined,
  });

  return {
    tutor: result.data,
    loading: result.loading,
    error: result.error,
    refetch: result.refetch,
    isFetching: result.isFetching,
    isRecovering: result.isRecovering,
    failureCount: result.failureCount,
  };
}

export function useTutorStudents() {
  const queryKey = useMemo(() => ['tutor', 'students'] as const, []);
  const result = useTutorQuery<TutorStudentWithProfile[]>({
    queryKey,
    queryFn: getTutorStudents,
    defaultValue: [],
    errorMessage: 'Не удалось загрузить учеников',
    hasData: (data) => data !== undefined,
  });

  return {
    students: result.data,
    loading: result.loading,
    error: result.error,
    refetch: result.refetch,
    isFetching: result.isFetching,
    isRecovering: result.isRecovering,
    failureCount: result.failureCount,
  };
}

export function useTutorGroups(enabled = true) {
  return useTutorGroupsWithMembers(enabled);
}

export function useTutorGroupMemberships(enabled = true) {
  const queryKey = useMemo(() => ['tutor', 'group-memberships'] as const, []);
  const result = useTutorQuery<TutorGroupMembership[]>({
    queryKey,
    queryFn: () => getTutorGroupMemberships(true),
    defaultValue: [],
    errorMessage: 'Не удалось загрузить состав мини-групп',
    enabled,
    hasData: (data) => data !== undefined,
  });

  return {
    memberships: result.data,
    loading: result.loading,
    error: result.error,
    refetch: result.refetch,
    isFetching: result.isFetching,
    isRecovering: result.isRecovering,
    failureCount: result.failureCount,
  };
}

/**
 * Хук для получения одного ученика по ID
 */
export function useTutorStudent(tutorStudentId: string | undefined) {
  const queryKey = useMemo(() => ['tutor', 'student', tutorStudentId ?? 'none'] as const, [tutorStudentId]);
  const result = useTutorQuery<TutorStudentWithProfile | null>({
    queryKey,
    queryFn: () => getTutorStudent(tutorStudentId!),
    defaultValue: null,
    errorMessage: 'Не удалось загрузить данные ученика',
    enabled: Boolean(tutorStudentId),
    hasData: (data) => data !== undefined,
  });

  return {
    student: result.data,
    loading: result.loading,
    error: result.error,
    refetch: result.refetch,
    isFetching: result.isFetching,
    isRecovering: result.isRecovering,
    failureCount: result.failureCount,
  };
}

/**
 * Хук для получения пробников ученика
 */
export function useMockExams(tutorStudentId: string | undefined) {
  const queryKey = useMemo(() => ['tutor', 'student', tutorStudentId ?? 'none', 'mock-exams'] as const, [tutorStudentId]);
  const result = useTutorQuery<MockExam[]>({
    queryKey,
    queryFn: () => getMockExams(tutorStudentId!),
    defaultValue: [],
    errorMessage: 'Не удалось загрузить пробники',
    enabled: Boolean(tutorStudentId),
    hasData: (data) => data !== undefined,
  });

  return {
    mockExams: result.data,
    loading: result.loading,
    error: result.error,
    refetch: result.refetch,
    isFetching: result.isFetching,
    isRecovering: result.isRecovering,
    failureCount: result.failureCount,
  };
}

/**
 * Хук для получения чатов ученика
 */
export function useStudentChats(studentId: string | undefined) {
  const queryKey = useMemo(() => ['tutor', 'student', studentId ?? 'none', 'chats'] as const, [studentId]);
  const result = useTutorQuery<StudentChat[]>({
    queryKey,
    queryFn: () => getStudentChats(studentId!),
    defaultValue: [],
    errorMessage: 'Не удалось загрузить чаты',
    enabled: Boolean(studentId),
    hasData: (data) => data !== undefined,
  });

  return {
    chats: result.data,
    loading: result.loading,
    error: result.error,
    refetch: result.refetch,
    isFetching: result.isFetching,
    isRecovering: result.isRecovering,
    failureCount: result.failureCount,
  };
}

/**
 * Хук для получения сообщений чата
 */
export function useStudentChatMessages(chatId: string | undefined) {
  const pageSize = 50;
  const queryKey = useMemo(() => ['tutor', 'student-chat-messages', chatId ?? 'none'] as const, [chatId]);
  const queryKeyText = useMemo(() => tutorQueryKeyToString(queryKey), [queryKey]);

  const query = useInfiniteQuery({
    queryKey,
    enabled: Boolean(chatId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => withTutorTimeout(queryKey, getStudentChatMessages(chatId!, pageSize, pageParam)),
    getNextPageParam: (lastPage: StudentChatMessage[]) => {
      if (lastPage.length < pageSize) {
        return undefined;
      }
      return lastPage[0]?.created_at;
    },
    staleTime: TUTOR_STALE_TIME_MS,
    gcTime: TUTOR_GC_TIME_MS,
    retry: createTutorRetry(queryKey),
    retryDelay: tutorRetryDelay,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: (currentQuery) => {
      const data = currentQuery.state.data as InfiniteData<StudentChatMessage[], string | undefined> | undefined;
      const hasQueryData = data !== undefined;
      return getTutorBackgroundRefetchInterval(hasQueryData, Boolean(currentQuery.state.error));
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

  const messages = useMemo(() => {
    const pages = query.data?.pages ?? [];
    if (pages.length === 0) {
      return [] as StudentChatMessage[];
    }

    // Older pages are loaded afterwards, so we reverse pages to keep chronological order.
    return [...pages].reverse().flatMap((page) => page);
  }, [query.data]);

  return {
    messages,
    loading: query.isLoading || query.isFetchingNextPage,
    hasMore: Boolean(query.hasNextPage),
    error: query.error ? toTutorErrorMessage('Не удалось загрузить сообщения', query.error) : null,
    loadMore: () => {
      if (query.hasNextPage && !query.isFetchingNextPage) {
        void query.fetchNextPage();
      }
    },
    refetch: () => {
      void query.refetch();
    },
    isFetching: query.isFetching,
    isRecovering,
    failureCount: query.failureCount,
  };
}

/**
 * Хук для получения всех оплат репетитора
 */
export function useTutorPayments() {
  const queryKey = useMemo(() => ['tutor', 'payments'] as const, []);
  const result = useTutorQuery<TutorPaymentWithStudent[]>({
    queryKey,
    queryFn: getTutorPayments,
    defaultValue: [],
    errorMessage: 'Не удалось загрузить оплаты',
    hasData: (data) => data !== undefined,
  });

  return {
    payments: result.data,
    loading: result.loading,
    error: result.error,
    refetch: result.refetch,
    isFetching: result.isFetching,
    isRecovering: result.isRecovering,
    failureCount: result.failureCount,
  };
}

// =============================================
// A1: Хуки для календаря
// =============================================

/**
 * Хук для получения недельных слотов репетитора
 */
export function useTutorWeeklySlots() {
  const queryKey = useMemo(() => ['tutor', 'weekly-slots'] as const, []);
  const result = useTutorQuery<TutorWeeklySlot[]>({
    queryKey,
    queryFn: getTutorWeeklySlots,
    defaultValue: [],
    errorMessage: 'Не удалось загрузить слоты',
    hasData: (data) => data !== undefined,
  });

  return {
    slots: result.data,
    loading: result.loading,
    error: result.error,
    refetch: result.refetch,
    isFetching: result.isFetching,
    isRecovering: result.isRecovering,
    failureCount: result.failureCount,
  };
}

/**
 * Хук для получения занятий за указанную неделю
 */
export function useTutorLessons(weekStartDate: Date) {
  const { startDate, endDate } = useMemo(() => {
    const start = new Date(weekStartDate);
    start.setHours(0, 0, 0, 0);

    const end = new Date(start);
    end.setDate(end.getDate() + 7);

    return {
      startDate: start.toISOString(),
      endDate: end.toISOString(),
    };
  }, [weekStartDate]);

  const queryKey = useMemo(() => ['tutor', 'lessons', startDate, endDate] as const, [startDate, endDate]);
  const result = useTutorQuery<TutorLessonWithStudent[]>({
    queryKey,
    queryFn: () => getTutorLessons(startDate, endDate),
    defaultValue: [],
    errorMessage: 'Не удалось загрузить занятия',
    hasData: (data) => data !== undefined,
  });

  return {
    lessons: result.data,
    loading: result.loading,
    error: result.error,
    refetch: result.refetch,
    isFetching: result.isFetching,
    isRecovering: result.isRecovering,
    failureCount: result.failureCount,
  };
}

/**
 * Хук для настроек напоминаний
 */
export function useTutorReminderSettings() {
  const queryKey = useMemo(() => ['tutor', 'reminder-settings'] as const, []);
  const result = useTutorQuery<TutorReminderSettings | null>({
    queryKey,
    queryFn: getReminderSettings,
    defaultValue: null,
    errorMessage: 'Не удалось загрузить настройки',
    hasData: (data) => data !== undefined,
  });

  return {
    settings: result.data,
    loading: result.loading,
    error: result.error,
    refetch: result.refetch,
    isFetching: result.isFetching,
    isRecovering: result.isRecovering,
    failureCount: result.failureCount,
  };
}

/**
 * Хук для настроек календаря
 */
export function useTutorCalendarSettings() {
  const queryKey = useMemo(() => ['tutor', 'calendar-settings'] as const, []);
  const result = useTutorQuery<TutorCalendarSettings | null>({
    queryKey,
    queryFn: getCalendarSettings,
    defaultValue: null,
    errorMessage: 'Не удалось загрузить настройки календаря',
    hasData: (data) => data !== undefined,
  });

  return {
    settings: result.data,
    loading: result.loading,
    error: result.error,
    refetch: result.refetch,
    isFetching: result.isFetching,
    isRecovering: result.isRecovering,
    failureCount: result.failureCount,
  };
}

/**
 * Хук для исключений доступности
 */
export function useTutorAvailabilityExceptions() {
  const queryKey = useMemo(() => ['tutor', 'availability-exceptions'] as const, []);
  const result = useTutorQuery<TutorAvailabilityException[]>({
    queryKey,
    queryFn: getAvailabilityExceptions,
    defaultValue: [],
    errorMessage: 'Не удалось загрузить исключения',
    hasData: (data) => data !== undefined,
  });

  return {
    exceptions: result.data,
    loading: result.loading,
    error: result.error,
    refetch: result.refetch,
    isFetching: result.isFetching,
    isRecovering: result.isRecovering,
    failureCount: result.failureCount,
  };
}

// =============================================
// Public Booking Hooks
// =============================================

/**
 * Хук для получения публичной информации о репетиторе
 */
export function useTutorPublicInfo(bookingLink: string | undefined) {
  const queryKey = useMemo(() => ['tutor', 'public-info', bookingLink ?? 'none'] as const, [bookingLink]);
  const result = useTutorQuery<TutorPublicInfo | null>({
    queryKey,
    queryFn: () => getTutorPublicInfo(bookingLink!),
    defaultValue: null,
    errorMessage: 'Не удалось загрузить данные репетитора',
    enabled: Boolean(bookingLink),
    hasData: (data) => data !== undefined,
  });

  return {
    tutor: result.data,
    loading: result.loading,
    error: result.error,
    refetch: result.refetch,
    isFetching: result.isFetching,
    isRecovering: result.isRecovering,
    failureCount: result.failureCount,
  };
}

/**
 * Хук для получения доступных слотов для записи
 */
export function useAvailableBookingSlots(bookingLink: string | undefined, daysAhead: number = 7) {
  const queryKey = useMemo(() => ['tutor', 'available-booking-slots', bookingLink ?? 'none', daysAhead] as const, [bookingLink, daysAhead]);
  const result = useTutorQuery<BookingSlot[]>({
    queryKey,
    queryFn: () => getAvailableBookingSlots(bookingLink!, daysAhead),
    defaultValue: [],
    errorMessage: 'Не удалось загрузить доступные слоты',
    enabled: Boolean(bookingLink),
    hasData: (data) => data !== undefined,
  });

  return {
    slots: result.data,
    loading: result.loading,
    error: result.error,
    refetch: result.refetch,
    isFetching: result.isFetching,
    isRecovering: result.isRecovering,
    failureCount: result.failureCount,
  };
}
