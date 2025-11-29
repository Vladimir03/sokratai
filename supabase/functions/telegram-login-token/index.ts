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

    // POST: Create a new login token
    if (req.method === "POST" || action === "create") {
      console.log("Creating new login token");
      
      const token = generateToken();
      
      const { data, error } = await supabase
        .from("telegram_login_tokens")
        .insert({
          token,
          status: "pending",
          expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(), // 5 minutes
        })
        .select()
        .single();

      if (error) {
        console.error("Error creating token:", error);
        throw error;
      }

      console.log("Token created:", token);
      
      return new Response(
        JSON.stringify({ token: data.token }),
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

      // If verified, return session
      if (data.status === "verified" && data.session_data) {
        console.log("Token verified, returning session");
        
        // Mark as used
        await supabase
          .from("telegram_login_tokens")
          .update({ status: "used" })
          .eq("id", data.id);

        return new Response(
          JSON.stringify({ 
            status: "verified", 
            session: data.session_data,
            user_id: data.user_id
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Still pending
      return new Response(
        JSON.stringify({ status: data.status }),
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
