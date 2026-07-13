import { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, CheckCircle, ChevronDown, ChevronUp, Loader2, Send, Sparkles, XCircle } from 'lucide-react';
import { toast } from 'sonner';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ConfettiBurst } from '@/components/ConfettiBurst';
import { supabase } from '@/lib/supabaseClient';
import { AI_FEATURES, TUTOR_SUPPORT_TELEGRAM_URL } from '@/lib/tutorPlanCopy';
import { trackTutorPlanEvent } from '@/lib/tutorPlanTelemetry';

/**
 * Оплата тарифа репетитора «AI-старт» через YooKassa — самообслуживание
 * (решение Vladimir 2026-07-02, вместо «напишите в Telegram»).
 *
 * Механика — зеркало студенческого `PaymentModal.tsx` (script-load виджета,
 * iframe/in-app-детект → redirect, polling get_subscription_status, fallback
 * «открыть в новом окне»), НО студенческий модал НЕ тронут (rule 10, живой
 * прод-путь денег). Отличия:
 *   - body `{ plan: 'tutor_ai_start' }` — ЦЕНУ считает сервер (200₽ первая
 *     оплата / 1000₽ ≤10 учеников / 2000₽ 11–20; 21+ → 409 TEAM_PLAN_REQUIRED);
 *   - показываем серверный `amount` в шапке;
 *   - success → invalidate ['tutor','plan'] (карточка тарифа + плашка Главной);
 *   - 409/403 → дружелюбная ветка с Telegram-CTA.
 */

interface TutorPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

interface ErrorDetails {
  message: string;
  code?: string;
  details?: string;
  httpStatus?: number;
  /** Ветка «напишите в Telegram» (TEAM_PLAN_REQUIRED / NOT_A_TUTOR). */
  telegramCta?: boolean;
}

type PaymentStatus = 'idle' | 'loading' | 'widget' | 'success' | 'error';

const TUTOR_PLAN = 'tutor_ai_start';

