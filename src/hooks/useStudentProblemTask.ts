import { useQuery } from '@tanstack/react-query';
import { getStudentProblem } from '@/lib/studentProblemApi';

/**
 * React Query hook for the Phase 1 student-side problem screen
 * (`/student/homework/:hwId/problem/:taskId`).
 *
 * Returns single-task surface: assignment meta + task + thread + student
 * identity + computed task_score + hints_used. Backed by
 * `GET /student/problem/:hwId/:taskId`.
 *
 * `staleTime: 0` — the screen is interactive (chat updates, submissions
 * change state); we want a fresh fetch on every mount so the user never
 * sees stale verdict counts. `retry: 1` covers transient network blips
 * without burning UX time on dead endpoints.
 */
export function useStudentProblemTask(
  hwId: string | undefined,
  taskId: string | undefined,
) {
  return useQuery({
    queryKey: ['student', 'problem', hwId, taskId] as const,
    queryFn: () => getStudentProblem(hwId as string, taskId as string),
    enabled: Boolean(hwId) && Boolean(taskId),
    staleTime: 0,
    retry: 1,
  });
}
