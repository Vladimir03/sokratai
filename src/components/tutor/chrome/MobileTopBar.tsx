import { useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LogOut, Menu } from 'lucide-react';
import { toast } from 'sonner';
import sokratLogo from '@/assets/sokrat-logo.png';
import { supabase } from '@/lib/supabaseClient';

export interface MobileTopBarProps {
  isDrawerOpen: boolean;
  onOpenDrawer: () => void;
}

export function MobileTopBar({ isDrawerOpen, onOpenDrawer }: MobileTopBarProps) {
  const navigate = useNavigate();

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
