import { memo } from 'react';

export interface SparklineProps {
  values: number[];
  stroke?: string;
  width?: number;
  height?: number;
  ariaLabel?: string;
}

function SparklineImpl({
  values,
  stroke = 'var(--sokrat-fg2)',
  width = 80,
  height = 24,
  ariaLabel,
}: SparklineProps) {
  if (!values || values.length < 2) {
    return (
      <span className="t-muted" style={{ fontSize: 12 }}>
        —
      </span>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = width / (values.length - 1);
  const yPad = 2;
  const drawHeight = height - yPad * 2;

  const points = values
    .map((v, i) => `${i * step},${height - ((v - min) / range) * drawHeight - yPad}`)
    .join(' ');

  const lastIndex = values.length - 1;
  const lastCx = lastIndex * step;
  const lastCy = height - ((values[lastIndex] - min) / range) * drawHeight - yPad;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden={ariaLabel ? undefined : true}
      aria-label={ariaLabel}
      role={ariaLabel ? 'img' : undefined}
      style={{ display: 'block' }}
    >
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={lastCx} cy={lastCy} r={2} fill={stroke} />
    </svg>
  );
}

export const Sparkline = memo(SparklineImpl);
