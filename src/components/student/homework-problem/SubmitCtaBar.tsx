import { ArrowRight, CheckCircle2, ChevronUp } from 'lucide-react';
import { isHumanitiesWritingSubject } from '@/lib/subjectHelpers';

interface SubmitCtaBarProps {
  /** Tap → open SubmitSheet. */
  onOpen: () => void;
  /** If true, button becomes «Следующая задача» secondary action. */
  isCompleted: boolean;
  /**
   * 2026-05-16 (lexical-brewing-gadget): задача закрыта вручную репетитором,
   * а не AI-CORRECT verdict'ом. Меняет text-signal на «Закрыто репетитором».
   * Default false для backward-compat с callsites, не передающими этот prop.
   */
  isTutorClosed?: boolean;
  /**
   * R1 (2026-06-02): репетитор подтвердил задачу («проверено»). Приоритет над
   * isTutorClosed в completed-subtitle. Default false для backward-compat.
   */
  isReviewed?: boolean;
  /** Whether there is a next task to navigate to when completed. */
  hasNextTask: boolean;
  /** Tap when isCompleted → advance to next task (or back to list). */
  onNavigateNext: () => void;
  /**
   * Optional draft hint copy («Черновик · 3 элемента») shown under the
   * primary label. Phase 3: backend doesn't expose draft state to this
   * surface yet — pass `undefined` for clean state. Wiring deferred.
   */
  draftLabel?: string | null;
  /**
   * Subject id — switches subtitle to «Текст или фото готового решения»
   * для humanities-writing предметов (письмо / эссе / сочинение).
   */
  subject?: string | null;
}

/**
 * Sticky bottom CTA bar inside the left aside on tablet/desktop.
 *
 * Phase 3 (2026-05-12): primary entry to `SubmitSheet` for
 * `task_kind ∈ {'extended', 'proof'}`. **Single primary CTA per screen** —
 * chip-row on the right column does NOT duplicate this button (one-primary
 * invariant from Round 2 walkthrough).
 *
 * Rendered ONLY when `task_kind !== 'numeric'` (numeric tasks have inline
 * `NumericAnswerComposer` answer field in the right column instead). The
 * parent (`HomeworkProblem.tsx`) controls visibility via a guard before
 * mounting this component.
 *
 * Visual ref: `docs/design_handoff_homework_chat/README.md` §Layout 2
 * SubmitCTA — `bg --sokrat-card, border-top, padding 14px 18px`, dual-line
 * label («Готов сдать решение?» + draft sub) + large green primary button.
 */
export function SubmitCtaBar({
  onOpen,
  isCompleted,
  isTutorClosed = false,
  isReviewed = false,
  hasNextTask,
  onNavigateNext,
  draftLabel,
  subject = null,
}: SubmitCtaBarProps) {
  const defaultSubtitle = isHumanitiesWritingSubject(subject)
    ? 'Текст или фото готового решения'
    : 'Ответ + фото решения от руки';
  if (isCompleted) {
    return (
      <div className="flex items-center justify-between gap-3 px-4 py-3 bg-white border-t border-socrat-border-light shrink-0">
        <div className="flex flex-col min-w-0 flex-1">
          <span className="text-[14px] font-bold text-slate-900 leading-tight">
            {isReviewed ? 'Проверено репетитором' : isTutorClosed ? 'Закрыто репетитором' : 'Задача сдана'}
          </span>
          <span className="text-[12px] font-medium text-slate-500 truncate">
            {hasNextTask ? 'Переходи к следующей' : 'Все задачи решены'}
          </span>
        </div>
        <button
          type="button"
          onClick={onNavigateNext}
          aria-label={hasNextTask ? 'Следующая задача' : 'Назад к ДЗ'}
          className="inline-flex items-center gap-2 h-12 px-5 rounded-xl bg-socrat-primary hover:bg-socrat-primary-dark text-white text-sm font-bold touch-manipulation transition-colors shrink-0 shadow-[0_4px_14px_rgba(27,107,74,0.25)]"
        >
          <ArrowRight className="h-[18px] w-[18px] stroke-[2]" aria-hidden="true" />
          <span>{hasNextTask ? 'Следующая' : 'К ДЗ'}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 bg-white border-t border-socrat-border-light shrink-0">
      <div className="flex flex-col min-w-0 flex-1">
        <span className="text-[14px] font-bold text-slate-900 leading-tight">
          Готов сдать решение?
        </span>
        <span className="text-[12px] font-medium text-slate-500 truncate">
          {draftLabel ?? defaultSubtitle}
        </span>
      </div>
      <button
        type="button"
        onClick={onOpen}
        aria-label="Сдать решение задачи"
        className="inline-flex items-center gap-2 h-12 px-5 rounded-xl bg-socrat-primary hover:bg-socrat-primary-dark text-white text-sm font-bold touch-manipulation transition-colors shrink-0 shadow-[0_4px_14px_rgba(27,107,74,0.25)]"
      >
        <CheckCircle2 className="h-[18px] w-[18px] stroke-[2]" aria-hidden="true" />
        <span>Сдать решение</span>
        <ChevronUp className="h-[14px] w-[14px]" aria-hidden="true" />
      </button>
    </div>
  );
}
