/**
 * Main workspace component for guided homework chat.
 * Students solve tasks one by one in an interactive chat with AI.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, CheckCircle2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import GuidedChatMessage from './GuidedChatMessage';
import GuidedChatInput from './GuidedChatInput';
import TaskStepper from './TaskStepper';
import type { TaskStepItem } from './TaskStepper';
import type {
  StudentHomeworkAssignmentDetails,
  HomeworkThread,
  HomeworkThreadMessage,
  HomeworkTaskState,
  TaskStateStatus,
} from '@/types/homework';
import { useStudentThread } from '@/hooks/useStudentHomework';
import { saveThreadMessage, advanceTask } from '@/lib/studentHomeworkApi';
import { streamChat, StreamChatError } from '@/lib/streamChat';

const MAX_CONTEXT_MESSAGES = 15;

interface GuidedHomeworkWorkspaceProps {
  assignment: StudentHomeworkAssignmentDetails;
}

/** Build the AI task context string */
function buildTaskContext(
  assignment: StudentHomeworkAssignmentDetails,
  currentTask: { order_num: number; task_text: string },
  totalTasks: number,
): string {
  const parts = [
    `Задание: "${assignment.title}" по предмету ${assignment.subject}.`,
    assignment.topic ? `Тема: ${assignment.topic}.` : null,
    `Задача ${currentTask.order_num} из ${totalTasks}: ${currentTask.task_text}`,
    '',
    'Помоги ученику разобраться. Задавай наводящие вопросы. Не давай готовый ответ сразу.',
    'Объясняй по шагам, используй формулы в LaTeX ($..$ или $$..$$) если нужно.',
  ];
  return parts.filter(Boolean).join('\n');
}

