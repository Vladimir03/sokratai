import type { ReactNode } from 'react';
import { BookOpen } from 'lucide-react';
import { cn } from '@/lib/utils';

interface KnowledgeBaseFrameProps {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  onHomeworkClick?: () => void;
  homeworkLabel?: string;
}

export function KnowledgeBaseFrame({
  children,
  className,
  contentClassName,
  onHomeworkClick,
  homeworkLabel = 'ДЗ',
}: KnowledgeBaseFrameProps) {
  return (
    <section
      className={cn(
        'overflow-hidden rounded-[28px] border border-socrat-border bg-socrat-surface',
        'shadow-[0_24px_70px_-42px_rgba(20,82,54,0.28)]',
        className,
      )}
    >
      <header className="flex items-center justify-between border-b border-socrat-border px-6 py-4 sm:px-7">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-socrat-primary text-base font-bold text-white shadow-sm">
            C
          </div>
          <div className="min-w-0">
            <h1 className="font-display text-[2rem] font-semibold leading-none tracking-[-0.03em] text-slate-900 sm:text-[2.1rem]">
              База знаний
            </h1>
          </div>
        </div>

        <button
          type="button"
          onClick={onHomeworkClick}
          className={cn(
            'inline-flex items-center gap-2 rounded-xl border border-socrat-border bg-white px-4 py-2.5',
            'text-sm font-semibold text-slate-600 shadow-sm transition-all duration-200',
            'hover:border-socrat-primary/30 hover:text-socrat-primary',
          )}
        >
          <BookOpen className="h-4 w-4" />
          {homeworkLabel}
        </button>
      </header>

      <div className={cn('px-6 py-7 sm:px-7 sm:py-8', contentClassName)}>
        {children}
      </div>
    </section>
  );
}
