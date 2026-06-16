// Phase 2b — авто-списание прошедших занятий с баланса (cron-triggered).
// План: ~/.claude/plans/1-glowing-spindle.md. SCHEDULER_SECRET-guard + service_role (mirror payment-reminder).
// Вызывается pg_cron'ом каждые ~15 мин (cron.schedule + net.http_post, провижится через Management API,
// НЕ статичной миграцией — как process-email-queue). Idempotent: повторный прогон = no-op.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Scheduler secret check (только cron, не публично).
  const authHeader = req.headers.get("Authorization");
  const expectedSecret = Deno.env.get("SCHEDULER_SECRET");
  if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // Per-tutor: отдельная транзакция на каждого тутора (review P2) → advisory-локи не копятся
    // в одной большой транзакции на всех туторов.
    const { data: tutorIds, error: idsErr } = await supabase.rpc("tutor_ids_with_due_lessons");
    if (idsErr) {
      console.error("lesson-auto-debit ids error:", idsErr.message);
      return new Response(JSON.stringify({ error: "auto_debit_failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ids = (tutorIds ?? []) as string[];
    let processed = 0;
    let errors = 0;
    for (const tutorId of ids) {
      const { data, error } = await supabase.rpc("tutor_auto_debit_due_lessons", { _tutor_id: tutorId });
      if (error) {
        errors += 1;
        console.error("lesson-auto-debit tutor error:", error.message);
        continue;
      }
      const r = (data ?? {}) as { processed?: number; errors?: number };
      processed += Number(r.processed ?? 0);
      errors += Number(r.errors ?? 0);
    }

    // PII-free лог: только счётчики.
    console.log("lesson-auto-debit ok", JSON.stringify({ tutors: ids.length, processed, errors }));
    return new Response(JSON.stringify({ success: true, tutors: ids.length, processed, errors }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("lesson-auto-debit fatal:", (e as Error)?.message);
    return new Response(JSON.stringify({ error: "internal" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
