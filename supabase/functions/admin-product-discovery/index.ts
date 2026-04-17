import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ThreadRow {
  id: string;
  student_assignment_id: string;
  status: string;
  created_at: string;
  last_student_message_at: string | null;
}

interface MessageRow {
  thread_id: string;
  role: string;
  message_kind: string | null;
  visible_to_student: boolean;
  created_at: string;
}

interface TaskStateRow {
  thread_id: string;
  status: string;
  attempts: number;
  hint_count: number;
  earned_score: number | null;
  ai_score: number | null;
  updated_at: string;
}

interface AssignmentRow {
  id: string;
  tutor_id: string;
  title: string;
}

interface SARow {
  id: string;
  assignment_id: string;
  student_id: string;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function fmtDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return "—";
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem > 0 ? `${h}ч ${rem}мин` : `${h}ч`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const { data: isAdmin } = await supabaseAdmin.rpc("is_admin", { _user_id: user.id });
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let body: { startDate?: string; endDate?: string; tutorId?: string } = {};
    try {
      body = await req.json();
    } catch {
      // empty body OK
    }

    const now = new Date();
    const endDate = body.endDate ? new Date(body.endDate + "T23:59:59.999Z") : now;
    const startDate = body.startDate
      ? new Date(body.startDate + "T00:00:00.000Z")
      : new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const tutorFilter = body.tutorId ?? null;

    const startDateStr = startDate.toISOString();
    const endDateStr = endDate.toISOString();

    // ===== Assignments (optionally filtered by tutor) =====
    let assignmentsQuery = supabaseAdmin
      .from("homework_tutor_assignments")
      .select("id, tutor_id, title");
    if (tutorFilter) {
      assignmentsQuery = assignmentsQuery.eq("tutor_id", tutorFilter);
    }
    const { data: assignments } = await assignmentsQuery;
    const assignmentRows: AssignmentRow[] = assignments ?? [];

