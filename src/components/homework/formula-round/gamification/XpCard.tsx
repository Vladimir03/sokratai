import { memo } from 'react';

import { DAILY_GOAL_ROUNDS } from '@/lib/trainerGamification/xpCalculator';

import { ZapIcon } from './icons/ZapIcon';

export interface XpCardProps {
  totalXp: number;
  dailyRoundsCount: number;
}

function XpCardComponent({ totalXp, dailyRoundsCount }: XpCardProps) {
  const clamped = Math.min(dailyRoundsCount, DAILY_GOAL_ROUNDS);
  const pct = Math.round((clamped / DAILY_GOAL_ROUNDS) * 100);

  return (
    <div className="min-w-[240px] snap-start bg-white border border-slate-200 rounded-lg p-4">
      <div className="flex items-start justify-between">
        <ZapIcon className="text-accent" />
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-3xl font-bold tabular-nums text-slate-900">
          {totalXp}
        </span>
        <span className="text-sm text-slate-600">XP</span>
      </div>
      <div className="mt-3 space-y-1.5">
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>Цель дня</span>
          <span className="tabular-nums">
            {clamped}/{DAILY_GOAL_ROUNDS}
          </span>
        </div>
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-accent/20"
          role="progressbar"
          aria-valuenow={clamped}
          aria-valuemin={0}
          aria-valuemax={DAILY_GOAL_ROUNDS}
          aria-label="Прогресс дневной цели"
        >
          <div
            className="h-full bg-accent transition-[width] duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}

export const XpCard = memo(XpCardComponent);
