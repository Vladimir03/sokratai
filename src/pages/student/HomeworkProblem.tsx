import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { ProblemContext } from '@/components/student/homework-problem/ProblemContext';
import { ProblemChatMessage } from '@/components/student/homework-problem/ProblemChatMessage';
import { ComposerMobile } from '@/components/student/homework-problem/ComposerMobile';
import { SubmitSheetStub } from '@/components/student/homework-problem/SubmitSheetStub';
import { mockTask, mockChatThread } from './HomeworkProblem.fixtures';

/**
 * Student homework-problem screen — Phase 1 (mobile + chat + ProblemContext).
 *
 * Дизайн: `docs/design_handoff_homework_chat/README.md`
 * Mock data: `./HomeworkProblem.fixtures.ts`
 *
 * **Scope (Phase 1):**
 * - Layout 1 — mobile (<=768px). Tablet (Layout 2) и Desktop (Layout 3) —
 *   Phase 3 separately.
 * - Topbar (back arrow + eyebrow + title)
 * - ProblemContext (peek by default; expand toggles)
 * - ChatThread с типами сообщений: system / ai / user / typing
 * - ComposerMobile (primary CTA + chat input row)
 * - SubmitSheetStub — empty shell (Phase 2 заполнит реальным form'ом)
 *
 * **Не реализовано (Phase 2+):** реальная отправка решения, OCR/grading
 * pipeline, verdict overlays (correct / no-work / step-error / unclear),
 * автосохранение черновика, voice recorder, photo upload, hints ladder.
 *
 * **Coexistence:** этот экран на route
 * `/student/homework/:hwId/problem/:taskId`. Существующий
 * `GuidedHomeworkWorkspace` на `/homework/:id` остаётся production-flow —
 * этот screen для design-validation, не подключён к backend.
 */
export default function HomeworkProblem() {
  const { hwId, taskId } = useParams<{ hwId: string; taskId: string }>();
  const navigate = useNavigate();

  const [contextCollapsed, setContextCollapsed] = useState(true);
  const [chatDraft, setChatDraft] = useState('');
  const [submitOpen, setSubmitOpen] = useState(false);

  // Phase 1: fixture-based. Phase 2 — replace with React Query:
  // useQuery({ queryKey: ['student', 'homework', hwId, 'task', taskId], ... })
  // and useDraft + useChat hooks for live data.
  const task = mockTask;
  const messages = mockChatThread;

  // Stub draftCount — counts non-empty submission fields. Phase 2: real
  // value from `useDraft`. For now always 0 (no SubmitSheet form yet).
  const draftCount = 0;

  // Auto-scroll chat to bottom when new messages arrive. The composer is
  // sticky-bottom (flex-none), chat area is the flex-1 with overflow.
  const chatScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const eyebrow = useMemo(
    () => `Задача ${task.task_no} / ${task.task_total} · ${task.subject}`,
    [task.task_no, task.task_total, task.subject],
  );

  const handleChatSend = () => {
    if (!chatDraft.trim()) return;
    // Phase 2: POST to /chat endpoint, stream Сократ response via SSE.
    // For now — clear input. Mock-data won't update (deliberate: this
    // screen is for visual QA, not interactive testing).
    setChatDraft('');
  };

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
            {task.homework_title}
          </h1>
        </div>
        {/* No trailing buttons — design explicitly omits "..." menu. */}
      </header>

      {/* Problem context (peek/expanded) */}
      <div className="px-3 pt-3 shrink-0">
        <ProblemContext
          task={task}
          collapsed={contextCollapsed}
          onToggle={() => setContextCollapsed((v) => !v)}
          compact
        />
      </div>

      {/* Chat thread — flex-1 with scroll */}
      <div
        ref={chatScrollRef}
        className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-3 px-3.5 pt-2 pb-3.5 [-webkit-overflow-scrolling:touch] [&::-webkit-scrollbar]:hidden"
      >
        {messages.map((m) => (
          <ProblemChatMessage key={m.id} message={m} />
        ))}
      </div>

      {/* Sticky composer */}
      <ComposerMobile
        draft={chatDraft}
        onDraftChange={setChatDraft}
        onChatSend={handleChatSend}
        onOpenSubmit={() => setSubmitOpen(true)}
        draftCount={draftCount}
      />

      {/* SubmitSheet — Phase 1 stub */}
      <SubmitSheetStub
        open={submitOpen}
        onClose={() => setSubmitOpen(false)}
        taskNo={task.task_no}
        taskTotal={task.task_total}
        homeworkTitle={task.homework_title}
        taskScore={task.task_score}
        taskScoreMax={task.task_score_max}
      />

      {/* Phase 1 dev hint — visible only in dev/preview. The route
          parameters are echoed for tests. Removed before cutover. */}
      {import.meta.env.DEV ? (
        <span
          aria-hidden="true"
          className="fixed bottom-2 right-2 z-10 text-[10px] text-slate-400 pointer-events-none"
        >
          dev: hwId={hwId} · taskId={taskId}
        </span>
      ) : null}
    </div>
  );
}
