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
import { computePreFunnel, type PulsePreFunnel } from "./metrika.ts";
import { isContentSubject } from "./subjects.ts";

export type { PulsePreFunnel };

// ────────────────────────── Types ──────────────────────────

export type PulseChannelKind = "egor" | "ref" | "web" | "unknown";

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
  | "profile_filled"
  | "trial"
  | "paid";

export interface PulseTutor {
  tutorId: string; // tutors.id
  userId: string; // tutors.user_id (= auth.users.id = profiles.id)
  name: string;
  telegram: string | null;
  channel: PulseChannelInfo;
  registeredAt: string;
  /**
   * 1..6 — максимум достигнутой ПОВЕДЕНЧЕСКОЙ стадии (регистрация → ученик →
   * создал ДЗ → отправил → ученик открыл → ученик сдал). Коммерческий статус
   * (триал/оплата) НАМЕРЕННО не входит (ревью ChatGPT-5.6 P0 #1: триал
   * выдаётся при регистрации автоматически и перепрыгивал бы воронку) —
   * он в isPaying/isTrial и в независимых ступенях funnel[6..7].
   */
  stage: number;
  stageDates: Partial<Record<PulseStageKey, string | null>>;
  lastActivityAt: string | null;
  isPaying: boolean;
  isTrial: boolean;
  activeStudents: number;
  /** Кем приглашён (tutors.referral_code реферера) — для админ ретро-привязки. */
  referredByCode: string | null;
}

export interface PulseStage {
  key: PulseStageKey;
  label: string;
  /**
   * Поведенческие ступени 1..6: достигли ≥ k (монотонно убывает).
   * Коммерческие «trial»/«paid»: НЕЗАВИСИМЫЕ счётчики (когда-либо был триал /
   * когда-либо платил) — монотонность с 1..6 не гарантируется намеренно.
   */
  reached: number;
  /**
   * 1..6: застряли РОВНО здесь (stage === k) — рабочий список «кому написать».
   * «trial»: в триале, но так и не оплатил. «paid»: дошедшие (платившие).
   */
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
    /**
     * ₽, integer — Σ NET-суммы последнего succeeded-платежа plan='tutor_ai_start'
     * за 35 дней. net = amount − возвраты из payment_refunds, известные на
     * момент снапшота (time-aware: недельная Δ показывает момент возврата;
     * миграция 20260715130000).
     */
    mrr: number;
    weeklyValueTutors: { count: number; names: string[] };
    deltas: { newTutors: number; weeklyValue: number; mrr: number };
  };
  funnel: PulseStage[];
  /**
   * Каналы — ИСТОРИЧЕСКИЕ факты (ревью P0 #2): reachedValue = ученик хоть раз
   * сдал ДЗ (стадия 6); paidEver = хоть раз платил (payments, ручные гранты
   * НЕ считаются). Текущий триал как «конверсия канала» не показывается —
   * триал выдаётся при регистрации автоматически.
   */
  channels: Array<{ kind: PulseChannelKind; label: string; total: number; reachedValue: number; paidEver: number }>;
  atRisk: PulseAtRiskTutor[];
  totals: { tutors: number };
  /** Справочник код→имя для админ-диалога «Кто привёл» (ретро-привязка). */
  referralDirectory: Array<{ code: string; name: string }>;
  /**
   * Пре-воронка «до регистрации» из Яндекс.Метрики (агрегаты — имён до
   * регистрации не бывает). available:false = нет METRIKA_API_TOKEN или API
   * недоступен — блок скрывается, остальной Пульс не страдает.
   */
  preFunnel: PulsePreFunnel;
}

// ────────────────────────── Row shapes ──────────────────────────

interface TutorRow {
  id: string;
  user_id: string;
  name: string;
  telegram_username: string | null;
  referral_code: string | null;
  subjects: string[] | null;
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
  referred_by_code: string | null;
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
  id: string;
  user_id: string;
  amount: number | string | null;
  status: string;
  created_at: string;
}

