import { memo } from 'react';

import { pluralDays } from '@/lib/trainerGamification/pluralize';

import { FlameIcon } from './icons/FlameIcon';

export interface StreakCardProps {
  currentStreak: number;
  lastPlayedDate: string | null;
}

function StreakCardComponent({ currentStreak, lastPlayedDate }: StreakCardProps) {
  const isDim = currentStreak === 0 && lastPlayedDate !== null;

  return (
    <div className="min-w-[240px] snap-start bg-white border border-slate-200 rounded-lg p-4">
      <div className="flex items-start justify-between">
        <FlameIcon className={isDim ? 'text-slate-300' : 'text-socrat-accent'} />
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span
          className={`text-3xl font-bold tabular-nums ${
            isDim ? 'text-slate-400' : 'text-slate-900'
          }`}
        >
          {currentStreak}
        </span>
        <span className={`text-sm ${isDim ? 'text-slate-400' : 'text-slate-600'}`}>
          {pluralDays(currentStreak)} подряд
        </span>
      </div>
      {isDim ? (
        <p className="mt-2 text-xs text-slate-500">
          Сыграй раунд, чтобы начать streak
        </p>
      ) : (
        <p className="mt-2 text-xs text-slate-500">
          {currentStreak === 0 ? 'Начни свой первый streak' : 'Серия дней подряд'}
        </p>
      )}
    </div>
  );
}

export const StreakCard = memo(StreakCardComponent);
