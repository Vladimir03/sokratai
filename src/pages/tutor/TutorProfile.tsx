import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { LoginProvidersSection } from '@/components/tutor/profile/LoginProvidersSection';
import { SecuritySection } from '@/components/tutor/profile/SecuritySection';
import { SubjectsMultiSelect } from '@/components/tutor/profile/SubjectsMultiSelect';
import { TutorIdentitySection } from '@/components/tutor/profile/TutorIdentitySection';
import { useTutorProfile, useUpsertTutorProfile } from '@/hooks/useTutorProfile';
import type { TutorProfile as TutorProfileModel } from '@/lib/tutorProfileApi';
import { SUBJECTS } from '@/types/homework';

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
 *   1. Identity   (TASK-5)
 *   2. Subjects   (TASK-13)
 *   3. Security   (TASK-12 — email/password rows, Telegram read-only)
 */
export default function TutorProfile() {
  const profileQuery = useTutorProfile();
  const profile = profileQuery.data ?? null;

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
          <TutorIdentitySection profile={profile} />

          <TutorSubjectsSection profile={profile} />

          <SecuritySection />

          <LoginProvidersSection />
        </div>
      )}
    </div>
  );
}

interface TutorSubjectsSectionProps {
  profile: TutorProfileModel | null;
}

function TutorSubjectsSection({ profile }: TutorSubjectsSectionProps) {
  const upsertMutation = useUpsertTutorProfile();
  const savedSubjectsKey = useMemo(
    () => serializeSubjects(profile?.subjects ?? []),
    [profile?.subjects],
  );
  const savedSubjects = useMemo(() => parseSubjects(savedSubjectsKey), [savedSubjectsKey]);
  const [subjectsDraft, setSubjectsDraft] = useState<string[]>(savedSubjects);

  useEffect(() => {
    setSubjectsDraft(savedSubjects);
  }, [savedSubjects]);

  const draftSubjectsKey = useMemo(() => serializeSubjects(subjectsDraft), [subjectsDraft]);
  const isDirty = draftSubjectsKey !== savedSubjectsKey;
  const isSaving = upsertMutation.isPending;
  const canSubmit = isDirty && !isSaving;

  const handleSaveSubjects = async () => {
    if (!canSubmit) return;

    const savedName = profile?.name?.trim() ?? '';
    if (!savedName) {
      toast.error('Сначала заполните имя и сохраните профиль');
      return;
    }

    try {
      await upsertMutation.mutateAsync({
        name: savedName,
        gender: profile?.gender ?? null,
        subjects: subjectsDraft,
      });
      toast.success('Предметы сохранены');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось сохранить предметы';
      toast.error(message);
    }
  };

  return (
    <section aria-label="Предметы" className="rounded-lg border border-border bg-card p-4 sm:p-6">
      <SubjectsMultiSelect value={subjectsDraft} onChange={setSubjectsDraft} />

      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
        <Button
          type="button"
          disabled={!canSubmit}
          onClick={handleSaveSubjects}
          className="min-h-[44px] gap-2 bg-accent text-white hover:bg-accent/90 sm:min-w-[160px]"
        >
          {isSaving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          Сохранить
        </Button>
      </div>
    </section>
  );
}

// Canonical-order serialization keeps the dirty-check stable regardless of
// how subjects are stored in `tutors.subjects` (DB array order is not
// guaranteed to match SUBJECTS list order). Pair this with the matching
// canonicalization inside SubjectsMultiSelect.toggleSubject.
function serializeSubjects(subjects: string[]): string {
  const set = new Set(subjects);
  const canonical = SUBJECTS.filter((subject) => set.has(subject.id)).map(
    (subject) => subject.id,
  );
  return JSON.stringify(canonical);
}

function parseSubjects(subjectsKey: string): string[] {
  const parsed = JSON.parse(subjectsKey) as unknown;
  return Array.isArray(parsed)
    ? parsed.filter((subject): subject is string => typeof subject === 'string')
    : [];
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
