import { useQuery, useMutation } from '@tanstack/react-query';
import { fetchFormulaRound, saveFormulaRoundResult } from '@/lib/formulaRoundApi';
import type { RoundResult } from '@/lib/formulaEngine/types';

export function useFormulaRound(roundId: string) {
  return useQuery({
    queryKey: ['formula-round', roundId],
    queryFn: () => fetchFormulaRound(roundId),
    enabled: Boolean(roundId),
    staleTime: 5 * 60 * 1000,
  });
}

export function useSaveFormulaRoundResult() {
  return useMutation({
    mutationFn: ({ roundId, result }: { roundId: string; result: RoundResult }) =>
      saveFormulaRoundResult(roundId, result),
  });
}
