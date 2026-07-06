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
  // Зеркало `authorized`, читаемое внутри `checkAccess` без stale-closure —
  // позволяет повторной верификации быть «тихой» (без лоадера/размонтирования),
  // когда репетитор УЖЕ внутри кабинета. См. обработчик SIGNED_IN ниже.
  const authorizedRef = useRef(false);

  const checkAccess = useCallback(async (forceRecheck = false) => {
    // Повторная верификация, пока репетитор УЖЕ внутри кабинета, не должна
    // размонтировать текущую страницу: setLoading(true) / setError() подменили бы
    // <Outlet/> спиннером или экраном ошибки и стёрли несохранённый локальный
    // стейт любой открытой формы при переключении вкладки (баг Егора #41).
    // Блокирующий UI показываем ТОЛЬКО на первой проверке (authorized === false)
    // или при явном ручном retry (forceRecheck); фоновая перепроверка идёт тихо
    // и оставляет детей смонтированными (согласуется с rule 95 tiered-errors).
    const silent = authorizedRef.current && !forceRecheck;
    if (!silent) {
      setLoading(true);
      setError(null);
    }

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
        // Тихая фоновая перепроверка НЕ должна сносить рабочий кабинет на экран
        // ошибки при транзиентном сбое под RU-DPI — логируем и оставляем страницу.
        if (!silent && isMounted.current) {
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
      if (!silent && isMounted.current) {
        setError("Ошибка соединения. Попробуйте ещё раз.");
      }
    } finally {
      if (!silent && isMounted.current) {
        setLoading(false);
      }
    }
  }, [navigate]);

  // Держим ref в синхроне с `authorized`, чтобы `checkAccess` видел актуальное
  // значение (для «тихой» перепроверки без размонтирования кабинета).
  useEffect(() => {
    authorizedRef.current = authorized;
  }, [authorized]);

  useEffect(() => {
    isMounted.current = true;

    // RU OAuth bypass race condition (2026-05-16): on landing pages that carry
    // session tokens in URL hash (e.g. /tutor/home#access_token=... from
    // oauth-google-callback OR email-verify edge functions), supabase-js
    // parses the hash asynchronously and emits `INITIAL_SESSION`. A
    // synchronous `getSession()` call before that parse completes returns
    // null, which routes the user to /login → they see the signup form
    // again → infinite loop.
    //
    // Fix: defer the FIRST checkAccess() until INITIAL_SESSION fires. After
    // that, all existing behavior (module-level cache, RPC retry with delays,
    // visibilitychange recheck, SIGNED_OUT → /login) is preserved as-is.
    let initialFired = false;

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // First INITIAL_SESSION (with or without session): hash is now parsed,
      // safe to run checkAccess(). Only run once — subsequent events handled
      // by the if-branches below.
      if (!initialFired && event === "INITIAL_SESSION") {
        initialFired = true;
        checkAccess();
        return;
      }

      if (!session) {
        tutorAuthCache.userId = null;
        tutorAuthCache.isTutor = false;
        tutorAuthCache.verifiedAt = 0;
        navigate("/login");
      } else if (event === "TOKEN_REFRESHED") {
        tutorAuthCache.verifiedAt = Date.now();
      } else if (event === "SIGNED_IN") {
        // supabase-js переэмитит SIGNED_IN на возврате вкладки (session-recovery
        // на visibilitychange), а не только при свежем логине. Безусловный
        // checkAccess() здесь вызвал бы setLoading(true) → весь /tutor поддерев
        // размонтируется и теряет несохранённый локальный стейт формы (баг Егора
        // #41; 3 репетитора). 3-way маршрутизация по юзеру/кэшу:
        if (isCacheValid(session.user.id)) {
          // Тот же верифицированный юзер, кэш свежий → держим кабинет
          // смонтированным. verifiedAt НЕ трогаем: 10-мин TTL должен отражать
          // последнюю РЕАЛЬНУЮ is_tutor-проверку, а не последний фокус вкладки
          // (иначе роль у активного репетитора не перепроверяется — review P1).
          if (isMounted.current) {
            setAuthorized(true);
            setLoading(false);
          }
        } else if (tutorAuthCache.userId === session.user.id) {
          // Тот же юзер, кэш протух → тихая фоновая перепроверка роли (без
          // анмаунта); при провале verifiedAt не бампается → естественный
          // ретрай на следующий фокус вкладки.
          checkAccess();
        } else {
          // Другой/неизвестный юзер → немедленно блокируем кабинет до проверки
          // новой роли, не показываем данные прежнего репетитора (review P1).
          // forceRecheck делает checkAccess неслайлентным (спиннер) + минует кэш.
          if (isMounted.current) setAuthorized(false);
          checkAccess(true);
        }
      }
    });

    // Safety net: if INITIAL_SESSION never fires within 3s (browser quirk /
    // supabase-js bug), fall back to the old synchronous path so the user
    // is not stuck on a loader forever. 3s is conservative — INITIAL_SESSION
    // normally fires within ~10ms after mount.
    const initFallback = window.setTimeout(() => {
      if (!initialFired) {
        initialFired = true;
        console.warn(
          JSON.stringify({
            event: "tutor_guard_initial_session_timeout",
            timestamp: new Date().toISOString(),
          }),
        );
        checkAccess();
      }
    }, 3000);

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
      window.clearTimeout(initFallback);
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
