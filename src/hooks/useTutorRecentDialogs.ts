import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { differenceInHours, format, parseISO } from 'date-fns';
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
 * Dialog entry rendered in the «Последние диалоги» block on /tutor/home.
 *
 * Shape matches `spec §5 → DialogItem`. `from` is always 'student' in Phase 1
 * (we only surface latest user messages — tutor-side replies are shown in the
 * assignment detail page, not here).
 */
export interface DialogItem {
  studentId: string;
  name: string;
  stream: 'ЕГЭ' | 'ОГЭ';
  from: 'me' | 'student';
  preview: string;
  at: string;
  hwId: string;
  hwTitle: string;
}

const STREAM_LABEL: Record<string, 'ЕГЭ' | 'ОГЭ'> = {
  ege: 'ЕГЭ',
  oge: 'ОГЭ',
};

const PREFETCH_LIMIT = 50;
const DISPLAY_LIMIT = 5;
const PREVIEW_CHAR_LIMIT = 80;

function buildPreview(content: string | null | undefined, imageUrl: string | null | undefined): string {
  const raw = (content ?? '').trim();
  if (raw.length > 0) {
    return raw.length > PREVIEW_CHAR_LIMIT
      ? `${raw.slice(0, PREVIEW_CHAR_LIMIT).trimEnd()}…`
      : raw;
  }
  // Fallback for image-only messages matches GuidedHomeworkWorkspace placeholders.
  if (imageUrl) return '(фото)';
  return '(вложение)';
}

function formatRelativeShort(tsIso: string): string {
  const parsed = parseISO(tsIso);
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

async function fetchRecentDialogs(): Promise<DialogItem[]> {
  const tutor = await getCurrentTutor();
  if (!tutor) return [];

  const tutorUserId = tutor.user_id;

  // PostgREST doesn't support DISTINCT ON — pre-fetch latest N user messages
  // across the tutor's threads, then dedup client-side by student_id.
  const { data, error } = await supabase
    .from('homework_tutor_thread_messages')
    .select(`
      id,
      content,
      created_at,
      image_url,
      thread_id,
      homework_tutor_threads!inner (
        id,
        homework_tutor_student_assignments!inner (
          id,
          student_id,
          assignment_id,
          homework_tutor_assignments!inner (
            id,
            title,
            tutor_id,
            exam_type
          )
        )
      )
    `)
    .eq('role', 'user')
    .eq(
      'homework_tutor_threads.homework_tutor_student_assignments.homework_tutor_assignments.tutor_id',
      tutorUserId,
    )
    .order('created_at', { ascending: false })
    .limit(PREFETCH_LIMIT);

  if (error) {
    throw new Error(error.message ?? 'failed to load recent dialogs');
  }

  type Row = {
    id: string;
    content: string | null;
    created_at: string;
    image_url: string | null;
    thread_id: string;
    homework_tutor_threads: {
      id: string;
      homework_tutor_student_assignments: {
        id: string;
        student_id: string;
        assignment_id: string;
        homework_tutor_assignments: {
          id: string;
          title: string;
          tutor_id: string;
          exam_type: string | null;
        };
      };
    };
  };

  const rows = (data ?? []) as unknown as Row[];
  if (rows.length === 0) return [];

  const studentIds = Array.from(
    new Set(
      rows.map(
        (r) =>
          r.homework_tutor_threads.homework_tutor_student_assignments.student_id,
      ),
    ),
  );

  const { data: studentsData, error: studentsError } = await supabase
    .from('tutor_students')
    .select('student_id, display_name, exam_type, profiles ( username )')
    .eq('tutor_id', tutor.id)
    .in('student_id', studentIds);

  if (studentsError) {
    throw new Error(
      studentsError.message ?? 'failed to load students for recent dialogs',
    );
  }

  type StudentRow = {
    student_id: string;
    display_name: string | null;
    exam_type: string | null;
    profiles: { username: string } | null;
  };
  const studentMap = new Map<string, StudentRow>();
  for (const s of (studentsData ?? []) as unknown as StudentRow[]) {
    studentMap.set(s.student_id, s);
  }

  // Dedup by student_id — rows already sorted by created_at DESC, so the first
  // occurrence per student is their latest user message.
  const seen = new Set<string>();
  const items: DialogItem[] = [];
  for (const row of rows) {
    const sa = row.homework_tutor_threads.homework_tutor_student_assignments;
    if (seen.has(sa.student_id)) continue;
    seen.add(sa.student_id);

    const assignment = sa.homework_tutor_assignments;
    const student = studentMap.get(sa.student_id);
    const streamKey =
      (assignment.exam_type ?? student?.exam_type ?? '').toLowerCase();
    const stream = STREAM_LABEL[streamKey] ?? 'ЕГЭ';
    const name =
      student?.display_name?.trim() ||
      student?.profiles?.username?.trim() ||
      'Ученик';

    items.push({
      studentId: sa.student_id,
      name,
      stream,
      from: 'student',
      preview: buildPreview(row.content, row.image_url),
      at: formatRelativeShort(row.created_at),
      hwId: assignment.id,
      hwTitle: assignment.title,
    });

    if (items.length >= DISPLAY_LIMIT) break;
  }

  return items;
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
