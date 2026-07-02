import { createClient } from "npm:@supabase/supabase-js@2";
import { logAnalyticsEvent } from "../_shared/analytics.ts";

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

// ─── Тариф репетитора «AI-старт» (2026-07-02, решение Vladimir) ─────────────
// Цена считается ТОЛЬКО сервером (клиенту не доверяем). Лестница с лендинга
// (src/components/sections/tutor/Pricing.tsx): первая оплата — 200₽ («первый
// месяц, любое число учеников»), дальше по числу активных учеников:
// ≤10 → 1000₽, 11–20 → 2000₽, 21+ → самообслуживание закрыто (AI-команда,
// связь через Telegram). rule 99: paid-статус репетитора живёт в profiles
// (subscription_tier/subscription_expires_at) — их выставляет yookassa-webhook.
const TUTOR_PLAN = "tutor_ai_start";
const TUTOR_INTRO_PRICE = 200; // первая оплата
const TUTOR_BAND_10_PRICE = 1000; // ≤10 активных учеников
const TUTOR_BAND_20_PRICE = 2000; // 11–20 активных учеников
const TUTOR_MAX_SELF_SERVE_STUDENTS = 20;

interface CreatePaymentRequest {
  return_url?: string;
  confirmation_type?: "embedded" | "redirect";
  /** Absent/undefined = legacy student Premium. 'tutor_ai_start' = тариф репетитора. */
  plan?: string;
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

