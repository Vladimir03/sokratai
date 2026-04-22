import { supabase } from "@/lib/supabaseClient";

/* ─── Types ─── */

export interface TutorOverview {
  tutorId: string;
  tutorName: string;
  telegramUsername: string | null;
  totalAssignments: number;
  activeAssignments: number;
  completedAssignments: number;
  totalStudents: number;
  activeStudents7d: number;
  lastActivityAt: string | null;
  lastActivityStudentName: string | null;
  lastActivityPreview: string | null;
}

export interface AssignmentOverview {
  assignmentId: string;
  title: string;
  subject: string;
  examType: string | null;
  status: string;
  totalStudents: number;
  completedStudents: number;
  inProgressStudents: number;
  notStartedStudents: number;
  lastMessageAt: string | null;
  lastMessageStudentName: string | null;
  lastMessagePreview: string | null;
}

export interface AssignmentStudentRow {
  threadId: string | null;
  studentAssignmentId: string;
  studentId: string;
  studentName: string;
  status: string; // 'active' | 'completed' | 'not_started'
  messageCount: number;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
}

/* ─── Helpers ─── */

const displayName = (
  profile: { username?: string | null; telegram_username?: string | null } | undefined | null,
  tutorName?: string | null,
): string => {
  if (tutorName && tutorName.trim()) return tutorName.trim();
  if (profile?.telegram_username) return `@${profile.telegram_username}`;
  if (profile?.username) return profile.username;
  return "Неизвестный";
};

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/* ─── Level 1: tutors overview ─── */

