import { ArrowRight, ArrowUp, CheckCircle2, ChevronUp, Mic, Paperclip } from 'lucide-react';

interface ComposerMobileProps {
  draft: string;
  onDraftChange: (value: string) => void;
  onChatSend: () => void;
  onOpenSubmit: () => void;
  /** Total non-empty fields in the SubmitSheet draft (numeric, photos, text, voice). */
  draftCount: number;
  /**
   * When the current task is already `completed`, the primary CTA flips from
   * «Сдать решение задачи» (opens SubmitSheet) to a navigation-style action
   * driven by this prop — typically «Следующая задача →» or «Завершить ДЗ».
   *
   * Per spec AC-7: после CORRECT primary CTA должна меняться + клик на CTA
   * после completion переводит на следующую задачу или назад к ДЗ. Passing
   * `null`/`undefined` keeps the default submission CTA.
   */
  completedAction?: {
    label: string;
    subtitle?: string;
    onClick: () => void;
  } | null;
  /**
   * Phase 1 scope narrowing (codex re-review #1 + #6, 2026-05-09): hide the
   * chat row entirely when `true`. Until the Сократический dialog is wired
   * to `saveThreadMessage` + `/chat` SSE in Phase 2, exposing a live-looking
   * chat composer + paperclip/mic no-ops invites students into a non-working
   * path. Default `false` so future Phase-2 callers (or desktop split layout)
   * get the chat row back without a flag flip.
   *
   * Spec scope decision recorded in
   * `docs/delivery/features/student-homework-problem-screen/spec.md` §3 + §AC-4.
   */
  chatDisabled?: boolean;
}

/**
 * Sticky bottom composer for the mobile homework problem screen.
 * Two-row layout per design handoff `ComposerMobile`:
 *
 * 1. **Primary CTA «Сдать решение задачи»** — large green button. Opens
 *    `SubmitSheetStub` (Phase 1) / real `SubmitSheet` (Phase 2). Subtitle
 *    flips between «Ответ + фото решения от руки» and «Черновик · N эл.»
 *    when the student has saved drafts.
 * 2. **Chat row** — paperclip + textarea-like input + mic + send arrow.
 *    For asking Сократ about the step (NOT a submission — those messages
 *    never affect the score).
 *
 * Phase 1 stubs (paperclip / mic / send) wire to a no-op or simple
 * `onChatSend` of typed text. Photo upload + voice recorder are Phase 2.
 */
export function ComposerMobile({
  draft,
  onDraftChange,
  onChatSend,
  onOpenSubmit,
  draftCount,
  completedAction,
  chatDisabled = false,
}: ComposerMobileProps) {
  const subtitle =
    draftCount > 0
      ? `Черновик · ${draftCount} ${
          draftCount === 1 ? 'элемент' : draftCount < 5 ? 'элемента' : 'элементов'
        }`
      : 'Ответ + фото решения от руки';

  const canSend = draft.trim().length > 0;

  // Completed-task CTA short-circuits both label and onClick. Icon flips to
  // ArrowRight to telegraph navigation; the trailing chevron-up disappears
  // since the bottom-sheet metaphor no longer applies.
  const isCompleted = Boolean(completedAction);
  const ctaLabel = completedAction?.label ?? 'Сдать решение задачи';
  const ctaSubtitle = completedAction?.subtitle ?? subtitle;
  const ctaOnClick = completedAction?.onClick ?? onOpenSubmit;

  return (
    <div className="flex flex-col gap-2 bg-white border-t border-socrat-border-light px-2.5 pt-2 pb-2.5 shrink-0">
      {/* Primary CTA — opens SubmitSheet (or navigates after CORRECT) */}
      <button
        type="button"
        onClick={ctaOnClick}
        className="flex items-center gap-2.5 w-full px-3 py-2.5 bg-socrat-primary hover:bg-socrat-primary-dark text-white rounded-[14px] text-left transition-colors touch-manipulation"
        aria-label={ctaLabel}
      >
        <span className="grid place-items-center w-7 h-7 rounded-full bg-white/20 shrink-0">
          {isCompleted ? (
            <ArrowRight className="h-[18px] w-[18px] stroke-2" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="h-[18px] w-[18px] stroke-2" aria-hidden="true" />
          )}
        </span>
        <span className="flex flex-col flex-1 min-w-0 gap-px">
          <span className="text-sm font-bold leading-tight">{ctaLabel}</span>
          <span className="text-[11px] font-medium text-white/80 truncate">
            {ctaSubtitle}
          </span>
        </span>
        {!isCompleted ? (
          <ChevronUp className="h-4 w-4 shrink-0 stroke-2" aria-hidden="true" />
        ) : null}
      </button>

      {/* Chat row — ask Сократ about the step.
          Phase 1 narrowed to submit-only (codex re-review #1 + #6,
          2026-05-09): the live chat composer was inviting students into a
          path that didn't actually persist or get answered. Until Phase 2
          wires this to `saveThreadMessage` + `/chat` SSE, hide the row
          entirely. Paperclip + mic + send are also gated by the same flag
          since they were no-op affordances that lacked any handler. */}
      {!chatDisabled ? (
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Прикрепить фото"
            className="grid place-items-center w-9 h-10 rounded-[10px] text-slate-500 hover:bg-socrat-surface hover:text-slate-900 shrink-0 touch-manipulation"
          >
            <Paperclip className="h-[18px] w-[18px]" aria-hidden="true" />
          </button>
          <input
            type="text"
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canSend) {
                e.preventDefault();
                onChatSend();
              }
            }}
            placeholder="Спроси Сократа о шаге…"
            className="flex-1 min-w-0 h-10 px-3.5 bg-socrat-surface border border-socrat-border rounded-[20px] text-sm text-slate-900 outline-none focus-visible:border-socrat-primary focus-visible:ring-2 focus-visible:ring-socrat-primary/20"
            aria-label="Сообщение Сократу"
            // text-base on iOS would be ideal — but design specifies 14px.
            // 14px causes auto-zoom on iOS Safari; we accept that trade-off
            // here since input is keyboard-driven (not focus-on-tap critical).
            // If real users complain about zoom, switch to `text-base`.
            style={{ fontSize: '16px' }}
          />
          <button
            type="button"
            aria-label="Голосом"
            className="grid place-items-center w-9 h-10 rounded-[10px] text-slate-500 hover:bg-socrat-surface hover:text-slate-900 shrink-0 touch-manipulation"
          >
            <Mic className="h-[18px] w-[18px]" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="Отправить"
            disabled={!canSend}
            onClick={onChatSend}
            className="grid place-items-center w-10 h-10 rounded-full bg-socrat-primary hover:bg-socrat-primary-dark disabled:opacity-50 disabled:cursor-not-allowed text-white shrink-0 touch-manipulation transition-colors"
          >
            <ArrowUp className="h-4 w-4 stroke-[2.5]" aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
