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

function generateFourDigitPassword(): string {
  return Math.floor(1000 + Math.random() * 9000).toString();
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
    const action = typeof body.action === "string" ? body.action : "manual-add-student";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const telegramUsernameRaw = typeof body.telegram_username === "string" ? body.telegram_username : "";
    const emailRaw = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const learningGoalRaw = typeof body.learning_goal === "string" ? body.learning_goal : "";

    const telegramUsername = telegramUsernameRaw.trim() ? normalizeUsername(telegramUsernameRaw) : "";
    const email = emailRaw;
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

    if (action === "reset-student-password") {
      const studentId = typeof body.student_id === "string" ? body.student_id.trim() : "";

      if (!studentId) {
        return new Response(
          JSON.stringify({ error: "student_id is required" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const { data: tutorStudentLink, error: tutorStudentError } = await supabaseAdmin
        .from("tutor_students")
        .select("student_id")
        .eq("tutor_id", tutor.id)
        .eq("student_id", studentId)
        .maybeSingle();

      if (tutorStudentError) {
        console.error("Failed to verify tutor student ownership:", tutorStudentError);
        return new Response(
          JSON.stringify({ error: "Failed to verify student ownership" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      if (!tutorStudentLink) {
        return new Response(
          JSON.stringify({ error: "Student not found or access denied" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const { data: authUserData, error: authUserError } = await supabaseAdmin.auth.admin.getUserById(studentId);
      const authLoginEmail = authUserData?.user?.email ?? "";
      if (authUserError || !authLoginEmail) {
        console.error("Failed to resolve student auth user:", authUserError);
        return new Response(
          JSON.stringify({ error: "Failed to resolve student login" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const newPassword = generateFourDigitPassword();
      const { error: passwordUpdateError } = await supabaseAdmin.auth.admin.updateUserById(studentId, {
        password: newPassword,
      });

      if (passwordUpdateError) {
        console.error("Failed to reset student password:", passwordUpdateError);
        return new Response(
          JSON.stringify({ error: "Failed to reset student password" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({
          student_id: studentId,
          login_email: authLoginEmail,
          plain_password: newPassword,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!name) {
      return new Response(
        JSON.stringify({ error: "Name is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!telegramUsernameRaw.trim() && !emailRaw) {
      return new Response(
        JSON.stringify({ error: "Email or Telegram username is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (emailRaw && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) {
      return new Response(
        JSON.stringify({ error: "Invalid email format" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!learningGoal) {
      return new Response(
        JSON.stringify({ error: "Learning goal is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let studentId: string | null = null;
    let profileRegistrationSource: string | null = null;
    let existingTelegramUserId: number | null = null;
    let isNewUser = false;
    let loginEmail = "";
    let plainPassword = "";

    // Step 1: Try to find existing user by email (priority) or telegram
    if (email) {
      // Cast to any — getUserByEmail exists at runtime but not in bundled types
      const { data: authUserData, error: authUserError } =
        await (supabaseAdmin.auth.admin as any).getUserByEmail(email);

      if (!authUserError && authUserData?.user) {
        studentId = authUserData.user.id;
        loginEmail = authUserData.user.email ?? email;
        const { data: emailProfile } = await supabaseAdmin
          .from("profiles")
          .select("id, registration_source, telegram_user_id, username")
          .eq("id", authUserData.user.id)
          .maybeSingle();
        if (emailProfile) {
          profileRegistrationSource = emailProfile.registration_source ?? null;
          existingTelegramUserId = emailProfile.telegram_user_id ?? null;
        }
      }
    }

    if (!studentId && telegramUsername) {
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
        // Resolve login email from auth.users for telegram-found users
        const { data: authUserByTg } = await supabaseAdmin.auth.admin.getUserById(existingProfile.id);
        if (authUserByTg?.user?.email) {
          loginEmail = authUserByTg.user.email;
        }
      }
    }

    // Step 2: Ensure profile exists for found user (orphan recovery)
    if (studentId) {
      const { data: profileCheck } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("id", studentId)
        .maybeSingle();

      if (!profileCheck) {
        console.log("Profile missing for existing auth user, inserting:", studentId);
        const profileInsert: Record<string, unknown> = {
          id: studentId,
          username: name,
          registration_source: profileRegistrationSource ?? "manual",
          trial_ends_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        };
        if (telegramUsername) {
          profileInsert.telegram_username = telegramUsername;
        }
        await supabaseAdmin.from("profiles").insert(profileInsert);
      }
    }

    // Step 3: Create user if not found
    if (!studentId) {
      const userEmail = email || `manual_${crypto.randomUUID()}@temp.sokratai.ru`;
      const randomPassword = generateFourDigitPassword();
      isNewUser = true;
      loginEmail = userEmail;
      plainPassword = randomPassword;

      const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email: userEmail,
        email_confirm: true,
        password: randomPassword,
        user_metadata: { username: name },
      });

      if (authError || !authData.user) {
        if (authError?.message?.includes("already been registered")) {
          console.log("Auth user already exists for email:", userEmail);
          // Retrieve by exact email lookup (race: user registered between our check and create)
          const { data: raceUser } =
            await (supabaseAdmin.auth.admin as any).getUserByEmail(userEmail);
          if (raceUser?.user) {
            studentId = raceUser.user.id;
            profileRegistrationSource = "manual";
          }
        }

        if (!studentId && !authData?.user) {
          console.error("Failed to create auth user:", authError);
          return new Response(
            JSON.stringify({ error: "Failed to create student user" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      }

      if (!studentId && authData?.user) {
        studentId = authData.user.id;
      }
      profileRegistrationSource = "manual";

      // Create profile if missing
      const { data: existingProfileCheck } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("id", studentId!)
        .maybeSingle();

      if (!existingProfileCheck) {
        console.log("Profile missing for new auth user, inserting:", studentId);
        const profileInsert: Record<string, unknown> = {
          id: studentId,
          username: name,
          registration_source: "manual",
          trial_ends_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        };
        if (telegramUsername) {
          profileInsert.telegram_username = telegramUsername;
        }
        await supabaseAdmin.from("profiles").insert(profileInsert);
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
    if (telegramUsername) {
      profileUpdates.telegram_username = telegramUsername;
    }
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

      const existingResponse: Record<string, unknown> = {
        tutor_student_id: existingLink.id,
        student_id: studentId,
        created: false,
        existing: true,
        login_email: loginEmail,
      };
      return new Response(
        JSON.stringify(existingResponse),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: tutorStudent, error: insertError } = await supabaseAdmin
      .from("tutor_students")
      .insert(payload)
      .select("id")
      .single();

    if (insertError) {
      // Race: concurrent double-submit hit unique constraint (tutor_id, student_id)
      if (insertError.code === "23505") {
        const { data: raceLink } = await supabaseAdmin
          .from("tutor_students")
          .select("id")
          .eq("tutor_id", tutor.id)
          .eq("student_id", studentId)
          .single();
        if (raceLink) {
          const raceResponse: Record<string, unknown> = {
            tutor_student_id: raceLink.id,
            student_id: studentId,
            created: false,
            existing: true,
            login_email: loginEmail,
          };
          if (isNewUser && plainPassword) {
            raceResponse.plain_password = plainPassword;
          }
          return new Response(
            JSON.stringify(raceResponse),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      }
      console.error("Failed to create tutor_students:", insertError);
      return new Response(
        JSON.stringify({ error: "Failed to create tutor student" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const successResponse: Record<string, unknown> = {
      tutor_student_id: tutorStudent.id,
      student_id: studentId,
      created: true,
      login_email: loginEmail,
    };
    if (isNewUser && plainPassword) {
      successResponse.plain_password = plainPassword;
    }
    return new Response(
      JSON.stringify(successResponse),
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
