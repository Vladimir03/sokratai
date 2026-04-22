import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  differenceInCalendarDays,
  endOfDay,
  endOfWeek,
  isAfter,
  isBefore,
  parseISO,
  startOfDay,
  startOfWeek,
  subWeeks,
} from 'date-fns';
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
 * Per-student activity snapshot rendered in the «Активность учеников» table
 * on /tutor/home. Matches `spec §5 → StudentActivity`.
 */
export interface StudentActivity {
  id: string;
  name: string;
  stream: 'ЕГЭ' | 'ОГЭ';
  weekly: ('ok' | 'late' | 'part' | 'miss' | 'none')[];
  hwAvg: number | null;
  hwTrend: number[];
  hwAvgDelta: number;
  mockLast: null;
  mockDelta: null;
  attention: boolean;
  attentionReason: string | null;
  /**
   * TASK-10: привязка ученика к tutor-group. null = «Без группы».
   * Fetch через tutor_group_memberships (UNIQUE active per student).
   * Используется в режиме sort='groups' блока StudentsActivityBlock.
   */
  groupId: string | null;
  groupName: string | null;
  groupShortName: string | null;
}

export interface StudentActivityResult {
  items: StudentActivity[];
  totalCount: number;
}

const WEEK_COUNT = 5;
const TREND_WINDOW = 6;
// TASK-9: raised from 20 → 30 for pilot cohort headroom (observed tutors
// with 24+ students were seeing the table truncated at 17 due to the prior
// 15-attention + 5-fill ceiling). ATTENTION_LIMIT kept as a named constant
// for clarity but set equal to MAX_STUDENTS — no secondary truncation.
const MAX_STUDENTS = 30;
const ATTENTION_LIMIT = 30;
const INACTIVE_THRESHOLD_DAYS = 7;
const SCORE_DROP_DELTA = -0.5; // 5-point scale

const STREAM_LABEL: Record<string, 'ЕГЭ' | 'ОГЭ'> = {
  ege: 'ЕГЭ',
  oge: 'ОГЭ',
};

type TutorStudentRow = {
  id: string; // tutor_students.id
  student_id: string;
  display_name: string | null;
  exam_type: string | null;
  status: string | null;
  updated_at: string | null;
  profiles: { username: string } | null;
};

type AssignmentRow = {
  id: string;
  title: string;
  deadline: string | null;
  created_at: string;
};

type StudentAssignmentRow = {
  id: string;
  assignment_id: string;
  student_id: string;
};

type ThreadRow = {
  id: string;
  student_assignment_id: string;
  status: string;
  updated_at: string;
  last_student_message_at: string | null;
};

type TaskStateRow = {
  thread_id: string;
  task_id: string;
  status: string;
  ai_score: number | null;
  earned_score: number | null;
  tutor_score_override: number | null;
  updated_at: string;
};

type TaskRow = {
  id: string;
  assignment_id: string;
  max_score: number;
};

function computeFinalScore(ts: TaskStateRow, maxScore: number): number {
  if (ts.tutor_score_override != null) return ts.tutor_score_override;
  if (ts.earned_score != null) return ts.earned_score;
  if (ts.ai_score != null) return ts.ai_score;
  if (ts.status === 'completed') return maxScore;
  return 0;
}

function averageOrNull(values: number[]): number | null {
  if (values.length === 0) return null;
  const sum = values.reduce((acc, v) => acc + v, 0);
  return sum / values.length;
}

interface WeekBucket {
  start: Date;
  end: Date;
}

function buildLastWeeks(now: Date, count: number): WeekBucket[] {
  const buckets: WeekBucket[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const ref = subWeeks(now, i);
    buckets.push({
      start: startOfWeek(ref, { weekStartsOn: 1 }),
      end: endOfWeek(ref, { weekStartsOn: 1 }),
    });
  }
  return buckets;
}

