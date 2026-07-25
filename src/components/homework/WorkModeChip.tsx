/**
 * Чип вида работы («Самостоятельная»).
 *
 * Запрос репетиторов 2026-07-25: «А самостоятельные можно будет как-то отличить
 * от ДЗ с Сократом? Или нужно будет прописывать в названии?» — прописывать в
 * названии костыль, `work_mode` уже едет во всех нужных ответах.
 *
 * Контракт:
 *   - Рендерится ТОЛЬКО для `independent`. «Домашка с Сократом» — дефолт, чип
 *     на ней был бы шумом на каждой карточке.
 *   - Нейтральный тон (rule 90): это классификация работы, а не тревога.
 *   - Shared между репетиторским и ученическим модулями (нейтральная зона
 *     `components/homework/*`, как `PhotoGallery`).
 *   - **`withNoHelpNote` обязателен на ученических поверхностях** (ревью-фикс
 *     P1, 2026-07-25): смысл чипа для ученика — «подсказок не будет», и он
 *     должен быть ВИДЕН. Раньше это жило в `title`, недоступном на телефоне,
 *     то есть у всех учеников. Репетитору примечание не нужно: он сам выбрал
 *     вид работы в конструкторе.
 */

interface WorkModeChipProps {
  workMode: 'homework' | 'independent' | null | undefined;
  /** `sm` — плотные списки карточек; `md` — заголовок деталки. */
  size?: 'sm' | 'md';
  /** Ученические поверхности: добавить видимое «без подсказок». */
  withNoHelpNote?: boolean;
  className?: string;
}

export function WorkModeChip({
  workMode,
  size = 'sm',
  withNoHelpNote = false,
  className = '',
}: WorkModeChipProps) {
  if (workMode !== 'independent') return null;
  const sizeClass = size === 'md' ? 'text-sm px-2.5 py-1' : 'text-xs px-2 py-0.5';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border border-border bg-socrat-surface font-medium text-foreground/80 ${sizeClass} ${className}`}
    >
      Самостоятельная
      {withNoHelpNote ? (
        <span className="font-normal text-slate-500">· без подсказок</span>
      ) : null}
    </span>
  );
}

export default WorkModeChip;
