/**
 * Телеметрия воронки оплаты тарифа репетитора (round 3, 2026-07-02).
 * Client-side зеркало паттерна homeworkTelemetry.ts: typed registry →
 * console.info + dataLayer (GTM) + gtag. PII-free: только категории/суммы.
 *
 * Серверные факты той же воронки пишутся в analytics_events edge-функциями
 * (tutor_payment_created в yookassa-create-payment, tutor_payment_succeeded
 * в yookassa-webhook) — это клиентский слой для GTM/Метрики.
 */

export type TariffCtaSource = 'profile_card' | 'home_banner' | 'trial_banner';

interface TariffCtaClickedPayload extends Record<string, string | number | boolean | undefined> {
  source: TariffCtaSource;
}

interface PaymentModalOpenedPayload extends Record<string, string | number | boolean | undefined> {
  source?: TariffCtaSource;
}

interface PaymentSucceededPayload extends Record<string, string | number | boolean | undefined> {
  amount?: number;
}

interface DataLayerWindow extends Window {
  dataLayer?: Array<Record<string, unknown>>;
  gtag?: (...args: unknown[]) => void;
}

export function trackTutorPlanEvent(
  event: 'tariff_cta_clicked',
  payload: TariffCtaClickedPayload,
): void;
export function trackTutorPlanEvent(
  event: 'payment_modal_opened',
  payload?: PaymentModalOpenedPayload,
): void;
export function trackTutorPlanEvent(
  event: 'payment_succeeded',
  payload?: PaymentSucceededPayload,
): void;
export function trackTutorPlanEvent(
  event: 'tariff_cta_clicked' | 'payment_modal_opened' | 'payment_succeeded',
  payload: Record<string, string | number | boolean | undefined> = {},
): void {
  try {
    const safePayload: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(payload)) {
      if (value !== undefined) safePayload[key] = value;
    }
    const timestamp = new Date().toISOString();

    console.info('tutor_plan_event', { event, timestamp, ...safePayload });

    const win = window as DataLayerWindow;
    if (Array.isArray(win.dataLayer)) {
      win.dataLayer.push({ event, timestamp, ...safePayload });
    }
    if (typeof win.gtag === 'function') {
      win.gtag('event', event, safePayload);
    }
  } catch {
    // Телеметрия никогда не ломает UX.
  }
}
