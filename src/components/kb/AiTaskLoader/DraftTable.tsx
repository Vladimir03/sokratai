import { memo } from 'react';
import { AlertTriangle, Check, ChevronDown, Image as ImageIcon, Trash2, X } from 'lucide-react';
import { stripLatex } from '@/components/kb/ui/stripLatex';
import { getKimPrimaryScoreForSubject } from '@/lib/kbKimScores';
import { cn } from '@/lib/utils';
import type { ExtractedTask } from '@/lib/kbAiExtractApi';
import type { KBTopicWithCounts } from '@/types/kb';
import type { CropState, ReviewOverrides, RowStatus } from '@/components/kb/AiTaskLoader/reviewTypes';

/**
 * Таблица пакетного ревью черновиков AI-загрузчика (волна 2, #54 — лидеры
 * грузят 10–30 задач за прогон, карточки не масштабируются).
 *
 * Safari/iOS (rule 80): `border-separate border-spacing-0` (sticky на thead в
 * WebKit ломается при border-collapse), `<colgroup>` + `table-layout: fixed` +
 * `width: max-content` (min-width на td игнорируется table-алгоритмом),
 * `touch-pan-x` на скролл-обёртке (в строках есть onClick), 16px inputs.
 *
 * Expand-строка = DraftCard (детальный редактор) — рендерит родитель через
 * renderExpanded (render-prop, чтобы не проносить сюда все пропсы карточки).
 */

const CELL_INPUT_CLASS =
  'w-full rounded-md border border-socrat-border px-2 py-1.5 text-[16px] transition-colors focus:border-socrat-primary/50 focus:outline-none [touch-action:manipulation]';

interface DraftRowProps {
  index: number;
  draft: ExtractedTask;
  override: ReviewOverrides;
  crop: CropState | null;
  status: RowStatus;
  selected: boolean;
  expanded: boolean;
  subject: string;
  topics: KBTopicWithCounts[];
  disabled: boolean;
  /** hw-режим загрузчика: колонка «Тема» скрыта (KB-таксономия не нужна в ДЗ). */
  showTopicColumn: boolean;
  onToggleSelect: (i: number) => void;
  onToggleExpand: (i: number) => void;
  onRemove: (i: number) => void;
  onChangeDraft: (i: number, patch: Partial<ExtractedTask>) => void;
  onChangeOverride: (i: number, patch: Partial<ReviewOverrides>) => void;
}

