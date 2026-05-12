import { Lightbulb, Loader2 } from 'lucide-react';

interface ChatChipRowProps {
  /** Hint counter — when `> 0` shown as a number next to the bulb. */
  hintCount: number;
  isRequestingHint: boolean;
  /** Disabled state — when task already completed or AI streaming. */
  disabled?: boolean;
  onHintClick: () => void;
  /**
   * Math keyboard slot — parent supplies the actual button (typically a
   * `MathQuickPicker` trigger that anchors a Radix Popover). When `null`
   * or omitted, nothing renders. Wiring this as a slot (not an onClick
   * handler) lets the Popover use the button as its anchor for
   * positioning.
   */
  mathSlot?: React.ReactNode;
  /**
   * Whether to render the «Подсказка» chip. Default `true` for
   * extended/proof tasks. For `task_kind='numeric'` the parent passes
   * `false` — hint is already inline in `NumericAnswerComposer` row 1
   * (next to the answer field) and a chip-row duplicate would be noisy.
   */
  showHint?: boolean;
  className?: string;
}

/**
 * Secondary-action chip row above the chat composer on tablet + desktop.
 *
 * Phase 3 (2026-05-12): renders **only** `Подсказка` + `Σ Формула`. По
 * walkthrough решениям с Vladimir:
 *   - `«Не понял»` chip удалён — не реализуется в Phase 3.
 *   - `«Сдать решение»` primary CTA живёт в `SubmitCtaBar` левой колонки —
 *     не дублируем здесь (one-primary-CTA-per-screen invariant).
 *   - Hint cap UI — no cap (Phase 1 B5 invariant). Counter показывается
 *     просто как число, без `1/3`.
 *
 * Mobile (`<md`) НЕ рендерит этот компонент — в `HomeworkProblem.tsx`
 * блок обёрнут в `hidden md:flex`, и компактный hint находится в
 * `NumericAnswerComposer` или mobile composer footer.
 *
 * Дизайн ref: `docs/design_handoff_homework_chat/README.md` §Layout 2/3.
 */
export function ChatChipRow({
  hintCount,
  isRequestingHint,
  disabled = false,
  onHintClick,
  mathSlot,
  showHint = true,
  className = '',
}: ChatChipRowProps) {
  const hintDisabled = disabled || isRequestingHint;

  return (
    <div
      className={`flex items-center gap-2 px-4 py-2 border-t border-socrat-border-light bg-white shrink-0 ${className}`}
      role="toolbar"
      aria-label="Действия в чате"
    >
      {showHint ? (
        <button
          type="button"
          onClick={onHintClick}
          disabled={hintDisabled}
          aria-label={hintCount > 0 ? `Подсказка (запрошено: ${hintCount})` : 'Запросить подсказку'}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-sm font-semibold hover:bg-amber-100 hover:border-amber-300 touch-manipulation transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isRequestingHint ? (
            <Loader2 className="h-[14px] w-[14px] animate-spin" aria-hidden="true" />
          ) : (
            <Lightbulb className="h-[14px] w-[14px]" aria-hidden="true" />
          )}
          <span>Подсказка</span>
          {hintCount > 0 ? (
            <span className="tabular-nums text-xs font-bold text-amber-900">{hintCount}</span>
          ) : null}
        </button>
      ) : null}

      {mathSlot}
    </div>
  );
}
