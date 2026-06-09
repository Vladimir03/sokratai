import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Wallet, Plus, Loader2, FileText, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/formatters';
import { getStudentBalance, recordTopup } from '@/lib/tutorBalanceApi';

// Карточка-сводка баланса ученика (Phase 2a, TASK-5) — ПЕРВЫМ блоком вкладки «Обзор».
// Баланс = Σ ledger (РУБЛИ). Отрицательный = должен. Job: «знать сколько должен» +
// «зафиксировать оплату одним числом». Лента операций / отчёт родителю — позже (TASK-6 / 2c).
export default function StudentBalanceCard({ tutorStudentId }: { tutorStudentId: string }) {
  const qc = useQueryClient();

  const { data: balance, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['tutor', 'balance', tutorStudentId],
    queryFn: () => getStudentBalance(tutorStudentId),
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });

  const [open, setOpen] = useState(false);
  const [amountText, setAmountText] = useState('');
  const [dateText, setDateText] = useState(() => format(new Date(), 'yyyy-MM-dd'));

  const amount = parseInt(amountText.replace(/[^\d]/g, ''), 10);
  const amountValid = Number.isFinite(amount) && amount > 0;

  const topup = useMutation({
    mutationFn: () => recordTopup(tutorStudentId, amount, dateText || undefined),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(res.error ?? 'Не удалось внести оплату.');
        return;
      }
      toast.success(`Оплата ${formatCurrency(amount)} внесена`);
      qc.invalidateQueries({ queryKey: ['tutor', 'balance', tutorStudentId] });
      qc.invalidateQueries({ queryKey: ['tutor', 'ledger', tutorStudentId] });
      setOpen(false);
      setAmountText('');
    },
    onError: () => toast.error('Не удалось внести оплату.'),
  });

  const bal = balance ?? 0;
  const tone =
    bal < 0 ? 'text-rose-600' : bal > 0 ? 'text-emerald-600' : 'text-slate-900';
  const statusLabel =
    bal < 0 ? 'Задолженность' : bal > 0 ? 'Предоплата' : 'Нет задолженности';

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <Wallet className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Баланс ученика
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Загрузка баланса…
          </div>
        ) : isError ? (
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground">Не удалось загрузить баланс.</span>
            <Button variant="ghost" size="sm" onClick={() => refetch()} className="min-h-[36px]">
              <RefreshCw className="mr-1 h-3.5 w-3.5" /> Обновить
            </Button>
          </div>
        ) : (
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className={cn('text-3xl font-bold tabular-nums', tone)}>{formatCurrency(bal)}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">{statusLabel}</p>
            </div>
            {isFetching && <Loader2 className="mb-1 h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => setOpen(true)}
            disabled={isLoading || isError}
            className="min-h-[44px]"
          >
            <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> Внести оплату
          </Button>
          <Button
            variant="outline"
            disabled
            title="Скоро — отчёт родителю по балансу и прогрессу"
            className="min-h-[44px]"
          >
            <FileText className="mr-1.5 h-4 w-4" aria-hidden="true" /> Отчёт родителю
          </Button>
        </div>
      </CardContent>

      <Dialog open={open} onOpenChange={(o) => { if (!topup.isPending) setOpen(o); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Внести оплату</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
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
              <Label htmlFor="topup-date">Дата (необязательно)</Label>
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
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={topup.isPending}>
              Отмена
            </Button>
            <Button onClick={() => topup.mutate()} disabled={!amountValid || topup.isPending}>
              {topup.isPending ? (
                <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Сохраняю…</>
              ) : (
                <>Внести{amountValid ? ` ${formatCurrency(amount)}` : ''}</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
