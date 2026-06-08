// LessonMaterialsDrawer — tutor drawer to attach materials to a lesson
// (schedule-materials, TASK-3). Opened from the lesson-details dialog / group
// dialog / past-lessons banner in TutorSchedule. Thin Sheet shell around the
// shared LessonMaterialsPanel (recording / PDF / homework). One primary CTA
// «Готово» → fires the TASK-7 notify digest via the panel's ref handle.
//
// The body + all logic live in LessonMaterialsPanel so the PostLessonSheet can
// reuse the exact same UI. Props here are UNCHANGED so existing callers are not
// affected.
//
// rule 80 (Safari): touch-action:manipulation. rule 90: one primary CTA.

import { useCallback, useRef } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import type { TutorLessonWithStudent } from '@/types/tutor';
import {
  LessonMaterialsPanel,
  lessonSubtitle,
  type LessonMaterialsPanelHandle,
} from './LessonMaterialsPanel';

interface LessonMaterialsDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lesson: TutorLessonWithStudent | null;
}

export function LessonMaterialsDrawer({ open, onOpenChange, lesson }: LessonMaterialsDrawerProps) {
  const panelRef = useRef<LessonMaterialsPanelHandle>(null);

  // TASK-7: close via «Готово» / overlay / Esc → one digest if materials added.
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
          Прикрепите запись, конспект или домашнее задание к занятию
        </SheetDescription>

        {/* Header */}
        <div className="border-b border-socrat-border px-5 py-4">
          <h2 className="text-[17px] font-semibold text-slate-900">Материалы занятия</h2>
          <p className="mt-0.5 truncate text-xs text-slate-500">{lessonSubtitle(lesson)}</p>
        </div>

        {/* Body (shared) */}
        <LessonMaterialsPanel
          ref={panelRef}
          lesson={lesson}
          active={open}
          onRequestClose={() => onOpenChange(false)}
        />

        {/* Footer — one primary CTA */}
        <div className="border-t border-socrat-border px-5 py-4">
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
