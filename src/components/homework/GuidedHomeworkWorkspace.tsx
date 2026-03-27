/**
 * Main workspace component for guided homework chat.
 * Students solve tasks one by one in an interactive chat with AI.
 */

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Lightbulb,
  Loader2,
  ZoomIn,
} from 'lucide-react';
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

const MathText = lazy(() => import('@/components/kb/ui/MathText').then((m) => ({ default: m.MathText })));
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
  uploadStudentThreadImage,
} from '@/lib/studentHomeworkApi';
import {
  buildGuidedAttachmentPlaceholder,
  getImageThreadAttachmentRefs,
  MAX_GUIDED_CHAT_ATTACHMENTS,
  parseThreadAttachmentRefs,
  serializeThreadAttachmentRefs,
} from '@/lib/homeworkThreadAttachments';
import { streamChat, StreamChatError } from '@/lib/streamChat';
import { trackGuidedHomeworkEvent } from '@/lib/homeworkTelemetry';

const MAX_CONTEXT_MESSAGES = 15;
type SendMode = Extract<GuidedMessageKind, 'answer' | 'hint_request' | 'question'> | 'bootstrap';

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
  options?: { hasStudentImage?: boolean },
): string {
  const modeHint =
    sendMode === 'bootstrap'
      ? 'Режим: стартовое сообщение. Ученик ТОЛЬКО ОТКРЫЛ задачу. Никакого решения ещё нет. Сформулируй короткий стартовый заход: помоги разобрать условие.'
      : sendMode === 'hint_request'
        ? 'Режим: подсказка. Дай короткую подсказку без полного решения и без финального ответа.'
        : sendMode === 'question'
          ? 'Режим: промежуточный шаг решения. Ученик показывает свой ход мыслей или шаг решения. Обсуди его, укажи ошибки если есть, помоги продвинуться дальше. Не раскрывай полностью решение и финальный ответ.'
          : 'Режим: проверка ответа ученика. Если ответ вероятно неверный, дай шаг для исправления. Если вероятно верный — похвали и предложи перейти к следующей задаче.';
  const studentImageHint = options?.hasStudentImage
    ? sendMode === 'question'
      ? 'КРИТИЧНО: к сообщению ученика приложено изображение его решения или скриншота. СНАЧАЛА внимательно посмотри именно на изображение ученика. Если на нём нет решения по текущей задаче, прямо скажи это и попроси прислать корректный шаг решения.'
      : 'КРИТИЧНО: к сообщению ученика приложено изображение его решения. Обязательно используй его при анализе. Если изображение не относится к текущей задаче или на нём нет решения, явно сообщи об этом.'
    : null;

  const trimmedText = currentTask.task_text.trim();
  const isPlaceholder = /^\[.*\]$/.test(trimmedText);
  const isMinimalText = trimmedText.length <= 20 || isPlaceholder;
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
    studentImageHint,
    modeHint,
    'Пиши кратко, понятно, с фокусом на текущую задачу. LaTeX: $..$ или $$..$$ при необходимости.',
  ];

  return parts.filter(Boolean).join('\n');
}

