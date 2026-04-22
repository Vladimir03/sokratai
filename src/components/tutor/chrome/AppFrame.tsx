import { Suspense, useCallback, useState } from 'react';
import { Outlet } from 'react-router-dom';
import TutorGuard from '@/components/TutorGuard';
import { SideNav } from '@/components/tutor/chrome/SideNav';
import { MobileTopBar } from '@/components/tutor/chrome/MobileTopBar';
import { MobileDrawer } from '@/components/tutor/chrome/MobileDrawer';

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
