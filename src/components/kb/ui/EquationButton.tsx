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
 * MathText/KaTeX в shared-ui (вес бандла). KaTeX внутри `MathText` ленив —
 * грузится только при открытии попапа, не при монтировании редактора.
 *
 * Поверхности (2026-08-07): редактор варианта пробника · конструктор ДЗ
 * (условие + эталонное решение) · База знаний (создание и редактирование
 * задачи: условие + решение). Новый редактор задачи → добавляй сюда же,
 * `useInsertAtCursor` headless и подходит к любому сырому `<textarea>`.
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
  /**
   * Что выделить после вставки — координаты в ГОТОВОМ сниппете `$tex$`
   * (0 = открывающий `$`). Равные значения = просто каретка. Не задано —
   * каретка в конец. Считать по строке целиком, не «от конца»: перенос,
   * который хук может дописать перед вставкой, отсчёт от конца ломал.
   */
  selectStart?: number;
  selectEnd?: number;
  chemistry?: boolean;
}

// `$` + tex + `$`. Индексы ниже посчитаны по этой строке.
//
// Порядок ФИКСИРОВАННЫЙ и не зависит от предмета (решение владельца
// 2026-08-07): сначала общая математика — она нужна физику, математику И
// химику, — а реакции отдельной группой ниже. Прежняя сортировка «химику
// поднимаем химию наверх» делала кнопку химической на вид, хотя кнопка теперь
// стоит во всех редакторах задач, а не только в вариантах пробников.
const TEMPLATES: EquationTemplate[] = [
  // `$\frac{}{}$` → каретка ВНУТРЬ первых скобок (индекс 7).
  { label: 'Дробь', tex: '\\frac{}{}', selectStart: 7 },
  // `$x^{2}$` → выделяем «2», чтобы ввод сразу его заменил (4..5).
  { label: 'Степень', tex: 'x^{2}', selectStart: 4, selectEnd: 5 },
  // `$x_{1}$` → то же. Основание нейтральное (не `H_2`): индекс одинаково
  // нужен физике (v₀) и математике, химия набирается шаблонами реакций.
  { label: 'Индекс', tex: 'x_{1}', selectStart: 4, selectEnd: 5 },
  // `$\sqrt{}$` → каретка внутрь скобок (индекс 7), как у дроби.
  { label: 'Корень', tex: '\\sqrt{}', selectStart: 7 },
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
];

export function EquationButton({
  onInsert,
  disabled,
  className,
}: {
  /**
   * Вставка готового текста. Компонент НЕ знает про textarea — вызывающая
   * сторона использует `useInsertAtCursor`.
   */
  onInsert: (
    snippet: string,
    opts?: { selectStart?: number; selectEnd?: number },
  ) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  // По предмету НЕ гейтим и НЕ сортируем: предмет часто ещё не выбран, а
  // `\frac` нужен всем. Две группы фиксированным порядком — общая и химия.
  const common = TEMPLATES.filter((t) => !t.chemistry);
  const chemistry = TEMPLATES.filter((t) => t.chemistry);

  const renderTemplate = (t: EquationTemplate) => (
    <button
      key={t.label}
      type="button"
      onClick={() => {
        onInsert(`$${t.tex}$`, {
          selectStart: t.selectStart,
          selectEnd: t.selectEnd,
        });
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
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          // 44px на телефоне (тач-цель), канонические 36px на десктопе.
          // Прежние 32px были ниже даже размера `sm` у нашей кнопки.
          className={cn(
            'h-11 gap-1.5 px-2 text-xs font-medium touch-manipulation md:h-9',
            className,
          )}
        >
          <Sigma className="h-3.5 w-3.5" aria-hidden="true" />
          Уравнение
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        // Список вырос до 9 шаблонов + заголовок группы: на телефоне (тем более
        // с открытой клавиатурой) он перестаёт помещаться, и нижние химические
        // строки становятся недостижимы — у Radix своего скролла нет.
        // Фолбэк 24rem — на случай, если переменная Radix не выставлена
        // (ревью 5.6 P1, 2026-08-07).
        className="max-h-[var(--radix-popover-content-available-height,24rem)] w-[320px] overflow-y-auto overscroll-contain p-2"
        // Без этого Radix забирает фокус себе, и вставка уезжает в позицию 0
        // (прецедент — MathQuickPicker).
        onOpenAutoFocus={(e) => e.preventDefault()}
        // А без этого на закрытии фокус возвращается на кнопку-триггер и
        // сбивает только что выставленное выделение в textarea (ревью 5.6 P2).
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <p className="px-1 pb-1.5 text-[11px] leading-snug text-slate-500">
          Каждое уравнение — с новой строки, они встанут столбиком.
        </p>
        <div className="flex flex-col gap-0.5">{common.map(renderTemplate)}</div>
        {chemistry.length > 0 && (
          <>
            <p className="mt-1.5 border-t border-slate-100 px-1 pb-0.5 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:border-slate-800">
              Химия
            </p>
            <div className="flex flex-col gap-0.5">{chemistry.map(renderTemplate)}</div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
