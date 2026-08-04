/**
 * Кнопка «Уравнение» — вставка формулы в textarea без знания LaTeX
 * (решение владельца 2026-08-04 по репорту Ульяны, химия).
 *
 * Зачем: репетитор-химик писал уравнения руками в `$…$` и боролся с вёрсткой
 * («после знака доллар нужно ставить точку, чтобы был столбик»). Перенос строк
 * починен в `preprocessLatex`; здесь — вторая половина: не заставлять набирать
 * синтаксис вообще.
 *
 * Шаблоны — ВАНИЛЬНЫЙ KaTeX (`\rightarrow`, `_2`, `\downarrow`), без
 * расширения mhchem: оно даёт более приятный синтаксис `\ce{…}`, но проверить
 * его загрузку в нашей ленивой сборке я не смог (в Node katex резолвится в два
 * инстанса, и даже собственный `__defineMacro` не применяется), а отдавать
 * репетитору непроверенный рендер нельзя — без mhchem `\ce{…}` не падает с
 * ошибкой, а МОЛЧА рисует «ce» курсивом. Все шаблоны ниже прогнаны через
 * `katex.renderToString({throwOnError:true})`.
 *
 * ⚠️ Живёт в `kb/ui/`, а НЕ в `components/ui/*`: rule 50 запрещает тащить
 * MathText/KaTeX в shared-ui (вес бандла).
 */

import { useState } from 'react';
import { Sigma } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { MathText } from '@/components/kb/ui/MathText';
import { cn } from '@/lib/utils';

interface EquationTemplate {
  label: string;
  /** Тело формулы БЕЗ обрамляющих `$`. */
  tex: string;
  /** Смещение каретки от конца вставки (чтобы попасть внутрь скобок). */
  caretFromEnd?: number;
  chemistry?: boolean;
}

const TEMPLATES: EquationTemplate[] = [
  { label: 'Реакция', tex: '2H_2 + O_2 \\rightarrow 2H_2O', chemistry: true },
  { label: 'Обратимая', tex: 'N_2 + 3H_2 \\rightleftarrows 2NH_3', chemistry: true },
  {
    label: 'С осадком ↓',
    tex: 'AgNO_3 + NaCl \\rightarrow AgCl\\downarrow + NaNO_3',
    chemistry: true,
  },
  {
    label: 'С газом ↑ и нагревом',
    tex: 'CaCO_3 \\xrightarrow{t} CaO + CO_2\\uparrow',
    chemistry: true,
  },
  { label: 'Ион / заряд', tex: 'SO_4^{2-}', chemistry: true },
  { label: 'Дробь', tex: '\\frac{}{}', caretFromEnd: 3 },
  { label: 'Степень', tex: 'x^{2}', caretFromEnd: 1 },
  { label: 'Индекс', tex: 'H_{2}', caretFromEnd: 1 },
];

export function EquationButton({
  onInsert,
  subject,
  disabled,
  className,
}: {
  /**
   * Вставка готового текста. Компонент НЕ знает про textarea — вызывающая
   * сторона использует `useInsertAtCursor`.
   */
  onInsert: (snippet: string, caretFromEnd?: number) => void;
  /** Предмет — только для ПОРЯДКА шаблонов, не для гейта (см. ниже). */
  subject?: string | null;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  // По предмету НЕ гейтим: предмет может быть ещё не выбран, а физику `\frac`
  // интересует не меньше. Химику просто поднимаем его шаблоны наверх.
  const isChem = subject === 'chemistry';
  const ordered = isChem
    ? [...TEMPLATES].sort((a, b) => Number(!!b.chemistry) - Number(!!a.chemistry))
    : TEMPLATES;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          className={cn('h-8 gap-1.5 px-2 text-xs font-medium', className)}
        >
          <Sigma className="h-3.5 w-3.5" aria-hidden="true" />
          Уравнение
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[320px] p-2"
        // Без этого Radix забирает фокус себе, и вставка уезжает в позицию 0
        // (прецедент — MathQuickPicker).
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <p className="px-1 pb-1.5 text-[11px] leading-snug text-slate-500">
          Каждое уравнение — с новой строки, они встанут столбиком.
        </p>
        <div className="flex flex-col gap-0.5">
          {ordered.map((t) => (
            <button
              key={t.label}
              type="button"
              onClick={() => {
                onInsert(`$${t.tex}$`, t.caretFromEnd);
                setOpen(false);
              }}
              className="flex min-h-9 items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <span className="shrink-0 text-slate-600 dark:text-slate-300">{t.label}</span>
              <MathText
                text={`$${t.tex}$`}
                className="min-w-0 truncate text-slate-900 dark:text-slate-100"
                as="span"
              />
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
