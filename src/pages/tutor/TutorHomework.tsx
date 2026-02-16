import { useState } from 'react';
import { Link } from 'react-router-dom';
import TutorGuard from '@/components/TutorGuard';
import { TutorLayout } from '@/components/tutor/TutorLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Plus, BookOpen } from 'lucide-react';
import { useTutorHomeworkList } from '@/hooks/useTutorHomework';
import type { HomeworkAssignmentsFilter, TutorHomeworkAssignmentListItem } from '@/lib/tutorHomeworkApi';
import { format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';

const SUBJECT_LABELS: Record<string, string> = {
  math: 'Математика',
  physics: 'Физика',
  history: 'История',
  social: 'Обществознание',
  english: 'Английский',
  cs: 'Информатика',
};

const STATUS_BADGE: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' }> = {
  draft: { label: 'Черновик', variant: 'outline' },
  active: { label: 'Активное', variant: 'default' },
  closed: { label: 'Завершено', variant: 'secondary' },
};

const TABS: { label: string; value: HomeworkAssignmentsFilter }[] = [
  { label: 'Все', value: 'all' },
  { label: 'Активные', value: 'active' },
  { label: 'Завершённые', value: 'closed' },
];

function HomeworkCard({ item }: { item: TutorHomeworkAssignmentListItem }) {
  const badge = STATUS_BADGE[item.status] ?? STATUS_BADGE.draft;
  return (
    <Card className="transition-all hover:shadow-md">
      <CardContent className="p-4 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-medium truncate">{item.title}</h3>
            <p className="text-sm text-muted-foreground">
              {SUBJECT_LABELS[item.subject] ?? item.subject}
              {item.topic ? ` · ${item.topic}` : ''}
            </p>
          </div>
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </div>
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          {item.deadline && (
            <span>до {format(parseISO(item.deadline), 'd MMM', { locale: ru })}</span>
          )}
          <span>
            {item.submitted_count}/{item.assigned_count} сдали
          </span>
          {item.avg_score != null && (
            <span className={item.avg_score >= 70 ? 'text-green-600' : item.avg_score >= 40 ? 'text-yellow-600' : 'text-red-600'}>
              {Math.round(item.avg_score)}%
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function TutorHomeworkContent() {
  const [filter, setFilter] = useState<HomeworkAssignmentsFilter>('all');
  const { data, isLoading, error } = useTutorHomeworkList(filter);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Домашние задания</h1>
        <Link to="/tutor/homework/create">
          <Button size="sm" className="gap-2">
            <Plus className="h-4 w-4" />
            Создать ДЗ
          </Button>
        </Link>
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        {TABS.map((tab) => (
          <Button
            key={tab.value}
            variant={filter === tab.value ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter(tab.value)}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      {/* Content */}
      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-lg" />
          ))}
        </div>
      )}

      {error && (
        <p className="text-destructive text-sm">
          Ошибка загрузки: {error instanceof Error ? error.message : 'Неизвестная ошибка'}
        </p>
      )}

      {!isLoading && !error && data?.length === 0 && (
        <div className="flex flex-col items-center gap-4 py-12 text-center">
          <BookOpen className="h-12 w-12 text-muted-foreground/50" />
          <p className="text-muted-foreground">Домашних заданий пока нет</p>
          <Link to="/tutor/homework/create">
            <Button>Создать первое ДЗ</Button>
          </Link>
        </div>
      )}

      {data && data.length > 0 && (
        <div className="space-y-3">
          {data.map((item) => (
            <HomeworkCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function TutorHomework() {
  return (
    <TutorGuard>
      <TutorLayout>
        <TutorHomeworkContent />
      </TutorLayout>
    </TutorGuard>
  );
}
