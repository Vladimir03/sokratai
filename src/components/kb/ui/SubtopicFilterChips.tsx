import { memo } from 'react';
import { cn } from '@/lib/utils';
import { NO_SUBTOPIC_FILTER, type SubtopicCounts } from '@/lib/kbCatalogGrouping';
import type { KBSubtopic } from '@/types/kb';

interface SubtopicFilterChipsProps {
  subtopics: KBSubtopic[];
  counts: SubtopicCounts;
  /** `null` = «Все», id подтемы, либо `NO_SUBTOPIC_FILTER` = «Без подтемы». */
  activeId: string | null;
  onSelect: (id: string | null) => void;
  className?: string;
}

const CHIP_BASE =
  'inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium ' +
  'transition-colors [touch-action:manipulation] focus-visible:outline-none ' +
  'focus-visible:ring-2 focus-visible:ring-socrat-primary/40';

function Chip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        CHIP_BASE,
        active
          ? 'bg-socrat-primary text-white'
          : 'bg-socrat-border-light text-gray-600 hover:bg-socrat-primary/10 hover:text-socrat-primary',
      )}
    >
      <span>{label}</span>
      {count != null ? (
        <span className={cn('tabular-nums', active ? 'text-white/80' : 'text-gray-400')}>
          · {count}
        </span>
      ) : null}
    </button>
  );
}

/**
 * Кликабельные чипы подтем со счётчиками (single-select). Клик по подтеме →
 * фильтр только её задач; «Все» сбрасывает; «Без подтемы» — только если есть
 * задачи без подтемы. Комбинируется с фильтром по КИМ на стороне родителя.
 */
export const SubtopicFilterChips = memo(function SubtopicFilterChips({
  subtopics,
  counts,
  activeId,
  onSelect,
  className,
}: SubtopicFilterChipsProps) {
  if (subtopics.length === 0 && counts.noSubtopic === 0) return null;

  return (
    <div className={cn('flex flex-wrap gap-1.5', className)} role="group" aria-label="Фильтр по подтемам">
      <Chip label="Все" active={activeId === null} onClick={() => onSelect(null)} />
      {subtopics.map((s) => (
        <Chip
          key={s.id}
          label={s.name}
          count={counts.bySubtopic.get(s.id) ?? 0}
          active={activeId === s.id}
          onClick={() => onSelect(s.id)}
        />
      ))}
      {counts.noSubtopic > 0 ? (
        <Chip
          label="Без подтемы"
          count={counts.noSubtopic}
          active={activeId === NO_SUBTOPIC_FILTER}
          onClick={() => onSelect(NO_SUBTOPIC_FILTER)}
        />
      ) : null}
    </div>
  );
});
