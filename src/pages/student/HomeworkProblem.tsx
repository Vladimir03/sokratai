import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft,
  Lightbulb,
  Loader2,
  Mic,
  MicOff,
  Paperclip,
  RefreshCw,
  Send,
  Sigma,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { ProblemContext, type ProblemContextTask } from '@/components/student/homework-problem/ProblemContext';
import {
  SubmitSheet,
  type SubmitSheetSubmissionPayload,
} from '@/components/student/homework-problem/SubmitSheet';
import {
  clearSubmitSheetDraft,
  getSubmitSheetDraftKey,
} from '@/components/student/homework-problem/submitSheetInternal';
import { NumericAnswerComposer } from '@/components/student/homework-problem/NumericAnswerComposer';
import { ChatChipRow } from '@/components/student/homework-problem/ChatChipRow';
import { SubmitCtaBar } from '@/components/student/homework-problem/SubmitCtaBar';
import { MathQuickPicker } from '@/components/student/homework-problem/MathQuickPicker';
import GuidedChatMessage, { type GuidedMessageData } from '@/components/homework/GuidedChatMessage';
import CriteriaBreakdownTable, {
  type CriteriaBreakdownItem,
} from '@/components/homework/CriteriaBreakdownTable';
import { TypingDots } from '@/components/student/homework-problem/TypingDots';
import sokratChatIcon from '@/assets/sokrat-chat-icon.png';
import { useStudentProblemTask } from '@/hooks/useStudentProblemTask';
import { useStudentAssignment } from '@/hooks/useStudentHomework';
import { useSubmitSolution } from '@/hooks/useSubmitSolution';
import { useVisualViewportHeight } from '@/hooks/useVisualViewportHeight';
import { useVoiceRecorder, type VoiceRecordingResult } from '@/hooks/useVoiceRecorder';
import { SpeakingComposer } from '@/components/student/homework-problem/SpeakingComposer';
import { useIsMobile } from '@/hooks/useIsMobile';
import { trackGuidedHomeworkEvent } from '@/lib/homeworkTelemetry';
import { getSubjectLabel } from '@/types/homework';
import { isHumanitiesWritingSubject } from '@/lib/subjectHelpers';
import type {
  HomeworkThreadMessage,
  HomeworkTaskState,
} from '@/types/homework';
import { streamChat, StreamChatError } from '@/lib/streamChat';
import {
  saveThreadMessage,
  uploadStudentThreadImage,
  uploadStudentThreadVoice,
  transcribeThreadVoice,
  requestHint as requestHintApi,
  checkAnswer as checkAnswerApi,
  getStudentTaskImageSignedUrl,
  StudentHomeworkApiError,
} from '@/lib/studentHomeworkApi';
import { serializeThreadAttachmentRefs } from '@/lib/homeworkThreadAttachments';
import { parseAttachmentUrls } from '@/lib/attachmentRefs';

