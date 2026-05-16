import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { ChevronDown, ChevronUp, Loader2, Paperclip, Pencil, Send, X } from 'lucide-react';
import { MathText } from '@/components/kb/ui/MathText';
import { toast } from 'sonner';
import {
  getTutorStudentGuidedThread,
  postTutorThreadMessage,
  getHomeworkImageSignedUrl,
  getTutorTaskImagesSignedUrls,
  markThreadViewedByTutor,
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
import { PhotoGallery } from '@/components/homework/shared/PhotoGallery';
import GuidedChatMessage from '@/components/homework/GuidedChatMessage';
import { EditScoreDialog } from '@/components/tutor/results/EditScoreDialog';
import { supabase } from '@/lib/supabaseClient';
import type { Database } from '@/integrations/supabase/types';
import { parseAttachmentUrls } from '@/lib/attachmentRefs';

const STICKY_BOTTOM_THRESHOLD_PX = 100;

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
  studentNameOverride,
  enabled = true,
  initialTaskFilter = 'all',
  hideTaskFilter = false,
  hideOuterCard = false,
}: {
  assignmentId: string;
  studentId: string;
  /**
   * Optional student display name resolved by the parent (e.g.
   * TutorHomeworkDetail uses `details.assigned_students[*].name` which is
   * already resolved server-side). When provided, it wins over the viewer's
   * own `student.display_name` from the thread fetch — handy for showing
   * the right name instantly without waiting on the inner query, and
   * keeps the UI consistent with the parent's «Разбор ученика: X» header
   * even if the edge function hasn't redeployed with display_name yet.
   */
  studentNameOverride?: string | null;
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
  const [isEditScoreOpen, setIsEditScoreOpen] = useState(false);
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

  // Fire-and-forget: mark the thread as viewed by the tutor so the
  // «Последние диалоги» block on /tutor/home clears the unread indicator.
  // We invalidate the recent-dialogs query on success so navigating back
  // to /tutor/home shows the freshly-cleared state without a hard reload.
  // One call per thread mount — once viewed, `tutor_last_viewed_at` is
  // bumped and subsequent visits keep the existing timestamp until a new
  // student message arrives.
  const markedViewedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || !threadId) return;
    if (markedViewedForRef.current === threadId) return;
    markedViewedForRef.current = threadId;
    void markThreadViewedByTutor(threadId)
      .then(() => {
        void queryClient.invalidateQueries({
          queryKey: ['tutor', 'home', 'recent-dialogs'],
        });
      })
      .catch((err) => {
        // Non-critical — a failed mark doesn't break the viewer. Next
        // mount will retry (ref is keyed by threadId, not global).
        console.warn('mark_thread_viewed_failed', err);
        markedViewedForRef.current = null;
      });
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

  // Tutor identity for the chat-bubble UI (avatar + name above each tutor
  // message). Backend attaches `tutor_profile` to thread response — see
  // `handleGetTutorStudentThread`. We default to `display_name=undefined`
  // (not empty string) so GuidedChatMessage keeps the legacy «Репетитор»
  // pill if backend hasn't shipped tutor_profile yet (defensive).
  const tutorIdentity = useMemo(() => {
    const profile = threadQuery.data?.thread.tutor_profile ?? null;
    return {
      displayName: profile?.display_name?.trim() || undefined,
      avatarUrl: profile?.avatar_url ?? null,
      gender: profile?.gender ?? null,
    };
  }, [threadQuery.data?.thread.tutor_profile]);

  // Student display label for the tutor-side viewer. Priority:
  //   1. `studentNameOverride` from the parent (already resolved by parent's
  //      query, e.g. `TutorHomeworkDetail.details.assigned_students[*].name`).
  //      Wins because it's instant and stays in sync with the parent's
  //      «Разбор ученика: X» header.
  //   2. Backend `student.display_name` (resolved via `resolveStudentDisplayName`).
  //   3. Defensive fallback chain: `full_name → username (filtered) → "Ученик"`
  //      so the UI degrades gracefully when the edge function deploy lags
  //      behind the frontend bundle.
  const studentDisplayLabel = useMemo(() => {
    const overrideTrimmed = studentNameOverride?.trim();
    if (overrideTrimmed) return overrideTrimmed;

    const student = threadQuery.data?.student;
    const candidates = [
      student?.display_name,
      student?.full_name,
      student?.username,
    ];
    for (const candidate of candidates) {
      if (typeof candidate !== 'string') continue;
      const trimmed = candidate.trim();
      if (!trimmed) continue;
      // Skip auto-generated usernames defensively (backend already filters
      // them, but a pre-migration deploy could leak `telegram_12345`).
      if (/^(telegram_|user_)\d+$/i.test(trimmed)) continue;
      return trimmed;
    }
    return 'Ученик';
  }, [studentNameOverride, threadQuery.data?.student]);

  // Tutor uploads land in the `homework-images` bucket; tutor-side signed-URL
  // requests must use the tutor-scoped resolver. Memoized so GuidedChatMessage
  // memo() doesn't refetch URLs on every render.
  const tutorImageResolver = useCallback(
    (ref: string) => getHomeworkImageSignedUrl(ref, { defaultBucket: 'homework-images' }),
    [],
  );

  const selectedTask = useMemo(() => {
    if (taskFilter === 'all') return null;
    return threadQuery.data?.tasks.find((task) => task.order_num === taskFilter) ?? null;
  }, [taskFilter, threadQuery.data?.tasks]);

  // task_state for the currently selected task. Used to compute the score
  // badge + drive the "Изменить балл" button. Mirrors `computeFinalScore` on
  // the backend — keep the priority chain in sync.
  const selectedTaskState = useMemo(() => {
    if (!selectedTask) return null;
    return taskStatusById.get(selectedTask.id) ?? null;
  }, [selectedTask, taskStatusById]);

  const selectedTaskFinalScore = useMemo<number | null>(() => {
    if (!selectedTask || !selectedTaskState) return null;
    if (selectedTaskState.tutor_score_override != null) return Number(selectedTaskState.tutor_score_override);
    if (selectedTaskState.earned_score != null) return Number(selectedTaskState.earned_score);
    if (selectedTaskState.ai_score != null) return Number(selectedTaskState.ai_score);
    if (selectedTaskState.status === 'completed') return selectedTask.max_score;
    return null;
  }, [selectedTask, selectedTaskState]);

  const canEditScore = selectedTask !== null && selectedTaskState !== null;

  // Раскрываем блок при каждой смене задачи — иначе репетитор «теряет» условие.
  useEffect(() => {
    setIsTaskContextExpanded(true);
  }, [taskFilter]);

  // Close the score dialog when the user switches the active task — avoids
  // a dialog that references a stale task surviving filter changes.
  useEffect(() => {
    setIsEditScoreOpen(false);
  }, [taskFilter]);

  const filteredMessages = useMemo(() => {
    const allMessages = threadQuery.data?.thread.homework_tutor_thread_messages ?? [];
    // Hide internal task-transition system messages ("Задача N выполнена! Переходим к задаче M.",
    // "Все задачи выполнены! 🎉"). They were UI noise — task progress is already visible on the
    // TaskStepper and heatmap. Bootstrap intros (role='assistant' + message_kind='system') keep
    // their "Введение" badge — they have actual content. Audit trail stays in DB.
    const visibleMessages = allMessages.filter((message) => message.role !== 'system');
    if (taskFilter === 'all') return visibleMessages;
    const task = selectedTask ?? threadQuery.data?.tasks.find((item) => item.order_num === taskFilter) ?? null;
    return visibleMessages.filter((message) => {
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

                  {/* Score row + edit-score entry point. Visible regardless of
                      condition-collapse state so tutor can change the score
                      without expanding the task body. Shows AI raw score
                      separately when it differs from final (degradation /
                      override) so the spread is explicit. */}
                  {canEditScore && (
                    <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2">
                      <span className="text-slate-700">
                        Балл:{' '}
                        <span className="font-semibold">
                          {selectedTaskFinalScore != null
                            ? `${selectedTaskFinalScore}/${selectedTask.max_score}`
                            : '—'}
                        </span>
                      </span>
                      {selectedTaskState?.ai_score != null
                        && selectedTaskFinalScore !== Number(selectedTaskState.ai_score) ? (
                        <span className="text-slate-500">
                          AI: {Number(selectedTaskState.ai_score)}/{selectedTask.max_score}
                        </span>
                      ) : null}
                      {selectedTaskState?.tutor_score_override != null ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                          <Pencil className="h-3 w-3" />
                          ручная правка
                        </span>
                      ) : null}
                      <Button
                        variant="outline"
                        size="sm"
                        className="ml-auto h-7 px-2 text-xs touch-manipulation"
                        onClick={() => setIsEditScoreOpen(true)}
                        aria-label={`Изменить балл задачи №${selectedTask.order_num}`}
                      >
                        <Pencil className="h-3 w-3 md:mr-1" />
                        <span className="hidden md:inline">Изменить балл</span>
                      </Button>
                    </div>
                  )}

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
                className="rounded-md border bg-background p-3 max-h-[320px] overflow-y-auto"
              >
                {filteredMessages.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Сообщений по этому фильтру пока нет.</p>
                ) : (
                  filteredMessages.map((message) => {
                    // Resolve task marker only when filter is "all" — otherwise
                    // a single-task filter is implicit context, marker would
                    // duplicate the «Условие задачи #N» block above.
                    const displayOrder = taskFilter === 'all'
                      ? (message.task_id
                          ? taskOrderById.get(message.task_id) ?? message.task_order
                          : message.task_order)
                      : null;
                    const taskMarker = displayOrder ? `Задача ${displayOrder}` : null;
                    return (
                      <GuidedChatMessage
                        key={message.id}
                        message={{
                          id: message.id,
                          role: message.role,
                          content: message.content,
                          image_url: message.image_url ?? null,
                          created_at: message.created_at,
                          message_kind: message.message_kind,
                        }}
                        perspective="tutor"
                        tutorDisplayName={tutorIdentity.displayName}
                        tutorAvatarUrl={tutorIdentity.avatarUrl}
                        tutorGender={tutorIdentity.gender}
                        studentDisplayName={studentDisplayLabel}
                        studentAvatarUrl={null}
                        studentGender={null}
                        taskMarker={taskMarker}
                        hiddenFromStudent={message.visible_to_student === false}
                        imageResolver={tutorImageResolver}
                        showDateInTimestamp
                      />
                    );
                  })
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

      {/* Edit-score dialog mounted at the viewer level so it works for both
          the standalone <Card> wrapper (Detail page direct viewer) and the
          hideOuterCard mode (StudentDrillDown). Closes on task switch and
          on save success — see the cleanup useEffect above. */}
      {selectedTask && canEditScore ? (
        <EditScoreDialog
          open={isEditScoreOpen}
          onOpenChange={setIsEditScoreOpen}
          assignmentId={assignmentId}
          studentId={studentId}
          task={{
            id: selectedTask.id,
            order_num: selectedTask.order_num,
            max_score: selectedTask.max_score,
          }}
          aiScore={selectedTaskState?.ai_score ?? null}
          aiScoreComment={selectedTaskState?.ai_score_comment ?? null}
          finalScore={selectedTaskFinalScore}
          currentOverride={selectedTaskState?.tutor_score_override ?? null}
          currentComment={selectedTaskState?.tutor_score_override_comment ?? null}
          status={(selectedTaskState?.status ?? 'active') as 'active' | 'completed' | 'locked' | 'skipped'}
          tutorForceCompletedAt={selectedTaskState?.tutor_force_completed_at ?? null}
        />
      ) : null}
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
