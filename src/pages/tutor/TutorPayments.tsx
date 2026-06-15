import { useState, useMemo, useCallback, memo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import { Plus, Bell, Copy, ExternalLink, Trash2, Wallet, Pencil, CalendarDays } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { TutorDataStatus } from '@/components/tutor/TutorDataStatus';
import { useTutorReceivedPayments, useTutorStudents } from '@/hooks/useTutor';
import { formatCurrency } from '@/lib/formatters';
import {
  getMonthIncome,
  getReceivedPaymentsTotal,
  reverseLedgerEntry,
  RECEIVED_PAYMENTS_LIST_LIMIT,
  type TutorReceivedPayment,
} from '@/lib/tutorBalanceApi';
import TopupDialog, { type TopupEditTarget, type TopupStudentOption } from '@/components/tutor/students/TopupDialog';
import type { TutorStudentWithProfile } from '@/types/tutor';

// =============================================
// Страница «Оплаты» — единый баланс (ledger), а не legacy tutor_payments.
// Список = кросс-ученический журнал ПОЛУЧЕННЫХ оплат (active credits) для сверки с поступлениями на карту.
// «+ Добавить» = пополнение баланса (topup), всегда «получено», без подтверждения.
// План: ~/.claude/plans/1-glowing-spindle.md
// =============================================

function resolveStudentName(s: TutorStudentWithProfile): string {
  return s.display_name?.trim() || s.profiles?.full_name || s.profiles?.username || 'Без имени';
}

function formatPaymentDate(dateKey: string): string {
  try {
    return format(parseISO(dateKey), 'd MMM yyyy', { locale: ru });
  } catch {
    return dateKey;
  }
}

function sourceLabel(p: TutorReceivedPayment): string {
  if (p.source_kind === 'lesson') return 'Занятие';
  if (p.source_kind === 'topup') return 'Оплата';
  if (p.note?.startsWith('seed:') || p.note?.startsWith('reconcile:')) return 'Оплачено (история)';
  return 'Корректировка';
}

// =============================================
// Должники по балансу (balance < 0) + «Напомнить»
// =============================================

function DebtorsCard({ students }: { students: TutorStudentWithProfile[] }) {
  const [topupFor, setTopupFor] = useState<{ id: string; name: string } | null>(null);
  const [remindFor, setRemindFor] = useState<{ name: string; debt: number; parentContact: string | null } | null>(null);

  const debtors = useMemo(
    () =>
      students
        .filter((s) => (s.balance ?? 0) < 0)
        .sort((a, b) => (a.balance ?? 0) - (b.balance ?? 0)),
    [students],
  );

  if (debtors.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <Wallet className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Должники по балансу ({debtors.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="divide-y divide-slate-100 pt-0">
        {debtors.map((s) => {
          const name = resolveStudentName(s);
          const debt = -(s.balance ?? 0);
          return (
            <div key={s.id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
              <span className="shrink-0 text-sm font-semibold tabular-nums text-rose-600">
                {formatCurrency(s.balance ?? 0)}
              </span>
              {s.parent_contact && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="shrink-0"
                  onClick={() => setRemindFor({ name, debt, parentContact: s.parent_contact ?? null })}
                >
                  <Bell className="h-4 w-4" aria-hidden="true" />
                  <span className="sr-only">Напомнить</span>
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                className="shrink-0"
                onClick={() => setTopupFor({ id: s.id, name })}
              >
                Внести
              </Button>
            </div>
          );
        })}
        {topupFor && (
          <TopupDialog
            open
            onOpenChange={(o) => { if (!o) setTopupFor(null); }}
            tutorStudentId={topupFor.id}
            studentName={topupFor.name}
          />
        )}
        <RemindDialog
          open={remindFor !== null}
          onOpenChange={(o) => { if (!o) setRemindFor(null); }}
          target={remindFor}
        />
      </CardContent>
    </Card>
  );
}

// =============================================
// Строка журнала полученных оплат
// =============================================

const ReceivedPaymentRow = memo(function ReceivedPaymentRow({
  payment, studentName, onEdit, onDelete,
}: {
  payment: TutorReceivedPayment;
  studentName: string;
  onEdit: (p: TutorReceivedPayment) => void;
  onDelete: (p: TutorReceivedPayment) => void;
}) {
  const canEdit = payment.source_kind === 'topup';
  const canDelete = payment.source_kind === 'topup' || payment.source_kind === 'adjustment';

  return (
    <TableRow>
      <TableCell className="font-medium">{studentName}</TableCell>
      <TableCell className="text-right font-semibold tabular-nums text-emerald-600">
        +{formatCurrency(payment.amount)}
      </TableCell>
      <TableCell className="text-muted-foreground">{formatPaymentDate(payment.occurred_on)}</TableCell>
      <TableCell className="text-muted-foreground">{sourceLabel(payment)}</TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
          {canEdit && (
            <Button variant="ghost" size="icon" title="Изменить" onClick={() => onEdit(payment)}>
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          {canDelete && (
            <Button variant="ghost" size="icon" title="Удалить" onClick={() => onDelete(payment)}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
});

// =============================================
// Основной компонент
// =============================================

function TutorPaymentsContent() {
  const {
    students,
    error: studentsError,
    loading: studentsLoading,
    refetch: refetchStudents,
    isFetching: studentsIsFetching,
  } = useTutorStudents();

  // Фильтры (server-side по occurred_on)
  const [studentFilter, setStudentFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const {
    payments,
    error: paymentsError,
    loading: paymentsLoading,
    refetch: refetchPayments,
    isFetching: paymentsIsFetching,
  } = useTutorReceivedPayments({
    studentId: studentFilter !== 'all' ? studentFilter : undefined,
    from: dateFrom || undefined,
    to: dateTo || undefined,
  });

  // Точный итог «Получено» (Σ + count по фильтру) — отдельно от капнутого списка (round-2 #6).
  const receivedTotalQuery = useQuery({
    queryKey: ['tutor', 'received-payments', 'total', studentFilter, dateFrom, dateTo],
    queryFn: () => getReceivedPaymentsTotal({
      studentId: studentFilter !== 'all' ? studentFilter : undefined,
      from: dateFrom || undefined,
      to: dateTo || undefined,
    }),
    refetchOnWindowFocus: false,
    staleTime: 60 * 1000,
  });

  // Доход за месяц (Σ активных lesson-списаний месяца) — KPI, ключ общий с MonthIncomeStrip.
  const now = useMemo(() => new Date(), []);
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const monthIncome = useQuery({
    queryKey: ['tutor', 'ledger', 'month-income', monthKey],
    queryFn: () => getMonthIncome(now.getFullYear(), now.getMonth()),
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000,
  });

  // Диалоги
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<{ entry: TopupEditTarget; studentId: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TutorReceivedPayment | null>(null);

  const qc = useQueryClient();

  const invalidateAll = useCallback((studentId: string) => {
    qc.invalidateQueries({ queryKey: ['tutor', 'balance', studentId] });
    qc.invalidateQueries({ queryKey: ['tutor', 'ledger', studentId] });
    qc.invalidateQueries({ queryKey: ['tutor', 'students'] });
    qc.invalidateQueries({ queryKey: ['tutor', 'student', studentId] });
    qc.invalidateQueries({ queryKey: ['tutor', 'received-payments'] });
  }, [qc]);

  const studentNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of students) map.set(s.id, resolveStudentName(s));
    return map;
  }, [students]);

  const studentOptions = useMemo<TopupStudentOption[]>(
    () => students.map((s) => ({ id: s.id, name: resolveStudentName(s), hourly_rate_cents: s.hourly_rate_cents })),
    [students],
  );

  // Сводки. «Получено» показываем ТОЛЬКО при успехе aggregate-RPC (round-4 #6): на загрузке И на ошибке
  // → «—», БЕЗ фолбэка на сумму капнутого списка (иначе при зависшем запросе долго висело бы неверное
  // число первых 200 строк как «итог»).
  const receivedTotal = receivedTotalQuery.isSuccess ? receivedTotalQuery.data.total : null;
  const receivedCount = receivedTotalQuery.isSuccess ? receivedTotalQuery.data.count : null;
  const listTruncated = payments.length >= RECEIVED_PAYMENTS_LIST_LIMIT;
  const totalDebt = useMemo(
    () => students.reduce((sum, s) => sum + ((s.balance ?? 0) < 0 ? -(s.balance ?? 0) : 0), 0),
    [students],
  );
  const debtorCount = useMemo(() => students.filter((s) => (s.balance ?? 0) < 0).length, [students]);

  const deleteMutation = useMutation({
    mutationFn: (p: TutorReceivedPayment) => reverseLedgerEntry(p.id, 'отменено репетитором'),
    onSuccess: (res, p) => {
      if (!res.ok) {
        toast.error(res.error ?? 'Не удалось удалить запись.');
        return;
      }
      toast.success('Оплата снята с баланса');
      invalidateAll(p.tutor_student_id);
      setDeleteTarget(null);
    },
    onError: () => toast.error('Не удалось удалить запись.'),
  });

  const handleRetryAll = useCallback(() => {
    refetchPayments();
    refetchStudents();
  }, [refetchPayments, refetchStudents]);

  const initialLoading = studentsLoading && students.length === 0 && !studentsError;

  // round-2 #8 (rule 95): critical только когда нет несущих данных (0 учеников). Фоновый refetch-fail
  // с уже загруженными учениками → degraded (тихо), не баннер поверх данных.
  const studentsCritical = studentsError && students.length === 0 ? studentsError : null;
  const isDegraded = (Boolean(paymentsError) || (Boolean(studentsError) && students.length > 0)) && !studentsCritical;

  if (initialLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Несущие данные = students (должники/сводка/select/имена). Падение списка оплат при
          загруженных students → degraded, не критичный баннер (rule 95, без OR-of-N). */}
      <TutorDataStatus
        criticalError={studentsCritical}
        degraded={isDegraded}
        isFetching={studentsIsFetching || paymentsIsFetching}
        onRetry={handleRetryAll}
      />

      {/* Заголовок */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Wallet className="h-6 w-6 text-accent" aria-hidden="true" />
          Оплаты
        </h1>
        <Button onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Добавить
        </Button>
      </div>

      {/* Должники по балансу */}
      <DebtorsCard students={students} />

      {/* Фильтры */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Ученик</Label>
          <Select value={studentFilter} onValueChange={setStudentFilter}>
            <SelectTrigger className="w-[220px] text-base">
              <SelectValue placeholder="Ученик" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все ученики</SelectItem>
              {students.map((s) => (
                <SelectItem key={s.id} value={s.id}>{resolveStudentName(s)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="dateFrom" className="text-xs text-muted-foreground">Дата оплаты: с</Label>
          <Input id="dateFrom" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-[170px] text-base" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="dateTo" className="text-xs text-muted-foreground">Дата оплаты: по</Label>
          <Input id="dateTo" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-[170px] text-base" />
        </div>
      </div>

      {/* Сводки */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Получено</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-emerald-600">{receivedTotal === null ? '—' : formatCurrency(receivedTotal)}</p>
            <p className="text-sm text-muted-foreground">
              {receivedTotalQuery.isError ? 'не удалось посчитать' : receivedCount === null ? 'считаем…' : `${receivedCount} оплат`}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Ожидается к получению</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-rose-600">{formatCurrency(totalDebt)}</p>
            <p className="text-sm text-muted-foreground">{debtorCount} должников</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
              <CalendarDays className="h-4 w-4" aria-hidden="true" />
              Доход за месяц
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{monthIncome.data ? formatCurrency(monthIncome.data.earned) : '—'}</p>
            <p className="text-sm text-muted-foreground">
              {monthIncome.data ? `ожидается ${formatCurrency(monthIncome.data.expected)}` : 'считаем…'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Таблица полученных оплат */}
      <Card>
        <div className="overflow-x-auto touch-pan-x">
          <Table className="min-w-[640px] [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap">
            <TableHeader>
              <TableRow>
                <TableHead>Ученик</TableHead>
                <TableHead className="text-right">Сумма</TableHead>
                <TableHead>Дата оплаты</TableHead>
                <TableHead>Источник</TableHead>
                <TableHead className="text-right">Действия</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    {paymentsError
                      ? 'Не удалось обновить список оплат. Выполняется восстановление…'
                      : paymentsLoading
                        ? 'Загрузка…'
                        : 'Полученных оплат пока нет'}
                  </TableCell>
                </TableRow>
              ) : (
                payments.map((p) => (
                  <ReceivedPaymentRow
                    key={p.id}
                    payment={p}
                    studentName={studentNameById.get(p.tutor_student_id) ?? 'Без имени'}
                    onEdit={(pay) => setEditTarget({
                      entry: { id: pay.id, amount: pay.amount, occurred_on: pay.occurred_on },
                      studentId: pay.tutor_student_id,
                    })}
                    onDelete={(pay) => setDeleteTarget(pay)}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </div>
        {listTruncated && (
          <p className="px-4 py-2 text-xs text-muted-foreground">
            Показаны последние {RECEIVED_PAYMENTS_LIST_LIMIT} оплат. Итог «Получено» учитывает все за период.
          </p>
        )}
      </Card>

      {/* «+ Добавить» — пополнение баланса (select-режим TopupDialog) */}
      <TopupDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        tutorStudentId=""
        students={studentOptions}
        onSaved={() => qc.invalidateQueries({ queryKey: ['tutor', 'received-payments'] })}
      />

      {/* Правка пополнения (только topup) */}
      <TopupDialog
        open={editTarget !== null}
        onOpenChange={(o) => { if (!o) setEditTarget(null); }}
        tutorStudentId={editTarget?.studentId ?? ''}
        editEntry={editTarget?.entry ?? null}
        onSaved={() => qc.invalidateQueries({ queryKey: ['tutor', 'received-payments'] })}
      />

      {/* Удаление (сторно) полученной оплаты */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => { if (!o && !deleteMutation.isPending) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить оплату?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `Сумма ${formatCurrency(deleteTarget.amount)} будет снята с баланса ученика. Запись останется в истории операций с пометкой «отменено».`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Не удалять</AlertDialogCancel>
            <AlertDialogAction
              onClick={(ev) => { ev.preventDefault(); if (deleteTarget) deleteMutation.mutate(deleteTarget); }}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Удаляю…' : 'Удалить'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// =============================================
// Диалог напоминания (должнику)
// =============================================

interface RemindDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: { name: string; debt: number; parentContact: string | null } | null;
}

function RemindDialog({ open, onOpenChange, target }: RemindDialogProps) {
  const parentContact = target?.parentContact ?? null;
  const isTelegramUsername = parentContact?.startsWith('@');

  const reminderText = target
    ? `Здравствуйте! Напоминаю об оплате занятий для ${target.name}.\n\nК оплате: ${formatCurrency(target.debt)}\n\nСпасибо!`
    : '';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(reminderText);
      toast.success('Текст скопирован');
    } catch {
      toast.error('Не удалось скопировать');
    }
  };

  const handleOpenTelegram = () => {
    if (isTelegramUsername && parentContact) {
      window.open(`https://t.me/${parentContact.slice(1)}`, '_blank');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Напомнить об оплате</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <p className="text-sm text-muted-foreground mb-1">Контакт родителя:</p>
            <p className="font-medium">{parentContact || 'Не указан'}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground mb-2">Текст напоминания:</p>
            <div className="bg-muted p-3 rounded-md text-sm whitespace-pre-wrap">{reminderText}</div>
          </div>
        </div>
        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={handleCopy} className="w-full sm:w-auto">
            <Copy className="h-4 w-4 mr-2" />
            Скопировать текст
          </Button>
          {isTelegramUsername && (
            <Button onClick={handleOpenTelegram} className="w-full sm:w-auto">
              <ExternalLink className="h-4 w-4 mr-2" />
              Открыть Telegram
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =============================================
// Экспорт
// =============================================

export default function TutorPayments() {
  return <TutorPaymentsContent />;
}
