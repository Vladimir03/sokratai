import { useEffect, useState } from 'react';

/**
 * Phase 1 student homework problem screen viewport gate.
 *
 * Returns `true` when viewport width is `<= 768px` (inclusive — matches
 * AC-2 in `docs/delivery/features/student-homework-problem-screen/spec.md`).
 *
 * Differences vs the existing `@/hooks/use-mobile.tsx::useIsMobile`:
 *   - Inclusive `<= 768` instead of `< 768` (spec is strict).
 *   - SSR-safe initial state read directly from `matchMedia` so the first
 *     render never flashes a desktop layout to a mobile user.
 *
 * The two hooks coexist: `use-mobile.tsx` remains as-is for legacy callsites
 * (e.g. `MobileTopBar` chrome). This hook is the canonical gate for the
 * Phase 1 problem-screen viewport routing.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined'
      ? window.matchMedia('(max-width: 768px)').matches
      : false
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(max-width: 768px)');
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);
  return isMobile;
}
