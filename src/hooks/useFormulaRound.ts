import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchFormulaRound,
  fetchFormulaRoundResults,
  saveFormulaRoundResult,
} from '@/lib/formulaRoundApi';
import type { RoundResult } from '@/lib/formulaEngine/types';

export function useFormulaRound(roundId: string) {
  return useQuery({
    queryKey: ['formula-round', roundId],
    queryFn: () => fetchFormulaRound(roundId),
    enabled: Boolean(roundId),
    staleTime: 5 * 60 * 1000,
  });
}

export function useFormulaRoundResults(roundId: string) {
  return useQuery({
    queryKey: ['formula-round', roundId, 'results'],
    queryFn: () => fetchFormulaRoundResults(roundId),
    enabled: Boolean(roundId),
  });
}

export function useSaveFormulaRoundResult() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ roundId, result }: { roundId: string; result: RoundResult }) =>
      saveFormulaRoundResult(roundId, result),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: ['formula-round', variables.roundId, 'results'],
      });
    },
  });
}
