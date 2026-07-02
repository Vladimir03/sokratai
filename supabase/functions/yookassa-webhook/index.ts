import { createClient } from "npm:@supabase/supabase-js@2";
import { logAnalyticsEvent } from "../_shared/analytics.ts";

/**
 * YooKassa webhook (verify_jwt=false — публичный endpoint).
 *
 * Модель доверия (переработана по ревью ChatGPT-5.5, P0-1, 2026-07-02):
 * YooKassa НЕ подписывает вебхуки, поэтому body — ТОЛЬКО сигнал «проверь
 * платёж», не источник истины. Источники истины:
 *   1) наша строка payments (создана yookassa-create-payment: user_id, amount,
 *      subscription_days, plan) — trust anchor;
 *   2) YooKassa API `GET /v3/payments/{id}` под shop-credentials — фактический
 *      status/paid/amount. Без подтверждения API активации НЕТ.
 * До этого поддельный POST с известными id/user/amount активировал
 * неоплаченный premium (уязвимость существовала и в студенческом флоу).
 *
 * Активация — атомарная RPC yookassa_activate_subscription (миграция
 * 20260702150000): claim платежа + расчёт expiry + UPDATE profiles + audit
 * тарифа репетитора в ОДНОЙ транзакции (P0-2: конкурентный дубль вебхука
 * больше не может продлить подписку дважды — проигравший claim не трогает
 * profiles). subscription_days RPC берёт из строки payments, НЕ из body.
 *
 * Retry-семантика: транзиентный сбой верификации/активации → 500 (YooKassa
 * ретраит с backoff до ~24ч); подделка/несовпадение → 200 без активации
 * (ретраи бесполезны, попытка залогирована).
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const YOOKASSA_SHOP_ID = (Deno.env.get("YOOKASSA_SHOP_ID") || "").trim();
const YOOKASSA_SECRET_KEY = (Deno.env.get("YOOKASSA_SECRET_KEY") || "").trim();

interface YooKassaWebhookEvent {
  type: string;
  event: string;
  object: {
    id: string;
    status: string;
    amount?: {
      value: string;
      currency: string;
    };
    metadata?: {
      user_id?: string;
      subscription_days?: number;
    };
  };
}

interface YooKassaApiPayment {
  id: string;
  status: string;
  paid: boolean;
  amount: {
    value: string;
    currency: string;
  };
}

/**
 * Фактическое состояние платежа из YooKassa API (server-to-server, Basic auth).
 * 1 ретрай на 429/5xx/network. `ok:false` = транзиентный сбой (нельзя ни
 * активировать, ни отбрасывать — вернуть 500 для ретрая вебхука).
 * `notFound:true` = YooKassa не знает такой платёж (подделка) — не ретраить.
 */
async function fetchPaymentFromYooKassa(
  paymentId: string,
): Promise<{ ok: boolean; notFound?: boolean; payment?: YooKassaApiPayment }> {
  const maxAttempts = 2;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const resp = await fetch(
        `https://api.yookassa.ru/v3/payments/${encodeURIComponent(paymentId)}`,
        {
          headers: {
            "Authorization": `Basic ${btoa(`${YOOKASSA_SHOP_ID}:${YOOKASSA_SECRET_KEY}`)}`,
          },
        },
      );
      if (resp.ok) {
        const payment = (await resp.json()) as YooKassaApiPayment;
        return { ok: true, payment };
      }
      if (resp.status === 404) {
        return { ok: true, notFound: true };
      }
      console.error(`YooKassa API verification failed: HTTP ${resp.status}`);
      if (attempt < maxAttempts - 1 && (resp.status === 429 || resp.status >= 500)) {
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      return { ok: false };
    } catch (err) {
      console.error("YooKassa API verification network error:", String(err));
      if (attempt < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      return { ok: false };
    }
  }
  return { ok: false };
}

