import { ReactNode, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  Users,
  CreditCard,
  CalendarDays,
  BookOpen,
  Library,
  LogOut,
  Bot,
  ChevronDown,
  MoreHorizontal,
} from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { useHWTaskCount } from '@/stores/hwDraftStore';

interface TutorLayoutProps {
  children: ReactNode;
}

// Desktop: 5 primary items visible in top bar
const desktopPrimaryItems = [
  { href: '/tutor/dashboard', label: 'Главная', icon: LayoutDashboard },
  { href: '/tutor/schedule', label: 'Расписание', icon: CalendarDays },
  { href: '/tutor/students', label: 'Ученики', icon: Users },
  { href: '/tutor/homework', label: 'Домашки', icon: BookOpen },
  { href: '/tutor/assistant', label: 'Помощник', icon: Bot },
];

// Desktop: items inside "Ещё ▾" dropdown
const desktopMoreItems = [
  { href: '/tutor/knowledge', label: 'База знаний', icon: Library },
  { href: '/tutor/payments', label: 'Оплаты', icon: CreditCard },
];

// Mobile: 4 primary items in bottom bar (Ученики moves to overflow)
const mobilePrimaryItems = [
  { href: '/tutor/dashboard', label: 'Главная', icon: LayoutDashboard },
  { href: '/tutor/schedule', label: 'Расписание', icon: CalendarDays },
  { href: '/tutor/homework', label: 'Домашки', icon: BookOpen },
  { href: '/tutor/assistant', label: 'Помощник', icon: Bot },
];

// Mobile: items inside "Ещё" sheet
const mobileMoreItems = [
  { href: '/tutor/students', label: 'Ученики', icon: Users },
  { href: '/tutor/knowledge', label: 'База знаний', icon: Library },
  { href: '/tutor/payments', label: 'Оплаты', icon: CreditCard },
];

export function TutorLayout({ children }: TutorLayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const hwTaskCount = useHWTaskCount();
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);

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
      warmup('TutorHomeworkDetail', () => import('@/pages/tutor/TutorHomeworkDetail'));
      warmup('KnowledgeBasePage', () => import('@/pages/tutor/knowledge/KnowledgeBasePage'));
      warmup('TutorAssistant', () => import('@/pages/tutor/TutorAssistant'));
    }, 300);

    return () => window.clearTimeout(timer);
  }, []);

  const handleLogout = async () => {
    // Always navigate to login, even if signOut fails (e.g. session already expired)
    await supabase.auth.signOut();
    toast.success('Вы вышли из системы');
    navigate('/login');
  };

  const isActive = (href: string) =>
    location.pathname === href || location.pathname.startsWith(href + '/');

  const isDesktopMoreActive = desktopMoreItems.some(item => isActive(item.href));
  const isMobileMoreActive = mobileMoreItems.some(item => isActive(item.href));

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
            {desktopPrimaryItems.map(item => {
              const active = isActive(item.href);
              const showHWBadge = item.href === '/tutor/homework' && hwTaskCount > 0;
              return (
                <Link key={item.href} to={item.href}>
                  <Button
                    variant={active ? 'secondary' : 'ghost'}
                    size="sm"
                    className="relative gap-2"
                  >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                    {showHWBadge ? (
                      <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-socrat-primary px-1.5 text-[10px] font-bold text-white">
                        {hwTaskCount}
                      </span>
                    ) : null}
                  </Button>
                </Link>
              );
            })}

            {/* "Ещё" dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant={isDesktopMoreActive ? 'secondary' : 'ghost'}
                  size="sm"
                  className="gap-1"
                >
                  Ещё
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {desktopMoreItems.map(item => (
                  <DropdownMenuItem key={item.href} asChild>
                    <Link to={item.href} className="flex items-center gap-2">
                      <item.icon className="h-4 w-4" />
                      {item.label}
                    </Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
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
          {mobilePrimaryItems.map(item => {
            const active = isActive(item.href);
            const showHWBadge = item.href === '/tutor/homework' && hwTaskCount > 0;
            return (
              <Link
                key={item.href}
                to={item.href}
                className={cn(
                  "relative flex flex-col items-center gap-1 px-3 py-2 text-xs",
                  active ? "text-primary" : "text-muted-foreground"
                )}
              >
                <item.icon className="h-5 w-5" />
                {item.label}
                {showHWBadge ? (
                  <span className="absolute -top-0.5 right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-socrat-primary px-1 text-[9px] font-bold text-white">
                    {hwTaskCount}
                  </span>
                ) : null}
              </Link>
            );
          })}

          {/* "Ещё" bottom sheet trigger */}
          <Sheet open={mobileMoreOpen} onOpenChange={setMobileMoreOpen}>
            <SheetTrigger asChild>
              <button
                className={cn(
                  "relative flex flex-col items-center gap-1 px-3 py-2 text-xs",
                  isMobileMoreActive ? "text-primary" : "text-muted-foreground"
                )}
              >
                <MoreHorizontal className="h-5 w-5" />
                Ещё
              </button>
            </SheetTrigger>
            <SheetContent side="bottom" className="h-auto">
              <nav className="grid gap-1 py-4">
                {mobileMoreItems.map(item => {
                  const active = isActive(item.href);
                  return (
                    <Link
                      key={item.href}
                      to={item.href}
                      onClick={() => setMobileMoreOpen(false)}
                      className={cn(
                        "flex items-center gap-3 px-4 py-3 rounded-lg transition-colors",
                        active
                          ? "bg-secondary text-primary"
                          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                      )}
                    >
                      <item.icon className="h-5 w-5" />
                      <span className="text-sm font-medium">{item.label}</span>
                    </Link>
                  );
                })}
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </nav>

      {/* Main content */}
      <main className="container px-4 py-6 pb-20 md:pb-6">
        {children}
      </main>
    </div>
  );
}
