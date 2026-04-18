import { memo, useEffect } from 'react';

export type CelebrateVariant = 'new-best' | 'perfect' | 'goal';

interface CelebrateProps {
  variant: CelebrateVariant;
  /** Called exactly once ~1200ms after mount. Parent unmounts on this signal. */
  onDone?: () => void;
}

const DURATION_MS = 1200;

/**
 * Full-screen CSS-only celebration overlay (spec §5.8).
 *
 * Auto-dismisses via setTimeout → onDone. Timer is cleared on unmount to
 * prevent state-update-after-unmount warnings (mirrors the TaskStepper
 * celebration pattern in GuidedHomeworkWorkspace — celebrationTimerRef).
 *
 * Priority ordering (new-best > perfect > goal) is enforced by the caller;
 * this component always renders exactly one variant.
 *
 * No framer-motion — pure CSS keyframes (see `.claude/rules/performance.md`).
 */
export const Celebrate = memo(function Celebrate({
  variant,
  onDone,
}: CelebrateProps) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onDone?.();
    }, DURATION_MS);
    return () => clearTimeout(timer);
  }, [onDone]);

  return (
    <>
      <style>{CELEBRATE_CSS}</style>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none"
        role="status"
        aria-live="polite"
      >
        {variant === 'new-best' && <NewBestBurst />}
        {variant === 'perfect' && <PerfectStar />}
        {variant === 'goal' && <GoalFlame />}
      </div>
    </>
  );
});

// ─── Variant: new-best (gold confetti burst, 12 rays) ──────────────────────
const RAY_COUNT = 12;
const RAY_ANGLES = Array.from({ length: RAY_COUNT }, (_, i) => (360 / RAY_COUNT) * i);

function NewBestBurst() {
  return (
    <div className="relative flex flex-col items-center gap-4">
      <div className="relative h-40 w-40">
        {RAY_ANGLES.map((angle, i) => (
          <span
            key={i}
            className="sokrat-ray"
            style={
              {
                ['--angle' as string]: `${angle}deg`,
                willChange: 'transform',
              } as React.CSSProperties
            }
            aria-hidden="true"
          />
        ))}
        <span
          className="sokrat-center-pop"
          style={{ willChange: 'transform' }}
          aria-hidden="true"
        />
      </div>
      <p
        className="sokrat-label text-2xl font-semibold text-accent"
        style={{ willChange: 'transform' }}
      >
        Новый рекорд!
      </p>
    </div>
  );
}

// ─── Variant: perfect (green star pulse + glow) ────────────────────────────
function PerfectStar() {
  return (
    <div className="relative flex flex-col items-center gap-4">
      <svg
        viewBox="0 0 100 100"
        className="sokrat-star h-32 w-32 text-accent"
        style={{ willChange: 'transform' }}
        aria-hidden="true"
      >
        <defs>
          <radialGradient id="sokrat-star-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.35" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx="50" cy="50" r="48" fill="url(#sokrat-star-glow)" />
        <polygon
          points="50,10 61,38 92,40 67,59 76,90 50,72 24,90 33,59 8,40 39,38"
          fill="currentColor"
        />
      </svg>
      <p
        className="sokrat-label text-2xl font-semibold text-accent"
        style={{ willChange: 'transform' }}
      >
        Идеальный раунд!
      </p>
    </div>
  );
}

// ─── Variant: goal (orange flame bounce) ───────────────────────────────────
function GoalFlame() {
  return (
    <div className="relative flex flex-col items-center gap-4">
      <svg
        viewBox="0 0 100 120"
        className="sokrat-flame h-32 w-28 text-socrat-accent"
        style={{ willChange: 'transform' }}
        aria-hidden="true"
      >
        <path
          d="M50 10 C 62 32, 82 42, 78 72 C 75 96, 56 112, 50 112 C 44 112, 25 96, 22 72 C 18 42, 38 32, 50 10 Z"
          fill="currentColor"
        />
        <path
          d="M50 42 C 58 56, 68 62, 66 80 C 64 94, 54 104, 50 104 C 46 104, 36 94, 34 80 C 32 62, 42 56, 50 42 Z"
          fill="currentColor"
          fillOpacity={0.55}
        />
      </svg>
      <p
        className="sokrat-label text-2xl font-semibold text-socrat-accent"
        style={{ willChange: 'transform' }}
      >
        Цель дня выполнена!
      </p>
    </div>
  );
}

// Inline keyframes scoped by `sokrat-*` prefix — renders once per mount.
const CELEBRATE_CSS = `
@keyframes sokrat-ray-fly {
  0%   { transform: rotate(var(--angle)) translateY(0) scale(0.4); opacity: 0; }
  20%  { opacity: 1; }
  100% { transform: rotate(var(--angle)) translateY(-80px) scale(1); opacity: 0; }
}
@keyframes sokrat-center-pop {
  0%   { transform: scale(0.2); opacity: 0; }
  30%  { transform: scale(1.2); opacity: 1; }
  70%  { transform: scale(1); opacity: 1; }
  100% { transform: scale(1); opacity: 0; }
}
@keyframes sokrat-star-pulse {
  0%   { transform: scale(0.6); opacity: 0; }
  30%  { transform: scale(1.15); opacity: 1; }
  60%  { transform: scale(1); opacity: 1; }
  100% { transform: scale(1); opacity: 0; }
}
@keyframes sokrat-flame-bounce {
  0%   { transform: translateY(20px) scale(0.8); opacity: 0; }
  30%  { transform: translateY(-8px) scale(1.05); opacity: 1; }
  50%  { transform: translateY(0) scale(1); opacity: 1; }
  70%  { transform: translateY(-4px) scale(1); opacity: 1; }
  100% { transform: translateY(0) scale(1); opacity: 0; }
}
@keyframes sokrat-label-in {
  0%   { transform: translateY(10px); opacity: 0; }
  30%  { transform: translateY(0); opacity: 1; }
  80%  { opacity: 1; }
  100% { opacity: 0; }
}
.sokrat-ray {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 6px;
  height: 18px;
  margin-left: -3px;
  margin-top: -9px;
  border-radius: 3px;
  background: linear-gradient(180deg, #F5C451 0%, #E8913A 100%);
  transform-origin: center;
  animation: sokrat-ray-fly 1200ms cubic-bezier(0.2, 0.7, 0.3, 1) forwards;
}
.sokrat-center-pop {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 40px;
  height: 40px;
  margin-left: -20px;
  margin-top: -20px;
  border-radius: 9999px;
  background: radial-gradient(circle, #F5C451 0%, #E8913A 70%, transparent 100%);
  animation: sokrat-center-pop 1200ms cubic-bezier(0.2, 0.7, 0.3, 1) forwards;
}
.sokrat-star {
  animation: sokrat-star-pulse 1200ms cubic-bezier(0.2, 0.7, 0.3, 1) forwards;
}
.sokrat-flame {
  animation: sokrat-flame-bounce 1200ms cubic-bezier(0.2, 0.7, 0.3, 1) forwards;
}
.sokrat-label {
  animation: sokrat-label-in 1200ms ease-out forwards;
}
@media (prefers-reduced-motion: reduce) {
  .sokrat-ray, .sokrat-center-pop, .sokrat-star, .sokrat-flame, .sokrat-label {
    animation-duration: 200ms;
  }
}
`;
