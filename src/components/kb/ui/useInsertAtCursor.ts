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
   * @param snippet     что вставить
   * @param caretFromEnd на сколько символов увести каретку влево от конца
   *                     вставки (например, внутрь `\frac{}{}`)
   * @param asBlock     гарантировать, что вставка стоит на ОТДЕЛЬНОЙ строке —
   *                    именно это превращает несколько формул в столбик
   *                    (см. preprocessLatex).
   */
  return useCallback(
    (snippet: string, caretFromEnd = 0, asBlock = true) => {
      const el = ref.current;
      if (!el) return;

      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? start;

      let text = snippet;
      if (asBlock) {
        const before = el.value.slice(0, start);
        const after = el.value.slice(end);
        // Начало строки? Если нет — переносим.
        if (before.length > 0 && !before.endsWith('\n')) text = `\n${text}`;
        // Хвост строки непустой? Тогда закрываем перенос.
        const restOfLine = after.slice(0, after.indexOf('\n') === -1 ? after.length : after.indexOf('\n'));
        if (restOfLine.trim().length > 0) text = `${text}\n`;
      }

      try {
        el.focus();
        el.setRangeText(text, start, end, 'end');
        el.dispatchEvent(new Event('input', { bubbles: true }));
        if (caretFromEnd > 0) {
          const pos = Math.max(0, (el.selectionStart ?? el.value.length) - caretFromEnd);
          el.setSelectionRange(pos, pos);
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
