import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useTutorMockExamsFeatureFlag } from '@/hooks/useTutorMockExamsFeatureFlag';

interface MockExamFeatureGateProps {
  children: ReactNode;
}

export function MockExamFeatureGate({ children }: MockExamFeatureGateProps) {
  const { data: enabled, isLoading } = useTutorMockExamsFeatureFlag();

  if (isLoading) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Загрузка...
      </div>
    );
  }

  if (enabled !== true) {
    return <Navigate to="/tutor/home" replace />;
  }

  return <>{children}</>;
}
