import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';

/**
 * Тариф репетитора для его СОБСТВЕННОГО кабинета (профиль + плашка на Главной).
 *
 * Single source of truth — RPC `get_subscription_status` (rule 99): та же
 * функция, что питает student-квоту в `useSubscription`. Здесь читаем только
 * план-поля (premium/trial/expiry); счётчики сообщений (`daily_limit`,
 * `messages_used`) — student-specific и для репетитора не важны.
 *
 * Деривация статуса зеркалит `useSubscription`: premium выигрывает, затем
 * активный триал, иначе free. НЕ дублировать эту логику в компонентах —
 * расширять здесь.
 *
 * Query key по tutor-конвенции (performance.md §2c): ['tutor','plan', userId].
 */

export type TutorPlanTier = 'premium' | 'trial' | 'free';

export interface TutorPlan {
  tier: TutorPlanTier;
  isPremium: boolean;
  isTrialActive: boolean;
  /** Целых дней до конца триала (0 когда триал не активен). */
  trialDaysLeft: number;
  trialEndsAt: string | null;
  /** Для premium: null = бессрочно (admin grant без даты). */
  subscriptionExpiresAt: string | null;
}

interface SubscriptionStatusRow {
  is_premium: boolean;
  subscription_expires_at: string | null;
  is_trial_active: boolean;
  trial_ends_at: string | null;
  trial_days_left: number;
}

async function fetchTutorPlan(userId: string): Promise<TutorPlan> {
  // Cast как в useSubscription.ts — auto-generated types.ts не несёт эту RPC.
  const { data, error } = await supabase
    .rpc('get_subscription_status' as never, {
      p_user_id: userId,
      p_context: 'chat',
    } as never)
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Не удалось загрузить тариф');
  }

  const row = data as SubscriptionStatusRow;
  const isPremium = Boolean(row.is_premium);
  const isTrialActive = !isPremium && Boolean(row.is_trial_active);

  return {
    tier: isPremium ? 'premium' : isTrialActive ? 'trial' : 'free',
    isPremium,
    isTrialActive,
    trialDaysLeft: isTrialActive ? row.trial_days_left || 0 : 0,
    trialEndsAt: isTrialActive ? row.trial_ends_at : null,
    subscriptionExpiresAt: isPremium ? row.subscription_expires_at : null,
  };
}

export function useTutorPlan(userId: string | null | undefined) {
  return useQuery<TutorPlan>({
    queryKey: ['tutor', 'plan', userId],
    queryFn: () => fetchTutorPlan(userId as string),
    enabled: Boolean(userId),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}

/**
 * Доступна ли текущему репетитору интро-цена 200₽ (решение Vladimir 2026-07-02:
 * только для действительно новых — без прошлых оплат, без админ-грантов и без
 * действующего premium). RPC `tutor_intro_price_available` (миграция
 * 20260702140000) — SECURITY DEFINER, т.к. admin_tutor_plan_grants закрыта RLS.
 *
 * ВАЖНО: это ТОЛЬКО отображение (какую цену показать в hint'е CTA) — реальную
 * цену всегда считает сервер в yookassa-create-payment теми же критериями.
 * `enabled` гейтить местом, где hint виден (free/trial CTA). Ошибка/загрузка →
 * undefined → нейтральный hint без обещания цены.
 */
export function useTutorIntroAvailable(enabled: boolean) {
  return useQuery<boolean>({
    queryKey: ['tutor', 'plan', 'intro-available'],
    queryFn: async () => {
      // Cast как в useSubscription/adminTutorPlansApi — generated types.ts
      // не несёт эту RPC (осознанный escape-hatch, rule 99).
      const { data, error } = await supabase.rpc('tutor_intro_price_available' as never);
      if (error) throw new Error(error.message);
      return Boolean(data);
    },
    enabled,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}
