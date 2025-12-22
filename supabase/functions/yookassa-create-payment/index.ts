import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Get and validate credentials
const YOOKASSA_SHOP_ID = (Deno.env.get("YOOKASSA_SHOP_ID") || "").trim();
const YOOKASSA_SECRET_KEY = (Deno.env.get("YOOKASSA_SECRET_KEY") || "").trim();
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Validate ShopID format (must be digits only)
const isValidShopId = (id: string): boolean => /^\d+$/.test(id);

// Webhook URL for payment notifications
const getWebhookUrl = () => {
  const projectId = "vrsseotrfmsxpbciyqzc";
  return `https://${projectId}.supabase.co/functions/v1/yookassa-webhook`;
};

const PREMIUM_PRICE = 699; // Price in rubles
const SUBSCRIPTION_DAYS = 30;

interface CreatePaymentRequest {
  return_url?: string;
  confirmation_type?: "embedded" | "redirect";
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

interface YooKassaError {
  type: string;
  id: string;
  code: string;
  description: string;
  parameter?: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Validate YooKassa credentials with detailed diagnostics
    console.log("Checking YooKassa credentials...");
    console.log(`YOOKASSA_SHOP_ID length: ${YOOKASSA_SHOP_ID.length}, valid format: ${isValidShopId(YOOKASSA_SHOP_ID)}`);
    console.log(`YOOKASSA_SECRET_KEY length: ${YOOKASSA_SECRET_KEY.length}`);
    
    if (!YOOKASSA_SHOP_ID || !YOOKASSA_SECRET_KEY) {
      console.error("Missing YooKassa credentials");
      return new Response(
        JSON.stringify({ 
          error: "Платёжная система не настроена",
          error_code: "CREDENTIALS_MISSING",
          details: "YOOKASSA_SHOP_ID или YOOKASSA_SECRET_KEY не установлены"
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate ShopID format
    if (!isValidShopId(YOOKASSA_SHOP_ID)) {
      console.error(`Invalid ShopID format: "${YOOKASSA_SHOP_ID}" (should contain only digits)`);
      return new Response(
        JSON.stringify({ 
          error: "Неверный формат ShopID",
          error_code: "INVALID_SHOP_ID_FORMAT",
          details: `ShopID должен содержать только цифры. Текущее значение имеет длину ${YOOKASSA_SHOP_ID.length} и содержит недопустимые символы.`
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get user from auth header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Требуется авторизация", error_code: "AUTH_REQUIRED" }),
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
        JSON.stringify({ error: "Неверный токен", error_code: "INVALID_TOKEN" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Creating payment for user:", user.id);

    // Parse request body
    const body: CreatePaymentRequest = await req.json().catch(() => ({}));
    const returnUrl = body.return_url || "https://sokratai.ru/profile?payment=success";
    const confirmationType: "embedded" | "redirect" = body.confirmation_type === "redirect" ? "redirect" : "embedded";

    // Generate idempotency key for this payment attempt
    const idempotencyKey = crypto.randomUUID();

    // Create payment in YooKassa with notification_url
    const paymentData = {
      amount: {
        value: PREMIUM_PRICE.toFixed(2),
        currency: "RUB",
      },
      confirmation: {
        type: confirmationType, // embedded = widget in DOM, redirect = open in new tab (better for webviews/3DS)
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

    console.log("Sending payment request to YooKassa...");

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

    if (!yooKassaResponse.ok) {
      console.error("YooKassa API error:", yooKassaResponse.status, responseText);
      
      // Parse error for detailed message
      let errorMessage = "Ошибка создания платежа";
      let errorCode = "YOOKASSA_ERROR";
      let errorDetails = responseText;
      
      try {
        const errorJson: YooKassaError = JSON.parse(responseText);
        errorCode = errorJson.code || errorCode;
        
        // Translate common errors
        if (errorJson.code === "invalid_credentials") {
          errorMessage = "Неверные учётные данные ЮKassa";
          errorDetails = `Ошибка авторизации: ${errorJson.description}. Проверьте ShopID и секретный ключ.`;
        } else if (errorJson.description) {
          errorMessage = errorJson.description;
        }
      } catch {}
      
      return new Response(
        JSON.stringify({ 
          error: errorMessage, 
          error_code: errorCode,
          details: errorDetails,
          http_status: yooKassaResponse.status 
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
        confirmation_type: payment.confirmation.type,
        confirmation_token: payment.confirmation.confirmation_token,
        confirmation_url: payment.confirmation.confirmation_url,
        status: payment.status,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error creating payment:", error);
    return new Response(
      JSON.stringify({ 
        error: "Внутренняя ошибка сервера", 
        error_code: "INTERNAL_ERROR",
        details: String(error) 
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