export async function fetchTutorsOverview(): Promise<TutorOverview[]> {
  // 1. All assignments
  const { data: assignments, error: aErr } = await supabase
    .from("homework_tutor_assignments")
    .select("id, tutor_id, status");
  if (aErr) throw aErr;
  if (!assignments?.length) return [];

  const tutorIds = [...new Set(assignments.map((a) => a.tutor_id))];
  const assignmentIds = assignments.map((a) => a.id);

  // 2. Tutor profiles (from tutors table + profiles fallback)
  const [tutorsRes, tutorProfilesRes] = await Promise.all([
    supabase.from("tutors").select("user_id, name, telegram_username").in("user_id", tutorIds),
    supabase.from("profiles").select("id, username, telegram_username").in("id", tutorIds),
  ]);

  const tutorsMap = new Map(tutorsRes.data?.map((t) => [t.user_id, t]) || []);
  const tutorProfilesMap = new Map(
    tutorProfilesRes.data?.map((p) => [p.id, p]) || [],
  );

  // 3. Student assignments per assignment
  const { data: studentAssignments, error: saErr } = await supabase
    .from("homework_tutor_student_assignments")
    .select("id, assignment_id, student_id");
  if (saErr) throw saErr;

  const saByAssignment = new Map<string, { id: string; student_id: string }[]>();
  studentAssignments?.forEach((sa) => {
    if (!assignmentIds.includes(sa.assignment_id)) return;
    const arr = saByAssignment.get(sa.assignment_id) || [];
    arr.push({ id: sa.id, student_id: sa.student_id });
    saByAssignment.set(sa.assignment_id, arr);
  });

  // 4. Threads (for activity timestamps)
  const allSaIds = (studentAssignments || []).map((sa) => sa.id);
  const { data: threads } = allSaIds.length
    ? await supabase
        .from("homework_tutor_threads")
        .select("id, student_assignment_id, last_student_message_at, updated_at")
        .in("student_assignment_id", allSaIds)
    : { data: [] as Array<{ id: string; student_assignment_id: string; last_student_message_at: string | null; updated_at: string }> };

  const threadsBySa = new Map<string, { id: string; last_student_message_at: string | null; updated_at: string }>();
  threads?.forEach((t) => {
    threadsBySa.set(t.student_assignment_id, {
      id: t.id,
      last_student_message_at: t.last_student_message_at,
      updated_at: t.updated_at,
    });
  });

  // 5. Last user message per tutor (one bulk query, dedup client-side)
  const allThreadIds = (threads || []).map((t) => t.id);
  const { data: recentMessages } = allThreadIds.length
    ? await supabase
        .from("homework_tutor_thread_messages")
        .select("thread_id, content, created_at, author_user_id")
        .in("thread_id", allThreadIds)
        .eq("role", "user")
        .order("created_at", { ascending: false })
        .limit(500)
    : { data: [] as Array<{ thread_id: string; content: string; created_at: string; author_user_id: string | null }> };

  // Map thread_id → assignment_id → tutor_id
  const assignmentByThread = new Map<string, string>();
  threads?.forEach((t) => {
    const sa = studentAssignments?.find((s) => s.id === t.student_assignment_id);
    if (sa) assignmentByThread.set(t.id, sa.assignment_id);
  });
  const tutorByAssignment = new Map(assignments.map((a) => [a.id, a.tutor_id]));

  // 6. Student profile names (for "last activity by N")
  const studentIds = [...new Set((studentAssignments || []).map((sa) => sa.student_id))];
  const { data: studentProfiles } = studentIds.length
    ? await supabase
        .from("profiles")
        .select("id, username, telegram_username")
        .in("id", studentIds)
    : { data: [] as Array<{ id: string; username: string | null; telegram_username: string | null }> };
  const studentProfilesMap = new Map(studentProfiles?.map((p) => [p.id, p]) || []);

  // 7. Aggregate per tutor
  const result: TutorOverview[] = tutorIds.map((tutorId) => {
    const tutorRow = tutorsMap.get(tutorId);
    const profile = tutorProfilesMap.get(tutorId);

    const tutorAssignments = assignments.filter((a) => a.tutor_id === tutorId);
    const totalAssignments = tutorAssignments.length;
    const activeAssignments = tutorAssignments.filter((a) => a.status === "active").length;
    const completedAssignments = tutorAssignments.filter((a) => a.status === "closed" || a.status === "completed").length;

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

    // Last activity
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
      if (sa) {
        lastActivityStudentName = displayName(studentProfilesMap.get(sa.student_id));
      }
    } else {
      // Fallback to thread timestamps
      const sortedThreads = tutorThreads
        .filter((t) => t.last_student_message_at)
        .sort((a, b) => Date.parse(b.last_student_message_at!) - Date.parse(a.last_student_message_at!));
      if (sortedThreads.length) {
        lastActivityAt = sortedThreads[0].last_student_message_at;
      }
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

  // Sort by last activity DESC (nulls last)
  result.sort((a, b) => {
    if (!a.lastActivityAt && !b.lastActivityAt) return 0;
    if (!a.lastActivityAt) return 1;
    if (!b.lastActivityAt) return -1;
    return Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt);
  });

  return result;
}

/* ─── Level 2: assignments by tutor ─── */

export async function fetchAssignmentsByTutor(tutorId: string): Promise<AssignmentOverview[]> {
  const { data: assignments, error: aErr } = await supabase
    .from("homework_tutor_assignments")
    .select("id, title, subject, exam_type, status")
    .eq("tutor_id", tutorId);
  if (aErr) throw aErr;
  if (!assignments?.length) return [];

  const assignmentIds = assignments.map((a) => a.id);

  const { data: studentAssignments } = await supabase
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
    ? await supabase
        .from("homework_tutor_threads")
        .select("id, student_assignment_id, status, last_student_message_at")
        .in("student_assignment_id", allSaIds)
    : { data: [] as Array<{ id: string; student_assignment_id: string; status: string; last_student_message_at: string | null }> };

  const threadsBySa = new Map(threads?.map((t) => [t.student_assignment_id, t]) || []);
  const allThreadIds = (threads || []).map((t) => t.id);

  const { data: recentMessages } = allThreadIds.length
    ? await supabase
        .from("homework_tutor_thread_messages")
        .select("thread_id, content, created_at")
        .in("thread_id", allThreadIds)
        .eq("role", "user")
        .order("created_at", { ascending: false })
        .limit(500)
    : { data: [] as Array<{ thread_id: string; content: string; created_at: string }> };

  const studentIds = [...new Set((studentAssignments || []).map((sa) => sa.student_id))];
  const { data: studentProfiles } = studentIds.length
    ? await supabase
        .from("profiles")
        .select("id, username, telegram_username")
        .in("id", studentIds)
    : { data: [] as Array<{ id: string; username: string | null; telegram_username: string | null }> };
  const studentProfilesMap = new Map(studentProfiles?.map((p) => [p.id, p]) || []);

  const result: AssignmentOverview[] = assignments.map((a) => {
    const sas = saByAssignment.get(a.id) || [];
    let completed = 0;
    let inProgress = 0;
    let notStarted = 0;
    sas.forEach((sa) => {
      const t = threadsBySa.get(sa.id);
      if (!t) {
        notStarted++;
      } else if (t.status === "completed") {
        completed++;
      } else {
        inProgress++;
      }
    });

    // Last message in any thread of this assignment
    const assignmentThreadIds = new Set(sas.map((sa) => threadsBySa.get(sa.id)?.id).filter(Boolean) as string[]);
    const assignmentMessages = (recentMessages || []).filter((m) => assignmentThreadIds.has(m.thread_id));
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

/* ─── Level 3: students in assignment ─── */

export async function fetchStudentsInAssignment(assignmentId: string): Promise<AssignmentStudentRow[]> {
  const { data: studentAssignments, error: saErr } = await supabase
    .from("homework_tutor_student_assignments")
    .select("id, student_id")
    .eq("assignment_id", assignmentId);
  if (saErr) throw saErr;
  if (!studentAssignments?.length) return [];

  const saIds = studentAssignments.map((sa) => sa.id);
  const studentIds = studentAssignments.map((sa) => sa.student_id);

  const [threadsRes, profilesRes] = await Promise.all([
    supabase
      .from("homework_tutor_threads")
      .select("id, student_assignment_id, status, last_student_message_at, updated_at")
      .in("student_assignment_id", saIds),
    supabase
      .from("profiles")
      .select("id, username, telegram_username")
      .in("id", studentIds),
  ]);

  const threadsBySa = new Map(threadsRes.data?.map((t) => [t.student_assignment_id, t]) || []);
  const profilesMap = new Map(profilesRes.data?.map((p) => [p.id, p]) || []);

  const allThreadIds = (threadsRes.data || []).map((t) => t.id);

  const [countsRes, lastMsgRes] = await Promise.all([
    allThreadIds.length
      ? supabase
          .from("homework_tutor_thread_messages")
          .select("thread_id")
          .in("thread_id", allThreadIds)
      : Promise.resolve({ data: [] as Array<{ thread_id: string }> }),
    allThreadIds.length
      ? supabase
          .from("homework_tutor_thread_messages")
          .select("thread_id, content, created_at")
          .in("thread_id", allThreadIds)
          .order("created_at", { ascending: false })
          .limit(500)
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

  const result: AssignmentStudentRow[] = studentAssignments.map((sa) => {
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

/* ─── Helpers exported ─── */

export function formatRelativeTime(iso: string | null): string {
  if (!iso) return "—";
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return "—";
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "только что";
  if (mins < 60) return `${mins} мин назад`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ч назад`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "вчера";
  if (days < 7) return `${days} д назад`;
  const date = new Date(ts);
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}
