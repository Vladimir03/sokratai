declare global {
  interface Window {
    ym?: (counterId: number, method: string, ...args: unknown[]) => void;
  }
}

const COUNTER_ID = 105827612;

export type TutorLandingGoal =
  // ⚠️ DEPRECATED (аудит 2026-07-20): три цели ниже НЕ вызываются нигде —
  // при внедрении триала их заменили на cta_trial_*. Из CTA_GOAL_NAMES
  // (metrika.ts) они убраны, поэтому новый вызов с этими именами Пульс
  // считать НЕ будет. Нужна новая точка замера — заводи новое имя.
  | "tutor_landing_cta_hero" // deprecated → cta_trial_hero
  | "tutor_landing_cta_pricing" // deprecated → cta_trial_pricing
  | "tutor_landing_cta_final" // deprecated → cta_trial_final
  | "tutor_landing_cta_tour1" // existing
  | "tutor_landing_tg_channel_click" // existing
  | "tutor_landing_cta_trial_hero" // P0 — Hero CTA
  | "tutor_landing_cta_trial_pricing" // P0 — Pricing AI-старт CTA
  | "tutor_landing_cta_trial_final" // P0 — FinalCTA
  | "tutor_landing_trial_signup_started" // P0 — TutorSignupTrial mount
  | "tutor_landing_trial_signup_completed" // P0 — успешный signup
  | "tutor_landing_community_tg_click" // community-CTA (SocialProof + Footer)
  | "tutor_landing_community_vk_click"; // community-CTA (SocialProof + Footer)

export function trackTutorLandingGoal(goal: TutorLandingGoal) {
  try {
    window.ym?.(COUNTER_ID, "reachGoal", goal);
  } catch {
    // Metrika не загружена — fail silently.
  }
}
