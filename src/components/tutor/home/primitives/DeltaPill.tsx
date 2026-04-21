import { memo } from 'react';

export interface DeltaPillProps {
  value: number | null;
  unit?: string;
  fractionDigits?: number;
}

function formatNumber(value: number, fractionDigits: number): string {
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(Math.abs(value));
}

function DeltaPillImpl({ value, unit = '', fractionDigits = 1 }: DeltaPillProps) {
  if (value === null || Number.isNaN(value)) {
    return (
      <span className="t-muted t-num" style={{ fontSize: 12 }}>
        —
      </span>
    );
  }

  if (value === 0) {
    return (
      <span className="t-muted t-num" style={{ fontSize: 12 }}>
        ·
      </span>
    );
  }

  const positive = value > 0;
  const color = positive
    ? 'var(--sokrat-state-success-fg)'
    : 'var(--sokrat-state-danger-fg)';
  const arrow = positive ? '↑' : '↓';
  const sign = positive ? '+' : '−';
  const formatted = formatNumber(value, fractionDigits);

  return (
    <span
      className="t-num"
      style={{ fontSize: 12, fontWeight: 600, color }}
    >
      {arrow} {sign}
      {formatted}
      {unit}
    </span>
  );
}

export const DeltaPill = memo(DeltaPillImpl);
