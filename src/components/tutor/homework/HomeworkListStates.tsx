// Skeleton + EmptyState списка ДЗ — вынесены из TutorHomework.tsx для переиспользования
// на странице папки (HomeworkFolderPage). Запрос Елены (2026-06-17).
import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Plus, Inbox } from 'lucide-react';
import type { HomeworkAssignmentsFilter } from '@/lib/tutorHomeworkApi';

export function HomeworkListSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <Card key={i} animate={false}>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-5 w-16" />
            </div>
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <div className="flex justify-between">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-16" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function HomeworkEmptyState({
  filter,
  hasGroupFilter,
  /** Заголовок/подпись для контекста папки (опц.). */
  inFolder = false,
}: {
  filter: HomeworkAssignmentsFilter;
  hasGroupFilter: boolean;
  inFolder?: boolean;
}) {
  const isFiltered = filter !== 'all' || hasGroupFilter;
  return (
    <Card className="bg-muted/30 group">
      <CardContent className="flex flex-col items-center text-center gap-5 py-12">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted transition-transform duration-300 ease-out group-hover:-rotate-6">
          <Inbox className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
        </div>
        <div className="space-y-1.5">
          <h3 className="font-semibold tracking-tight text-xl">
            {inFolder
              ? 'В этой папке пока пусто'
              : isFiltered
                ? 'Нет домашних заданий'
                : 'Пока нет домашних заданий'}
          </h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
            {inFolder
              ? 'Переместите сюда задания через меню «···» на карточке ДЗ или создайте новое.'
              : isFiltered
                ? 'Попробуйте выбрать другой фильтр или создайте новое задание.'
                : 'Создайте первое домашнее задание для ваших учеников.'}
          </p>
        </div>
        <Button asChild className="group/cta">
          <Link to="/tutor/homework/create">
            <Plus
              className="h-4 w-4 mr-2 transition-transform duration-300 ease-out group-hover/cta:rotate-90"
              aria-hidden="true"
            />
            Создать ДЗ
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
