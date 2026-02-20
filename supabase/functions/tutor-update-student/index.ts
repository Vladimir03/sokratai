import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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

    // Verify user token
    const supabaseUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      auth: { persistSession: false },
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      console.error("User auth error:", userError);
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json();
    const tutorStudentId = typeof body.tutor_student_id === "string" ? body.tutor_student_id.trim() : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const telegramUsernameRaw = typeof body.telegram_username === "string" ? body.telegram_username : "";
    const learningGoalRaw = typeof body.learning_goal === "string" ? body.learning_goal : "";

    if (!tutorStudentId) {
      return new Response(
        JSON.stringify({ error: "tutor_student_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

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

    // Get tutor by user_id
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

    // Verify tutor_student belongs to this tutor and get student_id
    const { data: tutorStudent, error: tsError } = await supabaseAdmin
      .from("tutor_students")
      .select("id, student_id")
      .eq("id", tutorStudentId)
      .eq("tutor_id", tutor.id)
      .single();

    if (tsError || !tutorStudent) {
      console.error("Tutor student not found or access denied:", tsError);
      return new Response(
        JSON.stringify({ error: "Student not found or access denied" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const studentId = tutorStudent.student_id;

    // Update profiles table (via service_role)
    const profileUpdates: Record<string, unknown> = {
      username: name,
      telegram_username: telegramUsername,
      learning_goal: learningGoal,
    };

    if (typeof body.grade === "number") {
      profileUpdates.grade = body.grade;
    }

    const { error: profileUpdateError } = await supabaseAdmin
      .from("profiles")
      .update(profileUpdates)
      .eq("id", studentId);

    if (profileUpdateError) {
      console.error("Failed to update profile:", profileUpdateError);
      return new Response(
        JSON.stringify({ error: "Failed to update profile" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Update tutor_students table
    const tutorStudentUpdates: Record<string, unknown> = {};

    if (typeof body.exam_type === "string" && body.exam_type.trim()) {
      tutorStudentUpdates.exam_type = body.exam_type.trim();
    }
    if (typeof body.subject === "string" && body.subject.trim()) {
      tutorStudentUpdates.subject = body.subject.trim();
    }
    if (typeof body.start_score === "number") {
      tutorStudentUpdates.start_score = body.start_score;
    }
    if (typeof body.target_score === "number") {
      tutorStudentUpdates.target_score = body.target_score;
    }
    if (typeof body.parent_contact === "string") {
      tutorStudentUpdates.parent_contact = body.parent_contact.trim() || null;
    }
    if (typeof body.notes === "string") {
      tutorStudentUpdates.notes = body.notes.trim() || null;
    }
    if (body.hourly_rate_cents !== undefined) {
      tutorStudentUpdates.hourly_rate_cents = typeof body.hourly_rate_cents === "number" ? body.hourly_rate_cents : null;
    }

    if (Object.keys(tutorStudentUpdates).length > 0) {
      const { error: tsUpdateError } = await supabaseAdmin
        .from("tutor_students")
        .update(tutorStudentUpdates)
        .eq("id", tutorStudentId);

      if (tsUpdateError) {
        console.error("Failed to update tutor_students:", tsUpdateError);
        // Profile was updated, but tutor_students failed - still return success
        // as the main profile data was saved
      }
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("Error in tutor-update-student:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
