import { Link } from 'react-router-dom';
import { Clock, Sparkles } from 'lucide-react';

import { useTutorIntroAvailable, useTutorPlan } from '@/hooks/useTutorPlan';
import { TUTOR_SUPPORT_TELEGRAM_URL } from '@/lib/tutorPlanCopy';
import { trackTutorPlanEvent, type TariffCtaSource } from '@/lib/tutorPlanTelemetry';
import { pluralizeRu } from '@/lib/pluralizeRu';

/**
 * Тонкая плашка статуса тарифа на /tutor/home (решение Vladimir 2026-07-02).
 * Визуальный собрат MonthIncomeStrip: рендерится только когда actionable —
 *   - триал, >2 дней → янтарная строка «осталось N дней» + «Подробнее» в профиль;
 *   - триал, ≤2 дней (round 3, агрессивный CTA) → «Осталось N дней — AI
 *     отключится» + кнопка «Подключить за 200 ₽» (открывает оплату прямо тут);
 *   - free → нейтральная строка «AI для ДЗ выключен» + «Подключить» (оплата;
 *     fallback без onConnect — Telegram).
 * Premium / загрузка / ошибка → null (rule 95: никаких ложных алярмов).
 *
 * Телеметрию tariff_cta_clicked баннер шлёт САМ (source по своей ветке) —
 * TutorHome НЕ дублирует событие в onConnect.
 */
export function TariffNudgeBanner({
  userId,
  onConnect,
}: {
  userId: string | null | undefined;
  onConnect?: () => void;
}) {
  const { data: plan } = useTutorPlan(userId);

  // «за 200 ₽» в кнопке — только при подтверждённом интро-праве (решение
  // Vladimir 2026-07-02: репетиторам с прошлыми оплатами/грантами 200₽ не
  // показываем). Хук вызывается безусловно (rules of hooks), фетч — только
  // когда кнопка реально видна.
  const isUrgentTrial = plan?.tier === 'trial' && plan.trialDaysLeft <= 2 && Boolean(onConnect);
  const { data: introAvailable } = useTutorIntroAvailable(isUrgentTrial);

  if (!plan || plan.tier === 'premium') return null;

  const handleConnect = (source: TariffCtaSource) => {
    trackTutorPlanEvent('tariff_cta_clicked', { source });
    onConnect?.();
  };

  if (plan.tier === 'trial') {
    const daysWord = pluralizeRu(plan.trialDaysLeft, ['день', 'дня', 'дней']);
    const isUrgent = plan.trialDaysLeft <= 2 && Boolean(onConnect);

    if (isUrgent) {
      // Цена в лейбле — только при introAvailable === true; иначе без суммы
      // (точную сумму посчитает сервер и покажет модал перед оплатой).
      return (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5">
          <p className="flex items-center gap-2 text-sm text-amber-900">
            <Clock className="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
            <span>
              Осталось{' '}
              <span className="font-semibold tabular-nums">
                {plan.trialDaysLeft} {daysWord}
              </span>{' '}
              пробного AI — потом AI-проверка ДЗ отключится
            </span>
          </p>
          <button
            type="button"
            onClick={() => handleConnect('trial_banner')}
            style={{ touchAction: 'manipulation' }}
            className="min-h-[36px] rounded-lg bg-accent px-3.5 text-sm font-semibold text-white transition-colors hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            {introAvailable === true ? 'Подключить за 200 ₽' : 'Подключить AI-старт'}
          </button>
        </div>
      );
    }

    return (
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5">
        <p className="flex items-center gap-2 text-sm text-amber-900">
          <Clock className="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
          <span>
            Пробный AI: осталось{' '}
            <span className="font-semibold tabular-nums">
              {plan.trialDaysLeft} {daysWord}
            </span>
          </span>
        </p>
        <Link
          to="/tutor/profile"
          style={{ touchAction: 'manipulation' }}
          className="text-sm font-medium text-amber-900 underline underline-offset-2 hover:text-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/50"
        >
          Подробнее
        </Link>
      </div>
    );
  }

  // free
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2.5">
      <p className="flex items-center gap-2 text-sm text-slate-600">
        <Sparkles className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
        AI для проверки ДЗ выключен на бесплатном тарифе
      </p>
      {onConnect ? (
        <button
          type="button"
          onClick={() => handleConnect('home_banner')}
          style={{ touchAction: 'manipulation' }}
          className="text-sm font-medium text-accent hover:text-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          Подключить
        </button>
      ) : (
        <a
          href={TUTOR_SUPPORT_TELEGRAM_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={{ touchAction: 'manipulation' }}
          className="text-sm font-medium text-socrat-telegram hover:text-socrat-telegram-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-socrat-telegram/40"
        >
          Подключить
        </a>
      )}
    </div>
  );
}
