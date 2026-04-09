import { useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft, Trash2, BookOpen } from 'lucide-react';
import TutorGuard from '@/components/TutorGuard';
import { TutorLayout } from '@/components/tutor/TutorLayout';
import { TutorDataStatus } from '@/components/tutor/TutorDataStatus';
import { useTutorHomeworkTemplates } from '@/hooks/useTutorHomework';
import { deleteTutorHomeworkTemplate } from '@/lib/tutorHomeworkApi';
import type { HomeworkSubject, HomeworkTemplateListItem } from '@/lib/tutorHomeworkApi';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';

// ─── Constants ───────────────────────────────────────────────────────────────

const SUBJECT_LABELS: Record<HomeworkSubject, string> = {
  math: 'Математика',
  physics: 'Физика',
  history: 'История',
  social: 'Обществознание',
  english: 'Английский',
  cs: 'Информатика',
  french: 'Французский',
  chemistry: 'Химия',
};

const SUBJECT_EMOJI: Record<HomeworkSubject, string> = {
  math: '📐',
  physics: '⚡',
  history: '📜',
  social: '🏛️',
  english: '🇬🇧',
  cs: '💻',
  french: '🇫🇷',
  chemistry: '🧪',
};

const SUBJECT_FILTERS: { value: HomeworkSubject | 'all'; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'math', label: 'Математика' },
  { value: 'physics', label: 'Физика' },
  { value: 'history', label: 'История' },
  { value: 'social', label: 'Обществознание' },
  { value: 'english', label: 'Английский' },
  { value: 'cs', label: 'Информатика' },
];

// ─── Template Card ────────────────────────────────────────────────────────────

function TemplateCard({
  template,
  onDelete,
}: {
  template: HomeworkTemplateListItem;
  onDelete: (id: string) => void;
}) {
  const navigate = useNavigate();
  const subjectEmoji = SUBJECT_EMOJI[template.subject] ?? '📖';
  const subjectLabel = SUBJECT_LABELS[template.subject] ?? template.subject;

  return (
    <Card className="transition-all hover:shadow-md">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-muted-foreground flex items-center gap-1.5">
            <span>{subjectEmoji}</span>
            {subjectLabel}
          </span>
          <Badge variant="outline" className="text-xs">
            {template.task_count ?? 0} {(template.task_count ?? 0) === 1 ? 'задача' : 'задач'}
          </Badge>
        </div>

        <h3 className="font-semibold text-base leading-tight line-clamp-2">{template.title}</h3>

        {template.topic && (
          <p className="text-sm text-muted-foreground line-clamp-1">{template.topic}</p>
        )}

        {template.tags && template.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {template.tags.slice(0, 3).map((tag) => (
              <Badge key={tag} variant="secondary" className="text-xs px-1.5 py-0">
                {tag}
              </Badge>
            ))}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <Button
            size="sm"
            className="flex-1"
            onClick={() => navigate(`/tutor/homework/create?template_id=${template.id}`)}
          >
            Использовать
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={() => onDelete(template.id)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main content ─────────────────────────────────────────────────────────────

function TutorHomeworkTemplatesContent() {
  const [subjectFilter, setSubjectFilter] = useState<HomeworkSubject | 'all'>('all');
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const subject = subjectFilter === 'all' ? undefined : subjectFilter;
  const { templates, loading, error, isFetching, refetch } = useTutorHomeworkTemplates(subject);

  const handleDelete = useCallback(
    async (templateId: string) => {
      if (!confirm('Удалить шаблон? Это действие нельзя отменить.')) return;
      try {
        await deleteTutorHomeworkTemplate(templateId);
        toast({ title: 'Шаблон удалён' });
        await queryClient.invalidateQueries({ queryKey: ['tutor', 'homework', 'templates'] });
      } catch {
        toast({ title: 'Не удалось удалить шаблон', variant: 'destructive' });
      }
    },
    [toast, queryClient],
  );

  const showSkeleton = loading && templates.length === 0 && !error;

  return (
    <TutorLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" asChild>
              <Link to="/tutor/homework">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <BookOpen className="h-6 w-6" />
                Шаблоны ДЗ
              </h1>
              <p className="text-muted-foreground text-sm mt-1">
                Сохранённые задания для быстрого создания ДЗ
              </p>
            </div>
          </div>
        </div>

        <TutorDataStatus
          error={error}
          isFetching={isFetching}
          isRecovering={false}
          failureCount={0}
          onRetry={refetch}
        />

        {/* Subject filter tabs */}
        <div className="flex gap-1 border-b overflow-x-auto">
          {SUBJECT_FILTERS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setSubjectFilter(tab.value)}
              className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                subjectFilter === tab.value
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <Card key={i}>
                <CardContent className="p-4 space-y-3">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-5 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-8 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : templates.length === 0 && !error ? (
          <Card className="bg-muted/30">
            <CardContent className="pt-6">
              <div className="text-center space-y-4 py-8">
                <div className="text-5xl">📋</div>
                <div>
                  <h3 className="font-medium mb-1 text-lg">Нет шаблонов</h3>
                  <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                    Создайте ДЗ и сохраните как шаблон — он появится здесь.
                  </p>
                </div>
                <Button asChild>
                  <Link to="/tutor/homework/create">Создать ДЗ</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {templates.map((t) => (
              <TemplateCard key={t.id} template={t} onDelete={handleDelete} />
            ))}
          </div>
        )}
      </div>
    </TutorLayout>
  );
}

export default function TutorHomeworkTemplates() {
  return (
    <TutorGuard>
      <TutorHomeworkTemplatesContent />
    </TutorGuard>
  );
}
