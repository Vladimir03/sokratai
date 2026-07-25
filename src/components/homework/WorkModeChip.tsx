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
 */

interface WorkModeChipProps {
  workMode: 'homework' | 'independent' | null | undefined;
  /** `sm` — плотные списки карточек; `md` — заголовок деталки. */
  size?: 'sm' | 'md';
  className?: string;
}

export function WorkModeChip({ workMode, size = 'sm', className = '' }: WorkModeChipProps) {
  if (workMode !== 'independent') return null;
  const sizeClass = size === 'md' ? 'text-sm px-2.5 py-1' : 'text-xs px-2 py-0.5';
  return (
    <span
      className={`inline-flex items-center rounded-full border border-border bg-socrat-surface font-medium text-foreground/80 ${sizeClass} ${className}`}
      title="Самостоятельная работа: AI-подсказки и обсуждение выключены, разбор ученик видит после сдачи"
    >
      Самостоятельная
    </span>
  );
}

export default WorkModeChip;
