-- ============================================================================
-- Интро-цена тарифа AI-старт (200₽) — ТОЛЬКО для новых (решение Vladimir,
-- 2026-07-02): репетиторы с вручную выданным premium (Елена/Эмилия/Вадим и др.)
-- при самостоятельной оплате получают вилку (1000/2000₽), а UI не должен
-- показывать им «200 ₽».
--
-- RPC для КЛИЕНТСКОГО отображения (admin_tutor_plan_grants закрыта RLS от
-- authenticated → нужен SECURITY DEFINER). Серверная цена в
-- yookassa-create-payment считается независимо теми же тремя критериями
-- (service_role, зеркало этой логики — правя одно, правь второе):
--   1) нет успешных оплат тарифа (payments.plan='tutor_ai_start', succeeded);
--   2) нет grant-строк в admin_tutor_plan_grants;
--   3) нет ДЕЙСТВУЮЩЕГО premium (защита от исторических raw-SQL грантов,
--      сделанных до появления аудит-таблицы 20260615140000).
-- ============================================================================

create or replace function public.tutor_intro_price_available()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    not exists (
      select 1 from public.payments p
      where p.user_id = auth.uid()
        and p.plan = 'tutor_ai_start'
        and p.status = 'succeeded'
    )
    and not exists (
      select 1 from public.admin_tutor_plan_grants g
      where g.target_user_id = auth.uid()
        and g.action = 'grant'
    )
    and not exists (
      select 1 from public.profiles pr
      where pr.id = auth.uid()
        and pr.subscription_tier = 'premium'
        and (pr.subscription_expires_at is null or pr.subscription_expires_at > now())
    );
$$;

comment on function public.tutor_intro_price_available() is
  'Доступна ли интро-цена 200₽ тарифа AI-старт текущему пользователю (нет оплат + нет грантов + нет действующего premium). Зеркало серверной логики yookassa-create-payment.';

revoke all on function public.tutor_intro_price_available() from public;
grant execute on function public.tutor_intro_price_available() to authenticated;
