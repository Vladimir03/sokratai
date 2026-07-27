// Валидация поля «Ответ» у структурной задачи (options_json) на репетиторских
// формах (корзина «В ДЗ», конструктор ДЗ). Чекеры посимвольные: ключ вне
// списка вариантов («6» при пяти вариантах) означает, что ВЕРНЫЙ выбор ученика
// молча оценится в ноль — поэтому мусор не даём сохранить (решение владельца,
// 2026-07-28).
//
// Клиентский модуль поверх канона src/lib/taskOptions.ts. НЕ зеркалится в Deno:
// сервер защищён нормализатором options_json, а битый correct_answer на входе
// сервер не чинит — гигиена формы живёт здесь.
import { compactChoiceAnswer, type TaskOptions } from '@/lib/taskOptions';

/**
 * null — ответ согласован с вариантами; иначе русская фраза для формы.
 * Разделители («1, 2», «1;2») допустимы — чекеры их тоже игнорируют.
 */
export function validateStructuredAnswer(
  options: TaskOptions,
  rawAnswer: string | null | undefined,
): string | null {
  const compact = compactChoiceAnswer(String(rawAnswer ?? ''));
  if (!compact) return 'Укажи правильный ответ — без него тест не проверяется.';

  if (options.kind === 'matching') {
    const rightKeys = new Set(options.right.map((o) => o.key.toLowerCase()));
    const bad = [...compact].filter((ch) => !rightKeys.has(ch.toLowerCase()));
    if (bad.length > 0) {
      return `В ответе есть «${bad.join('», «')}» — таких вариантов нет в правом столбце.`;
    }
    if (compact.length !== options.left.length) {
      return `Ответ должен содержать ${options.left.length} симв. — по одному на каждую позицию левого столбца (сейчас ${compact.length}).`;
    }
    return null;
  }

  const keys = new Set(options.options.map((o) => o.key.toLowerCase()));
  const bad = [...compact].filter((ch) => !keys.has(ch.toLowerCase()));
  if (bad.length > 0) {
    return `В ответе есть «${bad.join('», «')}» — такого варианта нет в списке.`;
  }
  if (new Set([...compact.toLowerCase()]).size !== compact.length) {
    return 'В ответе повторяется один и тот же вариант.';
  }
  if (options.kind === 'single_choice' && compact.length !== 1) {
    return 'У этой задачи один правильный вариант — в ответе должен быть ровно один ключ.';
  }
  return null;
}
