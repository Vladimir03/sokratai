import { useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { 
  Users, 
  CreditCard, 
  AlertTriangle, 
  UserPlus, 
  Plus, 
  ChevronRight,
  Clock
} from 'lucide-react';
import TutorGuard from '@/components/TutorGuard';
import { TutorLayout } from '@/components/tutor/TutorLayout';
import { AddStudentDialog } from '@/components/tutor/AddStudentDialog';
import { useTutor, useTutorStudents, useTutorPayments } from '@/hooks/useTutor';
import { getTutorInviteWebLink, getTutorInviteTelegramLink } from '@/utils/telegramLinks';
import type { TutorStudentWithProfile, TutorPaymentWithStudent } from '@/types/tutor';

// =============================================
// Утилиты
// =============================================

function formatAmount(amount: number): string {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    minimumFractionDigits: 0,
  }).format(amount);
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('ru-RU', { 
    weekday: 'long', 
    day: 'numeric', 
    month: 'long' 
  });
}

function getEffectiveStatus(payment: TutorPaymentWithStudent): 'paid' | 'pending' | 'overdue' {
  if (payment.status === 'paid') return 'paid';
  if (payment.due_date && new Date(payment.due_date) < new Date()) {
    return 'overdue';
  }
  return 'pending';
}

function getStudentName(payment: TutorPaymentWithStudent): string {
  return payment.tutor_students?.profiles?.username || 'Без имени';
}

// =============================================
// Компоненты карточек статистики
// =============================================

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle: string;
  icon: React.ReactNode;
  href: string;
  variant?: 'default' | 'success' | 'warning' | 'danger';
}

function StatCard({ title, value, subtitle, icon, href, variant = 'default' }: StatCardProps) {
  const navigate = useNavigate();
  
  const variantClasses = {
    default: '',
    success: 'border-green-500/30',
    warning: 'border-yellow-500/30',
    danger: 'border-destructive/30',
  };
  
  const valueClasses = {
    default: '',
    success: 'text-green-600',
    warning: 'text-yellow-600',
    danger: 'text-destructive',
  };
  
  return (
    <Card 
      className={`cursor-pointer transition-all hover:shadow-md ${variantClasses[variant]}`}
      onClick={() => navigate(href)}
    >
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <div className="text-muted-foreground">{icon}</div>
      </CardHeader>
      <CardContent>
        <p className={`text-2xl font-bold ${valueClasses[variant]}`}>{value}</p>
        <div className="flex items-center justify-between mt-1">
          <p className="text-sm text-muted-foreground">{subtitle}</p>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </div>
      </CardContent>
    </Card>
  );
}

// =============================================
// Компонент списка "Требуют внимания"
// =============================================

interface AttentionItem {
  id: string;
  name: string;
  reason: string;
  type: 'overdue' | 'inactive';
  link: string;
}

interface AttentionListProps {
  items: AttentionItem[];
}