    // Plan whitelist: absent → legacy student Premium (byte-identical path);
    // unknown value → explicit 400, НЕ тихий fallback на 699₽ (review flaw #9).
    const requestedPlan = typeof body.plan === "string" ? body.plan : null;
    if (requestedPlan !== null && requestedPlan !== TUTOR_PLAN) {
      return new Response(
        JSON.stringify({
          error: "Неизвестный тариф. Обновите страницу и попробуйте ещё раз.",
          code: "UNKNOWN_PLAN",
          error_code: "UNKNOWN_PLAN",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const isTutorPlan = requestedPlan === TUTOR_PLAN;

    // Defaults = legacy student Premium (не менять — прод-путь учеников).
    let amountRub = PREMIUM_PRICE;
    let description = `Подписка Сократ Premium на ${SUBSCRIPTION_DAYS} дней`;
    let metadata: Record<string, unknown> = {
      user_id: user.id,
      subscription_days: SUBSCRIPTION_DAYS,
    };
    let defaultReturnUrl = "https://sokratai.ru/profile?payment=success";

    // Тарифная ветка: контекст для телеметрии/ответа (hoisted из branch'а).
    let tutorRowId: string | null = null;
    let activeStudents = 0;
    let isFirstTutorPayment = false;
    // Social proof «Уже N репетиторов проверяют ДЗ с AI» (решение Vladimir,
    // round 3). Fail-open: не посчиталось → поле опускается, оплата не страдает.
    let payingTutorsCount: number | null = null;

    if (isTutorPlan) {
      // 1) NOT_A_TUTOR gate (КРИТИЧНО): без него любой ученик купил бы Premium
      //    за 200₽ через тариф репетитора (webhook пишет те же profiles-поля).
      const { data: tutorRow, error: tutorError } = await supabase
        .from("tutors")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (tutorError) {
        console.error("Tutor lookup failed:", tutorError);
        return new Response(
          JSON.stringify({
            error: "Не удалось проверить профиль репетитора. Попробуйте ещё раз.",
            code: "TUTOR_LOOKUP_FAILED",
            error_code: "TUTOR_LOOKUP_FAILED",
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (!tutorRow) {
        return new Response(
          JSON.stringify({
            error: "Тариф AI-старт доступен только репетиторам.",
            code: "NOT_A_TUTOR",
            error_code: "NOT_A_TUTOR",
          }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      tutorRowId = tutorRow.id as string;

      // 2) Активные ученики: status='active' AND archived_at IS NULL — то же
      //    определение, что на фронте (getTutorStudents + TutorHome stats).
      //    FK-дрейф (rule 40/99): tutor_students.tutor_id → tutors.id, НЕ auth uid.
      const { count: studentCount, error: countError } = await supabase
        .from("tutor_students")
        .select("id", { count: "exact", head: true })
        .eq("tutor_id", tutorRow.id)
        .eq("status", "active")
        .is("archived_at", null);
      if (countError) {
        console.error("Student count failed:", countError);
        return new Response(
          JSON.stringify({
            error: "Не удалось посчитать учеников для расчёта тарифа. Попробуйте ещё раз.",
            code: "STUDENTS_LOOKUP_FAILED",
            error_code: "STUDENTS_LOOKUP_FAILED",
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      activeStudents = studentCount ?? 0;

      // 3) 21+ учеников → самообслуживание закрыто (AI-команда, решение Vladimir).
      if (activeStudents > TUTOR_MAX_SELF_SERVE_STUDENTS) {
        return new Response(
          JSON.stringify({
            error:
              "Для 20+ учеников — тариф AI-команда. Напишите нам в Telegram, подберём условия.",
            code: "TEAM_PLAN_REQUIRED",
            error_code: "TEAM_PLAN_REQUIRED",
          }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // 4) Цена: интро 200₽ — ТОЛЬКО для действительно новых (решение Vladimir,
      //    2026-07-02). Репетиторы с вручную выданным premium (Елена/Эмилия/
      //    Вадим) платят по вилке. Три критерия (зеркало RPC
      //    tutor_intro_price_available, миграция 20260702140000 — правя одно,
      //    правь второе):
      //      а) нет успешных оплат тарифа;
      //      б) нет grant-строк в admin_tutor_plan_grants;
      //      в) нет ДЕЙСТВУЮЩЕГО premium (ловит исторические raw-SQL гранты,
      //         сделанные до появления аудит-таблицы).
      //    Fail-closed: любой сбой — 500, а не «цена наугад» (деньги).
      const priceLookupError = (err: unknown, what: string) => {
        console.error(`Intro-price lookup failed (${what}):`, err);
        return new Response(
          JSON.stringify({
            error: "Не удалось рассчитать цену тарифа. Попробуйте ещё раз.",
            code: "PRICE_LOOKUP_FAILED",
            error_code: "PRICE_LOOKUP_FAILED",
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      };

      const { count: paidCount, error: paidError } = await supabase
        .from("payments")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("plan", TUTOR_PLAN)
        .eq("status", "succeeded");
      if (paidError) return priceLookupError(paidError, "payments");

      const { count: grantCount, error: grantError } = await supabase
        .from("admin_tutor_plan_grants")
        .select("id", { count: "exact", head: true })
        .eq("target_user_id", user.id)
        .eq("action", "grant");
      if (grantError) return priceLookupError(grantError, "grants");

      const { data: profileRow, error: profileError } = await supabase
        .from("profiles")
        .select("subscription_tier, subscription_expires_at")
        .eq("id", user.id)
        .maybeSingle();
      if (profileError) return priceLookupError(profileError, "profile");
      const hasActivePremium =
        profileRow?.subscription_tier === "premium" &&
        (!profileRow.subscription_expires_at ||
          new Date(profileRow.subscription_expires_at).getTime() > Date.now());

      isFirstTutorPayment =
        (paidCount ?? 0) === 0 && (grantCount ?? 0) === 0 && !hasActivePremium;

      amountRub = isFirstTutorPayment
        ? TUTOR_INTRO_PRICE
        : activeStudents <= 10
          ? TUTOR_BAND_10_PRICE
          : TUTOR_BAND_20_PRICE;

      // Social proof: сколько репетиторов сейчас «на AI» (валидный premium ИЛИ
      // активный триал среди владельцев строк tutors). Fail-open try/catch.
      try {
        const { data: allTutors } = await supabase.from("tutors").select("user_id");
        const tutorUserIds = (allTutors ?? [])
          .map((t) => t.user_id as string)
          .filter(Boolean);
        if (tutorUserIds.length === 0) {
          payingTutorsCount = 0;
        } else {
          const nowIso = new Date().toISOString();
          const { count: premiumCount } = await supabase
            .from("profiles")
            .select("id", { count: "exact", head: true })
            .in("id", tutorUserIds)
            .eq("subscription_tier", "premium")
            .or(`subscription_expires_at.is.null,subscription_expires_at.gt.${nowIso}`);
          const { count: trialCount } = await supabase
            .from("profiles")
            .select("id", { count: "exact", head: true })
            .in("id", tutorUserIds)
            .neq("subscription_tier", "premium")
            .gt("trial_ends_at", nowIso);
          payingTutorsCount = (premiumCount ?? 0) + (trialCount ?? 0);
        }
      } catch (socialErr) {
        console.error("paying_tutors_count_failed", String(socialErr));
        payingTutorsCount = null; // fail-open — просто не показываем строку
      }
      description = `Тариф AI-старт для репетитора на ${SUBSCRIPTION_DAYS} дней`;
      // metadata.plan — информационная копия; webhook доверяет ТОЛЬКО строке
      // payments (body вебхука подделываем — rule: DB row is the trust anchor).
      metadata = {
        user_id: user.id,
        subscription_days: SUBSCRIPTION_DAYS,
        plan: TUTOR_PLAN,
      };
      defaultReturnUrl = "https://sokratai.ru/tutor/profile?payment=success";

      console.log(
        `Tutor plan payment: students=${activeStudents}, first=${isFirstTutorPayment}, amount=${amountRub}`
      );
    }

    const returnUrl = body.return_url || defaultReturnUrl;
    const confirmationType: "embedded" | "redirect" = body.confirmation_type === "redirect" ? "redirect" : "embedded";

    // Generate idempotency key for this payment attempt
    const idempotencyKey = crypto.randomUUID();

    // Create payment in YooKassa with notification_url
    const paymentData = {
      amount: {
        value: amountRub.toFixed(2),
        currency: "RUB",
      },
      confirmation: {
        type: confirmationType, // embedded = widget in DOM, redirect = open in new tab (better for webviews/3DS)
        return_url: returnUrl,
      },
      capture: true,
      description,
      metadata,
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
      amount: amountRub,
      currency: "RUB",
      status: payment.status,
      subscription_days: SUBSCRIPTION_DAYS,
      idempotency_key: idempotencyKey,
      ...(isTutorPlan ? { plan: TUTOR_PLAN } : {}),
    });

    if (dbError) {
      console.error("Failed to save payment to DB:", dbError);
      if (isTutorPlan) {
        // Money-safety (review flaw #2): без строки в payments вебхук НЕ пройдёт
        // валидацию → репетитор заплатил бы, а premium не включился бы молча.
        // Платёж в YooKassa ещё pending (не оплачен) — прервать безопасно.
        return new Response(
          JSON.stringify({
            error: "Не удалось сохранить платёж. Попробуйте ещё раз.",
            code: "PAYMENT_SAVE_FAILED",
            error_code: "PAYMENT_SAVE_FAILED",
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      // Student path: legacy behavior (log-and-continue) — намеренно не тронут.
    }

    // Телеметрия воронки (round 3): факт создания тарифного платежа.
    // Fire-and-forget (logAnalyticsEvent не бросает), PII-free.
    if (isTutorPlan) {
      await logAnalyticsEvent(supabase, {
        event_name: "tutor_payment_created",
        actor_user_id: user.id,
        tutor_id: tutorRowId,
        meta: { amount: amountRub, first: isFirstTutorPayment, students: activeStudents },
      });
    }

    return new Response(
      JSON.stringify({
        payment_id: payment.id,
        confirmation_type: payment.confirmation.type,
        confirmation_token: payment.confirmation.confirmation_token,
        confirmation_url: payment.confirmation.confirmation_url,
        status: payment.status,
        amount: amountRub,
        ...(payingTutorsCount !== null ? { paying_tutors_count: payingTutorsCount } : {}),
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
