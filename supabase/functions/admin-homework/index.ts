import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

type ProfileLite = { username?: string | null; telegram_username?: string | null };

const displayName = (p: ProfileLite | undefined | null, tutorName?: string | null): string => {
  if (tutorName && tutorName.trim()) return tutorName.trim();
  if (p?.telegram_username) return `@${p.telegram_username}`;
  if (p?.username) return p.username;
  return "Неизвестный";
};

/* ─────────── Actions ─────────── */

/** Per-tutor extras for AdminTutorList chips: schedule + payments + mock exams aggregates, scoped by date range.
 *
 * ВНИМАНИЕ: в БД два разных смысла `tutor_id`:
 *   - `homework_tutor_assignments.tutor_id` и `mock_exam_assignments.tutor_id` ссылаются на `auth.users.id`
 *   - `tutor_lessons.tutor_id` и `tutor_students.tutor_id` ссылаются на `public.tutors.id` (PK)
 * Фронт лукапит extras по `auth.users.id` (это и есть `TutorOverview.tutorId`), поэтому здесь конвертируем
 * `tutors.id → tutors.user_id` через explicit lookup map. См. CLAUDE.md §8a.
 */
async function tutorExtras(admin: SupabaseClient, start: string, end: string) {
  // start/end are ISO strings; end is exclusive upper bound (we use < end).

  // ID mapping: public.tutors.id (PK) → auth.users.id (FK used by homework/mock_exams).
  // Загружаем ВСЕХ tutors один раз — таблица маленькая (десятки строк), это дешевле чем
  // фильтровать по нужным tutorPkIds в каждом subquery.
  const { data: tutorsList } = await admin
    .from("tutors")
    .select("id, user_id");
  const tutorPkToUserId = new Map<string, string>(
    (tutorsList || [])
      .filter((t): t is { id: string; user_id: string } => Boolean(t.id) && Boolean(t.user_id))
      .map((t) => [t.id, t.user_id]),
  );

  // Lessons: aggregate by tutor_id (public.tutors.id) over start_at in [start, end).
  const { data: lessons } = await admin
    .from("tutor_lessons")
    .select("tutor_id, status, parent_lesson_id, is_recurring, start_at")
    .gte("start_at", start)
    .lt("start_at", end);

  // Payments: join through tutor_students to map tutor_student_id → tutor_id (public.tutors.id).
  const { data: payments } = await admin
    .from("tutor_payments")
    .select("tutor_student_id, amount, status, paid_at, created_at, due_date")
    .gte("created_at", start)
    .lt("created_at", end);

  const studentIds = new Set<string>();
  payments?.forEach((p) => p.tutor_student_id && studentIds.add(p.tutor_student_id));
  const { data: tutorStudents } = studentIds.size
    ? await admin
        .from("tutor_students")
        .select("id, tutor_id")
        .in("id", [...studentIds])
    : { data: [] as Array<{ id: string; tutor_id: string }> };
  // tutor_student_id → auth.users.id (через tutors.user_id), уже сконвертировано.
  const studentToTutorUserId = new Map<string, string>();
  tutorStudents?.forEach((s) => {
    const userId = tutorPkToUserId.get(s.tutor_id);
    if (userId) studentToTutorUserId.set(s.id, userId);
  });

  // Mock-exam counts per tutor (assignments created in range). tutor_id здесь уже auth.users.id.
  const { data: mockExams } = await admin
    .from("mock_exam_assignments")
    .select("tutor_id, created_at, status")
    .gte("created_at", start)
    .lt("created_at", end);

  // Homework assignments в периоде (для cross-feature retention + period-scoped totals + averages).
  // tutor_id здесь = auth.users.id, конвертация не нужна.
  const { data: assignments } = await admin
    .from("homework_tutor_assignments")
    .select("id, tutor_id, status, created_at")
    .gte("created_at", start)
    .lt("created_at", end);
  const assignmentIds = (assignments || []).map((a) => a.id);
  const assignmentToTutor = new Map<string, string>();
  (assignments || []).forEach((a) => {
    if (a.tutor_id) assignmentToTutor.set(a.id, a.tutor_id);
  });

  // Student_assignments, привязанные к ДЗ в периоде → students_in_period.
  const { data: studentAssignments } = assignmentIds.length
    ? await admin
        .from("homework_tutor_student_assignments")
        .select("id, assignment_id, student_id")
        .in("assignment_id", assignmentIds)
    : { data: [] as Array<{ id: string; assignment_id: string; student_id: string }> };

  // Threads с активностью ученика в периоде → active_students_in_period.
  const saIds = (studentAssignments || []).map((sa) => sa.id);
  const { data: activeThreads } = saIds.length
    ? await admin
        .from("homework_tutor_threads")
        .select("student_assignment_id, last_student_message_at")
        .in("student_assignment_id", saIds)
        .gte("last_student_message_at", start)
        .lt("last_student_message_at", end)
    : { data: [] as Array<{ student_assignment_id: string; last_student_message_at: string }> };
  const activeSaIds = new Set((activeThreads || []).map((t) => t.student_assignment_id));

  type Extras = {
    lessons_total: number;
    lessons_done: number;
    lessons_cancelled: number;
    lessons_no_show: number;
    lessons_recurring: number;
    gmv_paid: number;
    gmv_pending: number;
    payments_count: number;
    mock_exams_count: number;
    // Period-scoped homework metrics (фича #6, #3, #5)
    assignments_in_period: number;
    assignments_active_in_period: number;
    assignments_completed_in_period: number;
    students_in_period: number;
    active_students_in_period: number;
    distinct_active_days: number;
  };

  const extras = new Map<string, Extras>();
  // Set-based aggregators (финализируются в counts в конце)
  const studentSetsByTutor = new Map<string, Set<string>>();
  const activeStudentSetsByTutor = new Map<string, Set<string>>();
  const daysByTutor = new Map<string, Set<string>>();

  const ensure = (id: string): Extras => {
    let e = extras.get(id);
    if (!e) {
      e = {
        lessons_total: 0, lessons_done: 0, lessons_cancelled: 0, lessons_no_show: 0, lessons_recurring: 0,
        gmv_paid: 0, gmv_pending: 0, payments_count: 0,
        mock_exams_count: 0,
        assignments_in_period: 0, assignments_active_in_period: 0, assignments_completed_in_period: 0,
        students_in_period: 0, active_students_in_period: 0,
        distinct_active_days: 0,
      };
      extras.set(id, e);
    }
    return e;
  };

  // Distinct active days: один Set<"YYYY-MM-DD"> на репетитора, union по 4 источникам.
  const addDay = (userId: string, ts: string | null | undefined) => {
    if (!ts) return;
    const day = ts.slice(0, 10); // ISO YYYY-MM-DDTHH:MM:SS → YYYY-MM-DD
    if (day.length !== 10) return;
    let s = daysByTutor.get(userId);
    if (!s) { s = new Set(); daysByTutor.set(userId, s); }
    s.add(day);
  };

  lessons?.forEach((l) => {
    if (!l.tutor_id) return;
    const userId = tutorPkToUserId.get(l.tutor_id);
    if (!userId) return;
    const e = ensure(userId);
    e.lessons_total += 1;
    if (l.status === "done" || l.status === "completed") e.lessons_done += 1;
    else if (l.status === "cancelled" || l.status === "canceled") e.lessons_cancelled += 1;
    else if (l.status === "no_show") e.lessons_no_show += 1;
    if (l.is_recurring || l.parent_lesson_id) e.lessons_recurring += 1;
    addDay(userId, l.start_at);
  });

  payments?.forEach((p) => {
    const userId = p.tutor_student_id ? studentToTutorUserId.get(p.tutor_student_id) : null;
    if (!userId) return;
    const e = ensure(userId);
    e.payments_count += 1;
    const amt = Number(p.amount) || 0;
    if (p.status === "paid") e.gmv_paid += amt;
    else if (p.status === "pending") e.gmv_pending += amt;
    addDay(userId, p.created_at);
  });

  mockExams?.forEach((m) => {
    if (!m.tutor_id) return;
    ensure(m.tutor_id).mock_exams_count += 1;
    addDay(m.tutor_id, m.created_at);
  });

  assignments?.forEach((a) => {
    if (!a.tutor_id) return;
    const e = ensure(a.tutor_id);
    e.assignments_in_period += 1;
    if (a.status === "active") e.assignments_active_in_period += 1;
    else if (a.status === "closed" || a.status === "completed") e.assignments_completed_in_period += 1;
    addDay(a.tutor_id, a.created_at);
  });

  studentAssignments?.forEach((sa) => {
    const tutorId = assignmentToTutor.get(sa.assignment_id);
    if (!tutorId) return;
    let set = studentSetsByTutor.get(tutorId);
    if (!set) { set = new Set(); studentSetsByTutor.set(tutorId, set); }
    set.add(sa.student_id);
    if (activeSaIds.has(sa.id)) {
      let aset = activeStudentSetsByTutor.get(tutorId);
      if (!aset) { aset = new Set(); activeStudentSetsByTutor.set(tutorId, aset); }
      aset.add(sa.student_id);
    }
  });

  // Финализация set-based счётчиков.
  studentSetsByTutor.forEach((set, tid) => { ensure(tid).students_in_period = set.size; });
  activeStudentSetsByTutor.forEach((set, tid) => { ensure(tid).active_students_in_period = set.size; });
  daysByTutor.forEach((set, tid) => { ensure(tid).distinct_active_days = set.size; });

  return Object.fromEntries(extras);
}

