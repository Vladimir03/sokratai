/**
 * admin-ceo-dashboard — данные для вкладки «Пульс» в /admin.
 *
 * Тонкая обёртка над _shared/ceo-pulse.ts::computePulse(): auth-паттерн
 * зеркалом admin-business-dashboard (anon-клиент getUser → service_role →
 * rpc is_admin → 403). POST с пустым body. Ошибки — rule 97 flat-shape
 * `{ error: <русская фраза>, code }`.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { computePulse } from "../_shared/ceo-pulse.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Требуется авторизация.", code: "UNAUTHORIZED" }, 401);
    }

    const supabaseClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      return jsonResponse({ error: "Требуется авторизация.", code: "UNAUTHORIZED" }, 401);
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const { data: isAdmin, error: adminError } = await supabaseAdmin.rpc("is_admin", { _user_id: user.id });
    if (adminError || !isAdmin) {
      return jsonResponse({ error: "Доступ только для администратора.", code: "FORBIDDEN" }, 403);
    }

    // Body-actions (пустой body {} = прежний computePulse — skew-совместимость).
    let body: { action?: string; tutor_user_id?: string; referral_code?: string | null } = {};
    try {
      body = await req.json();
    } catch {
      // пустой body OK
    }

    // Ретро-привязка «кто привёл» (Excel-кейс владельца, Stage 3 рефералки).
    // admin = OVERWRITE-семантика (авторитет над first-write-wins); null = снять.
    if (body.action === "set_referrer") {
      const tutorUserId = typeof body.tutor_user_id === "string" ? body.tutor_user_id : "";
      if (!tutorUserId) {
        return jsonResponse({ error: "Не указан репетитор.", code: "VALIDATION" }, 400);
      }
      if (body.referral_code == null || body.referral_code === "") {
        const { error: clearError } = await supabaseAdmin
          .from("profiles")
          .update({ referred_by_code: null, referred_at: null })
          .eq("id", tutorUserId);
        if (clearError) {
          return jsonResponse(
            { error: "Не удалось снять привязку. Попробуйте ещё раз.", code: "DB_ERROR" },
            500,
          );
        }
        const { logAnalyticsEvent } = await import("../_shared/analytics.ts");
        await logAnalyticsEvent(supabaseAdmin, {
          event_name: "referral_attributed",
          actor_user_id: tutorUserId,
          source: "admin",
          meta: { cleared: true },
        });
        return jsonResponse({ ok: true, cleared: true });
      }

      const { attributeReferral } = await import("../_shared/referral.ts");
      const result = await attributeReferral(supabaseAdmin, tutorUserId, body.referral_code, "admin");
      if (!result.ok) {
        const message =
          result.reason === "NOT_FOUND"
            ? "Код не найден."
            : result.reason === "SELF"
              ? "Нельзя привязать репетитора к его собственному коду."
              : "Не удалось привязать. Попробуйте ещё раз.";
        const status = result.reason === "NOT_FOUND" ? 404 : result.reason === "SELF" ? 409 : 500;
        return jsonResponse({ error: message, code: result.reason }, status);
      }
      return jsonResponse({ ok: true, referrer_name: result.referrerName });
    }

    const payload = await computePulse(supabaseAdmin);
    return jsonResponse(payload);
  } catch (err) {
    // Текст исключения — в лог; клиенту русская фраза с деталью (admin-only поверхность).
    console.error("admin-ceo-dashboard error:", err);
    const detail = err instanceof Error ? err.message : String(err);
    return jsonResponse(
      { error: `Не удалось собрать метрики Пульса: ${detail}`, code: "PULSE_FAILED" },
      500,
    );
  }
});
