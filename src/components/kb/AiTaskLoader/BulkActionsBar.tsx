import { useState } from 'react';
import { CheckSquare, Square, Wand2 } from 'lucide-react';
import { useKbSources, useSubtopics } from '@/hooks/useKnowledgeBase';
import { cn } from '@/lib/utils';
import type { KBTopicWithCounts } from '@/types/kb';
import type { ReviewOverrides } from '@/components/kb/AiTaskLoader/reviewTypes';

/**
 * Массовые действия таблицы ревью (волна 2, #54): одна тема/подтема/источник/
 * экзамен на все выбранные черновики. Применение — чистый map по overrides,
 * без запросов. Сентинел «— не менять —» ('' у selects): патч собирается только
 * из реально выбранных контролов.
 */

const KEEP = '__keep__';

const SELECT_CLASS =
  'rounded-lg border border-socrat-border bg-white px-2.5 py-1.5 text-[16px] transition-colors focus:border-socrat-primary/50 focus:outline-none [touch-action:manipulation]';

interface BulkActionsBarProps {
  selectedCount: number;
  totalCount: number;
  dupCount: number;
  disabled: boolean;
  topics: KBTopicWithCounts[];
  onApply: (patch: Partial<ReviewOverrides>) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onDeselectDups: () => void;
  /** hw-режим загрузчика: скрыть Тему/Подтему/Источник (default true — KB как раньше). */
  showTaxonomy?: boolean;
}

export function BulkActionsBar({
  selectedCount,
  totalCount,
  dupCount,
  disabled,
  topics,
  onApply,
  onSelectAll,
  onDeselectAll,
  onDeselectDups,
  showTaxonomy = true,
}: BulkActionsBarProps) {
  const [topicId, setTopicId] = useState(KEEP);
  const [subtopicId, setSubtopicId] = useState(KEEP);
  const [exam, setExam] = useState(KEEP);
  const [sourceLabel, setSourceLabel] = useState('');
  // Bulk-КИМ (техдолг 5.6): один № на все выбранные (тематические подборки
  // «все задачи — КИМ 17»). Пусто = не менять.
  const [kimNumber, setKimNumber] = useState('');
  const { subtopics } = useSubtopics(topicId !== KEEP && topicId !== '' ? topicId : undefined);
  const { sources = [] } = useKbSources();

  // Темы ЕГЭ/ОГЭ дублируются по именам — при выбранном в баре экзамене скоупим.
  const topicOptions =
    exam === 'ege' || exam === 'oge' ? topics.filter((t) => t.exam === exam) : topics;

  const hasPatch =
    topicId !== KEEP || subtopicId !== KEEP || exam !== KEEP ||
    sourceLabel.trim() !== '' || kimNumber.trim() !== '';

  const handleApply = () => {
    if (!hasPatch || selectedCount === 0) return;
    const patch: Partial<ReviewOverrides> = {};
    if (topicId !== KEEP) {
      patch.topicId = topicId || null;
      patch.subtopicId = null; // смена темы сбрасывает подтему (rule 50 каскад)
    }
    if (subtopicId !== KEEP) patch.subtopicId = subtopicId || null;
    if (exam !== KEEP) patch.exam = exam as ReviewOverrides['exam'];
    if (sourceLabel.trim() !== '') patch.sourceLabel = sourceLabel.trim();
    if (kimNumber.trim() !== '') {
      // Смена КИМ сбрасывает балл (как per-row правка) + provenance 'manual'.
      patch.kimNumber = kimNumber.trim();
      patch.primaryScore = '';
      patch.kimSource = 'manual';
    }
    onApply(patch);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-socrat-border bg-slate-50/70 px-3 py-2">
      <span className="text-xs font-semibold text-slate-600">
        Выбрано: {selectedCount} из {totalCount}
      </span>
      <button
        type="button"
        disabled={disabled}
        onClick={selectedCount === totalCount ? onDeselectAll : onSelectAll}
        className="inline-flex items-center gap-1 text-xs font-medium text-socrat-primary hover:underline [touch-action:manipulation]"
      >
        {selectedCount === totalCount ? (
          <>
            <Square className="h-3.5 w-3.5" aria-hidden="true" />
            Снять все
          </>
        ) : (
          <>
            <CheckSquare className="h-3.5 w-3.5" aria-hidden="true" />
            Выбрать все
          </>
        )}
      </button>
      {dupCount > 0 ? (
        <button
          type="button"
          disabled={disabled}
          onClick={onDeselectDups}
          className="text-xs font-medium text-amber-700 hover:underline [touch-action:manipulation]"
        >
          Снять дубликаты ({dupCount})
        </button>
      ) : null}

      <span className="mx-1 hidden h-5 w-px bg-socrat-border sm:block" aria-hidden="true" />

      {showTaxonomy ? (
        <select
          value={topicId}
          disabled={disabled}
          onChange={(e) => {
            setTopicId(e.target.value);
            setSubtopicId(KEEP);
          }}
          className={SELECT_CLASS}
          aria-label="Тема для выбранных"
        >
          <option value={KEEP}>Тема: не менять</option>
          <option value="">Тема: убрать</option>
          {topicOptions.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      ) : null}

      {showTaxonomy && topicId !== KEEP && topicId !== '' ? (
        <select
          value={subtopicId}
          disabled={disabled}
          onChange={(e) => setSubtopicId(e.target.value)}
          className={SELECT_CLASS}
          aria-label="Подтема для выбранных"
        >
          <option value={KEEP}>Подтема: не менять</option>
          <option value="">Подтема: убрать</option>
          {subtopics.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      ) : null}

      <select
        value={exam}
        disabled={disabled}
        onChange={(e) => setExam(e.target.value)}
        className={SELECT_CLASS}
        aria-label="Экзамен для выбранных"
      >
        <option value={KEEP}>Экзамен: не менять</option>
        <option value="">Экзамен: убрать</option>
        <option value="ege">ЕГЭ</option>
        <option value="oge">ОГЭ</option>
      </select>

      <input
        type="text"
        inputMode="numeric"
        value={kimNumber}
        disabled={disabled}
        onChange={(e) => setKimNumber(e.target.value.replace(/\D/g, ''))}
        placeholder="КИМ: не менять"
        className={cn(SELECT_CLASS, 'w-32')}
        aria-label="№ КИМ для выбранных"
      />

      {showTaxonomy ? (
        <>
          <input
            type="text"
            value={sourceLabel}
            disabled={disabled}
            onChange={(e) => setSourceLabel(e.target.value)}
            list="kb-bulk-sources"
            placeholder="Источник: не менять"
            className={cn(SELECT_CLASS, 'w-44')}
            aria-label="Источник для выбранных"
          />
          <datalist id="kb-bulk-sources">
            {sources.map((s) => (
              <option key={s.id} value={s.name} />
            ))}
          </datalist>
        </>
      ) : null}

      <button
        type="button"
        disabled={disabled || !hasPatch || selectedCount === 0}
        onClick={handleApply}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-lg bg-socrat-primary px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-socrat-primary-dark [touch-action:manipulation]',
          (disabled || !hasPatch || selectedCount === 0) && 'cursor-not-allowed opacity-50',
        )}
      >
        <Wand2 className="h-3.5 w-3.5" aria-hidden="true" />
        Применить к выбранным ({selectedCount})
      </button>
    </div>
  );
}
