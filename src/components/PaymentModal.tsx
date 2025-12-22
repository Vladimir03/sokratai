import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabaseClient";
import { toast } from "sonner";
import { Loader2, Crown, CheckCircle, XCircle } from "lucide-react";

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
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
  const [status, setStatus] = useState<PaymentStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [confirmationToken, setConfirmationToken] = useState<string | null>(null);
  const widgetRef = useRef<{ destroy: () => void } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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
      setErrorMessage("");
      setConfirmationToken(null);
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
    setErrorMessage("");
    setConfirmationToken(null);

    try {
      // Get current session
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setErrorMessage("Необходимо войти в аккаунт");
        setStatus("error");
        return;
      }

      // Create payment via Edge Function
      const { data, error } = await supabase.functions.invoke("yookassa-create-payment", {
        body: {
          return_url: `${window.location.origin}/profile?payment=success`,
        },
      });

      if (error || !data?.confirmation_token) {
        console.error("Payment creation error:", error, data);
        setErrorMessage(data?.error || "Не удалось создать платёж");
        setStatus("error");
        return;
      }

      // Store token, then render widget after container is in DOM
      setConfirmationToken(data.confirmation_token);
      setStatus("widget");
    } catch (error) {
      console.error("Payment initialization error:", error);
      setErrorMessage("Произошла ошибка при инициализации платежа");
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
          setErrorMessage("Ошибка при оплате: " + (error.error || "Неизвестная ошибка"));
          setStatus("error");
        },
      });

      widgetRef.current = checkout.render("yookassa-widget-container");
    } catch (error) {
      console.error("Widget render error:", error);
      setErrorMessage("Не удалось загрузить форму оплаты");
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
            setErrorMessage("Контейнер для виджета не найден");
            setStatus("error");
            return;
          }
          renderWidget(confirmationToken);
        });
      } catch (e) {
        console.error("YooKassa widget load error:", e);
        setErrorMessage("Не удалось загрузить виджет оплаты");
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

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Crown className="w-5 h-5 text-amber-500" />
            Оформление подписки Premium
          </DialogTitle>
          <DialogDescription>
            Безлимитные сообщения и доступ ко всем функциям — 699₽/месяц
          </DialogDescription>
        </DialogHeader>

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

          {status === "error" && (
            <div className="flex flex-col items-center justify-center py-8 gap-4">
              <div className="p-3 bg-red-500/10 rounded-full">
                <XCircle className="w-10 h-10 text-red-500" />
              </div>
              <p className="text-center text-muted-foreground">{errorMessage}</p>
              <div className="flex gap-2">
                <Button variant="outline" onClick={handleClose}>
                  Закрыть
                </Button>
                <Button onClick={handleRetry}>
                  Попробовать снова
                </Button>
              </div>
            </div>
          )}

          {status === "success" && (
            <div className="flex flex-col items-center justify-center py-8 gap-4">
              <div className="p-3 bg-green-500/10 rounded-full">
                <CheckCircle className="w-10 h-10 text-green-500" />
              </div>
              <h3 className="text-lg font-semibold">Оплата прошла успешно!</h3>
              <p className="text-center text-muted-foreground">
                Подписка Premium активирована. Наслаждайтесь безлимитным доступом!
              </p>
              <Button onClick={() => { onSuccess?.(); handleClose(); }}>
                Отлично!
              </Button>
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
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default PaymentModal;

