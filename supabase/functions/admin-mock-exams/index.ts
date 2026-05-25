import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

type Range = { start: string; end: string };

const displayName = (
  tutorName: string | null | undefined,
  profile: { username?: string | null; telegram_username?: string | null } | undefined,
) => {
  if (tutorName && tutorName.trim()) return tutorName.trim();
  if (profile?.telegram_username) return `@${profile.telegram_username}`;
  if (profile?.username) return profile.username;
  return "Неизвестный";
};

async function loadTutorMap(admin: SupabaseClient, tutorIds: string[]) {
  if (!tutorIds.length) return new Map<string, string>();
  const [tRes, pRes] = await Promise.all([
    admin.from("tutors").select("user_id, name, telegram_username").in("user_id", tutorIds),
    admin.from("profiles").select("id, username, telegram_username").in("id", tutorIds),
  ]);
  const profileMap = new Map(pRes.data?.map((p) => [p.id, p]) || []);
  const map = new Map<string, string>();
  tutorIds.forEach((id) => {
    const t = tRes.data?.find((x) => x.user_id === id);
    map.set(id, displayName(t?.name, profileMap.get(id)));
  });
  return map;
}

async function loadStudentNames(admin: SupabaseClient, studentIds: string[]) {
  if (!studentIds.length) return new Map<string, string>();
  const [pRes, tsRes] = await Promise.all([
    admin.from("profiles").select("id, username, telegram_username, full_name").in("id", studentIds),
    admin.from("tutor_students").select("student_id, display_name").in("student_id", studentIds),
  ]);
  const dispMap = new Map<string, string>();
  studentIds.forEach((id) => {
    const ts = tsRes.data?.find((x) => x.student_id === id);
    if (ts?.display_name) { dispMap.set(id, ts.display_name); return; }
    const p = pRes.data?.find((x) => x.id === id);
    const fn = (p as { full_name?: string | null } | undefined)?.full_name;
    if (fn) { dispMap.set(id, fn); return; }
    if (p?.username && !/^(telegram_|user_)\d+$/i.test(p.username)) {
      dispMap.set(id, p.username);
      return;
    }
    if (p?.telegram_username) { dispMap.set(id, `@${p.telegram_username}`); return; }
    dispMap.set(id, "Ученик");
  });
  return dispMap;
}

/* ─────────── Actions ─────────── */

/** Sub-tab 1: list — grouped by tutor with assignment counts and attempt status breakdown. */
async function listOverview(admin: SupabaseClient, { start, end }: Range) {
  const { data: assignments } = await admin
    .from("mock_exam_assignments")
    .select("id, tutor_id, title, variant_title, mode, status, created_at, deadline")
    .gte("created_at", start)
    .lt("created_at", end)
    .order("created_at", { ascending: false });

  const assignmentIds = (assignments || []).map((a) => a.id);
  const { data: attempts } = assignmentIds.length
    ? await admin
        .from("mock_exam_attempts")
        .select("id, assignment_id, status, started_at, submitted_at, total_score, student_id, anonymous_id, updated_at")
        .in("assignment_id", assignmentIds)
    : { data: [] as Array<{ id: string; assignment_id: string; status: string; started_at: string | null; submitted_at: string | null; total_score: number | null; student_id: string | null; anonymous_id: string | null; updated_at: string }> };

  const tutorIds = [...new Set((assignments || []).map((a) => a.tutor_id))];
  const tutorNames = await loadTutorMap(admin, tutorIds);

  const attemptsByAssignment = new Map<string, typeof attempts>();
  attempts?.forEach((at) => {
    const arr = attemptsByAssignment.get(at.assignment_id) || [];
    arr.push(at);
    attemptsByAssignment.set(at.assignment_id, arr);
  });

  // Group by tutor
  const tutorMap = new Map<string, {
    tutorId: string;
    tutorName: string;
    assignments: Array<{
      id: string; title: string; variantTitle: string | null; mode: string; status: string; deadline: string | null; createdAt: string;
      counters: { total: number; in_progress: number; submitted: number; ai_checking: number; awaiting_review: number; approved: number; manually_entered: number };
    }>;
    totals: { assignments: number; attempts: number; awaiting_review: number };
  }>();

  (assignments || []).forEach((a) => {
    let entry = tutorMap.get(a.tutor_id);
    if (!entry) {
      entry = {
        tutorId: a.tutor_id,
        tutorName: tutorNames.get(a.tutor_id) || "Неизвестный",
        assignments: [],
        totals: { assignments: 0, attempts: 0, awaiting_review: 0 },
      };
      tutorMap.set(a.tutor_id, entry);
    }
    const ats = attemptsByAssignment.get(a.id) || [];
    const counters = { total: ats.length, in_progress: 0, submitted: 0, ai_checking: 0, awaiting_review: 0, approved: 0, manually_entered: 0 };
    ats.forEach((at) => {
      const k = at.status as keyof typeof counters;
      if (k in counters && k !== "total") (counters as Record<string, number>)[k] += 1;
    });
    entry.assignments.push({
      id: a.id,
      title: a.title,
      variantTitle: a.variant_title,
      mode: a.mode,
      status: a.status,
      deadline: a.deadline,
      createdAt: a.created_at,
      counters,
    });
    entry.totals.assignments += 1;
    entry.totals.attempts += counters.total;
    entry.totals.awaiting_review += counters.awaiting_review;
  });

  return [...tutorMap.values()].sort(
    (a, b) => b.totals.awaiting_review - a.totals.awaiting_review || b.totals.assignments - a.totals.assignments,
  );
}

