import { Suspense, useCallback, useState } from 'react';
import { Outlet } from 'react-router-dom';
import TutorGuard from '@/components/TutorGuard';
import { SideNav } from '@/components/tutor/chrome/SideNav';
import { MobileTopBar } from '@/components/tutor/chrome/MobileTopBar';
import { MobileDrawer } from '@/components/tutor/chrome/MobileDrawer';
import { SubjectsGateDialog } from '@/components/tutor/SubjectsGateDialog';

const PageFallback = () => (
  <div className="flex items-center justify-center min-h-[50vh]">
    <div className="flex space-x-2">
      <div className="w-3 h-3 bg-primary rounded-full animate-bounce" />
      <div className="w-3 h-3 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
      <div className="w-3 h-3 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0.4s' }} />
    </div>
  </div>
);

export function AppFrame() {
  const [drawerOpen, setDrawerOpen] = useState(false);

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  return (
    <TutorGuard>
      <div className="sokrat t-app" data-sokrat-mode="tutor">
        <aside className="t-app__rail">
          <SideNav />
        </aside>
        <MobileTopBar isDrawerOpen={drawerOpen} onOpenDrawer={openDrawer} />
        <MobileDrawer open={drawerOpen} onClose={closeDrawer} />
        {/* Гейт предметов (Ф1) — один монтаж на весь кабинет: переживает
            route-changes и тихую ре-верификацию TutorGuard (rule 96 §5a). */}
        <SubjectsGateDialog />
        <main className="t-app__main">
          <Suspense fallback={<PageFallback />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </TutorGuard>
  );
}

export default AppFrame;
