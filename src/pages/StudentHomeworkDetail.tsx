import { lazy, Suspense, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import AuthGuard from '@/components/AuthGuard';
import { PageContent } from '@/components/PageContent';
import { useStudentAssignment } from '@/hooks/useStudentHomework';
import { useIsMobile } from '@/hooks/useIsMobile';

const GuidedHomeworkWorkspace = lazy(() => import('@/components/homework/GuidedHomeworkWorkspace'));

/**
 * Student homework assignment detail.
 *
 * **Mobile vs desktop routing (Phase 1 rollout, codex review revision
 * 2026-05-09):** rather than auto-redirecting on mount (which forced
 * mobile users into task #1 regardless of which task they wanted), we
 * mount the legacy `GuidedHomeworkWorkspace` on **all** viewports and
 * intercept its `TaskStepper` clicks via the new `onTaskClickOverride`
 * prop. On mobile, a click on any task in the stepper navigates to the
 * per-task screen at `/student/homework/:hwId/problem/:taskId`; on
 * desktop, the override returns `false` and the workspace switches
 * inline (legacy behavior preserved).
 *
 * Spec: `docs/delivery/features/student-homework-problem-screen/spec.md`
 * AC-2; codex review finding #3.
 */
export default function StudentHomeworkDetail() {
  const { id } = useParams<{ id: string }>();
  const assignmentId = id ?? '';
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const { data, isLoading, error } = useStudentAssignment(assignmentId);

  /**
   * Returns `true` when the workspace should skip its in-place task
   * switch. On mobile we navigate to the per-task screen; on desktop
   * (or when assignmentId is missing) we let the workspace handle it.
   * `useIsMobile` is reactive to viewport resize, so an iPad rotation
   * landscape→portrait flips the override on the next click — matches
   * spec AC-2 «следующем клике задачи».
   */
  const handleTaskClickOverride = useCallback(
    (_orderNum: number, taskId: string): boolean => {
      if (!isMobile) return false;
      if (!assignmentId) return false;
      navigate(`/student/homework/${assignmentId}/problem/${taskId}`);
      return true;
    },
    [isMobile, assignmentId, navigate],
  );

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

  // Guided chat workspace.
  // AuthGuard provides <Navigation /> (fixed, h=4rem) and wraps children in pt-16 pb-20.
  // We use a fixed-position overlay starting below the nav bar to escape the padding
  // wrapper entirely, preventing scrollIntoView from scrolling parent containers.
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
          <GuidedHomeworkWorkspace
            assignment={data}
            onTaskClickOverride={handleTaskClickOverride}
          />
        </Suspense>
      </div>
    </AuthGuard>
  );
}
