import { useEffect, useRef } from 'react';
import { SideNav } from '@/components/tutor/chrome/SideNav';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useFocusTrap } from '@/hooks/useFocusTrap';

// Swipe-left threshold (px) before we close. Matches tasks.md TASK-4 §2 (40px).
const SWIPE_CLOSE_DELTA_PX = 40;

export interface MobileDrawerProps {
  open: boolean;
  onClose: () => void;
}

export function MobileDrawer({ open, onClose }: MobileDrawerProps) {
  const drawerRef = useRef<HTMLElement | null>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);

  useFocusTrap(drawerRef, open);

  // iOS-safe body scroll lock: pins <body> via position:fixed + top:-scrollY
  // and restores scroll position on release. Replaces the old P0 inline
  // overflow:hidden (which leaked rubber-band scroll on iOS Safari).
  useBodyScrollLock(open);

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

  // Swipe-left-to-close (native touch events, no gesture libs per performance §2).
  // Listens globally while open so either the drawer itself or the backdrop can
  // receive the gesture. We guard on "primarily horizontal" so vertical scroll
  // inside the drawer content is not misread as a close gesture.
  useEffect(() => {
    if (!open) return;

    let startX = 0;
    let startY = 0;
    let currentX = 0;
    let currentY = 0;
    let tracking = false;

    const onTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      startX = touch.clientX;
      startY = touch.clientY;
      currentX = startX;
      currentY = startY;
      tracking = true;
    };
    const onTouchMove = (event: TouchEvent) => {
      if (!tracking) return;
      const touch = event.touches[0];
      if (!touch) return;
      currentX = touch.clientX;
      currentY = touch.clientY;
    };
    const onTouchEnd = () => {
      if (!tracking) return;
      tracking = false;
      const deltaX = currentX - startX;
      const deltaY = currentY - startY;
      const primarilyHorizontal = Math.abs(deltaX) > Math.abs(deltaY);
      if (primarilyHorizontal && deltaX <= -SWIPE_CLOSE_DELTA_PX) {
        onClose();
      }
    };

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd);
    window.addEventListener('touchcancel', onTouchEnd);
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [open, onClose]);

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
