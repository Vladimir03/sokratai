import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Loader2, Mic, Paperclip, RefreshCw, Send, X, MicOff } from 'lucide-react';
import { toast } from 'sonner';
import { ProblemContext, type ProblemContextTask } from '@/components/student/homework-problem/ProblemContext';
import { SubmitSheet } from '@/components/student/homework-problem/SubmitSheet';
import GuidedChatMessage, { type GuidedMessageData } from '@/components/homework/GuidedChatMessage';
import { useStudentProblemTask } from '@/hooks/useStudentProblemTask';
import { useVoiceRecorder } from '@/hooks/useVoiceRecorder';
import { trackGuidedHomeworkEvent } from '@/lib/homeworkTelemetry';
import { getSubjectLabel } from '@/types/homework';
import type {
  HomeworkThreadMessage,
  HomeworkTaskState,
  CheckAnswerResponse,
} from '@/types/homework';
import { streamChat, StreamChatError } from '@/lib/streamChat';
import {
  saveThreadMessage,
  uploadStudentThreadImage,
  transcribeThreadVoice,
} from '@/lib/studentHomeworkApi';
import {
  serializeThreadAttachmentRefs,
  buildGuidedAttachmentPlaceholder,
} from '@/lib/homeworkThreadAttachments';
import { parseAttachmentUrls } from '@/lib/attachmentRefs';

/**
 * Student homework-problem screen — Phase 1.x (mobile, post preview-QA #1).
 *
 * Дизайн: `docs/design_handoff_homework_chat/README.md`
 * Spec: `docs/delivery/features/student-homework-problem-screen/spec.md`
 *
 * **Scope (Phase 1.x revision 2026-05-10 после preview QA #1):**
 * - Layout 1 — mobile (≤768px). Tablet (Layout 2) и Desktop (Layout 3) —
 *   Phase 3 separately.
 * - Topbar (back arrow → /student/homework + eyebrow + title)
 * - ProblemContext (peek by default when there are messages, expanded when
 *   the thread is empty — per AC-4) + clickable StepIndicator (free-order
 *   navigation between tasks via URL change)
 * - ChatThread (re-uses `GuidedChatMessage` with `perspective='student'`
 *   for full brand identity — Сократ avatar + kicker)
 * - Functional chat composer:
 *     • Text → `streamChat` to `/chat` endpoint with guided context
 *       (assignment_id + task_id) — AI reply streamed inline, then
 *       persisted via `saveThreadMessage`. Discussion path only (Q3 from
 *       preview QA #1) — never closes the task.
 *     • Paperclip → `uploadStudentThreadImage` (homework-submissions bucket)
 *       — attachments included with the user message (`image_url` ref).
 *     • Mic → `useVoiceRecorder` + `transcribeThreadVoice` (Groq Whisper);
 *       transcript is *appended* to the input — student can edit before
 *       sending (Q5).
 * - ComposerMobile primary CTA «Сдать решение задачи» (after CORRECT —
 *   flips to «Следующая задача →»; AC-7)
 * - SubmitSheet — single-shot submission with PhotoStrip + numeric/text
 *   inputs + VerdictOverlay (z-stack inside the sheet body) — единственный
 *   путь triggering `handleCheckAnswer`. SubmitSheet closes the task on
 *   CORRECT verdict; chat is discussion-only.
 *
 * **Hybrid first-completed-wins:** if a task is already
 * `task_state.status='completed'` (e.g. closed via the legacy desktop
 * `GuidedHomeworkWorkspace` answer-input), this page surfaces it via the
 * «Следующая задача →» CTA instead of allowing a second submission.
 * Score is fixed by whichever path closed the task first.
 *
 * **Telemetry (AC-8):** four PII-free events emitted via
 * `trackGuidedHomeworkEvent`:
 *   - `student_problem_screen_opened` (mount, fire-once per `hwId:taskId`)
 *   - `student_submitsheet_opened`     (CTA onClick)
 *   - `student_submission_sent`        (SubmitSheet `onSubmitStart`)
 *   - `student_submission_verdict`     (SubmitSheet `onSubmitted`)
 */
