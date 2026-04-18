import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { daysBetween, todayLocalKey } from '@/lib/trainerGamification/dateKey';
import { trackTrainerEvent } from '@/lib/trainerGamification/telemetry';
import {
  DAILY_GOAL_ROUNDS,
  computeRoundXp,
  type XpBreakdown,
} from '@/lib/trainerGamification/xpCalculator';

export type SectionKey =
  | 'all'
  | 'kinematics'
  | 'dynamics'
  | 'conservation'
  | 'statics'
  | 'hydrostatics';

export interface TrainerGamificationState {
  totalXp: number;
  currentStreak: number;
  longestStreak: number;
  /** 'YYYY-MM-DD' in local time of the last round played */
  lastPlayedDate: string | null;
  /** Resets to 0 on first round of a new day */
  dailyRoundsCount: number;
  /** 'YYYY-MM-DD' attached to dailyRoundsCount — used to detect day rollover */
  dailyDate: string | null;
  bestScoreBySection: Partial<Record<SectionKey, number>>;
  bestCombo: number;
  version: 1;
}

export interface RoundOutcome {
  section: SectionKey;
  correctCount: number;
  totalCount: number;
  bestComboInRound: number;
  /** «Повторить ошибки» = true. Forces isNewBest → false, multiplies XP by 0.5. */
  isRetryMode: boolean;
}

export interface AppliedOutcome {
  /** Final XP earned this round (already multiplied by retry factor). */
  xpEarned: number;
  xpBreakdown: XpBreakdown;
  isNewBest: boolean;
  isPerfectRound: boolean;
  /** Fires only on the round that crosses the daily threshold. */
  isDailyGoalReached: boolean;
  dailyRoundsCount: number;
  streakAfter: number;
  /** True when streak incremented (+1) due to this round. Reset-to-1 is NOT a gain. */
  streakGained: boolean;
}

interface Actions {
  applyRoundResult: (outcome: RoundOutcome) => AppliedOutcome;
  /** Dev-only: wipe all gamification state. */
  reset: () => void;
}

export type TrainerGamificationStore = TrainerGamificationState & Actions;

const INITIAL_STATE: TrainerGamificationState = {
  totalXp: 0,
  currentStreak: 0,
  longestStreak: 0,
  lastPlayedDate: null,
  dailyRoundsCount: 0,
  dailyDate: null,
  bestScoreBySection: {},
  bestCombo: 0,
  version: 1,
};

export const useTrainerGamificationStore = create<TrainerGamificationStore>()(
  persist(
    (set, get) => ({
      ...INITIAL_STATE,

      applyRoundResult: (outcome) => {
        const state = get();
        const today = todayLocalKey();

        // ── 1. Day rollover ──────────────────────────────────────────────────
        const isNewDay = state.dailyDate !== today;
        const dailyCountBefore = isNewDay ? 0 : state.dailyRoundsCount;
        const newDailyRoundsCount = dailyCountBefore + 1;
        const isFirstRoundOfDay = dailyCountBefore === 0;

        // ── 2. Streak update (spec §5.4) ─────────────────────────────────────
        let streakAfter = state.currentStreak;
        let streakGained = false;

        if (isFirstRoundOfDay) {
          if (state.lastPlayedDate === null) {
            // First-ever round → start streak at 1.
            streakAfter = 1;
            streakGained = true;
          } else {
            const days = daysBetween(state.lastPlayedDate, today);
            if (days === 1) {
              streakAfter = state.currentStreak + 1;
              streakGained = true;
            } else if (days <= 0) {
              // Defensive: lastPlayedDate === today but dailyDate !== today
              // (e.g. user cleared dailyDate manually). Treat as same-day continuation.
              streakAfter = Math.max(state.currentStreak, 1);
            } else {
              // days > 1 → streak broke.
              if (state.currentStreak > 0) {
                trackTrainerEvent('trainer_streak_broken', {
                  streakLost: state.currentStreak,
                  daysSinceLastPlay: days,
                });
              }
              streakAfter = 1;
              streakGained = false;
            }
          }
        }
        // else: 2nd+ round of same day → streak unchanged.

        // ── 3. XP calculation with two-pass newBest detection ────────────────
        // We need to know isNewBest before computing the final XP, but isNewBest
        // depends on XP vs previous best. Resolve by comparing the pre-newBest
        // subtotal against the current best — that's the "earned without bonus"
        // figure the user actually beat.
        const baseComputation = computeRoundXp({
          correctCount: outcome.correctCount,
          totalCount: outcome.totalCount,
          bestComboInRound: outcome.bestComboInRound,
          isNewBest: false,
          isRetry: outcome.isRetryMode,
        });

        const currentBest = state.bestScoreBySection[outcome.section] ?? 0;
        const isNewBest =
          !outcome.isRetryMode && baseComputation.total > currentBest;

        const finalComputation = isNewBest
          ? computeRoundXp({
              correctCount: outcome.correctCount,
              totalCount: outcome.totalCount,
              bestComboInRound: outcome.bestComboInRound,
              isNewBest: true,
              isRetry: outcome.isRetryMode,
            })
          : baseComputation;

        const xpEarned = finalComputation.total;

        // ── 4. Flags for UI / celebrate / telemetry ──────────────────────────
        const isPerfectRound =
          outcome.totalCount > 0 && outcome.correctCount === outcome.totalCount;
        const isDailyGoalReached =
          dailyCountBefore < DAILY_GOAL_ROUNDS &&
          newDailyRoundsCount >= DAILY_GOAL_ROUNDS;

        // ── 5. Commit new state ──────────────────────────────────────────────
        const nextBestScoreBySection = isNewBest
          ? { ...state.bestScoreBySection, [outcome.section]: xpEarned }
          : state.bestScoreBySection;

        const nextBestCombo = Math.max(state.bestCombo, outcome.bestComboInRound);
        const nextLongestStreak = Math.max(state.longestStreak, streakAfter);

        set({
          totalXp: state.totalXp + xpEarned,
          currentStreak: streakAfter,
          longestStreak: nextLongestStreak,
          lastPlayedDate: today,
          dailyRoundsCount: newDailyRoundsCount,
          dailyDate: today,
          bestScoreBySection: nextBestScoreBySection,
          bestCombo: nextBestCombo,
        });

        return {
          xpEarned,
          xpBreakdown: finalComputation.breakdown,
          isNewBest,
          isPerfectRound,
          isDailyGoalReached,
          dailyRoundsCount: newDailyRoundsCount,
          streakAfter,
          streakGained,
        };
      },

      reset: () => set({ ...INITIAL_STATE }),
    }),
    {
      name: 'sokrat-trainer-gamification-v1',
      version: 1,
      // Persist the state slice only — actions are re-attached by create().
      partialize: (state) => ({
        totalXp: state.totalXp,
        currentStreak: state.currentStreak,
        longestStreak: state.longestStreak,
        lastPlayedDate: state.lastPlayedDate,
        dailyRoundsCount: state.dailyRoundsCount,
        dailyDate: state.dailyDate,
        bestScoreBySection: state.bestScoreBySection,
        bestCombo: state.bestCombo,
        version: state.version,
      }),
      migrate: (persisted, version) => {
        // Placeholder for future schema changes. On first rollout there is no
        // v0 → v1 migration; return persisted state as-is when versions match,
        // fall back to initial state for anything unexpected.
        if (version === 1 && persisted && typeof persisted === 'object') {
          return persisted as TrainerGamificationState;
        }
        return { ...INITIAL_STATE };
      },
    },
  ),
);
