import { lazy, Suspense, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import AuthGuard from '@/components/AuthGuard';
import { PageContent } from '@/components/PageContent';
import { useStudentAssignment, useStudentThread } from '@/hooks/useStudentHomework';
import { useIsMobile } from '@/hooks/useIsMobile';

const GuidedHomeworkWorkspace = lazy(() => import('@/components/homework/GuidedHomeworkWorkspace'));

/**
 * Student homework assignment detail.
 *
 * **Mobile vs desktop routing (Phase 1.x rollout, revised 2026-05-10 after
 * preview QA #1):** on mobile (`useIsMobile()` ≤768px) the page redirects
 * immediately to the new per-task screen. On desktop we mount the legacy
 * `GuidedHomeworkWorkspace` inline.
 *
 * The redirect target uses a smart fallback chain so the student lands on
 * the most actionable task — never «just task #1» blindly:
 *   1. Current task from the existing thread (`thread.current_task_id`).
 *   2. First task whose `task_state.status !== 'completed'`.
 *   3. First task in the assignment (`tasks[0].id`).
 *
 * Rationale: the previous click-intercept flow (codex re-review #3 fix)
 * confused students who landed on the legacy stepper and didn't realise
 * they had to tap a circle to enter the new UI. With auto-redirect we get
 * the new screen on every mobile open; per-task switching inside the new
 * screen happens via the new HomeworkProblem step indicator (Q7).
 *
 * Spec: `docs/delivery/features/student-homework-problem-screen/spec.md`
 * AC-2 (revision 2026-05-10).
 */
export default function StudentHomeworkDetail() {
  const { id } = useParams<{ id: string }>();
  const assignmentId = id ?? '';
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const { data, isLoading, error } = useStudentAssignment(assignmentId);
  // Thread fetched only on mobile so we can resolve `current_task_id`
  // before redirecting. Disabled on desktop — the legacy workspace owns
  // its own thread query.
  const { data: thread } = useStudentThread(isMobile ? assignmentId : '');

  useEffect(() => {
    if (!isMobile) return;
    if (!assignmentId) return;
    const tasks = data?.tasks ?? [];
    if (tasks.length === 0) return;

    // Fallback chain: current → first-not-completed → first.
    let targetTaskId: string | undefined;
    if (thread?.current_task_id) {
      const exists = tasks.find((t) => t.id === thread.current_task_id);
      if (exists) targetTaskId = exists.id;
    }
    if (!targetTaskId) {
      const states = thread?.homework_tutor_task_states ?? [];
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
  }, [isMobile, data, thread, assignmentId, navigate]);

  if (isLoading || !data) {
    return (
      <AuthGuard>
        <PageContent>
          <main className="container mx-auto px-4 pb-8">
            {isLoading && <p className="text-muted-foreground">Загрузка...</p>}
            {error && <p className="text-destructive">Не удалось загрузить задание</p>}
          </main>
        </PageContent>
      </AuthGuard>
    );
  }

  if (isMobile) {
    return (
      <AuthGuard>
        <PageContent>
          <main className="container mx-auto px-4 pb-8">
            <p className="text-muted-foreground">Открываем задачу...</p>
          </main>
        </PageContent>
      </AuthGuard>
    );
  }

  return (
    <AuthGuard>
      <div className="fixed inset-x-0 bottom-0 z-40 bg-background flex flex-col overflow-hidden top-14">
        <Suspense
          fallback={
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              Загрузка...
            </div>
          }
        >
          <GuidedHomeworkWorkspace assignment={data} />
        </Suspense>
      </div>
    </AuthGuard>
  );
}
