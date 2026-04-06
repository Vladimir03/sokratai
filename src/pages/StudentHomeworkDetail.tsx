import { lazy, Suspense } from 'react';
import { useParams } from 'react-router-dom';
import AuthGuard from '@/components/AuthGuard';
import { PageContent } from '@/components/PageContent';
import { useStudentAssignment } from '@/hooks/useStudentHomework';

const GuidedHomeworkWorkspace = lazy(() => import('@/components/homework/GuidedHomeworkWorkspace'));

export default function StudentHomeworkDetail() {
  const { id } = useParams<{ id: string }>();
  const assignmentId = id ?? '';
  const { data, isLoading, error } = useStudentAssignment(assignmentId);

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
          <GuidedHomeworkWorkspace assignment={data} />
        </Suspense>
      </div>
    </AuthGuard>
  );
}