async function tutorsOverview(admin: SupabaseClient) {
  const { data: assignments, error: aErr } = await admin
    .from("homework_tutor_assignments")
    .select("id, tutor_id, status");
  if (aErr) throw aErr;
  if (!assignments?.length) return [];

  const tutorIds = [...new Set(assignments.map((a) => a.tutor_id))];
  const assignmentIds = assignments.map((a) => a.id);

  const [tutorsRes, tutorProfilesRes] = await Promise.all([
    admin.from("tutors").select("user_id, name, telegram_username").in("user_id", tutorIds),
    admin.from("profiles").select("id, username, telegram_username").in("id", tutorIds),
  ]);

  const tutorsMap = new Map(tutorsRes.data?.map((t) => [t.user_id, t]) || []);
  const tutorProfilesMap = new Map(tutorProfilesRes.data?.map((p) => [p.id, p]) || []);

  const { data: studentAssignments, error: saErr } = await admin
    .from("homework_tutor_student_assignments")
    .select("id, assignment_id, student_id")
    .in("assignment_id", assignmentIds);
  if (saErr) throw saErr;

  const saByAssignment = new Map<string, { id: string; student_id: string }[]>();
  studentAssignments?.forEach((sa) => {
    const arr = saByAssignment.get(sa.assignment_id) || [];
    arr.push({ id: sa.id, student_id: sa.student_id });
    saByAssignment.set(sa.assignment_id, arr);
  });

  const allSaIds = (studentAssignments || []).map((sa) => sa.id);
  const { data: threads } = allSaIds.length
    ? await admin
        .from("homework_tutor_threads")
        .select("id, student_assignment_id, last_student_message_at, updated_at")
        .in("student_assignment_id", allSaIds)
    : { data: [] as Array<{ id: string; student_assignment_id: string; last_student_message_at: string | null; updated_at: string }> };

  const threadsBySa = new Map<string, { id: string; last_student_message_at: string | null }>();
  threads?.forEach((t) =>
    threadsBySa.set(t.student_assignment_id, {
      id: t.id,
      last_student_message_at: t.last_student_message_at,
    }),
  );

  const allThreadIds = (threads || []).map((t) => t.id);
  const { data: recentMessages } = allThreadIds.length
    ? await admin
        .from("homework_tutor_thread_messages")
        .select("thread_id, content, created_at")
        .in("thread_id", allThreadIds)
        .eq("role", "user")
        .order("created_at", { ascending: false })
        .limit(2000)
    : { data: [] as Array<{ thread_id: string; content: string; created_at: string }> };

  const studentIds = [...new Set((studentAssignments || []).map((sa) => sa.student_id))];
  const { data: studentProfiles } = studentIds.length
    ? await admin
        .from("profiles")
        .select("id, username, telegram_username")
        .in("id", studentIds)
    : { data: [] as Array<{ id: string; username: string | null; telegram_username: string | null }> };
  const studentProfilesMap = new Map(studentProfiles?.map((p) => [p.id, p]) || []);

  const result = tutorIds.map((tutorId) => {
    const tutorRow = tutorsMap.get(tutorId);
    const profile = tutorProfilesMap.get(tutorId);

    const tutorAssignments = assignments.filter((a) => a.tutor_id === tutorId);
    const totalAssignments = tutorAssignments.length;
    const activeAssignments = tutorAssignments.filter((a) => a.status === "active").length;
    const completedAssignments = tutorAssignments.filter(
      (a) => a.status === "closed" || a.status === "completed",
    ).length;

    const tutorStudentIds = new Set<string>();
    const tutorThreads: { id: string; saId: string; last_student_message_at: string | null }[] = [];
    tutorAssignments.forEach((a) => {
      const sas = saByAssignment.get(a.id) || [];
      sas.forEach((sa) => {
        tutorStudentIds.add(sa.student_id);
        const t = threadsBySa.get(sa.id);
        if (t) tutorThreads.push({ id: t.id, saId: sa.id, last_student_message_at: t.last_student_message_at });
      });
    });

    const now = Date.now();
    const activeStudent7dSet = new Set<string>();
    tutorThreads.forEach((t) => {
      if (!t.last_student_message_at) return;
      const ts = Date.parse(t.last_student_message_at);
      if (now - ts <= SEVEN_DAYS_MS) {
        const sa = studentAssignments?.find((s) => s.id === t.saId);
        if (sa) activeStudent7dSet.add(sa.student_id);
      }
    });

    let lastActivityAt: string | null = null;
    let lastActivityStudentName: string | null = null;
    let lastActivityPreview: string | null = null;

    const tutorThreadIds = new Set(tutorThreads.map((t) => t.id));
    const tutorMessages = (recentMessages || []).filter((m) => tutorThreadIds.has(m.thread_id));
    if (tutorMessages.length) {
      const latest = tutorMessages[0];
      lastActivityAt = latest.created_at;
      lastActivityPreview = latest.content?.slice(0, 80) ?? null;
      const sa = studentAssignments?.find(
        (s) => s.id === threads?.find((t) => t.id === latest.thread_id)?.student_assignment_id,
      );
      if (sa) lastActivityStudentName = displayName(studentProfilesMap.get(sa.student_id));
    } else {
      const sorted = tutorThreads
        .filter((t) => t.last_student_message_at)
        .sort((a, b) => Date.parse(b.last_student_message_at!) - Date.parse(a.last_student_message_at!));
      if (sorted.length) lastActivityAt = sorted[0].last_student_message_at;
    }

    return {
      tutorId,
      tutorName: displayName(profile, tutorRow?.name),
      telegramUsername: tutorRow?.telegram_username || profile?.telegram_username || null,
      totalAssignments,
      activeAssignments,
      completedAssignments,
      totalStudents: tutorStudentIds.size,
      activeStudents7d: activeStudent7dSet.size,
      lastActivityAt,
      lastActivityStudentName,
      lastActivityPreview,
    };
  });

  result.sort((a, b) => {
    if (!a.lastActivityAt && !b.lastActivityAt) return 0;
    if (!a.lastActivityAt) return 1;
    if (!b.lastActivityAt) return -1;
    return Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt);
  });

  return result;
}

