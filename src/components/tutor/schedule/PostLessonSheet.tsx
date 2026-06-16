// PostLessonSheet — «материалы занятия» для ИНДИВИДУАЛЬНОГО занятия (запись / конспект / ДЗ + уведомить).
//
// Phase 2b: занятия списываются с баланса АВТОМАТИЧЕСКИ (cost-driven, по стоимости занятия) — здесь больше
// НЕТ платёжного шага (оплачено/жду оплату) и «провести». Стоимость/отмена правятся в карточке занятия.
//
// rule 80 (Safari): touch-action:manipulation, full-height sheet, no dvh in JS. rule 90: без эмодзи.

import { useCallback, useRef } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import type { TutorLessonWithStudent } from '@/types/tutor';
import {
  LessonMaterialsPanel,
  lessonSubtitle,
  type LessonMaterialsPanelHandle,
} from './LessonMaterialsPanel';

interface PostLessonSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lesson: TutorLessonWithStudent | null;
}

export function PostLessonSheet({ open, onOpenChange, lesson }: PostLessonSheetProps) {
  const panelRef = useRef<LessonMaterialsPanelHandle>(null);

  // Закрытие via «Готово» / overlay / Esc → один notify-дайджест, если материалы добавлены (TASK-7).
  const handleClose = useCallback(() => {
    panelRef.current?.flushNotifyOnClose();
    onOpenChange(false);
  }, [onOpenChange]);

  if (!lesson) return null;

  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) handleClose(); }}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 bg-white p-0 sm:max-w-lg">
        <SheetTitle className="sr-only">Материалы занятия</SheetTitle>
        <SheetDescription className="sr-only">
          Добавьте запись, конспект и домашнее задание
        </SheetDescription>

        {/* Header */}
        <div className="border-b border-socrat-border px-5 py-4">
          <h2 className="text-[17px] font-semibold text-slate-900">Материалы занятия</h2>
          <p className="mt-0.5 truncate text-xs text-slate-500">{lessonSubtitle(lesson)}</p>
        </div>

        {/* Запись / конспект / домашка (shared) */}
        <LessonMaterialsPanel
          ref={panelRef}
          lesson={lesson}
          active={open}
          onRequestClose={() => onOpenChange(false)}
        />

        {/* Footer — уведомить */}
        <div className="border-t border-socrat-border px-5 py-4">
          <p className="mb-2 text-center text-xs text-slate-400">
            Материалы появятся у ученика во вкладке «Занятия»
          </p>
          <button
            type="button"
            onClick={handleClose}
            className="w-full rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-accent/90"
            style={{ touchAction: 'manipulation' }}
          >
            Готово
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
