import { memo } from 'react';

import { cn } from '@/lib/utils';
import { useSubjectPillIds } from '@/lib/kbSubjectPills';
import { getSubjectLabel } from '@/types/homework';

/**
 * Ряд компактных pills выбора предмета — ОБЩИЙ для витрины Каталога
 * (`KnowledgeBasePage`) и пикера «+ из БЗ» в конструкторе ДЗ (`KBPickerSheet`).
 *
 * Раньше pills жили только в витрине, а пикер показывал темы ВСЕХ предметов
 * одним плоским списком: репетитор обществознания видел вперемешку «Понятие
 * истины», «Электростатика», «Магнетизм» (репорт Ульяны 2026-07-23). Вынесено в
 * общий компонент, чтобы две поверхности не разъезжались снова.
 *
 * НЕ второй сегмент-контрол (UX-ревью): предмет — фильтр витрины, визуально
 * легче таба раздела; три уровня навигации одинакового веса перегружали «где я».
 */

export interface SubjectPillsProps {
  /** Активный предмет. */
  value: string;
  onChange: (subject: string) => void;
  /** Предметы существующих тем — попадают в pills, даже если не якорные. */
  topicSubjects?: readonly (string | null | undefined)[];
  /** Предметы профиля репетитора (персонализация). */
  tutorSubjects?: readonly string[];
  className?: string;
  'aria-label'?: string;
}

export const SubjectPills = memo(function SubjectPills({
  value,
  onChange,
  topicSubjects,
  tutorSubjects,
  className,
  'aria-label': ariaLabel = 'Предмет',
}: SubjectPillsProps) {
  const ids = useSubjectPillIds({ value, topicSubjects, tutorSubjects });

  return (
    <div
      className={cn('flex flex-wrap items-center gap-1.5', className)}
      role="group"
      aria-label={ariaLabel}
    >
      {ids.map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          aria-pressed={value === id}
          className={cn(
            'inline-flex min-h-[36px] items-center rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition-colors duration-200 [touch-action:manipulation]',
            value === id
              ? 'border-socrat-primary bg-socrat-primary text-white'
              : 'border-socrat-border bg-white text-slate-600 hover:border-socrat-primary/40 hover:text-socrat-primary',
          )}
        >
          {getSubjectLabel(id)}
        </button>
      ))}
    </div>
  );
});
