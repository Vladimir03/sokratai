// ConfirmLessonsSheet — sheet подтверждения прошедших занятий (schedule-bulk-complete CC-B).
// Строки по умолчанию «проведено». Индивид: editable сумма + «не состоялось».
// Группа: per-participant был/не был + editable сумма (снял «был» → 0). «Подтвердить
// все» → confirmLessons (CC-A) для проведённых + cancelLesson для «не состоялось».
// Деньги создаются только здесь, на submit. rule 80/90: 16px, touch-action, один primary CTA.
//
// Review-фиксы (Codex 2026-06-02):
//  #1 — нельзя подтвердить группу, пока участники не загрузились/при ошибке загрузки
//       (иначе оплаты создаются из сохранённых сумм без шанса снять no-show). CTA
//       disabled пока conducted-группы грузятся; ошибка → inline + исключение из payload.
//  #2 — cancelLesson через Promise.allSettled: считаем ТОЛЬКО успешные отмены, провалы
//       показываем явно (не ложное «Отменено: N»).

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { format, isToday, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import { Loader2, Users } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { calculateLessonPaymentAmount } from '@/lib/paymentAmount';
import { getLessonParticipants } from '@/lib/tutorScheduleGroupCreate';
import { cancelLesson } from '@/lib/tutorSchedule';
import { confirmLessons, type ConfirmLessonItem } from '@/lib/scheduleBulkComplete';
import type { TutorLessonWithStudent } from '@/types/tutor';

function lessonStudentName(l: TutorLessonWithStudent): string {
  return l.tutor_students?.profiles?.username || l.profiles?.username || 'Ученик';
}
function isGroupLesson(l: TutorLessonWithStudent): boolean {
  return !!l.group_session_id || l.student_id == null;
}
function fmtTime(iso: string): string {
  try {
    const d = parseISO(iso);
    if (Number.isNaN(d.getTime())) return '';
    return isToday(d) ? format(d, 'Сегодня, HH:mm', { locale: ru }) : format(d, 'd MMM, HH:mm', { locale: ru });
  } catch {
    return '';
  }
}

interface ParticipantRow {
  tutorStudentId: string;
  name: string;
  attended: boolean;
  amount: number;
}
/** null = грузится; 'error' = не загрузились (группа всегда ≥1 участник, пустой ответ = сбой). */
type ParticipantsState = ParticipantRow[] | null | 'error';
interface LessonRow {
  lesson: TutorLessonWithStudent;
  isGroup: boolean;
  conducted: boolean;
  amount: number; // individual
  participants: ParticipantsState; // group
}

interface ConfirmLessonsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lessons: TutorLessonWithStudent[];
  onOpenMaterials: (lesson: TutorLessonWithStudent) => void;
}

function AmountInput({
  value,
  disabled,
  onChange,
}: {
  value: number;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <input
        type="number"
        inputMode="numeric"
        min={0}
        step={50}
        disabled={disabled}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(e.target.value === '' ? 0 : Math.max(0, Number(e.target.value) || 0))}
        className="w-20 rounded-md border border-socrat-border px-2 py-1.5 text-base text-slate-900 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-50"
        style={{ touchAction: 'manipulation' }}
        aria-label="Сумма, ₽"
      />
      <span className="text-sm text-slate-400">₽</span>
    </div>
  );
}

