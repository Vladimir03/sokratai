import { memo } from 'react';

export type WeeklyCell = 'ok' | 'late' | 'part' | 'miss' | 'none';

export interface WeeklyStripProps {
  cells: WeeklyCell[];
  ariaLabel?: string;
}

const CELL_COLOR: Record<WeeklyCell, string> = {
  ok: 'var(--sokrat-state-success-fg)',
  late: 'var(--sokrat-state-warning-fg)',
  part: 'var(--sokrat-state-warning-fg)',
  miss: 'var(--sokrat-state-danger-fg)',
  none: 'var(--sokrat-border-light)',
};

const CELL_LABEL: Record<WeeklyCell, string> = {
  ok: 'вовремя',
  late: 'позже',
  part: 'частично',
  miss: 'не сдано',
  none: '—',
};

function WeeklyStripImpl({ cells, ariaLabel = 'Сдачи по неделям' }: WeeklyStripProps) {
  return (
    <div
      style={{ display: 'flex', gap: 3, alignItems: 'center' }}
      role="img"
      aria-label={ariaLabel}
    >
      {cells.map((c, i) => {
        const weeksBack = cells.length - 1 - i;
        const title = `Неделя −${weeksBack}: ${CELL_LABEL[c]}`;
        return (
          <span
            key={i}
            title={title}
            aria-label={title}
            style={{
              width: 14,
              height: 20,
              borderRadius: 3,
              background: CELL_COLOR[c],
              display: 'inline-block',
              flex: 'none',
            }}
          />
        );
      })}
    </div>
  );
}

export const WeeklyStrip = memo(WeeklyStripImpl);
