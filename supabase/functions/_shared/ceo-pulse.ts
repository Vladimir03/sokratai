/**
 * CEO-дашборд «Пульс» — единый агрегатор фаундер-метрик.
 *
 * computePulse() строит: шапку здоровья (MRR, платящие, триалы, WAU, NSM),
 * воронку активации 1..8 ПОИМЁННО (source of truth — доменные таблицы, НЕ
 * analytics_events: та существует только с 2026-07-01 и не покрывает старые
 * когорты), разрез по каналам привлечения и список at-risk.
 *
 * Потребители: edge `admin-ceo-dashboard` (вкладка «Пульс» в /admin) и
 * Stage-2 `ceo-telegram-digest`. Вызывается ТОЛЬКО под service_role после
 * серверной проверки is_admin / SCHEDULER_SECRET — payload несёт имена
 * репетиторов (admin-only поверхность, в analytics_events ничего не пишем).
 *
 * FK-дрейф (rule 40): tutor_students.tutor_id → tutors.id, а
 * homework_tutor_assignments.tutor_id → auth.users.id — маппинг через
 * tutors.user_id ↔ tutors.id обязателен.
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

// ────────────────────────── Types ──────────────────────────

export type PulseChannelKind = "egor" | "ref" | "web";

export interface PulseChannelInfo {
  kind: PulseChannelKind;
  label: string;
}

export type PulseStageKey =
  | "registered"
  | "student_added"
  | "hw_created"
  | "hw_sent"
  | "student_opened"
  | "student_submitted"
  | "trial"
  | "paid";

export interface PulseTutor {
  tutorId: string; // tutors.id
  userId: string; // tutors.user_id (= auth.users.id = profiles.id)
  name: string;
  telegram: string | null;
  channel: PulseChannelInfo;
  registeredAt: string;
  /** 1..8 — максимум достигнутой стадии воронки. */
  stage: number;
  stageDates: Partial<Record<PulseStageKey, string | null>>;
  lastActivityAt: string | null;
  isPaying: boolean;
  isTrial: boolean;
  activeStudents: number;
}

export interface PulseStage {
  key: PulseStageKey;
  label: string;
  /** Репетиторов, достигших стадии ≥ k (монотонно убывает). */
  reached: number;
  /** Застряли РОВНО здесь (stage === k) — рабочий список «кому написать». */
  stuck: PulseTutor[];
}

export interface PulseAtRiskTutor {
  tutorId: string;
  userId: string;
  name: string;
  isPaying: boolean;
  isTrial: boolean;
  /** Дней с последней «ценности» (сдача ученика); null = ценности не было. */
  daysSinceValue: number | null;
  riskStatus: "healthy" | "watch" | "at_risk";
  willingToPay: "yes" | "maybe" | "no" | "unknown";
  keyPain: string | null;
}

export interface PulsePayload {
  generatedAt: string;
  header: {
    payingTutors: number;
    trialTutors: number;
    tutorWAU: number;
    newTutors7d: number;
    /** ₽, integer — Σ последнего succeeded-платежа plan='tutor_ai_start' за 35 дней. */
    mrr: number;
    weeklyValueTutors: { count: number; names: string[] };
    deltas: { newTutors: number; weeklyValue: number; mrr: number };
  };
  funnel: PulseStage[];
  channels: Array<{ kind: PulseChannelKind; label: string; total: number; trials: number; paying: number }>;
  atRisk: PulseAtRiskTutor[];
  totals: { tutors: number };
}

// ────────────────────────── Row shapes ──────────────────────────

interface TutorRow {
  id: string;
  user_id: string;
  name: string;
  telegram_username: string | null;
  created_at: string;
}

interface ProfileRow {
  id: string;
  subscription_tier: string | null;
  subscription_expires_at: string | null;
  trial_started_at: string | null;
  trial_ends_at: string | null;
  promo_code: string | null;
  registration_source: string | null;
  telegram_username: string | null;
}

