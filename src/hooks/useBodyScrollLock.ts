import { useEffect } from 'react';

/**
 * iOS-safe body scroll lock.
 *
 * `body.style.overflow = 'hidden'` works on desktop and Android but iOS Safari
 * still allows the page behind a fixed overlay to scroll with a rubber-band
 * bounce (WebKit quirk). The position-fixed + negative-top technique pins the
 * body in place and restores the prior scroll position on release.
 *
 * Reference: `.claude/rules/80-cross-browser.md` → iOS-специфичные проблемы.
 */
export function useBodyScrollLock(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    const scrollY = window.scrollY;
    const body = document.body;

    const prev = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow,
    };

    body.style.position = 'fixed';
    body.style.top = `-${scrollY}px`;
    body.style.left = '0';
    body.style.right = '0';
    body.style.width = '100%';
    // Belt-and-braces: desktop / Android respect overflow; iOS respects position.
    body.style.overflow = 'hidden';

    return () => {
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.left = prev.left;
      body.style.right = prev.right;
      body.style.width = prev.width;
      body.style.overflow = prev.overflow;
      // Restore the user's scroll position after unpinning.
      window.scrollTo(0, scrollY);
    };
  }, [enabled]);
}
