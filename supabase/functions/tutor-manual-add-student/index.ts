import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function normalizeUsername(value: string): string {
  return value.trim().replace(/^@/, "").toLowerCase();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "No authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    const supabaseUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      auth: { persistSession: false },
    });

    const { data: { user }, error: userError } = await supabaseUser.auth.getUser(jwt);
    if (userError || !user) {
      console.error("User auth error:", userError);
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const telegramUsernameRaw = typeof body.telegram_username === "string" ? body.telegram_username : "";
    const learningGoalRaw = typeof body.learning_goal === "string" ? body.learning_goal : "";

    if (!name) {
      return new Response(
        JSON.stringify({ error: "Name is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!telegramUsernameRaw.trim()) {
      return new Response(
        JSON.stringify({ error: "Telegram username is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!learningGoalRaw.trim()) {
      return new Response(
        JSON.stringify({ error: "Learning goal is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const telegramUsername = normalizeUsername(telegramUsernameRaw);
    const learningGoal = learningGoalRaw.trim();

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const { data: tutor, error: tutorError } = await supabaseAdmin
      .from("tutors")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (tutorError || !tutor) {
      console.error("Tutor not found:", tutorError);
      return new Response(
        JSON.stringify({ error: "Tutor profile not found" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let studentId: string | null = null;
    let profileRegistrationSource: string | null = null;
    let existingTelegramUserId: number | null = null;

    const { data: existingProfile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id, registration_source, telegram_user_id, username")
      .ilike("telegram_username", telegramUsername)
      .limit(1)
      .maybeSingle();

    if (profileError) {
      console.error("Error checking profile:", profileError);
    }

    if (existingProfile) {
      studentId = existingProfile.id;
      profileRegistrationSource = existingProfile.registration_source ?? null;
      existingTelegramUserId = existingProfile.telegram_user_id ?? null;
    }

    if (!studentId) {
      const tempEmail = `manual_${crypto.randomUUID()}@temp.sokratai.ru`;

      const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email: tempEmail,
        email_confirm: true,
        user_metadata: { username: name },
      });

      if (authError || !authData.user) {
        // Handle email_exists: find existing auth user by telegram username
        if (authError?.message?.includes("already been registered")) {
          console.log("Auth user already exists for email:", tempEmail);
          // This shouldn't happen with random UUIDs, but handle gracefully
        }
        
        if (!authData?.user) {
          console.error("Failed to create auth user:", authError);
          return new Response(
            JSON.stringify({ error: "Failed to create student user" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      }

      studentId = authData.user.id;
      profileRegistrationSource = "manual";

      // Check if profile exists, create if missing (orphaned auth user)
      const { data: existingProfileCheck } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("id", studentId)
        .maybeSingle();

      if (!existingProfileCheck) {
        console.log("Profile missing for new auth user, inserting:", studentId);
        await supabaseAdmin
          .from("profiles")
          .insert({
            id: studentId,
            username: name,
            telegram_username: telegramUsername,
            registration_source: "manual",
            trial_ends_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          });
      }
    }

    if (!studentId) {
      return new Response(
        JSON.stringify({ error: "Student id not resolved" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const profileUpdates: Record<string, unknown> = {};
    if (profileRegistrationSource === "manual" && !existingTelegramUserId) {
      profileUpdates.username = name;
    }
    profileUpdates.telegram_username = telegramUsername;
    profileUpdates.registration_source = profileRegistrationSource ?? "manual";

    if (typeof body.grade === "number") {
      profileUpdates.grade = body.grade;
    }
    profileUpdates.learning_goal = learningGoal;

    const { error: profileUpdateError } = await supabaseAdmin
      .from("profiles")
      .update(profileUpdates)
      .eq("id", studentId);

    if (profileUpdateError) {
      console.error("Failed to update profile:", profileUpdateError);
    }

    const payload: Record<string, unknown> = {
      tutor_id: tutor.id,
      student_id: studentId,
      status: "active",
    };

    if (typeof body.exam_type === "string") payload.exam_type = body.exam_type;
    if (typeof body.subject === "string" && body.subject.trim()) payload.subject = body.subject.trim();
    if (typeof body.start_score === "number") payload.start_score = body.start_score;
    if (typeof body.target_score === "number") payload.target_score = body.target_score;
    if (typeof body.notes === "string" && body.notes.trim()) payload.notes = body.notes.trim();
    if (typeof body.parent_contact === "string" && body.parent_contact.trim()) {
      payload.parent_contact = body.parent_contact.trim();
    }
    if (body.hourly_rate_cents !== undefined) {
      payload.hourly_rate_cents = typeof body.hourly_rate_cents === "number" ? body.hourly_rate_cents : null;
    }

    const { data: existingLink, error: linkError } = await supabaseAdmin
      .from("tutor_students")
      .select("id")
      .eq("tutor_id", tutor.id)
      .eq("student_id", studentId)
      .maybeSingle();

    if (linkError) {
      console.error("Error checking tutor_students:", linkError);
    }

    if (existingLink?.id) {
      if (Object.keys(payload).length > 2) {
        const updatePayload = { ...payload };
        delete updatePayload.tutor_id;
        delete updatePayload.student_id;
        await supabaseAdmin
          .from("tutor_students")
          .update(updatePayload)
          .eq("id", existingLink.id);
      }

      return new Response(
        JSON.stringify({ tutor_student_id: existingLink.id, student_id: studentId, created: false }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: tutorStudent, error: insertError } = await supabaseAdmin
      .from("tutor_students")
      .insert(payload)
      .select("id")
      .single();

    if (insertError || !tutorStudent) {
      console.error("Failed to create tutor_students:", insertError);
      return new Response(
        JSON.stringify({ error: "Failed to create tutor student" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ tutor_student_id: tutorStudent.id, student_id: studentId, created: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Error in tutor-manual-add-student:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