function AttentionList({ items }: AttentionListProps) {
  const navigate = useNavigate();
  
  if (items.length === 0) return null;
  
  return (
    <Card className="border-yellow-500/30 bg-yellow-500/5">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-yellow-600" />
          Требуют внимания
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {items.slice(0, 5).map(item => (
            <div 
              key={`${item.type}-${item.id}`}
              className="flex items-center justify-between p-2 rounded-md hover:bg-muted/50 cursor-pointer transition-colors"
              onClick={() => navigate(item.link)}
            >
              <div className="flex items-center gap-3">
                <Badge variant={item.type === 'overdue' ? 'destructive' : 'secondary'} className="text-xs">
                  {item.type === 'overdue' ? 'Просрочено' : 'Неактивен'}
                </Badge>
                <span className="text-sm font-medium">{item.name}</span>
              </div>
              <span className="text-xs text-muted-foreground">{item.reason}</span>
            </div>
          ))}
          {items.length > 5 && (
            <p className="text-xs text-muted-foreground text-center pt-2">
              И ещё {items.length - 5}...
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// =============================================
// Скелетон загрузки
// =============================================

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-16 w-2/3" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
      <div className="flex gap-3">
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-10 w-40" />
      </div>
    </div>
  );
}

// =============================================
// Основной компонент дашборда
// =============================================

function TutorDashboardContent() {
  const navigate = useNavigate();
  const { tutor, loading: tutorLoading } = useTutor();
  const { students, loading: studentsLoading } = useTutorStudents();
  const { payments, loading: paymentsLoading } = useTutorPayments();
  
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const loading = tutorLoading || studentsLoading || paymentsLoading;
  
  // Invite URLs
  const inviteCode = tutor?.invite_code;
  const inviteWebLink = inviteCode ? getTutorInviteWebLink(inviteCode) : '';
  const inviteTelegramLink = inviteCode ? getTutorInviteTelegramLink(inviteCode) : '';
  
  // Статистика учеников
  const studentStats = useMemo(() => {
    const activeStudents = students.filter(s => s.status === 'active');
    return {
      active: activeStudents.length,
      total: students.length,
    };
  }, [students]);
  
  // Статистика оплат
  const paymentStats = useMemo(() => {
    let pendingAmount = 0;
    let pendingCount = 0;
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
      }
    }
    
    return { pendingAmount, pendingCount, overdueAmount, overdueCount };
  }, [payments]);
  
  // Элементы "Требуют внимания"
  const attentionItems = useMemo<AttentionItem[]>(() => {
    const items: AttentionItem[] = [];
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    // Просроченные оплаты
    for (const payment of payments) {
      if (getEffectiveStatus(payment) === 'overdue') {
        items.push({
          id: payment.id,
          name: getStudentName(payment),
          reason: formatAmount(payment.amount),
          type: 'overdue',
          link: '/tutor/payments',
        });
      }
    }
    
    // Неактивные ученики (>7 дней без активности)
    for (const student of students) {
      if (student.status !== 'active') continue;
      
      const lastActivity = student.last_activity_at 
        ? new Date(student.last_activity_at) 
        : null;
      
      if (!lastActivity || lastActivity < sevenDaysAgo) {
        const daysAgo = lastActivity 
          ? Math.floor((now.getTime() - lastActivity.getTime()) / (1000 * 60 * 60 * 24))
          : null;
        
        items.push({
          id: student.id,
          name: student.profiles?.username || 'Без имени',
          reason: daysAgo ? `${daysAgo} дн. без активности` : 'Нет активности',
          type: 'inactive',
          link: `/tutor/students/${student.id}`,
        });
      }
    }
    
    return items;
  }, [students, payments]);
  
  if (loading) {
    return (
      <TutorLayout>
        <DashboardSkeleton />
      </TutorLayout>
    );
  }
  
  return (
    <TutorLayout>
      <div className="space-y-6">
        {/* Приветствие */}
        <div className="space-y-1">
          <h1 className="text-2xl font-bold">
            👋 Добро пожаловать{tutor?.name ? `, ${tutor.name}` : ''}!
          </h1>
          <p className="text-muted-foreground capitalize">
            {formatDate(new Date())}
          </p>
          {tutor?.telegram_username && (
            <p className="text-sm text-muted-foreground flex items-center gap-1">
              <span className="text-blue-500">Telegram:</span> @{tutor.telegram_username}
            </p>
          )}
        </div>
        
        {/* Сводные карточки */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard
            title="Ученики"
            value={studentStats.active}
            subtitle={`${studentStats.total > studentStats.active ? `всего ${studentStats.total}` : 'активных'}`}
            icon={<Users className="h-5 w-5" />}
            href="/tutor/students"
          />
          
          <StatCard
            title="Ожидается к оплате"
            value={formatAmount(paymentStats.pendingAmount)}
            subtitle={`${paymentStats.pendingCount} записей`}
            icon={<Clock className="h-5 w-5" />}
            href="/tutor/payments"
            variant={paymentStats.pendingCount > 0 ? 'warning' : 'default'}
          />
          
          <StatCard
            title="Просрочено"
            value={formatAmount(paymentStats.overdueAmount)}
            subtitle={`${paymentStats.overdueCount} записей`}
            icon={<CreditCard className="h-5 w-5" />}
            href="/tutor/payments"
            variant={paymentStats.overdueCount > 0 ? 'danger' : 'success'}
          />
        </div>
        
        {/* Быстрые действия */}
        <div className="flex flex-wrap gap-3">
          <Button onClick={() => setInviteModalOpen(true)}>
            <UserPlus className="h-4 w-4 mr-2" />
            Добавить ученика
          </Button>
          
          <Button variant="outline" onClick={() => navigate('/tutor/payments')}>
            <Plus className="h-4 w-4 mr-2" />
            Добавить оплату
          </Button>
          
          <Button variant="ghost" asChild>
            <Link to="/tutor/students">
              Все ученики
              <ChevronRight className="h-4 w-4 ml-1" />
            </Link>
          </Button>
        </div>
        
        {/* Требуют внимания */}
        <AttentionList items={attentionItems} />
        
        {/* Подсказка для новых репетиторов */}
        {students.length === 0 && (
          <Card className="bg-muted/30">
            <CardContent className="pt-6">
              <div className="text-center space-y-4">
                <div className="text-4xl">🎓</div>
                <div>
                  <h3 className="font-medium mb-1">Начните работу с Сократом</h3>
                  <p className="text-sm text-muted-foreground max-w-md mx-auto">
                    Пригласите первого ученика по ссылке. Он получит доступ к AI-помощнику, 
                    а вы сможете отслеживать его прогресс и диалоги с ботом.
                  </p>
                </div>
                <Button onClick={() => setInviteModalOpen(true)}>
                  <UserPlus className="h-4 w-4 mr-2" />
                  Пригласить ученика
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
        
        <AddStudentDialog
          open={inviteModalOpen}
          onOpenChange={setInviteModalOpen}
          inviteCode={inviteCode}
          inviteWebLink={inviteWebLink}
          inviteTelegramLink={inviteTelegramLink}
          onManualAdded={(tutorStudentId) => {
            navigate(`/tutor/students/${tutorStudentId}`);
          }}
        />
      </div>
    </TutorLayout>
  );
}

// =============================================
// Экспорт с гуардом
// =============================================

export default function TutorDashboard() {
  return (
    <TutorGuard>
      <TutorDashboardContent />
    </TutorGuard>
  );
}
