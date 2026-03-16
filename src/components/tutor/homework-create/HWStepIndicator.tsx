import { Check } from 'lucide-react';

export interface HWStepIndicatorProps {
  current: number;
  total: number;
}

export function HWStepIndicator({ current, total }: HWStepIndicatorProps) {
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: total }, (_, i) => {
        const step = i + 1;
        const isActive = step === current;
        const isDone = step < current;
        return (
          <div key={step} className="flex items-center gap-2">
            {i > 0 && (
              <div
                className={`h-px w-6 sm:w-10 ${
                  isDone ? 'bg-primary' : 'bg-muted-foreground/30'
                }`}
              />
            )}
            <div
              className={`flex items-center justify-center h-8 w-8 rounded-full text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : isDone
                  ? 'bg-primary/20 text-primary'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {isDone ? <Check className="h-4 w-4" /> : step}
            </div>
          </div>
        );
      })}
    </div>
  );
}
