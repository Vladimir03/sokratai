// options_json (2026-07-27, спека homework-choice-tasks): панель выбора
// вариантов структурного теста. Заменяет текстовый ввод ответа, когда у задачи
// есть валидный options_json; выбор сериализуется в строку и уходит СУЩЕСТВУЮЩИМ
// каналом ответа (checkAnswer / submission) — ни нового endpoint'а, ни нового
// message-типа. Балл считает сервер детерминированно (чекеры пробников).
//
// rule 80/90: 16px текст, ≥44px targets, без drag-drop (matching = селекты),
// touch-action: manipulation. Radix Checkbox не нужен — свой стилизованный
// индикатор (нативный input невидим под глобальным reset — прецедент
// GroupMembersEditor 2026-07-27).
import { memo, useMemo, useState } from 'react';
import { Check, Send } from 'lucide-react';
import { serializeChoiceSelection, type TaskOptions } from '@/lib/taskOptions';
import { cn } from '@/lib/utils';

interface StructuredAnswerPanelProps {
  options: TaskOptions;
  disabled?: boolean;
  isSubmitting?: boolean;
  /**
   * Самостоятельная работа: ответ уходит одноразовым сабмитом. Меняет надпись
   * CTA и добавляет предупреждение — иначе «Ответить» выглядело как обычная
   * проверка с попытками (ревью 5.6).
   */
  isIndependent?: boolean;
  /** Сериализованный выбор («2» / «1, 2, 6, 7» / «35142») → существующий канал. */
  onSubmit: (serialized: string) => void;
}

/** Подпись варианта в списке правого столбца matching (native select). */
const MAX_OPTION_LABEL_CHARS = 40;
function optionLabel(key: string, text: string): string {
  const clipped =
    text.length > MAX_OPTION_LABEL_CHARS ? `${text.slice(0, MAX_OPTION_LABEL_CHARS - 1)}…` : text;
  return `${key} — ${clipped}`;
}

function ChoiceIndicator({ checked, round }: { checked: boolean; round: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex h-5 w-5 shrink-0 items-center justify-center border transition-colors',
        round ? 'rounded-full' : 'rounded-[5px]',
        checked ? 'border-accent bg-accent text-white' : 'border-slate-300 bg-white',
      )}
    >
      {checked ? (round ? <span className="h-2 w-2 rounded-full bg-white" /> : <Check className="h-3.5 w-3.5" />) : null}
    </span>
  );
}

export const StructuredAnswerPanel = memo(function StructuredAnswerPanel({
  options,
  disabled = false,
  isSubmitting = false,
  isIndependent = false,
  onSubmit,
}: StructuredAnswerPanelProps) {
  // single/multi: выбранные ключи вариантов; matching: leftKey → rightKey.
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [matches, setMatches] = useState<Record<string, string>>({});

  const isMatching = options.kind === 'matching';
  const isSingle = options.kind === 'single_choice';

  const canSubmit = useMemo(() => {
    if (disabled || isSubmitting) return false;
    if (isMatching) {
      return options.kind === 'matching' && options.left.every((l) => Boolean(matches[l.key]));
    }
    return selectedKeys.length > 0;
  }, [disabled, isSubmitting, isMatching, options, matches, selectedKeys]);

  const toggleKey = (key: string) => {
    if (disabled || isSubmitting) return;
    setSelectedKeys((prev) => {
      if (isSingle) return prev.includes(key) ? [] : [key];
      return prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
    });
  };

  const handleSubmit = () => {
    if (!canSubmit) return;
    const selection = isMatching && options.kind === 'matching'
      ? options.left.map((l) => matches[l.key] ?? '')
      : selectedKeys;
    onSubmit(serializeChoiceSelection(options, selection));
  };

  return (
    <div className="shrink-0 border-t border-socrat-border-light bg-white px-2.5 pb-2.5 pt-2">
      <p className="mb-1.5 px-1 text-[13px] font-medium text-slate-500">
        {isMatching
          ? 'Установи соответствие: для каждой позиции выбери вариант'
          : isSingle
            ? 'Выбери один вариант ответа'
            : 'Выбери все правильные варианты'}
      </p>

      {options.kind === 'matching' ? (
        <div className="flex flex-col gap-1.5">
          {/* Правый столбец — ПОСТОЯННО на экране: спрятанный в <details> он
              заставлял держать соответствия в памяти и прокручивать (ревью 5.6). */}
          <ul className="rounded-lg border border-socrat-border-light bg-slate-50 px-2.5 py-1.5 text-[13px] text-slate-600">
            {options.right.map((r) => (
              <li key={r.key}>
                <b>{r.key})</b> {r.text}
              </li>
            ))}
          </ul>
          {options.left.map((l) => (
            <div key={l.key} className="flex min-h-[44px] items-center gap-2">
              <span className="min-w-0 flex-1 text-base text-slate-800">
                <b className="mr-1">{l.key})</b>
                {l.text}
              </span>
              <select
                value={matches[l.key] ?? ''}
                disabled={disabled || isSubmitting}
                onChange={(e) => setMatches((prev) => ({ ...prev, [l.key]: e.target.value }))}
                aria-label={`Соответствие для ${l.key}`}
                className="h-11 w-[132px] shrink-0 rounded-md border border-socrat-border bg-white px-2 text-base text-slate-800 focus:border-accent focus:outline-none"
                style={{ fontSize: 16, touchAction: 'manipulation' }}
              >
                <option value="">—</option>
                {options.right.map((r) => (
                  // Подпись «1 — текст»: в закрытом виде обрезается, в нативном
                  // пикере ученик видит формулировку и не листает экран.
                  <option key={r.key} value={r.key}>{optionLabel(r.key, r.text)}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-1" role={isSingle ? 'radiogroup' : 'group'}>
          {options.options.map((o) => {
            const checked = selectedKeys.includes(o.key);
            return (
              <button
                key={o.key}
                type="button"
                role={isSingle ? 'radio' : 'checkbox'}
                aria-checked={checked}
                disabled={disabled || isSubmitting}
                onClick={() => toggleKey(o.key)}
                className={cn(
                  'flex min-h-[44px] w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-base transition-colors',
                  checked ? 'border-accent bg-accent/5' : 'border-socrat-border bg-white hover:bg-slate-50',
                  (disabled || isSubmitting) && 'opacity-60',
                )}
                style={{ touchAction: 'manipulation' }}
              >
                <ChoiceIndicator checked={checked} round={isSingle} />
                <span className="min-w-0 text-slate-800">
                  <b className="mr-1.5">{o.key})</b>
                  {o.text}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit}
        className={cn(
          'mt-2 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg text-base font-medium text-white transition-colors',
          canSubmit ? 'bg-accent hover:bg-accent/90' : 'cursor-default bg-slate-300',
        )}
        style={{ touchAction: 'manipulation' }}
      >
        <Send className="h-4 w-4" aria-hidden="true" />
        {isSubmitting ? (isIndependent ? 'Отправляем…' : 'Проверяем…') : isIndependent ? 'Сдать ответ' : 'Ответить'}
      </button>
      {isIndependent ? (
        <p className="mt-1 px-1 text-center text-[12px] text-slate-500">
          Одна попытка — изменить ответ после отправки нельзя.
        </p>
      ) : null}
    </div>
  );
});
