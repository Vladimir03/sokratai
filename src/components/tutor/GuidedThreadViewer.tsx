import { useState, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Loader2, Send, RotateCcw } from 'lucide-react';
import { parseISO } from 'date-fns';
import { toast } from 'sonner';
import {
  getTutorStudentGuidedThread,
  postTutorThreadMessage,
  resetTutorStudentTask,
  type TutorStudentGuidedThreadResponse,
} from '@/lib/tutorHomeworkApi';
import {
  createTutorRetry,
  tutorRetryDelay,
  TUTOR_STALE_TIME_MS,
  TUTOR_GC_TIME_MS,
} from '@/hooks/tutorQueryOptions';

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

export function GuidedThreadViewer({
  assignmentId,
  studentId,
}: {
  assignmentId: string;
  studentId: string;
}) {
  const [opened, setOpened] = useState(false);
  const [taskFilter, setTaskFilter] = useState<number | 'all'>('all');
  const [messageText, setMessageText] = useState('');
  const [hiddenNote, setHiddenNote] = useState(false);
  const [isSending, setIsSending] = useState(false);

  const threadQuery = useQuery<TutorStudentGuidedThreadResponse>({
    queryKey: ['tutor', 'homework', 'guided-thread', assignmentId, studentId],
    queryFn: () => getTutorStudentGuidedThread(assignmentId, studentId),
    enabled: opened,
    staleTime: TUTOR_STALE_TIME_MS,
    gcTime: TUTOR_GC_TIME_MS,
    retry: createTutorRetry(['tutor', 'homework', 'guided-thread', assignmentId, studentId] as const),
    retryDelay: tutorRetryDelay,
    refetchOnWindowFocus: false,
  });

  const taskStatusById = useMemo(
    () => new Map((threadQuery.data?.thread.homework_tutor_task_states ?? []).map((state) => [state.task_id, state])),
    [threadQuery.data?.thread.homework_tutor_task_states],
  );

  const filteredMessages = useMemo(() => {
    const allMessages = threadQuery.data?.thread.homework_tutor_thread_messages ?? [];
    if (taskFilter === 'all') return allMessages;
    return allMessages.filter((message) => message.task_order === taskFilter);
  }, [taskFilter, threadQuery.data?.thread.homework_tutor_thread_messages]);

  const handleSendMessage = useCallback(async () => {
    const trimmed = messageText.trim();
    if (!trimmed || isSending) return;
    setIsSending(true);
    try {
      await postTutorThreadMessage(assignmentId, studentId, trimmed, {
        visible_to_student: !hiddenNote,
        task_order: taskFilter === 'all' ? undefined : taskFilter,
      });
      setMessageText('');
      void threadQuery.refetch();
      toast.success(hiddenNote ? 'Заметка сохранена' : 'Сообщение отправлено');
    } catch (err) {
      toast.error(`Ошибка: ${err instanceof Error ? err.message : 'неизвестная'}`);
    } finally {
      setIsSending(false);
    }
  }, [messageText, hiddenNote, isSending, assignmentId, studentId, taskFilter, threadQuery]);

  const handleResetTask = useCallback(async (taskOrder: number) => {
    try {
      await resetTutorStudentTask(assignmentId, studentId, taskOrder);
      toast.success(`Задача ${taskOrder} сброшена`);
      void threadQuery.refetch();
    } catch (err) {
      toast.error(`Ошибка: ${err instanceof Error ? err.message : 'неизвестная'}`);
    }
  }, [assignmentId, studentId, threadQuery]);

  return (
    <Card className="border-dashed">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm">Переписка по ДЗ</CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setOpened((prev) => !prev)}
          >
            {opened ? 'Скрыть' : 'Показать переписку'}
          </Button>
        </div>
      </CardHeader>
      {opened && (
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
                  const canReset = state?.status === 'completed' || state?.status === 'active';
                  return (
                    <div key={task.id} className="flex items-center gap-0.5">
                      <Button
                        variant={taskFilter === task.order_num ? 'default' : 'outline'}
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => setTaskFilter(task.order_num)}
                      >
                        #{task.order_num} {TASK_STATUS_LABELS[state?.status ?? 'locked'] ?? state?.status}
                      </Button>
                      {canReset && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                          onClick={() => handleResetTask(task.order_num)}
                          title="Сбросить задачу"
                        >
                          <RotateCcw className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="rounded-md border bg-background p-2 max-h-[320px] overflow-y-auto space-y-2">
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
                      <div className="whitespace-pre-wrap leading-relaxed break-words">
                        {message.content}
                      </div>
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
                <div className="flex items-end gap-2">
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
                    disabled={!messageText.trim() || isSending}
                    className="shrink-0"
                  >
                    {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}
