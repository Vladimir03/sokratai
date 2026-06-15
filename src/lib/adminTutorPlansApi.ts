import { supabase } from '@/lib/supabaseClient';

/**
 * Admin client for tutor paid-plan management (Админ-панель → «Тарифы»).
 *
 * Backed by SECURITY DEFINER RPCs (migration 20260615140000_admin_grant_tutor_plan.sql),
 * all admin-gated via public.is_admin(auth.uid()). Setting a tutor to premium is what makes
 * their students get the 50/day homework AI limit (see get_subscription_status / rule 40).
 *
 * RPC names are cast `as any` at the supabase.rpc boundary — mirrors useSubscription.ts;
 * the generated Database type doesn't carry these new functions, and hand-editing the
 * generated types.ts is riskier than a localized cast. Return shapes are typed here.
 */

export interface AdminTutorPlanRow {
  user_id: string;
  email: string | null;
  name: string;
  subscription_tier: string;
  subscription_expires_at: string | null;
  trial_ends_at: string | null;
  is_paid: boolean;
  active_students: number;
}

export interface GrantTutorPlanResult {
  user_id: string;
  email: string;
  name: string | null;
  is_tutor: boolean;
  tier: string;
  expires_at: string;
  previous_tier: string | null;
  previous_expires_at: string | null;
}

const RU_RPC_ERRORS: Record<string, string> = {
  NOT_ADMIN: 'Нет прав администратора.',
  EMAIL_REQUIRED: 'Укажите email репетитора.',
  EXPIRES_REQUIRED: 'Укажите дату «оплачено до».',
  EXPIRES_IN_PAST: 'Дата «оплачено до» должна быть в будущем.',
  USER_NOT_FOUND: 'Пользователь с таким email не найден.',
};

/** Map a Postgres RAISE error to a Russian phrase (rule 97 spirit on the client side). */
function mapRpcError(error: { message?: string } | null | undefined, fallback: string): string {
  const raw = error?.message ?? '';
  for (const code of Object.keys(RU_RPC_ERRORS)) {
    if (raw.includes(code)) return RU_RPC_ERRORS[code];
  }
  // A Cyrillic message from the server is already human-readable — surface it.
  if (/[А-Яа-яЁё]/.test(raw)) return raw;
  if (raw) console.warn('admin_tutor_plan rpc error:', raw);
  return fallback;
}

export async function listTutorPlans(): Promise<AdminTutorPlanRow[]> {
  const { data, error } = await supabase.rpc('admin_list_tutor_plans' as never);
  if (error) throw new Error(mapRpcError(error, 'Не удалось загрузить список репетиторов.'));
  return (data ?? []) as unknown as AdminTutorPlanRow[];
}

export async function grantTutorPlan(
  email: string,
  expiresAtISO: string,
  note?: string,
): Promise<GrantTutorPlanResult> {
  const { data, error } = await supabase.rpc('admin_grant_tutor_plan' as never, {
    p_email: email,
    p_expires_at: expiresAtISO,
    p_note: note ?? null,
  } as never);
  if (error) throw new Error(mapRpcError(error, 'Не удалось выдать тариф.'));
  return data as unknown as GrantTutorPlanResult;
}

export async function revokeTutorPlan(email: string, note?: string): Promise<void> {
  const { error } = await supabase.rpc('admin_revoke_tutor_plan' as never, {
    p_email: email,
    p_note: note ?? null,
  } as never);
  if (error) throw new Error(mapRpcError(error, 'Не удалось снять тариф.'));
}
