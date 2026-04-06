import { StudentHomeworkApiError } from '@/lib/studentHomeworkApi';
import { supabase } from '@/lib/supabaseClient';
import type { AnswerRecord, RoundResult, WeakFormula } from './formulaEngine/types';

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || 'https://vrsseotrfmsxpbciyqzc.supabase.co';
const SUPABASE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZyc3Nlb3RyZm1zeHBiY2l5cXpjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk0MjEzMDYsImV4cCI6MjA3NDk5NzMwNn0.fDleU99ULnIvtbiJqlKtgaabZzIWqqw6gZLWQOFAcKw';

export interface FormulaRound {
  id: string;
  assignment_id: string;
  section: string;
  formula_count: number;
  questions_per_round: number;
  lives: number;
  created_at: string;
}

export interface FormulaRoundResultRecord {
  id: string;
  round_id: string;
  student_id: string;
  score: number;
  total: number;
  lives_remaining: number;
  completed: boolean;
  duration_seconds: number | null;
  answers: AnswerRecord[];
  weak_formulas: WeakFormula[] | null;
  created_at: string;
}

export interface SaveFormulaRoundResultResponse {
  id: string;
  created_at: string;
}

async function requestFormulaRoundApi<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;

  if (!token) {
    throw new StudentHomeworkApiError('Нет активной сессии');
  }

  const response = await fetch(`${SUPABASE_URL}/functions/v1/homework-api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_KEY,
      ...(options.headers ?? {}),
    },
  });

  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const body = await response.json();
      const errorMessage = body?.error?.message;
      if (typeof errorMessage === 'string' && errorMessage.trim().length > 0) {
        message = errorMessage;
      }
    } catch {
      // ignore parse errors
    }
    throw new StudentHomeworkApiError(message);
  }

  return response.json() as Promise<T>;
}

export async function fetchFormulaRound(roundId: string): Promise<FormulaRound> {
  return requestFormulaRoundApi<FormulaRound>(
    `/formula-rounds/${encodeURIComponent(roundId)}`,
  );
}

export async function fetchFormulaRoundResults(
  roundId: string,
): Promise<FormulaRoundResultRecord[]> {
  return requestFormulaRoundApi<FormulaRoundResultRecord[]>(
    `/formula-rounds/${encodeURIComponent(roundId)}/results`,
  );
}

export async function saveFormulaRoundResult(
  roundId: string,
  result: RoundResult,
): Promise<SaveFormulaRoundResultResponse> {
  return requestFormulaRoundApi<SaveFormulaRoundResultResponse>(
    `/formula-rounds/${encodeURIComponent(roundId)}/results`,
    {
      method: 'POST',
      body: JSON.stringify({
        score: result.score,
        total: result.total,
        livesRemaining: result.livesRemaining,
        completed: result.completed,
        durationSeconds: result.durationSeconds,
        answers: result.answers,
        weakFormulas: result.weakFormulas,
      }),
    },
  );
}
