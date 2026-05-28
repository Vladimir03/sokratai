import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { UserX } from 'lucide-react';
import AuthGuard from '@/components/AuthGuard';
import { PageContent } from '@/components/PageContent';
import { useStudentAssignment, useStudentThread } from '@/hooks/useStudentHomework';
import { StudentHomeworkApiError } from '@/lib/studentHomeworkApi';

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

  // NOT_FOUND from GET /assignments/:id/student means the logged-in account
  // isn't linked to this assignment (or it was deleted). Most common cause
  // when a tutor tests: signed in under a different student account than the
  // one the ДЗ was assigned to (the Telegram link is account-agnostic). Show
  // an actionable hint instead of the generic «Не удалось загрузить задание»
  // (2026-05-28). Other errors (network / 500 / session) keep the generic copy.
  const isNotFound =
    error instanceof StudentHomeworkApiError && error.code === 'NOT_FOUND';

  return (
    <AuthGuard>
      <PageContent>
        <main className="container mx-auto px-4 pb-8">
          {isLoading && <p className="text-muted-foreground">Загрузка...</p>}
          {error && isNotFound && (
            <div className="mx-auto mt-6 w-full max-w-md rounded-2xl border border-socrat-border-light bg-white p-6 text-center shadow-sm">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-amber-50">
                <UserX className="h-6 w-6 text-amber-600" aria-hidden="true" />
              </div>
              <h2 className="m-0 text-base font-bold text-slate-900">
                Задание недоступно на этом аккаунте
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                Похоже, это ДЗ назначено на другой аккаунт — или было удалено
                репетитором. Проверьте, что вы вошли под тем аккаунтом (email
                или Telegram), на который репетитор отправил задание.
              </p>
              <button
                type="button"
                onClick={() => navigate('/homework', { replace: true })}
                className="mt-4 inline-flex h-11 items-center justify-center rounded-[12px] bg-socrat-primary px-4 text-sm font-bold text-white transition-colors hover:bg-socrat-primary-dark touch-manipulation"
              >
                К моим заданиям
              </button>
            </div>
          )}
          {error && !isNotFound && (
            <p className="text-destructive">Не удалось загрузить задание</p>
          )}
          {!isLoading && !error && data && (
            <p className="text-muted-foreground">Открываем задачу...</p>
          )}
        </main>
      </PageContent>
    </AuthGuard>
  );
}
