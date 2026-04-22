import { useState, useMemo, useCallback } from 'react';
import { Plus, Check, Bell, Copy, ExternalLink, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from 'sonner';
import { TutorDataStatus } from '@/components/tutor/TutorDataStatus';
import { useTutorPayments, useTutorStudents } from '@/hooks/useTutor';
import { 
  createTutorPayment, 
  markPaymentAsPaid, 
  deleteTutorPayment 
} from '@/lib/tutors';
import type { TutorPaymentWithStudent } from '@/types/tutor';

// =============================================
// Типы и утилиты
// =============================================

type PaymentUiStatus = 'pending' | 'paid';
type StatusFilter = 'all' | PaymentUiStatus;

interface PaymentStats {
  pendingAmount: number;
  pendingCount: number;
  paidAmount: number;
  paidCount: number;
  totalAmount: number;
  totalCount: number;
}

function formatAmount(amount: number): string {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    minimumFractionDigits: 0,
  }).format(amount);
}

function formatDate(dateString: string | null): string {
  if (!dateString) return '—';
  return new Date(dateString).toLocaleDateString('ru-RU');
}

function toLocalDateKey(dateString: string): string | null {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return null;
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatDateFromKey(dateKey: string | null): string {
  if (!dateKey) return '—';
  return new Date(`${dateKey}T00:00:00`).toLocaleDateString('ru-RU');
}

function resolveLessonDateKey(payment: TutorPaymentWithStudent): string | null {
  if (payment.tutor_lessons?.start_at) {
    const key = toLocalDateKey(payment.tutor_lessons.start_at);
    if (key) return key;
  }

  if (payment.due_date) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(payment.due_date)) {
      return payment.due_date;
    }
    return toLocalDateKey(payment.due_date);
  }

  return null;
}

function getUiStatus(payment: TutorPaymentWithStudent): PaymentUiStatus {
  return payment.status === 'paid' ? 'paid' : 'pending';
}

function getStatusBadge(status: PaymentUiStatus) {
  switch (status) {
    case 'paid':
      return <Badge variant="default" className="bg-green-500">Оплачено</Badge>;
    default:
      return <Badge variant="secondary">Ожидает</Badge>;
  }
}

function getStudentName(payment: TutorPaymentWithStudent): string {
  return payment.tutor_students?.profiles?.username || 'Без имени';
}

function getParentContact(payment: TutorPaymentWithStudent): string | null {
  return payment.tutor_students?.parent_contact || null;
}

// =============================================
// Основной компонент
// =============================================

