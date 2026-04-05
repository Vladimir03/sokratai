import { supabase } from '@/lib/supabaseClient';
import type { RoundResult } from './formulaEngine/types';

export interface FormulaRound {
  id: string;
  assignment_id: string;
  section: string;
  formula_count: number;
  questions_per_round: number;
  lives: number;
  created_at: string;
}

export async function fetchFormulaRound(roundId: string): Promise<FormulaRound> {
  const { data, error } = await supabase
    .from('formula_rounds' as any)
    .select('*')
    .eq('id', roundId)
    .single();

  if (error) throw new Error(error.message);
  return data as unknown as FormulaRound;
}

export async function saveFormulaRoundResult(
  roundId: string,
  result: RoundResult,
): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { error } = await supabase
    .from('formula_round_results' as any)
    .insert({
      round_id: roundId,
      student_id: user.id,
      score: result.score,
      total: result.total,
      lives_remaining: result.livesRemaining,
      completed: result.completed,
      duration_seconds: result.durationSeconds,
      answers: JSON.parse(JSON.stringify(result.answers)),
      weak_formulas: JSON.parse(JSON.stringify(result.weakFormulas)),
    } as any);

  if (error) throw new Error(error.message);
}
