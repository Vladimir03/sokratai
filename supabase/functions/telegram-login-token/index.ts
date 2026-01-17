import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Generate a random token
function generateToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < 32; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    // POST: Create a new login/link token
    if (req.method === "POST" || action === "create") {
      let actionType = "login";
      let userId = null;
      let intendedRole = null;

      // Try to parse body for action type, user_id, and intended_role
      try {
        const body = await req.json();
        actionType = body.action || "login";
        userId = body.user_id || null;
        intendedRole = body.intended_role || null;
        console.log("Creating token with action:", actionType, "user_id:", userId, "intended_role:", intendedRole);
      } catch {
        console.log("No body or invalid JSON, defaulting to login action");
      }
      
      const token = generateToken();
      
      const { data, error } = await supabase
        .from("telegram_login_tokens")
        .insert({
          token,
          status: "pending",
          action_type: actionType,
          user_id: userId, // Store user_id for link actions
          intended_role: intendedRole, // Store intended role for tutor registration
          expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(), // 5 minutes
        })
        .select()
        .single();

      if (error) {
        console.error("Error creating token:", error);
        throw error;
      }

      console.log("Token created:", token, "action:", actionType, "intended_role:", intendedRole);
      
      return new Response(
        JSON.stringify({ token: data.token, action_type: actionType, intended_role: intendedRole }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // GET: Check token status
    if (req.method === "GET") {
      const token = url.searchParams.get("token");
      
      if (!token) {
        return new Response(
          JSON.stringify({ error: "Token is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log("Checking token:", token);

      const { data, error } = await supabase
        .from("telegram_login_tokens")
        .select("*")
        .eq("token", token)
        .single();

      if (error || !data) {
        console.log("Token not found");
        return new Response(
          JSON.stringify({ error: "Token not found", status: "invalid" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Check if expired
      if (new Date(data.expires_at) < new Date()) {
        console.log("Token expired");
        return new Response(
          JSON.stringify({ status: "expired" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // If verified, return session (for login) or success (for link)
      if (data.status === "verified") {
        console.log("Token verified, action_type:", data.action_type);
        
        // Mark as used
        await supabase
          .from("telegram_login_tokens")
          .update({ status: "used" })
          .eq("id", data.id);

        // For link action, just return success
        if (data.action_type === "link") {
          return new Response(
            JSON.stringify({ 
              status: "verified", 
              action_type: "link",
              telegram_user_id: data.telegram_user_id,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // For login action, return session with intended_role
        return new Response(
          JSON.stringify({ 
            status: "verified", 
            action_type: "login",
            session: data.session_data,
            user_id: data.user_id,
            intended_role: data.intended_role,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Still pending
      return new Response(
        JSON.stringify({ status: data.status, action_type: data.action_type }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    console.error("Error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
