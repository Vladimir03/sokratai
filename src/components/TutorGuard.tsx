import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

interface TutorGuardProps {
  children: React.ReactNode;
}

// Module-level cache: avoids re-checking is_tutor on every tab navigation
const tutorAuthCache = {
  userId: null as string | null,
  isTutor: false,
  verifiedAt: 0,
};

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function isCacheValid(userId: string): boolean {
  return (
    tutorAuthCache.isTutor &&
    tutorAuthCache.userId === userId &&
    Date.now() - tutorAuthCache.verifiedAt < CACHE_TTL_MS
  );
}

const TutorGuard = ({ children }: TutorGuardProps) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useRef(true);

  const checkAccess = useCallback(async (forceRecheck = false) => {
    setLoading(true);
    setError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        navigate("/login");
        return;
      }

      // Fast path: use cached authorization if recently verified
      if (!forceRecheck && isCacheValid(session.user.id)) {
        if (isMounted.current) {
          setAuthorized(true);
          setLoading(false);
        }
        return;
      }

      // Retry logic with increasing delays for role propagation and unstable connections
      const delays = [0, 1000, 2000, 3000]; // First attempt immediate, then 1s, 2s, 3s
      let isTutor = false;
      let lastError = null;

      for (let i = 0; i < delays.length; i++) {
        if (delays[i] > 0) {
          await new Promise(r => setTimeout(r, delays[i]));
        }

        const { data, error } = await supabase.rpc("is_tutor", {
          _user_id: session.user.id
        });

        if (!error && data) {
          isTutor = true;
          lastError = null;
          break;
        }

        lastError = error;
        if (!error && !data && i < delays.length - 1) {
          console.log(`TutorGuard: is_tutor returned false, retrying (${i + 1}/${delays.length})...`);
        }
      }

      if (lastError) {
        console.error("Error checking tutor role after retries:", lastError);
        if (isMounted.current) {
          setError("Ошибка проверки доступа. Проверьте соединение.");
          setLoading(false);
        }
        return;
      }

      if (!isTutor) {
        navigate("/register-tutor");
        return;
      }

      // Update cache on success
      tutorAuthCache.userId = session.user.id;
      tutorAuthCache.isTutor = true;
      tutorAuthCache.verifiedAt = Date.now();

      if (isMounted.current) {
        setAuthorized(true);
      }
    } catch (error) {
      console.error("Error in TutorGuard:", error);
      if (isMounted.current) {
        setError("Ошибка соединения. Попробуйте ещё раз.");
      }
    } finally {
      if (isMounted.current) {
        setLoading(false);
      }
    }
  }, [navigate]);

  useEffect(() => {
    isMounted.current = true;

    checkAccess();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session) {
        // Clear cache on logout
        tutorAuthCache.userId = null;
        tutorAuthCache.isTutor = false;
        tutorAuthCache.verifiedAt = 0;
        navigate("/login");
      } else if (event === 'TOKEN_REFRESHED') {
        // Token was refreshed successfully — update cache timestamp
        tutorAuthCache.verifiedAt = Date.now();
      }
    });

    // Visibility change handler: refresh session when tab becomes active after inactivity
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Trigger Supabase to refresh the session if needed
        supabase.auth.getSession().then(({ data: { session } }) => {
          if (!session && isMounted.current) {
            navigate("/login");
          }
        });
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      isMounted.current = false;
      subscription.unsubscribe();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [navigate, checkAccess]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Загрузка...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <p className="text-destructive">{error}</p>
          <Button onClick={() => checkAccess(true)} variant="outline" className="gap-2">
            <RefreshCw className="w-4 h-4" />
            Повторить
          </Button>
        </div>
      </div>
    );
  }

  if (!authorized) {
    return null;
  }

  return <>{children}</>;
};

export default TutorGuard;
