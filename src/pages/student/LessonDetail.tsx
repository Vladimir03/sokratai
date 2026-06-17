import { useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import { ArrowLeft, BookOpen, ExternalLink, FileText, Video } from 'lucide-react';
import Navigation from '@/components/Navigation';
import AuthGuard from '@/components/AuthGuard';
import { PageContent } from '@/components/PageContent';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  getStudentLesson,
  HW_REF_STATUS_CONFIG,
  type StudentLessonMaterial,
} from '@/lib/studentScheduleApi';
import { StudentHomeworkApiError } from '@/lib/studentHomeworkApi';

function formatLessonDateTime(startAt: string): string {
  try {
    const d = parseISO(startAt); // rule 80: parseISO, never new Date("…")
    if (Number.isNaN(d.getTime())) return '';
    return format(d, 'd MMMM, HH:mm', { locale: ru });
  } catch {
    return '';
  }
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
        {icon} {title}
      </h2>
      {children}
    </section>
  );
}

function EmptyHint() {
  return <p className="text-sm text-muted-foreground">материалов пока нет</p>;
}

function MaterialLink({
  material,
  icon,
  fallback,
}: {
  material: StudentLessonMaterial;
  icon: React.ReactNode;
  fallback: string;
}) {
  const label = material.title?.trim() || fallback;
  if (!material.url) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-socrat-border bg-white px-3 py-2.5 text-slate-400">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100">{icon}</div>
        <span className="truncate text-sm">{label} (недоступно)</span>
      </div>
    );
  }
  return (
    <a
      href={material.url}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-3 rounded-lg border border-socrat-border bg-white px-3 py-2.5 transition-colors hover:bg-socrat-surface"
      style={{ touchAction: 'manipulation' }}
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-socrat-primary-light text-socrat-primary">
        {icon}
      </div>
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">{label}</span>
      <ExternalLink className="h-4 w-4 shrink-0 text-slate-400" />
    </a>
  );
}

const LessonDetail = () => {
  const { lessonId } = useParams<{ lessonId: string }>();
  const navigate = useNavigate();

  const { data: lesson, isLoading, error } = useQuery({
    queryKey: ['student', 'lessons', lessonId],
    queryFn: () => getStudentLesson(lessonId!),
    enabled: !!lessonId,
  });

  const recordings = useMemo(
    () => (lesson?.materials ?? []).filter((m) => m.kind === 'recording'),
    [lesson],
  );
  const pdfs = useMemo(() => (lesson?.materials ?? []).filter((m) => m.kind === 'pdf'), [lesson]);
  // Несколько ДЗ на урок (запрос Елены 2026-06-17): filter, не find.
  const homeworks = useMemo(
    () => (lesson?.materials ?? []).filter((m) => m.kind === 'homework_ref'),
    [lesson],
  );

  const notFound = error instanceof StudentHomeworkApiError && error.code === 'NOT_FOUND';
  const title = lesson?.subject?.trim() || lesson?.group_title_snapshot?.trim() || 'Занятие';
  const meta = lesson
    ? [lesson.tutor?.name?.trim(), formatLessonDateTime(lesson.start_at)].filter(Boolean).join(' · ')
    : '';

  return (
    <AuthGuard>
      <div className="min-h-[100dvh] bg-background">
        <Navigation />
        <PageContent>
          <main className="container mx-auto px-4 pb-8">
            <div className="mx-auto max-w-2xl space-y-4">
              <Link
                to="/student/schedule"
                className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                style={{ touchAction: 'manipulation' }}
              >
                <ArrowLeft className="h-4 w-4" /> Занятия
              </Link>

              {isLoading && <p className="text-muted-foreground">Загрузка...</p>}
              {error && (
                <p className="text-destructive">
                  {notFound ? 'Занятие не найдено' : 'Не удалось загрузить занятие'}
                </p>
              )}

              {lesson && (
                <>
                  <div>
                    <h1 className="text-2xl font-bold">{title}</h1>
                    {meta && <p className="mt-1 text-sm text-muted-foreground">{meta}</p>}
                  </div>

                  <Section icon={<Video className="h-4 w-4 text-socrat-accent" />} title="Запись">
                    {recordings.length === 0 ? (
                      <EmptyHint />
                    ) : (
                      recordings.map((m) => (
                        <MaterialLink
                          key={m.id}
                          material={m}
                          icon={<Video className="h-[18px] w-[18px]" />}
                          fallback="Запись"
                        />
                      ))
                    )}
                  </Section>

                  <Section icon={<FileText className="h-4 w-4 text-socrat-primary" />} title="Конспект">
                    {pdfs.length === 0 ? (
                      <EmptyHint />
                    ) : (
                      pdfs.map((m) => (
                        <MaterialLink
                          key={m.id}
                          material={m}
                          icon={<FileText className="h-[18px] w-[18px]" />}
                          fallback="PDF-конспект"
                        />
                      ))
                    )}
                  </Section>

                  <Section icon={<BookOpen className="h-4 w-4 text-accent" />} title="Домашка">
                    {homeworks.length === 0 ? (
                      <EmptyHint />
                    ) : (
                      <div className="space-y-3">
                        {homeworks.map((hw) =>
                          hw.assignment_id ? (
                            <div key={hw.id} className="space-y-2.5">
                              <div className="flex items-center gap-2">
                                <Badge className={HW_REF_STATUS_CONFIG[hw.status ?? 'assigned'].className}>
                                  {HW_REF_STATUS_CONFIG[hw.status ?? 'assigned'].label}
                                </Badge>
                                {hw.title && (
                                  <span className="truncate text-sm text-slate-700">{hw.title}</span>
                                )}
                              </div>
                              <Button
                                className="w-full"
                                style={{ touchAction: 'manipulation' }}
                                onClick={() =>
                                  navigate(
                                    hw.entry_task_id
                                      ? `/student/homework/${hw.assignment_id}/problem/${hw.entry_task_id}`
                                      : `/homework/${hw.assignment_id}`,
                                  )
                                }
                              >
                                Открыть домашнее задание
                              </Button>
                            </div>
                          ) : null,
                        )}
                      </div>
                    )}
                  </Section>
                </>
              )}
            </div>
          </main>
        </PageContent>
      </div>
    </AuthGuard>
  );
};

export default LessonDetail;
