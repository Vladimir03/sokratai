// PostLessonSheet — guided "after the lesson" checklist for an INDIVIDUAL lesson.
// Replaces the cramped 3-button block in the lesson-details dialog with a
// scrollable Sheet that walks the tutor through their post-lesson Jobs:
//   ① Провести занятие + оплата   (reuse handleCompleteLesson — money unchanged)
//   ② Запись / конспект, ③ Домашка (shared LessonMaterialsPanel)
//   ④ Уведомить ученика           (footer «Готово» → panel notify digest)
//
// Money: amount = calculateLessonPaymentAmount(duration, rate) in RUBLES (no /100),
// identical to the dialog it replaces. Scope: individual lessons only.
//
// rule 80 (Safari): touch-action:manipulation, full-height sheet, no dvh in JS.
// rule 90: Lucide icons (no emoji), accent/socrat tokens, one primary decision block.

import { useCallback, useRef } from 'react';
import { Check, CheckCircle2, CreditCard, XCircle } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { calculateLessonPaymentAmount } from '@/lib/paymentAmount';
import { formatCurrency } from '@/lib/formatters';
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
  /** = handleCompleteLesson (status change + tutor_payments row). */
  onComplete: (lessonId: string, amount: number, paymentStatus: string) => void;
  isCompleting?: boolean;
  /** Single-lesson cancel wrapper (closes the sheet on success). */
  onCancelLesson: (lessonId: string) => void;
  isCancelling?: boolean;
}

function StepBadge({ done, n }: { done?: boolean; n?: number }) {
  return (
    <span
      className={cn(
        'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
        done ? 'bg-socrat-accent-light text-socrat-accent' : 'bg-slate-100 text-slate-600',
      )}
    >
      {done ? <Check className="h-3.5 w-3.5" /> : n}
    </span>
  );
}

export function PostLessonSheet({
  open,
  onOpenChange,
  lesson,
  onComplete,
  isCompleting = false,
  onCancelLesson,
  isCancelling = false,
}: PostLessonSheetProps) {
  const panelRef = useRef<LessonMaterialsPanelHandle>(null);

  // TASK-7: close via «Готово» / overlay / Esc → one notify digest if materials added.
  const handleClose = useCallback(() => {
    panelRef.current?.flushNotifyOnClose();
    onOpenChange(false);
  }, [onOpenChange]);

  if (!lesson) return null;

  const status = lesson.status;
  const isCancelled = status === 'cancelled';
  const isCompleted = status === 'completed';
  const busy = isCompleting || isCancelling;

  const amount = calculateLessonPaymentAmount(lesson.duration_min, lesson.tutor_students?.hourly_rate_cents) ?? 0;
  const paidAmount = lesson.payment_amount ?? amount;
  const paymentNote =
    lesson.payment_status === 'paid'
      ? 'оплачено'
      : lesson.payment_status === 'pending'
        ? 'ждёт оплату'
        : null;
  const completedSummary =
    [paidAmount > 0 ? formatCurrency(paidAmount) : null, paymentNote].filter(Boolean).join(' · ') || 'проведено';

  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) handleClose(); }}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 bg-white p-0 sm:max-w-lg">
        <SheetTitle className="sr-only">После занятия</SheetTitle>
        <SheetDescription className="sr-only">
          Проведите занятие, добавьте материалы и домашнее задание
        </SheetDescription>

        {/* Header */}
        <div className="border-b border-socrat-border px-5 py-4">
          <h2 className="text-[17px] font-semibold text-slate-900">После занятия</h2>
          <p className="mt-0.5 truncate text-xs text-slate-500">{lessonSubtitle(lesson)}</p>
        </div>

        {/* ── Step ① Провести занятие ── */}
        <div className="border-b border-socrat-border px-5 py-4">
          {isCancelled ? (
            <div className="flex items-center gap-2">
              <XCircle className="h-5 w-5 shrink-0 text-slate-400" />
              <h3 className="text-sm font-medium text-slate-500">Урок не состоялся</h3>
            </div>
          ) : isCompleted ? (
            <div className="flex items-start gap-2">
              <StepBadge done />
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-slate-900">Занятие проведено</h3>
                <p className="mt-0.5 text-xs text-slate-500">{completedSummary}</p>
              </div>
            </div>
          ) : (
            <>
              <div className="mb-2.5 flex items-center gap-2">
                <StepBadge n={1} />
                <h3 className="text-sm font-semibold text-slate-900">Провести занятие</h3>
              </div>
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => onComplete(lesson.id, amount, 'pending')}
                  disabled={busy}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
                  style={{ touchAction: 'manipulation' }}
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Проведено, жду оплату{amount > 0 ? ` (${formatCurrency(amount)})` : ''}
                </button>
                <button
                  type="button"
                  onClick={() => onComplete(lesson.id, amount, 'paid')}
                  disabled={busy}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
                  style={{ touchAction: 'manipulation' }}
                >
                  <CreditCard className="h-4 w-4" />
                  Уже оплачено{amount > 0 ? ` (${formatCurrency(amount)})` : ''}
                </button>
                <button
                  type="button"
                  onClick={() => onCancelLesson(lesson.id)}
                  disabled={busy}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                  style={{ touchAction: 'manipulation' }}
                >
                  <XCircle className="h-4 w-4" />
                  Урок не состоялся
                </button>
              </div>
            </>
          )}
        </div>

        {/* ── Steps ②③ Запись / Конспект / Домашка (shared) ── */}
        {isCancelled ? (
          <div className="flex-1" />
        ) : (
          <LessonMaterialsPanel
            ref={panelRef}
            lesson={lesson}
            active={open}
            onRequestClose={() => onOpenChange(false)}
          />
        )}

        {/* ── Footer = Step ④ Уведомить ── */}
        <div className="border-t border-socrat-border px-5 py-4">
          {!isCancelled && (
            <p className="mb-2 text-center text-xs text-slate-400">
              Материалы появятся у ученика во вкладке «Занятия»
            </p>
          )}
          <button
            type="button"
            onClick={handleClose}
            className="w-full rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-accent/90"
            style={{ touchAction: 'manipulation' }}
          >
            {isCancelled ? 'Закрыть' : 'Готово'}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
