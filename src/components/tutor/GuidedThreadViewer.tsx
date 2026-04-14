import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { ChevronDown, ChevronUp, Loader2, Paperclip, Send, X } from 'lucide-react';
import { MathText } from '@/components/kb/ui/MathText';
import { parseISO } from 'date-fns';
import { toast } from 'sonner';
import {
  getTutorStudentGuidedThread,
  postTutorThreadMessage,
  getHomeworkImageSignedUrl,
  getTutorTaskImagesSignedUrls,
  mergeThreadMessage,
  uploadTutorHomeworkTaskImage,
  type TutorStudentGuidedThreadResponse,
} from '@/lib/tutorHomeworkApi';
import {
  createTutorRetry,
  tutorRetryDelay,
  TUTOR_STALE_TIME_MS,
  TUTOR_GC_TIME_MS,
} from '@/hooks/tutorQueryOptions';
import { ThreadAttachments } from '@/components/homework/ThreadAttachments';
import { PhotoGallery } from '@/components/homework/shared/PhotoGallery';
import { supabase } from '@/lib/supabaseClient';
import type { Database } from '@/integrations/supabase/types';
import { parseAttachmentUrls } from '@/lib/attachmentRefs';

const STICKY_BOTTOM_THRESHOLD_PX = 100;

const ROLE_LABELS: Record<string, string> = {
  user: 'Ученик',
  assistant: 'AI',
  system: 'Система',
  tutor: 'Репетитор',
};

const TASK_STATUS_LABELS: Record<string, string> = {
  locked: 'Закрыта',
  active: 'Активная',
  completed: 'Завершена',
  skipped: 'Пропущена',
};