export const ConfirmLessonsSheet = memo(function ConfirmLessonsSheet({
  open,
  onOpenChange,
  lessons,
  onOpenMaterials,
}: ConfirmLessonsSheetProps) {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<LessonRow[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const initRef = useRef(false);

  // Загрузка участников группы (init + retry). getLessonParticipants не бросает —
  // возвращает [] при ошибке; группа всегда ≥1 участник, поэтому пустой ответ = сбой → 'error'.
  const loadParticipants = useCallback((lesson: TutorLessonWithStudent) => {
    setRows((prev) => prev.map((r) => (r.lesson.id === lesson.id ? { ...r, participants: null } : r)));
    getLessonParticipants(lesson.id)
      .then((parts) => {
        setRows((prev) =>
          prev.map((r) =>
            r.lesson.id === lesson.id
              ? {
                  ...r,
                  participants:
                    parts.length === 0
                      ? 'error'
                      : parts.map((p) => ({
                          tutorStudentId: p.tutor_student_id,
                          name: p.tutor_students?.profiles?.username ?? 'Ученик',
                          attended: true,
                          amount: p.payment_amount ?? calculateLessonPaymentAmount(lesson.duration_min ?? 60, p.tutor_students?.hourly_rate_cents) ?? 0,
                        })),
                }
              : r,
          ),
        );
      })
      .catch(() => {
        setRows((prev) => prev.map((r) => (r.lesson.id === lesson.id ? { ...r, participants: 'error' } : r)));
      });
  }, []);

  useEffect(() => {
    if (!open) {
      initRef.current = false;
      return;
    }
    if (initRef.current) return;
    initRef.current = true;

    setRows(
      lessons.map((l) => {
        const group = isGroupLesson(l);
        return {
          lesson: l,
          isGroup: group,
          conducted: true,
          amount: group ? 0 : (calculateLessonPaymentAmount(l.duration_min ?? 60, l.tutor_students?.hourly_rate_cents) ?? 0),
          participants: group ? null : [],
        };
      }),
    );
    lessons.filter(isGroupLesson).forEach((l) => loadParticipants(l));
  }, [open, lessons, loadParticipants]);

  const updateRow = (id: string, patch: Partial<LessonRow>) =>
    setRows((prev) => prev.map((r) => (r.lesson.id === id ? { ...r, ...patch } : r)));
  const updateParticipant = (lessonId: string, tsId: string, patch: Partial<ParticipantRow>) =>
    setRows((prev) =>
      prev.map((r) =>
        r.lesson.id === lessonId && Array.isArray(r.participants)
          ? { ...r, participants: r.participants.map((p) => (p.tutorStudentId === tsId ? { ...p, ...patch } : p)) }
          : r,
      ),
    );

  const conductedCount = useMemo(() => rows.filter((r) => r.conducted).length, [rows]);
  // #1: блокируем подтверждение, пока conducted-группа ещё грузит участников.
  const groupLoading = useMemo(
    () => rows.some((r) => r.conducted && r.isGroup && r.participants === null),
    [rows],
  );

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const confirmPayload: ConfirmLessonItem[] = [];
      const cancelIds: string[] = [];
      const skippedUnloaded: string[] = [];
      for (const r of rows) {
        if (!r.conducted) {
          cancelIds.push(r.lesson.id);
          continue;
        }
        if (r.isGroup) {
          // #1: группу подтверждаем ТОЛЬКО с загруженными участниками; иначе пропускаем
          // (не создаём оплаты вслепую из сохранённых сумм).
          if (!Array.isArray(r.participants) || r.participants.length === 0) {
            skippedUnloaded.push(r.lesson.id);
            continue;
          }
          confirmPayload.push({
            lesson_id: r.lesson.id,
            participants: r.participants.map((p) => ({
              tutor_student_id: p.tutorStudentId,
              amount: p.attended ? Math.max(0, Math.round(p.amount)) : 0,
            })),
          });
        } else {
          confirmPayload.push({ lesson_id: r.lesson.id, amount: Math.max(0, Math.round(r.amount)) });
        }
      }

      let confirmedCount = 0;
      if (confirmPayload.length > 0) {
        const res = await confirmLessons(confirmPayload);
        if (res.errorMessage) {
          toast.error(res.errorMessage);
          setSubmitting(false);
          return;
        }
        confirmedCount = res.confirmed;
      }

      // #2: честный подсчёт отмен — только успешные (cancelLesson возвращает null при сбое).
      let cancelledOk = 0;
      let cancelFailed = 0;
      if (cancelIds.length > 0) {
        const settled = await Promise.allSettled(cancelIds.map((id) => cancelLesson(id, 'tutor')));
        for (const s of settled) {
          if (s.status === 'fulfilled' && s.value != null) cancelledOk += 1;
          else cancelFailed += 1;
        }
      }

      await queryClient.invalidateQueries({ queryKey: ['tutor', 'lessons'] });
      onOpenChange(false);

      const firstConfirmedId = confirmPayload[0]?.lesson_id ?? null;
      const firstConfirmed = firstConfirmedId ? (rows.find((r) => r.lesson.id === firstConfirmedId)?.lesson ?? null) : null;
      const summary =
        [confirmedCount > 0 ? `Проведено: ${confirmedCount}` : null, cancelledOk > 0 ? `Отменено: ${cancelledOk}` : null]
          .filter(Boolean)
          .join(' · ') || 'Готово';

      if (firstConfirmed) {
        toast.success(summary, {
          action: { label: 'Приложить записи', onClick: () => onOpenMaterials(firstConfirmed) },
        });
      } else {
        toast.success(summary);
      }
      if (cancelFailed > 0) toast.error(`Не удалось отменить: ${cancelFailed} — попробуйте ещё раз`);
      if (skippedUnloaded.length > 0) {
        toast.warning(`Не подтверждено (участники не загрузились): ${skippedUnloaded.length}`);
      }
    } catch {
      toast.error('Не удалось подтвердить занятия');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 bg-white p-0 sm:max-w-lg">
        <SheetTitle className="sr-only">Подтвердить проведённые занятия</SheetTitle>
        <SheetDescription className="sr-only">
          Отметьте проведённые занятия и суммы; «не состоялось» отменяет без оплаты
        </SheetDescription>

        <div className="border-b border-socrat-border px-5 py-4">
          <h2 className="text-[17px] font-semibold text-slate-900">Подтвердить проведённые</h2>
          <p className="mt-0.5 text-xs text-slate-500">Суммы можно поправить; «не состоялось» — отменит без оплаты</p>
        </div>

        <div className="flex-1 space-y-2.5 overflow-y-auto px-5 py-4">
          {rows.map((r) => {
            const groupTitle = r.lesson.group_title_snapshot?.trim() || 'Групповое занятие';
            return (
              <div
                key={r.lesson.id}
                className={cn(
                  'rounded-lg border border-socrat-border bg-white px-3 py-2.5',
                  !r.conducted && 'opacity-60',
                )}
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate text-sm font-medium text-slate-900">
                      {r.isGroup && <Users className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
                      {r.isGroup ? groupTitle : lessonStudentName(r.lesson)}
                    </p>
                    <p className="text-xs text-slate-500">{fmtTime(r.lesson.start_at)}</p>
                  </div>
                  {!r.isGroup && r.conducted && (
                    <AmountInput value={r.amount} onChange={(v) => updateRow(r.lesson.id, { amount: v })} />
                  )}
                  <button
                    type="button"
                    onClick={() => updateRow(r.lesson.id, { conducted: !r.conducted })}
                    className={cn(
                      'shrink-0 rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
                      r.conducted
                        ? 'text-slate-400 hover:bg-slate-100 hover:text-slate-600'
                        : 'bg-slate-100 text-slate-700',
                    )}
                    style={{ touchAction: 'manipulation' }}
                  >
                    {r.conducted ? 'не состоялось' : 'вернуть'}
                  </button>
                </div>

                {/* Group participants */}
                {r.isGroup && r.conducted && (
                  <div className="mt-2 space-y-1.5 border-t border-socrat-border pt-2">
                    {r.participants === null ? (
                      <div className="flex items-center gap-2 py-1 text-xs text-slate-400">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Загрузка участников…
                      </div>
                    ) : r.participants === 'error' ? (
                      <div className="flex items-center justify-between gap-2 py-1 text-xs text-rose-600">
                        <span>Не удалось загрузить участников</span>
                        <button
                          type="button"
                          onClick={() => loadParticipants(r.lesson)}
                          className="rounded-md px-2 py-1 font-medium text-rose-700 hover:bg-rose-50"
                          style={{ touchAction: 'manipulation' }}
                        >
                          Повторить
                        </button>
                      </div>
                    ) : (
                      r.participants.map((p) => (
                        <div key={p.tutorStudentId} className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => updateParticipant(r.lesson.id, p.tutorStudentId, { attended: !p.attended, amount: !p.attended ? p.amount : 0 })}
                            className="flex min-w-0 flex-1 items-center gap-2 text-left"
                            style={{ touchAction: 'manipulation' }}
                            aria-pressed={p.attended}
                          >
                            <span
                              className={cn(
                                'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                                p.attended ? 'border-accent bg-accent text-white' : 'border-slate-300 bg-white',
                              )}
                            >
                              {p.attended && <span className="text-[10px] leading-none">✓</span>}
                            </span>
                            <span className={cn('truncate text-sm', p.attended ? 'text-slate-900' : 'text-slate-400 line-through')}>
                              {p.name}
                            </span>
                          </button>
                          <AmountInput
                            value={p.amount}
                            disabled={!p.attended}
                            onChange={(v) => updateParticipant(r.lesson.id, p.tutorStudentId, { amount: v })}
                          />
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="border-t border-socrat-border px-5 py-4">
          {groupLoading && (
            <p className="mb-2 text-center text-xs text-slate-400">Загружаем участников групп…</p>
          )}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || rows.length === 0 || groupLoading}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
            style={{ touchAction: 'manipulation' }}
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Подтвердить все
            {conductedCount > 0 ? ` (${conductedCount})` : ''}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
});
