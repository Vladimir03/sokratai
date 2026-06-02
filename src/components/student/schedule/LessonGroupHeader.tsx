import { memo } from 'react';

interface LessonGroupHeaderProps {
  label: string;
}

/** Date-section header for the «Занятия» feed (Сегодня / На этой неделе / Прошедшие). */
export const LessonGroupHeader = memo(function LessonGroupHeader({ label }: LessonGroupHeaderProps) {
  return (
    <h2 className="px-1 pt-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
      {label}
    </h2>
  );
});
