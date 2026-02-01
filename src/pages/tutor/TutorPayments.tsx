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
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import TutorGuard from '@/components/TutorGuard';
import { TutorLayout } from '@/components/tutor/TutorLayout';
import { useTutorPayments, useTutorStudents } from '@/hooks/useTutor';
import { 
  createTutorPayment, 
  markPaymentAsPaid, 
  deleteTutorPayment 
} from '@/lib/tutors';
import type { TutorPaymentWithStudent, PaymentStatus } from '@/types/tutor';

// =============================================
// Типы и утилиты
// =============================================

type StatusFilter = 'all' | PaymentStatus;

interface PaymentStats {
  pendingAmount: number;
  pendingCount: number;
  paidThisMonth: number;
  paidThisMonthCount: number;
  overdueAmount: number;
  overdueCount: number;
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

function getEffectiveStatus(payment: TutorPaymentWithStudent): PaymentStatus {
  if (payment.status === 'paid') return 'paid';
  if (payment.due_date && new Date(payment.due_date) < new Date()) {
    return 'overdue';
  }
  return 'pending';
}

function getStatusBadge(status: PaymentStatus) {
  switch (status) {
    case 'paid':
      return <Badge variant="default" className="bg-green-500">Оплачено</Badge>;
    case 'overdue':
      return <Badge variant="destructive">Просрочено</Badge>;
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
  const { payments, loading, error, refetch } = useTutorPayments();
  const { students } = useTutorStudents();
  
  // Фильтры
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [studentFilter, setStudentFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Диалог добавления
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  
  // Диалог напоминания
  const [remindDialogOpen, setRemindDialogOpen] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<TutorPaymentWithStudent | null>(null);
  
  // Фильтрация платежей с учётом effective status
  const filteredPayments = useMemo(() => {
    return payments.filter(payment => {
      const effectiveStatus = getEffectiveStatus(payment);
      
      // Фильтр по статусу
      if (statusFilter !== 'all' && effectiveStatus !== statusFilter) {
        return false;
      }
      
      // Фильтр по ученику
      if (studentFilter !== 'all' && payment.tutor_student_id !== studentFilter) {
        return false;
      }
      
      // Поиск по имени
      if (searchQuery) {
        const name = getStudentName(payment).toLowerCase();
        if (!name.includes(searchQuery.toLowerCase())) {
          return false;
        }
      }
      
      return true;
    });
  }, [payments, statusFilter, studentFilter, searchQuery]);
  
  // Статистика
  const stats = useMemo<PaymentStats>(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    
    let pendingAmount = 0;
    let pendingCount = 0;
    let paidThisMonth = 0;
    let paidThisMonthCount = 0;
    let overdueAmount = 0;
    let overdueCount = 0;
    
    for (const payment of payments) {
      const effectiveStatus = getEffectiveStatus(payment);
      
      if (effectiveStatus === 'pending') {
        pendingAmount += payment.amount;
        pendingCount++;
      } else if (effectiveStatus === 'overdue') {
        overdueAmount += payment.amount;
        overdueCount++;
      } else if (effectiveStatus === 'paid' && payment.paid_at) {
        const paidDate = new Date(payment.paid_at);
        if (paidDate >= monthStart) {
          paidThisMonth += payment.amount;
          paidThisMonthCount++;
        }
      }
    }
    
    return { pendingAmount, pendingCount, paidThisMonth, paidThisMonthCount, overdueAmount, overdueCount };
  }, [payments]);
  
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
  
  // Загрузка
  if (loading) {
    return (
      <TutorLayout>
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
          <Skeleton className="h-64" />
        </div>
      </TutorLayout>
    );
  }
  
  // Ошибка
  if (error) {
    return (
      <TutorLayout>
        <div className="flex flex-col items-center justify-center py-12">
          <p className="text-muted-foreground mb-4">{error}</p>
          <Button onClick={refetch}>Повторить</Button>
        </div>
      </TutorLayout>
    );
  }
  
  return (
    <TutorLayout>
      <div className="space-y-6">
        {/* Заголовок */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h1 className="text-2xl font-bold">💳 Оплаты</h1>
          <Button onClick={() => setAddDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Добавить
          </Button>
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
                Получено в этом месяце
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-green-600">{formatAmount(stats.paidThisMonth)}</p>
              <p className="text-sm text-muted-foreground">{stats.paidThisMonthCount} оплат</p>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Просрочено
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-destructive">{formatAmount(stats.overdueAmount)}</p>
              <p className="text-sm text-muted-foreground">{stats.overdueCount} записей</p>
            </CardContent>
          </Card>
        </div>
        
        {/* Фильтры */}
        <div className="flex flex-wrap gap-3">
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Статус" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все статусы</SelectItem>
              <SelectItem value="pending">Ожидает</SelectItem>
              <SelectItem value="paid">Оплачено</SelectItem>
              <SelectItem value="overdue">Просрочено</SelectItem>
            </SelectContent>
          </Select>
          
          <Select value={studentFilter} onValueChange={setStudentFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Ученик" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все ученики</SelectItem>
              {students.map(s => (
                <SelectItem key={s.id} value={s.id}>
                  {s.profiles?.username || 'Без имени'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          
          <Input
            placeholder="Поиск по имени..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-[200px]"
          />
        </div>
        
        {/* Таблица */}
        <Card>
          <ScrollArea className="h-[400px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ученик</TableHead>
                  <TableHead className="text-right">Сумма</TableHead>
                  <TableHead>Период</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead>Срок</TableHead>
                  <TableHead>Оплачено</TableHead>
                  <TableHead className="text-right">Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredPayments.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      {payments.length === 0 ? 'Нет записей об оплатах' : 'Ничего не найдено'}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredPayments.map(payment => {
                    const effectiveStatus = getEffectiveStatus(payment);
                    const parentContact = getParentContact(payment);
                    
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
                          {getStatusBadge(effectiveStatus)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDate(payment.due_date)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDate(payment.paid_at)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            {effectiveStatus !== 'paid' && (
                              <Button
                                variant="ghost"
                                size="icon"
                                title="Отметить оплачено"
                                onClick={() => handleMarkAsPaid(payment.id)}
                              >
                                <Check className="h-4 w-4 text-green-600" />
                              </Button>
                            )}
                            
                            {effectiveStatus !== 'paid' && parentContact && (
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
          </ScrollArea>
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
    </TutorLayout>
  );
}

// =============================================
// Диалог добавления оплаты
// =============================================

interface AddPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  students: { id: string; profiles?: { username: string } | null }[];
  onSuccess: () => void;
}

function AddPaymentDialog({ open, onOpenChange, students, onSuccess }: AddPaymentDialogProps) {
  const [studentId, setStudentId] = useState('');
  const [amount, setAmount] = useState('');
  const [period, setPeriod] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  
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
        due_date: dueDate || undefined,
      });
      
      if (result) {
        onSuccess();
        onOpenChange(false);
        // Reset form
        setStudentId('');
        setAmount('');
        setPeriod('');
        setDueDate('');
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
            <Label htmlFor="dueDate">Срок оплаты (опц.)</Label>
            <Input
              id="dueDate"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
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
  
  const reminderText = `Здравствуйте! Напоминаю об оплате занятий для ${studentName}.\n\nСумма: ${formatAmount(payment.amount)}${payment.period ? `\nПериод: ${payment.period}` : ''}${payment.due_date ? `\nСрок: ${formatDate(payment.due_date)}` : ''}\n\nСпасибо!`;
  
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
// Экспорт с защитой
// =============================================

export default function TutorPayments() {
  return (
    <TutorGuard>
      <TutorPaymentsContent />
    </TutorGuard>
  );
}
