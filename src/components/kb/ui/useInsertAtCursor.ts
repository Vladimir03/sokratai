/**
 * Вставка текста в `<textarea>` по позиции каретки — headless-хук.
 *
 * Общего компонента textarea в редакторах задач нет (четыре редактора пишут
 * сырой `<textarea>` двумя разными наборами классов), поэтому единицей
 * переиспользования выбран не компонент поля, а сама вставка.
 *
 * ⚠️ Ручной `dispatchEvent('input')` ОБЯЗАТЕЛЕН: Safari не генерирует `input`
 * из `setRangeText`, и без него React-стейт контролируемого поля никогда не
 * узнает о вставке (текст мелькнёт и пропадёт на следующем рендере). Паттерн
 * взят один-в-один из `HomeworkProblem.tsx::insertMathSnippet` — он уже
 * проверен на живых учениках.
 */

import { useCallback, type RefObject } from 'react';

export function useInsertAtCursor(
  ref: RefObject<HTMLTextAreaElement | null>,
) {
  /**
   * @param snippet что вставить
   * @param opts.selectStart / selectEnd — что выделить ПОСЛЕ вставки, в
   *   координатах САМОГО сниппета (0 = его первый символ). Равные значения =
   *   просто каретка. Не задано — каретка в конец вставки.
   *
   *   ⚠️ Раньше здесь был «отступ от конца» (`caretFromEnd`), и он врал: у
   *   `$\frac{}{}$` каретка вставала между `}` и `{` (получалось
   *   `\frac{}2{}`), у степени/индекса — за закрывающей скобкой. Плюс
   *   добавленный перенос строки сдвигал отсчёт. Абсолютные координаты
   *   сниппета от этого не зависят (ревью 5.6 P2).
   * @param opts.asBlock гарантировать, что вставка стоит на ОТДЕЛЬНОЙ строке —
   *   именно это превращает несколько формул в столбик (см. preprocessLatex).
   */
  return useCallback(
    (
      snippet: string,
      opts?: { selectStart?: number; selectEnd?: number; asBlock?: boolean },
    ) => {
      const el = ref.current;
      if (!el) return;
      const asBlock = opts?.asBlock ?? true;

      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? start;

      let text = snippet;
      // Сколько символов дописано ПЕРЕД сниппетом — на столько сдвинуты все
      // его внутренние координаты.
      let prefixLen = 0;
      if (asBlock) {
        const before = el.value.slice(0, start);
        const after = el.value.slice(end);
        // Начало строки? Если нет — переносим.
        if (before.length > 0 && !before.endsWith('\n')) {
          text = `\n${text}`;
          prefixLen = 1;
        }
        // Хвост строки непустой? Тогда закрываем перенос.
        const nl = after.indexOf('\n');
        const restOfLine = after.slice(0, nl === -1 ? after.length : nl);
        if (restOfLine.trim().length > 0) text = `${text}\n`;
      }

      try {
        el.focus();
        el.setRangeText(text, start, end, 'end');
        el.dispatchEvent(new Event('input', { bubbles: true }));
        if (opts?.selectStart !== undefined) {
          const base = start + prefixLen;
          const from = base + opts.selectStart;
          const to = base + (opts.selectEnd ?? opts.selectStart);
          el.setSelectionRange(from, to);
        }
      } catch {
        // Очень старый Safari: setRangeText может бросить — дописываем в конец.
        el.value = `${el.value}${text}`;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    },
    [ref],
  );
}
