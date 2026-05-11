import { useEffect, useState } from 'react';

/**
 * Tracks `window.visualViewport.height` and returns it as a CSS value
 * (`'1234px'`) so that callers can set `style={{ height: vvh }}` on
 * a full-screen mobile container.
 *
 * **Why:** preview-QA #8 (2026-05-11) showed a third-of-screen white
 * strip below the composer on mobile Chrome when the virtual keyboard
 * opened+closed. Root cause: `h-[100dvh]` (Tailwind dynamic viewport)
 * is rounded/cached by some Android Chrome builds — it doesn't always
 * recompute when the keyboard hides, leaving the root container shorter
 * than the visible viewport. Native `visualViewport` events are the
 * canonical source of truth for «what is actually visible right now».
 *
 * SSR-safe + back-compat:
 *   - Initial value `'100dvh'` keeps Tailwind dvh CSS as fallback if
 *     React hydration hasn't run yet OR the browser doesn't support
 *     `visualViewport` (very old WebKit).
 *   - Listener attaches `resize` (keyboard, orientation) AND `scroll`
 *     (mobile address-bar toggle).
 *
 * Caller usage:
 *   const vvh = useVisualViewportHeight();
 *   return <div style={{ height: vvh }}>...</div>;
 */
export function useVisualViewportHeight(): string {
  const [height, setHeight] = useState<string>('100dvh');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const vv = window.visualViewport;
    if (!vv) return; // older browser — keep the '100dvh' Tailwind fallback

    const update = () => setHeight(`${vv.height}px`);
    // Prime immediately on mount so SSR fallback doesn't flash.
    update();

    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);

    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  return height;
}
