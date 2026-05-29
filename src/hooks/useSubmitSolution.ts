import { useMutation, useQueryClient } from '@tanstack/react-query';
import { submitSolution, type SubmitSolutionPayload } from '@/lib/studentProblemApi';
import type { CheckAnswerResponse } from '@/types/homework';

/**
 * Mutation hook for the SubmitSheet single-shot solution flow.
 *
 * Posts `{numeric, photos, text}` to
 * `POST /student/problem/:hwId/:taskId/submission`. Backend synthesises the
 * answer string + routes through `handleCheckAnswer`, so the response shape
 * matches existing chat-side `checkAnswer` (`CheckAnswerResponse`). The
 * verdict overlay can reuse the same verdict-handling switch.
 *
 * onSuccess invalidates:
 *   - `['student', 'problem', hwId, taskId]` — refetch task_score, hints_used,
 *     and the freshly-grown thread (the submission message + AI verdict are
 *     persisted server-side).
 *   - `['student', 'homework', hwId]` — fan-out catch for any assignment-
 *     scoped queries the assignment-detail screen may keep warm. React Query's
 *     prefix matching handles `['student','homework','assignment',hwId]`,
 *     `['student','homework','thread',hwId]`, etc., as long as they begin with
 *     this prefix; otherwise it's a cheap no-op.
 */
export function useSubmitSolution(
  hwId: string,
  taskId: string,
) {
  const queryClient = useQueryClient();
  return useMutation<CheckAnswerResponse, Error, SubmitSolutionPayload>({
    mutationFn: (payload) => submitSolution(hwId, taskId, payload),
    // Return the invalidation promise so `mutateAsync` settles only AFTER the
    // refetch lands (React Query awaits a promise returned from onSuccess). Без
    // этого voice-submit снимал `speakingPhase` до refetch → на медленной сети
    // кратко мигала кнопка «Отправить» поверх stale data (review P2, 2026-05-29).
    // Также убирает гонку optimistic-removal в SubmitSheet flow.
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['student', 'problem', hwId, taskId],
        }),
        queryClient.invalidateQueries({
          queryKey: ['student', 'homework', hwId],
        }),
      ]),
  });
}