interface TutorStudentRow {
  tutor_id: string;
  status: string | null;
  archived_at: string | null;
  created_at: string;
}

interface AssignmentRow {
  id: string;
  tutor_id: string; // auth.users.id!
  created_at: string;
}

interface SaRow {
  id: string;
  assignment_id: string;
  notified_at: string | null;
}

interface ThreadRow {
  id: string;
  student_assignment_id: string;
  status: string | null;
  created_at: string;
}

interface SubmissionMsgRow {
  thread_id: string;
  role: string;
  created_at: string;
}

interface TutorMsgRow {
  thread_id: string;
  created_at: string;
}

interface PaymentRow {
  user_id: string;
  amount: number | string | null;
  status: string;
  created_at: string;
}

interface CrmRow {
  tutor_user_id: string;
  willing_to_pay: "yes" | "maybe" | "no" | "unknown";
  risk_status: "healthy" | "watch" | "at_risk";
  key_pain: string | null;
}

// ────────────────────────── Helpers ──────────────────────────

const PAGE = 1000;

/**
 * PostgREST молча режет ответ на 1000 строк (rule 50 — «тихий недосчёт») —
 * все потенциально растущие таблицы читаем пагинацией до конца.
 */
async function fetchAll<T>(
  makeQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  label: string,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await makeQuery(from, from + PAGE - 1);
    if (error) throw new Error(`${label}: ${error.message}`);
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  return rows;
}

function minDate(a: string | null, b: string | null): string | null {
  if (a == null) return b;
  if (b == null) return a;
  return a <= b ? a : b;
}

function maxDate(a: string | null, b: string | null): string | null {
  if (a == null) return b;
  if (b == null) return a;
  return a >= b ? a : b;
}

function resolveChannel(profile: ProfileRow | undefined): PulseChannelInfo {
  const source = profile?.registration_source?.trim() ?? "";
  const promo = profile?.promo_code?.trim() ?? "";
  if (source === "egor" || promo.toUpperCase() === "BLINOV_20") {
    return { kind: "egor", label: "Егор (QR)" };
  }
  if (source && source !== "web") {
    return { kind: "ref", label: `Реф: ${source}` };
  }
  return { kind: "web", label: "Органика" };
}

const STAGE_LABELS: Array<{ key: PulseStageKey; label: string }> = [
  { key: "registered", label: "Регистрация" },
  { key: "student_added", label: "Добавил ученика" },
  { key: "hw_created", label: "Создал ДЗ" },
  { key: "hw_sent", label: "Отправил ДЗ" },
  { key: "student_opened", label: "Ученик открыл" },
  { key: "student_submitted", label: "Ученик сдал" },
  { key: "trial", label: "Триал" },
  { key: "paid", label: "Оплата" },
];

const MRR_WINDOW_DAYS = 35;

// ────────────────────────── Aggregation ──────────────────────────