function TutorPaymentsContent() {
  const {
    payments,
    loading,
    error,
    refetch,
    isFetching: paymentsIsFetching,
    isRecovering: paymentsIsRecovering,
    failureCount: paymentsFailureCount,
  } = useTutorPayments();
  const {
    students,
    error: studentsError,
    refetch: refetchStudents,
    isFetching: studentsIsFetching,
    isRecovering: studentsIsRecovering,
    failureCount: studentsFailureCount,
  } = useTutorStudents();
  
  // Фильтры
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [studentFilter, setStudentFilter] = useState<string>('all');
  const [lessonDateFrom, setLessonDateFrom] = useState('');
  const [lessonDateTo, setLessonDateTo] = useState('');
  
  // Диалог добавления
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  
  // Диалог напоминания
  const [remindDialogOpen, setRemindDialogOpen] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<TutorPaymentWithStudent | null>(null);
  const initialLoading = loading && payments.length === 0 && !error;
  const hasErrors = Boolean(error || studentsError);
  const isPageFetching = paymentsIsFetching || studentsIsFetching;
  const isPageRecovering = paymentsIsRecovering || studentsIsRecovering;
  const pageFailureCount = Math.max(paymentsFailureCount, studentsFailureCount);
  
  // Фильтрация платежей
  const filteredPayments = useMemo(() => {
    return payments.filter(payment => {
      const uiStatus = getUiStatus(payment);
      const lessonDateKey = resolveLessonDateKey(payment);
      
      // Фильтр по статусу
      if (statusFilter !== 'all' && uiStatus !== statusFilter) {
        return false;
      }
      
      // Фильтр по ученику
      if (studentFilter !== 'all' && payment.tutor_student_id !== studentFilter) {
        return false;
      }

      // Фильтр по дате занятия (date-only, inclusive)
      if (lessonDateFrom || lessonDateTo) {
        if (!lessonDateKey) return false;
        if (lessonDateFrom && lessonDateKey < lessonDateFrom) return false;
        if (lessonDateTo && lessonDateKey > lessonDateTo) return false;
      }
      
      return true;
    });
  }, [payments, statusFilter, studentFilter, lessonDateFrom, lessonDateTo]);
  
  // Статистика
  const stats = useMemo<PaymentStats>(() => {
    let pendingAmount = 0;
    let pendingCount = 0;
    let paidAmount = 0;
    let paidCount = 0;
    let totalAmount = 0;
    
    for (const payment of filteredPayments) {
      const uiStatus = getUiStatus(payment);
      totalAmount += payment.amount;
      
      if (uiStatus === 'pending') {
        pendingAmount += payment.amount;
        pendingCount++;
      } else if (uiStatus === 'paid') {
        paidAmount += payment.amount;
        paidCount++;
      }
    }
    
    return {
      pendingAmount,
      pendingCount,
      paidAmount,
      paidCount,
      totalAmount,
      totalCount: filteredPayments.length,
    };
  }, [filteredPayments]);
  
  // Обработчики
  const handleMarkAsPaid = useCallback(async (paymentId: string) => {
    const result = await markPaymentAsPaid(paymentId);
    if (result) {
      toast.success('Оплата отмечена');
      refetch();
    } else {
      toast.error('Ошибка при обновлении');
    }
  }, [refetch]);
  
  const handleDelete = useCallback(async (paymentId: string) => {
    const result = await deleteTutorPayment(paymentId);
    if (result) {
      toast.success('Запись удалена');
      refetch();
    } else {
      toast.error('Ошибка при удалении');
    }
  }, [refetch]);
  
  const handleRemind = useCallback((payment: TutorPaymentWithStudent) => {
    setSelectedPayment(payment);
    setRemindDialogOpen(true);
  }, []);

  const handleRetryAll = useCallback(() => {
    refetch();
    refetchStudents();
  }, [refetch, refetchStudents]);
  
  // Загрузка
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
        <TutorDataStatus
          error={error || studentsError}
          isFetching={isPageFetching}
          isRecovering={isPageRecovering}
          failureCount={pageFailureCount}
          onRetry={handleRetryAll}
        />

        {/* Заголовок */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h1 className="text-2xl font-bold">💳 Оплаты</h1>
          <Button onClick={() => setAddDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Добавить
          </Button>
        </div>
        
        {/* Фильтры */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Статус</Label>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
              <SelectTrigger className="w-[170px]">
                <SelectValue placeholder="Статус" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все статусы</SelectItem>
                <SelectItem value="pending">Ожидает</SelectItem>
                <SelectItem value="paid">Оплачено</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Ученик</Label>
            <Select value={studentFilter} onValueChange={setStudentFilter}>
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder="Ученик" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все ученики</SelectItem>
                {students.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.profiles?.username || 'Без имени'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="lessonDateFrom" className="text-xs text-muted-foreground">
              Дата занятия: с
            </Label>
            <Input
              id="lessonDateFrom"
              type="date"
              value={lessonDateFrom}
              onChange={(e) => setLessonDateFrom(e.target.value)}
              className="w-[170px]"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="lessonDateTo" className="text-xs text-muted-foreground">
              Дата занятия: по
            </Label>
            <Input
              id="lessonDateTo"
              type="date"
              value={lessonDateTo}
              onChange={(e) => setLessonDateTo(e.target.value)}
              className="w-[170px]"
            />
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Ожидается к получению
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{formatAmount(stats.pendingAmount)}</p>
              <p className="text-sm text-muted-foreground">{stats.pendingCount} записей</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Получено
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-green-600">{formatAmount(stats.paidAmount)}</p>
              <p className="text-sm text-muted-foreground">{stats.paidCount} оплат</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Всего
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{formatAmount(stats.totalAmount)}</p>
              <p className="text-sm text-muted-foreground">{stats.totalCount} записей</p>
            </CardContent>
          </Card>
        </div>
        
        {/* Таблица */}
        <Card>
          <div className="overflow-x-auto">
            <Table className="min-w-[900px] [&_th]:whitespace-nowrap [&_td]:whitespace-nowrap">
              <TableHeader>
                <TableRow>
                  <TableHead>Ученик</TableHead>
                  <TableHead className="text-right">Сумма</TableHead>
                  <TableHead>Период</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead>Дата занятия</TableHead>
                  <TableHead>Оплачено</TableHead>
                  <TableHead className="text-right">Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredPayments.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      {hasErrors
                        ? 'Не удалось обновить данные об оплатах. Выполняется восстановление...'
                        : payments.length === 0
                          ? 'Нет записей об оплатах'
                          : 'Ничего не найдено'}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredPayments.map(payment => {
                    const uiStatus = getUiStatus(payment);
                    const parentContact = getParentContact(payment);
                    const lessonDateKey = resolveLessonDateKey(payment);
                    
                    return (
                      <TableRow key={payment.id}>
                        <TableCell className="font-medium">
                          {getStudentName(payment)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {formatAmount(payment.amount)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {payment.period || '—'}
                        </TableCell>
                        <TableCell>
                          {getStatusBadge(uiStatus)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDateFromKey(lessonDateKey)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDate(payment.paid_at)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            {uiStatus !== 'paid' && (
                              <Button
                                variant="ghost"
                                size="icon"
                                title="Отметить оплачено"
                                onClick={() => handleMarkAsPaid(payment.id)}
                              >
                                <Check className="h-4 w-4 text-green-600" />
                              </Button>
                            )}
                            
                            {uiStatus !== 'paid' && parentContact && (
                              <Button
                                variant="ghost"
                                size="icon"
                                title="Напомнить"
                                onClick={() => handleRemind(payment)}
                              >
                                <Bell className="h-4 w-4" />
                              </Button>
                            )}
                            
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Удалить"
                              onClick={() => handleDelete(payment.id)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
        
        {/* Диалог добавления */}
        <AddPaymentDialog
          open={addDialogOpen}
          onOpenChange={setAddDialogOpen}
          students={students}
          onSuccess={() => {
            refetch();
            toast.success('Запись добавлена');
          }}
        />
        
        {/* Диалог напоминания */}
        <RemindDialog
          open={remindDialogOpen}
          onOpenChange={setRemindDialogOpen}
          payment={selectedPayment}
        />
      </div>
  );
}

// =============================================
// Диалог добавления оплаты
// =============================================

interface AddPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  students: { id: string; hourly_rate_cents?: number | null; profiles?: { username: string } | null }[];
  onSuccess: () => void;
}

function AddPaymentDialog({ open, onOpenChange, students, onSuccess }: AddPaymentDialogProps) {
  const [studentId, setStudentId] = useState('');
  const [amount, setAmount] = useState('');
  const [period, setPeriod] = useState('');
  const [lessonDate, setLessonDate] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  
  const selectedStudent = useMemo(() => students.find(s => s.id === studentId), [students, studentId]);
  const hourlyRate = selectedStudent?.hourly_rate_cents ? selectedStudent.hourly_rate_cents / 100 : null;

  const handleQuickAmount = (hours: number) => {
    if (hourlyRate) {
      setAmount((hourlyRate * hours).toString());
    }
  };
  
  const handleSubmit = async () => {
    if (!studentId || !amount) {
      toast.error('Выберите ученика и укажите сумму');
      return;
    }
    
    setIsSaving(true);
    try {
      const result = await createTutorPayment({
        tutor_student_id: studentId,
        amount: parseInt(amount, 10),
        period: period || undefined,
        due_date: lessonDate || undefined,
      });
      
      if (result) {
        onSuccess();
        onOpenChange(false);
        // Reset form
        setStudentId('');
        setAmount('');
        setPeriod('');
        setLessonDate('');
      } else {
        toast.error('Ошибка при сохранении');
      }
    } finally {
      setIsSaving(false);
    }
  };
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Добавить запись об оплате</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Ученик *</Label>
            <Select value={studentId} onValueChange={setStudentId}>
              <SelectTrigger>
                <SelectValue placeholder="Выберите ученика" />
              </SelectTrigger>
              <SelectContent>
                {students.map(s => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.profiles?.username || 'Без имени'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="amount">Сумма (₽) *</Label>
            <Input
              id="amount"
              type="number"
              min="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="например, 5000"
            />
            {hourlyRate && (
              <div className="mt-2 flex flex-col gap-1.5">
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <span>💰 Ставка: <strong>{hourlyRate} ₽/ч</strong></span>
                </span>
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="outline" className="cursor-pointer hover:bg-muted font-normal text-xs py-0.5" onClick={() => handleQuickAmount(1)}>1 ч</Badge>
                  <Badge variant="outline" className="cursor-pointer hover:bg-muted font-normal text-xs py-0.5" onClick={() => handleQuickAmount(1.5)}>1.5 ч</Badge>
                  <Badge variant="outline" className="cursor-pointer hover:bg-muted font-normal text-xs py-0.5" onClick={() => handleQuickAmount(2)}>2 ч</Badge>
                  <Badge variant="outline" className="cursor-pointer hover:bg-muted font-normal text-xs py-0.5" onClick={() => handleQuickAmount(4)}>4 ч</Badge>
                  <Badge variant="outline" className="cursor-pointer hover:bg-muted font-normal text-xs py-0.5" onClick={() => handleQuickAmount(8)}>8 ч</Badge>
                </div>
              </div>
            )}
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="period">Период (опц.)</Label>
            <Input
              id="period"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              placeholder="например, Февраль 2026 или 8 уроков"
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="lessonDate">Дата занятия (опц.)</Label>
            <Input
              id="lessonDate"
              type="date"
              value={lessonDate}
              onChange={(e) => setLessonDate(e.target.value)}
            />
          </div>
        </div>
        
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button onClick={handleSubmit} disabled={isSaving}>
            {isSaving ? 'Сохранение...' : 'Добавить'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// =============================================
// Диалог напоминания
// =============================================

interface RemindDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payment: TutorPaymentWithStudent | null;
}

function RemindDialog({ open, onOpenChange, payment }: RemindDialogProps) {
  if (!payment) return null;
  
  const studentName = getStudentName(payment);
  const parentContact = getParentContact(payment);
  const isTelegramUsername = parentContact?.startsWith('@');
  const lessonDateKey = resolveLessonDateKey(payment);
  
  const reminderText = `Здравствуйте! Напоминаю об оплате занятий для ${studentName}.\n\nСумма: ${formatAmount(payment.amount)}${payment.period ? `\nПериод: ${payment.period}` : ''}${lessonDateKey ? `\nДата занятия: ${formatDateFromKey(lessonDateKey)}` : ''}\n\nСпасибо!`;
  
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
      const username = parentContact.slice(1); // Remove @
      window.open(`https://t.me/${username}`, '_blank');
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
            <div className="bg-muted p-3 rounded-md text-sm whitespace-pre-wrap">
              {reminderText}
            </div>
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
