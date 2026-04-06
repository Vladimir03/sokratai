import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Loader2, Paperclip, Send, X } from 'lucide-react';
import { MathText } from '@/components/kb/ui/MathText';
import { parseISO } from 'date-fns';
import { toast } from 'sonner';
import {
  getTutorStudentGuidedThread,
  postTutorThreadMessage,
  getHomeworkImageSignedUrl,
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
import { supabase } from '@/lib/supabaseClient';
import type { Database } from '@/integrations/supabase/types';

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

// ─── Main component ─────────────────────────────────────────────────────────

export function GuidedThreadViewer({
  assignmentId,
  studentId,
  enabled = true,
}: {
  assignmentId: string;
  studentId: string;
  /** Controls whether the thread query fires. Parent should pass false when viewer is collapsed. */
  enabled?: boolean;
}) {
  // Job: Видеть прогресс ученика по ДЗ без дёрганий во время занятия.
  const [taskFilter, setTaskFilter] = useState<number | 'all'>('all');
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

  const filteredMessages = useMemo(() => {
    const allMessages = threadQuery.data?.thread.homework_tutor_thread_messages ?? [];
    if (taskFilter === 'all') return allMessages;
    return allMessages.filter((message) => message.task_order === taskFilter);
  }, [taskFilter, threadQuery.data?.thread.homework_tutor_thread_messages]);

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
  }, [messageText, attachedFile, hiddenNote, isSending, assignmentId, studentId, taskFilter, clearAttachment, getWasAtBottom, queryClient, scrollToBottomIfNeeded, threadQueryKey]);

  return (
    <Card className="border-dashed">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Переписка по ДЗ</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
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
                          {message.task_order ? `Задача ${message.task_order}` : ''}
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
      </CardContent>
    </Card>
  );
}
