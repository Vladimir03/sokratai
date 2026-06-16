import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// ⚠️ Phase 2b cutover (2026-06-15): per-lesson payment reminders are RETIRED.
// Биллинг теперь cost-driven (lesson-auto-debit списывает занятие по стоимости), а «кто должен» =
// /pay (должники по балансу) + кабинет «Оплаты». Старые кнопки «✅ Жду оплату / 💳 Уже оплачено /
// ❌ Отменён» мутировали состояние занятия/оплаты и ПОСЛЕ cutover завершали+списывали занятие БЕЗ
// создания credit'а (= потеря полученных денег в балансе), а отмена шла мимо cost-driven waive.
// Эндпоинт оставлен (чтобы существующий cron не получал 404), но это no-op. Cron можно отключить.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve((req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Scheduler secret check (сохранён — эндпоинт остаётся защищённым)
  const authHeader = req.headers.get("Authorization");
  const expectedSecret = Deno.env.get("SCHEDULER_SECRET");
  if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({ success: true, processed: 0, disabled: "superseded_by_balance_model" }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