async function fetchStudentActivity(): Promise<StudentActivityResult> {
  const tutor = await getCurrentTutor();
  if (!tutor) return { items: [], totalCount: 0 };

  const tutorUserId = tutor.user_id;

  // Step 1: tutor's students (canonical) + all their assignments in one go.
  // We do NOT paginate here — tutor cohort is <= 28 students in pilot scope,
  // and we cap downstream work by MAX_STUDENTS.
  // TASK-10: также тянем groups + memberships для режима sort='groups'.
  // Two extra round-trips добавляют ~50–100 ms и только когда groups
  // реально нужны (fetch всегда — даже если tutor не использует groups,
  // query возвращает пустой массив; overhead маргинальный).
  const [studentsRes, assignmentsRes, groupsRes, membershipsRes] = await Promise.all([
    supabase
      .from('tutor_students')
      .select(`
        id,
        student_id,
        display_name,
        exam_type,
        status,
        updated_at,
        profiles ( username )
      `)
      .eq('tutor_id', tutor.id)
      .order('updated_at', { ascending: false }),
    supabase
      .from('homework_tutor_assignments')
      .select('id, title, deadline, created_at')
      .eq('tutor_id', tutorUserId),
    // Groups + memberships — оба ограничены is_active=true. FK на tutor.id.
    // `as any` cast matches the pattern in src/lib/tutors.ts for these
    // tables (not yet in the generated Database types).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('tutor_groups') as any)
      .select('id, name, short_name')
      .eq('tutor_id', tutor.id)
      .eq('is_active', true),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('tutor_group_memberships') as any)
      .select('tutor_student_id, tutor_group_id')
      .eq('tutor_id', tutor.id)
      .eq('is_active', true),
  ]);

  if (studentsRes.error) {
    throw new Error(studentsRes.error.message ?? 'failed to load students');
  }
  if (assignmentsRes.error) {
    throw new Error(assignmentsRes.error.message ?? 'failed to load assignments');
  }
  // Groups/memberships errors не блокируют рендер — если упало, fallback
  // к «Без группы» для всех. Это лучше чем вообще не показать таблицу.
  if (groupsRes.error) {
    console.warn('useTutorStudentActivity: failed to load groups', groupsRes.error.message);
  }
  if (membershipsRes.error) {
    console.warn('useTutorStudentActivity: failed to load group memberships', membershipsRes.error.message);
  }

  const students = (studentsRes.data ?? []) as unknown as TutorStudentRow[];
  const totalCount = students.length;
  if (totalCount === 0) return { items: [], totalCount: 0 };

  // TASK-10: groups lookup — tutor_students.id (`s.id`) → group info.
  // Membership UNIQUE on (tutor_student_id) WHERE is_active=true, так что
  // per student максимум 1 активная группа.
  type GroupRow = { id: string; name: string; short_name: string | null };
  type MembershipRow = { tutor_student_id: string; tutor_group_id: string };
  const groupsRaw = (groupsRes.data ?? []) as unknown as GroupRow[];
  const groupById = new Map(groupsRaw.map((g) => [g.id, g]));
  const groupByStudentId = new Map<string, GroupRow>();
  for (const m of (membershipsRes.data ?? []) as unknown as MembershipRow[]) {
    const g = groupById.get(m.tutor_group_id);
    if (g) groupByStudentId.set(m.tutor_student_id, g);
  }

  const assignments = (assignmentsRes.data ?? []) as AssignmentRow[];
  const assignmentById = new Map(assignments.map((a) => [a.id, a]));
  const assignmentIds = assignments.map((a) => a.id);

  let studentAssignments: StudentAssignmentRow[] = [];
  let threads: ThreadRow[] = [];
  let taskStates: TaskStateRow[] = [];
  let tasks: TaskRow[] = [];

  if (assignmentIds.length > 0) {
    // Step 2: student_assignments + tasks (parallel).
    const [saRes, tasksRes] = await Promise.all([
      supabase
        .from('homework_tutor_student_assignments')
        .select('id, assignment_id, student_id')
        .in('assignment_id', assignmentIds),
      supabase
        .from('homework_tutor_tasks')
        .select('id, assignment_id, max_score')
        .in('assignment_id', assignmentIds),
    ]);
    if (saRes.error) {
      throw new Error(saRes.error.message ?? 'failed to load student assignments');
    }
    if (tasksRes.error) {
      throw new Error(tasksRes.error.message ?? 'failed to load tasks');
    }
    studentAssignments = (saRes.data ?? []) as StudentAssignmentRow[];
    tasks = (tasksRes.data ?? []) as TaskRow[];

    // Step 3: threads + task_states for those SAs.
    const saIds = studentAssignments.map((sa) => sa.id);
    if (saIds.length > 0) {
      const threadsRes = await supabase
        .from('homework_tutor_threads')
        .select('id, student_assignment_id, status, updated_at, last_student_message_at')
        .in('student_assignment_id', saIds);
      if (threadsRes.error) {
        throw new Error(threadsRes.error.message ?? 'failed to load threads');
      }
      threads = (threadsRes.data ?? []) as ThreadRow[];

      const threadIds = threads.map((t) => t.id);
      if (threadIds.length > 0) {
        const tsRes = await supabase
          .from('homework_tutor_task_states')
          .select('thread_id, task_id, status, ai_score, earned_score, tutor_score_override, updated_at')
          .in('thread_id', threadIds);
        if (tsRes.error) {
          throw new Error(tsRes.error.message ?? 'failed to load task states');
        }
        taskStates = (tsRes.data ?? []) as TaskStateRow[];
      }
    }
  }

  // Build lookup indices.
  const taskMaxById = new Map<string, number>();
  const tasksByAssignment = new Map<string, TaskRow[]>();
  for (const t of tasks) {
    taskMaxById.set(t.id, t.max_score);
    const bucket = tasksByAssignment.get(t.assignment_id) ?? [];
    bucket.push(t);
    tasksByAssignment.set(t.assignment_id, bucket);
  }

  const saById = new Map<string, StudentAssignmentRow>();
  for (const sa of studentAssignments) saById.set(sa.id, sa);

  const threadsBySa = new Map<string, ThreadRow>();
  for (const th of threads) threadsBySa.set(th.student_assignment_id, th);

  const taskStatesByThread = new Map<string, TaskStateRow[]>();
  for (const ts of taskStates) {
    const bucket = taskStatesByThread.get(ts.thread_id) ?? [];
    bucket.push(ts);
    taskStatesByThread.set(ts.thread_id, bucket);
  }

  // Per-student reverse index: studentId → SA rows (in order of assignment deadline).
  const saByStudent = new Map<string, StudentAssignmentRow[]>();
  for (const sa of studentAssignments) {
    const bucket = saByStudent.get(sa.student_id) ?? [];
    bucket.push(sa);
    saByStudent.set(sa.student_id, bucket);
  }

  const now = new Date();
  const weekBuckets = buildLastWeeks(now, WEEK_COUNT);
  const inactiveCutoff = startOfDay(
    new Date(now.getTime() - INACTIVE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000),
  );

  const items: StudentActivity[] = [];

  for (const s of students) {
    const studentSas = saByStudent.get(s.student_id) ?? [];

    // Weekly strip: bucket SAs by deadline; priority miss > late > part > ok > none.
    const weekly: StudentActivity['weekly'] = weekBuckets.map((bucket) => {
      const bucketSas = studentSas.filter((sa) => {
        const a = assignmentById.get(sa.assignment_id);
        if (!a?.deadline) return false;
        const d = parseISO(a.deadline);
        return !isBefore(d, bucket.start) && !isAfter(d, bucket.end);
      });
      if (bucketSas.length === 0) return 'none';

      let sawMiss = false;
      let sawLate = false;
      let sawPart = false;
      let sawOk = false;

      for (const sa of bucketSas) {
        const a = assignmentById.get(sa.assignment_id);
        if (!a?.deadline) continue;
        const deadline = parseISO(a.deadline);
        const thread = threadsBySa.get(sa.id);
        if (thread?.status === 'completed') {
          const submitted = parseISO(thread.updated_at);
          if (isAfter(submitted, endOfDay(deadline))) {
            sawLate = true;
          } else {
            sawOk = true;
          }
          continue;
        }
        if (thread) {
          const threadTs = taskStatesByThread.get(thread.id) ?? [];
          const hasProgress = threadTs.some(
            (ts) => ts.status === 'completed',
          );
          if (hasProgress) {
            sawPart = true;
            continue;
          }
        }
        if (isBefore(deadline, now)) {
          sawMiss = true;
        } else {
          // Assignment still open — treat as in-progress bucket only if
          // there is any activity; otherwise keep as 'none' signal.
          if (thread) sawPart = true;
        }
      }

      if (sawMiss) return 'miss';
      if (sawLate) return 'late';
      if (sawPart) return 'part';
      if (sawOk) return 'ok';
      return 'none';
    });

    // hwTrend: last TREND_WINDOW completed threads in chronological order.
    const completedThreads = studentSas
      .map((sa) => ({
        sa,
        thread: threadsBySa.get(sa.id),
        assignment: assignmentById.get(sa.assignment_id),
      }))
      .filter((row) => row.thread?.status === 'completed' && row.assignment)
      .sort((a, b) => {
        const ta = parseISO(a.thread!.updated_at).getTime();
        const tb = parseISO(b.thread!.updated_at).getTime();
        return tb - ta;
      })
      .slice(0, TREND_WINDOW)
      .reverse();

    const trendRatios: number[] = [];
    for (const row of completedThreads) {
      const threadTasks = tasksByAssignment.get(row.sa.assignment_id) ?? [];
      const maxTotal = threadTasks.reduce((sum, t) => sum + t.max_score, 0);
      if (maxTotal <= 0) continue;
      const threadTs = taskStatesByThread.get(row.thread!.id) ?? [];
      const earned = threadTs.reduce((sum, ts) => {
        const max = taskMaxById.get(ts.task_id) ?? 0;
        return sum + computeFinalScore(ts, max);
      }, 0);
      trendRatios.push(Math.max(0, Math.min(1, earned / maxTotal)));
    }

    const hwTrend = trendRatios.map(
      (r) => Math.round(r * 5 * 10) / 10,
    ); // 5-point scale, 1 decimal
    const hwAvg = averageOrNull(hwTrend);

    let hwAvgDelta = 0;
    if (hwTrend.length >= 2) {
      const half = Math.floor(hwTrend.length / 2);
      const recent = hwTrend.slice(-half);
      const prior = hwTrend.slice(0, hwTrend.length - half);
      const recentAvg = averageOrNull(recent) ?? 0;
      const priorAvg = averageOrNull(prior) ?? 0;
      hwAvgDelta = Math.round((recentAvg - priorAvg) * 10) / 10;
    }

    // Attention triggers (priority: overdue > scoreDropping > inactive).
    let attentionReason: string | null = null;

    // 1. overdue
    const overdueSa = studentSas.find((sa) => {
      const a = assignmentById.get(sa.assignment_id);
      if (!a?.deadline) return false;
      const deadline = parseISO(a.deadline);
      if (!isBefore(deadline, now)) return false;
      const thread = threadsBySa.get(sa.id);
      return !thread || thread.status !== 'completed';
    });
    if (overdueSa) {
      const a = assignmentById.get(overdueSa.assignment_id);
      attentionReason = a?.title
        ? `Просрочено ДЗ «${a.title}»`
        : 'Просрочено ДЗ';
    }

    // 2. scoreDropping — only if no overdue already claimed the slot.
    if (!attentionReason && hwAvgDelta < SCORE_DROP_DELTA) {
      attentionReason = 'Падает балл';
    }

    // 3. inactive — 7+ days since last activity from student.
    if (!attentionReason) {
      const lastActivityStrings = studentSas
        .flatMap((sa) => {
          const thread = threadsBySa.get(sa.id);
          if (!thread) return [];
          const stamps: string[] = [];
          if (thread.last_student_message_at) stamps.push(thread.last_student_message_at);
          if (thread.updated_at) stamps.push(thread.updated_at);
          return stamps;
        })
        .sort();
      const latest = lastActivityStrings[lastActivityStrings.length - 1];
      if (latest) {
        const parsed = parseISO(latest);
        if (isBefore(parsed, inactiveCutoff)) {
          const days = differenceInCalendarDays(now, parsed);
          attentionReason = `Неактивен ${days} дней`;
        }
      } else if (studentSas.length > 0) {
        // No activity at all but has assignments — still inactive.
        attentionReason = 'Неактивен';
      }
    }

    const attention = attentionReason !== null;
    const streamKey = (s.exam_type ?? '').toLowerCase();
    const stream = STREAM_LABEL[streamKey] ?? 'ЕГЭ';
    const name =
      s.display_name?.trim() ||
      s.profiles?.username?.trim() ||
      'Ученик';

    const group = groupByStudentId.get(s.id) ?? null;

    items.push({
      id: s.id,
      name,
      stream,
      weekly,
      hwAvg,
      hwTrend,
      hwAvgDelta,
      mockLast: null,
      mockDelta: null,
      attention,
      attentionReason,
      groupId: group?.id ?? null,
      groupName: group?.name ?? null,
      groupShortName: group?.short_name ?? null,
    });
  }

  // Stable sort per spec: attention desc → hwAvgDelta desc → name asc (AC-9).
  items.sort((a, b) => {
    if (a.attention !== b.attention) return a.attention ? -1 : 1;
    if (a.hwAvgDelta !== b.hwAvgDelta) return b.hwAvgDelta - a.hwAvgDelta;
    return a.name.localeCompare(b.name, 'ru');
  });

  // Cap at MAX_STUDENTS: top ATTENTION_LIMIT by attention + fill remainder by recency.
  const withAttention = items.filter((it) => it.attention).slice(0, ATTENTION_LIMIT);
  const rest = items.filter((it) => !it.attention);
  const combined = [...withAttention, ...rest].slice(0, MAX_STUDENTS);

  return { items: combined, totalCount };
}

