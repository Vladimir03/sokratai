/**
 * homework-reuse-v1 TASK-3 — Tutor-only preview route /tutor/homework/:id/preview.
 *
 * Renders the shared `HomeworkPreviewContent` with a toolbar tailored to the
 * tutor workflow:
 * - [← Назад] → /tutor/homework/:id (AC-1)
 * - [Печать / PDF] → native window.print() (AC-4)
 * - [Копировать текст] → Telegram-friendly format via stripLatex (AC-5)
 * - [Поделиться ссылкой] → ShareLinkDialog stub (TASK-7 will wire)
 * - С ответами / С решениями toggles, default OFF (AC-3)
 *
 * Image refs are resolved to signed URLs via `useKBImagesSignedUrls` which
 * parses `storage://<bucket>/<path>` and delegates to
 * `supabase.storage.createSignedUrl` (same pattern as HWTaskCard in edit-mode
 * and the public path in TASK-4 will use pre-signed URLs from the edge
 * function). `HomeworkPreviewContent` stays stateless.
 */

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Printer, Copy, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  getTutorHomeworkAssignment,
  type TutorHomeworkAssignmentDetails,
} from '@/lib/tutorHomeworkApi';
import { parseAttachmentUrls } from '@/lib/attachmentRefs';
import { useKBImagesSignedUrls } from '@/hooks/useKBImagesSignedUrls';
import { stripLatex } from '@/components/kb/ui/stripLatex';
import {
  createTutorRetry,
  TUTOR_STALE_TIME_MS,
  TUTOR_GC_TIME_MS,
  withTutorTimeout,
  toTutorErrorMessage,
} from '@/hooks/tutorQueryOptions';
import { trackGuidedHomeworkEvent } from '@/lib/homeworkTelemetry';
import {
  HomeworkPreviewContent,
  type HomeworkPreviewTask,
} from '@/components/tutor/homework-reuse/HomeworkPreviewContent';

import '@/styles/homework-preview-print.css';

function buildTelegramCopyText(
  title: string,
  tasks: HomeworkPreviewTask[],
  showAnswers: boolean,
): string {
  const lines: string[] = [];
  lines.push(title);
  lines.push('');
  tasks.forEach((task) => {
    const taskLine = `№${task.order_num}. ${stripLatex(task.task_text).trim()}`;
    lines.push(taskLine);
    if (task.task_image_urls.length > 0) {
      lines.push('[см. рисунок]');
    }
    if (showAnswers && task.correct_answer) {
      lines.push(`Ответ: ${stripLatex(task.correct_answer).trim()}`);
    }
    lines.push('');
  });
  return lines.join('\n').trimEnd();
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (
      typeof navigator !== 'undefined' &&
      navigator.clipboard &&
      typeof navigator.clipboard.writeText === 'function' &&
      window.isSecureContext
    ) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to legacy path
  }
  // Legacy fallback for non-secure contexts (older Safari previews).
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

