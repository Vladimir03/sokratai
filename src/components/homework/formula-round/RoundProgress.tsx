import { memo } from 'react';

interface RoundProgressProps {
  current: number;
  total: number;
}

const RoundProgress = memo(function RoundProgress({
  current,
  total,
}: RoundProgressProps) {
  return (
    <div className="flex items-center gap-4">
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
      <span className="text-base font-medium text-slate-500 tabular-nums shrink-0">
        {current}/{total}
      </span>
    </div>
  );
});

export { RoundProgress };