export default function HomeworkProblem() {
  const { hwId, taskId } = useParams<{ hwId: string; taskId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const {
    data,
    isPending,
    isError,
    error,
    refetch,
    isFetching,
  } = useStudentProblemTask(hwId, taskId);

  const threadId = data?.thread?.id ?? null;

  // ─── Map raw thread messages → GuidedMessageData[] ────────────────────────
  // - Filter by current task via `task_id` (canonical match per
  //   `.claude/rules/40-homework-system.md` § «Task identity»). Codex
  //   review #2: rendering all assignment messages bled sibling-task
  //   conversations into the current task view, breaking AC-4 + S1 UX.
  //   Fallback for legacy pre-2026-04-10 messages with `task_id IS NULL`:
  //   match by `task_order === data.task.order_num`.
  // - `visible_to_student=false` filtered (tutor-only notes).
  const persistedMessages = useMemo<HomeworkThreadMessage[]>(() => {
    const raw = data?.thread?.homework_tutor_thread_messages ?? [];
    const currentTaskId = data?.task.id;
    const currentTaskOrder = data?.task.order_num;
    return raw
      .filter((m) => m.visible_to_student !== false)
      .filter((m) => {
        if (!currentTaskId) return true;
        if (m.task_id) return m.task_id === currentTaskId;
        return m.task_order != null && m.task_order === currentTaskOrder;
      });
  }, [data?.thread?.homework_tutor_thread_messages, data?.task.id, data?.task.order_num]);

  // ─── Local optimistic messages + streaming AI preview ─────────────────────
  // User message + AI reply land here optimistically before persistence;
  // refetch resolves the canonical thread state. Streaming text is rendered
  // as a non-persisted assistant bubble until streamChat onDone.
  const [optimisticMessages, setOptimisticMessages] = useState<GuidedMessageData[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);

  /** Combined view: persisted thread + optimistic local + streaming preview. */
  const messages = useMemo<GuidedMessageData[]>(() => {
    const persistedView = persistedMessages.map<GuidedMessageData>((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      image_url: m.image_url,
      created_at: m.created_at,
      message_kind: m.message_kind,
      message_delivery_status: m.message_delivery_status,
    }));
    return [...persistedView, ...optimisticMessages];
  }, [persistedMessages, optimisticMessages]);

  // Default-collapsed logic: peek when there are messages, expanded when
  // the thread is empty (AC-4). One-shot init — user manual toggles win
  // over data updates afterwards. Reset key includes `taskId` so navigating
  // to a sibling task re-evaluates the default for the new thread.
  const initialCollapsed = persistedMessages.length > 0;
  const [contextCollapsed, setContextCollapsed] = useState(initialCollapsed);
  const lastInitTaskKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const key = `${hwId ?? ''}:${taskId ?? ''}`;
    if (lastInitTaskKeyRef.current === key) return;
    if (data == null) return;
    lastInitTaskKeyRef.current = key;
    setContextCollapsed(persistedMessages.length > 0);
    // Reset chat state when navigating between tasks.
    setOptimisticMessages([]);
    setStreamingText('');
    setChatDraft('');
    setAttachmentRefs([]);
  }, [data, hwId, taskId, persistedMessages.length]);

  const [chatDraft, setChatDraft] = useState('');
  const [submitOpen, setSubmitOpen] = useState(false);
  const [attachmentRefs, setAttachmentRefs] = useState<string[]>([]);

  // Auto-scroll to bottom on new messages or streaming.
  const chatScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, streamingText]);

  // ─── Telemetry: student_problem_screen_opened ─────────────────────────────
  const openedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (data == null) return;
    const key = `${hwId ?? ''}:${taskId ?? ''}`;
    if (openedKeyRef.current === key) return;
    openedKeyRef.current = key;
    trackGuidedHomeworkEvent('student_problem_screen_opened', {
      assignmentId: data.assignment.id,
      taskId: data.task.id,
      taskNo: data.task.order_num,
      taskKind: data.task.task_kind,
    });
  }, [data, hwId, taskId]);

  const eyebrow = useMemo(() => {
    if (data == null) return '';
    const subjectLabel = getSubjectLabel(data.assignment.subject);
    return `Задача ${data.task.order_num} / ${data.task_total} · ${subjectLabel}`;
  }, [data]);

  // ─── Chat send: discussion through /chat endpoint (Q3) ────────────────────
  const handleChatSend = useCallback(async () => {
    if (!data || !threadId) return;
    if (isStreaming) return;
    const trimmed = chatDraft.trim();
    if (!trimmed && attachmentRefs.length === 0) return;

    const taskOrder = data.task.order_num;
    const targetTaskId = data.task.id;
    const userTempId = `temp-user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const assistantTempId = `temp-assistant-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const content = trimmed || buildGuidedAttachmentPlaceholder(attachmentRefs.length);
    const attachmentSerialized = serializeThreadAttachmentRefs(attachmentRefs);
    const refsForRequest = [...attachmentRefs];

    // Optimistic user bubble.
    setOptimisticMessages((prev) => [
      ...prev,
      {
        id: userTempId,
        role: 'user',
        content,
        image_url: attachmentSerialized,
        created_at: new Date().toISOString(),
        message_kind: 'question',
        message_delivery_status: 'sending',
      },
    ]);
    setChatDraft('');
    setAttachmentRefs([]);

    // Persist user message (best-effort; on failure we still continue to
    // streamChat — server-side `/chat` doesn't depend on this row).
    try {
      await saveThreadMessage(
        threadId,
        'user',
        content,
        taskOrder,
        'question',
        targetTaskId,
        refsForRequest,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Не удалось сохранить сообщение';
      toast.error(msg);
      // Mark the bubble as failed; user can re-type if they want.
      setOptimisticMessages((prev) =>
        prev.map((m) =>
          m.id === userTempId
            ? { ...m, message_delivery_status: 'failed' as const }
            : m,
        ),
      );
      return;
    }

    // Build context for streamChat: persisted + this new user message.
    const contextMessages = [
      ...persistedMessages.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content },
    ];
    const taskImageRefs = parseAttachmentUrls(data.task.task_image_url);

    setIsStreaming(true);
    setStreamingText('');
    let fullContent = '';
    let streamErrorHandled = false;

    try {
      await streamChat({
        messages: contextMessages,
        // /chat endpoint already has SYSTEM_PROMPT; we just provide guided
        // homework context so it fetches the tutor's reference solution
        // server-side (anti-leak: never exposed to the client).
        guidedHomeworkAssignmentId: data.assignment.id,
        guidedHomeworkTaskId: data.task.id,
        taskImageUrls: taskImageRefs,
        onDelta: (delta) => {
          fullContent += delta;
          setStreamingText(fullContent);
        },
        onDone: () => undefined,
        onError: (e) => {
          streamErrorHandled = true;
          if (e instanceof StreamChatError) {
            if (e.code === 'LIMIT_REACHED') {
              toast.error('Достигнут дневной лимит сообщений');
            } else if (e.code === 'PAYMENT_REQUIRED') {
              toast.error('Требуется пополнение баланса');
            } else {
              toast.error(e.message);
            }
          } else {
            toast.error('Ошибка при получении ответа AI. Попробуй снова.');
          }
        },
      });

      const assistantText = fullContent.trim() || 'Принято. Продолжаем разбор задачи.';
      // Optimistic assistant bubble.
      setOptimisticMessages((prev) => [
        ...prev,
        {
          id: assistantTempId,
          role: 'assistant',
          content: assistantText,
          image_url: null,
          created_at: new Date().toISOString(),
          message_kind: 'ai_reply',
          message_delivery_status: 'sending',
        },
      ]);
      setStreamingText('');

      // Persist assistant message.
      try {
        await saveThreadMessage(
          threadId,
          'assistant',
          assistantText,
          taskOrder,
          'ai_reply',
          targetTaskId,
        );
      } catch (err) {
        toast.error('Ответ AI получен, но не сохранен.');
        setOptimisticMessages((prev) =>
          prev.map((m) =>
            m.id === assistantTempId
              ? { ...m, message_delivery_status: 'failed' as const }
              : m,
          ),
        );
      }

      // Refetch canonical thread (clears optimistic state when persisted
      // rows show up).
      queryClient.invalidateQueries({ queryKey: ['student', 'problem', hwId, taskId] });
      // Drop optimistic bubbles after a short delay so refetch has a
      // chance to populate persisted rows. If invalidation lands first
      // the new persisted messages will be merged with the optimistic
      // ones (same content but different ids) — visual de-dup is by id.
      setTimeout(() => {
        setOptimisticMessages([]);
      }, 800);
    } catch (err) {
      if (!streamErrorHandled) {
        toast.error(err instanceof Error ? err.message : 'Не удалось получить ответ');
      }
      setStreamingText('');
    } finally {
      setIsStreaming(false);
    }
  }, [
    data,
    threadId,
    chatDraft,
    attachmentRefs,
    isStreaming,
    persistedMessages,
    queryClient,
    hwId,
    taskId,
  ]);

  // ─── Voice input (Q5): record → transcribe → append to chat draft ─────────
  const recorder = useVoiceRecorder();
  const [isTranscribing, setIsTranscribing] = useState(false);

  const handleMicClick = useCallback(async () => {
    if (!threadId) return;
    if (recorder.isRecording) {
      const result = await recorder.stopRecording();
      if (!result) return;
      setIsTranscribing(true);
      try {
        const { text } = await transcribeThreadVoice(
          threadId,
          result.blob,
          result.fileName,
        );
        // Append (don't replace) so a previously typed prefix is preserved.
        setChatDraft((prev) => (prev.trim() ? `${prev} ${text}` : text));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Не удалось распознать речь');
      } finally {
        setIsTranscribing(false);
      }
    } else {
      if (!recorder.isSupported) {
        toast.error('Голосовой ввод не поддерживается этим браузером');
        return;
      }
      await recorder.startRecording();
    }
  }, [recorder, threadId]);

  // ─── Paperclip (Q6): photo attachment for chat message ────────────────────
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);

  const handleFileSelected = useCallback(async (file: File | undefined) => {
    if (!file || !data || !threadId) return;
    setIsUploadingAttachment(true);
    try {
      const ref = await uploadStudentThreadImage(
        file,
        data.assignment.id,
        threadId,
        data.task.order_num,
      );
      setAttachmentRefs((prev) => [...prev, ref]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось загрузить файл');
    } finally {
      setIsUploadingAttachment(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [data, threadId]);

  // ─── Step navigation (Q7, Q8): click on stepper → navigate ────────────────
  const handleStepClick = useCallback(
    (taskNo: number) => {
      if (!data || !hwId) return;
      if (taskNo === data.task.order_num) return; // no-op on current
      const target = data.thread?.homework_tutor_task_states?.find(
        (s) => s.task_order === taskNo,
      );
      if (!target?.task_id) return;
      navigate(`/student/homework/${hwId}/problem/${target.task_id}`);
    },
    [data, hwId, navigate],
  );

  // ─── Current-task completion + next-task lookup (AC-7) ─────────────────────
  const taskStates: HomeworkTaskState[] = useMemo(
    () => data?.thread?.homework_tutor_task_states ?? [],
    [data?.thread?.homework_tutor_task_states],
  );
  const currentTaskState = useMemo(
    () => taskStates.find((s) => s.task_id === data?.task.id) ?? null,
    [taskStates, data?.task.id],
  );
  const isCurrentCompleted = currentTaskState?.status === 'completed';

  const nextTaskId = useMemo(() => {
    if (!data) return null;
    const sorted = [...taskStates].sort((a, b) => a.task_order - b.task_order);
    const currentIdx = sorted.findIndex((s) => s.task_id === data.task.id);
    if (currentIdx < 0) return null;
    return sorted[currentIdx + 1]?.task_id ?? null;
  }, [data, taskStates]);

  const navigateAfterCorrect = useCallback(
    (override?: { nextTaskId?: string | null }) => {
      const target = override?.nextTaskId ?? nextTaskId;
      if (!hwId) {
        navigate('/student/homework');
        return;
      }
      if (target) {
        navigate(`/student/homework/${hwId}/problem/${target}`);
      } else {
        navigate('/student/homework');
      }
    },
    [hwId, navigate, nextTaskId],
  );

  // ─── ProblemContext task adapter ──────────────────────────────────────────
  const problemContextTask = useMemo<ProblemContextTask | null>(() => {
    if (!data) return null;
    const doneIndices = taskStates
      .filter((s) => s.status === 'completed' && s.task_id !== data.task.id)
      .map((s) => s.task_order);
    return {
      task_id: data.task.id,
      task_no: data.task.order_num,
      task_total: data.task_total,
      task_score: data.task_score,
      task_score_max: data.task.max_score,
      task_kind: data.task.task_kind,
      body: data.task.task_text,
      image_url: data.task.task_image_url,
      done_task_indices: doneIndices,
    };
  }, [data, taskStates]);

  // ─── Loading + error states ──────────────────────────────────────────────
  if (isPending || (!data && isFetching)) {
    return (
      <div
        className="flex h-[100dvh] w-full items-center justify-center bg-socrat-surface"
        role="status"
        aria-live="polite"
        aria-label="Загружаем задачу"
      >
        <Loader2
          className="h-8 w-8 text-socrat-primary animate-spin"
          aria-hidden="true"
        />
      </div>
    );
  }

  if (isError || !data) {
    const message =
      error instanceof Error
        ? error.message
        : 'Проверь интернет-соединение и попробуй ещё раз.';
    return (
      <div className="flex h-[100dvh] w-full items-center justify-center bg-socrat-surface px-4">
        <div className="w-full max-w-sm bg-white border border-socrat-border-light rounded-2xl p-6 flex flex-col items-center gap-3 shadow-sm">
          <h2 className="text-base font-bold text-slate-900 m-0">
            Не удалось загрузить задачу
          </h2>
          <p className="text-sm text-slate-600 text-center leading-relaxed">{message}</p>
          <button
            type="button"
            onClick={() => refetch()}
            className="inline-flex items-center gap-1.5 h-11 px-4 rounded-[12px] bg-socrat-primary hover:bg-socrat-primary-dark text-white text-sm font-bold touch-manipulation transition-colors"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Повторить
          </button>
        </div>
      </div>
    );
  }

  const canSendChat =
    !isStreaming &&
    !isUploadingAttachment &&
    !isTranscribing &&
    (chatDraft.trim().length > 0 || attachmentRefs.length > 0);

  return (
    <div className="flex h-[100dvh] w-full flex-col bg-socrat-surface">
      {/* Topbar (mobile) — back → /student/homework (Q2) */}
      <header className="flex items-center gap-2 px-3 py-2 bg-white border-b border-socrat-border-light shrink-0">
        <button
          type="button"
          onClick={() => navigate('/student/homework')}
          aria-label="К списку ДЗ"
          className="grid place-items-center w-10 h-10 rounded-full text-slate-700 hover:bg-socrat-surface hover:text-slate-900 shrink-0 touch-manipulation"
        >
          <ChevronLeft className="h-[22px] w-[22px] stroke-2" aria-hidden="true" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-[0.05em] text-socrat-primary truncate">
            {eyebrow}
          </div>
          <h1 className="text-sm font-bold text-slate-900 leading-tight truncate m-0">
            {data.assignment.title}
          </h1>
        </div>
      </header>

      {/* Problem context (peek/expanded) + clickable step indicator */}
      {problemContextTask ? (
        <div className="px-3 pt-3 shrink-0">
          <ProblemContext
            task={problemContextTask}
            collapsed={contextCollapsed}
            onToggle={() => setContextCollapsed((v) => !v)}
            compact
            assignmentId={data.assignment.id}
            onStepClick={handleStepClick}
          />
        </div>
      ) : null}

      {/* Chat thread — flex-1 with scroll */}
      <div
        ref={chatScrollRef}
        className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3 px-3.5 pt-2 pb-3.5 [-webkit-overflow-scrolling:touch] [&::-webkit-scrollbar]:hidden"
      >
        {messages.length === 0 && !streamingText ? (
          <div
            role="separator"
            aria-label="Начало диалога по задаче"
            className="flex items-center gap-3 py-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-socrat-muted"
          >
            <span className="flex-1 h-px bg-socrat-border-light" aria-hidden="true" />
            <span>Начни решать задачу</span>
            <span className="flex-1 h-px bg-socrat-border-light" aria-hidden="true" />
          </div>
        ) : (
          <>
            {messages.map((m) => (
              <GuidedChatMessage
                key={m.id ?? `${m.role}-${m.created_at}`}
                message={m}
                perspective="student"
              />
            ))}
            {streamingText ? (
              <GuidedChatMessage
                key="streaming-preview"
                message={{
                  id: 'streaming-preview',
                  role: 'assistant',
                  content: streamingText,
                  image_url: null,
                  created_at: new Date().toISOString(),
                  message_kind: 'ai_reply',
                }}
                perspective="student"
                isStreaming
              />
            ) : null}
          </>
        )}
      </div>

      {/* Composer */}
      <div className="flex flex-col gap-2 bg-white border-t border-socrat-border-light px-2.5 pt-2 pb-2.5 shrink-0">
        {/* Primary CTA */}
        <button
          type="button"
          onClick={() => {
            if (isCurrentCompleted) {
              navigateAfterCorrect();
              return;
            }
            trackGuidedHomeworkEvent('student_submitsheet_opened', {
              assignmentId: data.assignment.id,
              taskId: data.task.id,
              hadDraft: false,
            });
            setSubmitOpen(true);
          }}
          className="flex items-center gap-2.5 w-full px-3 py-2.5 bg-socrat-primary hover:bg-socrat-primary-dark text-white rounded-[14px] text-left transition-colors touch-manipulation"
          aria-label={isCurrentCompleted ? 'Следующая задача' : 'Сдать решение задачи'}
        >
          <span className="grid place-items-center w-7 h-7 rounded-full bg-white/20 shrink-0">
            <Send className="h-[18px] w-[18px] stroke-2" aria-hidden="true" />
          </span>
          <span className="flex flex-col flex-1 min-w-0 gap-px">
            <span className="text-sm font-bold leading-tight">
              {isCurrentCompleted
                ? nextTaskId
                  ? 'Следующая задача'
                  : 'Назад к ДЗ'
                : 'Сдать решение задачи'}
            </span>
            <span className="text-[11px] font-medium text-white/80 truncate">
              {isCurrentCompleted ? 'Задача сдана' : 'Ответ + фото решения от руки'}
            </span>
          </span>
        </button>

        {/* Attachment previews */}
        {attachmentRefs.length > 0 ? (
          <div className="flex items-center gap-1.5 flex-wrap">
            {attachmentRefs.map((ref) => (
              <span
                key={ref}
                className="inline-flex items-center gap-1 text-xs bg-socrat-surface text-slate-700 rounded-full pl-2 pr-1 py-0.5"
              >
                Фото
                <button
                  type="button"
                  onClick={() => setAttachmentRefs((prev) => prev.filter((r) => r !== ref))}
                  aria-label="Удалить вложение"
                  className="grid place-items-center w-5 h-5 rounded-full hover:bg-socrat-border-light"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </span>
            ))}
            {isUploadingAttachment ? (
              <span className="text-xs text-socrat-muted inline-flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                Загрузка...
              </span>
            ) : null}
          </div>
        ) : null}

        {/* Chat row — paperclip + input + mic + send */}
        <div className="flex items-center gap-1">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.pdf"
            className="hidden"
            onChange={(e) => handleFileSelected(e.target.files?.[0])}
          />
          <button
            type="button"
            aria-label="Прикрепить фото"
            disabled={isUploadingAttachment || isStreaming}
            onClick={() => fileInputRef.current?.click()}
            className="grid place-items-center w-9 h-10 rounded-[10px] text-slate-500 hover:bg-socrat-surface hover:text-slate-900 shrink-0 touch-manipulation disabled:opacity-50"
          >
            <Paperclip className="h-[18px] w-[18px]" aria-hidden="true" />
          </button>
          <input
            type="text"
            value={chatDraft}
            onChange={(e) => setChatDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canSendChat) {
                e.preventDefault();
                void handleChatSend();
              }
            }}
            placeholder={
              isTranscribing
                ? 'Расшифровываем…'
                : recorder.isRecording
                ? `Запись: ${recorder.recordingDurationSeconds}с`
                : 'Спроси Сократа о шаге…'
            }
            disabled={isStreaming || isTranscribing || recorder.isRecording}
            className="flex-1 min-w-0 h-10 px-3.5 bg-socrat-surface border border-socrat-border rounded-[20px] text-sm text-slate-900 outline-none focus-visible:border-socrat-primary focus-visible:ring-2 focus-visible:ring-socrat-primary/20 disabled:opacity-50"
            aria-label="Сообщение Сократу"
            style={{ fontSize: '16px' }}
          />
          <button
            type="button"
            aria-label={recorder.isRecording ? 'Остановить запись' : 'Записать голосом'}
            disabled={isStreaming || isTranscribing}
            onClick={handleMicClick}
            className={`grid place-items-center w-9 h-10 rounded-[10px] shrink-0 touch-manipulation transition-colors disabled:opacity-50 ${
              recorder.isRecording
                ? 'bg-rose-50 text-rose-600 hover:bg-rose-100'
                : 'text-slate-500 hover:bg-socrat-surface hover:text-slate-900'
            }`}
          >
            {recorder.isRecording ? (
              <MicOff className="h-[18px] w-[18px]" aria-hidden="true" />
            ) : (
              <Mic className="h-[18px] w-[18px]" aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            aria-label="Отправить"
            disabled={!canSendChat}
            onClick={() => void handleChatSend()}
            className="grid place-items-center w-10 h-10 rounded-full bg-socrat-primary hover:bg-socrat-primary-dark disabled:opacity-50 disabled:cursor-not-allowed text-white shrink-0 touch-manipulation transition-colors"
          >
            {isStreaming ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="h-4 w-4 stroke-[2.5]" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      <SubmitSheet
        open={submitOpen}
        onClose={() => setSubmitOpen(false)}
        hwId={hwId ?? data.assignment.id}
        taskId={taskId ?? data.task.id}
        task={{
          id: data.task.id,
          order_num: data.task.order_num,
          task_total: data.task_total,
          max_score: data.task.max_score,
          task_kind: data.task.task_kind,
          homework_title: data.assignment.title,
          current_score: data.task_score,
        }}
        onSubmitStart={(payload) => {
          trackGuidedHomeworkEvent('student_submission_sent', {
            assignmentId: data.assignment.id,
            taskId: data.task.id,
            ...payload,
          });
        }}
        onSubmitted={(verdict, score, max, response: CheckAnswerResponse) => {
          trackGuidedHomeworkEvent('student_submission_verdict', {
            assignmentId: data.assignment.id,
            taskId: data.task.id,
            verdict,
            aiScore: score,
            maxScore: max,
          });
          if (verdict === 'CORRECT') {
            navigateAfterCorrect({
              nextTaskId: response.next_task_id ?? null,
            });
          }
        }}
      />
    </div>
  );
}