function jsonResponse(status: number, payload: Record<string, unknown>): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  try {
    const body: YooKassaWebhookEvent = await req.json();
    console.log("Received YooKassa webhook:", JSON.stringify(body, null, 2));

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const paymentId = body.object?.id;
    if (!paymentId || typeof paymentId !== "string") {
      console.error("Webhook without payment id - ignoring");
      return jsonResponse(200, { success: false, error: "No payment id" });
    }

    // ── Trust anchor #1: наша строка payments ────────────────────────────────
    const { data: paymentRow, error: fetchError } = await supabase
      .from("payments")
      .select("id, user_id, amount, status, subscription_activated_at, plan")
      .eq("id", paymentId)
      .single();

    if (fetchError || !paymentRow) {
      console.error(`Payment ${paymentId} not found in database - possible forged webhook`);
      return jsonResponse(200, { success: false, error: "Validation failed" });
    }

    // userId — ТОЛЬКО из нашей строки. metadata из body — информационно
    // (несовпадение логируем как сигнал подделки, но решения не принимаем).
    const userId = paymentRow.user_id as string;
    if (body.object.metadata?.user_id && body.object.metadata.user_id !== userId) {
      console.error(
        `User ID mismatch: webhook=${body.object.metadata.user_id}, db=${userId} - possible forged webhook`,
      );
      return jsonResponse(200, { success: false, error: "Validation failed" });
    }

    // ── Активация — только для payment.succeeded ────────────────────────────
    if (body.event === "payment.succeeded") {
      // Идемпотентность (быстрый путь): уже активирован — выходим без API-запроса.
      if (paymentRow.subscription_activated_at) {
        console.log(`Payment ${paymentId} already processed - skipping duplicate webhook`);
        return jsonResponse(200, { success: true, message: "Already processed" });
      }

      // ── Trust anchor #2: верификация в YooKassa API (P0-1) ────────────────
      if (!YOOKASSA_SHOP_ID || !YOOKASSA_SECRET_KEY) {
        // Без credentials верифицировать нечем — fail-closed + ретрай позже.
        console.error("YooKassa credentials missing - cannot verify payment, asking for retry");
        return jsonResponse(500, { error: "Verification unavailable" });
      }

      const verification = await fetchPaymentFromYooKassa(paymentId);
      if (!verification.ok) {
        // Транзиентный сбой API — 500, YooKassa ретраит (до ~24ч).
        return jsonResponse(500, { error: "Verification unavailable" });
      }
      if (verification.notFound || !verification.payment) {
        console.error(`Payment ${paymentId} not found in YooKassa - forged webhook`);
        return jsonResponse(200, { success: false, error: "Validation failed" });
      }

      const apiPayment = verification.payment;

      // Доверяем ТОЛЬКО API: статус + факт оплаты.
      if (apiPayment.status !== "succeeded" || apiPayment.paid !== true) {
        console.error(
          `Payment ${paymentId} not actually succeeded (api status=${apiPayment.status}, paid=${apiPayment.paid}) - forged or premature webhook`,
        );
        // Не активируем и не ретраим: если платёж реально пройдёт позже,
        // YooKassa пришлёт настоящий payment.succeeded.
        return jsonResponse(200, { success: false, error: "Validation failed" });
      }

      // Сумма/валюта: API против нашей строки. Number.isFinite — NaN-байпас
      // (`NaN > 0.01` === false) закрыт (ревью, спутник P0-1).
      const apiAmount = parseFloat(apiPayment.amount?.value ?? "");
      const rowAmount = Number(paymentRow.amount);
      if (
        !Number.isFinite(apiAmount) ||
        !Number.isFinite(rowAmount) ||
        Math.abs(rowAmount - apiAmount) > 0.01 ||
        apiPayment.amount?.currency !== "RUB"
      ) {
        console.error(
          `Amount mismatch: api=${apiPayment.amount?.value} ${apiPayment.amount?.currency}, db=${paymentRow.amount} - possible forged webhook`,
        );
        return jsonResponse(200, { success: false, error: "Validation failed" });
      }

      // Статус в payments — верифицированный из API (не из body) + сырой body
      // для диагностики.
      const { error: updatePaymentError } = await supabase
        .from("payments")
        .update({
          status: apiPayment.status,
          updated_at: new Date().toISOString(),
          webhook_data: body,
        })
        .eq("id", paymentId);
      if (updatePaymentError) {
        console.error("Failed to update payment status:", updatePaymentError);
      }

      // ── Атомарная активация (P0-2): claim + profiles + audit одной
      // транзакцией. subscription_days RPC читает из строки payments.
      const { data: activation, error: activationError } = await supabase.rpc(
        "yookassa_activate_subscription",
        { p_payment_id: paymentId },
      );
      if (activationError) {
        // Активация не прошла (транзиентно) — 500, YooKassa ретраит; claim
        // не состоялся (транзакция откатилась), повтор безопасен.
        console.error("Activation RPC failed:", activationError);
        return jsonResponse(500, { error: "Activation failed" });
      }

      const result = activation as {
        claimed?: boolean;
        plan?: string | null;
        new_expires_at?: string;
        reason?: string;
      } | null;

      if (!result?.claimed) {
        // Конкурентный дубль проиграл claim или платёж уже активирован.
        console.log(
          `Payment ${paymentId} activation not claimed (${result?.reason ?? "unknown"}) - already processed`,
        );
        return jsonResponse(200, { success: true, message: "Already processed" });
      }

      // Телеметрия воронки (round 3): ровно один раз — внутри выигранного
      // claim'а. Fire-and-forget, PII-free.
      if (result.plan === "tutor_ai_start") {
        await logAnalyticsEvent(supabase, {
          event_name: "tutor_payment_succeeded",
          actor_user_id: userId,
          meta: { amount: rowAmount },
        });
      }

      console.log(
        `Subscription activated for user ${userId} until ${result.new_expires_at ?? "?"}`,
      );
      return jsonResponse(200, { success: true });
    }

    // ── Прочие события (canceled/refund): статус + лог, без активации ───────
    const { error: updatePaymentError } = await supabase
      .from("payments")
      .update({
        status: body.object.status,
        updated_at: new Date().toISOString(),
        webhook_data: body,
      })
      .eq("id", paymentId);
    if (updatePaymentError) {
      console.error("Failed to update payment status:", updatePaymentError);
    }

    if (body.event === "payment.canceled" || body.event === "refund.succeeded") {
      console.log(`Payment ${paymentId} was canceled/refunded`);
      // Note: We don't automatically revoke subscription on refund
      // This should be handled manually by admin
    }

    return jsonResponse(200, { success: true });
  } catch (error) {
    console.error("Error processing webhook:", error);
    // Parse/unexpected errors: 200 (ретраи бесполезны), инцидент в логах.
    return jsonResponse(200, { success: true, error: "Processing error logged" });
  }
});