export default function GuidedHomeworkWorkspace({ assignment }: GuidedHomeworkWorkspaceProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const {
    data: thread,
    isLoading: isThreadLoading,
    error: threadError,
  } = useStudentThread(assignment.id);

  // Local state
  const [messages, setMessages] = useState<HomeworkThreadMessage[]>([]);
  const [taskStates, setTaskStates] = useState<HomeworkTaskState[]>([]);
  const [currentTaskOrder, setCurrentTaskOrder] = useState(1);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [isAdvancing, setIsAdvancing] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [threadStatus, setThreadStatus] = useState<'active' | 'completed' | 'abandoned'>('active');

  // Initialize from thread data
  useEffect(() => {
    if (thread) {
      setMessages(thread.homework_tutor_thread_messages ?? []);
      setTaskStates(thread.homework_tutor_task_states ?? []);
      setCurrentTaskOrder(thread.current_task_order);
      setThreadId(thread.id);
      setThreadStatus(thread.status);
    }
  }, [thread]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, streamingContent]);

  // Build task stepper items
  const taskStepItems: TaskStepItem[] = useMemo(() => {
    const stateByTaskId = new Map(
      taskStates.map((ts) => [ts.task_id, ts]),
    );
    return assignment.tasks.map((task) => {
      const state = stateByTaskId.get(task.id);
      return {
        order_num: task.order_num,
        task_text: task.task_text,
        status: (state?.status ?? 'locked') as TaskStateStatus,
      };
    });
  }, [assignment.tasks, taskStates]);

  // Current task info
  const currentTask = useMemo(
    () => assignment.tasks.find((t) => t.order_num === currentTaskOrder),
    [assignment.tasks, currentTaskOrder],
  );

  // Messages filtered for current task (show all for context)
  const visibleMessages = useMemo(
    () => messages,
    [messages],
  );

  // Handle sending a message
  const handleSend = useCallback(
    async (text: string) => {
      if (!threadId || isStreaming || !currentTask) return;

      // Optimistically add user message
      const tempUserMsg: HomeworkThreadMessage = {
        id: `temp-${Date.now()}`,
        role: 'user',
        content: text,
        image_url: null,
        task_order: currentTaskOrder,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, tempUserMsg]);

      // Save user message (async, non-blocking)
      saveThreadMessage(threadId, 'user', text, currentTaskOrder).catch((err) => {
        console.warn('Failed to save user message:', err);
      });

      // Build messages for AI (last N messages + system context)
      const recentMessages = [...messages, tempUserMsg]
        .slice(-MAX_CONTEXT_MESSAGES)
        .map((m) => ({
          role: m.role === 'system' ? 'assistant' : m.role,
          content: m.content,
        }));

      const taskContext = buildTaskContext(assignment, currentTask, assignment.tasks.length);

      // Start streaming
      setIsStreaming(true);
      setStreamingContent('');
      let fullContent = '';

      try {
        await streamChat({
          messages: recentMessages,
          taskContext,
          onDelta: (delta) => {
            fullContent += delta;
            setStreamingContent(fullContent);
          },
          onDone: () => {
            // Add assistant message to state
            const assistantMsg: HomeworkThreadMessage = {
              id: `temp-assistant-${Date.now()}`,
              role: 'assistant',
              content: fullContent,
              image_url: null,
              task_order: currentTaskOrder,
              created_at: new Date().toISOString(),
            };
            setMessages((prev) => [...prev, assistantMsg]);
            setStreamingContent('');
            setIsStreaming(false);

            // Save assistant message (async, non-blocking)
            if (threadId) {
              saveThreadMessage(threadId, 'assistant', fullContent, currentTaskOrder).catch(
                (err) => {
                  console.warn('Failed to save assistant message:', err);
                },
              );
            }
          },
          onError: (err) => {
            setIsStreaming(false);
            setStreamingContent('');
            if (err instanceof StreamChatError) {
              if (err.code === 'LIMIT_REACHED') {
                toast.error('Достигнут дневной лимит сообщений');
              } else if (err.code === 'PAYMENT_REQUIRED') {
                toast.error('Требуется пополнение баланса');
              } else {
                toast.error(err.message);
              }
            } else {
              toast.error('Ошибка при получении ответа. Попробуйте ещё раз.');
            }
          },
        });
      } catch {
        // Error already handled in onError callback
        setIsStreaming(false);
        setStreamingContent('');
      }
    },
    [threadId, isStreaming, currentTask, currentTaskOrder, messages, assignment],
  );

  // Handle task advancement
  const handleAdvanceTask = useCallback(async () => {
    if (!threadId || isAdvancing || isStreaming) return;

    setIsAdvancing(true);
    try {
      const updatedThread = await advanceTask(threadId);
      // Update local state from server response
      setMessages(updatedThread.homework_tutor_thread_messages ?? []);
      setTaskStates(updatedThread.homework_tutor_task_states ?? []);
      setCurrentTaskOrder(updatedThread.current_task_order);
      setThreadStatus(updatedThread.status);

      // Invalidate thread query cache
      await queryClient.invalidateQueries({
        queryKey: ['student', 'homework', 'thread', assignment.id],
      });

      if (updatedThread.status === 'completed') {
        toast.success('Все задачи выполнены! 🎉');
      } else {
        toast.success(`Задача ${currentTaskOrder} выполнена! Переходим дальше.`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось продвинуться дальше');
    } finally {
      setIsAdvancing(false);
    }
  }, [threadId, isAdvancing, isStreaming, currentTaskOrder, assignment.id, queryClient]);

  // Handle task click in stepper
  const handleTaskClick = useCallback(
    (orderNum: number) => {
      // Only allow clicking completed or active tasks
      const step = taskStepItems.find((s) => s.order_num === orderNum);
      if (step && (step.status === 'active' || step.status === 'completed')) {
        setCurrentTaskOrder(orderNum);
      }
    },
    [taskStepItems],
  );

  // Loading state
  if (isThreadLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Error state
  if (threadError) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center space-y-4">
            <p className="text-destructive">Не удалось загрузить чат</p>
            <p className="text-sm text-muted-foreground">
              {threadError instanceof Error ? threadError.message : 'Попробуйте позже'}
            </p>
            <Button variant="outline" onClick={() => navigate('/homework')}>
              Назад к заданиям
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // No thread found (assignment might not have guided mode or not provisioned yet)
  if (!thread) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center space-y-4">
            <p className="text-muted-foreground">Интерактивный чат пока не готов</p>
            <p className="text-sm text-muted-foreground">
              Попросите репетитора назначить вам это задание
            </p>
            <Button variant="outline" onClick={() => navigate('/homework')}>
              Назад к заданиям
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Completed state
  if (threadStatus === 'completed') {
    const completedCount = taskStates.filter((s) => s.status === 'completed').length;
    return (
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="border-b px-4 py-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/homework')}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="flex-1 min-w-0">
              <h1 className="text-sm font-semibold truncate">{assignment.title}</h1>
              <p className="text-xs text-muted-foreground">{assignment.subject}</p>
            </div>
          </div>
        </div>

        <div className="flex-1 flex items-center justify-center p-4">
          <Card className="max-w-md w-full">
            <CardHeader className="text-center">
              <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-2" />
              <CardTitle>Все задачи выполнены!</CardTitle>
            </CardHeader>
            <CardContent className="text-center space-y-4">
              <p className="text-muted-foreground">
                Вы решили {completedCount} из {assignment.tasks.length} задач
              </p>
              <TaskStepper
                tasks={taskStepItems}
                currentTaskOrder={currentTaskOrder}
              />
              <Button onClick={() => navigate('/homework')} className="w-full">
                Назад к заданиям
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Active chat workspace
  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="border-b px-4 py-3 shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/homework')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-semibold truncate">{assignment.title}</h1>
            <p className="text-xs text-muted-foreground">{assignment.subject}</p>
          </div>
        </div>
      </div>

      {/* Task stepper */}
      <div className="border-b px-4 py-1 shrink-0 bg-muted/30">
        <TaskStepper
          tasks={taskStepItems}
          currentTaskOrder={currentTaskOrder}
          onTaskClick={handleTaskClick}
        />
      </div>

      {/* Current task text */}
      {currentTask && (
        <div className="border-b px-4 py-3 shrink-0 bg-blue-50/50 dark:bg-blue-950/20">
          <p className="text-xs text-muted-foreground mb-1">
            Задача {currentTask.order_num} из {assignment.tasks.length}
          </p>
          <p className="text-sm font-medium">{currentTask.task_text}</p>
        </div>
      )}

      {/* Chat messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 min-h-0">
        {visibleMessages.length === 0 && !isStreaming && (
          <div className="text-center text-sm text-muted-foreground py-8">
            Напишите свой ответ или попросите подсказку
          </div>
        )}

        {visibleMessages.map((msg) => (
          <GuidedChatMessage key={msg.id} message={msg} />
        ))}

        {/* Streaming message */}
        {isStreaming && streamingContent && (
          <GuidedChatMessage
            message={{
              role: 'assistant',
              content: streamingContent,
            }}
            isStreaming
          />
        )}

        {/* Streaming indicator without content yet */}
        {isStreaming && !streamingContent && (
          <div className="flex justify-start mb-3">
            <div className="bg-muted rounded-2xl rounded-bl-md px-4 py-3">
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-muted-foreground/40 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Task completion button + Input */}
      <div className="shrink-0">
        {/* "Task completed" button — only for active tasks with at least 1 message */}
        {currentTask && messages.some((m) => m.role === 'user' && m.task_order === currentTaskOrder) && (
          <div className="px-4 pb-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full text-green-600 border-green-300 hover:bg-green-50 dark:text-green-400 dark:border-green-800 dark:hover:bg-green-950/30"
              onClick={handleAdvanceTask}
              disabled={isAdvancing || isStreaming}
            >
              {isAdvancing ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <CheckCircle2 className="w-4 h-4 mr-2" />
              )}
              Задача выполнена
            </Button>
          </div>
        )}

        <GuidedChatInput
          onSend={handleSend}
          isLoading={isStreaming}
          disabled={threadStatus !== 'active'}
          placeholder={
            currentTask
              ? `Ответ на задачу ${currentTask.order_num}...`
              : 'Напишите ответ...'
          }
        />
      </div>
    </div>
  );
}
