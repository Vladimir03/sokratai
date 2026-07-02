import { lazy, Suspense, useState } from 'react';
import { Check, Clock, Lock, Send, Users } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useTutorIntroAvailable, useTutorPlan, type TutorPlanTier } from '@/hooks/useTutorPlan';
import { useTutorStudents } from '@/hooks/useTutor';
import { AI_FEATURES, getStudentBand, TUTOR_SUPPORT_TELEGRAM_URL } from '@/lib/tutorPlanCopy';
import { trackTutorPlanEvent } from '@/lib/tutorPlanTelemetry';
import { pluralizeRu } from '@/lib/pluralizeRu';

// Lazy: модал оплаты тяжёлый (YooKassa widget) — грузим только по клику.
const TutorPaymentModal = lazy(() => import('@/components/tutor/TutorPaymentModal'));

/**
 * Карточка «Тариф» на /tutor/profile — репетитор видит свой план (rule 99):
 *   - premium («AI-старт») — до какой даты + сколько учеников подключено
 *     и ценовой ориентир вилки с лендинга (НЕ enforced-лимит — см. tutorPlanCopy);
 *   - trial — сколько дней осталось + что будет после;
 *   - free — что доступно (расписание/оплаты) и что закрыто (AI для ДЗ).
 *
 * Оплата — самообслуживание через YooKassa (`TutorPaymentModal`, 2026-07-02);
 * цену считает сервер (200₽ первая оплата / вилка по ученикам). 21+ учеников →
 * Telegram (AI-команда). Связь с основателем — отдельная карточка
 * `TutorSupportCard` (не платёжный путь).
 */

interface TutorTariffSectionProps {
  userId: string | null | undefined;
}

const PILL_CLASS: Record<TutorPlanTier, string> = {
  premium: 'bg-emerald-100 text-emerald-900',
  trial: 'bg-amber-100 text-amber-900',
  free: 'bg-slate-100 text-slate-600',
};

const PILL_LABEL: Record<TutorPlanTier, string> = {
  premium: 'AI-старт',
  trial: 'Пробный период',
  free: 'Бесплатный',
};

/** Что остаётся бесплатным всегда (Pricing.tsx, тариф «Бесплатно»). */
const FREE_FEATURES = [
  'Расписание и напоминания',
  'Оплаты учеников и /pay в Telegram',
  'Профили учеников, группы, история',
  'Пробники и база задач',
];

function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return format(parseISO(iso), 'd MMMM yyyy', { locale: ru });
  } catch {
    return null;
  }
}

