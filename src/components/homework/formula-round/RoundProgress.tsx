import { Heart } from 'lucide-react';
import { Progress } from '@/components/ui/progress';

interface RoundProgressProps {
  current: number;
  total: number;
  lives: number;
  maxLives: number;
}

export function RoundProgress({ current, total, lives, maxLives }: RoundProgressProps) {
  const percent = total > 0 ? Math.round((current / total) * 100) : 0;

  return (
    <div className="flex items-center gap-3">
      <Progress value={percent} className="flex-1 h-2" />
      <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">
        {current}/{total}
      </span>
      <div className="flex items-center gap-0.5">
        {Array.from({ length: maxLives }).map((_, i) => (
          <Heart
            key={i}
            className={`w-4 h-4 ${
              i < lives
                ? 'fill-destructive text-destructive'
                : 'text-muted-foreground/30'
            }`}
          />
        ))}
      </div>
    </div>
  );
}
