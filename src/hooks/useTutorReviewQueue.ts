import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO, subHours } from 'date-fns';
import { supabase } from '@/lib/supabaseClient';
import { getCurrentTutor } from '@/lib/tutors';
import { getTutorHomeworkResults } from '@/lib/tutorHomeworkApi';
import {
  createTutorRetry,
  toTutorErrorMessage,
  TUTOR_GC_TIME_MS,
  tutorRetryDelay,
  withTutorTimeout,
} from '@/hooks/tutorQueryOptions';

/**
 * Review item displayed in the «Требует проверки» block on /tutor/home.
 *
 * Shape matches `spec §5 → ReviewItem`. Review Queue fallback (documented in
 * spec §9 Open Q): source table `homework_tutor_threads` does NOT currently
 * have a `tutor_viewed_at` column, so we use a 48h window on `updated_at` and
 * surface `needs_attention` from handleGetResults as the warning signal.
 * `ai_flag` column does not exist in the schema either — we derive aiFlag
 * purely from `needs_attention` + task-level score breakdown.
 */
export interface ReviewItem {
  id: string;
  name: string;
  stream: 'ЕГЭ' | 'ОГЭ';
  submittedAt: string;
  score: number;
  total: number;
  answers: ('ok' | 'part' | 'miss')[];
  aiFlag: 'ok' | 'warn' | 'unclear';
  aiWarnCount?: number;
  assignmentId: string;
}

const REVIEW_LOOKBACK_HOURS = 48;
const MAX_THREADS_PREFETCH = 10; // pre-limit before enrichment & dedup to 5
const MAX_REVIEW_ITEMS = 5;

const STREAM_LABEL: Record<string, 'ЕГЭ' | 'ОГЭ'> = {
  ege: 'ЕГЭ',
  oge: 'ОГЭ',
};

function classifyAnswerRatio(
  finalScore: number | null | undefined,
  maxScore: number | null | undefined,
): 'ok' | 'part' | 'miss' {
  if (!maxScore || maxScore <= 0) return 'miss';
  if (finalScore == null) return 'miss';
  const ratio = finalScore / maxScore;
  if (ratio >= 0.8) return 'ok';
  if (ratio >= 0.3) return 'part';
  return 'miss';
}

