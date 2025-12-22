import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const YOOKASSA_SHOP_ID = Deno.env.get("YOOKASSA_SHOP_ID");
const YOOKASSA_SECRET_KEY = Deno.env.get("YOOKASSA_SECRET_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Webhook URL for payment notifications
const getWebhookUrl = () => {
  const projectId = "vrsseotrfmsxpbciyqzc";
  return `https://${projectId}.supabase.co/functions/v1/yookassa-webhook`;
};

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
    // Validate YooKassa credentials
    if (!YOOKASSA_SHOP_ID || !YOOKASSA_SECRET_KEY) {
      console.error("Missing YooKassa credentials:", { 
        hasShopId: !!YOOKASSA_SHOP_ID, 
        hasSecretKey: !!YOOKASSA_SECRET_KEY 
      });
      return new Response(
        JSON.stringify({ error: "Payment system not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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
      console.error("Auth error:", authError);
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Creating payment for user:", user.id);

    // Parse request body
    const body: CreatePaymentRequest = await req.json().catch(() => ({}));
    const returnUrl = body.return_url || "https://sokratai.ru/profile?payment=success";

    // Generate idempotency key for this payment attempt
    const idempotencyKey = crypto.randomUUID();

    // Create payment in YooKassa with notification_url
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
      notification_url: getWebhookUrl(),
    };

    console.log("Sending payment request to YooKassa:", JSON.stringify(paymentData, null, 2));

    const yooKassaResponse = await fetch("https://api.yookassa.ru/v3/payments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotence-Key": idempotencyKey,
        "Authorization": `Basic ${btoa(`${YOOKASSA_SHOP_ID}:${YOOKASSA_SECRET_KEY}`)}`,
      },
      body: JSON.stringify(paymentData),
    });

    const responseText = await yooKassaResponse.text();
    console.log("YooKassa response status:", yooKassaResponse.status);
    console.log("YooKassa response body:", responseText);

    if (!yooKassaResponse.ok) {
      console.error("YooKassa API error:", yooKassaResponse.status, responseText);
      
      // Parse error for better message
      let errorMessage = "Payment creation failed";
      try {
        const errorJson = JSON.parse(responseText);
        if (errorJson.description) {
          errorMessage = errorJson.description;
        }
      } catch {}
      
      return new Response(
        JSON.stringify({ 
          error: errorMessage, 
          details: responseText,
          status: yooKassaResponse.status 
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    const payment: YooKassaPayment = JSON.parse(responseText);

    console.log("Payment created successfully:", payment.id);

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
      JSON.stringify({ error: "Internal server error", details: String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

