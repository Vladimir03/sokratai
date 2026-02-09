import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

interface TutorGuardProps {
  children: React.ReactNode;
}

const SESSION_TIMEOUT_MS = 8000;
const RPC_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 10 * 60 * 1000;

// Module-level cache: avoids re-checking is_tutor on every tab navigation
const tutorAuthCache = {
  userId: null as string | null,
  isTutor: false,
  verifiedAt: 0,
};

function isCacheValid(userId: string): boolean {
  return (
    tutorAuthCache.isTutor &&
    tutorAuthCache.userId === userId &&
    Date.now() - tutorAuthCache.verifiedAt < CACHE_TTL_MS
  );
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
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
      const {
        data: { session },
      } = await withTimeout(
        supabase.auth.getSession(),
        SESSION_TIMEOUT_MS,
        "Превышено время ожидания проверки сессии"
      );

      if (!session) {
        tutorAuthCache.userId = null;
        tutorAuthCache.isTutor = false;
        tutorAuthCache.verifiedAt = 0;
        navigate("/login");
        return;
      }

      if (!forceRecheck && isCacheValid(session.user.id)) {
        if (isMounted.current) {
          setAuthorized(true);
          setLoading(false);
        }
        return;
      }

      const delays = [0, 1000, 2000, 3000];
      let isTutor = false;
      let lastError: string | null = null;
      let retryFailures = 0;

      for (let i = 0; i < delays.length; i++) {
        if (delays[i] > 0) {
          await wait(delays[i]);
        }

        try {
          const { data, error: rpcError } = await withTimeout(
            Promise.resolve(supabase.rpc("is_tutor", { _user_id: session.user.id })) as Promise<any>,
            RPC_TIMEOUT_MS,
            "Превышено время ожидания проверки роли"
          );

          if (!rpcError && data) {
            isTutor = true;
            lastError = null;
            break;
          }

          if (rpcError) {
            lastError = rpcError.message;
            retryFailures += 1;
            if (i < delays.length - 1) {
              console.warn("tutor_query_retry", {
                queryKey: "is_tutor",
                failureCount: retryFailures,
                stage: "guard",
                error: lastError,
              });
            }
            continue;
          }

          lastError = null;
          if (i < delays.length - 1) {
            retryFailures += 1;
            console.warn("tutor_query_retry", {
              queryKey: "is_tutor",
              failureCount: retryFailures,
              stage: "guard",
              error: "is_tutor returned false",
            });
          }
        } catch (rpcTimeoutError) {
          lastError = rpcTimeoutError instanceof Error ? rpcTimeoutError.message : "Неизвестная ошибка сети";
          retryFailures += 1;
          if (i < delays.length - 1) {
            console.warn("tutor_query_retry", {
              queryKey: "is_tutor",
              failureCount: retryFailures,
              stage: "guard",
              error: lastError,
            });
          }
        }
      }

      if (lastError) {
        console.error("tutor_query_timeout", {
          queryKey: "is_tutor",
          failureCount: retryFailures || delays.length,
          stage: "guard",
          error: lastError,
        });
        if (isMounted.current) {
          setError("Ошибка проверки доступа. Проверьте соединение.");
        }
        return;
      }

      if (!isTutor) {
        navigate("/register-tutor");
        return;
      }

      tutorAuthCache.userId = session.user.id;
      tutorAuthCache.isTutor = true;
      tutorAuthCache.verifiedAt = Date.now();
      if (retryFailures > 0) {
        console.info("tutor_query_recovered", {
          queryKey: "is_tutor",
          failureCount: retryFailures,
          stage: "guard",
        });
      }

      if (isMounted.current) {
        setAuthorized(true);
      }
    } catch (guardError) {
      console.error("Error in TutorGuard:", guardError);
      console.error("tutor_query_timeout", {
        queryKey: "is_tutor",
        stage: "guard",
        error: guardError instanceof Error ? guardError.message : String(guardError),
      });
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
        tutorAuthCache.userId = null;
        tutorAuthCache.isTutor = false;
        tutorAuthCache.verifiedAt = 0;
        navigate("/login");
      } else if (event === "TOKEN_REFRESHED") {
        tutorAuthCache.verifiedAt = Date.now();
      }
    });

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        supabase.auth.getSession().then(({ data: { session } }) => {
          if (!session && isMounted.current) {
            navigate("/login");
          }
        });
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      isMounted.current = false;
      subscription.unsubscribe();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
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