    if (assignmentRows.length === 0) {
      return new Response(
        JSON.stringify(emptyResponse(startDateStr, endDateStr)),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const assignmentIds = assignmentRows.map((a) => a.id);
    const assignmentToTutor = new Map<string, string>();
    const assignmentTitle = new Map<string, string>();
    assignmentRows.forEach((a) => {
      assignmentToTutor.set(a.id, a.tutor_id);
      assignmentTitle.set(a.id, a.title);
    });

    // ===== Student assignments =====
    const { data: sas } = await supabaseAdmin
      .from("homework_tutor_student_assignments")
      .select("id, assignment_id, student_id")
      .in("assignment_id", assignmentIds);
    const saRows: SARow[] = sas ?? [];
    const saToAssignment = new Map<string, string>();
    const saToStudent = new Map<string, string>();
    saRows.forEach((s) => {
      saToAssignment.set(s.id, s.assignment_id);
      saToStudent.set(s.id, s.student_id);
    });
    const saIds = saRows.map((s) => s.id);

    if (saIds.length === 0) {
      return new Response(
        JSON.stringify(emptyResponse(startDateStr, endDateStr)),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ===== Threads in window (created OR active in window) =====
    // Use threads with last_student_message_at OR created_at intersecting window
    const { data: threads } = await supabaseAdmin
      .from("homework_tutor_threads")
      .select("id, student_assignment_id, status, created_at, last_student_message_at")
      .in("student_assignment_id", saIds)
      .or(`and(created_at.gte.${startDateStr},created_at.lte.${endDateStr}),and(last_student_message_at.gte.${startDateStr},last_student_message_at.lte.${endDateStr})`);
    const threadRows: ThreadRow[] = threads ?? [];

    if (threadRows.length === 0) {
      return new Response(
        JSON.stringify(emptyResponse(startDateStr, endDateStr)),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const threadIds = threadRows.map((t) => t.id);
    const threadToSA = new Map<string, string>();
    const threadToStatus = new Map<string, string>();
    const threadToCreatedAt = new Map<string, string>();
    const threadToLastStudent = new Map<string, string | null>();
    threadRows.forEach((t) => {
      threadToSA.set(t.id, t.student_assignment_id);
      threadToStatus.set(t.id, t.status);
      threadToCreatedAt.set(t.id, t.created_at);
      threadToLastStudent.set(t.id, t.last_student_message_at);
    });

    // ===== Messages in window =====
    const { data: messages } = await supabaseAdmin
      .from("homework_tutor_thread_messages")
      .select("thread_id, role, message_kind, visible_to_student, created_at")
      .in("thread_id", threadIds)
      .gte("created_at", startDateStr)
      .lte("created_at", endDateStr);
    const messageRows: MessageRow[] = messages ?? [];

    // ===== Task states =====
    const { data: taskStates } = await supabaseAdmin
      .from("homework_tutor_task_states")
      .select("thread_id, status, attempts, hint_count, earned_score, ai_score, updated_at")
      .in("thread_id", threadIds);
    const taskStateRows: TaskStateRow[] = taskStates ?? [];

    // ===== Aggregate =====
    const startedThreads = new Set<string>();
    const firstStudentAction = new Map<string, string>(); // thread -> ISO ts
    const tutorIntervention = new Set<string>();

    messageRows.forEach((m) => {
      if (m.role === "user" && (m.message_kind == null || m.message_kind !== "system")) {
        startedThreads.add(m.thread_id);
        const cur = firstStudentAction.get(m.thread_id);
        if (!cur || m.created_at < cur) {
          firstStudentAction.set(m.thread_id, m.created_at);
        }
      }
      if (m.role === "tutor" && m.visible_to_student === true) {
        tutorIntervention.add(m.thread_id);
      }
    });

    // Per-thread task aggregates
    const threadTaskAgg = new Map<
      string,
      {
        hasCompleted: boolean;
        hasProgress: boolean;
        totalHints: number;
        totalAttempts: number;
        firstProgressAt: string | null;
      }
    >();
    taskStateRows.forEach((ts) => {
      const cur = threadTaskAgg.get(ts.thread_id) ?? {
        hasCompleted: false,
        hasProgress: false,
        totalHints: 0,
        totalAttempts: 0,
        firstProgressAt: null as string | null,
      };
      if (ts.status === "completed") cur.hasCompleted = true;
      const isProgress =
        (ts.attempts ?? 0) > 0 ||
        (ts.hint_count ?? 0) > 0 ||
        ts.earned_score != null ||
        ts.ai_score != null ||
        ts.status === "completed";
      if (isProgress) {
        cur.hasProgress = true;
        if (!cur.firstProgressAt || ts.updated_at < cur.firstProgressAt) {
          cur.firstProgressAt = ts.updated_at;
        }
      }
      cur.totalHints += ts.hint_count ?? 0;
      cur.totalAttempts += ts.attempts ?? 0;
      threadTaskAgg.set(ts.thread_id, cur);
    });

    const meaningfulThreads = new Set<string>();
    const completedThreads = new Set<string>();
    startedThreads.forEach((tid) => {
      const status = threadToStatus.get(tid);
      const agg = threadTaskAgg.get(tid);
      if (status === "completed") completedThreads.add(tid);
      if (status === "completed" || agg?.hasCompleted || agg?.hasProgress) {
        meaningfulThreads.add(tid);
      }
    });

    // Partial useful = meaningful but not completed
    const partialMeaningful = new Set<string>();
    meaningfulThreads.forEach((tid) => {
      const status = threadToStatus.get(tid);
      const agg = threadTaskAgg.get(tid);
      if (status !== "completed" && !agg?.hasCompleted) {
        partialMeaningful.add(tid);
      }
    });

    // ===== Headline metrics =====
    const startedCount = startedThreads.size;
    const allThreadCount = threadRows.length;
    const meaningfulCount = meaningfulThreads.size;
    const completedCount = completedThreads.size;
    const partialCount = partialMeaningful.size;
    const interventionCount = Array.from(tutorIntervention).filter((tid) => startedThreads.has(tid)).length;
    const interventionInMeaningful = Array.from(tutorIntervention).filter((tid) => meaningfulThreads.has(tid)).length;

    // Needs attention rules (any of)
    const NOW_MS = Date.now();
    const needsAttentionThreads: string[] = [];
    const attentionReasons = new Map<string, string[]>();
    startedThreads.forEach((tid) => {
      const reasons: string[] = [];
      const agg = threadTaskAgg.get(tid);
      const status = threadToStatus.get(tid);
      const isCompleted = status === "completed" || agg?.hasCompleted;
      const startedAt = firstStudentAction.get(tid);
      const startedMs = startedAt ? new Date(startedAt).getTime() : null;

      if (!meaningfulThreads.has(tid) && startedMs && NOW_MS - startedMs >= 24 * 3600 * 1000) {
        reasons.push("Старт > 24ч без прогресса");
      }
      if ((agg?.totalHints ?? 0) >= 3 && !isCompleted) {
        reasons.push("Много подсказок без завершения");
      }
      if (tutorIntervention.has(tid)) {
        reasons.push("Уже потребовалось вмешательство");
      }
      if ((agg?.totalAttempts ?? 0) >= 5 && !isCompleted) {
        reasons.push("Много попыток без завершения");
      }
      if (reasons.length > 0) {
        needsAttentionThreads.push(tid);
        attentionReasons.set(tid, reasons);
      }
    });

    // Time to meaningful (seconds)
    const ttmList: number[] = [];
    meaningfulThreads.forEach((tid) => {
      const startedAt = firstStudentAction.get(tid);
      const agg = threadTaskAgg.get(tid);
      const meaningfulAt = agg?.firstProgressAt ?? threadToLastStudent.get(tid) ?? null;
      if (startedAt && meaningfulAt) {
        const diff = (new Date(meaningfulAt).getTime() - new Date(startedAt).getTime()) / 1000;
        if (diff >= 0) ttmList.push(diff);
      }
    });
    const ttmMedianSec = median(ttmList);

    // ===== Pattern buckets =====
    const successBuckets = computeSuccessBuckets(meaningfulThreads, threadTaskAgg, tutorIntervention, threadToStatus);
    const failureBuckets = computeFailureBuckets(startedThreads, meaningfulThreads, threadTaskAgg, tutorIntervention, threadToStatus);

    // ===== Morning Review Queue: top 30 by severity × recency =====
    // Resolve names
    const tutorIds = new Set<string>();
    const studentIds = new Set<string>();
    needsAttentionThreads.forEach((tid) => {
      const sa = threadToSA.get(tid);
      if (!sa) return;
      const aId = saToAssignment.get(sa);
      const sId = saToStudent.get(sa);
      if (aId) {
        const tutId = assignmentToTutor.get(aId);
        if (tutId) tutorIds.add(tutId);
      }
      if (sId) studentIds.add(sId);
    });
    const profileIds = Array.from(new Set([...tutorIds, ...studentIds]));
    const { data: profiles } = profileIds.length
      ? await supabaseAdmin.from("profiles").select("id, username").in("id", profileIds)
      : { data: [] as { id: string; username: string | null }[] };
    const nameMap = new Map<string, string>();
    (profiles ?? []).forEach((p: { id: string; username: string | null }) => {
      nameMap.set(p.id, p.username ?? "—");
    });

    const queue = needsAttentionThreads.map((tid) => {
      const sa = threadToSA.get(tid);
      const aId = sa ? saToAssignment.get(sa) : null;
      const sId = sa ? saToStudent.get(sa) : null;
      const tutId = aId ? assignmentToTutor.get(aId) : null;
      const agg = threadTaskAgg.get(tid);
      const lastActivity = threadToLastStudent.get(tid) ?? firstStudentAction.get(tid) ?? threadToCreatedAt.get(tid) ?? null;
      const reasons = attentionReasons.get(tid) ?? [];
      const severity = reasons.length;
      const recencyMs = lastActivity ? new Date(lastActivity).getTime() : 0;
      return {
        threadId: tid,
        tutorName: tutId ? nameMap.get(tutId) ?? "—" : "—",
        studentName: sId ? nameMap.get(sId) ?? "—" : "—",
        assignmentTitle: aId ? assignmentTitle.get(aId) ?? "—" : "—",
        status: threadToStatus.get(tid) ?? "—",
        lastStudentActivity: lastActivity,
        totalHints: agg?.totalHints ?? 0,
        totalAttempts: agg?.totalAttempts ?? 0,
        tutorIntervened: tutorIntervention.has(tid),
        attentionReasons: reasons,
        _severity: severity,
        _recency: recencyMs,
      };
    });

    queue.sort((a, b) => {
      if (b._severity !== a._severity) return b._severity - a._severity;
      return b._recency - a._recency;
    });
    const morningReview = queue.slice(0, 30).map(({ _severity, _recency, ...rest }) => rest);

    // ===== Tutor list for filter (cohort with any threads) =====
    const tutorOptionIds = new Set<string>();
    threadRows.forEach((t) => {
      const aId = saToAssignment.get(t.student_assignment_id);
      if (aId) {
        const tid = assignmentToTutor.get(aId);
        if (tid) tutorOptionIds.add(tid);
      }
    });
    const optTutorIds = Array.from(tutorOptionIds);
    const { data: tutorProfiles } = optTutorIds.length
      ? await supabaseAdmin.from("profiles").select("id, username").in("id", optTutorIds)
      : { data: [] as { id: string; username: string | null }[] };
    const tutorOptions = (tutorProfiles ?? []).map((p: { id: string; username: string | null }) => ({
      tutorId: p.id,
      username: p.username ?? "—",
    })).sort((a, b) => a.username.localeCompare(b.username, "ru"));

    const meaningfulProgressRate = startedCount > 0 ? meaningfulCount / startedCount : 0;
    const startedThreadRate = allThreadCount > 0 ? startedCount / allThreadCount : 0;
    const completionRate = startedCount > 0 ? completedCount / startedCount : 0;
    const partialRate = startedCount > 0 ? partialCount / startedCount : 0;
    const autonomousRate = meaningfulCount > 0 ? (meaningfulCount - interventionInMeaningful) / meaningfulCount : 0;
    const interventionRate = startedCount > 0 ? interventionCount / startedCount : 0;
    const needsAttentionRate = startedCount > 0 ? needsAttentionThreads.length / startedCount : 0;

    return new Response(
      JSON.stringify({
        window: { startDate: startDateStr, endDate: endDateStr },
        empty: false,
        metrics: {
          meaningfulProgressRate,
          startedThreadRate,
          completionRate,
          partialRate,
          autonomousRate,
          interventionRate,
          needsAttentionRate,
          ttmMedianSec,
          ttmMedianLabel: fmtDuration(ttmMedianSec),
          totals: {
            allThreads: allThreadCount,
            startedThreads: startedCount,
            meaningfulThreads: meaningfulCount,
            completedThreads: completedCount,
            partialThreads: partialCount,
            interventionThreads: interventionCount,
            needsAttentionThreads: needsAttentionThreads.length,
          },
        },
        successBuckets,
        failureBuckets,
        morningReview,
        tutorOptions,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function emptyResponse(startDateStr: string, endDateStr: string) {
  return {
    window: { startDate: startDateStr, endDate: endDateStr },
    empty: true,
    metrics: {
      meaningfulProgressRate: 0,
      startedThreadRate: 0,
      completionRate: 0,
      partialRate: 0,
      autonomousRate: 0,
      interventionRate: 0,
      needsAttentionRate: 0,
      ttmMedianSec: 0,
      ttmMedianLabel: "—",
      totals: {
        allThreads: 0,
        startedThreads: 0,
        meaningfulThreads: 0,
        completedThreads: 0,
        partialThreads: 0,
        interventionThreads: 0,
        needsAttentionThreads: 0,
      },
    },
    successBuckets: [],
    failureBuckets: [],
    morningReview: [],
    tutorOptions: [],
  };
}

function computeSuccessBuckets(
  meaningful: Set<string>,
  agg: Map<string, { hasCompleted: boolean; totalHints: number; totalAttempts: number }>,
  intervention: Set<string>,
  status: Map<string, string>,
) {
  const total = meaningful.size;
  const buckets: { label: string; count: number; share: number }[] = [];
  let completedNoIntervention = 0;
  let meaningfulFewHints = 0;
  let completedAfterHints = 0;
  meaningful.forEach((tid) => {
    const a = agg.get(tid);
    const isCompleted = status.get(tid) === "completed" || a?.hasCompleted;
    const intv = intervention.has(tid);
    const hints = a?.totalHints ?? 0;
    if (isCompleted && !intv) completedNoIntervention++;
    if ((hints === 1 || hints === 2)) meaningfulFewHints++;
    if (isCompleted && hints > 0) completedAfterHints++;
  });
  buckets.push({ label: "Завершено без вмешательства репетитора", count: completedNoIntervention, share: total > 0 ? completedNoIntervention / total : 0 });
  buckets.push({ label: "Прогресс с 1–2 подсказками", count: meaningfulFewHints, share: total > 0 ? meaningfulFewHints / total : 0 });
  buckets.push({ label: "Завершено после подсказок", count: completedAfterHints, share: total > 0 ? completedAfterHints / total : 0 });
  return buckets.sort((a, b) => b.count - a.count);
}

function computeFailureBuckets(
  started: Set<string>,
  meaningful: Set<string>,
  agg: Map<string, { hasCompleted: boolean; totalHints: number; totalAttempts: number }>,
  intervention: Set<string>,
  status: Map<string, string>,
) {
  const total = started.size;
  const buckets: { label: string; count: number; share: number }[] = [];
  let startedNoMeaningful = 0;
  let highHintsNoCompletion = 0;
  let needsTutor = 0;
  let manyAttemptsNoCompletion = 0;
  started.forEach((tid) => {
    const a = agg.get(tid);
    const isCompleted = status.get(tid) === "completed" || a?.hasCompleted;
    if (!meaningful.has(tid)) startedNoMeaningful++;
    if ((a?.totalHints ?? 0) >= 3 && !isCompleted) highHintsNoCompletion++;
    if (intervention.has(tid)) needsTutor++;
    if ((a?.totalAttempts ?? 0) >= 5 && !isCompleted) manyAttemptsNoCompletion++;
  });
  buckets.push({ label: "Старт без значимого прогресса", count: startedNoMeaningful, share: total > 0 ? startedNoMeaningful / total : 0 });
  buckets.push({ label: "≥ 3 подсказок без завершения", count: highHintsNoCompletion, share: total > 0 ? highHintsNoCompletion / total : 0 });
  buckets.push({ label: "Потребовалось вмешательство репетитора", count: needsTutor, share: total > 0 ? needsTutor / total : 0 });
  buckets.push({ label: "≥ 5 попыток без завершения", count: manyAttemptsNoCompletion, share: total > 0 ? manyAttemptsNoCompletion / total : 0 });
  return buckets.sort((a, b) => b.count - a.count).slice(0, 3);
}