/** Успешный возврат (payment_refunds, миграция 20260715130000). */
interface RefundRow {
  payment_id: string;
  amount: number | string | null;
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

/**
 * Канал привлечения по атрибуции профиля (экспорт: дневной дайджест метит
 * новичков). Приоритет: referral (код коллеги) > egor/promo > ref-source > web.
 * referrerNameByCode — map tutors.referral_code → имя реферера; нерезолвящийся
 * код (мусор от self-update, rule 101 TODO money-версии) проваливается ниже.
 */
export function resolveChannel(
  profile:
    | Pick<ProfileRow, "registration_source" | "promo_code" | "referred_by_code">
    | undefined,
  referrerNameByCode?: Map<string, string>,
): PulseChannelInfo {
  // Нет profiles-строки = отсутствие атрибуции, НЕ органика (ревью P1 #8) —
  // иначе дрейф данных систематически «улучшал» бы органический канал.
  if (!profile) {
    return { kind: "unknown", label: "Без атрибуции" };
  }
  const referredBy = profile.referred_by_code?.trim() ?? "";
  if (referredBy && referrerNameByCode?.has(referredBy)) {
    return { kind: "ref", label: `Реф: ${referrerNameByCode.get(referredBy)}` };
  }
  const source = profile.registration_source?.trim() ?? "";
  const promo = profile.promo_code?.trim() ?? "";
  if (source === "egor" || promo.toUpperCase() === "BLINOV_20") {
    return { kind: "egor", label: "Егор (QR)" };
  }
  if (source && source !== "web" && source !== "manual") {
    return { kind: "ref", label: `Реф: ${source}` };
  }
  return { kind: "web", label: "Органика" };
}

/** Поведенческие ступени: max-достигнутое (цепочка структурно почти последовательна). */
const BEHAVIORAL_STAGES: Array<{ key: PulseStageKey; label: string }> = [
  { key: "registered", label: "Регистрация" },
  { key: "student_added", label: "Добавил ученика" },
  { key: "hw_created", label: "Создал ДЗ" },
  { key: "hw_sent", label: "Отправил ДЗ" },
  { key: "student_opened", label: "Ученик открыл" },
  { key: "student_submitted", label: "Ученик сдал" },
];

/** Коммерческие ступени: независимые счётчики, НЕ входят в max(stage). */
const COMMERCIAL_STAGES: Array<{ key: PulseStageKey; label: string }> = [
  { key: "trial", label: "Триал" },
  { key: "paid", label: "Оплата" },
];

/**
 * «Профиль: предметы» (subject-personalization Ф1, решение владельца 2026-07-23):
 * НЕЗАВИСИМЫЙ счётчик по шаблону trial/paid — НЕ в max(stage). reached =
 * репетиторы с ≥1 контент-предметом в tutors.subjects; stuck (инверсия
 * относительно поведенческих) = НЕзаполнившие — рабочий список «кому написать».
 */
const PROFILE_FILLED_STAGE: { key: PulseStageKey; label: string } = {
  key: "profile_filled",
  label: "Профиль: предметы",
};

const MRR_WINDOW_DAYS = 35;

// ────────────────────────── Aggregation ──────────────────────────

export async function computePulse(db: SupabaseClient, now: Date = new Date()): Promise<PulsePayload> {
  const nowIso = now.toISOString();
  const d7 = new Date(now.getTime() - 7 * 864e5).toISOString();
  const d14 = new Date(now.getTime() - 14 * 864e5).toISOString();

  // ── 0. Пре-воронка из Метрики — параллельно с DB-агрегацией (fail-safe) ──
  const preFunnelPromise = computePreFunnel(now);

  // ── 1. Загрузка (все потенциально растущие таблицы — с пагинацией) ──
  // Все пагинированные выборки — со СТАБИЛЬНЫМ порядком (created_at, id):
  // offset-страницы без детерминированного order могут дублировать/терять
  // строки на границах (ревью P1 #7).
  const tutors = await fetchAll<TutorRow>(
    (from, to) =>
      db
        .from("tutors")
        .select("id, user_id, name, telegram_username, referral_code, subjects, created_at")
        .order("created_at")
        .order("id")
        .range(from, to),
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
      funnel: [...BEHAVIORAL_STAGES, PROFILE_FILLED_STAGE, ...COMMERCIAL_STAGES].map((s) => ({ ...s, reached: 0, stuck: [] })),
      channels: [],
      atRisk: [],
      totals: { tutors: 0 },
      referralDirectory: [],
      preFunnel: await preFunnelPromise,
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
        "id, subscription_tier, subscription_expires_at, trial_started_at, trial_ends_at, promo_code, registration_source, referred_by_code, telegram_username",
      )
      .in("id", chunk);
    if (error) throw new Error(`profiles: ${error.message}`);
    profiles.push(...((data ?? []) as ProfileRow[]));
  }
  const profileByUserId = new Map(profiles.map((p) => [p.id, p]));

