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

import { useCallback, useRef, useState } from 'react';
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
  const [finishing, setFinishing] = useState(false);

  // Закрытие: досохраняем введённую ссылку записи + один notify-дайджест (TASK-7).
  // strict=true («Готово») — не закрываем, если ссылку сохранить не удалось, чтобы
  // ввод не пропал; Esc/overlay закрывают всегда (репорт владельца 2026-08-07).
  const finish = useCallback(async (strict: boolean) => {
    if (finishing) return;
    setFinishing(true);
    try {
      const canClose = (await panelRef.current?.commitPendingAndNotify({ strict })) ?? true;
      if (canClose) onOpenChange(false);
    } finally {
      setFinishing(false);
    }
  }, [finishing, onOpenChange]);

  if (!lesson) return null;

  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) void finish(false); }}>
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

        {/* Footer — one primary CTA: сохраняет введённую ссылку и закрывает */}
        <div className="border-t border-socrat-border px-5 py-4">
          <button
            type="button"
            onClick={() => void finish(true)}
            disabled={finishing}
            className="w-full rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-accent/90 disabled:opacity-60"
            style={{ touchAction: 'manipulation' }}
          >
            {finishing ? 'Сохраняем...' : 'Готово'}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
