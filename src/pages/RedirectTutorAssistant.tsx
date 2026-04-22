import { useEffect, useRef } from 'react';
import { Navigate } from 'react-router-dom';
import { trackGuidedHomeworkEvent } from '@/lib/homeworkTelemetry';

export default function RedirectTutorAssistant() {
  const firedRef = useRef(false);
  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    trackGuidedHomeworkEvent('tutor_assistant_route_hit');
  }, []);
  return <Navigate to="/tutor/home" replace />;
}
