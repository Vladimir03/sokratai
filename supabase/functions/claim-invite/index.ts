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

// Групповая ссылка (?g={join_code}, 2026-07-27): привязка к репетитору —
// главный исход, membership в группу — вторичный. Сбой группы НЕ роняет claim:
// ученик привязан, а group_status объясняет, что с группой.
type ClaimInviteGroupStatus =
  | "joined"          // добавлен в группу
  | "moved"           // добавлен, переехал из прежней основной группы
  | "already_member"  // уже был в этой группе
  | "group_not_found" // код группы невалиден/чужой/архив — ссылка устарела
  | "group_attach_failed"; // membership не записался (транзиент)

type ClaimInviteSuccessResponse = {
  status: ClaimInviteSuccessStatus;
  tutor_name: string;
  group_status?: ClaimInviteGroupStatus;
  group_name?: string;
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

    const body = await req.json().catch(() => null) as {
      invite_code?: unknown;
      group_code?: unknown;
    } | null;
    const inviteCode = typeof body?.invite_code === "string" ? body.invite_code.trim() : "";
    // join_code группы — bearer: не логировать (rule 96 №10).
    const groupCode = typeof body?.group_code === "string" ? body.group_code.trim() : "";

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

    // Tutor accounts must not claim invites as students (would create a
    // tutor→tutor link in tutor_students). The InvitePage UI hides the claim
    // button for tutors, but that check is best-effort client-side — this is
    // the authoritative gate (P1 review 2026-07-14).
    const { data: tutorRole, error: tutorRoleError } = await supabaseAdmin
      .from("user_roles")
      .select("id")
      .eq("user_id", user.id)
      .eq("role", "tutor")
      .maybeSingle();

    if (tutorRoleError) {
      console.error("claim-invite tutor role check error:", tutorRoleError);
      return jsonResponse(
        { error: "Не удалось проверить аккаунт. Попробуйте ещё раз.", code: "ROLE_CHECK_FAILED" },
        500,
      );
    }

    if (tutorRole) {
      return jsonResponse(
        {
          error:
            "Вы вошли как репетитор. Чтобы принять приглашение, войдите в аккаунт ученика.",
          code: "TUTOR_ACCOUNT",
        },
        403,
      );
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
    // id строки tutor_students — нужен для membership групповой ссылки.
    let tutorStudentId: string | null = existingLink?.id ?? null;

    if (existingLink) {
      status = "already_linked";
    } else {
      const { data: insertedLink, error: insertError } = await supabaseAdmin
        .from("tutor_students")
        .insert({
          tutor_id: tutor.id,
          student_id: user.id,
          status: "active",
        })
        .select("id")
        .single();

      if (insertError) {
        if (insertError.code === "23505") {
          status = "already_linked";
          const { data: racedLink } = await supabaseAdmin
            .from("tutor_students")
            .select("id")
            .eq("tutor_id", tutor.id)
            .eq("student_id", user.id)
            .maybeSingle();
          tutorStudentId = racedLink?.id ?? null;
        } else {
          console.error("claim-invite insert error:", insertError);
          return jsonResponse({ error: "Failed to create tutor link" }, 500);
        }
      } else {
        tutorStudentId = insertedLink?.id ?? null;
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

    // --- Групповая ссылка (?g={join_code}): membership в учебную группу. ---
    // Любой сбой здесь НЕ роняет claim (привязка уже создана) — только
    // group_status. Валидация принадлежности: группа обязана быть ЭТОГО
    // репетитора (склейка чужого join_code с чужим invite_code невозможна),
    // активной и учебной (is_primary).
    if (groupCode && tutorStudentId) {
      const { data: group, error: groupError } = await supabaseAdmin
        .from("tutor_groups")
        .select("id, name, short_name, is_primary, is_active, tutor_id")
        .eq("join_code", groupCode)
        .maybeSingle();

      if (groupError) {
        console.error("claim-invite group lookup error:", groupError);
        response.group_status = "group_attach_failed";
      } else if (
        !group ||
        group.tutor_id !== tutor.id ||
        group.is_active !== true ||
        group.is_primary !== true
      ) {
        response.group_status = "group_not_found";
      } else {
        response.group_name =
          (typeof group.short_name === "string" && group.short_name.trim()) || group.name;

        const { data: existingMembership, error: membershipLookupError } = await supabaseAdmin
          .from("tutor_group_memberships")
          .select("id, is_active")
          .eq("tutor_student_id", tutorStudentId)
          .eq("tutor_group_id", group.id)
          .maybeSingle();

        if (membershipLookupError) {
          console.error("claim-invite membership lookup error:", membershipLookupError);
          response.group_status = "group_attach_failed";
        } else if (existingMembership?.is_active) {
          response.group_status = "already_member";
        } else {
          // Была ли другая активная ОСНОВНАЯ группа (для статуса «переехал»)?
          const { data: otherMemberships } = await supabaseAdmin
            .from("tutor_group_memberships")
            .select("id, is_active, tutor_group:tutor_groups(is_primary)")
            .eq("tutor_student_id", tutorStudentId)
            .eq("is_active", true);
          const hadOtherPrimary = (otherMemberships ?? []).some(
            (m: { tutor_group?: { is_primary?: boolean } | null }) =>
              m.tutor_group?.is_primary === true,
          );

          // DB-триггер single_primary_guard сам деактивирует прежнюю основную
          // группу — инвариант «≤1 активная учебная группа» держит БД, не мы.
          const { error: upsertError } = await supabaseAdmin
            .from("tutor_group_memberships")
            .upsert(
              {
                tutor_id: tutor.id,
                tutor_student_id: tutorStudentId,
                tutor_group_id: group.id,
                is_active: true,
              },
              { onConflict: "tutor_student_id,tutor_group_id" },
            );

          if (upsertError) {
            console.error("claim-invite membership upsert error:", upsertError);
            response.group_status = "group_attach_failed";
          } else {
            response.group_status = hadOtherPrimary ? "moved" : "joined";
          }
        }
      }
    } else if (groupCode && !tutorStudentId) {
      response.group_status = "group_attach_failed";
    }

    return jsonResponse(response, 200);
  } catch (error) {
    console.error("claim-invite unexpected error:", error);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