const DraftRow = memo(function DraftRow({
  index,
  draft,
  override,
  crop,
  status,
  selected,
  expanded,
  subject,
  topics,
  disabled,
  showTopicColumn,
  onToggleSelect,
  onToggleExpand,
  onRemove,
  onChangeDraft,
  onChangeOverride,
}: DraftRowProps) {
  const answerEmpty = !draft.answer || draft.answer.trim() === '';
  const kimNum = override.kimNumber.trim() ? parseInt(override.kimNumber.trim(), 10) : null;
  const autoScore = getKimPrimaryScoreForSubject(subject, override.exam || null, kimNum);
  const topicUnmatched = !override.topicId && draft.topic_suggestion.trim() !== '';
  // Темы ЕГЭ/ОГЭ дублируются по именам — при заданном экзамене скоупим список.
  const topicOptions = override.exam ? topics.filter((t) => t.exam === override.exam) : topics;
  const hasImage = draft.attachment_ref !== null;
  const hasCrop = hasImage && crop !== null && crop.status !== 'full' && crop.bbox !== null;

  return (
    <>
      <tr
        className={cn(
          'border-b border-socrat-border/60 align-top',
          status === 'saved' && 'bg-emerald-50/50',
          status === 'failed' && 'bg-red-50/50',
        )}
      >
        {/* ☑ */}
        <td className="px-2 py-2 text-center">
          <input
            type="checkbox"
            checked={selected}
            disabled={disabled || status === 'saved'}
            onChange={() => onToggleSelect(index)}
            className="mt-1 h-4 w-4 accent-socrat-primary [touch-action:manipulation]"
            aria-label={`Выбрать задачу ${index + 1}`}
          />
        </td>
        {/* № */}
        <td className="px-1 py-2.5 text-center text-xs font-semibold text-slate-500">{index + 1}</td>
        {/* Условие (read-only preview; клик = expand) */}
        <td
          className="cursor-pointer px-2 py-2.5"
          onClick={() => onToggleExpand(index)}
        >
          <span className="line-clamp-2 text-[13px] leading-snug text-slate-800">
            {stripLatex(draft.text) || '—'}
          </span>
        </td>
        {/* Ответ */}
        <td className="px-1.5 py-2">
          <input
            type="text"
            value={draft.answer ?? ''}
            disabled={disabled}
            onChange={(e) => onChangeDraft(index, { answer: e.target.value })}
            placeholder={answerEmpty ? '—' : ''}
            className={cn(
              CELL_INPUT_CLASS,
              answerEmpty && 'border-amber-300 bg-amber-50/40',
            )}
            aria-label={`Ответ задачи ${index + 1}`}
          />
        </td>
        {/* Экзамен */}
        <td className="px-1.5 py-2">
          <select
            value={override.exam}
            disabled={disabled}
            onChange={(e) =>
              onChangeOverride(index, { exam: e.target.value as ReviewOverrides['exam'] })
            }
            className={CELL_INPUT_CLASS}
            aria-label={`Экзамен задачи ${index + 1}`}
          >
            <option value="">—</option>
            <option value="ege">ЕГЭ</option>
            <option value="oge">ОГЭ</option>
          </select>
        </td>
        {/* КИМ */}
        <td className="px-1.5 py-2">
          <input
            type="text"
            inputMode="numeric"
            value={override.kimNumber}
            disabled={disabled}
            onChange={(e) =>
              onChangeOverride(index, {
                kimNumber: e.target.value.replace(/\D/g, ''),
                primaryScore: '',
              })
            }
            className={CELL_INPUT_CLASS}
            aria-label={`№ КИМ задачи ${index + 1}`}
          />
        </td>
        {/* Балл */}
        <td className="px-1.5 py-2">
          <input
            type="text"
            inputMode="numeric"
            value={override.primaryScore}
            disabled={disabled}
            onChange={(e) =>
              onChangeOverride(index, { primaryScore: e.target.value.replace(/\D/g, '') })
            }
            placeholder={autoScore != null ? String(autoScore) : ''}
            className={CELL_INPUT_CLASS}
            aria-label={`Балл задачи ${index + 1}`}
          />
        </td>
        {/* Тема (скрыта в hw-режиме) */}
        {showTopicColumn ? (
          <td className="px-1.5 py-2">
            <select
              value={override.topicId ?? ''}
              disabled={disabled}
              onChange={(e) =>
                onChangeOverride(index, { topicId: e.target.value || null, subtopicId: null })
              }
              className={cn(CELL_INPUT_CLASS, topicUnmatched && 'border-amber-300 bg-amber-50/40')}
              aria-label={`Тема задачи ${index + 1}`}
            >
              <option value="">{topicUnmatched ? `AI: «${draft.topic_suggestion}»` : 'Не выбрана'}</option>
              {topicOptions.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </td>
        ) : null}
        {/* Статус */}
        <td className="px-1.5 py-2.5">
          <span className="flex flex-wrap items-center gap-1">
            {status === 'saved' ? (
              <span className="inline-flex items-center gap-0.5 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                <Check className="h-3 w-3" aria-hidden="true" />
                сохранено
              </span>
            ) : null}
            {status === 'failed' ? (
              <span className="inline-flex items-center gap-0.5 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">
                <X className="h-3 w-3" aria-hidden="true" />
                ошибка
              </span>
            ) : null}
            {draft.fingerprint_match ? (
              <span
                className="inline-flex items-center gap-0.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700"
                title="Похоже, такая задача уже есть — раскройте строку"
              >
                <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                дубль
              </span>
            ) : null}
            {answerEmpty ? (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                без ответа
              </span>
            ) : null}
            {hasImage ? (
              <span
                className="inline-flex items-center gap-0.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600"
                title={hasCrop ? 'Рисунок будет вырезан рамкой' : 'Прикреплён рисунок'}
              >
                <ImageIcon className="h-3 w-3" aria-hidden="true" />
                {hasCrop ? 'кроп' : 'фото'}
              </span>
            ) : null}
          </span>
        </td>
        {/* ⌄ раскрыть + ✕ удалить */}
        <td className="px-1 py-2">
          <div className="flex items-center justify-center gap-0.5">
            <button
              type="button"
              onClick={() => onToggleExpand(index)}
              aria-expanded={expanded}
              aria-label={expanded ? 'Свернуть задачу' : 'Раскрыть задачу'}
              className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-socrat-surface hover:text-socrat-primary [touch-action:manipulation]"
            >
              <ChevronDown
                className={cn('h-4 w-4 transition-transform duration-200', expanded && 'rotate-180')}
                aria-hidden="true"
              />
            </button>
            {status !== 'saved' ? (
              <button
                type="button"
                onClick={() => onRemove(index)}
                disabled={disabled}
                aria-label={`Удалить задачу ${index + 1} из списка`}
                title="Удалить из списка"
                className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-40 [touch-action:manipulation]"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            ) : null}
          </div>
        </td>
      </tr>
    </>
  );
});

interface DraftTableProps {
  drafts: ExtractedTask[];
  overrides: ReviewOverrides[];
  crops: Array<CropState | null>;
  rowStatus: RowStatus[];
  selected: boolean[];
  /** Мягко удалённые строки — скрыты из таблицы (undo в родителе). */
  removed: boolean[];
  subject: string;
  topics: KBTopicWithCounts[];
  disabled: boolean;
  expandedIndex: number | null;
  onToggleSelect: (i: number) => void;
  onToggleExpand: (i: number) => void;
  onRemove: (i: number) => void;
  onChangeDraft: (i: number, patch: Partial<ExtractedTask>) => void;
  onChangeOverride: (i: number, patch: Partial<ReviewOverrides>) => void;
  /** Expand-row content (DraftCard) — рендерит родитель. */
  renderExpanded: (i: number) => React.ReactNode;
  /** hw-режим загрузчика: колонка «Тема» скрыта (default true — KB как раньше). */
  showTopicColumn?: boolean;
}

export function DraftTable({
  drafts,
  overrides,
  crops,
  rowStatus,
  selected,
  removed,
  subject,
  topics,
  disabled,
  expandedIndex,
  onToggleSelect,
  onToggleExpand,
  onRemove,
  onChangeDraft,
  onChangeOverride,
  renderExpanded,
  showTopicColumn = true,
}: DraftTableProps) {
  const headLabels = showTopicColumn
    ? ['', '№', 'Условие', 'Ответ', 'Экзамен', 'КИМ', 'Балл', 'Тема', 'Статус', '']
    : ['', '№', 'Условие', 'Ответ', 'Экзамен', 'КИМ', 'Балл', 'Статус', ''];
  return (
    // Свой вертикальный вьюпорт (ревью P2): `overflow-x-auto` делал контейнер
    // вертикальным scroll-блоком нулевой прокрутки → sticky-заголовок уезжал со
    // страницей. `max-h` + `overflow-auto` дают заголовку к чему прилипнуть.
    // touch-action по умолчанию (auto) — 2D-скролл + тап-по-строке (rule 80).
    <div className="max-h-[70vh] overflow-auto rounded-xl border border-socrat-border bg-white">
      <table
        className="border-separate border-spacing-0"
        style={{ tableLayout: 'fixed', width: 'max-content', minWidth: '100%' }}
      >
        <colgroup>
          <col style={{ width: '36px' }} />
          <col style={{ width: '36px' }} />
          <col style={{ width: '300px' }} />
          <col style={{ width: '130px' }} />
          <col style={{ width: '90px' }} />
          <col style={{ width: '70px' }} />
          <col style={{ width: '80px' }} />
          {showTopicColumn ? <col style={{ width: '190px' }} /> : null}
          <col style={{ width: '130px' }} />
          <col style={{ width: '68px' }} />
        </colgroup>
        <thead>
          <tr>
            {headLabels.map((label, i) => (
              <th
                key={i}
                className="sticky top-0 z-10 border-b border-socrat-border bg-slate-50 px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500"
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {drafts.map((draft, index) =>
            removed[index] ? null : (
              <FragmentRow
                key={index}
                index={index}
                draft={draft}
                override={overrides[index]}
                crop={crops[index] ?? null}
                status={rowStatus[index] ?? 'idle'}
                selected={selected[index] ?? false}
                expanded={expandedIndex === index}
                subject={subject}
                topics={topics}
                disabled={disabled}
                showTopicColumn={showTopicColumn}
                onToggleSelect={onToggleSelect}
                onToggleExpand={onToggleExpand}
                onRemove={onRemove}
                onChangeDraft={onChangeDraft}
                onChangeOverride={onChangeOverride}
                renderExpanded={renderExpanded}
              />
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Строка + опциональная expand-строка (colspan на всю ширину). */
function FragmentRow(props: DraftRowProps & { renderExpanded: (i: number) => React.ReactNode }) {
  const { renderExpanded, ...rowProps } = props;
  return (
    <>
      <DraftRow {...rowProps} />
      {props.expanded ? (
        <tr>
          <td
            colSpan={props.showTopicColumn ? 10 : 9}
            className="border-b border-socrat-border/60 bg-socrat-surface/40 p-3"
          >
            {renderExpanded(props.index)}
          </td>
        </tr>
      ) : null}
    </>
  );
}
