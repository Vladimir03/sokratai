/**
 * Типы payload'а вкладки «Пульс» — зеркало
 * supabase/functions/_shared/ceo-pulse.ts (repo-конвенция «mirror locally»:
 * Deno-модуль нельзя импортировать в клиент). При изменении shape — править ОБА.
 */

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
  | "trial"
  | "paid";

export interface PulseTutor {
  tutorId: string;
  userId: string;
  name: string;
  telegram: string | null;
  channel: PulseChannelInfo;
  registeredAt: string;
  /** 1..6 — поведенческая стадия; триал/оплата — отдельно (isPaying/isTrial + funnel[6..7]). */
  stage: number;
  stageDates: Partial<Record<PulseStageKey, string | null>>;
  lastActivityAt: string | null;
  isPaying: boolean;
  isTrial: boolean;
  activeStudents: number;
  /** Кем приглашён (tutors.referral_code реферера); может отсутствовать при deploy-skew. */
  referredByCode?: string | null;
}

export interface PulseStage {
  key: PulseStageKey;
  label: string;
  /** 1..6 монотонно («достигли ≥ k»); trial/paid — независимые счётчики. */
  reached: number;
  /** 1..6: застряли ровно здесь; trial: без оплаты; paid: дошедшие. */
  stuck: PulseTutor[];
}

export type PulseWillingToPay = "yes" | "maybe" | "no" | "unknown";
export type PulseRiskStatus = "healthy" | "watch" | "at_risk";

export interface PulseAtRiskTutor {
  tutorId: string;
  userId: string;
  name: string;
  isPaying: boolean;
  isTrial: boolean;
  daysSinceValue: number | null;
  riskStatus: PulseRiskStatus;
  willingToPay: PulseWillingToPay;
  keyPain: string | null;
}

export interface PulseChannelSummary {
  kind: PulseChannelKind;
  label: string;
  total: number;
  /** Исторический факт: ученик хоть раз сдал ДЗ (стадия 6). */
  reachedValue: number;
  /** Исторический факт: хоть раз платил (payments; ручные гранты не считаются). */
  paidEver: number;
}

/** Пре-воронка «до регистрации» из Яндекс.Метрики — агрегаты, анонимно. */
export interface PulsePreFunnel {
  available: boolean;
  landingVisitors7d: number;
  ctaClicks7d: number;
  signupFormOpens7d: number;
  qrVisits7d: number;
  deltas: {
    landingVisitors: number;
    ctaClicks: number;
    signupFormOpens: number;
    qrVisits: number;
  };
  missingGoals: string[];
}

export interface PulsePayload {
  generatedAt: string;
  header: {
    payingTutors: number;
    trialTutors: number;
    tutorWAU: number;
    newTutors7d: number;
    mrr: number;
    weeklyValueTutors: { count: number; names: string[] };
    deltas: { newTutors: number; weeklyValue: number; mrr: number };
  };
  funnel: PulseStage[];
  channels: PulseChannelSummary[];
  atRisk: PulseAtRiskTutor[];
  totals: { tutors: number };
  /** Справочник код→имя для диалога «Кто привёл»; может отсутствовать при deploy-skew. */
  referralDirectory?: Array<{ code: string; name: string }>;
  preFunnel: PulsePreFunnel;
}
