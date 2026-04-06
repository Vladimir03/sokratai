import { memo } from 'react';
import { Heart } from 'lucide-react';

interface RoundProgressProps {
  current: number;
  total: number;
  lives: number;
  maxLives: number;
}

const RoundProgress = memo(function RoundProgress({
  current,
  total,
  lives,
  maxLives,
}: RoundProgressProps) {
  return (
    <div className="flex items-center justify-between gap-4">
      {/* Progress dots */}
      <div className="flex items-center gap-1.5 flex-1 min-w-0">
        {Array.from({ length: total }, (_, i) => (
          <div
            key={i}
            className={`h-2 flex-1 rounded-full transition-colors duration-200 ${
              i < current
                ? 'bg-accent'
                : i === current
                  ? 'bg-accent/50'
                  : 'bg-slate-200'
            }`}
          />
        ))}
      </div>

      {/* Question counter */}
      <span className="text-sm font-medium text-slate-500 tabular-nums shrink-0">
        {current}/{total}
      </span>

      {/* Lives */}
      <div className="flex items-center gap-0.5 shrink-0">
        {Array.from({ length: maxLives }, (_, i) => (
          <Heart
            key={i}
            className={`w-5 h-5 transition-all duration-300 ${
              i < lives
                ? 'fill-red-500 text-red-500'
                : 'fill-slate-200 text-slate-200'
            }`}
          />
        ))}
      </div>
    </div>
  );
});

export { RoundProgress };
