import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse(401, { error: "No authorization header" });
    }

    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    });

    const { data: { user }, error: userError } = await supabaseUser.auth.getUser(jwt);
    if (userError || !user) {
      console.error("student-account auth error:", userError);
      return jsonResponse(401, { error: "Unauthorized" });
    }

    const body = await req.json();
    const action = typeof body.action === "string" ? body.action : "";

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    if (action === "update-email") {
      const nextEmail = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      if (!nextEmail) {
        return jsonResponse(400, { error: "Email is required" });
      }

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
        return jsonResponse(400, { error: "Invalid email format" });
      }

      const currentEmail = (user.email ?? "").trim().toLowerCase();
      if (nextEmail === currentEmail) {
        return jsonResponse(200, {
          email: currentEmail,
          has_real_email: !currentEmail.endsWith("@temp.sokratai.ru"),
          unchanged: true,
        });
      }

      // Duplicate-email check removed: updateUserById will return an error if email is taken.

      const { data: updatedUserData, error: updateEmailError } = await supabaseAdmin.auth.admin.updateUserById(
        user.id,
        {
          email: nextEmail,
          email_confirm: true,
        },
      );

      if (updateEmailError) {
        console.error("student-account update-email error:", updateEmailError);
        return jsonResponse(500, { error: updateEmailError.message || "Failed to update email" });
      }

      const email = updatedUserData.user?.email ?? nextEmail;
      return jsonResponse(200, {
        email,
        has_real_email: !email.endsWith("@temp.sokratai.ru"),
      });
    }

    if (action === "update-telegram") {
      const raw = typeof body.telegram_username === "string" ? body.telegram_username.trim() : "";
      const normalized = raw.replace(/^@/, "").trim();

      if (!normalized) {
        return jsonResponse(400, { error: "Telegram username is required" });
      }

      if (!/^[a-zA-Z0-9_]{5,32}$/.test(normalized)) {
        return jsonResponse(400, { error: "Неверный формат username (5-32 символа, только латиница, цифры и _)" });
      }

      const { error: updateTgError } = await supabaseAdmin
        .from("profiles")
        .update({ telegram_username: normalized })
        .eq("id", user.id);

      if (updateTgError) {
        console.error("student-account update-telegram error:", updateTgError);
        return jsonResponse(500, { error: updateTgError.message || "Failed to update telegram username" });
      }

      return jsonResponse(200, { telegram_username: normalized });
    }

    if (action === "update-password") {
      const nextPassword = typeof body.password === "string" ? body.password : "";

      if (nextPassword.length < 6) {
        return jsonResponse(400, { error: "Пароль должен содержать минимум 6 символов" });
      }

      const { error: updatePasswordError } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
        password: nextPassword,
      });

      if (updatePasswordError) {
        console.error("student-account update-password error:", updatePasswordError);
        return jsonResponse(500, { error: updatePasswordError.message || "Failed to update password" });
      }

      return jsonResponse(200, { success: true });
    }

    return jsonResponse(400, { error: "Unknown action" });
  } catch (error) {
    console.error("student-account unhandled error:", error);
    return jsonResponse(500, { error: "Internal server error" });
  }
});