async function fetchReviewQueue(): Promise<ReviewItem[]> {
  const tutor = await getCurrentTutor();
  if (!tutor) return [];

  const tutorUserId = tutor.user_id;
  const cutoff = subHours(new Date(), REVIEW_LOOKBACK_HOURS).toISOString();

  // Step 1: pull completed threads for this tutor within the 48h window. The
  // nested !inner filter relies on PostgREST dot-path filtering — this returns
  // only rows whose joined assignment belongs to the current tutor.
  const { data, error } = await supabase
    .from('homework_tutor_threads')
    .select(`
      id,
      updated_at,
      student_assignment_id,
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
    `)
    .eq('status', 'completed')
    .gte('updated_at', cutoff)
    .eq(
      'homework_tutor_student_assignments.homework_tutor_assignments.tutor_id',
      tutorUserId,
    )
    .order('updated_at', { ascending: false })
    .limit(MAX_THREADS_PREFETCH);

  if (error) {
    throw new Error(error.message ?? 'failed to load review queue');
  }

  type Row = {
    id: string;
    updated_at: string;
    student_assignment_id: string;
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

  const rows = (data ?? []) as unknown as Row[];
  if (rows.length === 0) return [];

  // Step 2: lookup tutor_students for display name + fallback stream per
  // student_id (exam_type on assignment is the primary source, tutor_students
  // is the fallback used only when assignment.exam_type is null).
  const studentIds = Array.from(
    new Set(rows.map((r) => r.homework_tutor_student_assignments.student_id)),
  );
  const { data: studentsData, error: studentsError } = await supabase
    .from('tutor_students')
    .select('student_id, display_name, exam_type, profiles ( username )')
    .eq('tutor_id', tutor.id)
    .in('student_id', studentIds);

  if (studentsError) {
    throw new Error(studentsError.message ?? 'failed to load students for review queue');
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

  // Step 3: fetch aggregated results per unique assignment. Limit = 5 after
  // dedup so the worst case is 10 assignments (pre-limit) in parallel.
  const assignmentIds = Array.from(
    new Set(rows.map((r) => r.homework_tutor_student_assignments.assignment_id)),
  );
  const resultsByAssignment = new Map<
    string,
    Awaited<ReturnType<typeof getTutorHomeworkResults>>
  >();

  // Parallel fetch — each call hits the homework-api edge function and is
  // cached transparently by react-query downstream consumers.
  await Promise.all(
    assignmentIds.map(async (aid) => {
      try {
        const res = await getTutorHomeworkResults(aid);
        resultsByAssignment.set(aid, res);
      } catch (err) {
        console.warn('tutor_home_review_queue_results_failed', {
          assignmentId: aid,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }),
  );

  // Step 4: assemble ReviewItem shape, dedup (prefer latest per student),
  // cap at MAX_REVIEW_ITEMS.
  const items: ReviewItem[] = [];
  const seenStudents = new Set<string>();

  for (const row of rows) {
    const sa = row.homework_tutor_student_assignments;
    const studentId = sa.student_id;
    if (seenStudents.has(studentId)) continue;
    const assignment = sa.homework_tutor_assignments;
    const results = resultsByAssignment.get(assignment.id);
    if (!results) continue;

    const perStudent = results.per_student.find((p) => p.student_id === studentId);
    if (!perStudent) continue;

    const student = studentMap.get(studentId);
    const streamKey =
      (assignment.exam_type ?? student?.exam_type ?? '').toLowerCase();
    const stream = STREAM_LABEL[streamKey] ?? 'ЕГЭ';
    const name =
      student?.display_name?.trim() ||
      student?.profiles?.username?.trim() ||
      'Ученик';

    const perTaskMap = new Map<string, number>();
    for (const t of results.per_task) {
      perTaskMap.set(t.task_id, t.max_score);
    }

    const orderedTaskScores = [...results.per_task]
      .sort((a, b) => a.order_num - b.order_num)
      .map((t) => {
        const match = perStudent.task_scores.find((ts) => ts.task_id === t.task_id);
        return classifyAnswerRatio(
          match ? match.final_score : null,
          t.max_score,
        );
      });

    const warnTasks = perStudent.task_scores.filter((ts) => {
      const max = perTaskMap.get(ts.task_id) ?? 0;
      return classifyAnswerRatio(ts.final_score, max) !== 'ok';
    }).length;

    const aiFlag: ReviewItem['aiFlag'] = perStudent.needs_attention
      ? 'warn'
      : 'ok';

    items.push({
      id: sa.id,
      name,
      stream,
      submittedAt: format(parseISO(row.updated_at), 'dd.MM HH:mm'),
      score: Math.round((perStudent.total_score ?? 0) * 10) / 10,
      total: perStudent.total_max ?? 0,
      answers: orderedTaskScores,
      aiFlag,
      aiWarnCount: aiFlag === 'warn' ? warnTasks : undefined,
      assignmentId: assignment.id,
    });

    seenStudents.add(studentId);
    if (items.length >= MAX_REVIEW_ITEMS) break;
  }

  return items;
}

const QUERY_KEY = ['tutor', 'home', 'review-queue'] as const;

export function useTutorReviewQueue() {
  const queryKey = useMemo(() => QUERY_KEY, []);
  const query = useQuery<ReviewItem[], unknown>({
    queryKey,
    queryFn: () => withTutorTimeout(queryKey, fetchReviewQueue()),
    staleTime: 30_000,
    gcTime: TUTOR_GC_TIME_MS,
    retry: createTutorRetry(queryKey),
    retryDelay: tutorRetryDelay,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  return {
    items: query.data ?? [],
    loading: query.isLoading,
    error: query.error
      ? toTutorErrorMessage('Не удалось загрузить очередь проверки', query.error)
      : null,
    refetch: () => {
      void query.refetch();
    },
    isFetching: query.isFetching,
  };
}
