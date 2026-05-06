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
      console.error("tutor-account auth error:", userError);
      return jsonResponse(401, { error: "Unauthorized" });
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const { data: isTutor, error: roleError } = await supabaseAdmin.rpc("is_tutor", {
      _user_id: user.id,
    });

    if (roleError) {
      console.error("tutor-account role check error:", { user_id: user.id, error: roleError });
      return jsonResponse(500, { error: "Failed to verify role" });
    }

    if (!isTutor) {
      console.warn("tutor-account forbidden: not a tutor", { user_id: user.id });
      return jsonResponse(403, { error: "Tutors only" });
    }

    const body = await req.json();
    const action = typeof body.action === "string" ? body.action : "";

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

      const { data: updatedUserData, error: updateEmailError } = await supabaseAdmin.auth.admin.updateUserById(
        user.id,
        {
          email: nextEmail,
          email_confirm: true,
        },
      );

      if (updateEmailError) {
        console.error("tutor-account update-email error:", { user_id: user.id, error: updateEmailError });
        return jsonResponse(500, { error: updateEmailError.message || "Failed to update email" });
      }

      const email = updatedUserData.user?.email ?? nextEmail;
      return jsonResponse(200, {
        email,
        has_real_email: !email.endsWith("@temp.sokratai.ru"),
      });
    }

    if (action === "update-password") {
      const nextPassword = typeof body.password === "string" ? body.password : "";

      if (nextPassword.length < 8) {
        return jsonResponse(400, { error: "Пароль должен содержать минимум 8 символов" });
      }

      const { error: updatePasswordError } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
        password: nextPassword,
      });

      if (updatePasswordError) {
        console.error("tutor-account update-password error:", { user_id: user.id, error: updatePasswordError });
        return jsonResponse(500, { error: updatePasswordError.message || "Failed to update password" });
      }

      return jsonResponse(200, { success: true });
    }

    // Google-only users (signed up via OAuth, no `email` identity yet) need a
    // separate path to set their first password. Calling `update-password` for
    // them would also work, but we want a strict guard: if the user already
    // has an email identity, surface a clearer error so the client can route
    // them to the regular «Изменить пароль» action instead of silently
    // overwriting an existing password.
    if (action === "set-password-google-only") {
      const nextPassword = typeof body.password === "string" ? body.password : "";

      if (nextPassword.length < 8) {
        return jsonResponse(400, { error: "Пароль должен содержать минимум 8 символов" });
      }

      const { data: getUserData, error: getUserError } = await supabaseAdmin.auth.admin
        .getUserById(user.id);
      if (getUserError || !getUserData?.user) {
        console.error("tutor-account set-password-google-only get-user error:", {
          user_id: user.id,
          error: getUserError,
        });
        return jsonResponse(500, { error: "Failed to verify identities" });
      }

      const identities = getUserData.user.identities ?? [];
      const hasEmailIdentity = identities.some((identity) => identity.provider === "email");
      if (hasEmailIdentity) {
        return jsonResponse(400, {
          error: "Пароль уже задан. Используй «Изменить пароль».",
          code: "PASSWORD_ALREADY_SET",
        });
      }

      const { error: setPasswordError } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
        password: nextPassword,
      });

      if (setPasswordError) {
        console.error("tutor-account set-password-google-only error:", {
          user_id: user.id,
          error: setPasswordError,
        });
        return jsonResponse(500, { error: setPasswordError.message || "Failed to set password" });
      }

      return jsonResponse(200, { success: true });
    }

    // Unlinks a Supabase auth identity (currently only `google`). Telegram is
    // a custom flow in this project and is NOT registered as a Supabase
    // identity — unlinking Telegram is out of scope here (Phase 5 spec).
    //
    // Last-identity guard (server-side mirror of the UI guard):
    //   - if removing the target leaves user with 0 Supabase identities AND
    //     no Telegram fallback (`profiles.telegram_user_id IS NULL`), reject
    //     with 400 LAST_IDENTITY so the user is never locked out.
    //   - `email` identity in Supabase exists iff a password is set, so
    //     `remaining = [email]` is always enough to log in.
    if (action === "unlink-identity") {
      const provider = typeof body.provider === "string" ? body.provider : "";
      if (provider !== "google") {
        return jsonResponse(400, { error: "Provider not supported", code: "UNSUPPORTED_PROVIDER" });
      }

      const { data: getUserData, error: getUserError } = await supabaseAdmin.auth.admin
        .getUserById(user.id);
      if (getUserError || !getUserData?.user) {
        console.error("tutor-account unlink-identity get-user error:", {
          user_id: user.id,
          error: getUserError,
        });
        return jsonResponse(500, { error: "Failed to load identities" });
      }

      const identities = getUserData.user.identities ?? [];
      const targetIdentity = identities.find((i) => i.provider === provider);
      if (!targetIdentity) {
        return jsonResponse(404, { error: "IDENTITY_NOT_FOUND" });
      }

      const remaining = identities.filter((i) => i.identity_id !== targetIdentity.identity_id);
      let hasOtherLoginMethod = remaining.length > 0;

      // If no other Supabase identity remains, check the Telegram custom-flow
      // fallback before rejecting. Telegram-linked users can still log in via
      // bot deep-link even without any Supabase identity.
      if (!hasOtherLoginMethod) {
        const { data: profileRow } = await supabaseAdmin
          .from("profiles")
          .select("telegram_user_id")
          .eq("id", user.id)
          .maybeSingle();
        hasOtherLoginMethod = Boolean(profileRow?.telegram_user_id);
      }

      if (!hasOtherLoginMethod) {
        return jsonResponse(400, {
          error: "Установи пароль или привяжи другой способ входа.",
          code: "LAST_IDENTITY",
        });
      }

      const { error: deleteError } = await supabaseAdmin.auth.admin.deleteIdentity(
        targetIdentity,
      );
      if (deleteError) {
        // Don't log targetIdentity (contains identity_id) — guardrail.
        console.error("tutor-account unlink-identity delete error:", {
          user_id: user.id,
          provider,
          error_message: deleteError.message,
        });
        return jsonResponse(500, { error: deleteError.message || "Failed to unlink identity" });
      }

      return jsonResponse(200, { success: true });
    }

    return jsonResponse(400, { error: "Unknown action" });
  } catch (error) {
    console.error("tutor-account unhandled error:", error);
    return jsonResponse(500, { error: "Internal server error" });
  }
});
