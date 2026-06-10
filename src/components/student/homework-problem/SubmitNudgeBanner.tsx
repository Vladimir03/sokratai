import { Send, Sparkles, X } from 'lucide-react';

interface SubmitNudgeBannerProps {
  /** Короткая фраза баннера, напр. «Похоже, это готовый ответ». */
  message: string;
  /** Primary action — маршрутизация в настоящий грейдинг. */
  primaryLabel: string;
  onPrimary: () => void;
  /** Secondary (ghost) — «просто обсудить/спросить», текущее поведение. */
  secondaryLabel: string;
  onSecondary: () => void;
  /** ✕ — то же, что secondary semantically (отказ от nudge). */
  onDismiss: () => void;
  /** Блокировка на время стрима/сабмита. */
  disabled?: boolean;
}

/**
 * Nudge-баннер «зачёт в один тап» (2026-06-10, graceful-stirring-treasure).
 *
 * Один компонент для трёх триггеров на student problem-screen:
 *  - клиентская эвристика «голый ответ» на numeric (pre-send intercept);
 *  - AI-маркер [[SUBMIT_CTA]] из guided /chat (финальный ответ/решение);
 *  - выбор намерения при прикреплении фото в обсуждение (extended/proof).
 *
 * Рендерится над композером. Amber = статусная семантика «требует внимания»
 * (waiver-семейство rule 90). Никакого авто-зачёта: primary лишь маршрутизирует
 * в нормальный checkAnswer / SubmitSheet → submitSolution.
 */
export function SubmitNudgeBanner({
  message,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
  onDismiss,
  disabled = false,
}: SubmitNudgeBannerProps) {
  return (
    <div
      role="status"
      className="flex flex-col gap-2 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-[14px] animate-in fade-in slide-in-from-bottom-2 duration-200"
    >
      <div className="flex items-start gap-2">
        <Sparkles className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
        <span className="flex-1 min-w-0 text-[13px] font-medium text-amber-900 leading-snug">
          {message}
        </span>
        <button
          type="button"
          aria-label="Скрыть подсказку"
          onClick={onDismiss}
          disabled={disabled}
          className="grid place-items-center w-6 h-6 -mt-0.5 -mr-1 rounded-full text-amber-700 hover:bg-amber-100 shrink-0 touch-manipulation transition-colors disabled:opacity-50"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
      {/* flex-wrap (review P2): длинные русские labels («Проверить как ответ» +
          «Продолжить обсуждение») не помещаются в один ряд на ~320px. */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onPrimary}
          disabled={disabled}
          className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full bg-socrat-primary hover:bg-socrat-primary-dark text-white text-[13px] font-bold touch-manipulation transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Send className="h-3.5 w-3.5 stroke-[2.5]" aria-hidden="true" />
          {primaryLabel}
        </button>
        <button
          type="button"
          onClick={onSecondary}
          disabled={disabled}
          className="inline-flex items-center h-9 px-3 rounded-full text-[13px] font-semibold text-amber-800 hover:bg-amber-100 touch-manipulation transition-colors disabled:opacity-50"
        >
          {secondaryLabel}
        </button>
      </div>
    </div>
  );
}
