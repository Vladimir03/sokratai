import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import { Wallet, Plus, Loader2, FileText, RefreshCw, Pencil, ChevronDown } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/formatters';
import { getStudentBalance, listLedger } from '@/lib/tutorBalanceApi';
import TopupDialog, { type TopupEditTarget } from './TopupDialog';
import LedgerFeed from './LedgerFeed';
import ParentReportDialog from './ParentReportDialog';

// Карточка-сводка баланса ученика (Phase 2a, TASK-5+6) — ПЕРВЫМ блоком вкладки «Обзор».
// Баланс = Σ ledger (РУБЛИ). Отрицательный = должен. Последнее пополнение правится в один
// клик (кейс «только что внёс и опечатался»); «Все операции» раскрывает ленту (LedgerFeed).
export default function StudentBalanceCard({ tutorStudentId }: { tutorStudentId: string }) {
  const { data: balance, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['tutor', 'balance', tutorStudentId],
    queryFn: () => getStudentBalance(tutorStudentId),
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });

  const ledger = useQuery({
    queryKey: ['tutor', 'ledger', tutorStudentId],
    queryFn: () => listLedger(tutorStudentId),
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });

  const [topupOpen, setTopupOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<TopupEditTarget | null>(null);
  const [feedOpen, setFeedOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  // Последнее активное пополнение — быстрый Pencil прямо на карточке.
  const lastTopup = useMemo(
    () =>
      (ledger.data ?? []).find(
        (e) => e.source_kind === 'topup' && e.kind === 'credit' && !e.reversed_by_entry_id && !e.reverses_entry_id,
      ) ?? null,
    [ledger.data],
  );

  const visibleOpsCount = useMemo(() => {
    const entries = ledger.data ?? [];
    const replacedIds = new Set(entries.filter((e) => e.replaces_entry_id).map((e) => e.replaces_entry_id as string));
    return entries.filter((e) => !e.reverses_entry_id && !(e.reversed_by_entry_id && replacedIds.has(e.id))).length;
  }, [ledger.data]);

  const bal = balance ?? 0;
  const tone = bal < 0 ? 'text-rose-600' : bal > 0 ? 'text-emerald-600' : 'text-slate-900';
  const statusLabel = bal < 0 ? 'Задолженность' : bal > 0 ? 'Предоплата' : 'Нет задолженности';

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
          <Button onClick={() => setTopupOpen(true)} disabled={isLoading || isError} className="min-h-[44px]">
            <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> Внести оплату
          </Button>
          <Button
            variant="outline"
            onClick={() => setReportOpen(true)}
            title="Отчёт для родителя: прогресс и баланс по ссылке"
            className="min-h-[44px]"
          >
            <FileText className="mr-1.5 h-4 w-4" aria-hidden="true" /> Отчёт родителю
          </Button>
        </div>

        {lastTopup && (
          <div className="flex items-center justify-between gap-2 rounded-lg bg-socrat-surface px-3 py-2">
            <p className="text-sm text-muted-foreground">
              Последняя оплата:{' '}
              <span className="font-medium text-emerald-600">+{formatCurrency(lastTopup.amount)}</span>
              {' · '}
              {format(parseISO(lastTopup.occurred_on), 'd MMMM', { locale: ru })}
            </p>
            <Button
              variant="ghost" size="icon" className="h-8 w-8 shrink-0"
              aria-label="Изменить последнее пополнение" title="Изменить (опечатка в сумме/дате)"
              onClick={() => setEditTarget({ id: lastTopup.id, amount: lastTopup.amount, occurred_on: lastTopup.occurred_on })}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}

        {(ledger.data?.length ?? 0) > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setFeedOpen((v) => !v)}
              className="flex min-h-[44px] w-full items-center justify-between text-sm font-medium text-slate-700 hover:text-slate-900"
              style={{ touchAction: 'manipulation' }}
              aria-expanded={feedOpen}
            >
              <span>Все операции ({visibleOpsCount})</span>
              <ChevronDown className={cn('h-4 w-4 transition-transform', feedOpen && 'rotate-180')} aria-hidden="true" />
            </button>
            {feedOpen && <LedgerFeed tutorStudentId={tutorStudentId} entries={ledger.data ?? []} />}
          </div>
        )}
      </CardContent>

      <TopupDialog open={topupOpen} onOpenChange={setTopupOpen} tutorStudentId={tutorStudentId} />
      <TopupDialog
        open={editTarget !== null}
        onOpenChange={(o) => { if (!o) setEditTarget(null); }}
        tutorStudentId={tutorStudentId}
        editEntry={editTarget}
      />
      <ParentReportDialog open={reportOpen} onOpenChange={setReportOpen} tutorStudentId={tutorStudentId} />
    </Card>
  );
}
