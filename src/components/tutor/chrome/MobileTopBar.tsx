import { useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LogOut, Menu } from 'lucide-react';
import { toast } from 'sonner';
import sokratLogo from '@/assets/sokrat-logo.png';
import { supabase } from '@/lib/supabaseClient';
import { UserAvatar } from '@/components/common/UserAvatar';
import { useTutorProfile } from '@/hooks/useTutorProfile';

export interface MobileTopBarProps {
  isDrawerOpen: boolean;
  onOpenDrawer: () => void;
}

export function MobileTopBar({ isDrawerOpen, onOpenDrawer }: MobileTopBarProps) {
  const navigate = useNavigate();
  // Mounted only inside AppFrame (already TutorGuard'ed), so the query
  // never fires for non-tutor users.
  const { data: profile } = useTutorProfile();

  const handleLogout = useCallback(async () => {
    await supabase.auth.signOut();
    toast.success('Вы вышли из системы');
    navigate('/login');
  }, [navigate]);

  return (
    <div className="t-mobile-top">
      <button
        type="button"
        className="t-mobile-top__hamburger"
        onClick={onOpenDrawer}
        aria-label={isDrawerOpen ? 'Закрыть меню' : 'Открыть меню'}
        aria-expanded={isDrawerOpen}
        aria-controls="tutor-sidenav-drawer"
      >
        <Menu size={20} aria-hidden="true" />
      </button>
      <Link to="/tutor/home" className="t-mobile-top__brand">
        <img src={sokratLogo} alt="" width={24} height={24} />
        <span>Сократ AI</span>
      </Link>
      {/* Profile avatar — entry point per ChatGPT-5.5 review BLOCKER 3.
          Renders before logout, native flex parent gives spacing. 44px
          tap target wraps the 32px avatar for iOS Safari. */}
      <Link
        to="/tutor/profile"
        aria-label="Открыть профиль"
        title={profile?.name ? `Профиль · ${profile.name}` : 'Профиль'}
        className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
      >
        <UserAvatar
          size="sm"
          avatarUrl={profile?.avatar_url ?? null}
          gender={profile?.gender ?? null}
          name={profile?.name}
        />
      </Link>
      <button
        type="button"
        className="t-mobile-top__logout"
        onClick={handleLogout}
        aria-label="Выйти"
      >
        <LogOut size={18} aria-hidden="true" />
      </button>
    </div>
  );
}
