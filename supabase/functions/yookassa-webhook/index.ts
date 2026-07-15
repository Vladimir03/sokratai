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
 *
 * Ревью ChatGPT-5.6 (P1 #4, 2026-07-15) — два money-бага одной природы:
 *   1) `refund.succeeded` резолвился по `object.id`, но там ID ВОЗВРАТА
 *      (платёж — в `object.payment_id`) → возврат падал в «payment not found»,
 *      оплата навсегда оставалась succeeded, возвращённые деньги считались
 *      выручкой (MRR Пульса). Теперь: отдельная ветка, верификация возврата
 *      через `GET /v3/refunds/{id}`, payment_id берётся ИЗ API, запись —
 *      идемпотентная RPC yookassa_record_refund (миграция 20260715130000).
 *   2) Прочие события писали `status: body.object.status` ВСЛЕПУЮ. Body не
 *      подписан → поддельный `payment.canceled` переводил чужую succeeded-оплату
 *      в canceled: искажение MRR + сброс интро-цены 200₽ (yookassa-create-payment
 *      считает «первый платёж» по отсутствию succeeded-строк). Теперь статус
 *      берётся ТОЛЬКО из YooKassa API.
 * Подписка при возврате НЕ отзывается автоматически (прежнее продуктовое
 * решение) — только фиксируется факт и сумма.
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
    /** Только у refund-объектов: ID платежа, к которому относится возврат. */
    payment_id?: string;
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

interface YooKassaApiRefund {
  id: string;
  payment_id: string;
  status: string;
  amount: {
    value: string;
    currency: string;
  };
}

/**
 * Фактическое состояние ресурса из YooKassa API (server-to-server, Basic auth).
 * 1 ретрай на 429/5xx/network. `ok:false` = транзиентный сбой (нельзя ни
 * действовать, ни отбрасывать — вернуть 500 для ретрая вебхука).
 * `notFound:true` = YooKassa не знает такой ресурс (подделка) — не ретраить.
 */