  const [tutorStudents, assignments, sas, threads, valueMsgs, tutorMsgs14d, payments, refunds, crmRows] =
    await Promise.all([
    fetchAll<TutorStudentRow>(
      (from, to) =>
        db.from("tutor_students").select("tutor_id, status, archived_at, created_at").order("id").range(from, to),
      "tutor_students",
    ),
    fetchAll<AssignmentRow>(
      (from, to) =>
        db.from("homework_tutor_assignments").select("id, tutor_id, created_at").order("id").range(from, to),
      "assignments",
    ),
    fetchAll<SaRow>(
      (from, to) =>
        db
          .from("homework_tutor_student_assignments")
          .select("id, assignment_id, notified_at")
          .order("id")
          .range(from, to),
      "student_assignments",
    ),
    fetchAll<ThreadRow>(
      (from, to) =>
        db
          .from("homework_tutor_threads")
          .select("id, student_assignment_id, status, created_at")
          .order("id")
          .range(from, to),
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
          .order("id")
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
          .order("id")
          .range(from, to),
      "tutor_messages_14d",
    ),
    fetchAll<PaymentRow>(
      (from, to) =>
        db
          .from("payments")
          .select("id, user_id, amount, status, created_at")
          .eq("plan", "tutor_ai_start")
          .eq("status", "succeeded")
          .order("id")
          .range(from, to),
      "payments",
    ),
    // Возвраты — по датам (ревью р.2 P1 #3): агрегат payments.refunded_amount
    // здесь НЕ используется — он ретроактивно занижал бы исторический
    // снапшот mrrAt(now−7d), и недельная Δ не показывала бы момент возврата.
    fetchAll<RefundRow>(
      (from, to) =>
        db
          .from("payment_refunds")
          .select("payment_id, amount, created_at")
          .eq("status", "succeeded")
          .order("id")
          .range(from, to),
      "payment_refunds",
    ),
    fetchAll<CrmRow>(
      (from, to) =>
        db
          .from("tutor_pilot_crm")
          .select("tutor_user_id, willing_to_pay, risk_status, key_pain")
          .order("tutor_user_id")
          .range(from, to),
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

  // Возвраты по платежу, отсортированные хронологически (для time-aware net)
  const refundsByPaymentId = new Map<string, RefundRow[]>();
  for (const r of refunds) {
    const list = refundsByPaymentId.get(r.payment_id) ?? [];
    list.push(r);
    refundsByPaymentId.set(r.payment_id, list);
  }

  /** Сумма успешных возвратов платежа, известных НА МОМЕНТ asOf. */
  const refundedAsOf = (paymentId: string, toIso: string): number => {
    let sum = 0;
    for (const r of refundsByPaymentId.get(paymentId) ?? []) {
      if (r.created_at <= toIso) sum += Number(r.amount ?? 0);
    }
    return sum;
  };

  /**
   * MRR на момент asOf: Σ NET-суммы ПОСЛЕДНЕГО succeeded-платежа каждого
   * репетитора за 35 дней до asOf. net = amount − возвраты, известные к asOf
   * (time-aware, ревью р.2 P1 #3): исторический снапшот mrrAt(now−7d) НЕ
   * видит сегодняшний возврат → недельная Δ честно показывает падение в
   * момент возврата. Clamp на 0 — вклад платежа не уходит в минус.
   */
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
      if (last) {
        const net = Number(last.amount ?? 0) - refundedAsOf(last.id, to);
        sum += Math.max(net, 0);
      }
    }
    return Math.round(sum);
  };

  // ── 3. Сборка PulseTutor ──
  // Справочник реферальных кодов (код → имя) — резолв канала «Реф: Эмилия»
  // и админ-диалог «Кто привёл». Бесплатно: tutors уже загружены.
  const referrerNameByCode = new Map<string, string>();
  for (const t of tutors) {
    if (typeof t.referral_code === "string" && t.referral_code) {
      referrerNameByCode.set(t.referral_code, t.name);
    }
  }

  // Исторические коммерческие факты (по tutors.id) — для ступеней «Триал»/«Оплата»
  // и channel-конверсии: paidEver = реальный платёж (ручные гранты НЕ входят).
  const trialEverIds = new Set<string>();
  const paidEverIds = new Set<string>();
  // «Профиль: предметы» — считается из данных (tutors.subjects) на момент
  // снапшота, событий не требует (subject-personalization Ф1).
  const profileFilledIds = new Set<string>();

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

    // ТОЛЬКО поведенческие шаги (1..6): триал/оплата не входят (ревью P0 #1 —
    // авто-триал при регистрации перепрыгивал бы всю продуктовую воронку).
    const reachedFlags = [
      true, // 1 регистрация
      a?.studentAddedAt != null,
      a?.hwCreatedAt != null,
      a?.hwSentAt != null,
      a?.studentOpenedAt != null,
      a?.studentSubmittedAt != null,
    ];
    // stage = МАКСИМУМ достигнутого (цепочка 3..6 структурно последовательна;
    // единственный возможный «пропуск» — создал ДЗ без ученика)
    let stage = 1;
    for (let k = reachedFlags.length - 1; k >= 0; k--) {
      if (reachedFlags[k]) {
        stage = k + 1;
        break;
      }
    }

    if (hasTrial) trialEverIds.add(t.id);
    if (firstPaidAt != null) paidEverIds.add(t.id);
    if ((t.subjects ?? []).some(isContentSubject)) profileFilledIds.add(t.id);

    return {
      tutorId: t.id,
      userId: t.user_id,
      name: t.name,
      telegram: (t.telegram_username ?? profile?.telegram_username ?? null)?.replace(/^@/, "") ?? null,
      channel: resolveChannel(profile, referrerNameByCode),
      registeredAt: t.created_at,
      stage,
      stageDates,
      lastActivityAt: a?.lastActivityAt ?? null,
      isPaying: Boolean(isPaying),
      isTrial,
      activeStudents: a?.activeStudents ?? 0,
      referredByCode: profile?.referred_by_code ?? null,
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

  // ── 5. Воронка: 6 поведенческих (монотонных) + 2 независимые коммерческие ──
  const byRegisteredDesc = (a: PulseTutor, b: PulseTutor) => (a.registeredAt < b.registeredAt ? 1 : -1);
  const funnel: PulseStage[] = BEHAVIORAL_STAGES.map((s, idx) => {
    const k = idx + 1;
    const reached = pulseTutors.filter((t) => t.stage >= k).length;
    const stuck = pulseTutors.filter((t) => t.stage === k).sort(byRegisteredDesc);
    return { key: s.key, label: s.label, reached, stuck };
  });
  funnel.push({
    key: PROFILE_FILLED_STAGE.key,
    label: PROFILE_FILLED_STAGE.label,
    reached: profileFilledIds.size,
    // stuck = НЕзаполнившие профиль (инверсия — actionable «кому написать»)
    stuck: pulseTutors
      .filter((t) => !profileFilledIds.has(t.tutorId))
      .sort(byRegisteredDesc),
  });
  funnel.push({
    key: "trial",
    label: "Триал",
    reached: trialEverIds.size,
    // «Застряли на триале» = был триал, но так и не заплатил
    stuck: pulseTutors
      .filter((t) => trialEverIds.has(t.tutorId) && !paidEverIds.has(t.tutorId))
      .sort(byRegisteredDesc),
  });
  funnel.push({
    key: "paid",
    label: "Оплата",
    reached: paidEverIds.size,
    // Дошедшие — когда-либо платившие (не «застрявшие»)
    stuck: pulseTutors.filter((t) => paidEverIds.has(t.tutorId)).sort(byRegisteredDesc),
  });

  // ── 6. Каналы: исторические факты (ревью P0 #2) ──
  const channelMap = new Map<
    string,
    { kind: PulseChannelKind; label: string; total: number; reachedValue: number; paidEver: number }
  >();
  for (const t of pulseTutors) {
    const key = `${t.channel.kind}:${t.channel.label}`;
    const c = channelMap.get(key) ??
      { kind: t.channel.kind, label: t.channel.label, total: 0, reachedValue: 0, paidEver: 0 };
    c.total += 1;
    if (t.stage >= 6) c.reachedValue += 1; // ученик хоть раз сдал ДЗ
    if (paidEverIds.has(t.tutorId)) c.paidEver += 1; // реальный платёж, без грантов
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
    referralDirectory: [...referrerNameByCode.entries()]
      .map(([code, name]) => ({ code, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "ru")),
    preFunnel: await preFunnelPromise,
  };
}