const QUERY_KEY = ['tutor', 'home', 'student-activity'] as const;

/**
 * Fetches up to MAX_STUDENTS (30 since TASK-9) students' activity snapshots
 * via a single batched queryFn (~5 parallel supabase queries + 2 group
 * queries since TASK-10). Spec §5 originally mentioned useQueries per
 * student, but batching is strictly less network-heavy and keeps cache
 * invariants simpler. If latency regresses beyond 1.5s at ~30 students we
 * should lift this into a `tutor_home_student_activity()` RPC (Phase 2).
 */
export function useTutorStudentActivity() {
  const queryKey = useMemo(() => QUERY_KEY, []);
  const query = useQuery<StudentActivityResult, unknown>({
    queryKey,
    queryFn: () => withTutorTimeout(queryKey, fetchStudentActivity()),
    staleTime: 60_000,
    gcTime: TUTOR_GC_TIME_MS,
    retry: createTutorRetry(queryKey),
    retryDelay: tutorRetryDelay,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  const data = query.data ?? { items: [], totalCount: 0 };
  return {
    items: data.items,
    totalCount: data.totalCount,
    loading: query.isLoading,
    error: query.error
      ? toTutorErrorMessage('Не удалось загрузить активность учеников', query.error)
      : null,
    refetch: () => {
      void query.refetch();
    },
    isFetching: query.isFetching,
  };
}
