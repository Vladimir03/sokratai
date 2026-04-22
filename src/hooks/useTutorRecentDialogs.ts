import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { differenceInHours, format, parseISO } from 'date-fns';
import {
  getTutorRecentDialogs,
  type RecentDialogItem,
} from '@/lib/tutorHomeworkApi';
import {
  createTutorRetry,
  toTutorErrorMessage,
  TUTOR_GC_TIME_MS,
  tutorRetryDelay,
  withTutorTimeout,
} from '@/hooks/tutorQueryOptions';

/**
 * Dialog entry rendered in the «Последние диалоги» block on /tutor/home.
 *
 * Phase 1 follow-up (TASK-7): moved from brittle PostgREST nested-join
 * filter to edge function `/recent-dialogs` (service_role) — consistent
 * with handleGetThread / handleGetResults and robust against RLS drift.
 *
 * `at` is a presentation-ready relative string ("14 мин", "вчера 21:40").
 * The raw ISO timestamp lives on the edge function response; we convert
 * here so ChatRow can render without re-parsing.
 */
export interface DialogItem {
  studentId: string;
  name: string;
  stream: 'ЕГЭ' | 'ОГЭ';
  lastAuthor: 'student' | 'tutor' | 'ai';
  unread: boolean;
  preview: string;
  at: string;
  hwId: string;
  hwTitle: string;
}

function formatRelativeShort(tsIso: string): string {
  const parsed = parseISO(tsIso);
  if (Number.isNaN(parsed.getTime())) return '';
  const now = new Date();
  const hoursAgo = differenceInHours(now, parsed);
  if (hoursAgo < 1) {
    const minutes = Math.max(
      1,
      Math.round((now.getTime() - parsed.getTime()) / 60_000),
    );
    return `${minutes} мин`;
  }
  if (hoursAgo < 24) {
    return `${hoursAgo} ч`;
  }
  if (hoursAgo < 48) {
    return `вчера ${format(parsed, 'HH:mm')}`;
  }
  return format(parsed, 'dd.MM');
}

function mapItem(raw: RecentDialogItem): DialogItem {
  return {
    studentId: raw.studentId,
    name: raw.name,
    stream: raw.stream,
    lastAuthor: raw.lastAuthor,
    unread: raw.unread,
    preview: raw.preview,
    at: formatRelativeShort(raw.at),
    hwId: raw.hwId,
    hwTitle: raw.hwTitle,
  };
}

async function fetchRecentDialogs(): Promise<DialogItem[]> {
  const items = await getTutorRecentDialogs();
  return items.map(mapItem);
}

const QUERY_KEY = ['tutor', 'home', 'recent-dialogs'] as const;

export function useTutorRecentDialogs() {
  const queryKey = useMemo(() => QUERY_KEY, []);
  const query = useQuery<DialogItem[], unknown>({
    queryKey,
    queryFn: () => withTutorTimeout(queryKey, fetchRecentDialogs()),
    staleTime: 30_000,
    gcTime: TUTOR_GC_TIME_MS,
    retry: createTutorRetry(queryKey),
    retryDelay: tutorRetryDelay,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  return {
    dialogs: query.data ?? [],
    loading: query.isLoading,
    error: query.error
      ? toTutorErrorMessage('Не удалось загрузить последние диалоги', query.error)
      : null,
    refetch: () => {
      void query.refetch();
    },
    isFetching: query.isFetching,
  };
}
