import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface SubmitSheetStubProps {
  open: boolean;
  onClose: () => void;
  taskNo: number;
  taskTotal: number;
  homeworkTitle: string;
  taskScore: number;
  taskScoreMax: number;
}

/**
 * Phase 1 stub of the bottom-sheet for submitting a solution. **Empty
 * shell** — header, scrim, slide-up animation, focus trap. Inside the
 * body — a placeholder explaining real `SubmitSheet` (PhotoStrip,
 * VoiceRecorder, numeric input, autosave, verdict overlay) ships in
 * Phase 2 with real backend.
 *
 * Why ship the empty shell now: lets the designer validate the sheet
 * animation, scrim, grab handle, header layout, mobile slide-up motion
 * curve, and focus-trap behavior in real device + Safari testing —
 * without waiting on the heavy submission pipeline.
 *
 * Animation comes from `homework-sheet-slide-up` keyframe in
 * `tailwind.config.ts`. The scrim fades in via Tailwind `animate-in
 * fade-in`.
 */
export function SubmitSheetStub({
  open,
  onClose,
  taskNo,
  taskTotal,
  homeworkTitle,
  taskScore,
  taskScoreMax,
}: SubmitSheetStubProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Focus close button when opening and lock body scroll. Real shadcn
  // `<Sheet>` would handle this — we DIY here because we want the
  // pixel-perfect grab handle, custom scrim, and bottom-anchored layout
  // that don't fit shadcn's default sheet variants.
  useEffect(() => {
    if (!open) return;
    closeButtonRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/55 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="submit-sheet-title"
    >
      <div
        className="w-full max-h-[92%] bg-white rounded-t-[22px] flex flex-col overflow-hidden animate-homework-sheet-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Grab handle */}
        <span
          className="block w-10 h-1 rounded-sm bg-slate-300 mx-auto mt-2 mb-1"
          aria-hidden="true"
        />

        {/* Header */}
        <div className="flex items-start justify-between gap-2.5 px-4 pt-2 pb-3 border-b border-socrat-border-light">
          <div className="min-w-0 flex-1">
            <h2
              id="submit-sheet-title"
              className="text-base font-bold text-slate-900 m-0"
            >
              Сдать задачу {taskNo} из {taskTotal}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 truncate">
              {homeworkTitle} · {taskScore} / {taskScoreMax} баллов
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="grid place-items-center w-9 h-9 rounded-full bg-socrat-surface hover:bg-socrat-border-light text-slate-700 shrink-0 touch-manipulation"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* Body — Phase 1 placeholder */}
        <div className="flex-1 overflow-y-auto px-4 py-6">
          <div className="rounded-[12px] border border-dashed border-socrat-border-light bg-socrat-surface px-4 py-6 text-center">
            <p className="text-sm font-bold text-slate-900 mb-1">
              Реальная форма сдачи решения
            </p>
            <p className="text-xs text-slate-500 leading-relaxed">
              Phase 2 (после backend): числовой ответ + фото решения от руки
              (multi-page PhotoStrip), опциональный текст, голосовая запись,
              автосохранение черновика и проверка через Gemini 3 Flash с
              4-step pipeline.
            </p>
          </div>
        </div>

        {/* Footer — disabled CTA so designers can sanity-check spacing */}
        <div className="flex items-center justify-between gap-2.5 px-3.5 py-3 border-t border-socrat-border-light">
          <span className="text-[11px] text-slate-500">
            Phase 1 · UI без backend
          </span>
          <button
            type="button"
            disabled
            className="inline-flex items-center gap-1.5 h-11 px-4.5 bg-socrat-primary text-white rounded-[12px] text-sm font-bold opacity-45 cursor-not-allowed"
          >
            Отправить на проверку
          </button>
        </div>
      </div>
    </div>
  );
}
