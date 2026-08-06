// Пикер цвета сущности расписания (группа / ученик) — Волна 1, «4 группы — 4 цвета».
// Только пресеты из scheduleColors.ts (rule 90: никаких произвольных цветов),
// «без цвета» = NULL → ячейка красится по типу занятия, как раньше.
import { Ban, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ENTITY_COLOR_PRESETS } from '@/components/tutor/schedule/scheduleColors';

interface ColorSwatchPickerProps {
  value: string | null | undefined;
  onChange: (color: string | null) => void;
  disabled?: boolean;
  className?: string;
}

export function ColorSwatchPicker({ value, onChange, disabled, className }: ColorSwatchPickerProps) {
  const current = value ?? null;
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <button
        type="button"
        title="Без цвета"
        aria-label="Без цвета"
        aria-pressed={current === null}
        disabled={disabled}
        onClick={() => onChange(null)}
        className={cn(
          'flex h-9 w-9 items-center justify-center rounded-full border bg-white transition-colors',
          current === null ? 'border-slate-500' : 'border-socrat-border hover:border-slate-400',
          disabled && 'opacity-50',
        )}
        style={{ touchAction: 'manipulation' }}
      >
        <Ban className="h-4 w-4 text-slate-400" aria-hidden="true" />
      </button>
      {ENTITY_COLOR_PRESETS.map((preset) => (
        <button
          key={preset.value}
          type="button"
          title={preset.label}
          aria-label={preset.label}
          aria-pressed={current === preset.value}
          disabled={disabled}
          onClick={() => onChange(preset.value)}
          className={cn(
            'flex h-9 w-9 items-center justify-center rounded-full transition-transform',
            current === preset.value && 'ring-2 ring-offset-2 ring-slate-400',
            disabled && 'opacity-50',
          )}
          style={{ backgroundColor: preset.value, touchAction: 'manipulation' }}
        >
          {current === preset.value && <Check className="h-4 w-4 text-white" aria-hidden="true" />}
        </button>
      ))}
    </div>
  );
}