async function assignmentsByTutor(admin: SupabaseClient, tutorId: string) {
  const { data: assignments, error: aErr } = await admin
    .from("homework_tutor_assignments")
    .select("id, title, subject, exam_type, status")
    .eq("tutor_id", tutorId);
  if (aErr) throw aErr;
  if (!assignments?.length) return [];

  const assignmentIds = assignments.map((a) => a.id);

  const { data: studentAssignments } = await admin
    .from("homework_tutor_student_assignments")
    .select("id, assignment_id, student_id")
    .in("assignment_id", assignmentIds);

  const saByAssignment = new Map<string, { id: string; student_id: string }[]>();
  studentAssignments?.forEach((sa) => {
    const arr = saByAssignment.get(sa.assignment_id) || [];
    arr.push({ id: sa.id, student_id: sa.student_id });
    saByAssignment.set(sa.assignment_id, arr);
  });

  const allSaIds = (studentAssignments || []).map((sa) => sa.id);
  const { data: threads } = allSaIds.length
    ? await admin
        .from("homework_tutor_threads")
        .select("id, student_assignment_id, status, last_student_message_at")
        .in("student_assignment_id", allSaIds)
    : { data: [] as Array<{ id: string; student_assignment_id: string; status: string; last_student_message_at: string | null }> };

  const threadsBySa = new Map(threads?.map((t) => [t.student_assignment_id, t]) || []);
  const allThreadIds = (threads || []).map((t) => t.id);

  const { data: recentMessages } = allThreadIds.length
    ? await admin
        .from("homework_tutor_thread_messages")
        .select("thread_id, content, created_at")
        .in("thread_id", allThreadIds)
        .eq("role", "user")
        .order("created_at", { ascending: false })
        .limit(2000)
    : { data: [] as Array<{ thread_id: string; content: string; created_at: string }> };

  const studentIds = [...new Set((studentAssignments || []).map((sa) => sa.student_id))];
  const { data: studentProfiles } = studentIds.length
    ? await admin
        .from("profiles")
        .select("id, username, telegram_username")
        .in("id", studentIds)
    : { data: [] as Array<{ id: string; username: string | null; telegram_username: string | null }> };
  const studentProfilesMap = new Map(studentProfiles?.map((p) => [p.id, p]) || []);

  const result = assignments.map((a) => {
    const sas = saByAssignment.get(a.id) || [];
    let completed = 0;
    let inProgress = 0;
    let notStarted = 0;
    sas.forEach((sa) => {
      const t = threadsBySa.get(sa.id);
      if (!t) notStarted++;
      else if (t.status === "completed") completed++;
      else inProgress++;
    });

    const assignmentThreadIds = new Set(
      sas.map((sa) => threadsBySa.get(sa.id)?.id).filter(Boolean) as string[],
    );
    const assignmentMessages = (recentMessages || []).filter((m) =>
      assignmentThreadIds.has(m.thread_id),
    );
    let lastMessageAt: string | null = null;
    let lastMessageStudentName: string | null = null;
    let lastMessagePreview: string | null = null;
    if (assignmentMessages.length) {
      const latest = assignmentMessages[0];
      lastMessageAt = latest.created_at;
      lastMessagePreview = latest.content?.slice(0, 80) ?? null;
      const thread = threads?.find((t) => t.id === latest.thread_id);
      const sa = sas.find((s) => s.id === thread?.student_assignment_id);
      if (sa) lastMessageStudentName = displayName(studentProfilesMap.get(sa.student_id));
    }

    return {
      assignmentId: a.id,
      title: a.title || "Без названия",
      subject: a.subject || "",
      examType: a.exam_type || null,
      status: a.status,
      totalStudents: sas.length,
      completedStudents: completed,
      inProgressStudents: inProgress,
      notStartedStudents: notStarted,
      lastMessageAt,
      lastMessageStudentName,
      lastMessagePreview,
    };
  });

  result.sort((a, b) => {
    if (!a.lastMessageAt && !b.lastMessageAt) return 0;
    if (!a.lastMessageAt) return 1;
    if (!b.lastMessageAt) return -1;
    return Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt);
  });

  return result;
}

