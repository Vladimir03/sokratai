import { memo } from 'react';
import { Zap } from 'lucide-react';

interface ComboIndicatorProps {
  combo: number;
}

/**
 * In-round combo pill. Renders only when combo >= 2.
 *
 * Re-mounted on every combo change via `key={combo}` in the parent — that
 * re-triggers the tailwindcss-animate zoom-in keyframe so each increment
 * "pops" visually without framer-motion (forbidden per performance.md).
 *
 * When combo drops to <2 (break on wrong answer), the parent unmounts us
 * and the pill disappears — no shake in Phase 1 (P1 polish).
 */
export const ComboIndicator = memo(function ComboIndicator({
  combo,
}: ComboIndicatorProps) {
  if (combo < 2) return null;

  return (
    <div
      className="inline-flex items-center gap-1 rounded-full bg-accent px-3 py-1 text-sm font-semibold text-white tabular-nums shadow-sm animate-in zoom-in-95 duration-200"
      role="status"
      aria-live="polite"
      aria-label={`Серия ${combo} правильных ответов подряд`}
    >
      <Zap className="h-3.5 w-3.5" aria-hidden="true" />
      <span>combo × {combo}</span>
    </div>
  );
});
