// Student-progress builder — SHARED между tutor-progress-api (R2 «прогресс ученика»)
// и public-student-report («Отчёт родителю», 2c). Код ВЫНЕСЕН VERBATIM из
// tutor-progress-api/index.ts (handleStudentProgress + helpers) — single source,
// никакого дрейфа между тутор-вью и родительским отчётом (PRD: «реюз R2»).
//
// Anti-leak (spec §5): НИКОГДА не селектим solution_*/rubric_*/ai_score_comment/
// hints. cells = только score/max. Пробник — только агрегаты подтверждённого
// (pre-approval breakdown не отдаётся).

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { computeFinalScore } from "./score-compute.ts";
import { egePrimaryToScaled } from "./score-scales.ts";

export const HW_CONFIRMED_MOCK = new Set(["approved", "manually_entered"]);
export const MOCK_PENDING_REVIEW = new Set(["submitted", "ai_checking", "awaiting_review"]);
export const BEHIND_GOAL_PCT = 50; // % к цели ниже = отстаёт (mirror usp/data.js BEHIND)

/** auth.users.id → tutors.id (FK-конверсия, rule 40). null если нет профиля тутора. */
export async function resolveTutorPkId(
  db: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data } = await db.from("tutors").select("id").eq("user_id", userId)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

export function gradeClass(grade: number | null | undefined, track: string): string | null {
  if (typeof grade === "number" && grade > 0) return `${grade} класс`;
  if (track === "ege") return "11 класс";
  if (track === "oge") return "9 класс";
  return null;
}

export interface HwWorkAgg {
  submitted: boolean;
  pendingReview: boolean;
  reviewed: boolean;
  overdue: boolean;
}

/**
 * Load homework works per (studentId) for a tutor. Returns Map<studentId,
 * HwWorkAgg[]> + raw rows for the per-student detail builder. Batched.
 */
export async function loadHomeworkForStudents(
  db: SupabaseClient,
  tutorUserId: string,
  studentIds: string[],
): Promise<{
  // saId → { assignment_id, student_id }
  saById: Map<string, { assignmentId: string; studentId: string }>;
  // assignment_id → { deadline, title, subject, status, created_at }
  assignmentById: Map<string, { deadline: string | null; title: string; subject: string | null; status: string; created_at: string }>;
  // assignment_id → tasks (ordered) [{id, order_num, max_score}]
  tasksByAssignment: Map<string, { id: string; order_num: number; max_score: number }[]>;
  // threadId → saId, threadId → status
  threadById: Map<string, { saId: string; status: string }>;
  // threadId → task_states[]
  statesByThread: Map<string, { task_id: string; status: string | null; ai_score: number | null; earned_score: number | null; tutor_score_override: number | null; tutor_reviewed_at: string | null }[]>;
}> {
  const empty = {
    saById: new Map(),
    assignmentById: new Map(),
    tasksByAssignment: new Map(),
    threadById: new Map(),
    statesByThread: new Map(),
  };
  if (studentIds.length === 0) return empty as never;

  // Tutor's assignments (ownership via auth.users.id).
  const { data: assignments } = await db
    .from("homework_tutor_assignments")
    .select("id, title, subject, status, deadline, created_at")
    .eq("tutor_id", tutorUserId)
    .in("status", ["active", "closed"]);
  const assignmentIds = (assignments ?? []).map((a) => a.id as string);
  const assignmentById = new Map<string, { deadline: string | null; title: string; subject: string | null; status: string; created_at: string }>();
  for (const a of assignments ?? []) {
    assignmentById.set(a.id as string, {
      deadline: (a.deadline as string | null) ?? null,
      title: (a.title as string) ?? "",
      subject: (a.subject as string | null) ?? null,
      status: (a.status as string) ?? "active",
      created_at: (a.created_at as string) ?? "",
    });
  }
  if (assignmentIds.length === 0) {
    return { ...empty, assignmentById } as never;
  }

  // Student-assignments for these assignments, narrowed to our students.
  const { data: saRows } = await db
    .from("homework_tutor_student_assignments")
    .select("id, assignment_id, student_id")
    .in("assignment_id", assignmentIds)
    .in("student_id", studentIds);
  const saById = new Map<string, { assignmentId: string; studentId: string }>();
  for (const sa of saRows ?? []) {
    saById.set(sa.id as string, {
      assignmentId: sa.assignment_id as string,
      studentId: sa.student_id as string,
    });
  }
  const saIds = [...saById.keys()];

  // Tasks (whitelist — NO solution_*/rubric_*).
  const { data: taskRows } = await db
    .from("homework_tutor_tasks")
    .select("id, assignment_id, order_num, max_score")
    .in("assignment_id", assignmentIds);
  const tasksByAssignment = new Map<string, { id: string; order_num: number; max_score: number }[]>();
  for (const t of taskRows ?? []) {
    const aid = t.assignment_id as string;
    if (!tasksByAssignment.has(aid)) tasksByAssignment.set(aid, []);
    tasksByAssignment.get(aid)!.push({
      id: t.id as string,
      order_num: Number(t.order_num ?? 0),
      max_score: Number(t.max_score ?? 1),
    });
  }
  for (const list of tasksByAssignment.values()) list.sort((a, b) => a.order_num - b.order_num);

  const threadById = new Map<string, { saId: string; status: string }>();
  const statesByThread = new Map<string, { task_id: string; status: string | null; ai_score: number | null; earned_score: number | null; tutor_score_override: number | null; tutor_reviewed_at: string | null }[]>();
  if (saIds.length > 0) {
    const { data: threadRows } = await db
      .from("homework_tutor_threads")
      .select("id, student_assignment_id, status")
      .in("student_assignment_id", saIds);
    for (const th of threadRows ?? []) {
      threadById.set(th.id as string, {
        saId: th.student_assignment_id as string,
        status: (th.status as string) ?? "active",
      });
    }
    const threadIds = [...threadById.keys()];
    if (threadIds.length > 0) {
      const { data: stateRows } = await db
        .from("homework_tutor_task_states")
        .select("thread_id, task_id, status, ai_score, earned_score, tutor_score_override, tutor_reviewed_at")
        .in("thread_id", threadIds);
      for (const s of stateRows ?? []) {
        const tid = s.thread_id as string;
        if (!statesByThread.has(tid)) statesByThread.set(tid, []);
        statesByThread.get(tid)!.push({
          task_id: s.task_id as string,
          status: (s.status as string | null) ?? null,
          ai_score: s.ai_score != null ? Number(s.ai_score) : null,
          earned_score: s.earned_score != null ? Number(s.earned_score) : null,
          tutor_score_override: s.tutor_score_override != null ? Number(s.tutor_score_override) : null,
          tutor_reviewed_at: (s.tutor_reviewed_at as string | null) ?? null,
        });
      }
    }
  }

  return { saById, assignmentById, tasksByAssignment, threadById, statesByThread };
}

