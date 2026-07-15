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
