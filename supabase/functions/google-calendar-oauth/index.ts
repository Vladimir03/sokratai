import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
const GOOGLE_REDIRECT_URI = Deno.env.get("GOOGLE_REDIRECT_URI")!; // e.g. https://<project>.supabase.co/functions/v1/google-calendar-oauth

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function getUserId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;

  const supabaseUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user } } = await supabaseUser.auth.getUser();
  return user?.id || null;
}

async function getTutorId(userId: string): Promise<string | null> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data } = await supabase
    .from("tutors")
    .select("id")
    .eq("user_id", userId)
    .single();

  return data?.id || null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // Handle GET: OAuth callback from Google
  if (req.method === "GET") {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    if (error) {
      return new Response(null, {
        status: 302,
        headers: { Location: `/tutor/schedule?gcal=error&reason=${error}` },
      });
    }

    if (!code || !state) {
      return jsonResponse({ error: "Missing code or state" }, 400);
    }

    // Validate state
    const { data: stateData, error: stateError } = await supabase
      .from("tutor_google_oauth_states")
      .select("tutor_id, expires_at")
      .eq("state", state)
      .single();

    if (stateError || !stateData) {
      return new Response(null, {
        status: 302,
        headers: { Location: "/tutor/schedule?gcal=error&reason=invalid_state" },
      });
    }

    // Check expiry
    if (new Date(stateData.expires_at) < new Date()) {
      await supabase.from("tutor_google_oauth_states").delete().eq("state", state);
      return new Response(null, {
        status: 302,
        headers: { Location: "/tutor/schedule?gcal=error&reason=state_expired" },
      });
    }

    // Clean up state
    await supabase.from("tutor_google_oauth_states").delete().eq("state", state);

    // Exchange code for tokens
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: GOOGLE_REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenResponse.ok) {
      console.error("Token exchange failed:", await tokenResponse.text());
      return new Response(null, {
        status: 302,
        headers: { Location: "/tutor/schedule?gcal=error&reason=token_exchange" },
      });
    }

    const tokens = await tokenResponse.json();

    // Get user email from Google
    const userinfoResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    let googleEmail = "unknown";
    if (userinfoResponse.ok) {
      const userinfo = await userinfoResponse.json();
      googleEmail = userinfo.email || "unknown";
    }

    // Save connection (upsert by tutor_id)
    const expiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString();

    const { error: upsertError } = await supabase
      .from("tutor_google_calendar_connections")
      .upsert({
        tutor_id: stateData.tutor_id,
        google_email: googleEmail,
        calendar_id: "primary",
        refresh_token: tokens.refresh_token || null,
        access_token: tokens.access_token,
        access_token_expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      }, { onConflict: "tutor_id" });

    if (upsertError) {
      console.error("Error saving connection:", upsertError);
      return new Response(null, {
        status: 302,
        headers: { Location: "/tutor/schedule?gcal=error&reason=save_failed" },
      });
    }

    // Determine the app URL for redirect
    const appUrl = Deno.env.get("APP_URL") || "https://sokratai.ru";
    return new Response(null, {
      status: 302,
      headers: { Location: `${appUrl}/tutor/schedule?gcal=connected` },
    });
  }

  // Handle POST: authenticated actions
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const userId = await getUserId(req);
  if (!userId) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const tutorId = await getTutorId(userId);
  if (!tutorId) {
    return jsonResponse({ error: "Tutor not found" }, 404);
  }

  const body = await req.json();
  const action = body.action;

  // GET_AUTH_URL: generate OAuth URL
  if (action === "get_auth_url") {
    // Generate random state
    const stateValue = crypto.randomUUID();

    // Save state for validation
    const { error: stateError } = await supabase
      .from("tutor_google_oauth_states")
      .insert({
        state: stateValue,
        tutor_id: tutorId,
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 min
      });

    if (stateError) {
      console.error("Error saving state:", stateError);
      return jsonResponse({ error: "Failed to create auth state" }, 500);
    }

    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: GOOGLE_REDIRECT_URI,
      response_type: "code",
      scope: "https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/userinfo.email",
      access_type: "offline",
      prompt: "consent",
      state: stateValue,
    });

    return jsonResponse({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
  }

  // STATUS: check connection status
  if (action === "status") {
    const { data: connection } = await supabase
      .from("tutor_google_calendar_connections")
      .select("google_email, last_import_at")
      .eq("tutor_id", tutorId)
      .single();

    if (!connection) {
      return jsonResponse({ connected: false });
    }

    return jsonResponse({
      connected: true,
      google_email: connection.google_email,
      last_import_at: connection.last_import_at,
    });
  }

  // DISCONNECT: remove connection
  if (action === "disconnect") {
    const { error: deleteError } = await supabase
      .from("tutor_google_calendar_connections")
      .delete()
      .eq("tutor_id", tutorId);

    if (deleteError) {
      console.error("Error disconnecting:", deleteError);
      return jsonResponse({ error: "Failed to disconnect" }, 500);
    }

    return jsonResponse({ success: true });
  }

  return jsonResponse({ error: "Unknown action" }, 400);
});
