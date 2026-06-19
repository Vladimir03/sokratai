import { memo } from 'react';
import type { AppliedOutcome } from '@/stores/trainerGamificationStore';

interface XpBreakdownProps {
  appliedOutcome: AppliedOutcome;
  correctCount: number;
  totalCount: number;
  bestComboInRound: number;
}

/**
 * Итоги раунда (без абстрактных XP — req 9).
 *
 * Главный результат («% правильных») показывает герой-блок RoundResultScreen,
 * перфект/рекорд — Celebrate-оверлей. Здесь — то, чего нет на других поверхностях:
 * лучшая серия подряд + бейджи достижений. Если показывать нечего — рендерим null.
 */
export const XpBreakdown = memo(function XpBreakdown({
  appliedOutcome,
  bestComboInRound,
}: XpBreakdownProps) {
  const { isPerfectRound, isNewBest } = appliedOutcome;
  const combo = Math.max(0, bestComboInRound);

  const badges: string[] = [];
  if (isNewBest) badges.push('Новый рекорд');
  if (isPerfectRound) badges.push('Идеальный раунд');

  // Нечего показать — комбо короткое и без достижений.
  if (combo < 2 && badges.length === 0) {
    return null;
  }

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4 space-y-2">
      <h2 className="text-base font-medium text-slate-700">Итоги раунда</h2>

      {combo >= 2 && (
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span className="text-slate-600">Лучшая серия</span>
          <span className="tabular-nums font-medium text-slate-900">
            {combo} подряд
          </span>
        </div>
      )}

      {badges.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {badges.map((badge) => (
            <span
              key={badge}
              className="rounded-full bg-accent/10 px-3 py-1 text-xs font-medium text-accent"
            >
              {badge}
            </span>
          ))}
        </div>
      )}
    </div>
  );
});
