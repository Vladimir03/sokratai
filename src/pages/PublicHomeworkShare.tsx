import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, Clock3, FileQuestion, GraduationCap } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { HomeworkPreviewContent } from '@/components/tutor/homework-reuse/HomeworkPreviewContent';
import { fetchPublicHomeworkShare } from '@/lib/publicShareApi';

import '@/styles/homework-preview-print.css';

function PublicShareState({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="min-h-[100dvh] bg-background px-4 py-10 text-foreground">
      <div className="mx-auto flex max-w-[560px] flex-col items-center text-center">
        <div className="mb-4 rounded-full bg-muted p-4 text-muted-foreground" aria-hidden="true">
          {icon}
        </div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="mt-2 text-base text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

export default function PublicHomeworkShare() {
  const { slug = '' } = useParams<{ slug: string }>();

  const query = useQuery({
    queryKey: ['public-homework-share', slug],
    queryFn: () => fetchPublicHomeworkShare(slug),
    staleTime: 60_000,
    retry: 1,
  });

  if (query.isLoading) {
    return (
      <div className="min-h-[100dvh] bg-background px-4 py-6 text-foreground">
        <div className="mx-auto max-w-[800px] space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <PublicShareState
        icon={<AlertCircle className="h-6 w-6" />}
        title="Не удалось открыть ссылку"
        description="Попробуйте обновить страницу или попросите репетитора отправить ссылку ещё раз."
      />
    );
  }

  const result = query.data;

  if (result.status === 'invalid_slug' || result.status === 'not_found') {
    return (
      <PublicShareState
        icon={<FileQuestion className="h-6 w-6" />}
        title="Ссылка не найдена"
        description="Проверьте адрес или попросите репетитора создать новую публичную ссылку."
      />
    );
  }

  if (result.status === 'expired') {
    return (
      <PublicShareState
        icon={<Clock3 className="h-6 w-6" />}
        title="Срок действия ссылки истёк"
        description="Попросите репетитора отправить новую ссылку на это домашнее задание."
      />
    );
  }

  if (result.status === 'error') {
    return (
      <PublicShareState
        icon={<AlertCircle className="h-6 w-6" />}
        title="Не удалось загрузить ДЗ"
        description={result.message}
      />
    );
  }

  return (
    <div className="preview-page min-h-[100dvh] bg-muted/30 text-foreground">
      <header className="preview-toolbar border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex max-w-[960px] items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <GraduationCap className="h-5 w-5 flex-none text-primary" aria-hidden="true" />
            <span className="truncate text-sm font-semibold">Сократ AI</span>
          </div>
          <Button asChild size="sm" variant="outline" className="min-h-[40px]">
            <a href="/login">Открыть в Сократе</a>
          </Button>
        </div>
      </header>

      <HomeworkPreviewContent
        title={result.title}
        tasks={result.tasks}
        showAnswers={result.show_answers}
        showSolutions={result.show_solutions}
      />
    </div>
  );
}