/** Per-work homework aggregate signals (submitted/pendingReview/reviewed/overdue). */
export function aggregateHwWork(
  states: { status: string | null; ai_score: number | null; tutor_reviewed_at: string | null }[],
  deadline: string | null,
  threadStatus: string,
): HwWorkAgg {
  const submitted = threadStatus === "completed" ||
    states.some((s) => s.status === "completed" || s.ai_score != null);
  const pendingReview = states.some((s) => s.ai_score != null && s.tutor_reviewed_at == null);
  const reviewed = submitted && !pendingReview &&
    states.some((s) => s.tutor_reviewed_at != null);
  const overdue = deadline != null && Date.parse(deadline) < Date.now() &&
    (!submitted || pendingReview);
  return { submitted, pendingReview, reviewed, overdue };
}

export interface StudentProgressPayload {
  student: {
    id: string;
    student_id: string;
    name: string;
    avatar_url: string | null;
    track: string;
    grade_class: string | null;
  };
  target: { track: string; target_score: number | null; scale_year: number };
  works: Record<string, unknown>[];
  summary: {
    done: number;
    total: number;
    reviewed_pct: number | null;
    needs_attention: boolean;
    current_level: number | null;
    target: number | null;
    trend: number[];
  };
}

/**
 * Агрегат «прогресс ученика» (R2) — VERBATIM из tutor-progress-api::handleStudentProgress
 * (только I/O параметризован: caller резолвит tutorPkId и оборачивает в Response).
 * Возвращает null, если ученик не найден/не принадлежит тутору.
 */
