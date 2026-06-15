import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatCurrency } from '@/lib/formatters';
import { editTopup, parseRubleAmount, recordTopup } from '@/lib/tutorBalanceApi';

export interface TopupEditTarget {
  id: string;
  amount: number;
  occurred_on: string;
}

/** Опция выбора ученика для режима «+ Добавить» на странице «Оплаты». */
export interface TopupStudentOption {
  id: string;
  name: string;
  hourly_rate_cents?: number | null;
}

interface TopupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Конкретный ученик (карточка/должники/правка ленты). В режиме выбора может быть пустым. */
  tutorStudentId: string;
  /** Для заголовка в контексте списка должников. */
  studentName?: string;
  /** Если задано — режим правки (атомарный reverse+new), иначе новое пополнение. */
  editEntry?: TopupEditTarget | null;
  /**
   * Если задано — режим «выбрать ученика» (страница «Оплаты» «+ Добавить»): рендерится селектор
   * ученика + quick-amount чипы по ставке. Не показывается в режиме правки.
   */
  students?: TopupStudentOption[];
  /** Колбэк после успешного сохранения (для доп. инвалидации, напр. кросс-ученического списка «Оплат»). */
  onSaved?: (tutorStudentId: string) => void;
}

// «Внести оплату» / «Изменить пополнение» — одно поле ₽ + дата (решение Vladimir).
// Используется карточкой баланса, лентой операций, списком должников и страницей «Оплаты» (select-режим).
export default function TopupDialog({
  open, onOpenChange, tutorStudentId, studentName, editEntry, students, onSaved,
}: TopupDialogProps) {
  const qc = useQueryClient();
  const isEdit = Boolean(editEntry);
  const selectMode = Boolean(students) && !isEdit;

  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [amountText, setAmountText] = useState('');
  const [dateText, setDateText] = useState(() => format(new Date(), 'yyyy-MM-dd'));

  // Префилл при открытии (правка → старые значения; создание → пустая сумма + сегодня).
  useEffect(() => {
    if (!open) return;
    setSelectedStudentId('');
    setAmountText(editEntry ? String(editEntry.amount) : '');
    setDateText(editEntry ? editEntry.occurred_on : format(new Date(), 'yyyy-MM-dd'));
  }, [open, editEntry]);

  const effectiveStudentId = selectMode ? selectedStudentId : tutorStudentId;

  const selectedStudent = useMemo(
    () => (selectMode ? students?.find((s) => s.id === selectedStudentId) ?? null : null),
    [selectMode, students, selectedStudentId],
  );
  const hourlyRate = selectedStudent?.hourly_rate_cents ? selectedStudent.hourly_rate_cents / 100 : null;

  // Строгий парсинг (P1 ревью): «-5000»/«1,5» → invalid, НЕ молча другое число.
  const parsedAmount = parseRubleAmount(amountText);
  const amountValid = parsedAmount !== null;
  const amount = parsedAmount ?? 0;
  const unchanged = isEdit && editEntry
    ? amount === editEntry.amount && dateText === editEntry.occurred_on
    : false;
  const studentMissing = selectMode && !selectedStudentId;

  const save = useMutation({
    mutationFn: () =>
      isEdit && editEntry
        ? editTopup(editEntry.id, amount, dateText || undefined)
        : recordTopup(effectiveStudentId, amount, dateText || undefined),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(res.error ?? 'Не удалось сохранить.');
        return;
      }
      toast.success(isEdit ? `Пополнение исправлено: ${formatCurrency(amount)}` : `Оплата ${formatCurrency(amount)} внесена`);
      qc.invalidateQueries({ queryKey: ['tutor', 'balance', effectiveStudentId] });
      qc.invalidateQueries({ queryKey: ['tutor', 'ledger', effectiveStudentId] });
      qc.invalidateQueries({ queryKey: ['tutor', 'students'] });
      qc.invalidateQueries({ queryKey: ['tutor', 'student', effectiveStudentId] }); // шапка-чип «Долг» профиля
      qc.invalidateQueries({ queryKey: ['tutor', 'received-payments'] }); // журнал «Оплаты» (любой источник topup)
      onSaved?.(effectiveStudentId);
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
            {!selectMode && studentName ? ` — ${studentName}` : ''}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {isEdit && editEntry && (
            <p className="text-sm text-muted-foreground">
              Было: {formatCurrency(editEntry.amount)}. Исправление сохранится в истории операций.
            </p>
          )}
          {selectMode && (
            <div className="space-y-1.5">
              <Label htmlFor="topup-student">Ученик</Label>
              <Select value={selectedStudentId} onValueChange={setSelectedStudentId}>
                <SelectTrigger id="topup-student" className="text-base">
                  <SelectValue placeholder="Выберите ученика" />
                </SelectTrigger>
                <SelectContent>
                  {students!.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
            {selectMode && hourlyRate && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                <span className="text-xs text-muted-foreground self-center">Ставка {hourlyRate} ₽/ч:</span>
                {[1, 1.5, 2, 4, 8].map((h) => (
                  <Badge
                    key={h}
                    variant="outline"
                    className="cursor-pointer py-0.5 text-xs font-normal hover:bg-muted"
                    onClick={() => setAmountText(String(Math.round(hourlyRate * h)))}
                  >
                    {h} ч
                  </Badge>
                ))}
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="topup-date">{selectMode ? 'Дата оплаты' : 'Дата'}</Label>
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
          <Button onClick={() => save.mutate()} disabled={!amountValid || unchanged || studentMissing || save.isPending}>
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
