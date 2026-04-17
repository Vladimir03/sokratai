import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Cohort = "pilot" | "all";
type WillingToPay = "yes" | "maybe" | "no" | "unknown";
type RiskStatus = "healthy" | "watch" | "at_risk";

interface CrmRow {
  tutor_user_id: string;
  is_pilot: boolean;
  willing_to_pay: WillingToPay;
  risk_status: RiskStatus;
  key_pain: string | null;
  notes: string | null;
}

interface ThreadRow {
  id: string;
  student_assignment_id: string;
  status: string;
  created_at: string;
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
}

interface SAMap {
  id: string;
  assignment_id: string;
  student_id: string;
}

interface AssignmentRow {
  id: string;
  tutor_id: string;
  subject: string | null;
}

interface TutorAggregate {
  tutorId: string;
  username: string | null;
  activeDays: Set<string>;
  startedThreads: Set<string>;
  meaningfulThreads: Set<string>;
  studentsReached: Set<string>;
  threadsWithIntervention: Set<string>;
  subjects: Set<string>;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function computeVerdict(input: {
  repeatValueRate: number;
  willingYesShare: number;
  willingYesMaybeShare: number;
  meaningfulMedian: number;
  revisitRate: number;
}): { level: "high" | "mixed" | "low"; reason: string } {
  const { repeatValueRate, willingYesShare, willingYesMaybeShare, meaningfulMedian, revisitRate } = input;

  if (repeatValueRate >= 0.5 && willingYesShare >= 0.2 && meaningfulMedian >= 3) {
    return {
      level: "high",
      reason: "Repeat Value ≥ 50%, готовы платить ≥ 20%, медиана ≥ 3 значимых тредов",
    };
  }

  if (
    (repeatValueRate >= 0.25 && repeatValueRate < 0.5) ||
    willingYesMaybeShare >= 0.3 ||
    (revisitRate >= 0.3 && willingYesShare < 0.2)
  ) {
    return {
      level: "mixed",
      reason: "Есть usage, но платёжный сигнал неоднозначный",
    };
  }

  return {
    level: "low",
    reason: "Слабый usage и/или почти нет yes-меток по готовности платить",
  };
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

    let body: { startDate?: string; endDate?: string; cohort?: Cohort } = {};
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
    const cohort: Cohort = body.cohort === "all" ? "all" : "pilot";

    const startDateStr = startDate.toISOString();
    const endDateStr = endDate.toISOString();

    // ===== Tutor cohort =====
    const { data: tutorRoles } = await supabaseAdmin
      .from("user_roles")
      .select("user_id")
      .eq("role", "tutor");
    const allTutorIds = new Set((tutorRoles ?? []).map((r: { user_id: string }) => r.user_id));

    const { data: crmRows } = await supabaseAdmin
      .from("tutor_pilot_crm")
      .select("*");
    const crmMap = new Map<string, CrmRow>();
    (crmRows ?? []).forEach((r: CrmRow) => crmMap.set(r.tutor_user_id, r));

    let cohortTutorIds: Set<string>;
    if (cohort === "pilot") {
      cohortTutorIds = new Set(
        (crmRows ?? []).filter((r: CrmRow) => r.is_pilot).map((r: CrmRow) => r.tutor_user_id),
      );
    } else {
      cohortTutorIds = allTutorIds;
    }

    const pilotTutorCount = (crmRows ?? []).filter((r: CrmRow) => r.is_pilot).length;

    // Empty pilot fallback handled by frontend (we still return data)
    if (cohortTutorIds.size === 0) {
      return new Response(
        JSON.stringify({
          cohort,
          pilotTutorCount,
          totalTutorCount: allTutorIds.size,
          empty: true,
          window: { startDate: startDateStr, endDate: endDateStr },
          metrics: null,
          atRiskTutors: [],
          crmSummary: {
            willingToPay: { yes: 0, maybe: 0, no: 0, unknown: 0 },
            riskStatus: { healthy: 0, watch: 0, at_risk: 0 },
          },
          verdict: { level: "low", reason: "Пилотная когорта пуста — отметьте репетиторов как pilot" },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ===== Assignments owned by cohort tutors =====
    const cohortTutorArr = Array.from(cohortTutorIds);
    const { data: assignments } = await supabaseAdmin
      .from("homework_tutor_assignments")
      .select("id, tutor_id, subject")
      .in("tutor_id", cohortTutorArr);
    const assignmentRows: AssignmentRow[] = assignments ?? [];
    const assignmentToTutor = new Map<string, string>();
    const assignmentToSubject = new Map<string, string | null>();
    assignmentRows.forEach((a) => {
      assignmentToTutor.set(a.id, a.tutor_id);
      assignmentToSubject.set(a.id, a.subject);
    });

    if (assignmentRows.length === 0) {
      // No threads possible
      return emptyMetricsResponse(cohort, pilotTutorCount, allTutorIds.size, startDateStr, endDateStr, crmMap, cohortTutorIds);
    }

    // ===== Student assignments =====
    const assignmentIds = assignmentRows.map((a) => a.id);
    const { data: sas } = await supabaseAdmin
      .from("homework_tutor_student_assignments")
      .select("id, assignment_id, student_id")
      .in("assignment_id", assignmentIds);
    const saList: SAMap[] = sas ?? [];
    const saToAssignment = new Map<string, string>();
    const saToStudent = new Map<string, string>();
    saList.forEach((s) => {
      saToAssignment.set(s.id, s.assignment_id);
      saToStudent.set(s.id, s.student_id);
    });

    // ===== Threads =====
    const saIds = saList.map((s) => s.id);
    let threadRows: ThreadRow[] = [];
    if (saIds.length > 0) {
      const { data: threads } = await supabaseAdmin
        .from("homework_tutor_threads")
        .select("id, student_assignment_id, status, created_at")
        .in("student_assignment_id", saIds);
      threadRows = threads ?? [];
    }

    if (threadRows.length === 0) {
      return emptyMetricsResponse(cohort, pilotTutorCount, allTutorIds.size, startDateStr, endDateStr, crmMap, cohortTutorIds);
    }

    const threadIds = threadRows.map((t) => t.id);
    const threadToSA = new Map<string, string>();
    const threadToStatus = new Map<string, string>();
    threadRows.forEach((t) => {
      threadToSA.set(t.id, t.student_assignment_id);
      threadToStatus.set(t.id, t.status);
    });

    // ===== Messages in window =====
    // Fetch in chunks to avoid IN() limits — but for pilot scale (10 tutors) this is fine
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
      .select("thread_id, status, attempts, hint_count, earned_score, ai_score")
      .in("thread_id", threadIds);
    const taskStateRows: TaskStateRow[] = taskStates ?? [];

    // ===== Aggregate per thread =====
    const startedThreads = new Set<string>();
    const threadActiveDays = new Map<string, Set<string>>(); // thread -> set of YYYY-MM-DD
    const threadHasTutorIntervention = new Set<string>();

    messageRows.forEach((m) => {
      if (m.role === "user" && (m.message_kind == null || m.message_kind !== "system")) {
        startedThreads.add(m.thread_id);
        const day = m.created_at.split("T")[0];
        if (!threadActiveDays.has(m.thread_id)) threadActiveDays.set(m.thread_id, new Set());
        threadActiveDays.get(m.thread_id)!.add(day);
      }
      if (m.role === "tutor" && m.visible_to_student === true) {
        threadHasTutorIntervention.add(m.thread_id);
      }
    });

    // Task state aggregates per thread
    const threadTaskAgg = new Map<string, { hasCompleted: boolean; hasProgress: boolean }>();
    taskStateRows.forEach((ts) => {
      const cur = threadTaskAgg.get(ts.thread_id) ?? { hasCompleted: false, hasProgress: false };
      if (ts.status === "completed") cur.hasCompleted = true;
      if ((ts.attempts ?? 0) > 0 || (ts.hint_count ?? 0) > 0 || ts.earned_score != null || ts.ai_score != null) {
        cur.hasProgress = true;
      }
      threadTaskAgg.set(ts.thread_id, cur);
    });

    const meaningfulThreads = new Set<string>();
    startedThreads.forEach((tid) => {
      const status = threadToStatus.get(tid);
      const agg = threadTaskAgg.get(tid);
      if (status === "completed" || agg?.hasCompleted || agg?.hasProgress) {
        meaningfulThreads.add(tid);
      }
    });

    // ===== Aggregate per tutor =====
    const tutorAggMap = new Map<string, TutorAggregate>();
    cohortTutorIds.forEach((tid) => {
      tutorAggMap.set(tid, {
        tutorId: tid,
        username: null,
        activeDays: new Set(),
        startedThreads: new Set(),
        meaningfulThreads: new Set(),
        studentsReached: new Set(),
        threadsWithIntervention: new Set(),
        subjects: new Set(),
      });
    });

    threadRows.forEach((t) => {
      const saId = t.student_assignment_id;
      const aId = saToAssignment.get(saId);
      if (!aId) return;
      const tutorId = assignmentToTutor.get(aId);
      if (!tutorId) return;
      const agg = tutorAggMap.get(tutorId);
      if (!agg) return;

      const studentId = saToStudent.get(saId);
      const subject = assignmentToSubject.get(aId);
      if (subject) agg.subjects.add(subject);

      if (startedThreads.has(t.id)) {
        agg.startedThreads.add(t.id);
        if (studentId) agg.studentsReached.add(studentId);
        const days = threadActiveDays.get(t.id);
        if (days) days.forEach((d) => agg.activeDays.add(d));
      }
      if (meaningfulThreads.has(t.id)) {
        agg.meaningfulThreads.add(t.id);
      }
      if (threadHasTutorIntervention.has(t.id)) {
        agg.threadsWithIntervention.add(t.id);
      }
    });

    // Resolve usernames for tutors
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, username")
      .in("id", cohortTutorArr);
    (profiles ?? []).forEach((p: { id: string; username: string | null }) => {
      const a = tutorAggMap.get(p.id);
      if (a) a.username = p.username;
    });

    // ===== Compute headline metrics =====
    const cohortSize = cohortTutorIds.size;
    const tutorAggs = Array.from(tutorAggMap.values());

    const repeatValueTutors = tutorAggs.filter(
      (a) => a.activeDays.size >= 2 && a.meaningfulThreads.size >= 3,
    );
    const repeatValueRate = cohortSize > 0 ? repeatValueTutors.length / cohortSize : 0;

    const revisitTutors = tutorAggs.filter((a) => a.activeDays.size >= 2);
    const revisitRate = cohortSize > 0 ? revisitTutors.length / cohortSize : 0;

    const meaningfulPerTutor = tutorAggs.map((a) => a.meaningfulThreads.size);
    const meaningfulMedian = median(meaningfulPerTutor);
    const meaningfulAvg = average(meaningfulPerTutor);

    let totalStarted = 0;
    let totalMeaningful = 0;
    let totalIntervention = 0;
    const studentsReached = new Set<string>();
    tutorAggs.forEach((a) => {
      totalStarted += a.startedThreads.size;
      totalMeaningful += a.meaningfulThreads.size;
      totalIntervention += a.threadsWithIntervention.size;
      a.studentsReached.forEach((s) => studentsReached.add(s));
    });

    const workflowCompletionRate = totalStarted > 0 ? totalMeaningful / totalStarted : 0;
    const autonomousProgressRate = totalMeaningful > 0
      ? (totalMeaningful - totalIntervention) / totalMeaningful
      : 0;

    // CRM-derived
    const cohortCrmRows = Array.from(cohortTutorIds).map((tid) => crmMap.get(tid)).filter(Boolean) as CrmRow[];
    const willingCount = { yes: 0, maybe: 0, no: 0, unknown: 0 };
    const riskCount = { healthy: 0, watch: 0, at_risk: 0 };
    cohortTutorIds.forEach((tid) => {
      const crm = crmMap.get(tid);
      const w = (crm?.willing_to_pay ?? "unknown") as WillingToPay;
      const r = (crm?.risk_status ?? "healthy") as RiskStatus;
      willingCount[w]++;
      riskCount[r]++;
    });
    const willingYesShare = cohortSize > 0 ? willingCount.yes / cohortSize : 0;
    const willingYesMaybeShare = cohortSize > 0 ? (willingCount.yes + willingCount.maybe) / cohortSize : 0;

    // At-risk tutors
    const atRiskTutors = tutorAggs
      .filter((a) => {
        const crm = crmMap.get(a.tutorId);
        return (
          a.activeDays.size < 2 ||
          a.meaningfulThreads.size < 2 ||
          crm?.risk_status === "at_risk"
        );
      })
      .map((a) => {
        const crm = crmMap.get(a.tutorId);
        return {
          tutorId: a.tutorId,
          username: a.username,
          subjects: Array.from(a.subjects),
          activeDays7d: a.activeDays.size,
          meaningfulThreads7d: a.meaningfulThreads.size,
          startedThreads7d: a.startedThreads.size,
          willingToPay: (crm?.willing_to_pay ?? "unknown") as WillingToPay,
          riskStatus: (crm?.risk_status ?? "healthy") as RiskStatus,
          keyPain: crm?.key_pain ?? null,
        };
      })
      .sort((a, b) => a.meaningfulThreads7d - b.meaningfulThreads7d);

    const atRiskCount = atRiskTutors.length;

    // ===== Full tutor list with metric-membership flags =====
    const allTutors = tutorAggs
      .map((a) => {
        const crm = crmMap.get(a.tutorId);
        const willingToPay = (crm?.willing_to_pay ?? "unknown") as WillingToPay;
        const riskStatus = (crm?.risk_status ?? "healthy") as RiskStatus;
        const isRepeatValue = a.activeDays.size >= 2 && a.meaningfulThreads.size >= 3;
        const isWillingYes = willingToPay === "yes";
        const isAtRisk =
          a.activeDays.size < 2 ||
          a.meaningfulThreads.size < 2 ||
          riskStatus === "at_risk";
        const isRevisit = a.activeDays.size >= 2;
        return {
          tutorId: a.tutorId,
          username: a.username,
          subjects: Array.from(a.subjects),
          activeDays7d: a.activeDays.size,
          meaningfulThreads7d: a.meaningfulThreads.size,
          startedThreads7d: a.startedThreads.size,
          studentsReached7d: a.studentsReached.size,
          willingToPay,
          riskStatus,
          keyPain: crm?.key_pain ?? null,
          flags: {
            repeatValue: isRepeatValue,
            willingYes: isWillingYes,
            atRisk: isAtRisk,
            revisit: isRevisit,
          },
        };
      })
      .sort((a, b) => {
        // Best signal first: repeat value tutors on top, then by meaningful threads desc
        if (a.flags.repeatValue !== b.flags.repeatValue) {
          return a.flags.repeatValue ? -1 : 1;
        }
        return b.meaningfulThreads7d - a.meaningfulThreads7d;
      });

    const verdict = computeVerdict({
      repeatValueRate,
      willingYesShare,
      willingYesMaybeShare,
      meaningfulMedian,
      revisitRate,
    });

    return new Response(
      JSON.stringify({
        cohort,
        pilotTutorCount,
        totalTutorCount: allTutorIds.size,
        empty: false,
        window: { startDate: startDateStr, endDate: endDateStr },
        metrics: {
          cohortSize,
          repeatValueTutors: {
            count: repeatValueTutors.length,
            share: repeatValueRate,
          },
          willingToPay: {
            yes: willingCount.yes,
            maybe: willingCount.maybe,
            no: willingCount.no,
            unknown: willingCount.unknown,
            yesShare: willingYesShare,
            yesMaybeShare: willingYesMaybeShare,
          },
          atRiskTutors: { count: atRiskCount, share: cohortSize > 0 ? atRiskCount / cohortSize : 0 },
          tutorRevisitRate: revisitRate,
          meaningfulThreadsPerTutor: { median: meaningfulMedian, avg: meaningfulAvg },
          workflowCompletionRate,
          autonomousProgressRate,
          studentsReached: studentsReached.size,
          totals: { startedThreads: totalStarted, meaningfulThreads: totalMeaningful },
        },
        atRiskTutors,
        allTutors,
        crmSummary: { willingToPay: willingCount, riskStatus: riskCount },
        verdict,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("admin-business-dashboard error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

function emptyMetricsResponse(
  cohort: Cohort,
  pilotTutorCount: number,
  totalTutorCount: number,
  startDateStr: string,
  endDateStr: string,
  crmMap: Map<string, CrmRow>,
  cohortTutorIds: Set<string>,
) {
  const willingCount = { yes: 0, maybe: 0, no: 0, unknown: 0 };
  const riskCount = { healthy: 0, watch: 0, at_risk: 0 };
  cohortTutorIds.forEach((tid) => {
    const crm = crmMap.get(tid);
    willingCount[(crm?.willing_to_pay ?? "unknown") as WillingToPay]++;
    riskCount[(crm?.risk_status ?? "healthy") as RiskStatus]++;
  });
  const cohortSize = cohortTutorIds.size;
  return new Response(
    JSON.stringify({
      cohort,
      pilotTutorCount,
      totalTutorCount,
      empty: false,
      window: { startDate: startDateStr, endDate: endDateStr },
      metrics: {
        cohortSize,
        repeatValueTutors: { count: 0, share: 0 },
        willingToPay: {
          ...willingCount,
          yesShare: cohortSize > 0 ? willingCount.yes / cohortSize : 0,
          yesMaybeShare: cohortSize > 0 ? (willingCount.yes + willingCount.maybe) / cohortSize : 0,
        },
        atRiskTutors: { count: 0, share: 0 },
        tutorRevisitRate: 0,
        meaningfulThreadsPerTutor: { median: 0, avg: 0 },
        workflowCompletionRate: 0,
        autonomousProgressRate: 0,
        studentsReached: 0,
        totals: { startedThreads: 0, meaningfulThreads: 0 },
      },
      atRiskTutors: [],
      allTutors: [],
      crmSummary: { willingToPay: willingCount, riskStatus: riskCount },
      verdict: { level: "low" as const, reason: "Нет активности в выбранном окне" },
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}
