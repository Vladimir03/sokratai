import { memo, useCallback } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  CalendarDays,
  BookOpen,
  Users,
  Library,
  Bot,
  CreditCard,
  LogOut,
  LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import sokratLogo from '@/assets/sokrat-logo.png';
import { supabase } from '@/lib/supabaseClient';
import {
  useTutorChromeCounters,
  type TutorChromeCounters,
} from '@/hooks/useTutorChromeCounters';

type CounterKey = keyof TutorChromeCounters;

interface NavItemDef {
  href: string;
  icon: LucideIcon;
  label: string;
  counter?: CounterKey;
}

interface NavGroupDef {
  label: string;
  items: NavItemDef[];
}

const NAV_GROUPS: readonly NavGroupDef[] = [
  {
    label: 'Работа',
    items: [
      { href: '/tutor/home', icon: LayoutDashboard, label: 'Главная' },
      { href: '/tutor/schedule', icon: CalendarDays, label: 'Расписание' },
      {
        href: '/tutor/homework',
        icon: BookOpen,
        label: 'Домашние задания',
        counter: 'activeHomework',
      },
    ],
  },
  {
    label: 'Ученики',
    items: [
      {
        href: '/tutor/students',
        icon: Users,
        label: 'Все ученики',
        counter: 'activeStudents',
      },
    ],
  },
  {
    label: 'Материалы',
    items: [
      { href: '/tutor/knowledge', icon: Library, label: 'База знаний' },
      { href: '/tutor/assistant', icon: Bot, label: 'Помощник' },
    ],
  },
  {
    label: 'Финансы',
    items: [{ href: '/tutor/payments', icon: CreditCard, label: 'Оплаты' }],
  },
];

// Hover/focus prefetch map (TASK-4 §5). Replaces the old TutorLayout
// setTimeout(300) warmup that fired for every tutor session on mount.
// Now chunks are fetched lazily when a user intends to navigate (hover or
// keyboard focus). Dynamic `import()` is idempotent — the second call for the
// same chunk is a no-op, so repeat hovers don't re-download.
const PREFETCH_MAP: Record<string, () => Promise<unknown>> = {
  '/tutor/home': () => import('@/pages/tutor/TutorHome'),
  '/tutor/schedule': () => import('@/pages/tutor/TutorSchedule'),
  '/tutor/homework': () => import('@/pages/tutor/TutorHomework'),
  '/tutor/students': () => import('@/pages/tutor/TutorStudents'),
  '/tutor/knowledge': () => import('@/pages/tutor/knowledge/KnowledgeBasePage'),
  '/tutor/assistant': () => import('@/pages/tutor/TutorAssistant'),
  '/tutor/payments': () => import('@/pages/tutor/TutorPayments'),
};

function formatCounter(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return String(value);
}

function formatCounterTooltip(
  counterKey: CounterKey | undefined,
  counters: TutorChromeCounters,
): string | undefined {
  if (!counterKey) return undefined;
  if (counterKey === 'activeHomework') {
    const { activeHomework, totalHomework } = counters;
    if (activeHomework === null || totalHomework === null) return undefined;
    return `${activeHomework} активных ДЗ из ${totalHomework} всего`;
  }
  if (counterKey === 'activeStudents') {
    const { activeStudents, totalStudents } = counters;
    if (activeStudents === null || totalStudents === null) return undefined;
    return `${activeStudents} активных учеников из ${totalStudents}`;
  }
  return undefined;
}

interface NavItemProps {
  item: NavItemDef;
  isActive: boolean;
  counterValue: number | null | undefined;
  tooltip: string | undefined;
  onNavigate?: () => void;
}

const NavItem = memo(function NavItem({
  item,
  isActive,
  counterValue,
  tooltip,
  onNavigate,
}: NavItemProps) {
  const Icon = item.icon;
  // AC-11: Enter/Space activate link. Native <a> reacts to Enter only; Space
  // scrolls by default. We intercept Space, prevent scroll, and synthesize a
  // click so keyboard users get both activation paths per spec.
  const handleKeyDown = (event: React.KeyboardEvent<HTMLAnchorElement>) => {
    if (event.key === ' ') {
      event.preventDefault();
      event.currentTarget.click();
    }
  };
  // Hover/focus prefetch (TASK-4 §5). Swallow errors — warmup is best-effort
  // and must not surface to the user or block initial paint.
  const handlePrefetch = () => {
    const loader = PREFETCH_MAP[item.href];
    if (!loader) return;
    void loader().catch((err) => {
      console.warn('tutor_nav_prefetch_failed', {
        href: item.href,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  };
  return (
    <Link
      to={item.href}
      className={`t-nav__item${isActive ? ' t-nav__item--active' : ''}`}
      aria-current={isActive ? 'page' : undefined}
      title={tooltip}
      onClick={onNavigate}
      onKeyDown={handleKeyDown}
      onMouseEnter={handlePrefetch}
      onFocus={handlePrefetch}
    >
      <Icon aria-hidden="true" />
      <span className="t-nav__label">{item.label}</span>
      {item.counter && (
        <span className="t-nav__count">{formatCounter(counterValue)}</span>
      )}
    </Link>
  );
});

export interface SideNavProps {
  isMobile?: boolean;
  onNavigate?: () => void;
}

export function SideNav({ isMobile = false, onNavigate }: SideNavProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const counters = useTutorChromeCounters();

  const handleLogout = useCallback(async () => {
    await supabase.auth.signOut();
    toast.success('Вы вышли из системы');
    navigate('/login');
  }, [navigate]);

  const isItemActive = (href: string): boolean =>
    location.pathname === href || location.pathname.startsWith(href + '/');

  return (
    <nav className="t-nav" aria-label="Разделы">
      <div className="t-nav__brand">
        <img src={sokratLogo} alt="" width={28} height={28} />
        <span className="t-nav__brand-name">Сократ AI</span>
      </div>

      {NAV_GROUPS.map((group) => (
        <div key={group.label}>
          <div
            className="t-nav__group-label"
            role="heading"
            aria-level={2}
          >
            {group.label}
          </div>
          {group.items.map((item) => (
            <NavItem
              key={item.href}
              item={item}
              isActive={isItemActive(item.href)}
              counterValue={item.counter ? counters[item.counter] : undefined}
              tooltip={formatCounterTooltip(item.counter, counters)}
              onNavigate={isMobile ? onNavigate : undefined}
            />
          ))}
        </div>
      ))}

      <div className="t-nav__footer">
        <button
          type="button"
          className="t-nav__item"
          onClick={handleLogout}
        >
          <LogOut aria-hidden="true" />
          <span className="t-nav__label">Выйти</span>
        </button>
      </div>
    </nav>
  );
}