export function TutorTariffSection({ userId }: TutorTariffSectionProps) {
  const planQuery = useTutorPlan(userId);
  const plan = planQuery.data;

  // Активные ученики — для вилки цены (premium) и гейта 21+ (self-serve закрыт,
  // AI-команда → Telegram). То же определение, что в TutorHome.stats.
  const { students, loading: studentsLoading } = useTutorStudents();
  const activeCount = students.filter((s) => s.status === 'active').length;
  // Пока грузится — оптимистично показываем оплату (серверный 409 — backstop).
  const selfServeBlocked = !studentsLoading && activeCount > 20;

  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const openPayment = () => {
    trackTutorPlanEvent('tariff_cta_clicked', { source: 'profile_card' });
    setIsPaymentOpen(true);
  };

  // Интро 200₽ — только новым (без оплат/грантов/действующего premium).
  // Фетчим только когда hint виден (free/trial); undefined → нейтральный hint.
  const introQuery = useTutorIntroAvailable(
    Boolean(plan && (plan.tier === 'free' || plan.tier === 'trial')),
  );
  const introAvailable = introQuery.data;

  return (
    <section aria-label="Тариф" className="rounded-lg border border-border bg-card p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-900">Тариф</h2>
        {plan && (
          <span
            className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${PILL_CLASS[plan.tier]}`}
          >
            {PILL_LABEL[plan.tier]}
          </span>
        )}
      </div>

      {planQuery.isLoading || !userId ? (
        <TariffSkeleton />
      ) : planQuery.isError || !plan ? (
        <TariffErrorBody onRetry={() => void planQuery.refetch()} />
      ) : plan.tier === 'premium' ? (
        <PremiumBody
          expiresAt={plan.subscriptionExpiresAt}
          activeCount={activeCount}
          studentsLoading={studentsLoading}
          onRenew={openPayment}
        />
      ) : plan.tier === 'trial' ? (
        <TrialBody
          daysLeft={plan.trialDaysLeft}
          endsAt={plan.trialEndsAt}
          selfServeBlocked={selfServeBlocked}
          introAvailable={introAvailable}
          activeCount={activeCount}
          onConnect={openPayment}
        />
      ) : (
        <FreeBody
          selfServeBlocked={selfServeBlocked}
          introAvailable={introAvailable}
          activeCount={activeCount}
          onConnect={openPayment}
        />
      )}

      {isPaymentOpen && (
        <Suspense fallback={null}>
          <TutorPaymentModal isOpen={isPaymentOpen} onClose={() => setIsPaymentOpen(false)} />
        </Suspense>
      )}
    </section>
  );
}

// ─── Состояния ─────────────────────────────────────────────────────────────

interface PremiumBodyProps {
  expiresAt: string | null;
  activeCount: number;
  studentsLoading: boolean;
  onRenew: () => void;
}

function PremiumBody({ expiresAt, activeCount, studentsLoading, onRenew }: PremiumBodyProps) {
  const band = getStudentBand(activeCount);
  const expiresLabel = fmtDate(expiresAt);

  return (
    <div>
      <p className="mt-1 text-sm text-slate-500">
        AI для домашних заданий подключён
        {expiresLabel ? (
          <>
            {' '}
            и действует до <span className="font-medium text-slate-700">{expiresLabel}</span>.
          </>
        ) : (
          ' — без даты окончания.'
        )}{' '}
        Ученики получают 50 AI-сообщений в день в ДЗ.
      </p>

      {/* Подключено учеников + ценовой ориентир вилки (не лимит!) */}
      <div className="mt-4 rounded-lg bg-slate-50 px-3 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-sm text-slate-700">
            <Users className="h-4 w-4 text-slate-400" aria-hidden="true" />
            Подключено учеников
          </span>
          {studentsLoading ? (
            <Skeleton className="h-5 w-8" />
          ) : (
            <span className="text-sm font-semibold tabular-nums text-slate-900">
              {activeCount}
            </span>
          )}
        </div>
        {!studentsLoading && (
          <p className="mt-1.5 text-xs text-slate-500">
            Ваш уровень по тарифной сетке: {band.label} · {band.price}
          </p>
        )}
      </div>

      <FeatureList items={AI_FEATURES} className="mt-4" />

      <div className="mt-5">
        <Button
          type="button"
          variant="outline"
          onClick={onRenew}
          className="min-h-[44px]"
          style={{ touchAction: 'manipulation' }}
        >
          Продлить на 30 дней
        </Button>
        {!studentsLoading && activeCount <= 20 && (
          <p className="mt-2 text-xs text-slate-500">
            Продление: {band.price} — {band.label}. Новые 30 дней прибавятся к текущей дате
            окончания.
          </p>
        )}
      </div>
    </div>
  );
}

interface TrialBodyProps {
  daysLeft: number;
  endsAt: string | null;
  selfServeBlocked: boolean;
  introAvailable: boolean | undefined;
  activeCount: number;
  onConnect: () => void;
}

function TrialBody({
  daysLeft,
  endsAt,
  selfServeBlocked,
  introAvailable,
  activeCount,
  onConnect,
}: TrialBodyProps) {
  const endsLabel = fmtDate(endsAt);
  const daysWord = pluralizeRu(daysLeft, ['день', 'дня', 'дней']);

  return (
    <div>
      <p className="mt-1 text-sm text-slate-500">
        Все AI-функции открыты бесплатно на время пробного периода.
      </p>

      <div className="mt-4 flex items-center gap-2.5 rounded-lg bg-amber-50 px-3 py-2.5">
        <Clock className="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
        <p className="text-sm text-amber-900">
          Осталось{' '}
          <span className="font-semibold tabular-nums">
            {daysLeft} {daysWord}
          </span>
          {endsLabel && <span className="text-amber-800"> — до {endsLabel}</span>}
        </p>
      </div>

      <FeatureList items={AI_FEATURES} className="mt-4" />

      <p className="mt-3 text-xs text-slate-500">
        После пробного периода AI для ДЗ отключится, а расписание и оплаты останутся бесплатными.
      </p>

      <div className="mt-5">
        <PayCta
          label="Подключить AI-старт"
          selfServeBlocked={selfServeBlocked}
          introAvailable={introAvailable}
          activeCount={activeCount}
          onConnect={onConnect}
        />
      </div>
    </div>
  );
}

interface FreeBodyProps {
  selfServeBlocked: boolean;
  introAvailable: boolean | undefined;
  activeCount: number;
  onConnect: () => void;
}

function FreeBody({ selfServeBlocked, introAvailable, activeCount, onConnect }: FreeBodyProps) {
  return (
    <div>
      <p className="mt-1 text-sm text-slate-500">
        Расписание и оплаты — без ограничений. AI для домашних заданий не подключён.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Доступно</p>
          <FeatureList items={FREE_FEATURES} className="mt-2" />
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
            Откроется с AI-стартом
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {AI_FEATURES.map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm text-slate-400">
                <Lock className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-5">
        <PayCta
          label="Подключить AI для ДЗ"
          selfServeBlocked={selfServeBlocked}
          introAvailable={introAvailable}
          activeCount={activeCount}
          onConnect={onConnect}
        />
      </div>
    </div>
  );
}

// ─── Примитивы ─────────────────────────────────────────────────────────────

/**
 * Конверсионный CTA оплаты. При 21+ активных учениках самообслуживание
 * закрыто (AI-команда) → Telegram-CTA (серверный 409 TEAM_PLAN_REQUIRED —
 * backstop, эта ветка — UX-слой).
 *
 * Подсказка цены зависит от интро-права (решение Vladimir 2026-07-02):
 *   - introAvailable === true  → «200 ₽ первый месяц…» (действительно новый);
 *   - introAvailable === false → АКТУАЛЬНАЯ цена по вилке за его объём
 *     (репетиторы с админ-выданным premium — Елена/Эмилия/Вадим — 200₽ не видят);
 *   - undefined (загрузка/ошибка RPC) → нейтрально, без обещания цены.
 * Точную сумму всегда считает сервер — модал показывает её перед оплатой.
 */
function PayCta({
  label,
  selfServeBlocked,
  introAvailable,
  activeCount,
  onConnect,
}: {
  label: string;
  selfServeBlocked: boolean;
  introAvailable: boolean | undefined;
  activeCount: number;
  onConnect: () => void;
}) {
  if (selfServeBlocked) {
    return (
      <div>
        <a
          href={TUTOR_SUPPORT_TELEGRAM_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={{ touchAction: 'manipulation' }}
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-socrat-telegram px-4 text-sm font-semibold text-white transition-colors hover:bg-socrat-telegram-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-socrat-telegram/40"
        >
          <Send className="h-4 w-4" aria-hidden="true" />
          Связаться — подберём AI-команду
        </a>
        <p className="mt-2 text-xs text-slate-500">
          У вас 20+ учеников — для такого объёма есть тариф AI-команда с персональными условиями.
        </p>
      </div>
    );
  }

  const band = getStudentBand(activeCount);
  const priceHint =
    introAvailable === true
      ? '200 ₽ первый месяц, дальше — по числу учеников. Оплата картой через ЮKassa.'
      : introAvailable === false
        ? `Цена для вас: ${band.price} (${band.label}). Оплата картой через ЮKassa.`
        : 'Оплата картой через ЮKassa — точная сумма перед оплатой.';

  return (
    <div>
      <Button
        type="button"
        onClick={onConnect}
        style={{ touchAction: 'manipulation' }}
        className="min-h-[44px] bg-accent text-white hover:bg-accent/90"
      >
        {label}
      </Button>
      <p className="mt-2 text-xs text-slate-500">{priceHint}</p>
    </div>
  );
}

function FeatureList({ items, className = '' }: { items: string[]; className?: string }) {
  return (
    <ul className={`flex flex-col gap-2 ${className}`}>
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2 text-sm text-slate-700">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
          {item}
        </li>
      ))}
    </ul>
  );
}

function TariffSkeleton() {
  return (
    <div className="mt-4 flex flex-col gap-3" aria-busy="true">
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-4 w-3/5" />
      <Skeleton className="h-11 w-48" />
    </div>
  );
}

function TariffErrorBody({ onRetry }: { onRetry: () => void }) {
  // Тихая деградация (rule 95): карточка не должна алярмить и не должна
  // ломать остальной профиль — нейтральный текст + ручной повтор.
  return (
    <div className="mt-3">
      <p className="text-sm text-slate-500">Не удалось загрузить информацию о тарифе.</p>
      <button
        type="button"
        onClick={onRetry}
        style={{ touchAction: 'manipulation' }}
        className="mt-2 min-h-[36px] rounded-md text-sm font-medium text-accent hover:text-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        Обновить
      </button>
    </div>
  );
}
