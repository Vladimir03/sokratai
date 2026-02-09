import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID")!;
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET")!;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function getUserId(req: Request): Promise<string | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;

  const supabaseUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user } } = await supabaseUser.auth.getUser();
  return user?.id || null;
}

async function getTutorId(userId: string): Promise<string | null> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data } = await supabase
    .from("tutors")
    .select("id")
    .eq("user_id", userId)
    .single();

  return data?.id || null;
}

// Refresh access token using refresh_token
async function refreshAccessToken(refreshToken: string): Promise<{ access_token: string; expires_in: number } | null> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    console.error("Token refresh failed:", await response.text());
    return null;
  }

  return response.json();
}

// Determine lesson_type from event summary/description
function detectLessonType(summary: string, description: string | null): string {
  const text = `${summary} ${description || ""}`.toLowerCase();
  if (text.includes("пробное") || text.includes("пробный урок") || text.includes("trial")) {
    return "trial";
  }
  if (text.includes("пробник") || text.includes("пробный экзамен") || text.includes("mock")) {
    return "mock_exam";
  }
  if (text.includes("консультация") || text.includes("consultation")) {
    return "consultation";
  }
  return "regular";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const userId = await getUserId(req);
  if (!userId) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const tutorId = await getTutorId(userId);
  if (!tutorId) {
    return jsonResponse({ error: "Tutor not found" }, 404);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // Get connection
  const { data: connection, error: connError } = await supabase
    .from("tutor_google_calendar_connections")
    .select("*")
    .eq("tutor_id", tutorId)
    .single();

  if (connError || !connection) {
    return jsonResponse({ error: "Google Calendar not connected" }, 400);
  }

  // Check if access token needs refresh
  let accessToken = connection.access_token;
  const tokenExpiry = new Date(connection.access_token_expires_at);

  if (tokenExpiry < new Date()) {
    if (!connection.refresh_token) {
      return jsonResponse({ error: "Token expired and no refresh token. Please reconnect." }, 401);
    }

    const refreshed = await refreshAccessToken(connection.refresh_token);
    if (!refreshed) {
      return jsonResponse({ error: "Failed to refresh token. Please reconnect." }, 401);
    }

    accessToken = refreshed.access_token;
    const newExpiry = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();

    await supabase
      .from("tutor_google_calendar_connections")
      .update({
        access_token: accessToken,
        access_token_expires_at: newExpiry,
        updated_at: new Date().toISOString(),
      })
      .eq("tutor_id", tutorId);
  }

  // Parse request body for date range
  const body = await req.json();
  const startDate = body.start_date;
  const endDate = body.end_date;

  if (!startDate || !endDate) {
    return jsonResponse({ error: "start_date and end_date required" }, 400);
  }

  // Fetch events from Google Calendar
  const calendarId = connection.calendar_id || "primary";
  const params = new URLSearchParams({
    timeMin: new Date(startDate).toISOString(),
    timeMax: new Date(endDate).toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250",
  });

  const eventsResponse = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!eventsResponse.ok) {
    const errText = await eventsResponse.text();
    console.error("Google Calendar API error:", errText);
    return jsonResponse({ error: "Failed to fetch Google Calendar events" }, 502);
  }

  const eventsData = await eventsResponse.json();
  const events = eventsData.items || [];

  // Get tutor's students for matching
  const { data: tutorStudents } = await supabase
    .from("tutor_students")
    .select("id, student_id, profiles(username, telegram_username)")
    .eq("tutor_id", tutorId)
    .eq("status", "active");

  // Get existing imported lessons for dedup
  const { data: existingLessons } = await supabase
    .from("tutor_lessons")
    .select("id, external_event_id, external_event_updated_at, status")
    .eq("tutor_id", tutorId)
    .eq("external_source", "google_calendar")
    .not("external_event_id", "is", null);

  const existingByEventId = new Map(
    (existingLessons || []).map(l => [l.external_event_id, l])
  );

  let imported = 0;
  let updated = 0;
  let cancelled = 0;
  let skipped = 0;

  for (const event of events) {
    // Skip all-day events (no dateTime)
    if (!event.start?.dateTime) {
      skipped++;
      continue;
    }

    const eventId = event.id;
    const eventUpdated = event.updated;
    const existing = existingByEventId.get(eventId);

    // Handle cancelled events
    if (event.status === "cancelled") {
      if (existing && existing.status !== "cancelled") {
        await supabase
          .from("tutor_lessons")
          .update({
            status: "cancelled",
            cancelled_at: new Date().toISOString(),
            cancelled_by: null,
          })
          .eq("id", existing.id);
        cancelled++;
      } else {
        skipped++;
      }
      continue;
    }

    // Calculate duration
    const eventStart = new Date(event.start.dateTime);
    const eventEnd = new Date(event.end?.dateTime || event.start.dateTime);
    const durationMin = Math.round((eventEnd.getTime() - eventStart.getTime()) / 60000);

    if (durationMin <= 0 || durationMin > 480) {
      skipped++;
      continue;
    }

    // Detect lesson type from title/description
    const summary = event.summary || "Занятие";
    const description = event.description || null;
    const lessonType = detectLessonType(summary, description);

    // Try to match student by name in summary
    let matchedStudentId: string | null = null;
    let matchedTutorStudentId: string | null = null;

    if (tutorStudents) {
      for (const ts of tutorStudents) {
        const profile = (ts as any).profiles;
        if (!profile) continue;
        const username = (profile.username || "").toLowerCase();
        const telegramUsername = (profile.telegram_username || "").toLowerCase();

        const summaryLower = summary.toLowerCase();
        if (
          (username && username.length > 2 && summaryLower.includes(username)) ||
          (telegramUsername && telegramUsername.length > 2 && summaryLower.includes(telegramUsername))
        ) {
          matchedStudentId = ts.student_id;
          matchedTutorStudentId = ts.id;
          break;
        }
      }
    }

    const lessonData = {
      tutor_id: tutorId,
      tutor_student_id: matchedTutorStudentId,
      student_id: matchedStudentId,
      start_at: eventStart.toISOString(),
      duration_min: durationMin,
      lesson_type: lessonType,
      subject: summary,
      notes: description,
      source: "manual" as const,
      external_source: "google_calendar",
      external_event_id: eventId,
      external_calendar_id: calendarId,
      external_event_updated_at: eventUpdated || null,
    };

    if (existing) {
      // Update if event was modified
      if (existing.external_event_updated_at !== eventUpdated) {
        await supabase
          .from("tutor_lessons")
          .update({
            start_at: lessonData.start_at,
            duration_min: lessonData.duration_min,
            lesson_type: lessonData.lesson_type,
            subject: lessonData.subject,
            notes: lessonData.notes,
            external_event_updated_at: lessonData.external_event_updated_at,
          })
          .eq("id", existing.id);
        updated++;
      } else {
        skipped++;
      }
    } else {
      // Insert new lesson
      const { error: insertError } = await supabase
        .from("tutor_lessons")
        .insert(lessonData);

      if (insertError) {
        console.error("Error inserting lesson:", insertError);
        skipped++;
      } else {
        imported++;
      }
    }
  }

  // Update last_import_at
  await supabase
    .from("tutor_google_calendar_connections")
    .update({
      last_import_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("tutor_id", tutorId);

  return jsonResponse({ imported, updated, cancelled, skipped });
});
