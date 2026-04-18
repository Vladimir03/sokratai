import { memo } from 'react';
import type { AppliedOutcome } from '@/stores/trainerGamificationStore';

interface XpBreakdownProps {
  appliedOutcome: AppliedOutcome;
  correctCount: number;
  totalCount: number;
  bestComboInRound: number;
}

interface LineProps {
  label: string;
  value: number;
  muted?: boolean;
}

function Line({ label, value, muted }: LineProps) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className={muted ? 'text-slate-500' : 'text-slate-700'}>{label}</span>
      <span className={`tabular-nums font-medium ${muted ? 'text-slate-500' : 'text-slate-900'}`}>
        +{value}
      </span>
    </div>
  );
}

/**
 * Pure presentational XP breakdown (see spec §5.8).
 *
 * Shows line items for base / accuracy / combo / perfect / newBest, subtotal,
 * optional retry-multiplier, and final total.
 */
export const XpBreakdown = memo(function XpBreakdown({
  appliedOutcome,
  correctCount,
  totalCount,
  bestComboInRound,
}: XpBreakdownProps) {
  const { xpBreakdown, xpEarned } = appliedOutcome;
  const { base, accuracy, combo, perfect, newBest, retryMultiplier } = xpBreakdown;
  const subtotal = base + accuracy + combo + perfect + newBest;
  const isRetry = retryMultiplier < 1;

  const accuracyPct = totalCount > 0 ? Math.round((correctCount / totalCount) * 100) : 0;

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4 space-y-2">
      <h2 className="text-base font-medium text-slate-700 mb-2">Начисление XP</h2>

      <Line label="Базовый XP" value={base} />
      <Line label={`Точность ${accuracyPct}%`} value={accuracy} />
      <Line label={`Combo × ${Math.max(0, bestComboInRound)}`} value={combo} />
      {perfect > 0 && <Line label="Идеальный раунд" value={perfect} />}
      {newBest > 0 && <Line label="Новый рекорд!" value={newBest} />}

      <div className="border-t border-slate-200 pt-2 mt-2 flex items-baseline justify-between gap-3">
        <span className="text-sm text-slate-700">
          {isRetry ? 'Подытог' : 'Итого'}
        </span>
        <span className="tabular-nums font-semibold text-slate-900">
          +{subtotal}
        </span>
      </div>

      {isRetry && (
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span className="text-slate-500 italic">
            Повтор ошибок: ×{retryMultiplier}
          </span>
          <span className="tabular-nums font-semibold text-accent">
            +{xpEarned} XP
          </span>
        </div>
      )}

      {!isRetry && (
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm text-slate-700">Заработано</span>
          <span className="tabular-nums font-semibold text-accent">
            +{xpEarned} XP
          </span>
        </div>
      )}
    </div>
  );
});
