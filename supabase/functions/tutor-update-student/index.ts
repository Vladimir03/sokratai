import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
    const tutorStudentId = typeof body.tutor_student_id === "string" ? body.tutor_student_id : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const telegramUsernameRaw = typeof body.telegram_username === "string" ? body.telegram_username : "";
    const learningGoalRaw = typeof body.learning_goal === "string" ? body.learning_goal : "";

    if (!tutorStudentId) {
      return new Response(
        JSON.stringify({ error: "Tutor student id is required" }),
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

    const { data: tutorStudent, error: tutorStudentError } = await supabaseAdmin
      .from("tutor_students")
      .select("id, student_id")
      .eq("id", tutorStudentId)
      .eq("tutor_id", tutor.id)
      .single();

    if (tutorStudentError || !tutorStudent) {
      console.error("Tutor student not found:", tutorStudentError);
      return new Response(
        JSON.stringify({ error: "Tutor student not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const profileUpdates: Record<string, unknown> = {
      username: name,
      telegram_username: telegramUsername,
      learning_goal: learningGoal,
    };

    if (typeof body.grade === "number") {
      profileUpdates.grade = body.grade;
    }

    const { error: profileError } = await supabaseAdmin
      .from("profiles")
      .update(profileUpdates)
      .eq("id", tutorStudent.student_id);

    if (profileError) {
      console.error("Error updating profile:", profileError);
      return new Response(
        JSON.stringify({ error: "Failed to update profile" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const tutorStudentUpdates: Record<string, unknown> = {};
    if (typeof body.exam_type === "string") tutorStudentUpdates.exam_type = body.exam_type;
    if (typeof body.subject === "string") tutorStudentUpdates.subject = body.subject.trim();
    if (typeof body.start_score === "number") tutorStudentUpdates.start_score = body.start_score;
    if (typeof body.target_score === "number") tutorStudentUpdates.target_score = body.target_score;
    if (typeof body.parent_contact === "string") tutorStudentUpdates.parent_contact = body.parent_contact.trim();
    if (typeof body.notes === "string") tutorStudentUpdates.notes = body.notes.trim();

    if (Object.keys(tutorStudentUpdates).length > 0) {
      const { error: tutorStudentUpdateError } = await supabaseAdmin
        .from("tutor_students")
        .update(tutorStudentUpdates)
        .eq("id", tutorStudentId);

      if (tutorStudentUpdateError) {
        console.error("Error updating tutor student:", tutorStudentUpdateError);
        return new Response(
          JSON.stringify({ error: "Failed to update tutor student" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
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
