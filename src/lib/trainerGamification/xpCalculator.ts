export const XP_BASE = 10;
export const XP_ACCURACY_MAX = 20;
export const XP_COMBO_MULTIPLIER = 2;
export const XP_COMBO_CAP = 20;
export const XP_PERFECT_ROUND = 30;
export const XP_NEW_BEST = 20;
export const RETRY_MULTIPLIER = 0.5;
export const DAILY_GOAL_ROUNDS = 2;

export interface XpBreakdown {
  base: number;
  accuracy: number;
  combo: number;
  perfect: number;
  newBest: number;
  retryMultiplier: number;
}

export interface XpComputation {
  total: number;
  breakdown: XpBreakdown;
}

export interface ComputeRoundXpParams {
  correctCount: number;
  totalCount: number;
  bestComboInRound: number;
  isNewBest: boolean;
  isRetry: boolean;
}

/**
 * Pure XP calculation — see spec §5.3.
 *
 *   base        = 10
 *   accuracy    = round((correct / total) * 20)   // 0 when total === 0
 *   combo       = min(bestCombo * 2, 20)
 *   perfect     = (correct === total && total > 0) ? 30 : 0
 *   newBest     = isNewBest ? 20 : 0              // caller must enforce !isRetry
 *   subtotal    = base + accuracy + combo + perfect + newBest
 *   multiplier  = isRetry ? 0.5 : 1.0
 *   total       = floor(subtotal * multiplier)
 */
export function computeRoundXp(params: ComputeRoundXpParams): XpComputation {
  const {
    correctCount,
    totalCount,
    bestComboInRound,
    isNewBest,
    isRetry,
  } = params;

  const base = XP_BASE;

  const accuracyRatio =
    totalCount > 0 ? Math.max(0, Math.min(correctCount, totalCount)) / totalCount : 0;
  const accuracy = Math.round(accuracyRatio * XP_ACCURACY_MAX);

  const comboRaw = Math.max(0, bestComboInRound) * XP_COMBO_MULTIPLIER;
  const combo = Math.min(comboRaw, XP_COMBO_CAP);

  const perfect =
    totalCount > 0 && correctCount === totalCount ? XP_PERFECT_ROUND : 0;

  const newBest = isNewBest ? XP_NEW_BEST : 0;

  const retryMultiplier = isRetry ? RETRY_MULTIPLIER : 1.0;

  const subtotal = base + accuracy + combo + perfect + newBest;
  const total = Math.floor(subtotal * retryMultiplier);

  return {
    total,
    breakdown: {
      base,
      accuracy,
      combo,
      perfect,
      newBest,
      retryMultiplier,
    },
  };
}
