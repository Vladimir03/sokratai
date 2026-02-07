import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    // Get user token from request
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "No authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create client with user's token to verify identity
    const supabaseUser = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      auth: { persistSession: false },
      global: { headers: { Authorization: authHeader } },
    });

    // Get the authenticated user
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    
    if (userError || !user) {
      console.error("User auth error:", userError);
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse request body
    const { user_id, upgrade_existing } = await req.json();

    // Security check: user can only assign role to themselves
    if (user_id !== user.id) {
      console.error("User tried to assign role to different user:", { requested: user_id, actual: user.id });
      return new Response(
        JSON.stringify({ error: "Cannot assign role to other users" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create admin client for database operations
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(user.id);

    if (!authUser?.user) {
      return new Response(
        JSON.stringify({ error: "User not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // For new registrations (not upgrades), check if user was created recently
    if (!upgrade_existing) {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const userCreatedAt = new Date(authUser.user.created_at);
      const cutoffTime = new Date(fiveMinutesAgo);

      if (userCreatedAt < cutoffTime) {
        console.error("User account too old for tutor role assignment:", {
          userId: user.id,
          createdAt: authUser.user.created_at,
        });
        return new Response(
          JSON.stringify({ error: "Tutor role can only be assigned during registration" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Check if user already has a tutor role
    const { data: existingRole } = await supabaseAdmin
      .from("user_roles")
      .select("id")
      .eq("user_id", user.id)
      .eq("role", "tutor")
      .single();

    if (existingRole) {
      console.log("User already has tutor role:", user.id);
      return new Response(
        JSON.stringify({ success: true, message: "Role already assigned" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Assign tutor role
    const { error: insertError } = await supabaseAdmin
      .from("user_roles")
      .insert({
        user_id: user.id,
        role: "tutor",
      });

    if (insertError) {
      console.error("Error inserting tutor role:", insertError);
      return new Response(
        JSON.stringify({ error: "Failed to assign role" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Tutor role assigned successfully:", user.id);

    // Create tutor profile
    const tutorName = authUser.user.user_metadata?.username || 
                      authUser.user.email?.split('@')[0] || 
                      'Репетитор';
    const bookingLink = `tutor-${user.id.substring(0, 8)}`;

    const { error: tutorError } = await supabaseAdmin
      .from("tutors")
      .insert({
        user_id: user.id,
        name: tutorName,
        booking_link: bookingLink,
      });

    if (tutorError) {
      console.error("Error creating tutor profile:", tutorError);
      // Don't fail - role is already assigned, profile can be created later
    } else {
      console.log("Tutor profile created:", user.id);
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in assign-tutor-role:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
