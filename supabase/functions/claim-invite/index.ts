import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const jsonHeaders = {
  ...corsHeaders,
  "Content-Type": "application/json",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type ClaimInviteSuccessStatus = "linked" | "already_linked";

type ClaimInviteSuccessResponse = {
  status: ClaimInviteSuccessStatus;
  tutor_name: string;
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: jsonHeaders,
  });
}

async function updateRegistrationSourceIfNeeded(
  supabaseAdmin: any,
  userId: string,
): Promise<{ ok: true } | { ok: false; error: unknown }> {
  const { error } = await supabaseAdmin
    .from("profiles")
    .update({ registration_source: "invite_web" })
    .eq("id", userId)
    .is("registration_source", null);

  if (error) {
    return { ok: false, error };
  }

  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "No authorization header" }, 401);
    }

    const supabaseUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      console.error("claim-invite auth error:", userError);
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const body = await req.json().catch(() => null) as { invite_code?: unknown } | null;
    const inviteCode = typeof body?.invite_code === "string" ? body.invite_code.trim() : "";

    if (!inviteCode) {
      return jsonResponse({ error: "invite_code is required" }, 400);
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const { data: tutor, error: tutorError } = await supabaseAdmin
      .from("tutors")
      .select("id, user_id, name")
      .eq("invite_code", inviteCode)
      .maybeSingle();

    if (tutorError) {
      console.error("claim-invite tutor lookup error:", tutorError);
      return jsonResponse({ error: "Failed to find tutor" }, 500);
    }

    if (!tutor) {
      return jsonResponse({ error: "Invite code not found" }, 404);
    }

    if (tutor.user_id === user.id) {
      return jsonResponse({ error: "Cannot link to yourself" }, 400);
    }

    const { data: existingLink, error: existingLinkError } = await supabaseAdmin
      .from("tutor_students")
      .select("id")
      .eq("tutor_id", tutor.id)
      .eq("student_id", user.id)
      .maybeSingle();

    if (existingLinkError) {
      console.error("claim-invite existing link check error:", existingLinkError);
      return jsonResponse({ error: "Failed to check tutor link" }, 500);
    }

    let status: ClaimInviteSuccessStatus = "linked";

    if (existingLink) {
      status = "already_linked";
    } else {
      const { error: insertError } = await supabaseAdmin
        .from("tutor_students")
        .insert({
          tutor_id: tutor.id,
          student_id: user.id,
          status: "active",
        });

      if (insertError) {
        if (insertError.code === "23505") {
          status = "already_linked";
        } else {
          console.error("claim-invite insert error:", insertError);
          return jsonResponse({ error: "Failed to create tutor link" }, 500);
        }
      }
    }

    const registrationSourceUpdate = await updateRegistrationSourceIfNeeded(supabaseAdmin, user.id);
    if (!registrationSourceUpdate.ok) {
      console.error("claim-invite registration_source update error:", registrationSourceUpdate.error);
    }

    const response: ClaimInviteSuccessResponse = {
      status,
      tutor_name: tutor.name,
    };

    return jsonResponse(response, 200);
  } catch (error) {
    console.error("claim-invite unexpected error:", error);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
