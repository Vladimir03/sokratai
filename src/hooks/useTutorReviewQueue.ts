import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO, subHours } from 'date-fns';
import { supabase } from '@/lib/supabaseClient';
import { getCurrentTutor } from '@/lib/tutors';
import { getTutorHomeworkResults } from '@/lib/tutorHomeworkApi';
import { isStudentWorkFullyReviewed } from '@/lib/homeworkReview';
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
// Overfetch: фильтр «полностью проверено» дешёвый (task_states), поэтому берём с
// запасом — иначе пачка свежих ПРОВЕРЕННЫХ работ вытеснила бы из выборки старую
// непроверенную, и очередь занижалась бы (code review P1, 2026-06-18). Тяжёлый
// getTutorHomeworkResults дёргаем только для финальных ≤ MAX_REVIEW_ITEMS.
const REVIEW_PREFETCH_THREADS = 60;
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

  // Step 1: completed-треды репетитора в окне 48ч (overfetch — см. REVIEW_PREFETCH_THREADS).
  // Nested !inner — PostgREST dot-path фильтр: только треды чужого assignment отсекаются.
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
    .limit(REVIEW_PREFETCH_THREADS);

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

  const threadIds = rows.map((r) => r.id);
  const prefetchAssignmentIds = Array.from(
    new Set(rows.map((r) => r.homework_tutor_student_assignments.assignment_id)),
  );

  // Step 2: ДЕШЁВЫЙ reviewed-чек по ВСЕМ prefetched тредам (без тяжёлого
  // getTutorHomeworkResults): состояния задач (tutor_reviewed_at +
  // tutor_force_completed_at — force-close считается проверенным, 2026-07-20)
  // + список задач ДЗ.
  const [statesRes, tasksRes] = await Promise.all([
    supabase
      .from('homework_tutor_task_states')
      .select('thread_id, task_id, tutor_reviewed_at, tutor_force_completed_at')
      .in('thread_id', threadIds),
    supabase
      .from('homework_tutor_tasks')
      .select('id, assignment_id')
      .in('assignment_id', prefetchAssignmentIds),
  ]);
  if (statesRes.error) {
    throw new Error(statesRes.error.message ?? 'failed to load review states');
  }
  if (tasksRes.error) {
    throw new Error(tasksRes.error.message ?? 'failed to load tasks for review queue');
  }

  const tasksByAssignment = new Map<string, { task_id: string }[]>();
  for (const t of (tasksRes.data ?? []) as { id: string; assignment_id: string }[]) {
    const list = tasksByAssignment.get(t.assignment_id) ?? [];
    list.push({ task_id: t.id });
    tasksByAssignment.set(t.assignment_id, list);
  }
  const taskScoresByThread = new Map<
    string,
    { task_id: string; tutor_reviewed_at: string | null; tutor_force_completed_at: string | null }[]
  >();
  for (const ts of (statesRes.data ?? []) as {
    thread_id: string;
    task_id: string;
    tutor_reviewed_at: string | null;
    tutor_force_completed_at: string | null;
  }[]) {
    const list = taskScoresByThread.get(ts.thread_id) ?? [];
    list.push({
      task_id: ts.task_id,
      tutor_reviewed_at: ts.tutor_reviewed_at,
      tutor_force_completed_at: ts.tutor_force_completed_at,
    });
    taskScoresByThread.set(ts.thread_id, list);
  }

  // Step 3: dedup по ученику (свежие первыми), пропустить ПОЛНОСТЬЮ проверенные,
  // набрать до MAX_REVIEW_ITEMS кандидатов. Проверенную работу пропускаем БЕЗ
  // отметки seen — чтобы более старая непроверенная работа того же ученика всплыла.
  const candidates: Row[] = [];
  const seenStudents = new Set<string>();
  for (const row of rows) {
    const sa = row.homework_tutor_student_assignments;
    if (seenStudents.has(sa.student_id)) continue;
    const allTasks = tasksByAssignment.get(sa.assignment_id) ?? [];
    const tScores = taskScoresByThread.get(row.id) ?? [];
    if (isStudentWorkFullyReviewed(allTasks, tScores)) continue;
    candidates.push(row);
    seenStudents.add(sa.student_id);
    if (candidates.length >= MAX_REVIEW_ITEMS) break;
  }
  if (candidates.length === 0) return [];

  // Step 4: имена учеников + ТЯЖЁЛЫЕ результаты ТОЛЬКО для кандидатов (≤5 ДЗ).
  type StudentRow = {
    student_id: string;
    display_name: string | null;
    exam_type: string | null;
    profiles: { username: string } | null;
  };
  const candStudentIds = Array.from(
    new Set(candidates.map((r) => r.homework_tutor_student_assignments.student_id)),
  );
  const candAssignmentIds = Array.from(
    new Set(candidates.map((r) => r.homework_tutor_student_assignments.assignment_id)),
  );

  const { data: studentsData, error: studentsError } = await supabase
    .from('tutor_students')
    .select('student_id, display_name, exam_type, profiles ( username )')
    .eq('tutor_id', tutor.id)
    .in('student_id', candStudentIds);
  if (studentsError) {
    throw new Error(studentsError.message ?? 'failed to load students for review queue');
  }
  const studentMap = new Map<string, StudentRow>();
  for (const s of (studentsData ?? []) as unknown as StudentRow[]) {
    studentMap.set(s.student_id, s);
  }

  const resultsByAssignment = new Map<
    string,
    Awaited<ReturnType<typeof getTutorHomeworkResults>>
  >();
  await Promise.all(
    candAssignmentIds.map(async (aid) => {
      try {
        resultsByAssignment.set(aid, await getTutorHomeworkResults(aid));
      } catch (err) {
        console.warn('tutor_home_review_queue_results_failed', {
          assignmentId: aid,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }),
  );

  // Step 5: собрать ReviewItem из кандидатов (фильтр reviewed уже применён в Step 3).
  const items: ReviewItem[] = [];
  for (const row of candidates) {
    const sa = row.homework_tutor_student_assignments;
    const assignment = sa.homework_tutor_assignments;
    const results = resultsByAssignment.get(assignment.id);
    if (!results) continue;

    const perStudent = results.per_student.find((p) => p.student_id === sa.student_id);
    if (!perStudent) continue;

    const student = studentMap.get(sa.student_id);
    const streamKey = (assignment.exam_type ?? student?.exam_type ?? '').toLowerCase();
    const stream = STREAM_LABEL[streamKey] ?? 'ЕГЭ';
    const name =
      student?.display_name?.trim() || student?.profiles?.username?.trim() || 'Ученик';

    const perTaskMap = new Map<string, number>();
    for (const t of results.per_task) {
      perTaskMap.set(t.task_id, t.max_score);
    }

    const orderedTaskScores = [...results.per_task]
      .sort((a, b) => a.order_num - b.order_num)
      .map((t) => {
        const match = perStudent.task_scores.find((ts) => ts.task_id === t.task_id);
        return classifyAnswerRatio(match ? match.final_score : null, t.max_score);
      });

    const warnTasks = perStudent.task_scores.filter((ts) => {
      const max = perTaskMap.get(ts.task_id) ?? 0;
      return classifyAnswerRatio(ts.final_score, max) !== 'ok';
    }).length;

    const aiFlag: ReviewItem['aiFlag'] = perStudent.needs_attention ? 'warn' : 'ok';

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