/** Sub-tab 2: funnel — 6-step funnel + status distribution. */
async function funnelStats(admin: SupabaseClient, { start, end }: Range) {
  const { data: assignments } = await admin
    .from("mock_exam_assignments")
    .select("id, created_at")
    .gte("created_at", start)
    .lt("created_at", end);

  const assignmentIds = (assignments || []).map((a) => a.id);
  const { data: attempts } = assignmentIds.length
    ? await admin
        .from("mock_exam_attempts")
        .select("id, status, started_at, submitted_at, assignment_id")
        .in("assignment_id", assignmentIds)
    : { data: [] as Array<{ id: string; status: string; started_at: string | null; submitted_at: string | null; assignment_id: string }> };

  const totalAttempts = attempts?.length || 0;
  const started = attempts?.filter((a) => a.started_at).length || 0;
  const submitted = attempts?.filter((a) => a.submitted_at).length || 0;
  const aiChecked = attempts?.filter((a) => ["awaiting_review", "approved", "manually_entered"].includes(a.status)).length || 0;
  const approved = attempts?.filter((a) => a.status === "approved" || a.status === "manually_entered").length || 0;

  const statusDist: Record<string, number> = {};
  attempts?.forEach((a) => {
    statusDist[a.status] = (statusDist[a.status] || 0) + 1;
  });

  return {
    funnel: {
      assignments: assignments?.length || 0,
      attempts: totalAttempts,
      started,
      submitted,
      ai_checked: aiChecked,
      approved,
    },
    statusDistribution: statusDist,
  };
}

/** Sub-tab 3: AI quality — override delta, low-confidence rate, flags, latency. */
async function aiQuality(admin: SupabaseClient, { start, end }: Range) {
  // Pull Part2 solutions whose attempts were created in range.
  const { data: attempts } = await admin
    .from("mock_exam_attempts")
    .select("id, status, submitted_at, updated_at, ai_part1_ocr_json, blank_photo_url, part1_blank_photo_url")
    .gte("created_at", start)
    .lt("created_at", end);

  const attemptIds = (attempts || []).map((a) => a.id);
  const { data: solutions } = attemptIds.length
    ? await admin
        .from("mock_exam_attempt_part2_solutions")
        .select("attempt_id, kim_number, ai_draft_json, tutor_score, status")
        .in("attempt_id", attemptIds)
    : { data: [] as Array<{ attempt_id: string; kim_number: number; ai_draft_json: Record<string, unknown> | null; tutor_score: number | null; status: string }> };

  let lowConf = 0;
  let totalDrafts = 0;
  let overrideCount = 0;
  let overridableCount = 0;
  let absDeltaSum = 0;
  let absDeltaCount = 0;
  const flagCounts: Record<string, number> = {};
  const kimConfidence: Record<number, { low: number; medium: number; high: number; total: number }> = {};

  solutions?.forEach((s) => {
    const draft = s.ai_draft_json as { suggested_score?: number | null; confidence?: string; flags?: string[] } | null;
    if (!draft) return;
    totalDrafts += 1;
    const conf = draft.confidence;
    if (conf === "low") lowConf += 1;
    if (!kimConfidence[s.kim_number]) kimConfidence[s.kim_number] = { low: 0, medium: 0, high: 0, total: 0 };
    kimConfidence[s.kim_number].total += 1;
    if (conf === "low" || conf === "medium" || conf === "high") {
      kimConfidence[s.kim_number][conf] += 1;
    }
    (draft.flags || []).forEach((f) => {
      flagCounts[f] = (flagCounts[f] || 0) + 1;
    });
    if (draft.suggested_score != null && s.tutor_score != null) {
      overridableCount += 1;
      const delta = Math.abs(s.tutor_score - draft.suggested_score);
      if (delta > 0) overrideCount += 1;
      absDeltaSum += delta;
      absDeltaCount += 1;
    }
  });

  // Latency: submitted_at → updated_at (when attempt left ai_checking → awaiting_review).
  let latencySum = 0;
  let latencyCount = 0;
  let stuckCount = 0;
  const nowMs = Date.now();
  attempts?.forEach((a) => {
    if (a.status === "ai_checking") {
      const upd = a.updated_at ? Date.parse(a.updated_at) : NaN;
      if (!Number.isNaN(upd) && nowMs - upd > 120_000) stuckCount += 1;
    }
    if (a.submitted_at && a.status !== "in_progress" && a.status !== "submitted") {
      const sub = Date.parse(a.submitted_at);
      const upd = a.updated_at ? Date.parse(a.updated_at) : NaN;
      if (!Number.isNaN(sub) && !Number.isNaN(upd) && upd > sub) {
        latencySum += upd - sub;
        latencyCount += 1;
      }
    }
  });

  // OCR success rate
  let ocrFailed = 0;
  let ocrAttempted = 0;
  attempts?.forEach((a) => {
    if (!a.ai_part1_ocr_json) return;
    ocrAttempted += 1;
    const meta = (a.ai_part1_ocr_json as { __meta?: { status?: string } }).__meta;
    if (meta?.status === "failed") ocrFailed += 1;
  });

  return {
    totalDrafts,
    lowConfidenceRate: totalDrafts ? lowConf / totalDrafts : 0,
    overrideRate: overridableCount ? overrideCount / overridableCount : 0,
    avgAbsDelta: absDeltaCount ? absDeltaSum / absDeltaCount : 0,
    avgLatencyMs: latencyCount ? Math.round(latencySum / latencyCount) : 0,
    stuckAiCheckingCount: stuckCount,
    flagCounts,
    kimConfidence,
    ocrAttempted,
    ocrFailed,
  };
}

