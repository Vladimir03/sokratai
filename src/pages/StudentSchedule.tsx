import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { isPast, isToday, parseISO } from 'date-fns';
import { Calendar } from 'lucide-react';
import Navigation from '@/components/Navigation';
import AuthGuard from '@/components/AuthGuard';
import { PageContent } from '@/components/PageContent';
import { listStudentLessons, type StudentLesson } from '@/lib/studentScheduleApi';
import { LessonGroupHeader } from '@/components/student/schedule/LessonGroupHeader';
import { LessonFeedItem } from '@/components/student/schedule/LessonFeedItem';

type GroupKey = 'today' | 'upcoming' | 'past';

/** rule 80: parseISO only. isToday wins; future (non-today) → upcoming; else past. */
function groupKey(startAt: string): GroupKey {
  try {
    const d = parseISO(startAt);
    if (Number.isNaN(d.getTime())) return 'past';
    if (isToday(d)) return 'today';
    return isPast(d) ? 'past' : 'upcoming';
  } catch {
    return 'past';
  }
}

const GROUP_LABEL: Record<GroupKey, string> = {
  today: 'Сегодня',
  upcoming: 'На этой неделе',
  past: 'Прошедшие',
};
const GROUP_ORDER: GroupKey[] = ['today', 'upcoming', 'past'];

function startMs(l: StudentLesson): number {
  const t = parseISO(l.start_at).getTime();
  return Number.isNaN(t) ? 0 : t;
}

const StudentSchedule = () => {
  const { data, isLoading, error } = useQuery({
    queryKey: ['student', 'lessons', 'list'],
    queryFn: listStudentLessons,
  });

  const groups = useMemo(() => {
    const buckets: Record<GroupKey, StudentLesson[]> = { today: [], upcoming: [], past: [] };
    for (const lesson of data ?? []) buckets[groupKey(lesson.start_at)].push(lesson);
    // today + upcoming ascending (soonest first); past descending (latest on top — killer job).
    buckets.today.sort((a, b) => startMs(a) - startMs(b));
    buckets.upcoming.sort((a, b) => startMs(a) - startMs(b));
    buckets.past.sort((a, b) => startMs(b) - startMs(a));
    return buckets;
  }, [data]);

  const hasLessons = (data?.length ?? 0) > 0;

  return (
    <AuthGuard>
      <div className="min-h-[100dvh] bg-background">
        <Navigation />
        <PageContent>
          <main className="container mx-auto px-4 pb-8">
            <div className="max-w-3xl mx-auto space-y-4">
              <h1 className="text-2xl font-bold">Занятия</h1>

              {isLoading && <p className="text-muted-foreground">Загрузка...</p>}
              {error && <p className="text-destructive">Не удалось загрузить занятия</p>}

              {!isLoading && !error && !hasLessons && (
                <div className="flex flex-col items-center gap-3 py-16 text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
                    <Calendar className="h-7 w-7 text-muted-foreground" />
                  </div>
                  <p className="max-w-xs text-sm text-muted-foreground">
                    Занятия появятся, когда репетитор добавит материалы
                  </p>
                </div>
              )}

              {!isLoading && !error && hasLessons && (
                <div className="space-y-5">
                  {GROUP_ORDER.map((key) =>
                    groups[key].length > 0 ? (
                      <section key={key} className="space-y-2">
                        <LessonGroupHeader label={GROUP_LABEL[key]} />
                        <div className="space-y-2">
                          {groups[key].map((lesson) => (
                            <LessonFeedItem key={lesson.id} lesson={lesson} />
                          ))}
                        </div>
                      </section>
                    ) : null,
                  )}
                </div>
              )}
            </div>
          </main>
        </PageContent>
      </div>
    </AuthGuard>
  );
};

export default StudentSchedule;
