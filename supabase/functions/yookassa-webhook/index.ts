import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function addOneMonth(base: Date): Date {
  const d = new Date(base.getTime());
  // JS date rules: if current day doesn't exist in the next month, it rolls over.
  d.setMonth(d.getMonth() + 1);
  return d;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const expectedToken = Deno.env.get("YOOKASSA_WEBHOOK_TOKEN");
  if (!expectedToken) return jsonResponse({ error: "Server misconfigured" }, 500);

  const auth = req.headers.get("Authorization") ?? "";
  const expectedHeader = `Bearer ${expectedToken}`;
  if (auth !== expectedHeader) return jsonResponse({ error: "Unauthorized" }, 401);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) {
      return jsonResponse({ error: "Server misconfigured (supabase)" }, 500);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const payload = await req.json().catch(() => null);
    if (!payload) return jsonResponse({ error: "Invalid JSON" }, 400);

    const event = String(payload?.event ?? "");
    const obj = payload?.object ?? null;

    const ykPaymentId = String(obj?.id ?? "");
    if (!ykPaymentId) {
      console.error("Webhook missing payment id:", payload);
      return jsonResponse({ ok: true }); // acknowledge to avoid retries
    }

    // Find payment row
    const { data: paymentRow, error: paymentErr } = await supabase
      .from("payments")
      .select("id,user_id,status,plan,amount_value,currency")
      .eq("yookassa_payment_id", ykPaymentId)
      .maybeSingle();

    if (paymentErr) {
      console.error("Failed to read payment row:", paymentErr);
      return jsonResponse({ ok: true });
    }

    // If we don't have a row yet, try to create one from metadata.
    const metadataUserId = obj?.metadata?.user_id ? String(obj.metadata.user_id) : null;
    const metadataPlan = obj?.metadata?.plan ? String(obj.metadata.plan) : null;

    let effectivePayment = paymentRow;
    if (!effectivePayment && metadataUserId && metadataPlan) {
      const amountValue = Number(obj?.amount?.value ?? 0);
      const currency = String(obj?.amount?.currency ?? "RUB");
      const initialStatus = event === "payment.succeeded" ? "succeeded" : event === "payment.canceled" ? "canceled" : "pending";

      const { data: created, error: createErr } = await supabase
        .from("payments")
        .insert({
          user_id: metadataUserId,
          plan: metadataPlan,
          amount_value: amountValue,
          currency,
          status: initialStatus,
          yookassa_payment_id: ykPaymentId,
          paid_at: initialStatus === "succeeded" ? new Date().toISOString() : null,
          raw_notification: payload,
        })
        .select("id,user_id,status,plan,amount_value,currency")
        .single();

      if (createErr) {
        console.error("Failed to create missing payment row:", createErr);
        return jsonResponse({ ok: true });
      }

      effectivePayment = created;
    }

    // Unknown payment - nothing to do
    if (!effectivePayment) {
      console.warn("Webhook for unknown payment:", ykPaymentId, "event:", event);
      return jsonResponse({ ok: true });
    }

    // Idempotency: do not re-apply succeeded payment
    if (effectivePayment.status === "succeeded") {
      return jsonResponse({ ok: true });
    }

    if (event === "payment.succeeded") {
      // Mark payment row
      const { error: updErr } = await supabase
        .from("payments")
        .update({ status: "succeeded", paid_at: new Date().toISOString(), raw_notification: payload })
        .eq("id", effectivePayment.id);

      if (updErr) console.error("Failed to update payment row:", updErr);

      // Extend subscription by 1 month from max(now, current_expiry)
      const { data: profile, error: profErr } = await supabase
        .from("profiles")
        .select("subscription_expires_at")
        .eq("id", effectivePayment.user_id)
        .single();

      if (profErr) {
        console.error("Failed to read profile:", profErr);
        return jsonResponse({ ok: true });
      }

      const now = new Date();
      const currentExpiry = profile?.subscription_expires_at ? new Date(profile.subscription_expires_at) : null;
      const base = currentExpiry && currentExpiry > now ? currentExpiry : now;
      const newExpiry = addOneMonth(base);

      const { error: profUpdErr } = await supabase
        .from("profiles")
        .update({
          subscription_tier: "premium",
          subscription_expires_at: newExpiry.toISOString(),
          trial_ends_at: null,
        })
        .eq("id", effectivePayment.user_id);

      if (profUpdErr) console.error("Failed to update profile subscription:", profUpdErr);

      return jsonResponse({ ok: true });
    }

    if (event === "payment.canceled") {
      const { error: updErr } = await supabase
        .from("payments")
        .update({ status: "canceled", raw_notification: payload })
        .eq("id", effectivePayment.id);
      if (updErr) console.error("Failed to update payment row:", updErr);
      return jsonResponse({ ok: true });
    }

    // Ignore other events but acknowledge
    return jsonResponse({ ok: true });
  } catch (error) {
    console.error("yookassa-webhook error:", error);
    return jsonResponse({ ok: true });
  }
});




