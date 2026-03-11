/**
 * Main workspace component for guided homework chat.
 * Students solve tasks one by one in an interactive chat with AI.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Lightbulb,
  Loader2,
  ZoomIn,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import GuidedChatMessage from './GuidedChatMessage';
import GuidedChatInput from './GuidedChatInput';
import TaskStepper from './TaskStepper';
import type { TaskStepItem } from './TaskStepper';
import type {
  CheckAnswerResponse,
  GuidedHomeworkUiStatus,
  GuidedMessageKind,
  MessageDeliveryStatus,
  HomeworkThreadMessage,
  HomeworkTaskState,
  HomeworkThread,
  RequestHintResponse,
  StudentHomeworkAssignmentDetails,
  TaskStateStatus,
} from '@/types/homework';
import { getSubjectLabel } from '@/types/homework';
import { useStudentThread } from '@/hooks/useStudentHomework';
import {
  checkAnswer,
  getStudentTaskImageSignedUrl,
  getStudentTaskImageSignedUrlViaBackend,
  requestHint,
  saveThreadMessage,
} from '@/lib/studentHomeworkApi';
import { streamChat, StreamChatError } from '@/lib/streamChat';
import { trackGuidedHomeworkEvent } from '@/lib/homeworkTelemetry';

const MAX_CONTEXT_MESSAGES = 15;
type SendMode = Extract<GuidedMessageKind, 'answer' | 'hint_request' | 'question'>;

interface GuidedHomeworkWorkspaceProps {
  assignment: StudentHomeworkAssignmentDetails;
}

const UI_STATUS_META: Record<GuidedHomeworkUiStatus, { label: string; badgeClass: string }> = {
  awaiting_answer: {
    label: 'Ждём ответ',
    badgeClass: 'bg-slate-100 text-slate-800 border-slate-200 dark:bg-slate-900/40 dark:text-slate-200',
  },
  streaming_ai: {
    label: 'ИИ думает',
    badgeClass: 'bg-indigo-100 text-indigo-800 border-indigo-200 dark:bg-indigo-900/40 dark:text-indigo-300',
  },
  checking_answer: {
    label: 'Проверяем ответ',
    badgeClass: 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/40 dark:text-blue-300',
  },
  requesting_hint: {
    label: 'Генерируем подсказку',
    badgeClass: 'bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-900/40 dark:text-violet-300',
  },
  send_error: {
    label: 'Ошибка отправки',
    badgeClass: 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/40 dark:text-red-300',
  },
};

function buildTaskContext(
  assignment: StudentHomeworkAssignmentDetails,
  currentTask: { order_num: number; task_text: string; task_image_url: string | null },
  totalTasks: number,
  sendMode: SendMode,
): string {
  const modeHint =
    sendMode === 'hint_request'
      ? 'Режим: подсказка. Дай короткую подсказку без полного решения и без финального ответа.'
      : sendMode === 'question'
        ? 'Режим: промежуточный шаг решения. Ученик показывает свой ход мыслей или шаг решения. Обсуди его, укажи ошибки если есть, помоги продвинуться дальше. Не раскрывай полностью решение и финальный ответ.'
        : 'Режим: проверка ответа ученика. Если ответ вероятно неверный, дай шаг для исправления. Если вероятно верный — похвали и предложи перейти к следующей задаче.';

  const isMinimalText = currentTask.task_text.trim().length <= 15;
  const hasImage = Boolean(currentTask.task_image_url);

  const parts = [
    `Задание: "${assignment.title}" по предмету ${getSubjectLabel(assignment.subject)}.`,
    assignment.topic ? `Тема: ${assignment.topic}.` : null,
    `Задача ${currentTask.order_num} из ${totalTasks}.`,
    `Условие: ${currentTask.task_text}`,
    hasImage && isMinimalText
      ? 'ВАЖНО: Условие задачи полностью содержится на прикреплённом изображении. Внимательно прочитай текст и данные на изображении. НЕ придумывай условие — используй ТОЛЬКО то, что написано и нарисовано на картинке.'
      : hasImage
        ? 'К задаче прикреплено изображение с условием — оно передано отдельно.'
        : null,
    modeHint,
    'Пиши кратко, понятно, с фокусом на текущую задачу. LaTeX: $..$ или $$..$$ при необходимости.',
  ];

  return parts.filter(Boolean).join('\n');
}

function MaterialLink({
  title,
  url,
  storageRef,
}: {
  title: string;
  url: string | null;
  storageRef: string | null;
}) {
  const isExternal = Boolean(url && /^https?:\/\//i.test(url));
  const signedUrlQuery = useQuery<string | null>({
    queryKey: ['student', 'homework', 'guided-material-url', storageRef],
    queryFn: () => getStudentTaskImageSignedUrl(storageRef!),
    enabled: Boolean(storageRef) && !isExternal,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: 1,
  });

  const resolvedUrl = isExternal
    ? url
    : (url ?? signedUrlQuery.data ?? null);

  if (!resolvedUrl) {
    return <span className="text-xs text-muted-foreground">{title}</span>;
  }

  return (
    <a
      href={resolvedUrl}
      target="_blank"
      rel="noreferrer"
      className="text-xs underline underline-offset-2 hover:text-primary"
    >
      {title}
    </a>
  );
}

function TaskConditionImage({
  assignmentId,
  taskId,
  taskOrder,
  taskImageUrl,
}: {
  assignmentId: string;
  taskId: string;
  taskOrder: number;
  taskImageUrl: string | null;
}) {
  const [open, setOpen] = useState(false);
  const isExternal = Boolean(taskImageUrl && /^https?:\/\//i.test(taskImageUrl));

  const imageQuery = useQuery<string | null>({
    queryKey: ['student', 'homework', 'guided-task-image', assignmentId, taskId],
    queryFn: () => getStudentTaskImageSignedUrlViaBackend(assignmentId, taskId),
    enabled: Boolean(taskImageUrl) && !isExternal,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: 1,
  });

  if (!taskImageUrl) return null;

  const resolvedUrl = isExternal
    ? taskImageUrl
    : (imageQuery.data ?? null);

  if (imageQuery.isLoading) {
    return <p className="text-xs text-muted-foreground">Загрузка фото условия...</p>;
  }

  if (!resolvedUrl) {
    return <p className="text-xs text-muted-foreground">Фото условия недоступно</p>;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group relative inline-flex max-w-[320px] rounded-lg border bg-background p-1 text-left"
      >
        <img
          src={resolvedUrl}
          alt={`Условие задачи ${taskOrder}`}
          className="max-h-44 w-full rounded-md object-contain"
          loading="lazy"
        />
        <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md bg-background/90 px-2 py-1 text-[11px] opacity-0 transition-opacity group-hover:opacity-100">
          <ZoomIn className="h-3 w-3" />
          Увеличить
        </span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl p-4">
          <DialogHeader>
            <DialogTitle>Задача {taskOrder}</DialogTitle>
            <DialogDescription>Изображение условия</DialogDescription>
          </DialogHeader>
          <img
            src={resolvedUrl}
            alt={`Условие задачи ${taskOrder}`}
            className="max-h-[75vh] w-full rounded-md object-contain"
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

function toDeliveryStatus(value?: MessageDeliveryStatus): MessageDeliveryStatus {
  if (value === 'sending' || value === 'failed') return value;
  return 'sent';
}

export default function GuidedHomeworkWorkspace({ assignment }: GuidedHomeworkWorkspaceProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HomeworkThreadMessage[]>([]);
  const bootstrapStartedRef = useRef<Set<string>>(new Set());

  const {
    data: thread,
    isLoading: isThreadLoading,
    error: threadError,
  } = useStudentThread(assignment.id);

  // Local state
  const [messages, setMessages] = useState<HomeworkThreadMessage[]>([]);
  const [taskStates, setTaskStates] = useState<HomeworkTaskState[]>([]);
  const [currentTaskOrder, setCurrentTaskOrder] = useState(1);
  const [threadCurrentTaskOrder, setThreadCurrentTaskOrder] = useState(1);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [isCheckingAnswer, setIsCheckingAnswer] = useState(false);
  const [isRequestingHint, setIsRequestingHint] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [threadStatus, setThreadStatus] = useState<'active' | 'completed' | 'abandoned'>('active');

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Initialize from thread data
  useEffect(() => {
    if (thread) {
      const normalizedMessages = (thread.homework_tutor_thread_messages ?? []).map((msg) => ({
        ...msg,
        message_delivery_status: toDeliveryStatus(msg.message_delivery_status),
      }));
      setMessages(normalizedMessages);
      setTaskStates(thread.homework_tutor_task_states ?? []);
      setCurrentTaskOrder(thread.current_task_order);
      setThreadCurrentTaskOrder(thread.current_task_order);
      setThreadId(thread.id);
      setThreadStatus(thread.status);
    }
  }, [thread]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, currentTaskOrder, streamingContent]);

  // Build task stepper items
  const taskStepItems: TaskStepItem[] = useMemo(() => {
    const stateByTaskId = new Map(taskStates.map((ts) => [ts.task_id, ts]));
    return assignment.tasks.map((task) => {
      const state = stateByTaskId.get(task.id);
      return {
        order_num: task.order_num,
        task_text: task.task_text,
        status: (state?.status ?? 'locked') as TaskStateStatus,
        earned_score: state?.earned_score,
        max_score: task.max_score,
      };
    });
  }, [assignment.tasks, taskStates]);

  const activeTaskOrder = useMemo(() => {
    for (const task of assignment.tasks) {
      const taskState = taskStates.find((state) => state.task_id === task.id);
      if (taskState?.status === 'active') {
        return task.order_num;
      }
    }
    return threadCurrentTaskOrder;
  }, [assignment.tasks, taskStates, threadCurrentTaskOrder]);

  const syncThreadFromResponse = useCallback((updatedThread: HomeworkThread) => {
    const normalizedMessages = (updatedThread.homework_tutor_thread_messages ?? []).map((msg) => ({
      ...msg,
      message_delivery_status: toDeliveryStatus(msg.message_delivery_status),
    }));
    setMessages(normalizedMessages);
    setTaskStates(updatedThread.homework_tutor_task_states ?? []);
    setCurrentTaskOrder(updatedThread.current_task_order);
    setThreadCurrentTaskOrder(updatedThread.current_task_order);
    setThreadStatus(updatedThread.status);
  }, []);

  const currentTask = useMemo(
    () => assignment.tasks.find((t) => t.order_num === currentTaskOrder),
    [assignment.tasks, currentTaskOrder],
  );

  const currentActiveTaskState = useMemo(() => {
    const activeTask = assignment.tasks.find((t) => t.order_num === activeTaskOrder);
    if (!activeTask) return null;
    return taskStates.find((ts) => ts.task_id === activeTask.id) ?? null;
  }, [assignment.tasks, activeTaskOrder, taskStates]);

  const visibleMessages = useMemo(
    () => messages.filter((message) => message.task_order === currentTaskOrder),
    [messages, currentTaskOrder],
  );

  const isViewingActiveTask = currentTaskOrder === activeTaskOrder;
  const hasAiReplyForCurrentTask = visibleMessages.some(
    (message) => message.role === 'assistant' && message.message_delivery_status !== 'failed' && message.message_kind !== 'system',
  );
  const hasSendErrorForCurrentTask = visibleMessages.some(
    (message) => message.message_delivery_status === 'failed',
  );
  const uiStatus: GuidedHomeworkUiStatus = isCheckingAnswer
      ? 'checking_answer'
      : isRequestingHint
        ? 'requesting_hint'
        : isStreaming
          ? 'streaming_ai'
          : hasSendErrorForCurrentTask
            ? 'send_error'
            : 'awaiting_answer';

  const visitedTaskOrders = useMemo(() => {
    const result = new Set<number>([activeTaskOrder]);

    for (const task of taskStepItems) {
      if (task.status !== 'locked') result.add(task.order_num);
    }
    for (const message of messages) {
      if (typeof message.task_order === 'number') result.add(message.task_order);
    }
    return result;
  }, [activeTaskOrder, messages, taskStepItems]);

  const previousTaskOrder = useMemo(() => {
    for (let candidate = currentTaskOrder - 1; candidate >= 1; candidate -= 1) {
      if (visitedTaskOrders.has(candidate)) return candidate;
    }
    return null;
  }, [currentTaskOrder, visitedTaskOrders]);

  const nextTaskOrder = currentTaskOrder + 1 <= assignment.tasks.length
    ? currentTaskOrder + 1
    : null;
  const nextTaskVisited = nextTaskOrder !== null ? visitedTaskOrders.has(nextTaskOrder) : false;
  const canGoNext = nextTaskOrder !== null && nextTaskVisited;

  const controlsDisabled = threadStatus !== 'active' || isStreaming || isCheckingAnswer || isRequestingHint;

  const patchMessage = useCallback((messageId: string, patch: Partial<HomeworkThreadMessage>) => {
    setMessages((prev) => prev.map((message) => (
      message.id === messageId
        ? { ...message, ...patch }
        : message
    )));
  }, []);

  const persistMessage = useCallback(async (
    tempId: string,
    role: 'user' | 'assistant',
    content: string,
    taskOrder: number,
    messageKind: GuidedMessageKind,
  ) => {
    if (!threadId) {
      throw new Error('Чат еще не инициализирован');
    }

    const saved = await saveThreadMessage(threadId, role, content, taskOrder, messageKind);
    patchMessage(tempId, {
      id: saved.id,
      message_delivery_status: 'sent',
      message_kind: messageKind,
    });
  }, [patchMessage, threadId]);

  const buildContextMessages = useCallback((taskOrder: number, draftUserContent?: string) => {
    const baseMessages = messagesRef.current
      .filter((message) => message.task_order === taskOrder)
      .filter((message) => message.role !== 'system')
      .filter((message) => message.message_delivery_status !== 'failed')
      .map((message) => ({
        role: message.role === 'system' || message.role === 'tutor' ? 'assistant' : message.role,
        content: message.content,
      }));

    if (draftUserContent && draftUserContent.trim().length > 0) {
      baseMessages.push({ role: 'user', content: draftUserContent.trim() });
    }

    return baseMessages.slice(-MAX_CONTEXT_MESSAGES);
  }, []);

  const requestAssistantReply = useCallback(async (
    taskOrder: number,
    sendMode: SendMode,
    contextMessages: Array<{ role: string; content: string }>,
  ) => {
    const task = assignment.tasks.find((assignmentTask) => assignmentTask.order_num === taskOrder);
    if (!task) return;

    setIsStreaming(true);
    setStreamingContent('');

    // Resolve task image to signed URL for AI (if task has image)
    let resolvedTaskImageUrl: string | undefined;
    if (task.task_image_url) {
      const signedUrl = await getStudentTaskImageSignedUrlViaBackend(
        assignment.id, task.id,
      );
      if (signedUrl) resolvedTaskImageUrl = signedUrl;
    }

    let fullContent = '';
    let streamErrorHandled = false;

    try {
      await streamChat({
        messages: contextMessages,
        taskContext: buildTaskContext(assignment, task, assignment.tasks.length, sendMode),
        taskImageUrl: resolvedTaskImageUrl,
        onDelta: (delta) => {
          fullContent += delta;
          setStreamingContent(fullContent);
        },
        onDone: () => undefined,
        onError: (error) => {
          streamErrorHandled = true;
          if (error instanceof StreamChatError) {
            if (error.code === 'LIMIT_REACHED') {
              toast.error('Достигнут дневной лимит сообщений');
            } else if (error.code === 'PAYMENT_REQUIRED') {
              toast.error('Требуется пополнение баланса');
            } else {
              toast.error(error.message);
            }
          } else {
            toast.error('Ошибка при получении ответа ИИ. Попробуйте снова.');
          }
        },
      });

      const assistantText = fullContent.trim() || 'Принято. Продолжаем разбор задачи.';
      const assistantTempId = `temp-assistant-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

      setMessages((prev) => [
        ...prev,
        {
          id: assistantTempId,
          role: 'assistant',
          content: assistantText,
          image_url: null,
          task_order: taskOrder,
          created_at: new Date().toISOString(),
          message_kind: 'ai_reply',
          message_delivery_status: 'sending',
        },
      ]);

      try {
        await persistMessage(assistantTempId, 'assistant', assistantText, taskOrder, 'ai_reply');
      } catch (error) {
        patchMessage(assistantTempId, { message_delivery_status: 'failed' });
        toast.error('Ответ ИИ получен, но не сохранен. Нажмите "Повторить".');
        trackGuidedHomeworkEvent('guided_assistant_save_failed', {
          assignmentId: assignment.id,
          taskOrder,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } catch (error) {
      if (!streamErrorHandled) {
        toast.error(error instanceof Error ? error.message : 'Ошибка при получении ответа ИИ.');
      }
      trackGuidedHomeworkEvent('guided_stream_failed', {
        assignmentId: assignment.id,
        taskOrder,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsStreaming(false);
      setStreamingContent('');
    }
  }, [assignment, patchMessage, persistMessage]);

  const handleCheckAnswer = useCallback(async (answerText: string) => {
    if (!threadId || !currentTask) return;
    const taskOrder = currentTask.order_num;

    // Show optimistic user message
    const tempUserId = `temp-user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setMessages((prev) => [
      ...prev,
      {
        id: tempUserId,
        role: 'user',
        content: answerText,
        image_url: null,
        task_order: taskOrder,
        created_at: new Date().toISOString(),
        message_kind: 'answer',
        message_delivery_status: 'sending',
      },
    ]);

    setIsCheckingAnswer(true);
    trackGuidedHomeworkEvent('guided_send_click', { assignmentId: assignment.id, taskOrder, sendMode: 'answer' });

    try {
      const response: CheckAnswerResponse = await checkAnswer(threadId, answerText);

      // Sync full thread from response (includes saved messages)
      syncThreadFromResponse(response.thread);

      if (response.verdict === 'CORRECT') {
        trackGuidedHomeworkEvent('guided_answer_correct', {
          assignmentId: assignment.id,
          taskOrder,
          earnedScore: response.earned_score ?? 0,
          maxScore: response.max_score,
        });
        if (response.thread_completed) {
          toast.success('Все задачи завершены!');
          trackGuidedHomeworkEvent('guided_all_completed', { assignmentId: assignment.id });
        } else {
          toast.success('Правильно! Переходим к следующей задаче.');
        }
      } else if (response.verdict === 'ON_TRACK') {
        // Correct step but not the final answer — no toast, AI feedback guides the student
        trackGuidedHomeworkEvent('guided_answer_on_track', {
          assignmentId: assignment.id,
          taskOrder,
          availableScore: response.available_score,
          maxScore: response.max_score,
        });
      } else {
        trackGuidedHomeworkEvent('guided_answer_incorrect', {
          assignmentId: assignment.id,
          taskOrder,
          wrongAnswerCount: response.wrong_answer_count,
          availableScore: response.available_score,
          maxScore: response.max_score,
        });
        if (response.available_score < response.max_score) {
          trackGuidedHomeworkEvent('guided_score_degraded', {
            assignmentId: assignment.id,
            taskOrder,
            availableScore: response.available_score,
            maxScore: response.max_score,
          });
        }
      }

      await queryClient.invalidateQueries({
        queryKey: ['student', 'homework', 'thread', assignment.id],
      });
    } catch (error) {
      // Server may have processed the request despite network error.
      // Refetch thread to get authoritative state instead of allowing retry
      // (which would double-penalize the student).
      setMessages((prev) => prev.filter((m) => m.id !== tempUserId));
      toast.error('Ошибка связи при проверке. Обновляем данные...');
      trackGuidedHomeworkEvent('guided_check_failed', {
        assignmentId: assignment.id,
        taskOrder,
        error: error instanceof Error ? error.message : String(error),
      });
      await queryClient.invalidateQueries({
        queryKey: ['student', 'homework', 'thread', assignment.id],
      });
    } finally {
      setIsCheckingAnswer(false);
    }
  }, [assignment.id, currentTask, queryClient, syncThreadFromResponse, threadId]);

  const sendUserMessage = useCallback(async (
    rawText: string,
    sendMode: SendMode,
  ) => {
    if (!threadId || !currentTask) return;
    if (!isViewingActiveTask) {
      toast.info('Отправка доступна только по текущей активной задаче.');
      return;
    }
    if (controlsDisabled) return;

    const content = rawText.trim();
    if (!content) return;

    // Answer mode uses server-side AI check
    if (sendMode === 'answer') {
      await handleCheckAnswer(content);
      return;
    }

    // Question and hint_request modes use streaming
    const taskOrder = currentTask.order_num;
    const tempUserId = `temp-user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const userMessage: HomeworkThreadMessage = {
      id: tempUserId,
      role: 'user',
      content,
      image_url: null,
      task_order: taskOrder,
      created_at: new Date().toISOString(),
      message_kind: sendMode,
      message_delivery_status: 'sending',
    };

    setMessages((prev) => [...prev, userMessage]);
    const contextMessages = buildContextMessages(taskOrder, content);
    trackGuidedHomeworkEvent('guided_send_click', { assignmentId: assignment.id, taskOrder, sendMode });

    try {
      await persistMessage(tempUserId, 'user', content, taskOrder, sendMode);
    } catch (error) {
      patchMessage(tempUserId, { message_delivery_status: 'failed' });
      toast.error('Не удалось отправить сообщение. Нажмите "Повторить".');
      trackGuidedHomeworkEvent('guided_send_failed', {
        assignmentId: assignment.id,
        taskOrder,
        sendMode,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    await requestAssistantReply(taskOrder, sendMode, contextMessages);
  }, [
    assignment.id,
    buildContextMessages,
    controlsDisabled,
    currentTask,
    handleCheckAnswer,
    isViewingActiveTask,
    patchMessage,
    persistMessage,
    requestAssistantReply,
    threadId,
  ]);

  const handleSendAnswer = useCallback((text: string) => {
    void sendUserMessage(text, 'answer');
  }, [sendUserMessage]);

  const handleSendStep = useCallback((text: string) => {
    void sendUserMessage(text, 'question');
  }, [sendUserMessage]);

  const handleHint = useCallback(async () => {
    if (!threadId || controlsDisabled || !isViewingActiveTask) return;

    trackGuidedHomeworkEvent('guided_hint', {
      assignmentId: assignment.id,
      taskOrder: currentTaskOrder,
    });

    setIsRequestingHint(true);
    try {
      const response: RequestHintResponse = await requestHint(threadId);

      // Sync full thread from response (includes saved messages)
      syncThreadFromResponse(response.thread);

      if (response.available_score < response.max_score) {
        trackGuidedHomeworkEvent('guided_score_degraded', {
          assignmentId: assignment.id,
          taskOrder: currentTaskOrder,
          availableScore: response.available_score,
          maxScore: response.max_score,
        });
      }

      await queryClient.invalidateQueries({
        queryKey: ['student', 'homework', 'thread', assignment.id],
      });
    } catch (error) {
      // Server may have processed the hint despite network error.
      // Refetch thread to get authoritative state instead of allowing retry.
      toast.error('Ошибка связи при запросе подсказки. Обновляем данные...');
      trackGuidedHomeworkEvent('guided_hint_failed', {
        assignmentId: assignment.id,
        taskOrder: currentTaskOrder,
        error: error instanceof Error ? error.message : String(error),
      });
      await queryClient.invalidateQueries({
        queryKey: ['student', 'homework', 'thread', assignment.id],
      });
    } finally {
      setIsRequestingHint(false);
    }
  }, [assignment.id, controlsDisabled, currentTaskOrder, isViewingActiveTask, queryClient, syncThreadFromResponse, threadId]);

  const handleRetryMessage = useCallback((messageId: string) => {
    const message = messagesRef.current.find((item) => item.id === messageId);
    if (!message || message.message_delivery_status !== 'failed') return;

    trackGuidedHomeworkEvent('guided_retry_click', {
      assignmentId: assignment.id,
      taskOrder: message.task_order,
      role: message.role,
      messageKind: message.message_kind,
    });

    if (message.role === 'user') {
      setMessages((prev) => prev.filter((item) => item.id !== messageId));
      // For question mode: safe to retry (idempotent streaming)
      if (message.message_kind === 'question') {
        void sendUserMessage(message.content, 'question');
      } else {
        // For answer/hint: re-invoke the endpoint (user explicitly chose to retry)
        if (message.message_kind === 'answer') {
          void handleCheckAnswer(message.content);
        } else if (message.message_kind === 'hint_request') {
          void handleHint();
        }
      }
      return;
    }

    if (!threadId) return;
    patchMessage(messageId, { message_delivery_status: 'sending' });

    saveThreadMessage(
      threadId,
      'assistant',
      message.content,
      message.task_order ?? activeTaskOrder,
      message.message_kind ?? 'ai_reply',
    )
      .then((saved) => {
        patchMessage(messageId, { id: saved.id, message_delivery_status: 'sent' });
        toast.success('Сообщение успешно отправлено.');
        trackGuidedHomeworkEvent('guided_retry_success', {
          assignmentId: assignment.id,
          taskOrder: message.task_order,
          role: message.role,
        });
      })
      .catch((error) => {
        patchMessage(messageId, { message_delivery_status: 'failed' });
        toast.error(error instanceof Error ? error.message : 'Не удалось повторить отправку.');
        trackGuidedHomeworkEvent('guided_retry_failed', {
          assignmentId: assignment.id,
          taskOrder: message.task_order,
          role: message.role,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }, [activeTaskOrder, assignment.id, handleCheckAnswer, handleHint, patchMessage, sendUserMessage, threadId]);

  const handleTaskClick = useCallback((orderNum: number) => {
    if (!visitedTaskOrders.has(orderNum)) return;
    setCurrentTaskOrder(orderNum);
  }, [visitedTaskOrders]);

  const handleGoPrev = useCallback(() => {
    if (previousTaskOrder === null) return;
    trackGuidedHomeworkEvent('guided_prev', {
      assignmentId: assignment.id,
      fromTaskOrder: currentTaskOrder,
      toTaskOrder: previousTaskOrder,
    });
    setCurrentTaskOrder(previousTaskOrder);
  }, [assignment.id, currentTaskOrder, previousTaskOrder]);

  const handleGoNext = useCallback(() => {
    if (!nextTaskOrder || !nextTaskVisited) return;

    trackGuidedHomeworkEvent('guided_next', {
      assignmentId: assignment.id,
      fromTaskOrder: currentTaskOrder,
      toTaskOrder: nextTaskOrder,
    });

    setCurrentTaskOrder(nextTaskOrder);
  }, [assignment.id, currentTaskOrder, nextTaskOrder, nextTaskVisited]);

  useEffect(() => {
    if (!threadId || !currentTask) return;
    if (threadStatus !== 'active') return;
    if (currentTask.order_num !== 1) return;
    if (isStreaming || isCheckingAnswer || isRequestingHint) return;

    const key = `${threadId}:task-1`;
    if (bootstrapStartedRef.current.has(key)) return;

    const hasAnyTaskMessages = messages.some((message) => message.task_order === 1);
    if (hasAnyTaskMessages) {
      bootstrapStartedRef.current.add(key);
      return;
    }

    bootstrapStartedRef.current.add(key);

    const runBootstrap = async () => {
      setIsStreaming(true);
      setStreamingContent('');

      // Resolve task image to signed URL for AI (if task has image)
      let bootstrapImageUrl: string | undefined;
      if (currentTask.task_image_url) {
        const signedUrl = await getStudentTaskImageSignedUrlViaBackend(
          assignment.id, currentTask.id,
        );
        if (signedUrl) bootstrapImageUrl = signedUrl;
      }

      let content = '';
      try {
        await streamChat({
          messages: [
            {
              role: 'user',
              content: 'Сформулируй короткое стартовое сообщение для ученика по этой задаче.',
            },
          ],
          taskContext: buildTaskContext(assignment, currentTask, assignment.tasks.length, 'answer'),
          taskImageUrl: bootstrapImageUrl,
          onDelta: (delta) => {
            content += delta;
            setStreamingContent(content);
          },
          onDone: () => undefined,
        });
      } catch {
        // ignore bootstrap stream errors
      } finally {
        setIsStreaming(false);
        setStreamingContent('');
      }

      const introText = content.trim() || 'Начинаем с первой задачи. Напиши решение, и я сразу помогу проверить его.';

      // Persist intro to DB so it's not regenerated on every page load
      try {
        await saveThreadMessage(threadId!, 'assistant', introText, 1, 'system');
        // Refetch thread to get the persisted message with a real DB id
        void queryClient.invalidateQueries({ queryKey: ['student', 'homework', 'thread', assignment.id] });
      } catch (e) {
        console.warn('Failed to persist bootstrap intro:', e);
      }

      const introId = `local-bootstrap-${threadId}`;
      setMessages((prev) => (
        prev.some((message) => message.id === introId)
          ? prev
          : [
            ...prev,
            {
              id: introId,
              role: 'assistant',
              content: introText,
              image_url: null,
              task_order: 1,
              created_at: new Date().toISOString(),
              message_kind: 'system',
              message_delivery_status: 'sent',
            },
          ]
      ));
      trackGuidedHomeworkEvent('guided_first_run_intro', { assignmentId: assignment.id });
    };

    void runBootstrap();
  }, [assignment, currentTask, isCheckingAnswer, isRequestingHint, isStreaming, messages, threadId, threadStatus]);

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
            <p className="text-destructive">Не удалось загрузить домашнее задание</p>
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
            <p className="text-muted-foreground">Домашнее задание пока недоступно</p>
            <p className="text-sm text-muted-foreground">
              Попросите репетитора повторно назначить вам это задание
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
    const totalEarned = taskStates.reduce((sum, s) => sum + (s.earned_score ?? 0), 0);
    const totalMax = assignment.tasks.reduce((sum, t) => sum + t.max_score, 0);
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
              <p className="text-xs text-muted-foreground">{getSubjectLabel(assignment.subject)}</p>
            </div>
          </div>
        </div>

        <div className="flex-1 flex items-center justify-center p-4">
          <Card className="max-w-md w-full">
            <CardHeader className="text-center">
              <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-2" />
              <CardTitle>Все задачи домашки сданы</CardTitle>
            </CardHeader>
            <CardContent className="text-center space-y-4">
              <p className="text-muted-foreground">
                Вы решили {completedCount} из {assignment.tasks.length} задач
              </p>
              {totalMax > 0 && (
                <p className="text-sm font-medium">
                  Итого: {totalEarned} / {totalMax} баллов
                </p>
              )}
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
      <div className="border-b px-4 py-3 shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/homework')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-semibold truncate">{assignment.title}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <p className="text-xs text-muted-foreground">{getSubjectLabel(assignment.subject)}</p>
              <Badge className={`border text-xs ${UI_STATUS_META[uiStatus].badgeClass}`}>
                {UI_STATUS_META[uiStatus].label}
              </Badge>
              {!isViewingActiveTask && (
                <Badge variant="secondary" className="text-xs">
                  Просмотр задачи {currentTaskOrder}
                </Badge>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="border-b px-4 py-1 shrink-0 bg-muted/30">
        <TaskStepper
          tasks={taskStepItems}
          currentTaskOrder={currentTaskOrder}
          onTaskClick={handleTaskClick}
        />
      </div>

      {currentTask && (
        <div className="border-b px-4 py-3 shrink-0 bg-slate-50/70 dark:bg-slate-900/30">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs text-muted-foreground">
              Задача {currentTask.order_num} из {assignment.tasks.length}
            </p>
            {isViewingActiveTask && currentActiveTaskState?.available_score != null && (
              <span className={`text-xs font-medium ${
                (currentActiveTaskState.available_score ?? 0) >= currentTask.max_score
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-amber-600 dark:text-amber-400'
              }`}>
                {currentActiveTaskState.available_score} / {currentTask.max_score} баллов
              </span>
            )}
          </div>
          <p className="text-sm font-medium whitespace-pre-wrap">{currentTask.task_text}</p>

          <div className="mt-2">
            <TaskConditionImage
              assignmentId={assignment.id}
              taskId={currentTask.id}
              taskOrder={currentTask.order_num}
              taskImageUrl={currentTask.task_image_url}
            />
          </div>

          {assignment.materials.length > 0 && (
            <div className="mt-3 rounded-md border bg-background/70 px-3 py-2">
              <p className="text-xs font-medium mb-1">Материалы</p>
              <div className="flex flex-wrap gap-3">
                {assignment.materials.map((material) => (
                  <MaterialLink
                    key={material.id}
                    title={material.title}
                    url={material.url}
                    storageRef={material.storage_ref}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-4 min-h-0">
        {visibleMessages.length === 0 && !isStreaming && (
          <div className="text-center text-sm text-muted-foreground py-8 space-y-1">
            <p>Отправьте ответ по задаче или запросите подсказку.</p>
            <p className="text-xs">ИИ работает в контексте только текущей задачи.</p>
          </div>
        )}

        {visibleMessages.map((msg) => (
          <GuidedChatMessage
            key={msg.id}
            message={msg}
            onRetry={handleRetryMessage}
          />
        ))}

        {isStreaming && streamingContent && (
          <GuidedChatMessage
            message={{
              role: 'assistant',
              content: streamingContent,
            }}
            isStreaming
          />
        )}

        {((isStreaming && !streamingContent) || isCheckingAnswer || isRequestingHint) && (
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

      <div className="shrink-0 border-t bg-background">
        <div className="px-4 pt-3 pb-2 space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleGoPrev}
              disabled={controlsDisabled || previousTaskOrder === null}
              className="justify-start gap-1"
            >
              <ChevronLeft className="h-4 w-4" />
              Предыдущая
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={handleGoNext}
              disabled={controlsDisabled || !canGoNext}
              className="justify-start gap-1"
            >
              <ChevronRight className="h-4 w-4" />
              Следующая
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleHint()}
              disabled={controlsDisabled || !isViewingActiveTask}
              className="justify-start gap-1"
            >
              <Lightbulb className="h-4 w-4" />
              Подсказка
            </Button>
          </div>

          {uiStatus === 'send_error' && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5" />
              <span>Есть неотправленные сообщения. Нажмите "Повторить" прямо на сообщении.</span>
            </div>
          )}

          {!isViewingActiveTask && (
            <div className="rounded-md border border-amber-300/60 bg-amber-50/70 px-3 py-2 text-xs text-amber-900 dark:bg-amber-900/20 dark:text-amber-300">
              Вы просматриваете задачу {currentTaskOrder}. Для отправки ответа вернитесь к активной задаче {activeTaskOrder}.
            </div>
          )}

        </div>

        <GuidedChatInput
          onSendAnswer={handleSendAnswer}
          onSendStep={handleSendStep}
          isLoading={isStreaming || isCheckingAnswer || isRequestingHint}
          disabled={threadStatus !== 'active' || !isViewingActiveTask}
          placeholder={
            currentTask
              ? `Задача ${currentTask.order_num}: ответ или шаг решения...`
              : 'Введите ответ или шаг решения...'
          }
        />
      </div>
    </div>
  );
}
