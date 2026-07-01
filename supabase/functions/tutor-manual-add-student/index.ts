import { createClient } from "npm:@supabase/supabase-js@2";
import { logAnalyticsEventOnce } from "../_shared/analytics.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function normalizeUsername(value: string): string {
  return value.trim().replace(/^@/, "").toLowerCase();
}

function generatePassword(): string {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return (100000 + (arr[0] % 900000)).toString();
}

function tooLong(value: unknown, max: number): boolean {
  return typeof value === "string" && value.length > max;
}

/**
 * Онбординг v2 — создать плейсхолдер-ученика ТОЛЬКО по имени (контакт NULL).
 * Auth-user с temp-email (как single-add Step 3), profile, привязка tutor_students.
 * Используется bulk-экшеном; бросает Error при сбое (вызывающий ловит per-name).
 */
async function createPlaceholderByName(
  admin: ReturnType<typeof createClient>,
  tutorId: string,
  name: string,
): Promise<{ tutor_student_id: string; student_id: string }> {
  const userEmail = `manual_${crypto.randomUUID()}@temp.sokratai.ru`;
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email: userEmail,
    email_confirm: true,
    password: generatePassword(),
    user_metadata: { username: name },
  });
  if (authError || !authData?.user) {
    throw new Error(authError?.message ?? "Не удалось создать аккаунт ученика.");
  }
  const studentId = authData.user.id;

  // Профиль: создаём, если триггер ещё не успел (orphan recovery, как single-add).
  const { data: existingProfile } = await admin
    .from("profiles")
    .select("id")
    .eq("id", studentId)
    .maybeSingle();
  if (!existingProfile) {
    await admin.from("profiles").insert({
      id: studentId,
      username: name,
      registration_source: "manual",
      trial_ends_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });
  }

  const { data: ts, error: insErr } = await admin
    .from("tutor_students")
    .insert({ tutor_id: tutorId, student_id: studentId, status: "active" })
    .select("id")
    .single();
  if (insErr || !ts) {
    throw new Error(insErr?.message ?? "Не удалось привязать ученика к кабинету.");
  }
  return { tutor_student_id: ts.id, student_id: studentId };
}

