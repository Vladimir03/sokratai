import { useEffect, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import {
  formatAnswerNumber,
  parseAnswerNumber,
  parseAnswerSpec,
  serializeAnswerParts,
} from '@/lib/answerAlternatives';
import { cn } from '@/lib/utils';

/**
 * Поле «Ответ» с несколькими допустимыми вариантами + диапазоном «от–до»
 * (#61, Егор, 2026-07-11): показания прибора «так или так», координата
 * с графика «примерно считывается».
 *
 * Владеет ТОЛЬКО представлением: наружу отдаёт сериализованную строку в
 * существующее текстовое поле ответа (`serializeAnswerParts` / en-dash
 * диапазон) — хранение и грейдинг живут на конвенции `answerAlternatives`.
 */

interface Row {
  id: number;
  mode: 'exact' | 'range';
  value: string;
  from: string;
  to: string;
}

// Монотонный счётчик id (НЕ crypto.randomUUID — Safari < 15.4, rule 80).
let nextRowId = 1;

function makeRow(partial: Partial<Row>): Row {
  return { id: nextRowId++, mode: 'exact', value: '', from: '', to: '', ...partial };
}

function rowsFromValue(value: string): Row[] {
  const spec = parseAnswerSpec(value);
  if (!spec) return [makeRow({})];
  return spec.alternatives.map((a) =>
    a.type === 'range'
      ? makeRow({ mode: 'range', from: formatAnswerNumber(a.min), to: formatAnswerNumber(a.max) })
      : makeRow({ value: a.value }),
  );
}

function serializeRow(row: Row): string {
  if (row.mode === 'range') {
    const from = row.from.trim();
    const to = row.to.trim();
    // Неполный/невалидный диапазон не сериализуем — строка уйдёт при заполнении.
    if (!from || !to) return '';
    return `${from}–${to}`;
  }
  return row.value.trim();
}

function serializeRows(rows: Row[]): string {
  return serializeAnswerParts(rows.map(serializeRow));
}

/** Валиден ли диапазон строки (для amber-подсказки). */
function rangeIssue(row: Row): string | null {
  if (row.mode !== 'range') return null;
  const from = row.from.trim();
  const to = row.to.trim();
  if (!from && !to) return null; // пустой — просто не сериализуется
  const min = from ? parseAnswerNumber(from) : null;
  const max = to ? parseAnswerNumber(to) : null;
  if (from && min == null) return 'Границы диапазона — числа (например 2,1)';
  if (to && max == null) return 'Границы диапазона — числа (например 2,3)';
  if (min != null && max != null && min >= max) return 'Левая граница должна быть меньше правой';
  if (!from || !to) return 'Заполните обе границы диапазона';
  return null;
}

const INPUT_CLASS =
  'w-full rounded-lg border border-socrat-border px-3 py-2 text-[16px] transition-colors duration-200 placeholder:text-socrat-muted focus:border-socrat-primary/50 focus:outline-none';

interface AnswerAlternativesFieldProps {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}

export function AnswerAlternativesField({ value, onChange, disabled = false }: AnswerAlternativesFieldProps) {
  const [rows, setRows] = useState<Row[]>(() => rowsFromValue(value));
  // Последнее сериализованное значение, отданное наружу: внешняя смена value
  // (prefill / сброс серии) пересобирает строки; наши собственные emit'ы — нет
  // (иначе неполный диапазон «2,1–» схлопывался бы при каждом нажатии).
  const lastEmittedRef = useRef(value);

  useEffect(() => {
    if (value !== lastEmittedRef.current) {
      lastEmittedRef.current = value;
      setRows(rowsFromValue(value));
    }
  }, [value]);

  const apply = (next: Row[]) => {
    setRows(next);
    const serialized = serializeRows(next);
    lastEmittedRef.current = serialized;
    onChange(serialized);
  };

  const updateRow = (id: number, patch: Partial<Row>) => {
    apply(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const removeRow = (id: number) => {
    const next = rows.filter((r) => r.id !== id);
    apply(next.length > 0 ? next : [makeRow({})]);
  };

  const toggleMode = (row: Row) => {
    if (row.mode === 'exact') {
      // Числовое значение переносим в левую границу — меньше перепечатывания.
      const seed = parseAnswerNumber(row.value) != null ? row.value.trim() : '';
      updateRow(row.id, { mode: 'range', from: seed, to: '', value: '' });
    } else {
      updateRow(row.id, { mode: 'exact', value: row.from.trim(), from: '', to: '' });
    }
  };

  const multiActive = rows.length > 1 || rows.some((r) => r.mode === 'range');

  return (
    <div className="space-y-2">
      {rows.map((row, index) => {
        const issue = rangeIssue(row);
        return (
          <div key={row.id}>
            <div className="flex items-center gap-2">
              {row.mode === 'exact' ? (
                <input
                  type="text"
                  value={row.value}
                  onChange={(e) => updateRow(row.id, { value: e.target.value })}
                  placeholder={index === 0 ? 'Правильный ответ' : 'Ещё один допустимый ответ'}
                  disabled={disabled}
                  className={INPUT_CLASS}
                />
              ) : (
                <div className="flex min-w-0 flex-1 items-center gap-1.5">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={row.from}
                    onChange={(e) => updateRow(row.id, { from: e.target.value })}
                    placeholder="от (2,1)"
                    disabled={disabled}
                    aria-label="Диапазон: от"
                    className={INPUT_CLASS}
                  />
                  <span className="shrink-0 text-sm text-slate-400">–</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={row.to}
                    onChange={(e) => updateRow(row.id, { to: e.target.value })}
                    placeholder="до (2,3)"
                    disabled={disabled}
                    aria-label="Диапазон: до"
                    className={INPUT_CLASS}
                  />
                </div>
              )}

              <button
                type="button"
                disabled={disabled}
                onClick={() => toggleMode(row)}
                title={
                  row.mode === 'exact'
                    ? 'Сделать диапазоном «от–до» (зачтётся любое число в пределах)'
                    : 'Вернуть одно значение'
                }
                className="shrink-0 rounded-md border border-socrat-border px-2 py-1.5 text-[11px] font-medium text-slate-500 transition-colors hover:border-socrat-primary/40 hover:text-socrat-primary [touch-action:manipulation]"
              >
                {row.mode === 'exact' ? 'от–до' : 'одно значение'}
              </button>

              {rows.length > 1 ? (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => removeRow(row.id)}
                  aria-label="Убрать вариант ответа"
                  className="shrink-0 rounded-md p-1.5 text-slate-400 transition-colors hover:bg-socrat-surface hover:text-red-500 [touch-action:manipulation]"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>
            {issue ? <p className="mt-1 text-xs text-amber-600">{issue}</p> : null}
          </div>
        );
      })}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button"
          disabled={disabled}
          onClick={() => apply([...rows, makeRow({})])}
          className={cn(
            'inline-flex items-center gap-1 text-xs font-medium text-socrat-primary hover:underline [touch-action:manipulation]',
            disabled && 'cursor-not-allowed opacity-50',
          )}
        >
          <Plus className="h-3.5 w-3.5" />
          Добавить вариант ответа
        </button>
        {multiActive ? (
          <span className="text-[11px] text-slate-400">Зачтётся любой из вариантов</span>
        ) : null}
      </div>
    </div>
  );
}
