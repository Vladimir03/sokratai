import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, DELETE, OPTIONS",
};

const jsonHeaders = {
  ...corsHeaders,
  "Content-Type": "application/json",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST" && req.method !== "DELETE") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    // --- Auth ---
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "No authorization header" }, 401);
    }

    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: userError,
    } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      console.error("push-subscribe auth error:", userError);
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // --- DELETE: remove subscription ---
    if (req.method === "DELETE") {
      const endpoint = typeof body?.endpoint === "string" ? body.endpoint.trim() : "";
      if (!endpoint) {
        return jsonResponse({ error: "endpoint is required" }, 400);
      }

      const { error: deleteError } = await supabaseAdmin
        .from("push_subscriptions")
        .delete()
        .eq("user_id", user.id)
        .eq("endpoint", endpoint);

      if (deleteError) {
        console.error("push-subscribe delete error:", deleteError);
        return jsonResponse({ error: "Failed to delete subscription" }, 500);
      }

      return jsonResponse({ ok: true }, 200);
    }

    // --- POST: upsert subscription ---
    const endpoint = typeof body?.endpoint === "string" ? body.endpoint.trim() : "";
    const keys = body?.keys as Record<string, unknown> | undefined;
    const p256dh = typeof keys?.p256dh === "string" ? keys.p256dh.trim() : "";
    const auth = typeof keys?.auth === "string" ? keys.auth.trim() : "";

    if (!isNonEmptyString(endpoint) || !isNonEmptyString(p256dh) || !isNonEmptyString(auth)) {
      return jsonResponse(
        { error: "endpoint, keys.p256dh, and keys.auth are required" },
        400,
      );
    }

    const userAgent = typeof body?.user_agent === "string" ? body.user_agent : null;
    const expiresAt = typeof body?.expires_at === "string" ? body.expires_at : null;

    const { error: upsertError } = await supabaseAdmin
      .from("push_subscriptions")
      .upsert(
        {
          user_id: user.id,
          endpoint,
          p256dh,
          auth,
          user_agent: userAgent,
          expires_at: expiresAt,
          created_at: new Date().toISOString(),
        },
        { onConflict: "user_id,endpoint" },
      );

    if (upsertError) {
      console.error("push-subscribe upsert error:", upsertError);
      return jsonResponse({ error: "Failed to save subscription" }, 500);
    }

    return jsonResponse({ ok: true }, 200);
  } catch (error) {
    console.error("push-subscribe unexpected error:", error);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
