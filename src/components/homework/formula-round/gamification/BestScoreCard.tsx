import { memo, useEffect, useState, type ChangeEvent } from 'react';

import type { SectionKey } from '@/stores/trainerGamificationStore';

import { TrophyIcon } from './icons/TrophyIcon';

const SECTION_OPTIONS: Array<{ value: SectionKey; label: string }> = [
  { value: 'all', label: 'Вся механика' },
  { value: 'kinematics', label: 'Кинематика' },
  { value: 'dynamics', label: 'Динамика' },
  { value: 'conservation', label: 'Законы сохранения' },
  { value: 'statics', label: 'Статика' },
  { value: 'hydrostatics', label: 'Гидростатика' },
  { value: 'egor-v1', label: 'Базовый (Вращение)' },
  { value: 'egor-parabola', label: 'Базовый (Парабола)' },
];

export interface BestScoreCardProps {
  bestScoreBySection: Partial<Record<SectionKey, number>>;
  initialSection?: SectionKey;
}

function BestScoreCardComponent({
  bestScoreBySection,
  initialSection = 'all',
}: BestScoreCardProps) {
  const [section, setSection] = useState<SectionKey>(initialSection);

  // Follow parent's selectedSection — after a round on non-default section
  // the card must reflect the just-played section so the updated best score
  // is visible without forcing the user to manually change the selector.
  useEffect(() => {
    setSection(initialSection);
  }, [initialSection]);

  const best = bestScoreBySection[section];

  const handleChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setSection(event.target.value as SectionKey);
  };

  return (
    <div className="min-w-[240px] snap-start bg-white border border-slate-200 rounded-lg p-4">
      <div className="flex items-start justify-between">
        <TrophyIcon className="text-accent" />
      </div>
      <div className="mt-3">
        <label className="sr-only" htmlFor="best-score-section">
          Выбери раздел для рекорда
        </label>
        <select
          id="best-score-section"
          value={section}
          onChange={handleChange}
          className="w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 font-medium text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
          style={{ fontSize: '16px', touchAction: 'manipulation' }}
        >
          {SECTION_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-3xl font-bold tabular-nums text-slate-900">
          {typeof best === 'number' ? best : '—'}
        </span>
        <span className="text-sm text-slate-600">
          {typeof best === 'number' ? 'XP · лучший раунд' : 'нет записи'}
        </span>
      </div>
    </div>
  );
}

export const BestScoreCard = memo(BestScoreCardComponent);
