// Репетиторский рендер структурных вариантов (options_json) — единая вёрстка
// для карточки Базы, корзины «В ДЗ», превью ДЗ и треда ученика.
//
// ⚠️ Это НЕ ученическая поверхность: здесь верные варианты ПОМЕЧАЮТСЯ
// (correctAnswer — tutor-only колонка). Ученик отвечает через
// StructuredAnswerPanel, куда ключ ответа не попадает (rule 40).
import { Check } from 'lucide-react';
import { MathText } from '@/components/kb/ui/MathText';
import { compactChoiceAnswer, type TaskOptions } from '@/lib/taskOptions';
import { cn } from '@/lib/utils';

interface TaskOptionsListProps {
  options: TaskOptions;
  /**
   * correct_answer в формате чекеров («25», «35142»). null/undefined → список
   * без пометок (поверхность, которой ключ не положен, напр. share без ответов).
   */
  correctAnswer?: string | null;
  /** Компактная плотность для узких карточек (корзина «В ДЗ»). */
  dense?: boolean;
  className?: string;
}

/** Ключи верных вариантов из correct_answer (посимвольно, как чекеры). */
export function correctKeySet(correctAnswer: string | null | undefined): Set<string> {
  if (!correctAnswer) return new Set();
  return new Set(compactChoiceAnswer(correctAnswer).split('').filter(Boolean));
}

export function TaskOptionsList({
  options,
  correctAnswer,
  dense = false,
  className,
}: TaskOptionsListProps) {
  const correct = correctKeySet(correctAnswer);

  if (options.kind === 'matching') {
    // Верный ответ matching — последовательность правых ключей в порядке
    // левого столбца: показываем пары «А → 3» под столбцами.
    const pairs = correctAnswer
      ? options.left.map((l, i) => ({
          left: l.key,
          right: compactChoiceAnswer(correctAnswer)[i] ?? '?',
        }))
      : [];
    return (
      <div className={className}>
        <div className={cn('grid gap-3', dense ? '' : 'md:grid-cols-2')}>
          {(['left', 'right'] as const).map((side) => (
            <ul key={side} className="space-y-1.5">
              {options[side].map((opt) => (
                <li key={opt.key} className={cn('flex gap-2 text-slate-700', dense ? 'text-xs' : 'text-sm')}>
                  <span className="font-mono text-slate-500">{opt.key})</span>
                  <MathText text={opt.text} />
                </li>
              ))}
            </ul>
          ))}
        </div>
        {pairs.length > 0 ? (
          <div className={cn('mt-2 flex flex-wrap gap-1.5', dense ? 'text-xs' : 'text-sm')}>
            {pairs.map((p) => (
              <span
                key={p.left}
                className="rounded-full bg-socrat-primary-light px-2 py-0.5 font-mono text-socrat-primary"
              >
                {p.left} → {p.right}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <ul className={cn('space-y-1', className)}>
      {options.options.map((opt) => {
        const isCorrect = correct.has(opt.key);
        return (
          <li
            key={opt.key}
            className={cn(
              'flex items-start gap-2 rounded-lg px-2 py-1',
              dense ? 'text-xs' : 'text-sm',
              isCorrect ? 'bg-socrat-primary-light text-slate-900' : 'text-slate-700',
            )}
          >
            <span
              className={cn(
                'mt-0.5 flex shrink-0 items-center justify-center rounded border',
                dense ? 'h-3.5 w-3.5' : 'h-4 w-4',
                isCorrect ? 'border-socrat-primary bg-socrat-primary text-white' : 'border-slate-300 bg-white',
              )}
              aria-hidden
            >
              {isCorrect ? <Check className={dense ? 'h-2.5 w-2.5' : 'h-3 w-3'} /> : null}
            </span>
            <span className="font-mono text-slate-500">{opt.key})</span>
            <MathText text={opt.text} />
          </li>
        );
      })}
    </ul>
  );
}