export async function buildStudentProgress(
  db: SupabaseClient,
  tutorUserId: string,
  tutorPkId: string,
  tutorStudentId: string,
): Promise<StudentProgressPayload | null> {
  const { data: ts } = await db
    .from("tutor_students")
    .select("id, student_id, display_name, exam_type, target_score")
    .eq("id", tutorStudentId)
    .eq("tutor_id", tutorPkId)
    .maybeSingle();
  if (!ts) return null;

  const studentId = ts.student_id as string;
  const track = (ts.exam_type as string | null) ?? "ege";
  const targetScore = ts.target_score != null ? Number(ts.target_score) : null;

  const { data: prof } = await db
    .from("profiles")
    .select("full_name, username, avatar_url, grade")
    .eq("id", studentId)
    .maybeSingle();
  const name = (ts.display_name as string | null) ||
    (prof?.full_name as string | null) ||
    (prof?.username && !/^user_/i.test(prof.username as string) ? (prof.username as string) : null) ||
    "Ученик";

  const works: Record<string, unknown>[] = [];

  // ── Homework works ──
  const hw = await loadHomeworkForStudents(db, tutorUserId, [studentId]);
  type HwState = { task_id: string; status: string | null; ai_score: number | null; earned_score: number | null; tutor_score_override: number | null; tutor_reviewed_at: string | null };
  // saId list for this student (all, since loadHomeworkForStudents narrowed to [studentId])
  const saThread = new Map<string, { threadStatus: string; states: HwState[] }>();
  for (const [tid, th] of hw.threadById) {
    saThread.set(th.saId, { threadStatus: th.status, states: hw.statesByThread.get(tid) ?? [] });
  }
  // group sa by assignment for this student
  for (const [saId, sa] of hw.saById) {
    if (sa.studentId !== studentId) continue;
    const assignment = hw.assignmentById.get(sa.assignmentId);
    if (!assignment) continue;
    const tasks = hw.tasksByAssignment.get(sa.assignmentId) ?? [];
    const tinfo = saThread.get(saId) ?? { threadStatus: "active", states: [] as HwState[] };
    const stateByTask = new Map(tinfo.states.map((s) => [s.task_id, s]));
    let raw = 0;
    let rawMax = 0;
    let reviewedCount = 0;
    let pendingReview = 0;
    const cells = tasks.map((t) => {
      rawMax += t.max_score;
      const st = stateByTask.get(t.id);
      const hasSignal = st && (st.status === "completed" || st.ai_score != null || st.tutor_score_override != null);
      const score = hasSignal ? Math.round(computeFinalScore(st!, t.max_score) * 100) / 100 : null;
      if (score != null) raw += score;
      if (st?.tutor_reviewed_at != null) reviewedCount++;
      if (st && st.ai_score != null && st.tutor_reviewed_at == null) pendingReview++;
      return { score, max: t.max_score };
    });
    const total = tasks.length;
    const submitted = tinfo.threadStatus === "completed" ||
      tinfo.states.some((s) => s.status === "completed" || s.ai_score != null);
    const reviewed = total > 0 && reviewedCount === total;
    const anyScore = cells.some((c) => c.score != null);
    const workStatus = !submitted ? "none" : reviewed ? "verified" : pendingReview > 0 ? "review" : "manual";
    const deadline = assignment.deadline;
    works.push({
      id: sa.assignmentId,
      kind: "homework",
      title: assignment.title,
      subject: assignment.subject,
      date: deadline ?? assignment.created_at,
      created_at: assignment.created_at,
      deadline,
      overdue: deadline != null && Date.parse(deadline) < Date.now() && (!submitted || pendingReview > 0),
      score_kind: "primary",
      raw: anyScore ? Math.round(raw * 100) / 100 : null,
      raw_max: rawMax,
      cells,
      reviewed,
      status: workStatus,
      pending_review_count: pendingReview,
    });
  }

  // ── Mock works ──
  const { data: mockAssignments } = await db
    .from("mock_exam_assignments")
    .select("id, variant_id, variant_title, title, deadline, created_at")
    .eq("tutor_id", tutorUserId);
  const mockAssignmentIds = (mockAssignments ?? []).map((a) => a.id as string);
  const mockMetaById = new Map<string, { variant_id: string | null; title: string; deadline: string | null; created_at: string }>();
  for (const a of mockAssignments ?? []) {
    mockMetaById.set(a.id as string, {
      variant_id: (a.variant_id as string | null) ?? null,
      title: (a.title as string) || (a.variant_title as string | null) || "Пробник",
      deadline: (a.deadline as string | null) ?? null,
      created_at: (a.created_at as string) ?? "",
    });
  }
  const variantMeta = new Map<string, { exam_type: string; total_max_score: number; part1_max: number; part2_max: number }>();
  const mvIds = [...new Set((mockAssignments ?? []).map((a) => a.variant_id as string | null).filter(Boolean) as string[])];
  if (mvIds.length > 0) {
    const { data: variants } = await db
      .from("mock_exam_variants")
      .select("id, exam_type, total_max_score, part1_max, part2_max")
      .in("id", mvIds);
    for (const v of variants ?? []) {
      variantMeta.set(v.id as string, {
        exam_type: v.exam_type as string,
        total_max_score: Number(v.total_max_score ?? 45),
        part1_max: Number(v.part1_max ?? 0),
        part2_max: Number(v.part2_max ?? 0),
      });
    }
  }
  const confirmedScaledSeries: { date: number; scaled: number }[] = [];
  if (mockAssignmentIds.length > 0) {
    const { data: attempts } = await db
      .from("mock_exam_attempts")
      .select("id, assignment_id, status, total_score, total_part1_score, total_part2_score, submitted_at, manual_entered_date, created_at")
      .in("assignment_id", mockAssignmentIds)
      .eq("student_id", studentId);
    for (const at of attempts ?? []) {
      const meta = mockMetaById.get(at.assignment_id as string);
      if (!meta) continue;
      const variant = meta.variant_id ? variantMeta.get(meta.variant_id) : null;
      const examType = variant?.exam_type ?? (track === "oge" ? "oge_physics" : "ege_physics");
      const scoreKind = examType === "oge_physics" ? "oge_grade" : "ege_scaled";
      const totalMax = variant?.total_max_score ?? 45;
      const part1Max = variant?.part1_max ?? 0;
      const part2Max = variant?.part2_max ?? 0;
      const totalScore = at.total_score != null ? Number(at.total_score) : null;
      const status = at.status as string;
      const reviewed = HW_CONFIRMED_MOCK.has(status);
      const dateStr = (at.submitted_at as string | null) ?? (at.manual_entered_date as string | null) ?? (at.created_at as string | null);
      const dateMs = dateStr ? Date.parse(dateStr) : 0;
      if (reviewed && scoreKind === "ege_scaled") {
        const scaled = egePrimaryToScaled(totalScore);
        if (scaled != null) confirmedScaledSeries.push({ date: dateMs, scaled });
      }
      // coarse 2-cell mini-map (Часть 1 / Часть 2) — only when reviewed (anti-leak: pre-approval no breakdown)
      const cells = reviewed && (part1Max > 0 || part2Max > 0)
        ? [
          { score: at.total_part1_score != null ? Number(at.total_part1_score) : null, max: part1Max },
          { score: at.total_part2_score != null ? Number(at.total_part2_score) : null, max: part2Max },
        ]
        : [];
      works.push({
        id: at.id,
        assignment_id: at.assignment_id,
        kind: "mock",
        title: meta.title,
        subject: "physics",
        date: dateStr ?? meta.created_at,
        created_at: meta.created_at,
        deadline: meta.deadline,
        overdue: meta.deadline != null && Date.parse(meta.deadline) < Date.now() && MOCK_PENDING_REVIEW.has(status),
        score_kind: scoreKind,
        raw: reviewed ? totalScore : null,
        raw_max: totalMax,
        cells,
        reviewed,
        status: reviewed ? "verified" : MOCK_PENDING_REVIEW.has(status) ? "review" : (status === "in_progress" || status === "paused") ? "none" : "review",
      });
    }
  }

  // Sort works by date desc.
  works.sort((a, b) => Date.parse((b.date as string) || "0") - Date.parse((a.date as string) || "0"));

  // Summary.
  confirmedScaledSeries.sort((a, b) => a.date - b.date);
  const trend = confirmedScaledSeries.map((x) => x.scaled);
  const currentLevel = trend.length > 0 ? trend[trend.length - 1] : null;
  const submittedWorks = works.filter((w) => w.status !== "none").length;
  const reviewedWorks = works.filter((w) => w.reviewed === true).length;
  const reviewedPct = submittedWorks > 0 ? Math.round((reviewedWorks / submittedWorks) * 100) : null;
  const pctToGoal = track === "ege" && currentLevel != null && targetScore && targetScore > 0
    ? Math.max(0, Math.min(100, Math.round((currentLevel / targetScore) * 100)))
    : null;
  const behindGoal = pctToGoal != null && pctToGoal < BEHIND_GOAL_PCT;
  const backlog = works.some((w) => w.status === "review");

  return {
    student: {
      id: tutorStudentId,
      student_id: studentId,
      name,
      avatar_url: (prof?.avatar_url as string | null) ?? null,
      track,
      grade_class: gradeClass(prof?.grade as number | null, track),
    },
    target: { track, target_score: targetScore, scale_year: 2026 },
    works,
    summary: {
      done: submittedWorks,
      total: works.length,
      reviewed_pct: reviewedPct,
      needs_attention: behindGoal || backlog,
      current_level: currentLevel,
      target: targetScore,
      trend,
    },
  };
}