// ─── Task condition gallery with click-to-zoom ─────────────────────────────
function TaskContextGallery({
  assignmentId,
  taskId,
  taskImageUrl,
}: {
  assignmentId: string;
  taskId: string;
  taskImageUrl: string | null;
}) {
  const refs = useMemo(() => parseAttachmentUrls(taskImageUrl), [taskImageUrl]);
  const hasExternalOnly = refs.length > 0 && refs.every((ref) => /^(https?:\/\/|data:)/i.test(ref));

  const imageQuery = useQuery<string[]>({
    queryKey: ['tutor', 'homework', 'task-images-preview', assignmentId, taskId],
    queryFn: () => getTutorTaskImagesSignedUrls(assignmentId, taskId),
    enabled: refs.length > 0 && !hasExternalOnly,
    staleTime: TUTOR_STALE_TIME_MS,
    gcTime: TUTOR_GC_TIME_MS,
    retry: 1,
  });

  if (refs.length === 0) return null;

  if (imageQuery.isLoading) {
    return <Skeleton className="mt-2 h-24 w-40 rounded-md" />;
  }

  const resolvedUrls = imageQuery.data && imageQuery.data.length > 0
    ? imageQuery.data
    : refs.filter((ref) => /^(https?:\/\/|data:)/i.test(ref));

  if (resolvedUrls.length === 0) {
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        Фото задачи недоступно
      </p>
    );
  }

  return (
    <PhotoGallery
      images={resolvedUrls}
      dialogTitle="Фото задачи"
      dialogDescription="Изображения условия задачи"
      imageAltPrefix="Фото условия задачи"
      singleThumbnailClassName="h-24 w-auto max-w-[220px] rounded-sm object-cover"
      multiThumbnailClassName="h-24 w-[120px] rounded-md border border-slate-200 bg-white object-contain"
    />
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export function GuidedThreadViewer({
  assignmentId,
  studentId,
  enabled = true,
  initialTaskFilter = 'all',
  hideTaskFilter = false,
  hideOuterCard = false,
}: {
  assignmentId: string;
  studentId: string;
  /** Controls whether the thread query fires. Parent should pass false when viewer is collapsed. */
  enabled?: boolean;
  /**
   * Initial value of the task filter. Parent should force a remount via `key`
   * when changing this — StudentDrillDown (TASK-6) keys the viewer by the
   * selected task so the internal filter always reflects the new selection.
   */
  initialTaskFilter?: number | 'all';
  /**
   * Hide the internal task filter pill row. Used by StudentDrillDown so the
   * TaskMiniCard row is the single task selector inside the drill-down — no
   * duplicate switches that could leave the two surfaces out of sync.
   */
  hideTaskFilter?: boolean;
  /**
   * Render without the outer `<Card>` wrapper. Used by `StudentDrillDown` so
   * we don't get cards-in-cards (parent already wraps the drill-down in a
   * Card with the «Разбор ученика» title).
   */
  hideOuterCard?: boolean;
}) {
  // Job: Видеть прогресс ученика по ДЗ без дёрганий во время занятия.
  const [taskFilter, setTaskFilter] = useState<number | 'all'>(initialTaskFilter);
  const [isTaskContextExpanded, setIsTaskContextExpanded] = useState(true);
  const [messageText, setMessageText] = useState('');
  const [hiddenNote, setHiddenNote] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [attachPreview, setAttachPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const threadQueryKey = useMemo(
    () => ['tutor', 'homework', 'thread', assignmentId, studentId] as const,
    [assignmentId, studentId],
  );

  const threadQuery = useQuery<TutorStudentGuidedThreadResponse>({
    queryKey: threadQueryKey,
    queryFn: () => getTutorStudentGuidedThread(assignmentId, studentId),
    enabled,
    staleTime: TUTOR_STALE_TIME_MS,
    gcTime: TUTOR_GC_TIME_MS,
    retry: createTutorRetry(threadQueryKey),
    retryDelay: tutorRetryDelay,
    refetchOnWindowFocus: false,
  });
  const threadId = threadQuery.data?.thread.id;
  const getWasAtBottom = useCallback(() => {
    const element = scrollContainerRef.current;
    if (!element) return true;
    return element.scrollHeight - element.scrollTop - element.clientHeight < STICKY_BOTTOM_THRESHOLD_PX;
  }, []);

  const scrollToBottomIfNeeded = useCallback((wasAtBottom: boolean) => {
    if (!wasAtBottom) return;
    requestAnimationFrame(() => {
      const element = scrollContainerRef.current;
      if (!element) return;
      element.scrollTop = element.scrollHeight;
    });
  }, []);

  useEffect(() => {
    if (!enabled || !threadId) return;

    // Cleanup обязателен — иначе утечка каналов при rapid toggle.
    const channel = supabase
      .channel(`thread-${threadId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'homework_tutor_thread_messages',
          filter: `thread_id=eq.${threadId}`,
        },
        (payload) => {
          const element = scrollContainerRef.current;
          const wasAtBottom =
            !element ||
            element.scrollHeight - element.scrollTop - element.clientHeight < STICKY_BOTTOM_THRESHOLD_PX;
          const newMessage = payload.new as Database['public']['Tables']['homework_tutor_thread_messages']['Row'];
          queryClient.setQueryData<TutorStudentGuidedThreadResponse | undefined>(
            ['tutor', 'homework', 'thread', assignmentId, studentId],
            (prev) =>
              mergeThreadMessage(prev, {
                id: newMessage.id,
                role: newMessage.role as 'user' | 'assistant' | 'system' | 'tutor',
                content: newMessage.content,
                image_url: newMessage.image_url,
                task_id: newMessage.task_id,
                task_order: newMessage.task_order,
                created_at: newMessage.created_at,
                message_kind: (newMessage.message_kind as import('@/types/homework').GuidedMessageKind) ?? undefined,
                author_user_id: newMessage.author_user_id,
                visible_to_student: newMessage.visible_to_student,
              }),
          );
          if (wasAtBottom) {
            requestAnimationFrame(() => {
              const nextElement = scrollContainerRef.current;
              if (!nextElement) return;
              nextElement.scrollTop = nextElement.scrollHeight;
            });
          }
        },
      )
      .subscribe();

    return () => {
      void channel.unsubscribe();
    };
  }, [enabled, threadId, queryClient]);

  const taskStatusById = useMemo(
    () => new Map((threadQuery.data?.thread.homework_tutor_task_states ?? []).map((state) => [state.task_id, state])),
    [threadQuery.data?.thread.homework_tutor_task_states],
  );

  // Resolve task_id → current order_num for display (reorder-safe)
  const taskOrderById = useMemo(
    () => new Map((threadQuery.data?.tasks ?? []).map((task) => [task.id, task.order_num])),
    [threadQuery.data?.tasks],
  );

  const selectedTask = useMemo(() => {
    if (taskFilter === 'all') return null;
    return threadQuery.data?.tasks.find((task) => task.order_num === taskFilter) ?? null;
  }, [taskFilter, threadQuery.data?.tasks]);

  // Раскрываем блок при каждой смене задачи — иначе репетитор «теряет» условие.
  useEffect(() => {
    setIsTaskContextExpanded(true);
  }, [taskFilter]);

  const filteredMessages = useMemo(() => {
    const allMessages = threadQuery.data?.thread.homework_tutor_thread_messages ?? [];
    if (taskFilter === 'all') return allMessages;
    const task = selectedTask ?? threadQuery.data?.tasks.find((item) => item.order_num === taskFilter) ?? null;
    return allMessages.filter((message) => {
      if (!task) return false;
      // Prefer immutable task_id; fall back to task_order only for pre-migration messages
      if (message.task_id) return message.task_id === task.id;
      return message.task_order === task.order_num;
    });
  }, [selectedTask, taskFilter, threadQuery.data?.tasks, threadQuery.data?.thread.homework_tutor_thread_messages]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error('Файл слишком большой (макс. 10 МБ)');
      return;
    }
    setAttachedFile(file);
    // Revoke previous preview URL to avoid memory leak
    setAttachPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
    });
    // Reset input so the same file can be re-selected
    e.target.value = '';
  }, []);

  const clearAttachment = useCallback(() => {
    if (attachPreview) URL.revokeObjectURL(attachPreview);
    setAttachedFile(null);
    setAttachPreview(null);
  }, [attachPreview]);

  const handleSendMessage = useCallback(async () => {
    const trimmed = messageText.trim();
    if ((!trimmed && !attachedFile) || isSending) return;
    setIsSending(true);
    try {
      let imageUrl: string | undefined;
      if (attachedFile) {
        const upload = await uploadTutorHomeworkTaskImage(attachedFile);
        imageUrl = upload.storageRef;
      }
      const response = await postTutorThreadMessage(assignmentId, studentId, trimmed || '(файл)', {
        visible_to_student: !hiddenNote,
        task_order: taskFilter === 'all' ? undefined : taskFilter,
        task_id: taskFilter === 'all' ? undefined : selectedTask?.id,
        image_url: imageUrl,
      });
      const wasAtBottom = getWasAtBottom();
      queryClient.setQueryData<TutorStudentGuidedThreadResponse | undefined>(
        threadQueryKey,
        (prev) =>
          mergeThreadMessage(prev, {
            id: response.id,
            role: 'tutor',
            content: trimmed || '(файл)',
            image_url: imageUrl ?? null,
            task_id: taskFilter === 'all' ? null : selectedTask?.id ?? null,
            task_order: taskFilter === 'all' ? null : taskFilter,
            created_at: response.created_at,
            visible_to_student: !hiddenNote,
          }),
      );
      scrollToBottomIfNeeded(wasAtBottom);
      setMessageText('');
      clearAttachment();
      toast.success(hiddenNote ? 'Заметка сохранена' : 'Сообщение отправлено');
    } catch (err) {
      toast.error(`Ошибка: ${err instanceof Error ? err.message : 'неизвестная'}`);
    } finally {
      setIsSending(false);
    }
  }, [messageText, attachedFile, hiddenNote, isSending, assignmentId, selectedTask?.id, studentId, taskFilter, clearAttachment, getWasAtBottom, queryClient, scrollToBottomIfNeeded, threadQueryKey]);

  const body = (
    <div className="space-y-3">
          {threadQuery.isLoading ? (
            <div className="text-xs text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Загружаем переписку...
            </div>
          ) : null}

          {threadQuery.error ? (
            <div className="text-xs text-destructive">
              Не удалось загрузить переписку: {threadQuery.error instanceof Error ? threadQuery.error.message : 'unknown'}
            </div>
          ) : null}

          {threadQuery.data && (
            <>
              {hideTaskFilter ? null : (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant={taskFilter === 'all' ? 'default' : 'outline'}
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setTaskFilter('all')}
                  >
                    Все задачи
                  </Button>
                  {threadQuery.data.tasks.map((task) => {
                    const state = taskStatusById.get(task.id);
                    return (
                      <Button
                        key={task.id}
                        variant={taskFilter === task.order_num ? 'default' : 'outline'}
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => setTaskFilter(task.order_num)}
                      >
                        #{task.order_num} {TASK_STATUS_LABELS[state?.status ?? 'locked'] ?? state?.status}
                      </Button>
                    );
                  })}
                </div>
              )}

              {selectedTask && (
                <div className="rounded-md border bg-background p-3 text-xs space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-muted-foreground">
                      Условие задачи #{selectedTask.order_num}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto h-6 w-6 p-0 shrink-0"
                      onClick={() => setIsTaskContextExpanded((prev) => !prev)}
                      title={isTaskContextExpanded ? 'Свернуть' : 'Развернуть'}
                      aria-expanded={isTaskContextExpanded}
                      aria-label={isTaskContextExpanded ? 'Свернуть условие задачи' : 'Развернуть условие задачи'}
                    >
                      {isTaskContextExpanded ? (
                        <ChevronUp className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                  {isTaskContextExpanded && (
                    <div className="max-h-[200px] overflow-y-auto space-y-2">
                      <MathText
                        text={selectedTask.task_text}
                        className="whitespace-pre-wrap leading-relaxed break-words"
                      />
                      <TaskContextGallery
                        key={selectedTask.id}
                        assignmentId={assignmentId}
                        taskId={selectedTask.id}
                        taskImageUrl={selectedTask.task_image_url}
                      />
                    </div>
                  )}
                </div>
              )}

              <div
                ref={scrollContainerRef}
                className="rounded-md border bg-background p-2 max-h-[320px] overflow-y-auto space-y-2"
              >
                {filteredMessages.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Сообщений по этому фильтру пока нет.</p>
                ) : (
                  filteredMessages.map((message) => (
                    <div key={message.id} className="rounded-md border p-2 text-xs space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant={
                          message.role === 'tutor' ? 'default' :
                          message.role === 'assistant' ? 'secondary' : 'outline'
                        }>
                          {ROLE_LABELS[message.role] ?? message.role}
                        </Badge>
                        {message.message_kind === 'system' && message.role === 'assistant' && (
                          <Badge variant="outline" className="text-[10px] bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800">
                            Введение
                          </Badge>
                        )}
                        {message.visible_to_student === false && (
                          <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800">
                            Скрыто от ученика
                          </Badge>
                        )}
                        <span className="text-muted-foreground ml-auto">
                          {(() => {
                            const displayOrder = message.task_id
                              ? taskOrderById.get(message.task_id) ?? message.task_order
                              : message.task_order;
                            return displayOrder ? `Задача ${displayOrder}` : '';
                          })()}
                        </span>
                        <span className="text-muted-foreground">
                          {parseISO(message.created_at).toLocaleString('ru-RU')}
                        </span>
                      </div>
                      <MathText text={message.content} className="whitespace-pre-wrap leading-relaxed break-words" />
                      {message.image_url && (
                        <ThreadAttachments
                          attachmentValue={message.image_url}
                          resolveSignedUrl={(ref) => getHomeworkImageSignedUrl(ref, { defaultBucket: 'homework-images' })}
                          compact
                        />
                      )}
                    </div>
                  ))
                )}
              </div>

              {/* Tutor input area */}
              <div className="space-y-2 pt-1 border-t">
                <div className="flex items-center gap-2">
                  <Switch
                    id={`hidden-note-${studentId}`}
                    checked={hiddenNote}
                    onCheckedChange={setHiddenNote}
                  />
                  <Label htmlFor={`hidden-note-${studentId}`} className="text-xs cursor-pointer select-none">
                    {hiddenNote ? 'Скрытая заметка (для AI, не видна ученику)' : 'Сообщение ученику'}
                  </Label>
                </div>
                {/* Attachment preview */}
                {attachedFile && (
                  <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-2">
                    {attachPreview ? (
                      <img src={attachPreview} alt="Превью" className="h-12 w-auto max-w-[80px] rounded-sm object-cover" loading="lazy" />
                    ) : (
                      <Paperclip className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span className="text-xs text-muted-foreground truncate flex-1">{attachedFile.name}</span>
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0 shrink-0" onClick={clearAttachment}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
                <div className="flex items-end gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleFileSelect}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0 px-2"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isSending}
                    title="Прикрепить файл"
                  >
                    <Paperclip className="h-4 w-4" />
                  </Button>
                  <textarea
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    placeholder={hiddenNote ? 'Инструкция для AI (ученик не увидит)...' : 'Сообщение ученику...'}
                    className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[40px] focus:outline-none focus:ring-2 focus:ring-ring"
                    rows={2}
                    style={{ fontSize: '16px' }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        void handleSendMessage();
                      }
                    }}
                  />
                  <Button
                    size="sm"
                    onClick={() => void handleSendMessage()}
                    disabled={(!messageText.trim() && !attachedFile) || isSending}
                    className="shrink-0"
                  >
                    {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            </>
          )}
    </div>
  );

  if (hideOuterCard) {
    return body;
  }

  return (
    <Card className="border-dashed">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Переписка по ДЗ</CardTitle>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
