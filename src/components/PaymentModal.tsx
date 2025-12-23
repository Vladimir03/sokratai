import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import { Loader2, Crown, CheckCircle, XCircle, ChevronDown, ChevronUp } from "lucide-react";
import { ConfettiBurst } from "@/components/ConfettiBurst";
import { useNavigate } from "react-router-dom";

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

interface ErrorDetails {
  message: string;
  code?: string;
  details?: string;
  httpStatus?: number;
}

declare global {
  interface Window {
    YooMoneyCheckoutWidget: new (config: {
      confirmation_token: string;
      return_url?: string;
      error_callback?: (error: { error: string }) => void;
      customization?: {
        modal?: boolean;
      };
    }) => {
      render: (containerId: string) => { destroy: () => void };
      destroy: () => void;
    };
  }
}

type PaymentStatus = "idle" | "loading" | "widget" | "success" | "error";

export function PaymentModal({ isOpen, onClose, onSuccess }: PaymentModalProps) {
  const navigate = useNavigate();
  const [status, setStatus] = useState<PaymentStatus>("idle");
  const [errorDetails, setErrorDetails] = useState<ErrorDetails | null>(null);
  const [showTechDetails, setShowTechDetails] = useState(false);
  const [confirmationToken, setConfirmationToken] = useState<string | null>(null);
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const widgetRef = useRef<{ destroy: () => void } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const openUrlInNewTab = (url: string) => {
    try {
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      // ignore
    }
  };

  const createRedirectPaymentAndOpen = async () => {
    const { data, error } = await supabase.functions.invoke("yookassa-create-payment", {
      body: {
        return_url: `${window.location.origin}/profile?payment=success`,
        confirmation_type: "redirect",
      },
    });

    if (error || !data?.confirmation_url) {
      toast.error("Не удалось открыть оплату в новом окне");
      return;
    }

    setRedirectUrl(data.confirmation_url);
    openUrlInNewTab(data.confirmation_url);
  };

  // Load YooKassa widget script
  useEffect(() => {
    if (!isOpen) return;

    const existingScript = document.getElementById("yookassa-widget-script");
    if (existingScript) return;

    const script = document.createElement("script");
    script.id = "yookassa-widget-script";
    script.src = "https://yookassa.ru/checkout-widget/v1/checkout-widget.js";
    script.async = true;
    document.head.appendChild(script);

    return () => {
      // Don't remove script - it can be reused
    };
  }, [isOpen]);

  // Initialize payment when modal opens
  useEffect(() => {
    if (!isOpen) {
      setStatus("idle");
      setErrorDetails(null);
      setShowTechDetails(false);
      setConfirmationToken(null);
      setRedirectUrl(null);
      return;
    }

    initializePayment();
  }, [isOpen]);

  // Cleanup widget on unmount
  useEffect(() => {
    return () => {
      if (widgetRef.current) {
        try {
          widgetRef.current.destroy();
        } catch (e) {
          // Widget might already be destroyed
        }
        widgetRef.current = null;
      }
    };
  }, []);

  const initializePayment = async () => {
    setStatus("loading");
    setErrorDetails(null);
    setShowTechDetails(false);
    setConfirmationToken(null);
    setRedirectUrl(null);

    try {
      // Get current session
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setErrorDetails({ message: "Необходимо войти в аккаунт", code: "AUTH_REQUIRED" });
        setStatus("error");
        return;
      }
      setUserId(session.user.id);

      // Create payment via Edge Function
      const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
      const isInAppBrowser =
        /Telegram/i.test(ua) ||
        /Instagram/i.test(ua) ||
        /FBAN|FBAV/i.test(ua) ||
        /Line/i.test(ua);

      // Lovable preview and many in-app environments run inside an iframe.
      // Embedded 3DS is often non-interactive in nested iframes, so prefer redirect.
      const isInIframe = (() => {
        try {
          return window.top !== window.self;
        } catch {
          return true; // cross-origin access => definitely embedded
        }
      })();

      const preferredConfirmationType = isInAppBrowser ? "redirect" : "embedded";
      const confirmationType = (isInIframe || isInAppBrowser) ? "redirect" : preferredConfirmationType;

      const { data, error } = await supabase.functions.invoke("yookassa-create-payment", {
        body: {
          return_url: `${window.location.origin}/profile?payment=success`,
          confirmation_type: confirmationType,
        },
      });

      // Redirect flow: no token, but has confirmation_url
      if (!error && data?.confirmation_url && confirmationType === "redirect") {
        setRedirectUrl(data.confirmation_url);
        setStatus("widget");
        // Try to open immediately (user gesture is present from clicking "Оформить")
        openUrlInNewTab(data.confirmation_url);
        return;
      }

      if (error || !data?.confirmation_token) {
        console.error("Payment creation error:", error, data);
        setErrorDetails({
          message: data?.error || "Не удалось создать платёж",
          code: data?.error_code,
          details: data?.details,
          httpStatus: data?.http_status,
        });
        setStatus("error");
        return;
      }

      // Store token, then render widget after container is in DOM
      setConfirmationToken(data.confirmation_token);
      setStatus("widget");
    } catch (error) {
      console.error("Payment initialization error:", error);
      setErrorDetails({ 
        message: "Произошла ошибка при инициализации платежа",
        details: String(error)
      });
      setStatus("error");
    }
  };

  const waitForYooKassaWidget = (): Promise<void> => {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const maxAttempts = 50; // 5 seconds

      const check = () => {
        if (window.YooMoneyCheckoutWidget) {
          resolve();
        } else if (attempts >= maxAttempts) {
          reject(new Error("YooKassa widget failed to load"));
        } else {
          attempts++;
          setTimeout(check, 100);
        }
      };

      check();
    });
  };

  const renderWidget = (token: string) => {
    try {
      // Destroy existing widget if any
      if (widgetRef.current) {
        try {
          widgetRef.current.destroy();
        } catch (e) {
          // Ignore
        }
      }

      const checkout = new window.YooMoneyCheckoutWidget({
        confirmation_token: token,
        return_url: `${window.location.origin}/profile?payment=success`,
        error_callback: (error) => {
          console.error("YooKassa widget error:", error);
          setErrorDetails({ 
            message: "Ошибка при оплате",
            details: error.error || "Неизвестная ошибка"
          });
          setStatus("error");
        },
      });

      widgetRef.current = checkout.render("yookassa-widget-container");
    } catch (error) {
      console.error("Widget render error:", error);
      setErrorDetails({ message: "Не удалось загрузить форму оплаты", details: String(error) });
      setStatus("error");
    }
  };

  // When we have a token and are in widget mode, render the widget AFTER the container is mounted
  useEffect(() => {
    if (!isOpen) return;
    if (status !== "widget") return;
    if (!confirmationToken) return;

    let cancelled = false;

    (async () => {
      try {
        await waitForYooKassaWidget();
        // Ensure DOM is committed
        requestAnimationFrame(() => {
          if (cancelled) return;
          const el = document.getElementById("yookassa-widget-container");
          if (!el) {
            setErrorDetails({ message: "Контейнер для виджета не найден" });
            setStatus("error");
            return;
          }
          renderWidget(confirmationToken);
        });
      } catch (e) {
        console.error("YooKassa widget load error:", e);
        setErrorDetails({ message: "Не удалось загрузить виджет оплаты", details: String(e) });
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOpen, status, confirmationToken]);

  const handleClose = () => {
    // Destroy widget before closing
    if (widgetRef.current) {
      try {
        widgetRef.current.destroy();
      } catch (e) {
        // Ignore
      }
      widgetRef.current = null;
    }
    onClose();
  };

  const handleRetry = () => {
    initializePayment();
  };

  // Poll subscription status while payment is in progress; show success + confetti when premium becomes active.
  useEffect(() => {
    if (!isOpen) return;
    if (status !== "widget") return;
    if (!userId) return;

    let cancelled = false;
    const startedAt = Date.now();

    const poll = async () => {
      try {
        const { data, error } = await supabase.rpc("get_subscription_status" as any, { p_user_id: userId });
        if (cancelled) return;
        if (!error && data) {
          const row = Array.isArray(data) ? data[0] : data;
          const isPremium = Boolean(row?.is_premium);
          if (isPremium) {
            setStatus("success");
            toast.success("🎉 Premium подключён!");
            onSuccess?.();
          }
        }
      } catch {
        // ignore polling errors
      }
    };

    const interval = setInterval(() => {
      if (cancelled) return;
      poll();
      if (Date.now() - startedAt > 60000) {
        clearInterval(interval);
      }
    }, 2500);

    // Immediate check
    poll();

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isOpen, status, userId, onSuccess]);

  return (
    <Dialog open={isOpen} modal={false} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-[500px] w-[calc(100vw-2rem)] max-h-[85svh] max-h-[85dvh] overflow-y-auto p-4 sm:p-6" data-payment-modal="true">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
            <Crown className="w-5 h-5 text-amber-500" />
            Оформление подписки Premium
          </DialogTitle>
          <DialogDescription className="text-sm">
            Безлимитные сообщения и доступ ко всем функциям — 699₽/месяц
          </DialogDescription>
        </DialogHeader>

        <ConfettiBurst active={status === "success"} />

        <div className="mt-4">
          {/* Keep container in DOM so widget can always mount */}
          <div
            id="yookassa-widget-container"
            ref={containerRef}
            className={`min-h-[300px] ${status === "widget" ? "" : "hidden"}`}
          />

          {status === "loading" && (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <Loader2 className="w-10 h-10 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Подготовка платежа...</p>
            </div>
          )}

          {status === "error" && errorDetails && (
            <div className="flex flex-col items-center justify-center py-8 gap-4">
              <div className="p-3 bg-red-500/10 rounded-full">
                <XCircle className="w-10 h-10 text-red-500" />
              </div>
              <p className="text-center text-sm text-muted-foreground">{errorDetails.message}</p>
              
              {/* Technical details collapsible */}
              {(errorDetails.code || errorDetails.details || errorDetails.httpStatus) && (
                <div className="w-full">
                  <button
                    onClick={() => setShowTechDetails(!showTechDetails)}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mx-auto"
                  >
                    {showTechDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    Технические детали
                  </button>
                  {showTechDetails && (
                    <div className="mt-2 p-3 bg-muted rounded-md text-xs font-mono space-y-1 max-h-[150px] overflow-y-auto">
                      {errorDetails.httpStatus && (
                        <div><span className="text-muted-foreground">HTTP:</span> {errorDetails.httpStatus}</div>
                      )}
                      {errorDetails.code && (
                        <div><span className="text-muted-foreground">Код:</span> {errorDetails.code}</div>
                      )}
                      {errorDetails.details && (
                        <div className="break-words"><span className="text-muted-foreground">Детали:</span> {errorDetails.details}</div>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-2 w-full">
                <Button variant="outline" size="sm" className="w-full sm:w-auto" onClick={handleClose}>
                  Закрыть
                </Button>
                <Button size="sm" className="w-full sm:w-auto" onClick={handleRetry}>
                  Попробовать снова
                </Button>
              </div>

              <Button
                variant="secondary"
                size="sm"
                className="w-full"
                onClick={async () => {
                  try {
                    await createRedirectPaymentAndOpen();
                  } catch {
                    toast.error("Не удалось открыть оплату в новом окне");
                  }
                }}
              >
                Открыть оплату в новом окне
              </Button>
            </div>
          )}

          {status === "success" && (
            <div className="flex flex-col items-center justify-center py-6 sm:py-8 gap-3 sm:gap-4">
              <div className="p-3 bg-green-500/10 rounded-full">
                <CheckCircle className="w-10 h-10 text-green-500" />
              </div>
              <h3 className="text-base sm:text-lg font-semibold">🎉 Premium подключён!</h3>
              <p className="text-center text-sm text-muted-foreground px-2">
                Готово — безлимитные сообщения уже доступны.
              </p>
              <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full sm:w-auto"
                  onClick={() => {
                    onSuccess?.();
                    handleClose();
                    navigate("/chat");
                  }}
                >
                  Перейти в чат
                </Button>
                <Button size="sm" className="w-full sm:w-auto" onClick={() => { onSuccess?.(); handleClose(); }}>
                  Круто!
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Benefits reminder */}
        {(status === "loading" || status === "widget" || status === "idle") && (
          <div className="mt-3 sm:mt-4 p-3 sm:p-4 bg-gradient-to-r from-purple-500/10 to-pink-500/10 rounded-lg border border-purple-500/20">
            <h4 className="font-medium text-xs sm:text-sm mb-2">Что включено в Premium:</h4>
            <ul className="text-xs sm:text-sm text-muted-foreground space-y-1">
              <li>✨ Безлимитные сообщения</li>
              <li>⚡ Приоритетная скорость ответов</li>
              <li>🎓 Доступ ко всем функциям</li>
              <li>💬 Приоритетная поддержка</li>
            </ul>

            {redirectUrl && (
              <div className="mt-3 text-xs sm:text-sm">
                <p className="text-muted-foreground">
                  Оплата открывается в новой вкладке (так 3‑D Secure работает стабильнее во встроенных браузерах).
                  Если вкладка не открылась — нажмите кнопку:
                </p>
                <Button
                  size="sm"
                  className="mt-2 w-full"
                  onClick={() => openUrlInNewTab(redirectUrl)}
                >
                  Открыть оплату
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Manual fallback even when embedded widget is shown (3DS can be non-clickable in some envs) */}
        {status === "widget" && !redirectUrl && (
          <div className="mt-3">
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs sm:text-sm"
              onClick={async () => {
                try {
                  await createRedirectPaymentAndOpen();
                } catch {
                  toast.error("Не удалось открыть оплату в новом окне");
                }
              }}
            >
              Если кнопки не нажимаются — открыть оплату в новом окне
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default PaymentModal;
