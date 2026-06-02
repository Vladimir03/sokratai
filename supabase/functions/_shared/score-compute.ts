// Shared final-score priority chain (student-progress R2 extracted from
// homework-api so the per-student aggregate reuses it — NOT duplicated).
//
// Priority: tutor_score_override → earned_score → ai_score → (completed ? max : 0).
// Mirror of the original homework-api local function; both import this now.

export interface FinalScoreFields {
  tutor_score_override?: number | null;
  earned_score?: number | null;
  ai_score?: number | null;
  status?: string | null;
}

export function computeFinalScore(ts: FinalScoreFields, maxScore: number): number {
  if (ts.tutor_score_override != null) return Number(ts.tutor_score_override);
  if (ts.earned_score != null) return Number(ts.earned_score);
  if (ts.ai_score != null) return Number(ts.ai_score);
  if (ts.status === "completed") return maxScore;
  return 0;
}
