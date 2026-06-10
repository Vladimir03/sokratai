import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import { CalendarDays, ChevronDown, History, Loader2, Pencil, SlidersHorizontal, Undo2, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabaseClient';
import { formatCurrency } from '@/lib/formatters';
import { completeLessonAndCreatePayment } from '@/lib/tutorSchedule';
import { revertLesson } from '@/lib/scheduleBulkComplete';
import { reverseLedgerEntry, type LedgerEntry } from '@/lib/tutorBalanceApi';
import TopupDialog, { type TopupEditTarget } from './TopupDialog';

// Лента операций баланса (TASK-6). Append-only ledger → collapse-отображение:
// - offsetting-строки (reverses_entry_id) скрыты — это аудит-деталь;
// - сторнированная запись, у которой есть замена (правка) — скрыта, показывается
//   только новая с бейджем «исправлено» (+ раскрываемая история «было N»);
// - сторнированная БЕЗ замены — зачёркнута с бейджем «отменено».
// Правки: пополнение → tutor_edit_topup (атомарный reverse+new); списание за занятие →
// ТОЛЬКО канонический путь занятия (re-complete с новой суммой / tutor_revert_lesson) —
// rule 60, никакой прямой записи в ledger (иначе рассинхрон с tutor_payments//pay-ботом).

function entryLabel(e: LedgerEntry): string {
  if (e.source_kind === 'lesson') return 'Занятие';
  if (e.source_kind === 'topup') return 'Оплата';
  if (e.note?.startsWith('seed:')) return e.kind === 'credit' ? 'Оплачено (история)' : 'Начисление (история)';
  return 'Корректировка';
}

function EntryIcon({ e }: { e: LedgerEntry }) {
  const Icon = e.source_kind === 'lesson' ? CalendarDays : e.source_kind === 'topup' ? Wallet : SlidersHorizontal;
  return <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />;
}

/** Диалог правки списания за занятие — роутится через канонический re-complete (rule 60). */
function LessonChargeDialog({
  entry, tutorStudentId, onClose,
}: { entry: LedgerEntry; tutorStudentId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const lessonId = entry.source_lesson_id as string;
  const [amountText, setAmountText] = useState(String(entry.amount));

  const info = useQuery({
    queryKey: ['tutor', 'ledger-lesson-info', lessonId, tutorStudentId],
    queryFn: async () => {
      const [{ data: lesson }, { data: payment }] = await Promise.all([
        supabase.from('tutor_lessons').select('id, student_id, start_at').eq('id', lessonId).maybeSingle(),
        supabase.from('tutor_payments').select('status').eq('lesson_id', lessonId).eq('tutor_student_id', tutorStudentId).maybeSingle(),
      ]);
      return { lesson, paymentStatus: payment?.status ?? 'pending' };
    },
    refetchOnWindowFocus: false,
  });

  const isGroup = info.data?.lesson ? info.data.lesson.student_id === null : false;
  const lessonGone = info.isSuccess && !info.data?.lesson;
  const amount = parseInt(amountText.replace(/[^\d]/g, ''), 10);
  const amountValid = Number.isFinite(amount) && amount > 0;

  const save = useMutation({
    mutationFn: async () => {
      const status = info.data?.paymentStatus === 'paid' ? 'paid' : 'pending';
      return completeLessonAndCreatePayment(lessonId, amount, status);
    },
    onSuccess: (ok) => {
      if (!ok) {
        toast.error('Не удалось изменить списание. Попробуйте ещё раз.');
        return;
      }
      toast.success(`Списание обновлено: ${formatCurrency(amount)}`);
      qc.invalidateQueries({ queryKey: ['tutor', 'balance', tutorStudentId] });
      qc.invalidateQueries({ queryKey: ['tutor', 'ledger', tutorStudentId] });
      qc.invalidateQueries({ queryKey: ['tutor', 'students'] });
      qc.invalidateQueries({ queryKey: ['tutor', 'payments'] });
      qc.invalidateQueries({ queryKey: ['tutor', 'lessons'] });
      onClose();
    },
    onError: () => toast.error('Не удалось изменить списание.'),
  });

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !save.isPending) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Изменить списание за занятие</DialogTitle>
        </DialogHeader>
        {info.isLoading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Загружаю занятие…
          </div>
        ) : lessonGone ? (
          <p className="py-2 text-sm text-muted-foreground">
            Занятие не найдено (удалено). Используйте «Отменить запись», чтобы вернуть сумму на баланс.
          </p>
        ) : isGroup ? (
          <p className="py-2 text-sm text-muted-foreground">
            Это групповое занятие — сумма участника меняется в карточке занятия в «Расписании»
            (состав группы → сумма), чтобы оплата и баланс остались согласованы.
          </p>
        ) : (
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Сумма обновится и в оплате занятия, и на балансе (текущая: {formatCurrency(entry.amount)}).
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="charge-amount">Сумма списания (₽)</Label>
              <Input
                id="charge-amount"
                inputMode="numeric"
                autoComplete="off"
                value={amountText}
                onChange={(e) => setAmountText(e.target.value)}
                className="text-base"
              />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>Закрыть</Button>
          {!isGroup && !lessonGone && (
            <Button
              onClick={() => save.mutate()}
              disabled={!amountValid || amount === entry.amount || save.isPending || info.isLoading}
            >
              {save.isPending ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Сохраняю…</> : 'Сохранить'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function LedgerFeed({
  tutorStudentId, entries,
}: { tutorStudentId: string; entries: LedgerEntry[] }) {
  const qc = useQueryClient();
  const [editTopupTarget, setEditTopupTarget] = useState<TopupEditTarget | null>(null);
  const [lessonEditEntry, setLessonEditEntry] = useState<LedgerEntry | null>(null);
  const [cancelEntry, setCancelEntry] = useState<LedgerEntry | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { byId, visible } = useMemo(() => {
    const map = new Map(entries.map((e) => [e.id, e]));
    const replacedIds = new Set(
      entries.filter((e) => e.replaces_entry_id).map((e) => e.replaces_entry_id as string),
    );
    return {
      byId: map,
      visible: entries.filter(
        (e) => !e.reverses_entry_id && !(e.reversed_by_entry_id && replacedIds.has(e.id)),
      ),
    };
  }, [entries]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['tutor', 'balance', tutorStudentId] });
    qc.invalidateQueries({ queryKey: ['tutor', 'ledger', tutorStudentId] });
    qc.invalidateQueries({ queryKey: ['tutor', 'students'] });
  };

  const cancel = useMutation({
    mutationFn: async (entry: LedgerEntry) => {
      // Активное списание за существующее занятие → канонический revert занятия (синхронно
      // снимает оплату + debit). Иначе — обычный reverse записи ledger.
      if (entry.source_kind === 'lesson' && entry.kind === 'debit' && entry.source_lesson_id) {
        const res = await revertLesson(entry.source_lesson_id);
        if (!res.ok) {
          const friendly = res.errorMessage?.includes('NOT_OWNED_OR_NOT_COMPLETED')
            ? 'Занятие не найдено или уже отменено. Удалите занятие в «Расписании» — списание вернётся автоматически.'
            : res.errorMessage ?? 'Не удалось отменить списание.';
          return { ok: false as const, error: friendly };
        }
        return { ok: true as const };
      }
      const res = await reverseLedgerEntry(entry.id, 'отменено репетитором');
      return res.ok ? { ok: true as const } : { ok: false as const, error: res.error };
    },
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(res.error ?? 'Не удалось отменить запись.');
        return;
      }
      toast.success('Запись отменена, баланс обновлён');
      invalidate();
      qc.invalidateQueries({ queryKey: ['tutor', 'payments'] });
      qc.invalidateQueries({ queryKey: ['tutor', 'lessons'] });
      setCancelEntry(null);
    },
    onError: () => toast.error('Не удалось отменить запись.'),
  });

  if (visible.length === 0) {
    return <p className="py-2 text-sm text-muted-foreground">Операций пока нет.</p>;
  }

  return (
    <div className="divide-y divide-slate-100">
      {visible.map((e) => {
        const isCancelled = Boolean(e.reversed_by_entry_id);
        const isCorrected = Boolean(e.replaces_entry_id);
        const isCredit = e.kind === 'credit';
        // История правок: цепочка заменённых записей (в пределах загруженного окна).
        const history: LedgerEntry[] = [];
        let cursor = e.replaces_entry_id;
        while (cursor) {
          const prev = byId.get(cursor);
          if (!prev) break;
          history.push(prev);
          cursor = prev.replaces_entry_id;
        }
        const canEditTopup = !isCancelled && e.source_kind === 'topup' && isCredit && !e.reverses_entry_id;
        const canEditLesson = !isCancelled && e.source_kind === 'lesson' && e.kind === 'debit' && Boolean(e.source_lesson_id);
        const canCancel = !isCancelled && !e.reverses_entry_id;

        return (
          <div key={e.id} className="py-2.5">
            <div className="flex items-center gap-2.5">
              <EntryIcon e={e} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className={cn('text-sm font-medium', isCancelled && 'text-muted-foreground line-through')}>
                    {entryLabel(e)}
                  </span>
                  {isCancelled && (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">отменено</span>
                  )}
                  {isCorrected && !isCancelled && (
                    <button
                      type="button"
                      onClick={() => setExpandedId(expandedId === e.id ? null : e.id)}
                      className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-amber-200"
                      style={{ touchAction: 'manipulation' }}
                    >
                      <History className="h-3 w-3" aria-hidden="true" /> исправлено
                      <ChevronDown className={cn('h-3 w-3 transition-transform', expandedId === e.id && 'rotate-180')} aria-hidden="true" />
                    </button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {format(parseISO(e.occurred_on), 'd MMMM yyyy', { locale: ru })}
                  {e.note && !e.note.startsWith('seed:') && !e.note.startsWith('reverse:') ? ` · ${e.note}` : ''}
                </p>
                {isCorrected && expandedId === e.id && history.length > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    История: {history.map((h) => formatCurrency(h.amount)).join(' → ')} → {formatCurrency(e.amount)}
                  </p>
                )}
              </div>
              <span
                className={cn(
                  'text-sm font-semibold tabular-nums',
                  isCancelled ? 'text-muted-foreground line-through' : isCredit ? 'text-emerald-600' : 'text-slate-900',
                )}
              >
                {isCredit ? '+' : '−'}{formatCurrency(e.amount)}
              </span>
              {(canEditTopup || canEditLesson || canCancel) && (
                <div className="flex shrink-0 items-center gap-0.5">
                  {canEditTopup && (
                    <Button
                      variant="ghost" size="icon" className="h-8 w-8"
                      aria-label="Изменить пополнение" title="Изменить"
                      onClick={() => setEditTopupTarget({ id: e.id, amount: e.amount, occurred_on: e.occurred_on })}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {canEditLesson && (
                    <Button
                      variant="ghost" size="icon" className="h-8 w-8"
                      aria-label="Изменить списание" title="Изменить списание"
                      onClick={() => setLessonEditEntry(e)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  {canCancel && (
                    <Button
                      variant="ghost" size="icon" className="h-8 w-8"
                      aria-label="Отменить запись" title="Отменить запись"
                      onClick={() => setCancelEntry(e)}
                    >
                      <Undo2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}

      <TopupDialog
        open={editTopupTarget !== null}
        onOpenChange={(o) => { if (!o) setEditTopupTarget(null); }}
        tutorStudentId={tutorStudentId}
        editEntry={editTopupTarget}
      />

      {lessonEditEntry && (
        <LessonChargeDialog
          entry={lessonEditEntry}
          tutorStudentId={tutorStudentId}
          onClose={() => setLessonEditEntry(null)}
        />
      )}

      <AlertDialog open={cancelEntry !== null} onOpenChange={(o) => { if (!o && !cancel.isPending) setCancelEntry(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {cancelEntry?.source_kind === 'lesson' && cancelEntry.source_lesson_id
                ? 'Отменить списание за занятие?'
                : 'Отменить запись?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {cancelEntry?.source_kind === 'lesson' && cancelEntry.source_lesson_id
                ? `Занятие будет помечено как отменённое, неоплаченная оплата удалится, ${formatCurrency(cancelEntry.amount)} вернётся на баланс.`
                : cancelEntry
                  ? `Сумма ${formatCurrency(cancelEntry.amount)} будет ${cancelEntry.kind === 'credit' ? 'снята с баланса' : 'возвращена на баланс'}. Запись останется в истории с пометкой «отменено».`
                  : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancel.isPending}>Не отменять</AlertDialogCancel>
            <AlertDialogAction
              onClick={(ev) => { ev.preventDefault(); if (cancelEntry) cancel.mutate(cancelEntry); }}
              disabled={cancel.isPending}
            >
              {cancel.isPending ? 'Отменяю…' : 'Отменить запись'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