/** Problem cases list. */
async function problemCases(admin: SupabaseClient, { start, end }: Range) {
  const { data: attempts } = await admin
    .from("mock_exam_attempts")
    .select("id, assignment_id, status, submitted_at, updated_at, ai_part1_ocr_json")
    .gte("created_at", start)
    .lt("created_at", end);

  const cases: Array<{ attemptId: string; assignmentId: string; reason: string; detail: string }> = [];
  const nowMs = Date.now();

  attempts?.forEach((a) => {
    if (a.status === "ai_checking") {
      const upd = a.updated_at ? Date.parse(a.updated_at) : NaN;
      if (!Number.isNaN(upd) && nowMs - upd > 120_000) {
        cases.push({ attemptId: a.id, assignmentId: a.assignment_id, reason: "stuck_ai_checking", detail: `AI работает > ${Math.round((nowMs - upd) / 60000)} мин` });
      }
    }
    const ocrMeta = (a.ai_part1_ocr_json as { __meta?: { status?: string } } | null)?.__meta;
    if (ocrMeta?.status === "failed") {
      cases.push({ attemptId: a.id, assignmentId: a.assignment_id, reason: "ocr_failed", detail: "OCR не распознал бланк" });
    }
  });

  return cases;
}

/** Detailed attempt raw data view. */
async function attemptRaw(admin: SupabaseClient, attemptId: string) {
  const { data: attempt, error } = await admin
    .from("mock_exam_attempts")
    .select("*")
    .eq("id", attemptId)
    .maybeSingle();
  if (error) throw error;
  if (!attempt) return null;

  const [p1Res, p2Res, assignmentRes] = await Promise.all([
    admin.from("mock_exam_attempt_part1_answers").select("kim_number, student_answer, earned_score, score_source, is_correct").eq("attempt_id", attemptId).order("kim_number"),
    admin.from("mock_exam_attempt_part2_solutions").select("kim_number, ai_draft_json, tutor_score, tutor_comment, status, updated_at").eq("attempt_id", attemptId).order("kim_number"),
    admin.from("mock_exam_assignments").select("id, title, mode, status, tutor_id").eq("id", attempt.assignment_id).maybeSingle(),
  ]);

  let studentName: string | null = null;
  if (attempt.student_id) {
    const nameMap = await loadStudentNames(admin, [attempt.student_id]);
    studentName = nameMap.get(attempt.student_id) || null;
  }

  return {
    attempt,
    part1Answers: p1Res.data || [],
    part2Solutions: p2Res.data || [],
    assignment: assignmentRes.data,
    studentName,
  };
}

/* ─────────── Entrypoint ─────────── */

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData?.user) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const { data: isAdmin } = await admin.rpc("is_admin", { _user_id: userData.user.id });
    if (!isAdmin) return json({ error: "Forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const action: string = body.action;
    const range: Range = { start: body.start, end: body.end };

    switch (action) {
      case "list":
        if (!range.start || !range.end) return json({ error: "start/end required" }, 400);
        return json({ tutors: await listOverview(admin, range) });
      case "funnel":
        if (!range.start || !range.end) return json({ error: "start/end required" }, 400);
        return json(await funnelStats(admin, range));
      case "quality":
        if (!range.start || !range.end) return json({ error: "start/end required" }, 400);
        return json(await aiQuality(admin, range));
      case "problems":
        if (!range.start || !range.end) return json({ error: "start/end required" }, 400);
        return json({ cases: await problemCases(admin, range) });
      case "attempt_raw":
        if (!body.attemptId) return json({ error: "attemptId required" }, 400);
        return json(await attemptRaw(admin, body.attemptId));
      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err) {
    console.error("admin-mock-exams error:", err);
    return json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
});