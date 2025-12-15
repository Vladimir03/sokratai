import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Plan = "premium";

const PLANS: Record<Plan, { amountValue: string; description: string; currency: string }> = {
  premium: {
    amountValue: "699.00",
    currency: "RUB",
    description: "Sokratai Premium 1 month",
  },
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function safeParseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !supabaseAnonKey) {
      return jsonResponse({ error: "Server misconfigured (supabase)" }, 500);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "Missing Authorization header" }, 401);

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) return jsonResponse({ error: "Unauthorized" }, 401);
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const plan = (body?.plan ?? "premium") as Plan;
    if (!(plan in PLANS)) return jsonResponse({ error: "Invalid plan" }, 400);

    const origin = req.headers.get("origin") ?? "";
    const returnUrlStr = String(body?.return_url ?? `${origin}/pay/return`);
    const returnUrl = safeParseUrl(returnUrlStr);
    if (!returnUrl) return jsonResponse({ error: "Invalid return_url" }, 400);
    if (origin && !returnUrlStr.startsWith(origin)) {
      return jsonResponse({ error: "return_url must match request origin" }, 400);
    }
    if (returnUrl.protocol !== "https:" && returnUrl.hostname !== "localhost") {
      return jsonResponse({ error: "return_url must be https" }, 400);
    }

    const shopId = Deno.env.get("YOOKASSA_SHOP_ID");
    const secretKey = Deno.env.get("YOOKASSA_SECRET_KEY");
    if (!shopId || !secretKey) {
      return jsonResponse({ error: "Server misconfigured (yookassa)" }, 500);
    }

    const idempotenceKey = crypto.randomUUID();
    const planCfg = PLANS[plan];

    const ykRes = await fetch("https://api.yookassa.ru/v3/payments", {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${shopId}:${secretKey}`)}`,
        "Content-Type": "application/json",
        "Idempotence-Key": idempotenceKey,
      },
      body: JSON.stringify({
        amount: { value: planCfg.amountValue, currency: planCfg.currency },
        capture: true,
        confirmation: { type: "redirect", return_url: returnUrl.toString() },
        description: planCfg.description,
        metadata: { user_id: userId, plan },
      }),
    });

    const ykText = await ykRes.text();
    if (!ykRes.ok) {
      console.error("YooKassa create payment failed:", ykRes.status, ykText);
      return jsonResponse({ error: "Failed to create payment" }, 502);
    }

    const ykPayment = JSON.parse(ykText) as {
      id: string;
      status: string;
      confirmation?: { type: string; confirmation_url?: string };
    };

    const confirmationUrl = ykPayment?.confirmation?.confirmation_url;
    if (!confirmationUrl) {
      console.error("Missing confirmation_url in YooKassa response:", ykPayment);
      return jsonResponse({ error: "Invalid payment response" }, 502);
    }

    const { error: insertError } = await supabase.from("payments").insert({
      user_id: userId,
      plan,
      amount_value: Number(planCfg.amountValue),
      currency: planCfg.currency,
      status: "pending",
      yookassa_payment_id: ykPayment.id,
      idempotence_key: idempotenceKey,
    });

    if (insertError) {
      console.error("Failed to insert payment row:", insertError);
      // Payment exists in YooKassa, but we failed to persist it. Still return URL so user can pay.
    }

    return jsonResponse({ confirmation_url: confirmationUrl, yookassa_payment_id: ykPayment.id });
  } catch (error) {
    console.error("yookassa-create-payment error:", error);
    return jsonResponse({ error: "Unexpected error" }, 500);
  }
});




