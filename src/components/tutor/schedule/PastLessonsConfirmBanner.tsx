// PastLessonsConfirmBanner — баннер на /tutor/schedule «Прошедшие занятия (N) —
// подтвердите» (schedule-bulk-complete CC-B). Self-contained: свой запрос прошедших
// regular booked занятий (14д окно, +3ч буфер; useTutorLessons week-scoped не годится),
// открывает lazy ConfirmLessonsSheet. Деньги создаются только на «Подтвердить» (CC-A RPC).

import { lazy, memo, Suspense, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { parseISO } from 'date-fns';
import { CalendarClock } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { supabase } from '@/lib/supabaseClient';
import { useTutor } from '@/hooks/useTutor';
import type { TutorLessonWithStudent } from '@/types/tutor';

const ConfirmLessonsSheet = lazy(() =>
  import('./ConfirmLessonsSheet').then((m) => ({ default: m.ConfirmLessonsSheet })),
);

const PAST_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const END_BUFFER_MS = 3 * 60 * 60 * 1000;

const PAST_LESSON_SELECT = `
  id, start_at, duration_min, status, lesson_type, subject,
  group_session_id, group_title_snapshot, student_id, tutor_student_id,
  tutor_students ( id, student_id, hourly_rate_cents, profiles ( id, username, telegram_username ) ),
  profiles ( id, username, telegram_username )
`;

function pluralLessons(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} прошедшее занятие`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${n} прошедших занятия`;
  return `${n} прошедших занятий`;
}

interface PastLessonsConfirmBannerProps {
  onOpenMaterials: (lesson: TutorLessonWithStudent) => void;
}

export const PastLessonsConfirmBanner = memo(function PastLessonsConfirmBanner({
  onOpenMaterials,
}: PastLessonsConfirmBannerProps) {
  const { tutor } = useTutor();
  const tutorId = tutor?.id ?? null;
  const [dismissed, setDismissed] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  // computed once on mount (numeric Date ctor — rule 80 safe, not string parse)
  const sinceIso = useMemo(() => new Date(Date.now() - PAST_WINDOW_MS).toISOString(), []);

  const { data } = useQuery({
    queryKey: ['tutor', 'lessons', 'past-unconfirmed', tutorId],
    enabled: !!tutorId,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<TutorLessonWithStudent[]> => {
      const { data: rows, error } = await supabase
        .from('tutor_lessons')
        .select(PAST_LESSON_SELECT)
        .eq('tutor_id', tutorId!)
        .eq('status', 'booked')
        .eq('lesson_type', 'regular')
        .gte('start_at', sinceIso)
        .order('start_at', { ascending: false });
      if (error) throw error;
      return (rows ?? []) as unknown as TutorLessonWithStudent[];
    },
  });

  // Only lessons that ended > 3h ago (rule 80: parseISO, no Array.at).
  const pastLessons = useMemo(() => {
    const now = Date.now();
    return (data ?? []).filter((l) => {
      try {
        const end = parseISO(l.start_at).getTime() + (l.duration_min ?? 60) * 60000;
        return Number.isFinite(end) && end + END_BUFFER_MS < now;
      } catch {
        return false;
      }
    });
  }, [data]);

  if (dismissed || pastLessons.length === 0) return null;

  return (
    <>
      <Alert className="border-amber-200 bg-amber-50">
        <CalendarClock className="h-4 w-4 text-amber-600" />
        <AlertDescription className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-amber-900">
            {pluralLessons(pastLessons.length)} — отметить проведёнными?
          </span>
          <div className="flex shrink-0 gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-amber-700 hover:bg-amber-100"
              style={{ touchAction: 'manipulation' }}
              onClick={() => setDismissed(true)}
            >
              Позже
            </Button>
            <Button
              size="sm"
              className="bg-amber-600 text-white hover:bg-amber-700"
              style={{ touchAction: 'manipulation' }}
              onClick={() => setSheetOpen(true)}
            >
              Подтвердить
            </Button>
          </div>
        </AlertDescription>
      </Alert>

      {sheetOpen && (
        <Suspense fallback={null}>
          <ConfirmLessonsSheet
            open={sheetOpen}
            onOpenChange={setSheetOpen}
            lessons={pastLessons}
            onOpenMaterials={onOpenMaterials}
          />
        </Suspense>
      )}
    </>
  );
});
