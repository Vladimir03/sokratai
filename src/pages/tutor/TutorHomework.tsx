import { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Plus, BookOpen, Users, BarChart3, Clock } from 'lucide-react';
import TutorGuard from '@/components/TutorGuard';
import { TutorLayout } from '@/components/tutor/TutorLayout';
import { TutorDataStatus } from '@/components/tutor/TutorDataStatus';
import { useTutorHomeworkAssignments } from '@/hooks/useTutorHomework';
import type {
  HomeworkAssignmentsFilter,
  HomeworkAssignmentStatus,
  HomeworkSubject,
  TutorHomeworkAssignmentListItem,
} from '@/lib/tutorHomeworkApi';

// ─── Constants ───────────────────────────────────────────────────────────────

const FILTER_TABS: { value: HomeworkAssignmentsFilter; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'active', label: 'Активные' },
  { value: 'closed', label: 'Завершённые' },
];

const SUBJECT_LABELS: Record<HomeworkSubject, string> = {
  math: 'Математика',
  physics: 'Физика',
  history: 'История',
  social: 'Обществознание',
  english: 'Английский',
  cs: 'Информатика',
};

const SUBJECT_EMOJI: Record<HomeworkSubject, string> = {
  math: '📐',
  physics: '⚡',
  history: '📜',
  social: '🏛️',
  english: '🇬🇧',
  cs: '💻',
};

const STATUS_CONFIG: Record<HomeworkAssignmentStatus, { label: string; className: string }> = {
  draft: {
    label: 'Черновик',
    className: 'bg-muted text-muted-foreground border-muted',
  },
  active: {
    label: 'Активное',
    className: 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800',
  },
  closed: {
    label: 'Завершено',
    className: 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700',
  },
};

// ─── Utilities ───────────────────────────────────────────────────────────────

function formatDeadline(deadline: string | null): string | null {
  if (!deadline) return null;
  try {
    const d = new Date(deadline);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'short',
    });
  } catch {
    return null;
  }
}

function formatScore(score: number | null): string {
  if (score === null || score === undefined) return '—';
  return `${Math.round(score)}%`;
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

function HomeworkListSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <Card key={i}>
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

// ─── Empty state ─────────────────────────────────────────────────────────────

function EmptyState({ filter }: { filter: HomeworkAssignmentsFilter }) {
  const isFiltered = filter !== 'all';
  return (
    <Card className="bg-muted/30">
      <CardContent className="pt-6">
        <div className="text-center space-y-4 py-8">
          <div className="text-5xl">📚</div>
          <div>
            <h3 className="font-medium mb-1 text-lg">
              {isFiltered ? 'Нет домашних заданий' : 'Пока нет домашних заданий'}
            </h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              {isFiltered
                ? 'Попробуйте выбрать другой фильтр или создайте новое задание.'
                : 'Создайте первое домашнее задание для ваших учеников.'}
            </p>
          </div>
          <Button asChild>
            <Link to="/tutor/homework/create">
              <Plus className="h-4 w-4 mr-2" />
              Создать ДЗ
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Assignment Card ─────────────────────────────────────────────────────────

function AssignmentCard({ item }: { item: TutorHomeworkAssignmentListItem }) {
  const statusCfg = STATUS_CONFIG[item.status];
  const deadlineStr = formatDeadline(item.deadline);
  const subjectEmoji = SUBJECT_EMOJI[item.subject] ?? '📖';
  const subjectLabel = SUBJECT_LABELS[item.subject] ?? item.subject;

  return (
    <Link to={`/tutor/homework/${item.id}`} className="block">
      <Card className="transition-all hover:shadow-md cursor-pointer">
        <CardContent className="p-4 space-y-3">
          {/* Header: subject + status */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground flex items-center gap-1.5">
              <span>{subjectEmoji}</span>
              {subjectLabel}
            </span>
            <Badge
              variant="outline"
              className={statusCfg.className}
            >
              {statusCfg.label}
            </Badge>
          </div>

          {/* Title */}
          <h3 className="font-semibold text-base leading-tight line-clamp-2">
            {item.title}
          </h3>

          {/* Topic */}
          {item.topic && (
            <p className="text-sm text-muted-foreground line-clamp-1">{item.topic}</p>
          )}

          {/* Stats row */}
          <div className="flex items-center gap-4 text-sm text-muted-foreground pt-1">
            {/* Progress */}
            <span className="flex items-center gap-1" title="Сдали / Назначено">
              <Users className="h-3.5 w-3.5" />
              {item.submitted_count}/{item.assigned_count}
            </span>

            {/* Average score */}
            <span className="flex items-center gap-1" title="Средний балл">
              <BarChart3 className="h-3.5 w-3.5" />
              {formatScore(item.avg_score)}
            </span>

            {/* Deadline */}
            {deadlineStr && (
              <span className="flex items-center gap-1 ml-auto" title="Дедлайн">
                <Clock className="h-3.5 w-3.5" />
                {deadlineStr}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

// ─── Main Content ────────────────────────────────────────────────────────────

function TutorHomeworkContent() {
  const [filter, setFilter] = useState<HomeworkAssignmentsFilter>('all');

  const {
    assignments,
    loading,
    error,
    refetch,
    isFetching,
    isRecovering,
    failureCount,
  } = useTutorHomeworkAssignments(filter);

  const hasData = assignments.length > 0;
  const showSkeleton = loading && !hasData && !error;

  const handleRetry = useCallback(() => {
    refetch();
  }, [refetch]);

  return (
    <TutorLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <BookOpen className="h-6 w-6" />
              Домашние задания
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Управляйте домашками и отслеживайте прогресс учеников
            </p>
          </div>
          <Button asChild>
            <Link to="/tutor/homework/create">
              <Plus className="h-4 w-4 mr-2" />
              Создать ДЗ
            </Link>
          </Button>
        </div>

        {/* Error / Recovery status */}
        <TutorDataStatus
          error={error}
          isFetching={isFetching}
          isRecovering={isRecovering}
          failureCount={failureCount}
          onRetry={handleRetry}
        />

        {/* Filter Tabs */}
        <div className="flex gap-1 border-b">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setFilter(tab.value)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                filter === tab.value
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        {showSkeleton ? (
          <HomeworkListSkeleton />
        ) : !hasData && !error ? (
          <EmptyState filter={filter} />
        ) : hasData ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {assignments.map((item) => (
              <AssignmentCard key={item.id} item={item} />
            ))}
          </div>
        ) : null}
      </div>
    </TutorLayout>
  );
}

// ─── Export with guard ───────────────────────────────────────────────────────

export default function TutorHomework() {
  return (
    <TutorGuard>
      <TutorHomeworkContent />
    </TutorGuard>
  );
}