function validateBodyLengths(body: Record<string, unknown>): string | null {
  if (tooLong(body.name, 200)) return "Имя слишком длинное (максимум 200 символов).";
  if (tooLong(body.telegram_username, 64)) return "Telegram username слишком длинный.";
  if (tooLong(body.email, 320)) return "Email слишком длинный.";
  if (tooLong(body.learning_goal, 1000)) return "Цель занятий слишком длинная (максимум 1000 символов).";
  if (tooLong(body.notes, 2000)) return "Заметки слишком длинные (максимум 2000 символов).";
  if (tooLong(body.parent_contact, 200)) return "Контакт родителя слишком длинный.";
  if (tooLong(body.subject, 100)) return "Название предмета слишком длинное.";
  if (tooLong(body.exam_type, 50)) return "Тип экзамена слишком длинный.";
  if (tooLong(body.student_id, 64)) return "Некорректный student_id.";
  return null;
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
    const lengthError = validateBodyLengths(body as Record<string, unknown>);
    if (lengthError) {
      return new Response(
        JSON.stringify({ code: "VALIDATION", error: lengthError }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
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

      const newPassword = generatePassword();
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

    // Онбординг v2 — массовое добавление плейсхолдеров по списку имён (контакт NULL).
    if (action === "bulk-add-students") {
      const namesRaw = Array.isArray(body.names) ? body.names : [];
      const names = namesRaw
        .map((n: unknown) => (typeof n === "string" ? n.trim() : ""))
        .filter((n: string) => n.length > 0);
      if (names.length === 0) {
        return new Response(
          JSON.stringify({ code: "VALIDATION", error: "Добавьте хотя бы одно имя." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (names.length > 50) {
        return new Response(
          JSON.stringify({ code: "VALIDATION", error: "За раз можно добавить не больше 50 имён." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const created: Array<{ tutor_student_id: string; student_id: string; name: string }> = [];
      const errors: Array<{ name: string; error: string }> = [];
      for (const nm of names) {
        // Слишком длинное имя — в errors, а не молча дропаем (review P2).
        if (nm.length > 200) {
          errors.push({ name: nm.slice(0, 60), error: "Имя слишком длинное (максимум 200 символов)." });
          continue;
        }
        try {
          const r = await createPlaceholderByName(supabaseAdmin, tutor.id, nm);
          created.push({ ...r, name: nm });
        } catch (e) {
          errors.push({ name: nm, error: e instanceof Error ? e.message : String(e) });
        }
      }

      if (created.length > 0) {
        await logAnalyticsEventOnce(
          supabaseAdmin,
          {
            event_name: "tutor_first_student_added",
            tutor_id: tutor.id,
            actor_user_id: user.id,
            source: "bulk",
            meta: { count: created.length },
          },
          { tutor_id: tutor.id },
        );
      }

      return new Response(
        JSON.stringify({ created, errors }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!name) {
      return new Response(
        JSON.stringify({ code: "VALIDATION", error: "Укажите имя ученика." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Онбординг v2 (rule 60): контакт БОЛЬШЕ НЕ обязателен — плейсхолдер по имени.
    // Канал требуется только до первой отправки ДЗ (share-gate). Если email задан —
    // проверяем формат; пустой email+telegram → temp-email плейсхолдер (Step 3).

    if (emailRaw && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) {
      return new Response(
        JSON.stringify({ code: "VALIDATION", error: "Некорректный формат email." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Цель занятий — опциональна (решение Vladimir 2026-06-07): убрана из
    // обязательных, чтобы быстрый add не требовал лишних полей. Имя + 1 контакт
    // (email ИЛИ telegram, проверено выше) — единственный gate.

    let studentId: string | null = null;
    let profileRegistrationSource: string | null = null;
    let existingTelegramUserId: number | null = null;
    let isNewUser = false;
    let loginEmail = "";
    let plainPassword = "";

    // Step 1: Try to find existing user by email (priority) or telegram.
    // Use SECURITY DEFINER RPC instead of auth.admin.listUsers — listUsers is unreliable
    // (transient errors silently produce empty result → 500 "email_exists" later).
    if (email) {
      const { data: foundId, error: lookupError } = await supabaseAdmin
        .rpc("find_auth_user_id_by_email", { p_email: email });

      if (lookupError) {
        console.error("auth.users lookup failed:", lookupError);
        return new Response(
          JSON.stringify({
            code: "EMAIL_LOOKUP_FAILED",
            error: "Не удалось проверить email в базе. Попробуй ещё раз через минуту.",
          }),
          { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      if (foundId) {
        studentId = foundId as string;
        loginEmail = email;
        const { data: emailProfile } = await supabaseAdmin
          .from("profiles")
          .select("id, registration_source, telegram_user_id, username")
          .eq("id", studentId)
          .maybeSingle();
        if (emailProfile) {
          profileRegistrationSource = emailProfile.registration_source ?? null;
          existingTelegramUserId = emailProfile.telegram_user_id ?? null;
        }

        // Guard: do not silently attach a tutor/admin account as a student.
        const { data: roleRows } = await supabaseAdmin
          .from("user_roles")
          .select("role")
          .eq("user_id", studentId);
        const conflictingRole = (roleRows ?? []).find(
          (r: any) => r.role === "tutor" || r.role === "admin",
        );
        if (conflictingRole) {
          return new Response(
            JSON.stringify({
              code: "EMAIL_BELONGS_TO_OTHER_ACCOUNT",
              error:
                "Этот email уже зарегистрирован в Сократе как " +
                (conflictingRole.role === "admin" ? "администратор" : "репетитор") +
                ". Используй другой email или попроси ученика войти и связаться с тобой по ссылке-приглашению.",
            }),
            { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
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
      const randomPassword = generatePassword();
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
        const alreadyRegistered =
          (authError as any)?.code === "email_exists" ||
          authError?.message?.includes("already been registered");

        if (alreadyRegistered) {
          console.log("Auth user already exists for email:", userEmail);
          // Race or stale lookup: re-resolve via SECURITY DEFINER RPC.
          const { data: raceId } = await supabaseAdmin
            .rpc("find_auth_user_id_by_email", { p_email: userEmail });
          if (raceId) {
            studentId = raceId as string;
            profileRegistrationSource = "manual";
            // Existing user — we did not actually create credentials.
            isNewUser = false;
            plainPassword = "";
          }
        }

        if (!studentId) {
          console.error("Failed to create auth user:", authError);
          if (alreadyRegistered) {
            return new Response(
              JSON.stringify({
                code: "EMAIL_ALREADY_REGISTERED",
                error:
                  "Этот email уже зарегистрирован, но мы не смогли найти аккаунт по нему. Попробуй ещё раз или попроси ученика войти и связаться с тобой по ссылке-приглашению.",
              }),
              { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }
          return new Response(
            JSON.stringify({
              code: "CREATE_USER_FAILED",
              error:
                "Не удалось создать ученика: " +
                (authError?.message ?? "неизвестная ошибка") +
                ". Попробуй ещё раз.",
            }),
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
        JSON.stringify({
          code: "STUDENT_ID_UNRESOLVED",
          error: "Не удалось определить аккаунт ученика. Проверь email/Telegram и попробуй ещё раз.",
        }),
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
    // Цель опциональна — пишем только если заполнена (не затираем существующую/null).
    if (learningGoal) {
      profileUpdates.learning_goal = learningGoal;
    }

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
    // Phase 8.1 (2026-05-20): tutor-curated gender для AI grammar conjugation
    // (см. .claude/rules/40-homework-system.md + migration 20260520120000_add_tutor_students_gender.sql).
    // Validated against enum check constraint в tutor_students.gender.
    if (body.gender === "male" || body.gender === "female") {
      payload.gender = body.gender;
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
        JSON.stringify({
          code: "TUTOR_STUDENT_INSERT_FAILED",
          error: "Не удалось привязать ученика к твоему кабинету. Попробуй ещё раз.",
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    await logAnalyticsEventOnce(
      supabaseAdmin,
      {
        event_name: "tutor_first_student_added",
        tutor_id: tutor.id,
        actor_user_id: user.id,
        student_id: studentId,
        tutor_student_id: tutorStudent.id,
        source: "single",
      },
      { tutor_id: tutor.id },
    );

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
    const message = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({
        code: "INTERNAL_ERROR",
        error: "Внутренняя ошибка сервера при добавлении ученика: " + message,
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