function buildGuidedSystemPrompt(
  sendMode: SendMode,
  options?: { hasStudentImage?: boolean; isBootstrap?: boolean },
): string {
  const hasStudentImage = Boolean(options?.hasStudentImage);

  const baseRules = [
    'Ты AI-ассистент внутри guided homework chat для одной текущей задачи.',
    'Это НЕ generic chat. Твоя цель: помочь ученику продвинуться по текущей задаче, не уходя в сторону.',
    'Никогда не игнорируй приложенные изображения.',
    'Порядок приоритета источников: 1) последнее изображение ученика, 2) изображение условия задачи, 3) текст задачи и сообщения.',
    hasStudentImage
      ? 'Если у ученика есть изображение, сначала опиши, что именно на нём видно по текущей задаче. Если изображение нерелевантно, прямо скажи это.'
      : 'Если изображения ученика нет, опирайся на условие задачи и текст сообщения.',
    'Не придумывай детали, которых не видно на изображении.',
    'Не подменяй изображение ученика изображением условия задачи.',
  ];

  if (options?.isBootstrap) {
    return [
      ...baseRules,
      'Сейчас нужен короткий стартовый заход по задаче без полного решения.',
      'Ученик ТОЛЬКО ОТКРЫЛ задачу. Он ещё НИЧЕГО не писал и не загружал. НЕ упоминай «твоё решение», «твой ответ» или «вижу, что ты написал».',
      'Если условие на изображении и ты не можешь его прочитать, напиши нейтральный стартовый заход: предложи ученику описать задачу или задать вопрос.',
      'Сформулируй 1-2 коротких предложения, которые запускают разбор.',
    ].join('\n');
  }

  const modeRules =
    sendMode === 'question'
      ? [
        'Режим: шаг решения.',
        'Отвечай на текущее действие ученика и на его приложенное решение.',
        'Если ученик спрашивает, что видно на его картинке, отвечай именно про картинку ученика.',
        'Не раскрывай полное решение и финальный ответ.',
      ]
      : sendMode === 'hint_request'
        ? [
          'Режим: подсказка.',
          'Дай короткую подсказку по текущему состоянию решения ученика.',
          'Не раскрывай полное решение и финальный ответ.',
        ]
        : [
          'Режим: проверка ответа.',
          'Используй изображение ученика как часть проверки ответа.',
          'Если изображение не содержит решения по текущей задаче, явно сообщи об этом.',
        ];

  return [...baseRules, ...modeRules].join('\n');
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
  const messagesContainerRef = useRef<HTMLDivElement>(null);
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
  const [showCompletedView, setShowCompletedView] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isConditionExpanded, setIsConditionExpanded] = useState(true);

  // Per-task drafts: save/restore text + files when switching tasks
  type TaskDraft = { answer: string; discussion: string; files: File[] };
  const taskDraftsRef = useRef<Map<number, TaskDraft>>(new Map());
  const currentDraftRef = useRef<{ answer: string; discussion: string }>({ answer: '', discussion: '' });
  const attachedFilesRef = useRef<File[]>([]);

  const handleDraftChange = useCallback((answer: string, discussion: string) => {
    currentDraftRef.current = { answer, discussion };
  }, []);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    attachedFilesRef.current = attachedFiles;
  }, [attachedFiles]);

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
      // If user returns to an already-completed thread, show results immediately
      if (thread.status === 'completed') {
        setShowCompletedView(true);
      }
    }
  }, [thread]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (container) {
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
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

  const activeTaskOrder = currentTaskOrder;

  const syncThreadFromResponse = useCallback((updatedThread: HomeworkThread) => {
    const normalizedMessages = (updatedThread.homework_tutor_thread_messages ?? []).map((msg) => ({
      ...msg,
      message_delivery_status: toDeliveryStatus(msg.message_delivery_status),
    }));
    setMessages(normalizedMessages);
    setTaskStates(updatedThread.homework_tutor_task_states ?? []);

    // Save current draft + load target draft (same logic as switchToTask, but
    // reads currentTaskOrder via functional updater to avoid stale closure)
    const newOrder = updatedThread.current_task_order;
    setCurrentTaskOrder((prevOrder) => {
      if (prevOrder !== newOrder) {
        taskDraftsRef.current.set(prevOrder, {
          answer: currentDraftRef.current.answer,
          discussion: currentDraftRef.current.discussion,
          files: [...attachedFilesRef.current],
        });
        const draft = taskDraftsRef.current.get(newOrder);
        setAttachedFiles(draft?.files ?? []);
        currentDraftRef.current = { answer: draft?.answer ?? '', discussion: draft?.discussion ?? '' };
      }
      return newOrder;
    });

    setThreadCurrentTaskOrder(newOrder);
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

  const isViewingActiveTask = currentActiveTaskState?.status === 'active';
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

  const controlsDisabled = threadStatus !== 'active' || isStreaming || isCheckingAnswer || isRequestingHint || isUploading;

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
    attachmentRefs?: string[],
  ) => {
    if (!threadId) {
      throw new Error('Чат еще не инициализирован');
    }

    const saved = await saveThreadMessage(threadId, role, content, taskOrder, messageKind, attachmentRefs);
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

  const resolveLatestStudentImageUrls = useCallback(async (
    taskOrder: number,
    fallbackAttachmentRefs?: string[],
  ): Promise<string[]> => {
    const latestPersistedAttachmentRefs = parseThreadAttachmentRefs(
      [...messagesRef.current]
      .reverse()
      .find((message) => (
        message.task_order === taskOrder &&
        message.role === 'user' &&
        message.message_delivery_status !== 'failed' &&
        typeof message.image_url === 'string' &&
        message.image_url.trim().length > 0
      ))?.image_url,
    );

    const candidateRefs = getImageThreadAttachmentRefs(
      fallbackAttachmentRefs?.length ? fallbackAttachmentRefs : latestPersistedAttachmentRefs,
    );
    if (candidateRefs.length === 0) return [];

    const signedUrls = await Promise.all(candidateRefs.map(async (ref) => {
      const trimmed = ref.trim();
      if (!trimmed) return null;
      if (/^https?:\/\//i.test(trimmed)) {
        return trimmed;
      }
      if (!trimmed.startsWith('storage://')) {
        return null;
      }

      return await getStudentTaskImageSignedUrl(trimmed);
    }));

    return signedUrls.filter((url): url is string => Boolean(url));
  }, []);

  const requestAssistantReply = useCallback(async (
    taskOrder: number,
    sendMode: SendMode,
    contextMessages: Array<{ role: string; content: string }>,
    latestUserAttachmentRefs?: string[],
  ) => {
    const task = assignment.tasks.find((assignmentTask) => assignmentTask.order_num === taskOrder);
    if (!task) return;

    setIsStreaming(true);
    setStreamingContent('');

    const [resolvedTaskImageUrl, resolvedStudentImageUrls] = await Promise.all([
      task.task_image_url
        ? getStudentTaskImageSignedUrlViaBackend(assignment.id, task.id)
        : Promise.resolve(null),
      resolveLatestStudentImageUrls(taskOrder, latestUserAttachmentRefs),
    ]);

    let fullContent = '';
    let streamErrorHandled = false;

    try {
      await streamChat({
        messages: contextMessages,
        systemPrompt: buildGuidedSystemPrompt(sendMode, {
          hasStudentImage: resolvedStudentImageUrls.length > 0,
        }),
        taskContext: buildTaskContext(assignment, task, assignment.tasks.length, sendMode, {
          hasStudentImage: resolvedStudentImageUrls.length > 0,
        }),
        taskImageUrl: resolvedTaskImageUrl ?? undefined,
        studentImageUrls: resolvedStudentImageUrls,
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
  }, [assignment, patchMessage, persistMessage, resolveLatestStudentImageUrls]);

  const handleCheckAnswer = useCallback(async (answerText: string, attachmentRefs?: string[]) => {
    if (!threadId || !currentTask) return;
    const taskOrder = currentTask.order_num;
    const serializedAttachments = serializeThreadAttachmentRefs(attachmentRefs ?? []);

    // Show optimistic user message
    const tempUserId = `temp-user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setMessages((prev) => [
      ...prev,
        {
          id: tempUserId,
          role: 'user',
          content: answerText,
          image_url: serializedAttachments,
          task_order: taskOrder,
          created_at: new Date().toISOString(),
          message_kind: 'answer',
        message_delivery_status: 'sending',
      },
    ]);

    setIsCheckingAnswer(true);
    trackGuidedHomeworkEvent('guided_send_click', { assignmentId: assignment.id, taskOrder, sendMode: 'answer' });

    try {
      const response: CheckAnswerResponse = await checkAnswer(
        threadId,
        answerText,
        currentTask.order_num,
        attachmentRefs,
      );

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
    files?: File[],
  ) => {
    if (!threadId || !currentTask) return;
    if (!isViewingActiveTask) {
      toast.info('Отправка доступна только по текущей активной задаче.');
      return;
    }
    if (controlsDisabled) return;

    const selectedFiles = files ?? [];
    const hasFiles = selectedFiles.length > 0;
    const content = rawText.trim() || (hasFiles ? buildGuidedAttachmentPlaceholder(selectedFiles) : '');
    if (!content && !hasFiles) return;

    // Upload files first (if any)
    let attachmentRefs: string[] = [];
    if (hasFiles) {
      setIsUploading(true);
      try {
        attachmentRefs = await Promise.all(selectedFiles.map((file) => (
          uploadStudentThreadImage(
            file,
            assignment.id,
            threadId,
            currentTask.order_num,
          )
        )));

        if (selectedFiles.some((file) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'))) {
          toast.info('PDF сохранен в чате. ИИ пока учитывает только изображения.');
        }
      } catch (e) {
        toast.error('Ошибка загрузки файла');
        setIsUploading(false);
        return;
      }
      setIsUploading(false);
    }

    // Answer mode uses server-side AI check
    if (sendMode === 'answer') {
      if (hasFiles) setAttachedFiles([]);
      currentDraftRef.current = { answer: '', discussion: '' };
      taskDraftsRef.current.delete(currentTaskOrder);
      await handleCheckAnswer(content, attachmentRefs);
      return;
    }

    // Question and hint_request modes use streaming
    const taskOrder = currentTask.order_num;
    const tempUserId = `temp-user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const userMessage: HomeworkThreadMessage = {
      id: tempUserId,
      role: 'user',
      content,
      image_url: serializeThreadAttachmentRefs(attachmentRefs),
      task_order: taskOrder,
      created_at: new Date().toISOString(),
      message_kind: sendMode,
      message_delivery_status: 'sending',
    };

    setMessages((prev) => [...prev, userMessage]);
    // Clear attached files and draft after adding to messages
    if (hasFiles) setAttachedFiles([]);
    currentDraftRef.current = { answer: '', discussion: '' };
    taskDraftsRef.current.delete(currentTaskOrder);

    const contextMessages = buildContextMessages(taskOrder, content);
    trackGuidedHomeworkEvent('guided_send_click', { assignmentId: assignment.id, taskOrder, sendMode });

    try {
      await persistMessage(tempUserId, 'user', content, taskOrder, sendMode, attachmentRefs);
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

    await requestAssistantReply(taskOrder, sendMode, contextMessages, attachmentRefs);
  }, [
    assignment.id,
    buildContextMessages,
    controlsDisabled,
    currentTask,
    currentTaskOrder,
    handleCheckAnswer,
    isViewingActiveTask,
    patchMessage,
    persistMessage,
    requestAssistantReply,
    threadId,
  ]);

  const handleSendAnswer = useCallback((text: string) => {
    const files = attachedFiles.length > 0 ? [...attachedFiles] : undefined;
    void sendUserMessage(text, 'answer', files);
  }, [attachedFiles, sendUserMessage]);

  const handleSendStep = useCallback((text: string) => {
    const files = attachedFiles.length > 0 ? [...attachedFiles] : undefined;
    void sendUserMessage(text, 'question', files);
  }, [attachedFiles, sendUserMessage]);

  const handleFileSelect = useCallback((file: File) => {
    setAttachedFiles((prev) => (prev.length >= MAX_GUIDED_CHAT_ATTACHMENTS ? prev : [...prev, file]));
  }, []);

  const handleFileRemove = useCallback((index: number) => {
    setAttachedFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  /** Retry a failed user message that already has a storage ref (no re-upload). */
  const retryWithStorageRef = useCallback(async (
    content: string,
    sendMode: SendMode,
    taskOrder: number,
    attachmentValue?: string,
  ) => {
    if (!threadId) return;
    const attachmentRefs = parseThreadAttachmentRefs(attachmentValue);

    const tempUserId = `temp-user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const userMessage: HomeworkThreadMessage = {
      id: tempUserId,
      role: 'user',
      content,
      image_url: serializeThreadAttachmentRefs(attachmentRefs),
      task_order: taskOrder,
      created_at: new Date().toISOString(),
      message_kind: sendMode,
      message_delivery_status: 'sending',
    };

    setMessages((prev) => [...prev, userMessage]);
    const contextMessages = buildContextMessages(taskOrder, content);
    trackGuidedHomeworkEvent('guided_send_click', { assignmentId: assignment.id, taskOrder, sendMode });

    try {
      await persistMessage(tempUserId, 'user', content, taskOrder, sendMode, attachmentRefs);
    } catch (error) {
      patchMessage(tempUserId, { message_delivery_status: 'failed' });
      toast.error('Не удалось отправить сообщение. Нажмите "Повторить".');
      return;
    }

    await requestAssistantReply(taskOrder, sendMode, contextMessages, attachmentRefs);
  }, [assignment.id, buildContextMessages, patchMessage, persistMessage, requestAssistantReply, threadId]);

  const handleHint = useCallback(async () => {
    if (!threadId || controlsDisabled || !isViewingActiveTask) return;

    trackGuidedHomeworkEvent('guided_hint', {
      assignmentId: assignment.id,
      taskOrder: currentTaskOrder,
    });

    setIsRequestingHint(true);
    try {
      const response: RequestHintResponse = await requestHint(threadId, currentTaskOrder);

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
      // Capture storage ref before removing the message from state
      const storedAttachmentValue = message.image_url ?? undefined;
      setMessages((prev) => prev.filter((item) => item.id !== messageId));
      // For question mode: safe to retry (idempotent streaming).
      // File was already uploaded — pass storage ref directly, not File objects.
      if (message.message_kind === 'question') {
        void retryWithStorageRef(message.content, 'question', message.task_order ?? currentTaskOrder, storedAttachmentValue);
      } else {
        // For answer/hint: re-invoke the endpoint (user explicitly chose to retry)
        if (message.message_kind === 'answer') {
          void handleCheckAnswer(message.content, parseThreadAttachmentRefs(storedAttachmentValue));
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
  }, [activeTaskOrder, assignment.id, currentTaskOrder, handleCheckAnswer, handleHint, patchMessage, retryWithStorageRef, threadId]);

  // Save current draft + restore target draft + switch task
  const switchToTask = useCallback((newOrder: number) => {
    taskDraftsRef.current.set(currentTaskOrder, {
      answer: currentDraftRef.current.answer,
      discussion: currentDraftRef.current.discussion,
      files: [...attachedFiles],
    });
    const draft = taskDraftsRef.current.get(newOrder);
    setAttachedFiles(draft?.files ?? []);
    currentDraftRef.current = { answer: draft?.answer ?? '', discussion: draft?.discussion ?? '' };
    setCurrentTaskOrder(newOrder);
  }, [currentTaskOrder, attachedFiles]);

  const handleTaskClick = useCallback((orderNum: number) => {
    if (!visitedTaskOrders.has(orderNum)) return;
    if (isStreaming || isCheckingAnswer || isRequestingHint || isUploading) return;
    switchToTask(orderNum);
  }, [visitedTaskOrders, isStreaming, isCheckingAnswer, isRequestingHint, isUploading, switchToTask]);

  const handleGoPrev = useCallback(() => {
    if (previousTaskOrder === null) return;
    trackGuidedHomeworkEvent('guided_prev', {
      assignmentId: assignment.id,
      fromTaskOrder: currentTaskOrder,
      toTaskOrder: previousTaskOrder,
    });
    switchToTask(previousTaskOrder);
  }, [assignment.id, currentTaskOrder, previousTaskOrder, switchToTask]);

  const handleGoNext = useCallback(() => {
    if (!nextTaskOrder || !nextTaskVisited) return;

    trackGuidedHomeworkEvent('guided_next', {
      assignmentId: assignment.id,
      fromTaskOrder: currentTaskOrder,
      toTaskOrder: nextTaskOrder,
    });

    switchToTask(nextTaskOrder);
  }, [assignment.id, currentTaskOrder, nextTaskOrder, nextTaskVisited, switchToTask]);

  useEffect(() => {
    if (!threadId || !currentTask) return;
    if (isThreadLoading) return;
    if (threadStatus !== 'active') return;
    if (isStreaming || isCheckingAnswer || isRequestingHint) return;

    const taskOrder = currentTask.order_num;
    const key = `${threadId}:task-${taskOrder}`;
    if (bootstrapStartedRef.current.has(key)) return;

    // Exclude backend transition messages (role='system') — they don't count as bootstrap
    const hasAnyTaskMessages = messages.some(
      (message) => message.task_order === taskOrder && message.role !== 'system',
    );
    if (hasAnyTaskMessages) {
      bootstrapStartedRef.current.add(key);
      return;
    }

    // TASK-0B: skip bootstrap if tutor disabled AI intro for this assignment
    if (assignment.disable_ai_bootstrap) {
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
          systemPrompt: buildGuidedSystemPrompt('bootstrap', { isBootstrap: true }),
          taskContext: buildTaskContext(assignment, currentTask, assignment.tasks.length, 'bootstrap'),
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

      const introText = content.trim() || `Начинаем задачу ${taskOrder}. Напиши решение, и я помогу проверить.`;

      // Persist intro to DB so it's not regenerated on every page load
      try {
        await saveThreadMessage(threadId!, 'assistant', introText, taskOrder, 'system');
        // Refetch thread to get the persisted message with a real DB id
        void queryClient.invalidateQueries({ queryKey: ['student', 'homework', 'thread', assignment.id] });
      } catch (e) {
        console.warn('Failed to persist bootstrap intro:', e);
      }

      const introId = `local-bootstrap-${threadId}-task-${taskOrder}`;
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
              task_order: taskOrder,
              created_at: new Date().toISOString(),
              message_kind: 'system',
              message_delivery_status: 'sent',
            },
          ]
      ));
      trackGuidedHomeworkEvent('guided_first_run_intro', { assignmentId: assignment.id, taskOrder });
    };

    void runBootstrap();
  }, [assignment, currentTask, isCheckingAnswer, isRequestingHint, isStreaming, isThreadLoading, messages, threadId, threadStatus]);

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
  if (threadStatus === 'completed' && showCompletedView) {
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
      <div className="border-b px-4 py-1 shrink-0 bg-muted/30">
        <TaskStepper
          tasks={taskStepItems}
          currentTaskOrder={currentTaskOrder}
          onTaskClick={handleTaskClick}
        />
      </div>

      {currentTask && (
        <div className="border-b shrink-0 bg-slate-50/70 dark:bg-slate-900/30">
          {/* Header row — always visible, acts as toggle on mobile */}
          <button
            type="button"
            onClick={() => setIsConditionExpanded(prev => !prev)}
            className="flex w-full items-center justify-between px-4 py-2 text-left"
            style={{ touchAction: 'manipulation' }}
          >
            <div className="flex items-center gap-2">
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
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              {isConditionExpanded ? 'Скрыть' : 'Раскрыть'}
              <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${isConditionExpanded ? 'rotate-180' : ''}`} />
            </span>
          </button>

          {/* Collapsible content — collapsed on mobile by default, always open on desktop */}
          <div className={`overflow-hidden transition-all duration-200 ${isConditionExpanded ? 'max-h-[60vh]' : 'max-h-0'}`}>
            <div className="px-4 pb-3">
              <Suspense fallback={<p className="text-sm font-medium whitespace-pre-wrap">{currentTask.task_text}</p>}>
                <MathText text={currentTask.task_text} className="text-sm font-medium whitespace-pre-wrap" />
              </Suspense>

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
          </div>
        </div>
      )}

      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-4 py-4 min-h-0">
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
        <div className="px-4 pt-2 pb-1 md:pt-3 md:pb-2 space-y-2">
          <div className="grid grid-cols-3 gap-1 md:gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleGoPrev}
              disabled={controlsDisabled || previousTaskOrder === null}
              className="justify-center md:justify-start gap-1"
            >
              <ChevronLeft className="h-4 w-4" />
              <span className="hidden md:inline">Предыдущая</span>
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={handleGoNext}
              disabled={controlsDisabled || !canGoNext}
              className="justify-center md:justify-start gap-1"
            >
              <ChevronRight className="h-4 w-4" />
              <span className="hidden md:inline">Следующая</span>
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

        {threadStatus === 'completed' && !showCompletedView ? (
          <div className="border-t px-4 py-3 bg-muted/30">
            <Button
              onClick={() => setShowCompletedView(true)}
              className="w-full gap-2"
            >
              <CheckCircle2 className="h-4 w-4" />
              Посмотреть результаты
            </Button>
          </div>
        ) : (
          <GuidedChatInput
            key={currentTaskOrder}
            onSendAnswer={handleSendAnswer}
            onSendStep={handleSendStep}
            isLoading={isStreaming || isCheckingAnswer || isRequestingHint}
            disabled={threadStatus !== 'active' || !isViewingActiveTask}
            taskNumber={currentTask?.order_num}
            initialAnswerText={currentDraftRef.current.answer}
            initialDiscussionText={currentDraftRef.current.discussion}
            onDraftChange={handleDraftChange}
            attachedFiles={attachedFiles}
            onFileSelect={handleFileSelect}
            onFileRemove={handleFileRemove}
            isUploading={isUploading}
          />
        )}
      </div>
    </div>
  );
}
