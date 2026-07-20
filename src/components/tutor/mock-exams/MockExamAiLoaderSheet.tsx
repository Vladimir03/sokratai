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
import {
  aiExtractToVariantTaskDraft,
  type VariantTaskDraft,
} from './variantTaskDraft';

// Lazy: Flow тянет ревью-таблицу + (по клику на PDF) pdfjs-цепочку.
const AiTaskLoaderFlow = lazy(() =>
  import('@/components/kb/AiTaskLoader/AiTaskLoaderFlow').then((m) => ({
    default: m.AiTaskLoaderFlow,
  })),
);

interface MockExamAiLoaderSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Предмет варианта — форсится в загрузчик (селектор скрыт). */
  subject: string;
  onAddTasks: (drafts: VariantTaskDraft[]) => void;
}

/**
 * Фаза 2, пуш 3 (2026-07-20): Sheet-хост AI-загрузчика в конструкторе варианта
 * пробника (зеркало HWAiLoaderSheet). Задачи после ревью распределяются по
 * частям автоматически (aiExtractToVariantTaskDraft: физика КИМ 21-26 → Ч2,
 * инференс check_mode Части 1). Запись в БД — только на «Создать/Сохранить»
 * редактора (единственный write-path — edge).
 */
export function MockExamAiLoaderSheet({
  open,
  onOpenChange,
  subject,
  onAddTasks,
}: MockExamAiLoaderSheetProps) {
  const guardRef = useRef<AiLoaderGuardState>({ busy: false, hasDrafts: false });

  const handleGuardStateChange = useCallback((state: AiLoaderGuardState) => {
    guardRef.current = state;
  }, []);

  const handleCommit = useCallback(
    (items: AiLoaderCommitItem[]) => {
      // Синхронный insert (урок ревью фазы 1 P1): задачи обязаны попасть в
      // стейт редактора ДО закрытия Sheet.
      onAddTasks(items.map((it) => aiExtractToVariantTaskDraft(it, subject)));
      guardRef.current = { busy: false, hasDrafts: false };
      onOpenChange(false);
    },
    [onAddTasks, onOpenChange, subject],
  );

  const destination = useMemo<AiLoaderDestination>(
    () => ({
      kind: 'mock_variant',
      subject,
      resolveFolderId: resolveOrCreateHwMirrorFolderId,
      onCommit: handleCommit,
    }),
    [subject, handleCommit],
  );

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) {
        if (guardRef.current.busy) return; // идёт распознавание — не закрываем
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
            Задачи пробника из файла (AI)
          </SheetTitle>
          <p className="text-xs text-slate-500">
            PDF, фото или текст — AI разложит задачи по полям, вы проверите и добавите в вариант.
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