/**
 * Student homework-problem screen — Phase 1.1 (mobile, post preview-QA #2).
 *
 * Дизайн: `docs/design_handoff_homework_chat/README.md`
 * Spec: `docs/delivery/features/student-homework-problem-screen/spec.md`
 *
 * **Scope (Phase 1.1 revision 2026-05-10 — codex review #2 fixes + hints UI):**
 * - Mobile (≤768px). Tablet/Desktop — Phase 3.
 * - Topbar (back arrow → /homework — список ДЗ ученика — + eyebrow + title).
 * - ProblemContext (peek/expanded) с clickable StepIndicator. Step click
 *   resolves taskId через `useStudentAssignment(hwId)` canonical tasks
 *   array (codex re-review #2 minor #7 — task_states могут быть partial
 *   при post-start tutor edits).
 * - ChatThread через `GuidedChatMessage` (perspective='student'). Optimistic
 *   bubbles переименовываются в persisted ids после `saveThreadMessage` —
 *   deterministic dedup, no setTimeout race (codex re-review #2 major #5).
 * - Functional chat composer:
 *     • Text → `streamChat` `/chat` endpoint с **полным контекстом**:
 *       `taskContext` + resolved `studentImageUrls` (from current
 *       attachments). Codex re-review #2 major #2: AI без taskContext
 *       не понимал условие, без studentImageUrls не видел фото.
 *     • Paperclip → `uploadStudentThreadImage` → ref в local state.
 *     • Mic + 💡 Hint group: collapsed default = Lightbulb icon; tap →
 *       expand to [💡 + 🎤] horizontal pair; user picks. Hint click →
 *       `requestHint` API → AI hint bubble lands as `'hint_reply'`,
 *       available_score degrades (B1 + B6 + B7 product decisions).
 * - ComposerMobile primary CTA «Сдать решение задачи» — flips на
 *   «Следующая задача →» после CORRECT.
 * - SubmitSheet — единственный путь triggering `handleCheckAnswer`. Chat
 *   path = discussion only (Q3).
 * - **Hybrid first-completed-wins (Q4):** если task уже completed
 *   (например через legacy desktop), CTA сразу «Следующая задача».
 *
 * **Telemetry (AC-8 + new):**
 *   - `student_problem_screen_opened`
 *   - `student_submitsheet_opened`
 *   - `student_submission_sent`
 *   - `student_submission_verdict`
 *   - `student_hint_requested` (new in Phase 1.1)
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

  // Codex re-review #2 minor #7 fix: canonical task list для step nav
  // resolution. `useStudentAssignment` is already cached if user came
  // from /homework/<id>; otherwise one extra round trip — acceptable.
  const { data: assignmentDetails } = useStudentAssignment(hwId ?? '');

  // Preview-QA #8 (2026-05-11) fix: mobile Chrome `100dvh` doesn't
  // recompute reliably after virtual keyboard hide → third-of-screen
  // white strip below the composer. visualViewport-driven inline height
  // keeps the root container exactly equal to the visible viewport
  // (and adjusts on keyboard open/close + orientation + address-bar
  // toggle). Fallback `'100dvh'` for SSR / non-supporting browsers.
  const vvHeight = useVisualViewportHeight();

  // Phase 3 (2026-05-12): tablet/desktop viewport flag for prop-level
  // adaptations (NumericAnswerComposer.hideDiscussion, etc.). CSS
  // responsive classes handle most of the layout — this hook only
  // resolves the rare props that need JS-level branching.
  const isMobile = useIsMobile();
  const isTabletPlus = !isMobile;

  const threadId = data?.thread?.id ?? null;
  // voice-speaking-mvp: устный монолог. Driver для рекордера + suppression
  // chat/numeric composers + transcript «Распознанная речь» label.
  const isSpeaking = data?.task.task_kind === 'speaking';

  // Lock html/body overflow while the problem screen is mounted —
  // prevents an outer page-level scrollbar on mobile when
  // visualViewport briefly reports a height larger than the actual
  // window (preview iframe / address-bar transitions). Restored on
  // unmount so other routes (e.g. /homework list) keep scrolling.
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.overflow;
    const prevBody = body.style.overflow;
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    return () => {
      html.style.overflow = prevHtml;
      body.style.overflow = prevBody;
    };
  }, []);

  // ─── Map raw thread messages → GuidedMessageData[] ────────────────────────
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

  // ─── Optimistic messages + streaming preview ──────────────────────────────
  // Codex re-review #2 major #5 fix: deterministic dedup. After
  // `saveThreadMessage` returns the persisted id, we update the temp
  // message with that id. On refetch, the persisted thread contains the
  // same id and we drop the optimistic via `persistedIds.has(temp.id)`.
  // No setTimeout race; failed messages stay visible until user retries.
  const [optimisticMessages, setOptimisticMessages] = useState<GuidedMessageData[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  // voice-speaking-mvp [P1]: two-phase progress after a voice submit
  // (STT → grading) instead of a frozen spinner. Mirror TypingDots.
  const [speakingPhase, setSpeakingPhase] = useState<null | 'transcribing' | 'grading'>(null);
  const speakingPhaseTimerRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (speakingPhaseTimerRef.current) window.clearTimeout(speakingPhaseTimerRef.current);
  }, []);

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
    const persistedIds = new Set(persistedView.map((m) => m.id));
    // Drop optimistic that's already persisted (id-based reconciliation).
    const visibleOptimistic = optimisticMessages.filter(
      (m) => !m.id || !persistedIds.has(m.id),
    );
    return [...persistedView, ...visibleOptimistic];
  }, [persistedMessages, optimisticMessages]);

  // Default-collapsed: peek when there are messages, expanded when empty.
  const initialCollapsed = persistedMessages.length > 0;
  const [contextCollapsed, setContextCollapsed] = useState(initialCollapsed);
  const lastInitTaskKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const key = `${hwId ?? ''}:${taskId ?? ''}`;
    if (lastInitTaskKeyRef.current === key) return;
    if (data == null) return;
    lastInitTaskKeyRef.current = key;
    setContextCollapsed(persistedMessages.length > 0);
    setOptimisticMessages([]);
    setStreamingText('');
    setChatDraft('');
    setAttachmentRefs([]);
    setMicHintExpanded(false);
  }, [data, hwId, taskId, persistedMessages.length]);

  const [chatDraft, setChatDraft] = useState('');
  const [submitOpen, setSubmitOpen] = useState(false);
  const [attachmentRefs, setAttachmentRefs] = useState<string[]>([]);

  // Phase 3 Commit C: math symbol picker state + last-focused textarea ref.
  // Tracks the most recently focused <input> / <textarea> inside the
  // right-column composer so MathQuickPicker can insert a snippet at the
  // current cursor position when a symbol is clicked.
  const [mathPickerOpen, setMathPickerOpen] = useState(false);
  const lastFocusedInputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const handleInputFocus = useCallback(
    (e: React.FocusEvent<HTMLDivElement>) => {
      const target = e.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement
      ) {
        lastFocusedInputRef.current = target;
      }
    },
    [],
  );
  const insertMathSnippet = useCallback((snippet: string) => {
    const el = lastFocusedInputRef.current;
    if (!el) return;
    // Some Safari versions don't fire `input` events from setRangeText, so
    // we dispatch one manually after writing the snippet. This ensures
    // controlled-component state (React) reflects the inserted text.
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    try {
      el.focus();
      el.setRangeText(snippet, start, end, 'end');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } catch {
      // Fallback: append to end if setRangeText throws (very old Safari).
      el.value = `${el.value}${snippet}`;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, []);

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

  // ─── Score chip values (B2 hybrid) ────────────────────────────────────────
  // While task is `active` → show `available_score` (live: degrades after
  // hint requests + wrong attempts). After `completed` → show resolved
  // final score (override > earned > ai > status). The chip state is
  // owned by `ProblemContext` via the `task_score` prop, but the value
  // it uses depends on the current task_state status.
  const taskStates: HomeworkTaskState[] = useMemo(
    () => data?.thread?.homework_tutor_task_states ?? [],
    [data?.thread?.homework_tutor_task_states],
  );

  // Preview-QA #11 (2026-05-11) hotfix: `task_states.task_order` НЕ
  // существует в DB schema — codex review #2 «add task_order to
  // THREAD_SELECT» fix был incorrect, поломал thread fetch для всех
  // (PostgREST 500 → student empty chat + tutor stuck loading).
  // Resolve task_order через assignmentDetails.tasks lookup by task_id
  // (mirror legacy GuidedHomeworkWorkspace pattern: `taskById.get(s.task_id)?.order_num`).
  const taskByIdMap = useMemo(() => {
    const map = new Map<string, number>();
    (assignmentDetails?.tasks ?? []).forEach((t) => {
      if (t.id && typeof t.order_num === 'number') {
        map.set(t.id, t.order_num);
      }
    });
    return map;
  }, [assignmentDetails?.tasks]);

  /** Resolve task_order для task_state через assignment tasks lookup. */
  const orderForState = useCallback(
    (state: HomeworkTaskState): number | undefined => {
      return taskByIdMap.get(state.task_id);
    },
    [taskByIdMap],
  );
  const currentTaskState = useMemo(
    () => taskStates.find((s) => s.task_id === data?.task.id) ?? null,
    [taskStates, data?.task.id],
  );
  const isCurrentCompleted = currentTaskState?.status === 'completed';
  // 2026-05-16 (lexical-brewing-gadget): задача закрыта вручную репетитором,
  // не AI-CORRECT verdict'ом. Single-task screen → mobile users не видят
  // TaskStepper tooltip, нужен явный text differentiator в CTA subtitle.
  const isTutorForceCompleted =
    isCurrentCompleted && currentTaskState?.tutor_force_completed_at != null;
  const hintCount = currentTaskState?.hint_count ?? 0;

  /**
   * Score chip value (B2 product decision):
   *   - `active` → `available_score` (live, degrades on hint/wrong)
   *   - `completed` → final earned (data.task_score from backend chain)
   * Backend `data.task_score` already runs through `computeFinalScore`
   * (override > earned > ai > status), so for completed tasks it's
   * authoritative. For active tasks we prefer `available_score` from
   * task_state when present, falling back to data.task_score.
   */
  const liveScore = useMemo(() => {
    if (!data) return 0;
    if (isCurrentCompleted) return data.task_score;
    if (currentTaskState?.available_score != null) {
      return currentTaskState.available_score;
    }
    return data.task.max_score;
  }, [data, isCurrentCompleted, currentTaskState]);

  // ─── Tutor identity for chat bubbles (preview-QA #7, 2026-05-10) ──────────
  // Сообщения от репетитора в чате должны показывать имя + аватар (или
  // инициалы fallback). `data.thread.tutor_profile` уже резолвится
  // backend'ом через `resolveTutorProfileForAssignment` (homework-api).
  // Mirror стабильного memo pattern из `GuidedHomeworkWorkspace` —
  // anchored на 3 примитивных поля чтобы `GuidedChatMessage.memo()`
  // short-circuits при refetch'ах когда identity не менялась (это нужно
  // чтобы аватар не мерцал при каждом message persist).
  /* eslint-disable react-hooks/exhaustive-deps */
  const tutorProfile = useMemo(() => {
    const profile = data?.thread?.tutor_profile;
    if (!profile) return null;
    return {
      display_name: profile.display_name,
      avatar_url: profile.avatar_url,
      gender: profile.gender,
    };
  }, [
    data?.thread?.tutor_profile?.display_name,
    data?.thread?.tutor_profile?.avatar_url,
    data?.thread?.tutor_profile?.gender,
  ]);
  /* eslint-enable react-hooks/exhaustive-deps */

  // ─── Resolve student image refs to signed URLs (codex #2 major #2) ────────
  const resolveStudentImageUrls = useCallback(
    async (refs: string[]): Promise<string[]> => {
      if (refs.length === 0) return [];
      const resolved = await Promise.all(
        refs.map((ref) => getStudentTaskImageSignedUrl(ref).catch(() => null)),
      );
      return resolved.filter((url): url is string => typeof url === 'string' && url.length > 0);
    },
    [],
  );

  // ─── Build task context for AI prompt (codex #2 major #2) ─────────────────
  const buildTaskContextString = useCallback(() => {
    if (!data) return undefined;
    const lines = [
      `Условие задачи ${data.task.order_num} из ${data.task_total} (${getSubjectLabel(data.assignment.subject)}):`,
      data.task.task_text,
    ];
    return lines.join('\n');
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
    // Preview-QA #9 fix (2026-05-11): inline placeholder builder.
    // Раньше вызывали buildGuidedAttachmentPlaceholder(attachmentRefs.length)
    // — но та функция ожидает Array<{name,type}>, не number → .map throws
    // TypeError → send silently не работает когда фото есть без текста.
    const content =
      trimmed ||
      (attachmentRefs.length === 1
        ? '(фото)'
        : `(фото x${attachmentRefs.length})`);
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

    // Persist user message; capture persisted id for deterministic dedup.
    let persistedUserId: string | null = null;
    try {
      const saved = await saveThreadMessage(
        threadId,
        'user',
        content,
        taskOrder,
        'question',
        targetTaskId,
        refsForRequest,
      );
      persistedUserId = saved.id;
      // Replace temp id with persisted id so the next refetch dedupes.
      setOptimisticMessages((prev) =>
        prev.map((m) =>
          m.id === userTempId
            ? { ...m, id: saved.id, message_delivery_status: 'sent' as const }
            : m,
        ),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Не удалось сохранить сообщение';
      toast.error(msg);
      setOptimisticMessages((prev) =>
        prev.map((m) =>
          m.id === userTempId
            ? { ...m, message_delivery_status: 'failed' as const }
            : m,
        ),
      );
      return;
    }

    // Build context for streamChat — codex #2 major #2 fix.
    const contextMessages = [
      ...persistedMessages.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content },
    ];
    const taskImageRefs = parseAttachmentUrls(data.task.task_image_url);
    const studentImageUrls = await resolveStudentImageUrls(refsForRequest);
    const taskContext = buildTaskContextString();

    setIsStreaming(true);
    setStreamingText('');
    let fullContent = '';
    let streamErrorHandled = false;
    const assistantTempId = `temp-assistant-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    try {
      await streamChat({
        messages: contextMessages,
        taskContext,
        taskImageUrls: taskImageRefs,
        studentImageUrls: studentImageUrls.length > 0 ? studentImageUrls : undefined,
        guidedHomeworkAssignmentId: data.assignment.id,
        guidedHomeworkTaskId: data.task.id,
        // Subject-aware AI: hint/chat respond in-discipline (no «физическая
        // величина» on French / Russian / English homework).
        subject: data.assignment.subject,
        // Phase 8 (2026-05-20) — explicit student name + gender для AI grammar
        // conjugation. data.student.display_name + data.student.gender —
        // hydrated через handleGetStudentProblem endpoint (resolveStudentIdentity).
        // Server-side подтверждает оба через DB (anti-tamper).
        studentName: data.student?.display_name ?? undefined,
        studentGender: data.student?.gender ?? null,
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

      // Persist assistant; replace temp id on success.
      try {
        const savedAssistant = await saveThreadMessage(
          threadId,
          'assistant',
          assistantText,
          taskOrder,
          'ai_reply',
          targetTaskId,
        );
        setOptimisticMessages((prev) =>
          prev.map((m) =>
            m.id === assistantTempId
              ? { ...m, id: savedAssistant.id, message_delivery_status: 'sent' as const }
              : m,
          ),
        );
      } catch {
        toast.error('Ответ AI получен, но не сохранён.');
        setOptimisticMessages((prev) =>
          prev.map((m) =>
            m.id === assistantTempId
              ? { ...m, message_delivery_status: 'failed' as const }
              : m,
          ),
        );
      }

      // Refetch canonical thread; dedup is id-based via persistedIds Set.
      // We do NOT clear optimistic en-masse — failed bubbles stay visible
      // for user retry, succeeded bubbles dedupe naturally.
      void queryClient.invalidateQueries({ queryKey: ['student', 'problem', hwId, taskId] });
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
    resolveStudentImageUrls,
    buildTaskContextString,
  ]);

  // ─── Mic + Hint group (B1 — expandable) ───────────────────────────────────
  // Default collapsed: 💡 Lightbulb only. Tap → expand to [💡, 🎤] pair;
  // pick one → action fires + collapse. Mic state during recording stays
  // expanded so user can stop the recording.
  const [micHintExpanded, setMicHintExpanded] = useState(false);
  const recorder = useVoiceRecorder();
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isRequestingHint, setIsRequestingHint] = useState(false);

  const handleHintClick = useCallback(async () => {
    if (!data || !threadId) return;
    if (isCurrentCompleted) {
      toast.message('Задача уже сдана. Подсказка не нужна.');
      return;
    }
    if (isRequestingHint) return;
    setMicHintExpanded(false);
    setIsRequestingHint(true);
    trackGuidedHomeworkEvent('student_hint_requested', {
      assignmentId: data.assignment.id,
      taskId: data.task.id,
      hintCountBefore: hintCount,
    });
    // Preview-QA #5 (2026-05-10): instant optimistic feedback —
    // U1 user bubble «Подсказка» (matches backend persisted text) +
    // U3 typing dots placeholder bubble (TypingDots in muted Сократ
    // bubble). Both temp ids; on backend response → invalidate refetch
    // → persisted hint_request + hint_reply messages land, optimistic
    // ones get deduped by id-based reconciliation (replaced after
    // saveThreadMessage returns persisted id, OR cleaned up via U5
    // rollback on failure).
    const userTempId = `temp-hint-user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const typingTempId = `temp-hint-typing-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setOptimisticMessages((prev) => [
      ...prev,
      {
        id: userTempId,
        role: 'user',
        content: 'Подсказка',
        image_url: null,
        created_at: new Date().toISOString(),
        message_kind: 'hint_request',
        message_delivery_status: 'sending',
      },
      {
        id: typingTempId,
        role: 'assistant',
        // Sentinel content — UI render path replaces this bubble's body
        // with `<TypingDots />` (see chat thread render below).
        content: '__typing__',
        image_url: null,
        created_at: new Date().toISOString(),
        message_kind: 'ai_reply',
        message_delivery_status: 'sending',
      },
    ]);
    try {
      await requestHintApi(threadId, data.task.order_num, data.task.id);
      // Refetch — new hint_reply bubble + new available_score lands.
      await queryClient.invalidateQueries({ queryKey: ['student', 'problem', hwId, taskId] });
      // U5 cleanup: drop both temp bubbles. Backend persisted equivalents
      // arrive via refetch; id-based dedup would skip them anyway since
      // temp ids never match persisted ids, but explicit removal here
      // avoids relying on dedup heuristics for ephemeral typing dots.
      setOptimisticMessages((prev) =>
        prev.filter((m) => m.id !== userTempId && m.id !== typingTempId),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Не удалось получить подсказку';
      toast.error(msg);
      // U5 default: clean rollback — remove both optimistic bubbles so
      // the student can retry by tapping 💡 again from a clean state.
      setOptimisticMessages((prev) =>
        prev.filter((m) => m.id !== userTempId && m.id !== typingTempId),
      );
    } finally {
      setIsRequestingHint(false);
    }
  }, [data, threadId, isCurrentCompleted, isRequestingHint, hintCount, queryClient, hwId, taskId]);

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
        setChatDraft((prev) => (prev.trim() ? `${prev} ${text}` : text));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Не удалось распознать речь');
      } finally {
        setIsTranscribing(false);
        setMicHintExpanded(false);
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

  // ─── Step navigation (Q7, Q8 + codex #7): canonical tasks list ────────────
  const handleStepClick = useCallback(
    (taskNo: number) => {
      if (!data || !hwId) return;
      if (taskNo === data.task.order_num) return;
      // Codex re-review #2 minor #7 fix: resolve via canonical assignment
      // tasks array (assignmentDetails.tasks), not task_states (which can
      // be partial when tutor adds tasks post-start).
      const targetTask = assignmentDetails?.tasks?.find(
        (t) => t.order_num === taskNo,
      );
      if (!targetTask?.id) {
        // Fallback: try task_states (lazy-provisioned).
        // Preview-QA #11 hotfix: task_states.task_order не существует
        // в DB → resolve через taskByIdMap (assignmentDetails.tasks).
        const fallbackState = data.thread?.homework_tutor_task_states?.find(
          (s) => orderForState(s) === taskNo,
        );
        if (fallbackState?.task_id) {
          navigate(`/student/homework/${hwId}/problem/${fallbackState.task_id}`);
        }
        return;
      }
      navigate(`/student/homework/${hwId}/problem/${targetTask.id}`);
    },
    [data, hwId, navigate, assignmentDetails],
  );

  const nextTaskId = useMemo(() => {
    if (!data) return null;
    // Preview-QA #11 hotfix: sort напрямую по assignmentDetails.tasks
    // (canonical order_num), не по task_states (нет task_order в schema).
    const sortedTasks = [...(assignmentDetails?.tasks ?? [])].sort(
      (a, b) => a.order_num - b.order_num,
    );
    const currentIdx = sortedTasks.findIndex((t) => t.id === data.task.id);
    if (currentIdx < 0) return null;
    return sortedTasks[currentIdx + 1]?.id ?? null;
  }, [data, assignmentDetails]);

  // ─── Submission flow (preview-QA #6, 2026-05-10) ─────────────────────────
  // Phase 1.2 рефакторинг: ответ ученика + AI verdict теперь живут в чате,
  // не в отдельном overlay. SubmitSheet просто collects inputs + closes;
  // parent owns mutation + optimistic + dedup + navigation.
  //
  // Flow:
  //   1. SubmitSheet calls onSubmit({numeric, photos, text}) and closes
  //   2. Parent inserts optimistic submission user bubble (kind='submission')
  //      + typing dots placeholder, mutation.mutateAsync() in background
  //   3. On success: refetch persists submission + AI feedback
  //      (kind='check_result') bubbles → temp messages cleaned up.
  //      Если verdict=CORRECT → clear localStorage draft. Студент видит
  //      success bubble и может tap «Следующая задача» CTA когда готов.
  //   4. On error: toast + remove temp messages. Autosave preserves form.
  const submitMutation = useSubmitSolution(
    hwId ?? data?.assignment.id ?? '',
    taskId ?? data?.task.id ?? '',
  );

  const handleSubmissionSubmit = useCallback(
    async (payload: SubmitSheetSubmissionPayload) => {
      if (!data) return;
      // Synthesize optimistic user bubble content — mirrors backend
      // `handleStudentSubmission::answerText` formula (rule §40):
      //   numeric → «Числовой ответ: X»
      //   text    → appended on next line
      //   нет того и того → «(см. фото решения)»
      const lines: string[] = [];
      if (data.task.task_kind !== 'proof' && payload.numeric.trim()) {
        lines.push(`Числовой ответ: ${payload.numeric.trim()}`);
      }
      if (payload.text.trim()) lines.push(payload.text.trim());
      const synthesizedContent =
        lines.length > 0 ? lines.join('\n') : '(см. фото решения)';
      const attachmentSerialized = serializeThreadAttachmentRefs(payload.photos);

      const userTempId = `temp-submission-user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const typingTempId = `temp-submission-typing-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

      setOptimisticMessages((prev) => [
        ...prev,
        {
          id: userTempId,
          role: 'user',
          content: synthesizedContent,
          image_url: attachmentSerialized,
          created_at: new Date().toISOString(),
          message_kind: 'submission',
          message_delivery_status: 'sending',
        },
        {
          id: typingTempId,
          role: 'assistant',
          content: '__typing__',
          image_url: null,
          created_at: new Date().toISOString(),
          message_kind: 'check_result',
          message_delivery_status: 'sending',
        },
      ]);

      trackGuidedHomeworkEvent('student_submission_sent', {
        assignmentId: data.assignment.id,
        taskId: data.task.id,
        hasPhotos: payload.photos.length > 0,
        photoCount: payload.photos.length,
        hasText: payload.text.length > 0,
        numericLength: payload.numeric.length,
      });

      try {
        const response = await submitMutation.mutateAsync(payload);
        trackGuidedHomeworkEvent('student_submission_verdict', {
          assignmentId: data.assignment.id,
          taskId: data.task.id,
          verdict: response.verdict,
          aiScore: response.earned_score ?? 0,
          maxScore: response.max_score,
        });

        // Remove optimistic temp messages — persisted submission +
        // check_result land via React Query refetch (useSubmitSolution
        // already invalidated the targeted query inside its onSuccess).
        setOptimisticMessages((prev) =>
          prev.filter((m) => m.id !== userTempId && m.id !== typingTempId),
        );

        // CORRECT verdict — clear autosave draft (студент закрыл задачу,
        // черновик больше не нужен). Не auto-navigate'им: студент должен
        // увидеть success-фидбек в чате; primary CTA сам flip'нется на
        // «Следующая задача» через `isCurrentCompleted` derive после
        // refetch.
        if (response.verdict === 'CORRECT') {
          clearSubmitSheetDraft(taskId ?? data.task.id);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Не удалось отправить решение';
        toast.error(msg);
        // Clean rollback both optimistic bubbles. Autosave preserves
        // form contents so студент может re-open SubmitSheet, поправить
        // и попробовать снова.
        setOptimisticMessages((prev) =>
          prev.filter((m) => m.id !== userTempId && m.id !== typingTempId),
        );
      }
    },
    [data, submitMutation, taskId],
  );

  // ─── Speaking submission flow (voice-speaking-mvp, 2026-05-29) ───────────
  // Upload recorded monologue → voice_ref → submitSolution (backend Whisper →
  // grades transcript). Two-phase progress (STT → grading) shown optimistically.
  // No optimistic user bubble — the transcript only exists after the backend
  // returns; refetch then renders it under «Распознанная речь».
  const handleSpeakingSubmit = useCallback(
    async (result: VoiceRecordingResult) => {
      if (!data) return;
      const effectiveHwId = hwId ?? data.assignment.id;

      // Phase 1 «Распознаю речь…» immediately; optimistically flip to
      // «Проверяю по критериям…» after ~4s (single request, optimistic UX).
      setSpeakingPhase('transcribing');
      if (speakingPhaseTimerRef.current) window.clearTimeout(speakingPhaseTimerRef.current);
      speakingPhaseTimerRef.current = window.setTimeout(() => setSpeakingPhase('grading'), 4000);

      trackGuidedHomeworkEvent('student_submission_sent', {
        assignmentId: data.assignment.id,
        taskId: data.task.id,
        hasPhotos: false,
        photoCount: 0,
        hasText: false,
        numericLength: 0,
      });

      try {
        const voiceRef = await uploadStudentThreadVoice(
          result.blob,
          effectiveHwId,
          data.task.order_num,
          result.fileName,
        );
        const response = await submitMutation.mutateAsync({
          numeric: '',
          photos: [],
          text: '',
          voice_ref: voiceRef,
        });
        trackGuidedHomeworkEvent('student_submission_verdict', {
          assignmentId: data.assignment.id,
          taskId: data.task.id,
          verdict: response.verdict,
          aiScore: response.earned_score ?? 0,
          maxScore: response.max_score,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Не удалось отправить запись';
        toast.error(msg);
      } finally {
        if (speakingPhaseTimerRef.current) window.clearTimeout(speakingPhaseTimerRef.current);
        setSpeakingPhase(null);
      }
    },
    [data, hwId, submitMutation],
  );

  // ─── Inline numeric answer flow (Phase 1.3, preview-QA #8 2026-05-11) ────
  // Для `task_kind='numeric'` ученик пишет ответ в small inline green field
  // (см. `NumericAnswerComposer`). Submit триггерит `checkAnswer` API (тот
  // же legacy desktop flow → handleCheckAnswer → AI verdict → может close
  // task на CORRECT). Pattern mirror'ит handleSubmissionSubmit но через
  // другой API — `checkAnswer` вместо `submitSolution`.
  const [answerDraft, setAnswerDraft] = useState('');
  const [isInlineAnswerSubmitting, setIsInlineAnswerSubmitting] = useState(false);

  const handleInlineAnswerSubmit = useCallback(async () => {
    if (!data || !threadId) return;
    const trimmed = answerDraft.trim();
    if (!trimmed || isInlineAnswerSubmitting || isStreaming) return;

    const taskOrder = data.task.order_num;
    const targetTaskId = data.task.id;
    const userTempId = `temp-answer-user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const typingTempId = `temp-answer-typing-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    setOptimisticMessages((prev) => [
      ...prev,
      {
        id: userTempId,
        role: 'user',
        content: trimmed,
        image_url: null,
        created_at: new Date().toISOString(),
        message_kind: 'answer',
        message_delivery_status: 'sending',
      },
      {
        id: typingTempId,
        role: 'assistant',
        content: '__typing__',
        image_url: null,
        created_at: new Date().toISOString(),
        message_kind: 'check_result',
        message_delivery_status: 'sending',
      },
    ]);
    setAnswerDraft('');
    setIsInlineAnswerSubmitting(true);

    trackGuidedHomeworkEvent('student_submission_sent', {
      assignmentId: data.assignment.id,
      taskId: data.task.id,
      hasPhotos: false,
      photoCount: 0,
      hasText: false,
      numericLength: trimmed.length,
    });

    try {
      const response = await checkAnswerApi(threadId, trimmed, taskOrder, targetTaskId);
      trackGuidedHomeworkEvent('student_submission_verdict', {
        assignmentId: data.assignment.id,
        taskId: data.task.id,
        verdict: response.verdict,
        aiScore: response.earned_score ?? 0,
        maxScore: response.max_score,
      });
      // Refetch invalidate → persisted answer + check_result bubbles
      // land. Optimistic cleanup explicit (temp ids never match
      // persisted ids).
      await queryClient.invalidateQueries({
        queryKey: ['student', 'problem', hwId, taskId],
      });
      setOptimisticMessages((prev) =>
        prev.filter((m) => m.id !== userTempId && m.id !== typingTempId),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Не удалось проверить ответ';
      toast.error(msg);
      // Restore the draft so student doesn't lose input on retry.
      setAnswerDraft(trimmed);
      setOptimisticMessages((prev) =>
        prev.filter((m) => m.id !== userTempId && m.id !== typingTempId),
      );
    } finally {
      setIsInlineAnswerSubmitting(false);
    }
  }, [
    data,
    threadId,
    answerDraft,
    isInlineAnswerSubmitting,
    isStreaming,
    queryClient,
    hwId,
    taskId,
  ]);

  const navigateAfterCorrect = useCallback(
    (override?: { nextTaskId?: string | null }) => {
      const target = override?.nextTaskId ?? nextTaskId;
      if (!hwId) {
        // Список ДЗ ученика на route `/homework` (StudentHomework.tsx),
        // не `/student/homework` (которого нет — давало 404 в preview QA).
        navigate('/homework');
        return;
      }
      if (target) {
        navigate(`/student/homework/${hwId}/problem/${target}`);
      } else {
        // Preview-QA #10 (2026-05-11) fix: codex review #3. Все задачи
        // решены → возврат на список ДЗ `/homework` (НЕ `/homework/:hwId`
        // — StudentHomeworkDetail на mobile теперь сам редиректит туда
        // при all-completed, но идём напрямую чтобы не было mount/unmount
        // bounce через detail page).
        navigate('/homework');
      }
    },
    [hwId, navigate, nextTaskId],
  );

  // ─── ProblemContext task adapter (B2 hybrid score) ────────────────────────
  const problemContextTask = useMemo<ProblemContextTask | null>(() => {
    if (!data) return null;
    // Preview-QA #4 fix (2026-05-10): include the CURRENT task in
    // `doneIndices` if it's completed. Previously we excluded it on the
    // theory «current circle should show ring, not check» — but that
    // hid the «solved» state from the student. Now `StepIndicator`
    // owns the rendering: a circle that's both done AND current shows
    // green-filled with check + outer ring (telegraphs both states).
    // Preview-QA #11 hotfix: resolve order_num через taskByIdMap, не
    // через `s.task_order` (которое undefined в новом thread response).
    const doneIndices = taskStates
      .filter((s) => s.status === 'completed')
      .map((s) => orderForState(s))
      .filter((n): n is number => typeof n === 'number');
    return {
      task_id: data.task.id,
      task_no: data.task.order_num,
      task_total: data.task_total,
      task_score: liveScore, // B2 hybrid: available_score (active) → earned (completed)
      task_score_max: data.task.max_score,
      task_kind: data.task.task_kind,
      body: data.task.task_text,
      image_url: data.task.task_image_url,
      done_task_indices: doneIndices,
      hint_count: hintCount,
      score_state: isCurrentCompleted ? 'completed' : 'active',
    };
  }, [data, taskStates, liveScore, hintCount, isCurrentCompleted]);

  // ─── Loading + error states ──────────────────────────────────────────────
  if (isPending || (!data && isFetching)) {
    return (
      <div
        className="flex w-full items-center justify-center bg-socrat-surface"
        style={{ height: vvHeight }}
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
    // SESSION_EXPIRED — refresh + retry both failed in requestStudentHomeworkApi.
    // signOut() already fired → AuthGuard's onAuthStateChange listener
    // navigates to /login. No retry button (would just 401 again).
    const isSessionExpired =
      error instanceof StudentHomeworkApiError && error.code === 'SESSION_EXPIRED';
    const message =
      error instanceof Error
        ? error.message
        : 'Проверь интернет-соединение и попробуй ещё раз.';
    return (
      <div
        className="flex w-full items-center justify-center bg-socrat-surface px-4"
        style={{ height: vvHeight }}
      >
        <div className="w-full max-w-sm bg-white border border-socrat-border-light rounded-2xl p-6 flex flex-col items-center gap-3 shadow-sm">
          <h2 className="text-base font-bold text-slate-900 m-0">
            {isSessionExpired ? 'Сессия истекла' : 'Не удалось загрузить задачу'}
          </h2>
          <p className="text-sm text-slate-600 text-center leading-relaxed">
            {isSessionExpired
              ? 'Перенаправляем на страницу входа…'
              : message}
          </p>
          {isSessionExpired ? (
            <Loader2
              className="h-5 w-5 text-socrat-primary animate-spin"
              aria-hidden="true"
            />
          ) : (
            <button
              type="button"
              onClick={() => refetch()}
              className="inline-flex items-center gap-1.5 h-11 px-4 rounded-[12px] bg-socrat-primary hover:bg-socrat-primary-dark text-white text-sm font-bold touch-manipulation transition-colors"
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Повторить
            </button>
          )}
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
    <div
      className="
        flex w-full flex-col bg-socrat-surface overflow-hidden
        h-[var(--vv-h,100vh)]
        md:grid md:grid-cols-[420px_1fr]
        xl:grid-cols-[460px_1fr] xl:h-[calc(var(--vv-h,100vh)-56px)]
      "
      style={
        // useVisualViewportHeight already returns a CSS value string
        // ('1234px' or '100dvh'). Don't append `px` — that produces
        // invalid `pxpx` / `100dvhpx`. Pass the string through verbatim.
        // Fallback `100vh` (in the Tailwind class) covers Safari 15.0-15.3
        // before our Vite `safari15` target hit `dvh` support (15.4+).
        { '--vv-h': vvHeight } as React.CSSProperties
      }
    >
      {/* Left aside — tablet/desktop only.
          Phase 3 (2026-05-12): split-layout sidebar with breadcrumb (tablet
          only — desktop ≥xl uses global <Navigation />), full StepIndicator
          + always-expanded ProblemContext (incl. body, image gallery,
          warn-banner). Sticky SubmitCtaBar at the bottom (Commit B). */}
      <aside className="hidden md:flex md:flex-col md:border-r md:border-socrat-border-light md:bg-white md:overflow-hidden">
        {/* Tablet breadcrumb topbar — hidden on desktop (global nav owns it). */}
        <header className="md:flex xl:hidden items-center gap-2 px-4 py-3 border-b border-socrat-border-light shrink-0">
          <button
            type="button"
            onClick={() => navigate('/homework')}
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

        {/* Scrollable problem-context area */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4">
          {problemContextTask ? (
            <ProblemContext
              task={problemContextTask}
              collapsed={false}
              onToggle={() => undefined}
              hideToggle
              assignmentId={data.assignment.id}
              onStepClick={handleStepClick}
              subject={data.assignment.subject}
            />
          ) : null}
        </div>

        {/* Sticky bottom CTA — only for extended/proof (numeric uses inline
            answer field in the right column, not SubmitSheet). One primary
            CTA per screen — chip-row above the composer does NOT duplicate
            this button (Round 2 walkthrough invariant). */}
        {data.task.task_kind !== 'numeric' && !isSpeaking ? (
          <SubmitCtaBar
            onOpen={() => {
              // Preview-QA #10 (2026-05-11) codex review #7 fix: real
              // hadDraft instead of hardcoded false.
              const draftKey = getSubmitSheetDraftKey(taskId ?? data.task.id);
              const hadDraft =
                typeof window !== 'undefined' &&
                Boolean(window.localStorage.getItem(draftKey));
              trackGuidedHomeworkEvent('student_submitsheet_opened', {
                assignmentId: data.assignment.id,
                taskId: data.task.id,
                hadDraft,
              });
              setSubmitOpen(true);
            }}
            isCompleted={isCurrentCompleted}
            isTutorClosed={isTutorForceCompleted}
            hasNextTask={Boolean(nextTaskId)}
            onNavigateNext={() => navigateAfterCorrect()}
            subject={data.assignment.subject}
          />
        ) : null}
      </aside>

      {/* Right column wrapper — chat thread + composer.
          On mobile (single column): everything below (topbar + peek ProblemContext
          + chat + composer) renders in document flow. On tablet/desktop:
          grid places this section in col-start-2 next to the aside.

          `onFocusCapture` tracks the last-focused <input>/<textarea> so the
          `MathQuickPicker` can target the right element for cursor insertion. */}
      <section
        className="flex flex-col w-full min-h-0 md:overflow-hidden"
        onFocusCapture={handleInputFocus}
      >
        {/* Mobile-only topbar — hidden at md+ (left aside has its own).
            Preview-QA #3 fix 2026-05-10: back → /homework (route exists
            on StudentHomework.tsx); /student/homework is 404. */}
        <header className="md:hidden flex items-center gap-2 px-3 py-2 bg-white border-b border-socrat-border-light shrink-0">
          <button
            type="button"
            onClick={() => navigate('/homework')}
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

        {/* Mobile-only Problem context peek/expanded — hidden at md+
            (left aside renders an always-expanded copy). */}
        {problemContextTask ? (
          <div className="md:hidden px-3 pt-3 shrink-0">
            <ProblemContext
              task={problemContextTask}
              collapsed={contextCollapsed}
              onToggle={() => setContextCollapsed((v) => !v)}
              compact
              assignmentId={data.assignment.id}
              onStepClick={handleStepClick}
              subject={data.assignment.subject}
            />
          </div>
        ) : null}

      {/* Chat thread — flex-1 with scroll */}
      <div
        ref={chatScrollRef}
        className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3 px-3.5 pt-2 pb-3.5 xl:max-w-3xl xl:mx-auto xl:w-full [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
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
            {messages.map((m) => {
              // U2 typing-dots sentinel: messages with content='__typing__'
              // render as a Сократ-branded bubble with TypingDots instead
              // of the literal text. Used by hint flow + (future) chat
              // pre-stream interlude. Layout mirrors GuidedChatMessage
              // assistant variant: avatar (sokrat-chat-icon) + kicker
              // «СОКРАТ» + muted bubble.
              if (m.role === 'assistant' && m.content === '__typing__') {
                return (
                  <div key={m.id} className="flex items-start gap-2">
                    <img
                      src={sokratChatIcon}
                      alt=""
                      aria-hidden="true"
                      loading="lazy"
                      className="h-9 w-9 rounded-full shrink-0 border border-socrat-border-light bg-white"
                    />
                    <div className="flex flex-col gap-1 min-w-0">
                      <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-socrat-primary">
                        Сократ AI
                      </span>
                      <div className="bg-socrat-primary-light/60 border border-socrat-primary/15 rounded-[14px] rounded-tl-md px-3.5 py-2.5 max-w-[86%]">
                        <TypingDots />
                      </div>
                    </div>
                  </div>
                );
              }
              // voice-speaking-mvp [P0]: render a speaking submission's content
              // as the transcript under a «Распознанная речь» label (мост
              // доверия — что AI услышал), NOT as a raw user bubble.
              if (isSpeaking && m.role === 'user' && m.message_kind === 'submission') {
                return (
                  <div key={m.id ?? `speaking-${m.created_at}`} className="flex flex-col gap-1">
                    <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-socrat-muted">
                      Распознанная речь
                    </span>
                    <div className="rounded-[14px] border border-socrat-border-light bg-socrat-surface px-3.5 py-2.5 text-sm text-slate-800 whitespace-pre-wrap break-words">
                      {m.content}
                    </div>
                  </div>
                );
              }
              return (
                <GuidedChatMessage
                  key={m.id ?? `${m.role}-${m.created_at}`}
                  message={m}
                  perspective="student"
                  tutorDisplayName={tutorProfile?.display_name}
                  tutorAvatarUrl={tutorProfile?.avatar_url}
                  tutorGender={tutorProfile?.gender}
                  subject={data.assignment.subject}
                />
              );
            })}
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
                subject={data.assignment.subject}
              />
            ) : isStreaming ? (
              // Pre-stream interlude (between request fire and first delta):
              // show typing dots to telegraph «AI думает». Otherwise
              // there's a 1-2s blank gap with no feedback.
              <div className="flex items-start gap-2">
                <img
                  src={sokratChatIcon}
                  alt=""
                  aria-hidden="true"
                  loading="lazy"
                  className="h-9 w-9 rounded-full shrink-0 border border-socrat-border-light bg-white"
                />
                <div className="flex flex-col gap-1 min-w-0">
                  <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-socrat-primary">
                    Сократ AI
                  </span>
                  <div className="bg-socrat-primary-light/60 border border-socrat-primary/15 rounded-[14px] rounded-tl-md px-3.5 py-2.5 max-w-[86%]">
                    <TypingDots />
                  </div>
                </div>
              </div>
            ) : null}
          </>
        )}
        {/* Voice-Speaking MVP TASK-4 (2026-05-27): per-criterion breakdown
            for language subjects. Rendered when `ai_criteria_json` is
            populated server-side (DELF / ЕГЭ EN / IELTS / ОГЭ; письмо +
            монолог). Lives inside the chat scroll container so it follows
            the conversation flow — last bubble → разбор → итог. NULL/empty
            on physics/maths/chemistry/other (renders nothing). */}
        {/* voice-speaking-mvp [P1]: two-phase progress after a voice submit —
            «Распознаю речь… → Проверяю по критериям…» (not a frozen spinner). */}
        {speakingPhase ? (
          <div className="flex items-start gap-2">
            <img
              src={sokratChatIcon}
              alt=""
              aria-hidden="true"
              loading="lazy"
              className="h-9 w-9 rounded-full shrink-0 border border-socrat-border-light bg-white"
            />
            <div className="flex flex-col gap-1 min-w-0">
              <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-socrat-primary">
                Сократ AI
              </span>
              <div className="bg-socrat-primary-light/60 border border-socrat-primary/15 rounded-[14px] rounded-tl-md px-3.5 py-2.5 max-w-[86%] flex items-center gap-2">
                <span className="text-sm text-slate-700" aria-live="polite">
                  {speakingPhase === 'transcribing' ? 'Распознаю речь…' : 'Проверяю по критериям…'}
                </span>
                <TypingDots />
              </div>
            </div>
          </div>
        ) : null}
        {/* Voice-Speaking MVP TASK-4 (2026-05-27): per-criterion breakdown. */}
        {Array.isArray(currentTaskState?.ai_criteria_json) &&
        currentTaskState!.ai_criteria_json!.length > 0 ? (
          <CriteriaBreakdownTable
            criteria={currentTaskState!.ai_criteria_json as CriteriaBreakdownItem[]}
          />
        ) : null}
      </div>

      {/* Hidden file input для discussion attachment.
          Preview-QA #9 (2026-05-11) fix: input был mounted ТОЛЬКО внутри
          extended/proof composer branch. Для numeric task'и paperclip
          в NumericAnswerComposer тапался, но fileInputRef.current был
          undefined → no-op. Выносим input ВЫШЕ conditional чтобы он был
          mounted всегда — ref активен для обеих веток composer. */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.pdf"
        className="hidden"
        onChange={(e) => handleFileSelected(e.target.files?.[0])}
      />

      {/* Composer — branches by task_kind (Phase 1.3, preview-QA #8
          2026-05-11):
            - 'numeric' → inline NumericAnswerComposer (green answer
              field + collapsible discussion). Большая «Сдать решение
              задачи» CTA удалена для numeric — inline answer = formal
              submission через checkAnswer API.
            - 'extended' / 'proof' → existing big-CTA composer (открывает
              SubmitSheet для photo + numeric + text + voice).
       */}
      {/* Tablet/desktop chip-row — Подсказка (extended/proof) + Σ Формула.
          Hidden on mobile (mobile composer has its own inline hint/mic
          group). The math button is supplied as a slot so MathQuickPicker
          can use it as the popover anchor (cursor position preserved). */}
      {/* voice-speaking-mvp: speaking has no hint/math chips — one primary CTA. */}
      {!isSpeaking ? (
      <ChatChipRow
        className="hidden md:flex"
        hintCount={hintCount}
        isRequestingHint={isRequestingHint}
        disabled={isStreaming || isCurrentCompleted}
        onHintClick={handleHintClick}
        showHint={data.task.task_kind !== 'numeric'}
        mathSlot={
          <MathQuickPicker
            open={mathPickerOpen}
            onOpenChange={setMathPickerOpen}
            insertAtCursor={insertMathSnippet}
            trigger={
              <button
                type="button"
                disabled={isStreaming || isCurrentCompleted}
                aria-label="Открыть набор математических символов"
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full bg-slate-50 border border-socrat-border-light text-slate-700 text-sm font-semibold hover:bg-slate-100 hover:border-socrat-border touch-manipulation transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Sigma className="h-[14px] w-[14px]" aria-hidden="true" />
                <span>Формула</span>
              </button>
            }
          />
        }
      />
      ) : null}

      {data.task.task_kind === 'numeric' ? (
        <NumericAnswerComposer
          answerDraft={answerDraft}
          onAnswerDraftChange={setAnswerDraft}
          onSendAnswer={handleInlineAnswerSubmit}
          discussionDraft={chatDraft}
          onDiscussionDraftChange={setChatDraft}
          onSendDiscussion={handleChatSend}
          onHintClick={handleHintClick}
          isRequestingHint={isRequestingHint}
          onMicClick={handleMicClick}
          micRecording={recorder.isRecording}
          micDurationSec={recorder.recordingDurationSeconds}
          micSupported={recorder.isSupported}
          isTranscribing={isTranscribing}
          onPaperclipClick={() => fileInputRef.current?.click()}
          attachmentRefs={attachmentRefs}
          onRemoveAttachment={(ref) =>
            setAttachmentRefs((prev) => prev.filter((r) => r !== ref))
          }
          isUploadingAttachment={isUploadingAttachment}
          isStreaming={isStreaming}
          isAnswerSubmitting={isInlineAnswerSubmitting}
          isCurrentCompleted={isCurrentCompleted}
          hasNextTask={Boolean(nextTaskId)}
          onNavigateNext={() => navigateAfterCorrect()}
          hideDiscussion={isTabletPlus}
        />
      ) : null}

      {/* Chat composer row (paperclip + textarea + mic + send).
          Phase 3 codex re-review fix (2026-05-12): rendered for:
            - Mobile: only extended/proof (numeric uses NumericAnswerComposer's
              own 3-row layout including discussion field at the bottom).
            - Tablet/desktop: ALL task_kinds. On numeric task_kind
              `NumericAnswerComposer.hideDiscussion=true` strips its Row 2/3 —
              this composer row replaces the discussion entry point so the
              student can still ask AI a free-form question on numeric tasks.
          The big-CTA «Сдать решение задачи» button below is mobile-only and
          extended/proof-only (numeric submits via inline answer; tablet+
          uses SubmitCtaBar in the left aside). */}
      {(!isSpeaking && (data.task.task_kind !== 'numeric' || isTabletPlus)) ? (
      <div className="flex flex-col gap-2 bg-white border-t border-socrat-border-light px-2.5 pt-2 pb-2.5 shrink-0">
        {/* Primary CTA — mobile-only AND extended/proof-only.
            - Tablet/desktop: SubmitCtaBar in the left aside owns it
              (one-primary-CTA-per-screen invariant).
            - Numeric tablet/desktop: this composer row renders for chat
              discussion, but submission happens via inline answer field
              above — no big CTA needed in either case. */}
        {data.task.task_kind !== 'numeric' ? (
        <button
          type="button"
          onClick={() => {
            if (isCurrentCompleted) {
              navigateAfterCorrect();
              return;
            }
            // Preview-QA #10 (2026-05-11) codex review #7 fix: real
            // hadDraft instead of hardcoded false. Reads localStorage
            // directly (cheap) — autosave-aware retention signal.
            const draftKey = getSubmitSheetDraftKey(taskId ?? data.task.id);
            const hadDraft =
              typeof window !== 'undefined' &&
              Boolean(window.localStorage.getItem(draftKey));
            trackGuidedHomeworkEvent('student_submitsheet_opened', {
              assignmentId: data.assignment.id,
              taskId: data.task.id,
              hadDraft,
            });
            setSubmitOpen(true);
          }}
          className="md:hidden flex items-center gap-2.5 w-full px-3 py-2.5 bg-socrat-primary hover:bg-socrat-primary-dark text-white rounded-[14px] text-left transition-colors touch-manipulation"
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
              {isCurrentCompleted
                ? isTutorForceCompleted
                  ? 'Закрыто репетитором'
                  : 'Задача сдана'
                : isHumanitiesWritingSubject(data.assignment.subject)
                  ? 'Текст или фото готового решения'
                  : 'Ответ + фото решения от руки'}
            </span>
          </span>
        </button>
        ) : null}

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

        {/* Chat row — paperclip + input + hint/mic group + send.
            NB: hidden file input живёт выше conditional (preview-QA #9),
            оба composer'а используют один и тот же fileInputRef. */}
        <div className="flex items-center gap-1">
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

          {/* Hint + Mic expandable group (B1).
              Default collapsed: shows 💡 (Lightbulb). Tap → expand to
              [💡, 🎤] horizontal pair. Tap inside expanded:
                - 💡 → requestHint API (hint_reply bubble lands in chat)
                - 🎤 → startRecording (during recording stays expanded
                       with MicOff icon for stop). After both actions
                       group collapses back.

              Phase 3 (2026-05-12): on tablet/desktop (`md+`) the hint
              button is hidden — it's already in the chip-row above the
              composer. We also force expanded mode so the mic button
              is always visible (collapsed standalone hint is hidden). */}
          {micHintExpanded || recorder.isRecording || isTabletPlus ? (
            <>
              <button
                type="button"
                aria-label="Запросить подсказку"
                disabled={
                  isStreaming ||
                  isTranscribing ||
                  isRequestingHint ||
                  isCurrentCompleted ||
                  recorder.isRecording
                }
                onClick={handleHintClick}
                className="md:hidden grid place-items-center w-9 h-10 rounded-[10px] text-amber-600 hover:bg-amber-50 hover:text-amber-700 shrink-0 touch-manipulation transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isRequestingHint ? (
                  <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden="true" />
                ) : (
                  <Lightbulb className="h-[18px] w-[18px]" aria-hidden="true" />
                )}
              </button>
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
            </>
          ) : (
            <button
              type="button"
              aria-label="Подсказка или голос"
              aria-expanded={false}
              disabled={isStreaming || isTranscribing}
              onClick={() => setMicHintExpanded(true)}
              className="md:hidden grid place-items-center w-9 h-10 rounded-[10px] text-amber-600 hover:bg-amber-50 hover:text-amber-700 shrink-0 touch-manipulation transition-colors disabled:opacity-50"
            >
              <Lightbulb className="h-[18px] w-[18px]" aria-hidden="true" />
            </button>
          )}

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
      ) : null}

      {/* voice-speaking-mvp: устный монолог — рекордер + playback + submit.
          Sole composer for speaking (chat/numeric/chip-row/SubmitCtaBar
          suppressed above). One primary CTA. */}
      {isSpeaking ? (
        <SpeakingComposer
          isSubmitting={speakingPhase !== null}
          isCompleted={isCurrentCompleted}
          isTutorClosed={isTutorForceCompleted}
          hasNextTask={Boolean(nextTaskId)}
          onNavigateNext={() => navigateAfterCorrect()}
          onSubmit={handleSpeakingSubmit}
        />
      ) : null}

      </section>

      <SubmitSheet
        open={submitOpen}
        onClose={() => setSubmitOpen(false)}
        hwId={hwId ?? data.assignment.id}
        taskId={taskId ?? data.task.id}
        threadId={threadId}
        task={{
          id: data.task.id,
          order_num: data.task.order_num,
          task_total: data.task_total,
          max_score: data.task.max_score,
          // SubmitSheet doesn't handle 'speaking' (uses SpeakingComposer) and is
          // never opened for it — narrow to a valid SubmitSheetTaskKind.
          task_kind: data.task.task_kind === 'speaking' ? 'extended' : data.task.task_kind,
          homework_title: data.assignment.title,
          current_score: liveScore,
        }}
        subject={data.assignment.subject}
        onSubmit={handleSubmissionSubmit}
      />
    </div>
  );
}
