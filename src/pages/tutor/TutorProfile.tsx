import { Skeleton } from '@/components/ui/skeleton';
import { TutorIdentitySection } from '@/components/tutor/profile/TutorIdentitySection';
import { useTutorProfile } from '@/hooks/useTutorProfile';

/**
 * /tutor/profile — single page combining all profile sections.
 *
 * Spec:    docs/delivery/features/tutor-profile/spec.md (v0.2 §6)
 * Tasks:   docs/delivery/features/tutor-profile/tasks.md TASK-5
 *
 * AppFrame already provides TutorGuard + sokrat-mode wrapper + Suspense
 * boundary (see CLAUDE.md «Tutor Chrome (AppFrame + SideNav)»). This page
 * intentionally does NOT re-wrap any of that — it just exports its content.
 *
 * Sections render top-to-bottom in spec order:
 *   1. Identity   (TASK-5, this commit)
 *   2. Subjects   (TASK-13, placeholder below)
 *   3. Security   (TASK-12, placeholder below)
 */
export default function TutorProfile() {
  const profileQuery = useTutorProfile();

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Профиль</h1>
        <p className="mt-1 text-sm text-slate-500">
          Имя и фото видны ученикам в чате с домашним заданием.
        </p>
      </header>

      {profileQuery.isLoading ? (
        <ProfileSkeleton />
      ) : profileQuery.error ? (
        <ProfileError message={(profileQuery.error as Error)?.message ?? 'Не удалось загрузить профиль'} />
      ) : (
        <div className="flex flex-col gap-4">
          <TutorIdentitySection profile={profileQuery.data ?? null} />

          {/*
            TODO TASK-13: <SubjectsMultiSelect /> — secondary section using
            the same useUpsertTutorProfile mutation. Will read profile?.subjects
            and write back via upsert with name/gender unchanged.
          */}

          {/*
            TODO TASK-12: <SecuritySection /> — email + password rows backed
            by the new tutor-account edge function. Phase 4 (TASK-18) will
            extend it into a 3-state Email/Password/Google branch.
          */}
        </div>
      )}
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-live="polite">
      <div className="rounded-lg border border-border bg-card p-6">
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="mt-2 h-4 w-2/3" />
        <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-[auto,1fr]">
          <Skeleton className="h-[120px] w-[120px] rounded-full" />
          <div className="flex flex-col gap-4">
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full max-w-[280px]" />
            <Skeleton className="h-11 w-32 self-end" />
          </div>
        </div>
      </div>
    </div>
  );
}

interface ProfileErrorProps {
  message: string;
}

function ProfileError({ message }: ProfileErrorProps) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"
    >
      <p className="font-medium">Не удалось загрузить профиль</p>
      <p className="mt-1 text-red-700">{message}</p>
    </div>
  );
}
