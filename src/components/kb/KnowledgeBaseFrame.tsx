import { type ReactNode, useState } from 'react';
import { cn } from '@/lib/utils';
import { HWBadgeButton, HWDrawer } from '@/components/kb/HWDrawer';

interface KnowledgeBaseFrameProps {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}

export function KnowledgeBaseFrame({
  children,
  className,
  contentClassName,
}: KnowledgeBaseFrameProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);

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
              База задач
            </h1>
          </div>
        </div>

        <HWBadgeButton onClick={() => setDrawerOpen(true)} />
      </header>

      <div className={cn('px-6 py-7 sm:px-7 sm:py-8', contentClassName)}>
        {children}
      </div>

      <HWDrawer open={drawerOpen} onOpenChange={setDrawerOpen} />
    </section>
  );
}