function TutorHomeworkPreviewContent() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [showAnswers, setShowAnswers] = useState(false);
  const [showSolutions, setShowSolutions] = useState(false);
  const openedTrackedRef = useRef<string | null>(null);

  const detailsQueryKey = ['tutor', 'homework', 'detail', id] as const;
  const detailsQuery = useQuery<TutorHomeworkAssignmentDetails>({
    queryKey: detailsQueryKey,
    queryFn: () =>
      withTutorTimeout(detailsQueryKey, getTutorHomeworkAssignment(id!)),
    enabled: !!id,
    staleTime: TUTOR_STALE_TIME_MS,
    gcTime: TUTOR_GC_TIME_MS,
    retry: createTutorRetry(detailsQueryKey),
    refetchOnWindowFocus: true,
  });

  const details = detailsQuery.data;

  // Flatten all task / solution storage refs into one batch per gallery,
  // so `useKBImagesSignedUrls` creates one react-query entry per unique ref
  // (de-duped internally) rather than N queries per task.
  const taskRefs = useMemo(() => {
    if (!details) return [];
    return details.tasks.flatMap((t) => parseAttachmentUrls(t.task_image_url));
  }, [details]);

  const solutionRefs = useMemo(() => {
    if (!details) return [];
    return details.tasks.flatMap((t) =>
      parseAttachmentUrls(t.solution_image_urls ?? null),
    );
  }, [details]);

  const { urls: taskUrlMap } = useKBImagesSignedUrls(taskRefs, {
    enabled: taskRefs.length > 0,
  });
  const { urls: solutionUrlMap } = useKBImagesSignedUrls(solutionRefs, {
    enabled: solutionRefs.length > 0,
  });

  const previewTasks = useMemo<HomeworkPreviewTask[]>(() => {
    if (!details) return [];
    return [...details.tasks]
      .sort((a, b) => a.order_num - b.order_num)
      .map((t) => ({
        id: t.id,
        order_num: t.order_num,
        task_text: t.task_text,
        max_score: t.max_score,
        kim_number: null, // not surfaced on tutor side; public endpoint may populate from KB provenance
        check_format: t.check_format ?? null,
        task_image_urls: parseAttachmentUrls(t.task_image_url)
          .map((ref) => taskUrlMap[ref])
          .filter((url): url is string => Boolean(url)),
        correct_answer: t.correct_answer ?? null,
        solution_text: t.solution_text ?? null,
        solution_image_urls: parseAttachmentUrls(t.solution_image_urls ?? null)
          .map((ref) => solutionUrlMap[ref])
          .filter((url): url is string => Boolean(url)),
      }));
  }, [details, taskUrlMap, solutionUrlMap]);

  useEffect(() => {
    if (!details || !id) return;
    if (openedTrackedRef.current === id) return;
    openedTrackedRef.current = id;
    trackGuidedHomeworkEvent('homework_preview_opened', {
      assignmentId: id,
      tasksCount: details.tasks.length,
    });
  }, [details, id]);

  const handleBack = useCallback(() => {
    if (!id) {
      navigate('/tutor/homework');
      return;
    }
    navigate(`/tutor/homework/${id}`);
  }, [id, navigate]);

  const handlePrint = useCallback(() => {
    if (!id) return;
    trackGuidedHomeworkEvent('homework_preview_printed', {
      assignmentId: id,
      tasksCount: previewTasks.length,
    });
    // Defer to next frame to let the toolbar telemetry toast/log emit before
    // the print dialog steals the main thread.
    window.requestAnimationFrame(() => {
      window.print();
    });
  }, [id, previewTasks.length]);

  const handleCopy = useCallback(async () => {
    if (!details || !id) return;
    const text = buildTelegramCopyText(
      details.assignment.title,
      previewTasks,
      showAnswers,
    );
    const ok = await copyTextToClipboard(text);
    if (ok) {
      toast.success('Скопировано');
      trackGuidedHomeworkEvent('homework_preview_copied_text', {
        assignmentId: id,
        tasksCount: previewTasks.length,
        withAnswers: showAnswers,
      });
    } else {
      toast.error('Не удалось скопировать текст');
    }
  }, [details, id, previewTasks, showAnswers]);

  const handleShareStub = useCallback(() => {
    // ShareLinkDialog wiring lands in TASK-7. For TASK-3 we keep the button
    // visible in the toolbar (AC-3) but surface a neutral notice so clicks
    // are not silently dropped.
    toast.info('Диалог «Поделиться ссылкой» появится в следующей итерации');
  }, []);

  if (!id) {
    return (
      <div className="mx-auto max-w-[800px] px-4 py-10 text-center text-slate-500">
        Неверный адрес ДЗ.
      </div>
    );
  }

  if (detailsQuery.isLoading) {
    return (
      <div className="mx-auto max-w-[800px] px-4 py-6 space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  if (detailsQuery.isError || !details) {
    return (
      <div className="mx-auto max-w-[800px] px-4 py-10 text-center">
        <p className="mb-4 text-base text-red-600">
          {toTutorErrorMessage('Не удалось загрузить предпросмотр ДЗ', detailsQuery.error)}
        </p>
        <Button onClick={handleBack} variant="outline">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Назад
        </Button>
      </div>
    );
  }

  return (
    <div className="preview-page min-h-[calc(100dvh-0px)] bg-slate-50">
      <div className="preview-toolbar sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/75">
        <div className="mx-auto flex max-w-[960px] flex-wrap items-center gap-2 px-4 py-3 sm:px-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleBack}
            className="min-h-[44px]"
            aria-label="Назад к ДЗ"
          >
            <ArrowLeft className="h-4 w-4 md:mr-2" />
            <span className="hidden md:inline">Назад</span>
          </Button>

          <div className="mx-1 hidden h-6 w-px bg-slate-200 md:block" aria-hidden="true" />

          <Button
            variant="default"
            size="sm"
            onClick={handlePrint}
            className="min-h-[44px] bg-accent text-white hover:bg-accent/90"
          >
            <Printer className="h-4 w-4 md:mr-2" />
            <span className="hidden md:inline">Печать / PDF</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleCopy}
            className="min-h-[44px]"
          >
            <Copy className="h-4 w-4 md:mr-2" />
            <span className="hidden md:inline">Копировать текст</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleShareStub}
            className="min-h-[44px]"
            aria-label="Поделиться ссылкой"
          >
            <Share2 className="h-4 w-4 md:mr-2" />
            <span className="hidden md:inline">Поделиться ссылкой</span>
          </Button>

          <div className="ml-auto flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Switch
                id="preview-show-answers"
                checked={showAnswers}
                onCheckedChange={setShowAnswers}
              />
              <Label
                htmlFor="preview-show-answers"
                className="cursor-pointer select-none text-sm text-slate-700"
              >
                С ответами
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="preview-show-solutions"
                checked={showSolutions}
                onCheckedChange={setShowSolutions}
              />
              <Label
                htmlFor="preview-show-solutions"
                className="cursor-pointer select-none text-sm text-slate-700"
              >
                С решениями
              </Label>
            </div>
          </div>
        </div>
      </div>

      <HomeworkPreviewContent
        title={details.assignment.title}
        tasks={previewTasks}
        showAnswers={showAnswers}
        showSolutions={showSolutions}
      />
    </div>
  );
}

export default function TutorHomeworkPreview() {
  return <TutorHomeworkPreviewContent />;
}
