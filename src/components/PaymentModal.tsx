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
  const debugLastUiEventAtRef = useRef<number>(0);

  // #region agent log helpers
  const dbg = (hypothesisId: string, location: string, message: string, data: Record<string, unknown>) => {
    // Use no-cors + text/plain to avoid CORS preflight from HTTPS preview environments.
    fetch('http://127.0.0.1:7242/ingest/5a352d39-cd0b-48d9-ba61-990189298ff9',{method:'POST',mode:'no-cors',headers:{'Content-Type':'text/plain'},body:JSON.stringify({sessionId:'debug-session',runId:'run3',hypothesisId,location,message,data,timestamp:Date.now()})}).catch(()=>{});
  };

  const scanIframes = (reason: string) => {
    const modalEl = document.querySelector('[data-payment-modal="true"]');
    const iframes = Array.from(document.querySelectorAll("iframe"));
    const inside = modalEl ? iframes.filter((f) => modalEl.contains(f)) : [];
    const outside = modalEl ? iframes.filter((f) => !modalEl.contains(f)) : iframes;
    const toHost = (src: string) => {
      try {
        return new URL(src, window.location.href).host;
      } catch {
        return null;
      }
    };
    const sampleOutsideHosts = outside
      .map((f) => toHost(f.getAttribute("src") || ""))
      .filter(Boolean)
      .slice(0, 4);

    let bodyPointerEvents: string | null = null;
    try {
      bodyPointerEvents = getComputedStyle(document.body).pointerEvents;
    } catch {}

    // #region agent log
    dbg("H1","PaymentModal.tsx:scanIframes","iframe_scan",{reason,total:iframes.length,insideModal:inside.length,outsideModal:outside.length,bodyPointerEvents,sampleOutsideHosts});
    // #endregion
  };
  // #endregion

  const openUrlInNewTab = (url: string) => {
    // Try to open a new tab; if blocked, user can use the fallback button we show.
    try {
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      // ignore
    }
  };

  const createRedirectPaymentAndOpen = async () => {
    // #region agent log
    dbg("H4","PaymentModal.tsx:createRedirectPaymentAndOpen","request_redirect_payment",{status,hasUserId:Boolean(userId)});
    // #endregion
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
    // #region agent log
    dbg("H4","PaymentModal.tsx:createRedirectPaymentAndOpen","redirect_url_opened",{hasRedirectUrl:true});
    // #endregion
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
        // #region agent log
        dbg("H3","PaymentModal.tsx:initializePayment","no_session",{});
        // #endregion
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

      // #region agent log
      dbg("H1","PaymentModal.tsx:initializePayment","env_detected",{isInAppBrowser,isInIframe,confirmationType,origin:window.location.origin});
      // #endregion

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
        // #region agent log
        dbg("H4","PaymentModal.tsx:initializePayment","redirect_flow",{hasConfirmationUrl:true});
        // #endregion
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
        // #region agent log
        dbg("H3","PaymentModal.tsx:initializePayment","create_payment_failed",{hasError:Boolean(error),hasToken:Boolean(data?.confirmation_token),errorCode:data?.error_code,httpStatus:data?.http_status});
        // #endregion
        return;
      }

      // Store token, then render widget after container is in DOM
      setConfirmationToken(data.confirmation_token);
      setStatus("widget");
      // #region agent log
      dbg("H2","PaymentModal.tsx:initializePayment","embedded_token_received",{});
      // #endregion
    } catch (error) {
      console.error("Payment initialization error:", error);
      setErrorDetails({ 
        message: "Произошла ошибка при инициализации платежа",
        details: String(error)
      });
      setStatus("error");
      // #region agent log
      dbg("H3","PaymentModal.tsx:initializePayment","exception",{details:String(error)});
      // #endregion
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
      // #region agent log
      dbg("H1","PaymentModal.tsx:renderWidget","widget_rendered",{activeElement:(document.activeElement && (document.activeElement as HTMLElement).tagName) || null});
      // #endregion
    } catch (error) {
      console.error("Widget render error:", error);
      setErrorDetails({ message: "Не удалось загрузить форму оплаты", details: String(error) });
      setStatus("error");
      // #region agent log
      dbg("H2","PaymentModal.tsx:renderWidget","widget_render_error",{details:String(error)});
      // #endregion
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
            // #region agent log
            dbg("H5","PaymentModal.tsx:pollPremium","premium_confirmed",{});
            // #endregion
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

  // Capture a small amount of UI evidence about "unclickable overlay" while widget is shown (throttled).
  useEffect(() => {
    if (!isOpen) return;
    if (status !== "widget") return;

    const onPointerDownCapture = (e: PointerEvent) => {
      const now = Date.now();
      if (now - debugLastUiEventAtRef.current < 1200) return; // throttle
      debugLastUiEventAtRef.current = now;

      const target = e.target as HTMLElement | null;
      const tag = target?.tagName || null;
      const id = target?.id || null;
      const cls = target?.className ? String(target.className).slice(0, 120) : null;
      const active = document.activeElement ? (document.activeElement as HTMLElement).tagName : null;
      const isInIframe = (() => { try { return window.top !== window.self; } catch { return true; } })();
      dbg("H1","PaymentModal.tsx:UI","pointerdown_capture",{tag,id,cls,active,isInIframe,x:e.clientX,y:e.clientY});
      scanIframes("pointerdown");
    };

    document.addEventListener("pointerdown", onPointerDownCapture, true);
    // one-time scan shortly after widget becomes visible
    scanIframes("widget_mount");
    return () => {
      document.removeEventListener("pointerdown", onPointerDownCapture, true);
    };
  }, [isOpen, status]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto" data-payment-modal="true">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Crown className="w-5 h-5 text-amber-500" />
            Оформление подписки Premium
          </DialogTitle>
          <DialogDescription>
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
              <p className="text-muted-foreground">Подготовка платежа...</p>
            </div>
          )}

          {status === "error" && errorDetails && (
            <div className="flex flex-col items-center justify-center py-8 gap-4">
              <div className="p-3 bg-red-500/10 rounded-full">
                <XCircle className="w-10 h-10 text-red-500" />
              </div>
              <p className="text-center text-muted-foreground">{errorDetails.message}</p>
              
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

              <div className="flex gap-2">
                <Button variant="outline" onClick={handleClose}>
                  Закрыть
                </Button>
                <Button onClick={handleRetry}>
                  Попробовать снова
                </Button>
              </div>

              <Button
                variant="secondary"
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
            <div className="flex flex-col items-center justify-center py-8 gap-4">
              <div className="p-3 bg-green-500/10 rounded-full">
                <CheckCircle className="w-10 h-10 text-green-500" />
              </div>
              <h3 className="text-lg font-semibold">🎉 Premium подключён!</h3>
              <p className="text-center text-muted-foreground">
                Готово — безлимитные сообщения уже доступны.
              </p>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  onClick={() => {
                    onSuccess?.();
                    handleClose();
                    navigate("/chat");
                  }}
                >
                  Перейти в чат
                </Button>
                <Button onClick={() => { onSuccess?.(); handleClose(); }}>
                  Круто!
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Benefits reminder */}
        {(status === "loading" || status === "widget" || status === "idle") && (
          <div className="mt-4 p-4 bg-gradient-to-r from-purple-500/10 to-pink-500/10 rounded-lg border border-purple-500/20">
            <h4 className="font-medium text-sm mb-2">Что включено в Premium:</h4>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>✨ Безлимитные сообщения</li>
              <li>⚡ Приоритетная скорость ответов</li>
              <li>🎓 Доступ ко всем функциям</li>
              <li>💬 Приоритетная поддержка</li>
            </ul>

            {redirectUrl && (
              <div className="mt-3 text-sm">
                <p className="text-muted-foreground">
                  Оплата открывается в новой вкладке (так 3‑D Secure работает стабильнее во встроенных браузерах).
                  Если вкладка не открылась — нажмите кнопку:
                </p>
                <Button
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
              className="w-full"
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

