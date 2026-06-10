import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatCurrency } from '@/lib/formatters';
import { editTopup, recordTopup } from '@/lib/tutorBalanceApi';

export interface TopupEditTarget {
  id: string;
  amount: number;
  occurred_on: string;
}

interface TopupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tutorStudentId: string;
  /** Для заголовка в контексте списка должников. */
  studentName?: string;
  /** Если задано — режим правки (атомарный reverse+new), иначе новое пополнение. */
  editEntry?: TopupEditTarget | null;
}

// «Внести оплату» / «Изменить пополнение» — одно поле ₽ + дата (решение Vladimir).
// Используется карточкой баланса, лентой операций и списком должников.
export default function TopupDialog({
  open, onOpenChange, tutorStudentId, studentName, editEntry,
}: TopupDialogProps) {
  const qc = useQueryClient();
  const isEdit = Boolean(editEntry);

  const [amountText, setAmountText] = useState('');
  const [dateText, setDateText] = useState(() => format(new Date(), 'yyyy-MM-dd'));

  // Префилл при открытии (правка → старые значения; создание → пустая сумма + сегодня).
  useEffect(() => {
    if (!open) return;
    setAmountText(editEntry ? String(editEntry.amount) : '');
    setDateText(editEntry ? editEntry.occurred_on : format(new Date(), 'yyyy-MM-dd'));
  }, [open, editEntry]);

  const amount = parseInt(amountText.replace(/[^\d]/g, ''), 10);
  const amountValid = Number.isFinite(amount) && amount > 0;
  const unchanged = isEdit && editEntry
    ? amount === editEntry.amount && dateText === editEntry.occurred_on
    : false;

  const save = useMutation({
    mutationFn: () =>
      isEdit && editEntry
        ? editTopup(editEntry.id, amount, dateText || undefined)
        : recordTopup(tutorStudentId, amount, dateText || undefined),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(res.error ?? 'Не удалось сохранить.');
        return;
      }
      toast.success(isEdit ? `Пополнение исправлено: ${formatCurrency(amount)}` : `Оплата ${formatCurrency(amount)} внесена`);
      qc.invalidateQueries({ queryKey: ['tutor', 'balance', tutorStudentId] });
      qc.invalidateQueries({ queryKey: ['tutor', 'ledger', tutorStudentId] });
      qc.invalidateQueries({ queryKey: ['tutor', 'students'] });
      onOpenChange(false);
    },
    onError: () => toast.error('Не удалось сохранить.'),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!save.isPending) onOpenChange(o); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? 'Изменить пополнение' : 'Внести оплату'}
            {studentName ? ` — ${studentName}` : ''}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {isEdit && editEntry && (
            <p className="text-sm text-muted-foreground">
              Было: {formatCurrency(editEntry.amount)}. Исправление сохранится в истории операций.
            </p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="topup-amount">Сумма (₽)</Label>
            <Input
              id="topup-amount"
              inputMode="numeric"
              autoComplete="off"
              placeholder="например, 4000"
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              className="text-base"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="topup-date">Дата</Label>
            <Input
              id="topup-date"
              type="date"
              value={dateText}
              onChange={(e) => setDateText(e.target.value)}
              className="text-base"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            Отмена
          </Button>
          <Button onClick={() => save.mutate()} disabled={!amountValid || unchanged || save.isPending}>
            {save.isPending ? (
              <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Сохраняю…</>
            ) : isEdit ? (
              'Сохранить исправление'
            ) : (
              <>Внести{amountValid ? ` ${formatCurrency(amount)}` : ''}</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