async function fetchYooKassaResource<T>(
  path: string,
): Promise<{ ok: boolean; notFound?: boolean; data?: T }> {
  const maxAttempts = 2;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const resp = await fetch(`https://api.yookassa.ru/v3/${path}`, {
        headers: {
          "Authorization": `Basic ${btoa(`${YOOKASSA_SHOP_ID}:${YOOKASSA_SECRET_KEY}`)}`,
        },
      });
      if (resp.ok) {
        const data = (await resp.json()) as T;
        return { ok: true, data };
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

const fetchPaymentFromYooKassa = (paymentId: string) =>
  fetchYooKassaResource<YooKassaApiPayment>(`payments/${encodeURIComponent(paymentId)}`);

const fetchRefundFromYooKassa = (refundId: string) =>
  fetchYooKassaResource<YooKassaApiRefund>(`refunds/${encodeURIComponent(refundId)}`);

function jsonResponse(status: number, payload: Record<string, unknown>): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * `refund.succeeded` — ID возврата ≠ ID платежа (ревью P1 #4).
 *
 * Порядок доверия: body даёт ТОЛЬКО refund id → `GET /v3/refunds/{id}` даёт
 * истину (payment_id, сумма, статус) → строка `payments` ищется по
 * payment_id ИЗ API. Ни payment_id, ни сумма из body не используются —
 * иначе поддельный POST списывал бы произвольную сумму с чужой оплаты.
 *
 * Подписку НЕ отзываем (прежнее продуктовое решение — решает админ вручную);
 * фиксируем факт и сумму, MRR считает net = amount − refunded_amount.
 */
async function handleRefundSucceeded(
  supabase: ReturnType<typeof createClient>,
  body: YooKassaWebhookEvent,
): Promise<Response> {
  const refundId = body.object?.id;
  if (!refundId || typeof refundId !== "string") {
    console.error("Refund webhook without refund id - ignoring");
    return jsonResponse(200, { success: false, error: "No refund id" });
  }

  if (!YOOKASSA_SHOP_ID || !YOOKASSA_SECRET_KEY) {
    // Без credentials верифицировать нечем — fail-closed + ретрай позже.
    console.error("YooKassa credentials missing - cannot verify refund, asking for retry");
    return jsonResponse(500, { error: "Verification unavailable" });
  }

  const verification = await fetchRefundFromYooKassa(refundId);
  if (!verification.ok) {
    // Транзиентный сбой API — 500, YooKassa ретраит (до ~24ч).
    return jsonResponse(500, { error: "Verification unavailable" });
  }
  if (verification.notFound || !verification.data) {
    console.error(`Refund ${refundId} not found in YooKassa - forged webhook`);
    return jsonResponse(200, { success: false, error: "Validation failed" });
  }

  const apiRefund = verification.data;
  if (apiRefund.status === "canceled") {
    // Финальное состояние: succeeded он уже не станет. Настоящий
    // refund.succeeded для canceled-возврата YooKassa не шлёт → подделка.
    console.log(`Refund ${refundId} is canceled in API - ignoring`);
    return jsonResponse(200, { success: true, message: "Refund canceled" });
  }
  if (apiRefund.status !== "succeeded") {
    // Событие refund.succeeded ФИНАЛЬНОЕ — второго не будет. Если API ещё
    // отдаёт pending (лаг webhook↔API), ответ 200 потерял бы возврат навсегда
    // (ревью р.2 P1 #4) → 500, YooKassa ретраит до консистентности.
    console.error(
      `Refund ${refundId} not yet succeeded in API (status=${apiRefund.status}) - asking for retry`,
    );
    return jsonResponse(500, { error: "Refund state not settled" });
  }

  const paymentId = apiRefund.payment_id;
  if (!paymentId || typeof paymentId !== "string") {
    console.error(`Refund ${refundId} has no payment_id in API response - ignoring`);
    return jsonResponse(200, { success: false, error: "Validation failed" });
  }

  const amount = parseFloat(apiRefund.amount?.value ?? "");
  if (!Number.isFinite(amount) || amount <= 0 || apiRefund.amount?.currency !== "RUB") {
    console.error(
      `Refund ${refundId} has invalid amount (${apiRefund.amount?.value} ${apiRefund.amount?.currency}) - ignoring`,
    );
    return jsonResponse(200, { success: false, error: "Validation failed" });
  }

  // Идемпотентная запись + пересчёт refunded_amount одной транзакцией.
  const { data, error } = await supabase.rpc("yookassa_record_refund", {
    p_refund_id: refundId,
    p_payment_id: paymentId,
    p_amount: amount,
    p_status: apiRefund.status,
    p_webhook: body,
  });
  if (error) {
    // Транзиентный сбой записи — 500, YooKassa ретраит; RPC идемпотентна.
    console.error("Refund recording RPC failed:", error);
    return jsonResponse(500, { error: "Refund recording failed" });
  }

  const result = data as {
    recorded?: boolean;
    reason?: string;
    refunded_amount?: number;
    fully_refunded?: boolean;
  } | null;

  if (!result?.recorded) {
    // Платежа нет в нашей базе — чужой магазин или подделка. Не ретраить.
    console.error(
      `Refund ${refundId} not recorded (${result?.reason ?? "unknown"}) for payment ${paymentId}`,
    );
    return jsonResponse(200, { success: false, error: "Validation failed" });
  }

  console.log(
    `Refund ${refundId} recorded for payment ${paymentId}: refunded_total=${result.refunded_amount}, full=${result.fully_refunded}`,
  );
  return jsonResponse(200, { success: true });
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  // Битый JSON — единственный класс, где ретраи бесполезны (тело не изменится)
  // → 200. Остальные неожиданные исключения — 500 (ревью р.2 P2 #5): раньше
  // общий catch отдавал 200 и транзиентный сбой на настоящем money-событии
  // подтверждался без обработки.
  let body: YooKassaWebhookEvent;
  try {
    body = await req.json();
  } catch (parseError) {
    console.error("Webhook body parse failed:", parseError);
    return jsonResponse(200, { success: false, error: "Invalid body" });
  }

  try {
    console.log("Received YooKassa webhook:", JSON.stringify(body, null, 2));

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ── Возвраты: object.id = ID ВОЗВРАТА, а не платежа → своя ветка ДО
    // lookup'а payments (иначе поиск по refund id даёт «not found»).
    if (body.event === "refund.succeeded") {
      return await handleRefundSucceeded(supabase, body);
    }

    const paymentId = body.object?.id;
    if (!paymentId || typeof paymentId !== "string") {
      console.error("Webhook without payment id - ignoring");
      return jsonResponse(200, { success: false, error: "No payment id" });
    }

    // ── Trust anchor #1: наша строка payments ────────────────────────────────
    // maybeSingle (ревью р.2 P0 #1): error = транзиентный сбой БД/PostgREST →
    // 500 (YooKassa ретраит); data == null = строки реально нет (подделка) →
    // 200. Раньше .single() схлопывал оба случая в 200 — настоящая оплата при
    // мигнувшей БД навсегда оставалась без активации (ретраев больше нет).
    const { data: paymentRow, error: fetchError } = await supabase
      .from("payments")
      .select("id, user_id, amount, status, subscription_activated_at, plan")
      .eq("id", paymentId)
      .maybeSingle();

    if (fetchError) {
      console.error(`Payment ${paymentId} lookup failed (transient):`, fetchError);
      return jsonResponse(500, { error: "Lookup unavailable" });
    }
    if (!paymentRow) {
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
      if (verification.notFound || !verification.data) {
        console.error(`Payment ${paymentId} not found in YooKassa - forged webhook`);
        return jsonResponse(200, { success: false, error: "Validation failed" });
      }

      const apiPayment = verification.data;

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
      // для диагностики. Сбой записи → 500 ДО активации (ревью р.2 P1 #2):
      // иначе подписка активировалась бы при строке pending — платёж выпадал
      // из MRR и ошибочно возвращал интро-цену 200₽ (create-payment считает
      // «первый платёж» отсутствием succeeded-строк). Активации ещё не было —
      // ретрай YooKassa безопасно повторит всё с начала.
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
        return jsonResponse(500, { error: "Status update failed" });
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

    // ── Прочие события (payment.canceled/waiting_for_capture/…) ─────────────
    // Статус берём ТОЛЬКО из YooKassa API. Раньше писали body.object.status
    // вслепую — body не подписан, поэтому поддельный `payment.canceled` мог
    // перевести чужую succeeded-оплату в canceled: искажение MRR + сброс
    // интро-цены 200₽ (yookassa-create-payment определяет «первый платёж»
    // отсутствием succeeded-строк). Активации здесь нет по-прежнему.
    if (!YOOKASSA_SHOP_ID || !YOOKASSA_SECRET_KEY) {
      console.error("YooKassa credentials missing - cannot verify status, asking for retry");
      return jsonResponse(500, { error: "Verification unavailable" });
    }

    const statusVerification = await fetchPaymentFromYooKassa(paymentId);
    if (!statusVerification.ok) {
      return jsonResponse(500, { error: "Verification unavailable" });
    }
    if (statusVerification.notFound || !statusVerification.data) {
      console.error(`Payment ${paymentId} not found in YooKassa - forged webhook`);
      return jsonResponse(200, { success: false, error: "Validation failed" });
    }

    const verifiedStatus = statusVerification.data.status;
    const { error: updatePaymentError } = await supabase
      .from("payments")
      .update({
        status: verifiedStatus,
        updated_at: new Date().toISOString(),
        webhook_data: body,
      })
      .eq("id", paymentId);
    if (updatePaymentError) {
      // Сбой записи легитимного статуса → 500, YooKassa ретраит (ревью р.2 #2).
      console.error("Failed to update payment status:", updatePaymentError);
      return jsonResponse(500, { error: "Status update failed" });
    }

    if (verifiedStatus === "canceled") {
      console.log(`Payment ${paymentId} was canceled (verified via API)`);
      // Подписку не отзываем автоматически — решает админ вручную.
    }

    return jsonResponse(200, { success: true });
  } catch (error) {
    // Неожиданное исключение на настоящем money-событии → 500: YooKassa
    // ретраит, событие не теряется (parse-ошибки обработаны выше 200-м).
    console.error("Error processing webhook:", error);
    return jsonResponse(500, { error: "Processing failed" });
  }
});
