import { createClient } from "npm:@supabase/supabase-js@2";

// ─── Auto-reminder edge function ─────────────────────────────────────────────
// Runs on a schedule (every 30 min via cron / Supabase Scheduler).
// Sends 24h and 1h reminder messages to students who haven't submitted yet.
// Idempotent: reminder_log UNIQUE constraint prevents duplicate sends.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ReminderResult {
  sent_24h: number;
  sent_1h: number;
  sent_manual: number;
  skipped: number;
  errors: number;
}

async function sendTelegramMessage(chatId: number, text: string): Promise<boolean> {
  try {
    const resp = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
      },
    );
    return resp.ok;
  } catch {
    return false;
  }
}

async function runReminders(): Promise<ReminderResult> {
  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const result: ReminderResult = { sent_24h: 0, sent_1h: 0, sent_manual: 0, skipped: 0, errors: 0 };
  const now = new Date();

  // Find active assignments with a deadline
  const { data: assignments, error: assErr } = await db
    .from("homework_tutor_assignments")
    .select("id, title, subject, deadline")
    .eq("status", "active")
    .not("deadline", "is", null);

  if (assErr || !assignments) {
    console.error("homework_reminder_fetch_assignments_error", { error: assErr?.message });
    result.errors++;
    return result;
  }

  for (const assignment of assignments) {
    const deadline = new Date(assignment.deadline as string);
    const msUntilDeadline = deadline.getTime() - now.getTime();
    const hoursUntil = msUntilDeadline / (1000 * 60 * 60);

    // Determine which reminder type to send (window: ±30 min around target)
    let reminderType: "24h" | "1h" | null = null;
    if (hoursUntil >= 23.5 && hoursUntil <= 25) {
      reminderType = "24h";
    } else if (hoursUntil >= 0.5 && hoursUntil <= 1.5) {
      reminderType = "1h";
    }

    if (!reminderType) continue;

    // Get assigned students who haven't submitted
    const { data: studentAssignments } = await db
      .from("homework_tutor_student_assignments")
      .select("student_id")
      .eq("assignment_id", assignment.id);

    if (!studentAssignments || studentAssignments.length === 0) continue;

    const allStudentIds = studentAssignments.map((sa) => sa.student_id as string);

    // Get students who already have a submission
    const { data: submissions } = await db
      .from("homework_tutor_submissions")
      .select("student_id")
      .eq("assignment_id", assignment.id)
      .in("status", ["submitted", "ai_checked", "tutor_reviewed"]);

    const submittedIds = new Set((submissions ?? []).map((s) => s.student_id as string));
    const unsubmittedIds = allStudentIds.filter((id) => !submittedIds.has(id));

    if (unsubmittedIds.length === 0) continue;

    // Check reminder log for already-sent reminders (idempotency)
    const { data: alreadySent } = await db
      .from("homework_tutor_reminder_log")
      .select("student_id")
      .eq("assignment_id", assignment.id)
      .eq("reminder_type", reminderType)
      .in("student_id", unsubmittedIds);

    const alreadySentIds = new Set((alreadySent ?? []).map((r) => r.student_id as string));
    const toNotifyIds = unsubmittedIds.filter((id) => !alreadySentIds.has(id));

    if (toNotifyIds.length === 0) {
      result.skipped += unsubmittedIds.length;
      continue;
    }

    // Get Telegram user IDs
    const { data: profiles } = await db
      .from("profiles")
      .select("id, telegram_user_id")
      .in("id", toNotifyIds);

    const profileTgMap: Record<string, number> = {};
    for (const p of profiles ?? []) {
      if (p.telegram_user_id) profileTgMap[p.id as string] = p.telegram_user_id as number;
    }

    const { data: sessions } = await db
      .from("telegram_sessions")
      .select("user_id, telegram_user_id")
      .in("user_id", toNotifyIds);

    const sessionTgMap: Record<string, number> = {};
    for (const s of sessions ?? []) {
      if (s.telegram_user_id) sessionTgMap[s.user_id as string] = s.telegram_user_id as number;
    }

    const hoursLabel = reminderType === "24h" ? "24 часа" : "1 час";
    const emoji = reminderType === "24h" ? "⏰" : "🔔";

    const sentStudentIds: string[] = [];

    for (const studentId of toNotifyIds) {
      const chatId = profileTgMap[studentId] ?? sessionTgMap[studentId];
      if (!chatId) {
        result.skipped++;
        continue;
      }

      const text = `${emoji} <b>Напоминание о домашке!</b>\n\n«${assignment.title}» нужно сдать через <b>${hoursLabel}</b>.\n\nЕсли ещё не сдал, нажми /homework и отправь ответы сейчас!`;
      const ok = await sendTelegramMessage(chatId, text);

      if (ok) {
        sentStudentIds.push(studentId);
        if (reminderType === "24h") result.sent_24h++;
        else result.sent_1h++;
      } else {
        result.errors++;
      }
    }

    // Log sent reminders (idempotent due to UNIQUE constraint)
    if (sentStudentIds.length > 0) {
      const logRows = sentStudentIds.map((sid) => ({
        assignment_id: assignment.id,
        student_id: sid,
        reminder_type: reminderType!,
      }));
      await db
        .from("homework_tutor_reminder_log")
        .upsert(logRows, { onConflict: "assignment_id,student_id,reminder_type", ignoreDuplicates: true });
    }
  }

  console.log("homework_reminder_run_complete", result);
  return result;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const result = await runReminders();
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("homework_reminder_error", { error: String(err) });
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
