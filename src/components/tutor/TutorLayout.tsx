import { ReactNode, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { LayoutDashboard, Users, CreditCard, CalendarDays, BookOpen, LogOut } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';

interface TutorLayoutProps {
  children: ReactNode;
}

const navItems = [
  { href: '/tutor/dashboard', label: 'Дашборд', icon: LayoutDashboard },
  { href: '/tutor/schedule', label: 'Расписание', icon: CalendarDays },
  { href: '/tutor/students', label: 'Ученики', icon: Users },
  { href: '/tutor/homework', label: 'Домашки', icon: BookOpen },
  { href: '/tutor/payments', label: 'Оплаты', icon: CreditCard },
];

export function TutorLayout({ children }: TutorLayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    // Warm up lazy tutor route chunks to make tab switches instant.
    const timer = window.setTimeout(() => {
      const warmup = (chunkName: string, loader: () => Promise<unknown>) => {
        void loader().catch((error) => {
          console.warn('tutor_chunk_warmup_failed', {
            chunkName,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      };

      warmup('TutorDashboard', () => import('@/pages/tutor/TutorDashboard'));
      warmup('TutorSchedule', () => import('@/pages/tutor/TutorSchedule'));
      warmup('TutorStudents', () => import('@/pages/tutor/TutorStudents'));
      warmup('TutorStudentProfile', () => import('@/pages/tutor/TutorStudentProfile'));
      warmup('TutorPayments', () => import('@/pages/tutor/TutorPayments'));
      warmup('TutorHomework', () => import('@/pages/tutor/TutorHomework'));
      warmup('TutorHomeworkCreate', () => import('@/pages/tutor/TutorHomeworkCreate'));
      warmup('TutorHomeworkResults', () => import('@/pages/tutor/TutorHomeworkResults'));
    }, 300);

    return () => window.clearTimeout(timer);
  }, []);

  const handleLogout = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast.error('Ошибка при выходе');
    } else {
      toast.success('Вы вышли из системы');
      navigate('/login');
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 items-center justify-between px-4">
          {/* Logo */}
          <Link to="/tutor/dashboard" className="flex items-center gap-2 font-semibold">
            <span className="text-xl">📚</span>
            <span>Сократ для репетиторов</span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-1">
            {navItems.map(item => {
              const isActive = location.pathname === item.href || location.pathname.startsWith(item.href + '/');
              return (
                <Link key={item.href} to={item.href}>
                  <Button
                    variant={isActive ? 'secondary' : 'ghost'}
                    size="sm"
                    className="gap-2"
                  >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </Button>
                </Link>
              );
            })}
          </nav>

          {/* Logout */}
          <Button variant="ghost" size="sm" onClick={handleLogout}>
            <LogOut className="h-4 w-4 mr-2" />
            <span className="hidden sm:inline">Выйти</span>
          </Button>
        </div>
      </header>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t bg-background">
        <div className="flex justify-around py-2">
          {navItems.map(item => {
            const isActive = location.pathname === item.href || location.pathname.startsWith(item.href + '/');
            return (
              <Link 
                key={item.href} 
                to={item.href}
                className={cn(
                  "flex flex-col items-center gap-1 px-3 py-2 text-xs",
                  isActive
                    ? "text-primary" 
                    : "text-muted-foreground"
                )}
              >
                <item.icon className="h-5 w-5" />
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Main content */}
      <main className="container px-4 py-6 pb-20 md:pb-6">
        {children}
      </main>
    </div>
  );
}