export async function computePulse(db: SupabaseClient, now: Date = new Date()): Promise<PulsePayload> {
  const nowIso = now.toISOString();
  const d7 = new Date(now.getTime() - 7 * 864e5).toISOString();
  const d14 = new Date(now.getTime() - 14 * 864e5).toISOString();

  // ── 1. Загрузка (все потенциально растущие таблицы — с пагинацией) ──
  const tutors = await fetchAll<TutorRow>(
    (from, to) =>
      db.from("tutors").select("id, user_id, name, telegram_username, created_at").order("created_at").range(from, to),
    "tutors",
  );

  if (tutors.length === 0) {
    return {
      generatedAt: nowIso,
      header: {
        payingTutors: 0,
        trialTutors: 0,
        tutorWAU: 0,
        newTutors7d: 0,
        mrr: 0,
        weeklyValueTutors: { count: 0, names: [] },
        deltas: { newTutors: 0, weeklyValue: 0, mrr: 0 },
      },
      funnel: STAGE_LABELS.map((s) => ({ ...s, reached: 0, stuck: [] })),
      channels: [],
      atRisk: [],
      totals: { tutors: 0 },
    };
  }

  const userIds = tutors.map((t) => t.user_id);
  const tutorByUserId = new Map(tutors.map((t) => [t.user_id, t]));

  // profiles — .in() чанками по 100 (URL-длина), профилей ровно по числу репетиторов
  const profiles: ProfileRow[] = [];
  for (let i = 0; i < userIds.length; i += 100) {
    const chunk = userIds.slice(i, i + 100);
    const { data, error } = await db
      .from("profiles")
      .select(
        "id, subscription_tier, subscription_expires_at, trial_started_at, trial_ends_at, promo_code, registration_source, telegram_username",
      )
      .in("id", chunk);
    if (error) throw new Error(`profiles: ${error.message}`);
    profiles.push(...((data ?? []) as ProfileRow[]));
  }
  const profileByUserId = new Map(profiles.map((p) => [p.id, p]));

  const [tutorStudents, assignments, sas, threads, valueMsgs, tutorMsgs14d, payments, crmRows] = await Promise.all([
    fetchAll<TutorStudentRow>(
      (from, to) => db.from("tutor_students").select("tutor_id, status, archived_at, created_at").range(from, to),
      "tutor_students",
    ),
    fetchAll<AssignmentRow>(
      (from, to) => db.from("homework_tutor_assignments").select("id, tutor_id, created_at").range(from, to),
      "assignments",
    ),
    fetchAll<SaRow>(
      (from, to) =>
        db.from("homework_tutor_student_assignments").select("id, assignment_id, notified_at").range(from, to),
      "student_assignments",
    ),
    fetchAll<ThreadRow>(
      (from, to) =>
        db.from("homework_tutor_threads").select("id, student_assignment_id, status, created_at").range(from, to),
      "threads",
    ),
    // «Ценность» = ученик реально сдал: submission (мобайл/SubmitSheet) ИЛИ
    // answer (legacy checkAnswer) — оба scoring-пути rule 40.
    fetchAll<SubmissionMsgRow>(
      (from, to) =>
        db
          .from("homework_tutor_thread_messages")
          .select("thread_id, role, created_at")
          .eq("role", "user")
          .in("message_kind", ["submission", "answer"])
          .range(from, to),
      "value_messages",
    ),
    fetchAll<TutorMsgRow>(
      (from, to) =>
        db
          .from("homework_tutor_thread_messages")
          .select("thread_id, created_at")
          .eq("role", "tutor")
          .gte("created_at", d14)
          .range(from, to),
      "tutor_messages_14d",
    ),
    fetchAll<PaymentRow>(
      (from, to) =>
        db
          .from("payments")
          .select("user_id, amount, status, created_at")
          .eq("plan", "tutor_ai_start")
          .eq("status", "succeeded")
          .range(from, to),
      "payments",
    ),
    fetchAll<CrmRow>(
      (from, to) =>
        db.from("tutor_pilot_crm").select("tutor_user_id, willing_to_pay, risk_status, key_pain").range(from, to),
      "tutor_pilot_crm",
    ),
  ]);

  const crmByUserId = new Map(crmRows.map((r) => [r.tutor_user_id, r]));

  // ── 2. Маппинги (FK-дрейф: tutor_students → tutors.id; assignments → user_id) ──
  const tutorIdToUserId = new Map(tutors.map((t) => [t.id, t.user_id]));

  // per-tutor агрегаты (ключ — user_id)
  interface Agg {
    studentAddedAt: string | null;
    activeStudents: number;
    hwCreatedAt: string | null;
    hwSentAt: string | null;
    studentOpenedAt: string | null;
    studentSubmittedAt: string | null;
    lastValueAt: string | null;
    valueIn7d: boolean;
    valueInPrev7d: boolean;
    lastActivityAt: string | null;
    activeIn7d: boolean;
  }
  const agg = new Map<string, Agg>();
  const getAgg = (userId: string): Agg => {
    let a = agg.get(userId);
    if (!a) {
      a = {
        studentAddedAt: null,
        activeStudents: 0,
        hwCreatedAt: null,
        hwSentAt: null,
        studentOpenedAt: null,
        studentSubmittedAt: null,
        lastValueAt: null,
        valueIn7d: false,
        valueInPrev7d: false,
        lastActivityAt: null,
        activeIn7d: false,
      };
      agg.set(userId, a);
    }
    return a;
  };

  const touchActivity = (userId: string, at: string) => {
    const a = getAgg(userId);
    a.lastActivityAt = maxDate(a.lastActivityAt, at);
    if (at >= d7) a.activeIn7d = true;
  };

  // Стадия 2: добавил ученика (+ активные ученики: status='active', не в архиве)
  for (const ts of tutorStudents) {
    const userId = tutorIdToUserId.get(ts.tutor_id);
    if (!userId) continue;
    const a = getAgg(userId);
    a.studentAddedAt = minDate(a.studentAddedAt, ts.created_at);
    if (ts.status === "active" && ts.archived_at == null) a.activeStudents += 1;
    touchActivity(userId, ts.created_at);
  }

  // Стадия 3: создал ДЗ
  const assignmentToUserId = new Map<string, string>();
  const assignmentCreatedAt = new Map<string, string>();
  for (const asg of assignments) {
    if (!tutorByUserId.has(asg.tutor_id)) continue;
    assignmentToUserId.set(asg.id, asg.tutor_id);
    assignmentCreatedAt.set(asg.id, asg.created_at);
    const a = getAgg(asg.tutor_id);
    a.hwCreatedAt = minDate(a.hwCreatedAt, asg.created_at);
    touchActivity(asg.tutor_id, asg.created_at);
  }

  // Стадия 4: отправил ДЗ (у hsa нет created_at — COALESCE(notified_at, дата ДЗ))
  const saToUserId = new Map<string, string>();
  for (const sa of sas) {
    const userId = assignmentToUserId.get(sa.assignment_id);
    if (!userId) continue;
    saToUserId.set(sa.id, userId);
    const sentAt = sa.notified_at ?? assignmentCreatedAt.get(sa.assignment_id) ?? null;
    if (sentAt) {
      const a = getAgg(userId);
      a.hwSentAt = minDate(a.hwSentAt, sentAt);
      touchActivity(userId, sentAt);
    }
  }

  // Стадия 5: ученик открыл (тред создаётся лениво при первом открытии);
  // фолбэк стадии 6 для старых когорт — thread.status='completed'.
  const threadToUserId = new Map<string, string>();
  for (const th of threads) {
    const userId = saToUserId.get(th.student_assignment_id);
    if (!userId) continue;
    threadToUserId.set(th.id, userId);
    const a = getAgg(userId);
    a.studentOpenedAt = minDate(a.studentOpenedAt, th.created_at);
    if (th.status === "completed") {
      a.studentSubmittedAt = minDate(a.studentSubmittedAt, th.created_at);
    }
  }

  // Стадия 6 + NSM: ученик сдал (submission/answer)
  for (const m of valueMsgs) {
    const userId = threadToUserId.get(m.thread_id);
    if (!userId) continue;
    const a = getAgg(userId);
    a.studentSubmittedAt = minDate(a.studentSubmittedAt, m.created_at);
    a.lastValueAt = maxDate(a.lastValueAt, m.created_at);
    if (m.created_at >= d7) a.valueIn7d = true;
    else if (m.created_at >= d14) a.valueInPrev7d = true;
  }

  // Активность репетитора: его сообщения в тредах за 14 дней
  for (const m of tutorMsgs14d) {
    const userId = threadToUserId.get(m.thread_id);
    if (!userId) continue;
    touchActivity(userId, m.created_at);
  }

  // Стадии 7–8 + MRR: payments уже отфильтрованы (plan='tutor_ai_start', succeeded)
  const paymentsByUserId = new Map<string, PaymentRow[]>();
  for (const p of payments) {
    if (!tutorByUserId.has(p.user_id)) continue;
    const list = paymentsByUserId.get(p.user_id) ?? [];
    list.push(p);
    paymentsByUserId.set(p.user_id, list);
  }

  /** MRR на момент asOf: Σ суммы ПОСЛЕДНЕГО succeeded-платежа каждого репетитора за 35 дней до asOf. */
  const mrrAt = (asOf: Date): number => {
    const to = asOf.toISOString();
    const from = new Date(asOf.getTime() - MRR_WINDOW_DAYS * 864e5).toISOString();
    let sum = 0;
    for (const list of paymentsByUserId.values()) {
      let last: PaymentRow | null = null;
      for (const p of list) {
        if (p.created_at < from || p.created_at > to) continue;
        if (last == null || p.created_at > last.created_at) last = p;
      }
      if (last) sum += Number(last.amount ?? 0);
    }
    return Math.round(sum);
  };

  // ── 3. Сборка PulseTutor ──
  const pulseTutors: PulseTutor[] = tutors.map((t) => {
    const profile = profileByUserId.get(t.user_id);
    const a = agg.get(t.user_id);
    const tutorPayments = paymentsByUserId.get(t.user_id) ?? [];

    const isPaying =
      profile?.subscription_tier === "premium" &&
      (profile.subscription_expires_at == null || profile.subscription_expires_at > nowIso);
    const isTrial = !isPaying && profile?.trial_ends_at != null && profile.trial_ends_at > nowIso;

    const hasTrial = profile?.trial_started_at != null || profile?.trial_ends_at != null;
    const firstPaidAt = tutorPayments.reduce<string | null>((acc, p) => minDate(acc, p.created_at), null);

    const stageDates: Partial<Record<PulseStageKey, string | null>> = {
      registered: t.created_at,
      student_added: a?.studentAddedAt ?? null,
      hw_created: a?.hwCreatedAt ?? null,
      hw_sent: a?.hwSentAt ?? null,
      student_opened: a?.studentOpenedAt ?? null,
      student_submitted: a?.studentSubmittedAt ?? null,
      trial: profile?.trial_started_at ?? null,
      paid: firstPaidAt,
    };

    const reachedFlags = [
      true, // 1 регистрация
      a?.studentAddedAt != null,
      a?.hwCreatedAt != null,
      a?.hwSentAt != null,
      a?.studentOpenedAt != null,
      a?.studentSubmittedAt != null,
      hasTrial,
      firstPaidAt != null,
    ];
    // stage = МАКСИМУМ достигнутого (пропуски ниже не понижают — монотонный funnel)
    let stage = 1;
    for (let k = reachedFlags.length - 1; k >= 0; k--) {
      if (reachedFlags[k]) {
        stage = k + 1;
        break;
      }
    }

    return {
      tutorId: t.id,
      userId: t.user_id,
      name: t.name,
      telegram: (t.telegram_username ?? profile?.telegram_username ?? null)?.replace(/^@/, "") ?? null,
      channel: resolveChannel(profile),
      registeredAt: t.created_at,
      stage,
      stageDates,
      lastActivityAt: a?.lastActivityAt ?? null,
      isPaying: Boolean(isPaying),
      isTrial,
      activeStudents: a?.activeStudents ?? 0,
    };
  });

  // ── 4. Шапка ──
  const payingTutors = pulseTutors.filter((t) => t.isPaying).length;
  const trialTutors = pulseTutors.filter((t) => t.isTrial).length;
  const tutorWAU = pulseTutors.filter((t) => agg.get(t.userId)?.activeIn7d).length;
  const newTutors7d = tutors.filter((t) => t.created_at >= d7).length;
  const newTutorsPrev7d = tutors.filter((t) => t.created_at >= d14 && t.created_at < d7).length;

  const weeklyValueList = pulseTutors.filter((t) => agg.get(t.userId)?.valueIn7d);
  const weeklyValuePrev = pulseTutors.filter((t) => agg.get(t.userId)?.valueInPrev7d).length;

  const mrrNow = mrrAt(now);
  const mrrPrev = mrrAt(new Date(now.getTime() - 7 * 864e5));

  // ── 5. Воронка ──
  const byRegisteredDesc = (a: PulseTutor, b: PulseTutor) => (a.registeredAt < b.registeredAt ? 1 : -1);
  const funnel: PulseStage[] = STAGE_LABELS.map((s, idx) => {
    const k = idx + 1;
    const reached = pulseTutors.filter((t) => t.stage >= k).length;
    // Для финальной стадии «застрявшие» = дошедшие (платящие) — их и показываем.
    const stuck = pulseTutors.filter((t) => t.stage === k).sort(byRegisteredDesc);
    return { key: s.key, label: s.label, reached, stuck };
  });

  // ── 6. Каналы ──
  const channelMap = new Map<string, { kind: PulseChannelKind; label: string; total: number; trials: number; paying: number }>();
  for (const t of pulseTutors) {
    const key = `${t.channel.kind}:${t.channel.label}`;
    const c = channelMap.get(key) ?? { kind: t.channel.kind, label: t.channel.label, total: 0, trials: 0, paying: 0 };
    c.total += 1;
    if (t.isTrial) c.trials += 1;
    if (t.isPaying) c.paying += 1;
    channelMap.set(key, c);
  }
  const channels = Array.from(channelMap.values()).sort((a, b) => b.total - a.total);

  // ── 7. At-risk: платящий/триальный без свежей «ценности» или с ручной меткой риска ──
  const atRisk: PulseAtRiskTutor[] = pulseTutors
    .filter((t) => {
      if (!t.isPaying && !t.isTrial) return false;
      const a = agg.get(t.userId);
      const staleValue = a?.lastValueAt == null || a.lastValueAt < d7;
      const crm = crmByUserId.get(t.userId);
      return staleValue || crm?.risk_status === "at_risk";
    })
    .map((t) => {
      const a = agg.get(t.userId);
      const crm = crmByUserId.get(t.userId);
      const daysSinceValue = a?.lastValueAt
        ? Math.floor((now.getTime() - new Date(a.lastValueAt).getTime()) / 864e5)
        : null;
      return {
        tutorId: t.tutorId,
        userId: t.userId,
        name: t.name,
        isPaying: t.isPaying,
        isTrial: t.isTrial,
        daysSinceValue,
        riskStatus: crm?.risk_status ?? "healthy",
        willingToPay: crm?.willing_to_pay ?? "unknown",
        keyPain: crm?.key_pain ?? null,
      };
    })
    // «никогда не было ценности» — хуже всего, затем по давности
    .sort((a, b) => {
      if ((a.daysSinceValue == null) !== (b.daysSinceValue == null)) return a.daysSinceValue == null ? -1 : 1;
      return (b.daysSinceValue ?? 0) - (a.daysSinceValue ?? 0);
    });

  return {
    generatedAt: nowIso,
    header: {
      payingTutors,
      trialTutors,
      tutorWAU,
      newTutors7d,
      mrr: mrrNow,
      weeklyValueTutors: {
        count: weeklyValueList.length,
        names: weeklyValueList.map((t) => t.name),
      },
      deltas: {
        newTutors: newTutors7d - newTutorsPrev7d,
        weeklyValue: weeklyValueList.length - weeklyValuePrev,
        mrr: mrrNow - mrrPrev,
      },
    },
    funnel,
    channels,
    atRisk,
    totals: { tutors: tutors.length },
  };
}