async function studentsInAssignment(admin: SupabaseClient, assignmentId: string) {
  const { data: studentAssignments, error: saErr } = await admin
    .from("homework_tutor_student_assignments")
    .select("id, student_id")
    .eq("assignment_id", assignmentId);
  if (saErr) throw saErr;
  if (!studentAssignments?.length) return [];

  const saIds = studentAssignments.map((sa) => sa.id);
  const studentIds = studentAssignments.map((sa) => sa.student_id);

  const [threadsRes, profilesRes] = await Promise.all([
    admin
      .from("homework_tutor_threads")
      .select("id, student_assignment_id, status, last_student_message_at, updated_at")
      .in("student_assignment_id", saIds),
    admin
      .from("profiles")
      .select("id, username, telegram_username")
      .in("id", studentIds),
  ]);

  const threadsBySa = new Map(threadsRes.data?.map((t) => [t.student_assignment_id, t]) || []);
  const profilesMap = new Map(profilesRes.data?.map((p) => [p.id, p]) || []);
  const allThreadIds = (threadsRes.data || []).map((t) => t.id);

  const [countsRes, lastMsgRes] = await Promise.all([
    allThreadIds.length
      ? admin
          .from("homework_tutor_thread_messages")
          .select("thread_id")
          .in("thread_id", allThreadIds)
      : Promise.resolve({ data: [] as Array<{ thread_id: string }> }),
    allThreadIds.length
      ? admin
          .from("homework_tutor_thread_messages")
          .select("thread_id, content, created_at")
          .in("thread_id", allThreadIds)
          .order("created_at", { ascending: false })
          .limit(2000)
      : Promise.resolve({ data: [] as Array<{ thread_id: string; content: string; created_at: string }> }),
  ]);

  const countMap: Record<string, number> = {};
  countsRes.data?.forEach((m) => {
    countMap[m.thread_id] = (countMap[m.thread_id] || 0) + 1;
  });

  const lastByThread = new Map<string, { content: string; created_at: string }>();
  lastMsgRes.data?.forEach((m) => {
    if (!lastByThread.has(m.thread_id)) {
      lastByThread.set(m.thread_id, { content: m.content, created_at: m.created_at });
    }
  });

  const result = studentAssignments.map((sa) => {
    const thread = threadsBySa.get(sa.id);
    const profile = profilesMap.get(sa.student_id);
    const last = thread ? lastByThread.get(thread.id) : undefined;

    return {
      threadId: thread?.id || null,
      studentAssignmentId: sa.id,
      studentId: sa.student_id,
      studentName: displayName(profile),
      status: thread?.status || "not_started",
      messageCount: thread ? countMap[thread.id] || 0 : 0,
      lastMessageAt: last?.created_at || thread?.last_student_message_at || null,
      lastMessagePreview: last?.content?.slice(0, 80) || null,
    };
  });

  result.sort((a, b) => {
    if (!a.lastMessageAt && !b.lastMessageAt) return 0;
    if (!a.lastMessageAt) return 1;
    if (!b.lastMessageAt) return -1;
    return Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt);
  });

  return result;
}

