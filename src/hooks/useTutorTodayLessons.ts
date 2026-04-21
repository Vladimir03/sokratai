import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { endOfDay, format, parseISO, startOfDay } from 'date-fns';
import { supabase } from '@/lib/supabaseClient';
import { getCurrentTutor } from '@/lib/tutors';
import {
  createTutorRetry,
  toTutorErrorMessage,
  TUTOR_GC_TIME_MS,
  tutorRetryDelay,
  withTutorTimeout,
} from '@/hooks/tutorQueryOptions';

/**
 * Session scheduled for today, rendered in the «Сегодня» block on /tutor/home.
 *
 * Shape matches `spec §5 → TodaySession`. `stream` is derived from
 * `tutor_students.exam_type`; if unknown we fall back to «ЕГЭ» because the
 * pilot cohort is primarily ЕГЭ repetitors.
 */
export interface TodaySession {
  id: string;
  time: string;
  studentName: string;
  topic: string;
  stream: 'ЕГЭ' | 'ОГЭ';
  lessonId: string;
}

function shortenName(full: string | null | undefined): string {
  if (!full) return 'Ученик';
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  const first = parts[0];
  const lastInitial = parts[parts.length - 1]?.[0] ?? '';
  return lastInitial ? `${first} ${lastInitial.toUpperCase()}.` : first;
}

const STREAM_LABEL: Record<string, 'ЕГЭ' | 'ОГЭ'> = {
  ege: 'ЕГЭ',
  oge: 'ОГЭ',
};

async function fetchTodayLessons(): Promise<TodaySession[]> {
  const tutor = await getCurrentTutor();
  if (!tutor) return [];

  const now = new Date();
  const startIso = startOfDay(now).toISOString();
  const endIso = endOfDay(now).toISOString();

  const { data, error } = await supabase
    .from('tutor_lessons')
    .select(`
      id,
      start_at,
      subject,
      notes,
      lesson_type,
      group_title_snapshot,
      tutor_student_id,
      tutor_students (
        id,
        display_name,
        exam_type,
        subject,
        profiles ( username )
      )
    `)
    .eq('tutor_id', tutor.id)
    .gte('start_at', startIso)
    .lte('start_at', endIso)
    .neq('status', 'cancelled')
    .order('start_at', { ascending: true });

  if (error) {
    throw new Error(error.message ?? 'failed to load today lessons');
  }

  type Row = {
    id: string;
    start_at: string;
    subject: string | null;
    notes: string | null;
    lesson_type: string | null;
    group_title_snapshot: string | null;
    tutor_student_id: string | null;
    tutor_students: {
      id: string;
      display_name: string | null;
      exam_type: string | null;
      subject: string | null;
      profiles: { username: string } | null;
    } | null;
  };

  const rows = (data ?? []) as unknown as Row[];

  return rows.map<TodaySession>((row) => {
    const ts = row.tutor_students;
    const fullName =
      ts?.display_name?.trim() ||
      ts?.profiles?.username?.trim() ||
      row.group_title_snapshot?.trim() ||
      'Ученик';
    const streamKey = (ts?.exam_type ?? '').toLowerCase();
    const stream = STREAM_LABEL[streamKey] ?? 'ЕГЭ';
    const topicParts: string[] = [];
    if (row.subject) topicParts.push(row.subject);
    if (row.notes) topicParts.push(row.notes);
    const topic = topicParts.join(' · ') || 'Занятие';
    return {
      id: row.id,
      lessonId: row.id,
      time: format(parseISO(row.start_at), 'HH:mm'),
      studentName: shortenName(fullName),
      topic,
      stream,
    };
  });
}

const QUERY_KEY = ['tutor', 'home', 'today-lessons'] as const;

/**
 * Returns today's lessons for the currently authenticated tutor. Safe for
 * empty state (no tutor profile → empty array, no lessons → empty array).
 */
export function useTutorTodayLessons() {
  const queryKey = useMemo(() => QUERY_KEY, []);
  const query = useQuery<TodaySession[], unknown>({
    queryKey,
    queryFn: () => withTutorTimeout(queryKey, fetchTodayLessons()),
    staleTime: 60_000,
    gcTime: TUTOR_GC_TIME_MS,
    retry: createTutorRetry(queryKey),
    retryDelay: tutorRetryDelay,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  return {
    sessions: query.data ?? [],
    loading: query.isLoading,
    error: query.error
      ? toTutorErrorMessage('Не удалось загрузить расписание на сегодня', query.error)
      : null,
    refetch: () => {
      void query.refetch();
    },
    isFetching: query.isFetching,
  };
}
