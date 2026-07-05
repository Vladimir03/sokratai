/**
 * unified-task-model F0 (2026-07-05): «Формат проверки» — извлечён из
 * `homework-create/HWTaskCard.tsx` в общий компонент (конструктор ДЗ + КБ-форма
 * F1). Native <select>, 16px + touch-action (iOS, rule 80).
 */

import { Label } from '@/components/ui/label';

export type CheckFormatValue = 'short_answer' | 'detailed_solution';

export interface CheckFormatFieldProps {
  /** Уникальный id для label↔select (напр. `check-format-${localId}`). */
  id: string;
  value: CheckFormatValue;
  onChange: (v: CheckFormatValue) => void;
}

export function CheckFormatField({ id, value, onChange }: CheckFormatFieldProps) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>Формат проверки</Label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as CheckFormatValue)}
        className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        style={{ fontSize: '16px', touchAction: 'manipulation' }}
      >
        <option value="short_answer">Краткий ответ</option>
        <option value="detailed_solution">Развёрнутое решение</option>
      </select>
      <p className="text-xs text-muted-foreground">
        {value === 'detailed_solution'
          ? 'AI потребует ход решения от ученика'
          : 'Число, слово или формула'}
      </p>
    </div>
  );
}