export function TutorPaymentModal({ isOpen, onClose, onSuccess }: TutorPaymentModalProps) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<PaymentStatus>('idle');
  const [errorDetails, setErrorDetails] = useState<ErrorDetails | null>(null);
  const [showTechDetails, setShowTechDetails] = useState(false);
  const [confirmationToken, setConfirmationToken] = useState<string | null>(null);
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  /** Промо-скидка BLINOV_20 (egor-qr-onboarding) — сервер вернул applied/percent/before. */
  const [promoApplied, setPromoApplied] = useState(false);
  const [promoPercent, setPromoPercent] = useState<number | null>(null);
  const [amountBeforePromo, setAmountBeforePromo] = useState<number | null>(null);
  /** Social proof «Уже N репетиторов проверяют ДЗ с AI» (round 3). */
  const [payingTutorsCount, setPayingTutorsCount] = useState<number | null>(null);
  /** ID созданного платежа — успех поллим по НЕМУ (payments.subscription_activated_at),
   *  а не по is_premium: у продлевающего репетитора premium уже активен, generic
   *  poll давал мгновенный ложный success без оплаты (ревью P1-3). */
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const widgetRef = useRef<{ destroy: () => void } | null>(null);

  // Маленькое N — анти-social-proof: строку показываем только от 5.
  const SOCIAL_PROOF_MIN = 5;

  const returnUrl = `${window.location.origin}/tutor/profile?payment=success`;

  const openUrlInNewTab = (url: string) => {
    try {
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      // ignore — пользователь воспользуется fallback-кнопкой
    }
  };

  const invokeCreatePayment = async (confirmationType: 'embedded' | 'redirect') => {
    return supabase.functions.invoke('yookassa-create-payment', {
      body: {
        plan: TUTOR_PLAN,
        return_url: returnUrl,
        confirmation_type: confirmationType,
      },
    });
  };

  // Промо-скидка (сервер вернул applied/percent/before). Промо-поля в ЗАПРОСЕ нет
  // — цену считает только сервер по profiles.promo_code (anti-tamper).
  const applyPromoFromData = (data: Record<string, unknown> | null | undefined) => {
    if (data?.promo_applied === true) {
      setPromoApplied(true);
      if (typeof data.promo_percent === 'number') setPromoPercent(data.promo_percent);
      if (typeof data.amount_before_promo === 'number') {
        setAmountBeforePromo(data.amount_before_promo);
      }
    }
  };

  const createRedirectPaymentAndOpen = async () => {
    const { data, error } = await invokeCreatePayment('redirect');
    if (error || !data?.confirmation_url) {
      toast.error('Не удалось открыть оплату в новом окне');
      return;
    }
    if (typeof data.amount === 'number') setAmount(data.amount);
    if (typeof data.paying_tutors_count === 'number') setPayingTutorsCount(data.paying_tutors_count);
    if (typeof data.payment_id === 'string') setPaymentId(data.payment_id);
    applyPromoFromData(data);
    setRedirectUrl(data.confirmation_url);
    openUrlInNewTab(data.confirmation_url);
  };

  // Load YooKassa widget script (общий скрипт со студенческим модалом — id совпадает)
  useEffect(() => {
    if (!isOpen) return;
    const existingScript = document.getElementById('yookassa-widget-script');
    if (existingScript) return;

    const script = document.createElement('script');
    script.id = 'yookassa-widget-script';
    script.src = 'https://yookassa.ru/checkout-widget/v1/checkout-widget.js';
    script.async = true;
    document.head.appendChild(script);
    // Скрипт намеренно не удаляется — переиспользуется.
  }, [isOpen]);

  // Initialize payment when modal opens
  useEffect(() => {
    if (!isOpen) {
      setStatus('idle');
      setErrorDetails(null);
      setShowTechDetails(false);
      setConfirmationToken(null);
      setRedirectUrl(null);
      setAmount(null);
      setPromoApplied(false);
      setPromoPercent(null);
      setAmountBeforePromo(null);
      setPayingTutorsCount(null);
      setPaymentId(null);
      return;
    }
    trackTutorPlanEvent('payment_modal_opened');
    initializePayment();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Cleanup widget on unmount
  useEffect(() => {
    return () => {
      if (widgetRef.current) {
        try {
          widgetRef.current.destroy();
        } catch {
          // already destroyed
        }
        widgetRef.current = null;
      }
    };
  }, []);

  const initializePayment = async () => {
    setStatus('loading');
    setErrorDetails(null);
    setShowTechDetails(false);
    setConfirmationToken(null);
    setRedirectUrl(null);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        setErrorDetails({ message: 'Необходимо войти в аккаунт', code: 'AUTH_REQUIRED' });
        setStatus('error');
        return;
      }

      // In-app браузеры (Telegram/Instagram) и iframe: embedded 3DS часто
      // некликабелен — предпочитаем redirect (зеркало студенческого модала).
      const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
      const isInAppBrowser =
        /Telegram/i.test(ua) || /Instagram/i.test(ua) || /FBAN|FBAV/i.test(ua) || /Line/i.test(ua);
      const isInIframe = (() => {
        try {
          return window.top !== window.self;
        } catch {
          return true;
        }
      })();
      const confirmationType: 'embedded' | 'redirect' =
        isInIframe || isInAppBrowser ? 'redirect' : 'embedded';

      const { data, error } = await invokeCreatePayment(confirmationType);

      if (typeof data?.amount === 'number') setAmount(data.amount);
      if (typeof data?.paying_tutors_count === 'number') {
        setPayingTutorsCount(data.paying_tutors_count);
      }
      if (typeof data?.payment_id === 'string') setPaymentId(data.payment_id);
      applyPromoFromData(data);

      // Redirect flow: no token, but has confirmation_url
      if (!error && data?.confirmation_url && confirmationType === 'redirect') {
        setRedirectUrl(data.confirmation_url);
        setStatus('widget');
        openUrlInNewTab(data.confirmation_url);
        return;
      }

      if (error || !data?.confirmation_token) {
        // Тело ошибки edge-функции: рус. фраза + code (rule 97). При
        // FunctionsHttpError supabase-js кладёт body в error.context.
        let body: Record<string, unknown> | null =
          data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
        if (!body && error && 'context' in error) {
          try {
            const ctx = (error as { context?: Response }).context;
            if (ctx && typeof ctx.json === 'function') {
              body = (await ctx.clone().json()) as Record<string, unknown>;
            }
          } catch {
            // ignore parse failure
          }
        }
        const code =
          (body?.code as string | undefined) ?? (body?.error_code as string | undefined);
        const message =
          (body?.error as string | undefined) ?? 'Не удалось создать платёж';
        setErrorDetails({
          message,
          code,
          details: body?.details as string | undefined,
          httpStatus: body?.http_status as number | undefined,
          telegramCta: code === 'TEAM_PLAN_REQUIRED' || code === 'NOT_A_TUTOR',
        });
        setStatus('error');
        return;
      }

      setConfirmationToken(data.confirmation_token);
      setStatus('widget');
    } catch (error) {
      console.error('Tutor payment initialization error:', error);
      setErrorDetails({
        message: 'Произошла ошибка при инициализации платежа',
        details: String(error),
      });
      setStatus('error');
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
          reject(new Error('YooKassa widget failed to load'));
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
      if (widgetRef.current) {
        try {
          widgetRef.current.destroy();
        } catch {
          // ignore
        }
      }
      const checkout = new window.YooMoneyCheckoutWidget({
        confirmation_token: token,
        return_url: returnUrl,
        error_callback: (error) => {
          console.error('YooKassa widget error:', error);
          setErrorDetails({
            message: 'Ошибка при оплате',
            details: error.error || 'Неизвестная ошибка',
          });
          setStatus('error');
        },
      });
      widgetRef.current = checkout.render('tutor-yookassa-widget-container');
    } catch (error) {
      console.error('Widget render error:', error);
      setErrorDetails({ message: 'Не удалось загрузить форму оплаты', details: String(error) });
      setStatus('error');
    }
  };

  // Render widget after container is in DOM
  useEffect(() => {
    if (!isOpen || status !== 'widget' || !confirmationToken) return;

    let cancelled = false;
    (async () => {
      try {
        await waitForYooKassaWidget();
        requestAnimationFrame(() => {
          if (cancelled) return;
          const el = document.getElementById('tutor-yookassa-widget-container');
          if (!el) {
            setErrorDetails({ message: 'Контейнер для виджета не найден' });
            setStatus('error');
            return;
          }
          renderWidget(confirmationToken);
        });
      } catch (e) {
        console.error('YooKassa widget load error:', e);
        setErrorDetails({ message: 'Не удалось загрузить виджет оплаты', details: String(e) });
        setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, status, confirmationToken]);

  // Успех поллим по СВОЕМУ платежу (payments.subscription_activated_at ставит
  // вебхук после верификации в YooKassa; RLS даёт SELECT собственных строк).
  // НЕ is_premium: у продлевающего репетитора premium уже активен → generic
  // poll показывал мгновенный ложный success без оплаты (ревью P1-3).
  // Redirect-fallback создаёт НОВЫЙ платёж → paymentId в deps перезапускает poll.
  useEffect(() => {
    if (!isOpen || status !== 'widget' || !paymentId) return;

    let cancelled = false;
    const startedAt = Date.now();

    const poll = async () => {
      try {
        const { data, error } = await supabase
          .from('payments')
          .select('subscription_activated_at')
          .eq('id', paymentId)
          .maybeSingle();
        if (cancelled || error) return;
        if (data?.subscription_activated_at) {
          setStatus('success');
          toast.success('Тариф AI-старт подключён!');
          trackTutorPlanEvent('payment_succeeded', { amount: amount ?? undefined });
          // Карточка тарифа в профиле + плашка на Главной.
          void queryClient.invalidateQueries({ queryKey: ['tutor', 'plan'] });
          onSuccess?.();
        }
      } catch {
        // ignore polling errors
      }
    };

    const interval = setInterval(() => {
      if (cancelled) return;
      poll();
      if (Date.now() - startedAt > 120000) {
        clearInterval(interval);
      }
    }, 2500);
    poll();

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, status, paymentId]);

  const handleClose = () => {
    if (widgetRef.current) {
      try {
        widgetRef.current.destroy();
      } catch {
        // ignore
      }
      widgetRef.current = null;
    }
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-accent" aria-hidden="true" />
            Подключение тарифа AI-старт
          </DialogTitle>
          <DialogDescription>
            {amount !== null ? (
              <>
                К оплате: <span className="font-semibold tabular-nums">{amount} ₽</span>
                {promoApplied && amountBeforePromo !== null ? (
                  <span className="ml-1.5 text-slate-400 line-through tabular-nums">
                    {amountBeforePromo} ₽
                  </span>
                ) : null}{' '}
                за 30 дней AI для всех учеников.
                {promoApplied ? (
                  <span className="mt-1 block font-medium text-accent">
                    −{promoPercent ?? 20}% по промокоду закреплено
                  </span>
                ) : null}
              </>
            ) : (
              'AI-проверка ДЗ и Сократ-диалог для всех ваших учеников.'
            )}
          </DialogDescription>
        </DialogHeader>

        <ConfettiBurst active={status === 'success'} />

        <div className="mt-2">
          {/* Container stays in DOM so the widget can always mount */}
          <div
            id="tutor-yookassa-widget-container"
            className={`min-h-[300px] ${status === 'widget' ? '' : 'hidden'}`}
          />

          {status === 'loading' && (
            <div className="flex flex-col items-center justify-center gap-4 py-12">
              <Loader2 className="h-10 w-10 animate-spin text-accent" aria-hidden="true" />
              <p className="text-sm text-slate-500">Подготовка платежа…</p>
            </div>
          )}

          {status === 'error' && errorDetails && (
            <div className="flex flex-col items-center justify-center gap-4 py-8">
              <div className="rounded-full bg-red-500/10 p-3">
                <XCircle className="h-10 w-10 text-red-500" aria-hidden="true" />
              </div>
              <p className="text-center text-sm text-slate-600">{errorDetails.message}</p>

              {errorDetails.telegramCta ? (
                <a
                  href={TUTOR_SUPPORT_TELEGRAM_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ touchAction: 'manipulation' }}
                  className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-socrat-telegram px-4 text-sm font-semibold text-white transition-colors hover:bg-socrat-telegram-dark"
                >
                  <Send className="h-4 w-4" aria-hidden="true" />
                  Написать в Telegram
                </a>
              ) : (
                <>
                  {(errorDetails.code || errorDetails.details || errorDetails.httpStatus) && (
                    <div className="w-full">
                      <button
                        type="button"
                        onClick={() => setShowTechDetails(!showTechDetails)}
                        className="mx-auto flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600"
                      >
                        {showTechDetails ? (
                          <ChevronUp className="h-3 w-3" aria-hidden="true" />
                        ) : (
                          <ChevronDown className="h-3 w-3" aria-hidden="true" />
                        )}
                        Технические детали
                      </button>
                      {showTechDetails && (
                        <div className="mt-2 max-h-[150px] space-y-1 overflow-y-auto rounded-md bg-muted p-3 font-mono text-xs">
                          {errorDetails.httpStatus && <div>HTTP: {errorDetails.httpStatus}</div>}
                          {errorDetails.code && <div>Код: {errorDetails.code}</div>}
                          {errorDetails.details && (
                            <div className="break-words">Детали: {errorDetails.details}</div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={handleClose}>
                      Закрыть
                    </Button>
                    <Button onClick={initializePayment}>Попробовать снова</Button>
                  </div>
                </>
              )}
            </div>
          )}

          {status === 'success' && (
            <div className="flex flex-col items-center justify-center gap-4 py-8">
              <div className="rounded-full bg-green-500/10 p-3">
                <CheckCircle className="h-10 w-10 text-green-600" aria-hidden="true" />
              </div>
              <h3 className="text-lg font-semibold text-slate-900">Тариф AI-старт подключён!</h3>
              <p className="text-center text-sm text-slate-600">
                AI-проверка ДЗ уже работает — ученики получают 50 AI-сообщений в день.
              </p>
              <Button onClick={handleClose}>Отлично</Button>
            </div>
          )}
        </div>

        {/* Benefits reminder */}
        {(status === 'loading' || status === 'widget' || status === 'idle') && (
          <div className="mt-2 rounded-lg border border-accent/20 bg-accent/5 p-4">
            <h4 className="mb-2 text-sm font-medium text-slate-900">Что входит в AI-старт:</h4>
            <ul className="space-y-1.5">
              {AI_FEATURES.map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm text-slate-600">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>

            {/* Social proof (round 3): только при N ≥ 5 — малое N отпугивает. */}
            {payingTutorsCount !== null && payingTutorsCount >= SOCIAL_PROOF_MIN && (
              <p className="mt-3 border-t border-accent/10 pt-3 text-xs text-slate-500">
                Уже <span className="font-semibold tabular-nums">{payingTutorsCount}</span>{' '}
                репетиторов проверяют ДЗ с AI
              </p>
            )}

            {redirectUrl && (
              <div className="mt-3 text-sm">
                <p className="text-slate-500">
                  Оплата открывается в новой вкладке (так 3‑D Secure работает стабильнее). Если
                  вкладка не открылась — нажмите кнопку:
                </p>
                <Button className="mt-2 w-full" onClick={() => openUrlInNewTab(redirectUrl)}>
                  Открыть оплату
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Manual fallback when embedded widget is shown (3DS can be non-clickable) */}
        {status === 'widget' && !redirectUrl && (
          <Button
            variant="outline"
            className="w-full"
            onClick={() => void createRedirectPaymentAndOpen()}
          >
            Если кнопки не нажимаются — открыть оплату в новом окне
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default TutorPaymentModal;
