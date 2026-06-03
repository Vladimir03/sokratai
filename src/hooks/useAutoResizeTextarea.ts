import { useEffect } from 'react';

/**
 * Auto-grow a <textarea> to fit its content, capped at `maxHeight` px.
 *
 * Height is set imperatively via `element.style.height`, so a CSS `min-h-*`
 * floor or the `rows` attribute still governs the empty/resting state. The
 * height is recomputed whenever `value` changes and on window `resize`, so a
 * viewport-relative cap (e.g. half the screen) stays correct across orientation
 * changes and mobile-keyboard show/hide.
 *
 * @param ref       Ref to the textarea element.
 * @param value     The controlled value driving the textarea (recompute trigger).
 * @param maxHeight Px cap, or a function returning px — e.g. `() => window.innerHeight * 0.5`.
 *                  The function is re-evaluated on every recompute so a vh-style
 *                  cap tracks the viewport. Pass a stable reference (number,
 *                  module-level fn, or `useCallback`) to avoid effect churn.
 */
export function useAutoResizeTextarea(
  ref: React.RefObject<HTMLTextAreaElement | null>,
  value: string,
  maxHeight: number | (() => number),
) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const resize = () => {
      const cap = typeof maxHeight === 'function' ? maxHeight() : maxHeight;
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, cap)}px`;
    };

    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [ref, value, maxHeight]);
}
