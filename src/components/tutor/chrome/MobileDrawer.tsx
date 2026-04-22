import { useEffect, useRef } from 'react';
import { SideNav } from '@/components/tutor/chrome/SideNav';
import { useFocusTrap } from '@/hooks/useFocusTrap';

export interface MobileDrawerProps {
  open: boolean;
  onClose: () => void;
}

export function MobileDrawer({ open, onClose }: MobileDrawerProps) {
  const drawerRef = useRef<HTMLElement | null>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);

  useFocusTrap(drawerRef, open);

  // Save/restore focus around the open→close cycle
  useEffect(() => {
    if (open) {
      lastFocusedRef.current = document.activeElement as HTMLElement | null;
    } else if (lastFocusedRef.current) {
      lastFocusedRef.current.focus();
      lastFocusedRef.current = null;
    }
  }, [open]);

  // Esc to close
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  // Basic body scroll lock (desktop + Android). iOS-safe variant → TASK-4.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  // Remove closed drawer from Tab order (AC-11: mobile — только когда drawer открыт).
  // `inert` on the container strips focusability of all descendants in one shot.
  // Native attribute (Safari 15.4+, Chrome 102+, Firefox 112+ — within vite build target).
  useEffect(() => {
    const node = drawerRef.current;
    if (!node) return;
    if (open) node.removeAttribute('inert');
    else node.setAttribute('inert', '');
  }, [open]);

  return (
    <>
      <div
        className={`t-mobile-backdrop${open ? ' t-mobile-backdrop--open' : ''}`}
        onClick={onClose}
        role="presentation"
      />
      <aside
        id="tutor-sidenav-drawer"
        ref={drawerRef}
        className={`t-mobile-drawer${open ? ' t-mobile-drawer--open' : ''}`}
        aria-label="Мобильное меню"
        aria-hidden={!open}
      >
        <SideNav isMobile onNavigate={onClose} />
      </aside>
    </>
  );
}
