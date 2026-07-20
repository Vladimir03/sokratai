import { lazy, Suspense, useCallback, useMemo, useRef } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { resolveOrCreateHwMirrorFolderId } from '@/lib/kbHwMirrorFolder';
import type {
  AiLoaderCommitItem,
  AiLoaderDestination,
  AiLoaderGuardState,
} from '@/components/kb/AiTaskLoader/reviewTypes';
import { aiExtractToDraftTask } from './aiLoaderMapper';
import type { DraftTask } from './types';

// Lazy: Flow тянет ревью-таблицу/карточки и (по клику на PDF) pdfjs-цепочку —
// в бандл конструктора не входит, грузится при первом открытии Sheet.
const AiTaskLoaderFlow = lazy(() =>
  import('@/components/kb/AiTaskLoader/AiTaskLoaderFlow').then((m) => ({
    default: m.AiTaskLoaderFlow,
  })),
);

interface HWAiLoaderSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Предмет ДЗ (meta.subject) — форсится в загрузчик, селектор скрыт. */
  subject: string;
  onAddTasks: (tasks: DraftTask[]) => void;
}

/**
 * Sheet-хост AI-загрузчика в конструкторе ДЗ (фаза 1 «один загрузчик —
 * N назначений», 2026-07-20). Sheet, а НЕ роут: отдельный роут размонтировал бы
 * TutorHomeworkCreate → потеря несохранённых задач/меты (главный класс багов
 * файла). Зеркало KBPickerSheet по габаритам.
 *
 * Гард закрытия: во время extract/commit закрытие блокируется; в ревью —
 * confirm (Esc/оверлей на 70 распознанных черновиках — потеря работы).
 */
export function HWAiLoaderSheet({ open, onOpenChange, subject, onAddTasks }: HWAiLoaderSheetProps) {
  const guardRef = useRef<AiLoaderGuardState>({ busy: false, hasDrafts: false });

  const handleGuardStateChange = useCallback((state: AiLoaderGuardState) => {
    guardRef.current = state;
  }, []);

  const handleCommit = useCallback(
    (items: AiLoaderCommitItem[]) => {
      onAddTasks(items.map((it) => aiExtractToDraftTask(it, subject)));
      guardRef.current = { busy: false, hasDrafts: false };
      onOpenChange(false);
    },
    [onAddTasks, onOpenChange, subject],
  );

  const destination = useMemo<AiLoaderDestination>(
    () => ({
      kind: 'hw_draft',
      subject,
      resolveFolderId: resolveOrCreateHwMirrorFolderId,
      onCommit: handleCommit,
    }),
    [subject, handleCommit],
  );

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) {
        if (guardRef.current.busy) return; // идёт распознавание/добавление — не закрываем
        if (
          guardRef.current.hasDrafts &&
          !window.confirm('Закрыть? Распознанные задачи будут потеряны.')
        ) {
          return;
        }
        guardRef.current = { busy: false, hasDrafts: false };
      }
      onOpenChange(next);
    },
    [onOpenChange],
  );

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="flex w-[75vw] !max-w-none flex-col gap-0 p-0">
        <SheetHeader className="border-b px-4 pb-3 pt-4">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-socrat-primary" aria-hidden="true" />
            Задачи из файла (AI)
          </SheetTitle>
          <p className="text-xs text-slate-500">
            PDF, фото или текст — AI разложит задачи по полям, вы проверите и добавите в ДЗ.
          </p>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {open ? (
            <Suspense
              fallback={
                <div className="flex justify-center py-10">
                  <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-hidden="true" />
                </div>
              }
            >
              <AiTaskLoaderFlow
                destination={destination}
                onGuardStateChange={handleGuardStateChange}
              />
            </Suspense>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
