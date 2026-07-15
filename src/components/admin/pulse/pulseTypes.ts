/**
 * Типы payload'а вкладки «Пульс» — зеркало
 * supabase/functions/_shared/ceo-pulse.ts (repo-конвенция «mirror locally»:
 * Deno-модуль нельзя импортировать в клиент). При изменении shape — править ОБА.
 */

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
  tutorId: string;
  userId: string;
  name: string;
  telegram: string | null;
  channel: PulseChannelInfo;
  registeredAt: string;
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
  reached: number;
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
  trials: number;
  paying: number;
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
}
