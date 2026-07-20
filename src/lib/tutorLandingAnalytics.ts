declare global {
  interface Window {
    ym?: (counterId: number, method: string, ...args: unknown[]) => void;
  }
}

const COUNTER_ID = 105827612;

export type TutorLandingGoal =
  | "tutor_landing_cta_hero" // existing
  | "tutor_landing_cta_tour1" // existing
  | "tutor_landing_cta_pricing" // existing
  | "tutor_landing_cta_final" // existing
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
