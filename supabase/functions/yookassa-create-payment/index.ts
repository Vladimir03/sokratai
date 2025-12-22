import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const YOOKASSA_SHOP_ID = Deno.env.get("YOOKASSA_SHOP_ID")!;
const YOOKASSA_SECRET_KEY = Deno.env.get("YOOKASSA_SECRET_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const PREMIUM_PRICE = 699; // Price in rubles
const SUBSCRIPTION_DAYS = 30;

interface CreatePaymentRequest {
  return_url?: string;
}

interface YooKassaPayment {
  id: string;
  status: string;
  confirmation: {
    type: string;
    confirmation_token?: string;
    confirmation_url?: string;
  };
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get user from auth header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Authorization required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    
    // Verify user token
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse request body
    const body: CreatePaymentRequest = await req.json().catch(() => ({}));
    const returnUrl = body.return_url || "https://sokratai.ru/profile?payment=success";

    // Generate idempotency key for this payment attempt
    const idempotencyKey = crypto.randomUUID();

    // Create payment in YooKassa
    const paymentData = {
      amount: {
        value: PREMIUM_PRICE.toFixed(2),
        currency: "RUB",
      },
      confirmation: {
        type: "embedded", // For widget integration
        return_url: returnUrl,
      },
      capture: true,
      description: `Подписка Сократ Premium на ${SUBSCRIPTION_DAYS} дней`,
      metadata: {
        user_id: user.id,
        subscription_days: SUBSCRIPTION_DAYS,
      },
    };

    const yooKassaResponse = await fetch("https://api.yookassa.ru/v3/payments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotence-Key": idempotencyKey,
        "Authorization": `Basic ${btoa(`${YOOKASSA_SHOP_ID}:${YOOKASSA_SECRET_KEY}`)}`,
      },
      body: JSON.stringify(paymentData),
    });

    if (!yooKassaResponse.ok) {
      const errorData = await yooKassaResponse.text();
      console.error("YooKassa API error:", errorData);
      return new Response(
        JSON.stringify({ error: "Payment creation failed", details: errorData }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const payment: YooKassaPayment = await yooKassaResponse.json();

    // Save payment to database for tracking
    const { error: dbError } = await supabase.from("payments").insert({
      id: payment.id,
      user_id: user.id,
      amount: PREMIUM_PRICE,
      currency: "RUB",
      status: payment.status,
      subscription_days: SUBSCRIPTION_DAYS,
      idempotency_key: idempotencyKey,
    });

    if (dbError) {
      console.error("Failed to save payment to DB:", dbError);
      // Don't fail the request - payment was created in YooKassa
    }

    return new Response(
      JSON.stringify({
        payment_id: payment.id,
        confirmation_token: payment.confirmation.confirmation_token,
        status: payment.status,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error creating payment:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

