import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import AuthGuard from '@/components/AuthGuard';
import { PageContent } from '@/components/PageContent';
import { useStudentAssignment, useStudentThread } from '@/hooks/useStudentHomework';

/**
 * Student homework assignment detail — redirect-only route.
 *
 * **Phase 3 routing (2026-05-12):** auto-redirect on ALL viewports. Phase 1
 * gated this behind `useIsMobile()`; Phase 3 unifies tablet + desktop onto
 * the same per-task screen (`/student/homework/:hwId/problem/:taskId`).
 *
 * The redirect target uses a smart fallback chain so the student lands on
 * the most actionable task — never «just task #1» blindly:
 *   1. Current task from the existing thread (`thread.current_task_id`).
 *   2. First task whose `task_state.status !== 'completed'`.
 *   3. First task in the assignment (`tasks[0].id`).
 *
 * Phase 4 cutover (separate spec) will physically delete the legacy
 * `GuidedHomeworkWorkspace` inline rendering, after Phase 3 ships and
 * stabilises. Until then, this component intentionally has no inline
 * fallback branch. Edge cases:
 *   - tasks list empty (after data fetch): redirect to `/homework` so
 *     the user has a real escape path (codex re-review fix 2026-05-12).
 *   - all tasks completed: redirect to `/homework` (preview-QA #10).
 *   - data still loading: render the loading placeholder below; the
 *     useEffect re-fires when data arrives.
 *
 * Spec: `docs/delivery/features/student-homework-problem-screen/spec.md`
 * AC-2 + Phase 3 plan `~/.claude/plans/toasty-weaving-meerkat.md`.
 */
export default function StudentHomeworkDetail() {
  const { id } = useParams<{ id: string }>();
  const assignmentId = id ?? '';
  const navigate = useNavigate();
  const { data, isLoading, error } = useStudentAssignment(assignmentId);
  // Thread fetched for ALL viewports so we can resolve `current_task_id`
  // before redirecting. Codex re-review #1 (major #4) fix preserved: gate
  // redirect on thread query resolution to avoid race past current_task_id
  // and falling through to tasks[0] — the «always task #1» failure mode.
  const {
    data: thread,
    isPending: isThreadPending,
    isFetching: isThreadFetching,
  } = useStudentThread(assignmentId);

  useEffect(() => {
    if (!assignmentId) return;
    if (isThreadPending || isThreadFetching) return;
    const tasks = data?.tasks ?? [];
    // Codex re-review (2026-05-12): after Phase 3 this route is redirect-only.
    // An assignment with zero tasks would park the user on "Открываем
    // задачу..." forever — the screen has no escape path. Redirect back to
    // the list (which renders an empty-state for assignments without tasks).
    if (tasks.length === 0) {
      if (data != null) {
        navigate('/homework', { replace: true });
      }
      // Still loading data: no-op, useEffect will re-fire when data arrives.
      return;
    }

    // Preview-QA #10 (2026-05-11) fix: all-completed early exit.
    // Студент завершил все задачи → HomeworkProblem navigate'ит на
    // `/homework/:hwId` → этот useEffect раньше falls through на
    // `tasks[0]` → reopens task 1 решённого ДЗ. Теперь:
    // если все задачи completed → redirect на список ДЗ (`/homework`).
    const states = thread?.homework_tutor_task_states ?? [];
    const allCompleted =
      thread?.status === 'completed' ||
      (tasks.length > 0 &&
        tasks.every((t) => {
          const s = states.find((st) => st.task_id === t.id);
          return s?.status === 'completed';
        }));
    if (allCompleted) {
      navigate('/homework', { replace: true });
      return;
    }

    // Fallback chain: current → first-not-completed → first.
    let targetTaskId: string | undefined;
    if (thread?.current_task_id) {
      const exists = tasks.find((t) => t.id === thread.current_task_id);
      if (exists) targetTaskId = exists.id;
    }
    if (!targetTaskId) {
      const firstUnfinished = tasks.find((t) => {
        const s = states.find((st) => st.task_id === t.id);
        return !s || s.status !== 'completed';
      });
      if (firstUnfinished) targetTaskId = firstUnfinished.id;
    }
    if (!targetTaskId) {
      targetTaskId = tasks[0].id;
    }
    navigate(`/student/homework/${assignmentId}/problem/${targetTaskId}`, {
      replace: true,
    });
  }, [
    data,
    thread,
    assignmentId,
    navigate,
    isThreadPending,
    isThreadFetching,
  ]);

  return (
    <AuthGuard>
      <PageContent>
        <main className="container mx-auto px-4 pb-8">
          {isLoading && <p className="text-muted-foreground">Загрузка...</p>}
          {error && <p className="text-destructive">Не удалось загрузить задание</p>}
          {!isLoading && !error && data && (
            <p className="text-muted-foreground">Открываем задачу...</p>
          )}
        </main>
      </PageContent>
    </AuthGuard>
  );
}