async function threadDetails(admin: SupabaseClient, threadId: string) {
  const [msgsRes, statesRes] = await Promise.all([
    admin
      .from("homework_tutor_thread_messages")
      .select("id, role, content, created_at, message_kind, visible_to_student, image_url, task_order, author_user_id")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true }),
    admin
      .from("homework_tutor_task_states")
      .select("id, status, hint_count, wrong_answer_count, earned_score, available_score, task_id")
      .eq("thread_id", threadId),
  ]);
  if (msgsRes.error) throw msgsRes.error;
  if (statesRes.error) throw statesRes.error;

  return {
    messages: msgsRes.data || [],
    taskStates: statesRes.data || [],
  };
}

/* ─────────── Entrypoint ─────────── */

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

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

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    });
    const { data: isAdmin } = await admin.rpc("is_admin", {
      _user_id: userData.user.id,
    });
    if (!isAdmin) return json({ error: "Forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const action: string = body.action;

    switch (action) {
      case "tutors":
        return json({ tutors: await tutorsOverview(admin) });
      case "tutor_extras": {
        const start: string = body.start;
        const end: string = body.end;
        if (!start || !end) return json({ error: "start/end required" }, 400);
        return json({ extras: await tutorExtras(admin, start, end) });
      }
      case "assignments": {
        if (!body.tutorId) return json({ error: "tutorId required" }, 400);
        return json({ assignments: await assignmentsByTutor(admin, body.tutorId) });
      }
      case "students": {
        if (!body.assignmentId) return json({ error: "assignmentId required" }, 400);
        return json({ students: await studentsInAssignment(admin, body.assignmentId) });
      }
      case "thread": {
        if (!body.threadId) return json({ error: "threadId required" }, 400);
        return json(await threadDetails(admin, body.threadId));
      }
      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err) {
    console.error("admin-homework error:", err);
    return json(
      { error: err instanceof Error ? err.message : "Internal error" },
      500,
    );
  }
});
