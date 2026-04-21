import { memo } from 'react';
import { formatCurrency } from '@/lib/formatters';
import { pluralize, PLURAL_LESSONS } from '@/lib/ru/pluralize';

export interface StatStripProps {
  activeStudents: number;
  activeWeekDelta: number;
  attentionCount: number;
  avgScoreWeek: number | null;
  avgScoreDelta: number | null;
  toPay: number;
  pendingCount: number;
  overdueCount: number;
}

function formatDecimalRu(value: number, fractionDigits = 1): string {
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

function formatSignedDecimalRu(value: number, fractionDigits = 1): string {
  const formatted = formatDecimalRu(Math.abs(value), fractionDigits);
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `−${formatted}`;
  return formatted;
}

function StatStripImpl({
  activeStudents,
  activeWeekDelta,
  attentionCount,
  avgScoreWeek,
  avgScoreDelta,
  toPay,
  pendingCount,
  overdueCount,
}: StatStripProps) {
  // Cell 1: Active students
  const deltaWeekLabel =
    activeWeekDelta === 0
      ? 'без изменений'
      : activeWeekDelta > 0
        ? `+${activeWeekDelta} за неделю`
        : `${activeWeekDelta} за неделю`;
  const deltaWeekColor =
    activeWeekDelta > 0
      ? 'var(--sokrat-state-success-fg)'
      : activeWeekDelta < 0
        ? 'var(--sokrat-state-danger-fg)'
        : 'var(--sokrat-fg3)';

  // Cell 2: Attention count
  const attentionColor =
    attentionCount > 0 ? 'var(--sokrat-state-warning-fg)' : 'var(--sokrat-fg1)';

  // Cell 3: Avg score
  const avgScoreDisplay =
    avgScoreWeek != null ? formatDecimalRu(avgScoreWeek) : '—';
  const avgDeltaLabel =
    avgScoreDelta == null || avgScoreDelta === 0
      ? 'без изменений к прошлой'
      : `${formatSignedDecimalRu(avgScoreDelta)} к прошлой`;
  const avgDeltaColor =
    avgScoreDelta != null && avgScoreDelta > 0
      ? 'var(--sokrat-state-success-fg)'
      : avgScoreDelta != null && avgScoreDelta < 0
        ? 'var(--sokrat-state-danger-fg)'
        : 'var(--sokrat-fg3)';

  // Cell 4: Payments
  const payLabel = `${pendingCount} ждёт · ${overdueCount} долг`;

  return (
    <div className="t-stats" style={{ marginBottom: 16 }}>
      <div className="t-stats__cell">
        <div className="t-stats__label">Активных учеников</div>
        <div className="t-stats__value">{activeStudents}</div>
        <div className="t-stats__meta" style={{ color: deltaWeekColor }}>
          {deltaWeekLabel}
        </div>
      </div>

      <div className="t-stats__cell">
        <div className="t-stats__label">Требуют внимания</div>
        <div className="t-stats__value" style={{ color: attentionColor }}>
          {attentionCount}
        </div>
        <div className="t-stats__meta">просрочки, падение балла</div>
      </div>

      <div className="t-stats__cell">
        <div className="t-stats__label">Ø балл за неделю</div>
        <div className="t-stats__value">{avgScoreDisplay}</div>
        <div className="t-stats__meta" style={{ color: avgDeltaColor }}>
          {avgDeltaLabel}
        </div>
      </div>

      <div className="t-stats__cell">
        <div className="t-stats__label">К оплате</div>
        <div className="t-stats__value">{formatCurrency(toPay)}</div>
        <div className="t-stats__meta">{payLabel}</div>
      </div>
    </div>
  );
}

export const StatStrip = memo(StatStripImpl);

// `PLURAL_LESSONS` kept exported here to co-locate — consumers of StatStrip
// typically also render HomeHeader meta with the same pluralization.
export { PLURAL_LESSONS };
