declare global {
  interface Window {
    ym?: (counterId: number, method: string, ...args: unknown[]) => void;
  }
}

const COUNTER_ID = 105827612;

export type TutorLandingGoal =
  | "tutor_landing_cta_hero"
  | "tutor_landing_cta_tour1"
  | "tutor_landing_cta_pricing"
  | "tutor_landing_cta_final"
  | "tutor_landing_tg_channel_click";

export function trackTutorLandingGoal(goal: TutorLandingGoal) {
  try {
    window.ym?.(COUNTER_ID, "reachGoal", goal);
  } catch {
    // Metrika не загружена — fail silently.
  }
}
