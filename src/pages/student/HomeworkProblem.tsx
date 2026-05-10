import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, Loader2, RefreshCw } from 'lucide-react';
import { ProblemContext, type ProblemContextTask } from '@/components/student/homework-problem/ProblemContext';
import { ProblemChatMessage, type ProblemChatMessageData } from '@/components/student/homework-problem/ProblemChatMessage';
import { ComposerMobile } from '@/components/student/homework-problem/ComposerMobile';
import { SubmitSheet } from '@/components/student/homework-problem/SubmitSheet';
import { useStudentProblemTask } from '@/hooks/useStudentProblemTask';
import { trackGuidedHomeworkEvent } from '@/lib/homeworkTelemetry';
import { getSubjectLabel } from '@/types/homework';
import type {
  HomeworkThreadMessage,
  HomeworkTaskState,
  CheckAnswerResponse,
} from '@/types/homework';

/**
 * Student homework-problem screen — Phase 1 (mobile + chat + ProblemContext).
 *
 * Дизайн: `docs/design_handoff_homework_chat/README.md`
 * Spec: `docs/delivery/features/student-homework-problem-screen/spec.md`
 *
 * **Scope (Phase 1):**
 * - Layout 1 — mobile (<=768px). Tablet (Layout 2) и Desktop (Layout 3) —
 *   Phase 3 separately.
 * - Topbar (back arrow + eyebrow + title)
 * - ProblemContext (peek by default when there are messages, expanded when
 *   the thread is empty — per AC-4)
 * - ChatThread (mapped from `homework_tutor_thread_messages`)
 * - ComposerMobile (primary CTA flips to «Следующая задача →» after
 *   the current task's task_state.status === 'completed' — AC-7)
 * - SubmitSheet — single-shot submission with PhotoStrip + numeric/text
 *   inputs + VerdictOverlay (z-stack inside the sheet body)
 *
 * **Coexistence:** этот экран на route
 * `/student/homework/:hwId/problem/:taskId`. Существующий
 * `GuidedHomeworkWorkspace` на `/homework/:id` остаётся production-flow для
 * не-mobile viewport'ов; redirect лежит в `StudentHomeworkDetail` через
 * `useIsMobile()` (TASK-8).
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

  const {
    data,
    isPending,
    isError,
    error,
    refetch,
    isFetching,
  } = useStudentProblemTask(hwId, taskId);

  // Map raw thread messages → ProblemChatMessageData[].
  // - **Filter by current task** via `task_id` (canonical match per
  //   `.claude/rules/40-homework-system.md` § «Task identity»). Codex
  //   finding #2: rendering all assignment messages bled sibling-task
  //   conversations into the current task view, breaking AC-4 + S1 UX.
  //   Fallback for legacy pre-2026-04-10 messages with `task_id IS NULL`:
  //   match by `task_order === data.task.order_num`. New writes always
  //   carry `task_id` (migration `20260410153000`).
  // - `visible_to_student=false` messages filtered (tutor-only notes).
  // - `assistant`/`tutor` roles map to AI-styled bubbles with «Сократ» kicker
  //   (Phase 1: tutor messages are rare in student-side thread; we render
  //   them as AI to avoid an extra branch — Phase 2 may differentiate).
  const messages = useMemo<ProblemChatMessageData[]>(() => {
    const raw = data?.thread?.homework_tutor_thread_messages ?? [];
    const currentTaskId = data?.task.id;
    const currentTaskOrder = data?.task.order_num;
    return raw
      .filter((m: HomeworkThreadMessage) => m.visible_to_student !== false)
      .filter((m: HomeworkThreadMessage) => {
        if (!currentTaskId) return true;
        if (m.task_id) return m.task_id === currentTaskId;
        // Legacy fallback for messages persisted before task_id existed.
        return m.task_order != null && m.task_order === currentTaskOrder;
      })
      .map((m: HomeworkThreadMessage): ProblemChatMessageData => {
        const who: ProblemChatMessageData['who'] =
          m.role === 'user'
            ? 'user'
            : m.role === 'system'
              ? 'system'
              : 'ai';
        return {
          id: m.id,
          who,
          text: m.content,
          kicker: who === 'ai' ? 'Сократ' : undefined,
          created_at: m.created_at,
        };
      });
  }, [data?.thread?.homework_tutor_thread_messages, data?.task.id, data?.task.order_num]);

  // Default-collapsed logic: peek when there are messages, expanded when
  // the thread is empty (AC-4). One-shot init — user manual toggles win
  // over data updates afterwards. Reset key includes `taskId` so navigating
  // to a sibling task re-evaluates the default for the new thread.
  const initialCollapsed = messages.length > 0;
  const [contextCollapsed, setContextCollapsed] = useState(initialCollapsed);
  const lastInitTaskKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const key = `${hwId ?? ''}:${taskId ?? ''}`;
    if (lastInitTaskKeyRef.current === key) return;
    if (data == null) return;
    lastInitTaskKeyRef.current = key;
    setContextCollapsed(messages.length > 0);
  }, [data, hwId, taskId, messages.length]);

  const [chatDraft, setChatDraft] = useState('');
  const [submitOpen, setSubmitOpen] = useState(false);

  // Auto-scroll to bottom on new messages.
  const chatScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  // ─── Telemetry: student_problem_screen_opened ─────────────────────────────
  // Fire once per (hwId, taskId, taskKind) tuple — guarded by a useRef
  // sentinel so React Query refetches don't multiply emissions. Re-emits
  // only when the user navigates to a different task.
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

  /**
   * Phase 1 narrowed to submit-only — chat row is hidden via
   * `<ComposerMobile chatDisabled />`. This handler stays as a no-op so the
   * `ComposerMobile` props contract doesn't need a conditional type, and
   * Phase 2 just flips the flag + replaces this body with real
   * `saveThreadMessage` + streamed Сократ response. Codex re-review #1
   * (chat path scope) + #6 (no-op affordances).
   */
  const handleChatSend = () => {
    /* no-op until Phase 2 — chat row hidden */
  };

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
        navigate('/');
        return;
      }
      if (target) {
        navigate(`/student/homework/${hwId}/problem/${target}`);
      } else {
        navigate(`/homework/${hwId}`);
      }
    },
    [hwId, navigate, nextTaskId],
  );

  // ─── ProblemContext task adapter ──────────────────────────────────────────
  // Maps `StudentProblemResponse` → `ProblemContextTask`. Phase 1 backend
  // returns raw `task_text` only; structured `given`/`find`/`question` are
  // not parsed yet (spec §5 marks them "parsed при наличии"). Component
  // hides those blocks when missing.
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
      done_task_indices: doneIndices,
    };
  }, [data, taskStates]);

  // ─── Loading state ────────────────────────────────────────────────────────
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

  // ─── Error state with retry ──────────────────────────────────────────────
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

  // ─── Main render ──────────────────────────────────────────────────────────
  return (
    <div className="flex h-[100dvh] w-full flex-col bg-socrat-surface">
      {/* Topbar (mobile) */}
      <header className="flex items-center gap-2 px-3 py-2 bg-white border-b border-socrat-border-light shrink-0">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Назад"
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

      {/* Problem context (peek/expanded) */}
      {problemContextTask ? (
        <div className="px-3 pt-3 shrink-0">
          <ProblemContext
            task={problemContextTask}
            collapsed={contextCollapsed}
            onToggle={() => setContextCollapsed((v) => !v)}
            compact
          />
        </div>
      ) : null}

      {/* Chat thread — flex-1 with scroll. Empty state surfaces a system
          divider per AC-4 («Задача с пустым thread → только system divider,
          ученик начинает диалог»). The divider acts as scaffolding — the
          student knows the thread exists and will fill in once they submit
          or (Phase 2) chat with Сократ. Codex finding #4. */}
      <div
        ref={chatScrollRef}
        className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3 px-3.5 pt-2 pb-3.5 [-webkit-overflow-scrolling:touch] [&::-webkit-scrollbar]:hidden"
      >
        {messages.length === 0 ? (
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
          messages.map((m) => <ProblemChatMessage key={m.id} message={m} />)
        )}
      </div>

      {/* Sticky composer — flips to «Следующая задача →» CTA after CORRECT (AC-7).
          Phase 1 narrowing: chat row hidden via `chatDisabled`. The student
          interacts only through the primary CTA + SubmitSheet (codex re-
          review #1). Phase 2 will flip `chatDisabled={false}` once the
          Сократический dialog wires to `saveThreadMessage` + `/chat` SSE. */}
      <ComposerMobile
        chatDisabled
        draft={chatDraft}
        onDraftChange={setChatDraft}
        onChatSend={handleChatSend}
        onOpenSubmit={() => {
          trackGuidedHomeworkEvent('student_submitsheet_opened', {
            assignmentId: data.assignment.id,
            taskId: data.task.id,
            hadDraft: false, // Phase 2: real draft restore.
          });
          setSubmitOpen(true);
        }}
        draftCount={0}
        completedAction={
          isCurrentCompleted
            ? {
                label: nextTaskId ? 'Следующая задача' : 'Назад к ДЗ',
                subtitle: nextTaskId ? 'Задача сдана' : 'Все задачи решены',
                onClick: () => navigateAfterCorrect(),
              }
            : null
        }
      />

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
          // CORRECT → navigate to the task identified by the response
          // payload (preferred — backend already knows which sibling task
          // is unlocked next) OR our local `nextTaskId` derivation as
          // fallback (e.g. if the response shape evolves). Otherwise stay:
          // useSubmitSolution already invalidated the targeted query so
          // the surrounding hook will refetch the updated thread, the
          // new AI message lands in the chat, and `isCurrentCompleted`
          // will flip — composer then shows the «Следующая задача →» CTA.
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
