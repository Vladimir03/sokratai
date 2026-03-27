import { createClient } from "npm:@supabase/supabase-js@2";
import { sendPushNotification, type PushSubscriptionData, type PushPayload } from "../_shared/push-sender.ts";
import { sendHomeworkReminderEmail } from "../_shared/email-sender.ts";

// ─── Auto-reminder edge function ─────────────────────────────────────────────
// Runs on a schedule (every 30 min via cron / Supabase Scheduler).
// Sends 24h and 1h reminder messages to students who haven't submitted yet.
// Cascade: Push → Telegram → Email.
// Idempotent: reminder_log UNIQUE constraint prevents duplicate sends.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:support@sokratai.ru";

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
  by_channel: { push: number; telegram: number; email: number };
}

async function sendTelegramMessage(chatId: number, text: string): Promise<boolean> {
  const maxAttempts = 2;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const resp = await fetch(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
        },
      );
      if (resp.ok) return true;
      const status = resp.status;
      // Retry on transient errors (429 rate limit, 5xx server errors)
      if (attempt < maxAttempts - 1 && (status === 429 || status >= 500)) {
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      return false;
    } catch {
      if (attempt < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      return false;
    }
  }
  return false;
}

async function runReminders(): Promise<ReminderResult> {
  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const result: ReminderResult = {
    sent_24h: 0, sent_1h: 0, sent_manual: 0, skipped: 0, errors: 0,
    by_channel: { push: 0, telegram: 0, email: 0 },
  };
  const now = new Date();
  const appUrl = Deno.env.get("PUBLIC_APP_URL")?.trim().replace(/\/$/, "") ?? "https://sokratai.lovable.app";

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
      .select("id, student_id")
      .eq("assignment_id", assignment.id);

    if (!studentAssignments || studentAssignments.length === 0) continue;

    const allStudentIds = studentAssignments.map((sa) => sa.student_id as string);
    const saIdToStudentId: Record<string, string> = {};
    for (const sa of studentAssignments) {
      saIdToStudentId[sa.id as string] = sa.student_id as string;
    }

    // Get students who already have a classic submission
    const { data: submissions } = await db
      .from("homework_tutor_submissions")
      .select("student_id")
      .eq("assignment_id", assignment.id)
      .in("status", ["submitted", "ai_checked", "tutor_reviewed"]);

    const submittedIds = new Set((submissions ?? []).map((s) => s.student_id as string));

    // Get students who completed guided_chat threads
    const saIds = studentAssignments.map((sa) => sa.id as string);
    if (saIds.length > 0) {
      const { data: completedThreads } = await db
        .from("homework_tutor_threads")
        .select("student_assignment_id")
        .in("student_assignment_id", saIds)
        .eq("status", "completed");

      for (const t of completedThreads ?? []) {
        const studentId = saIdToStudentId[t.student_assignment_id as string];
        if (studentId) submittedIds.add(studentId);
      }
    }

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

    // ─── Resolve all delivery channels ────────────────────────────────────────

    const { data: profiles } = await db
      .from("profiles")
      .select("id, telegram_user_id, email")
      .in("id", toNotifyIds);

    const profileTgMap: Record<string, number> = {};
    const emailMap: Record<string, string> = {};
    for (const p of profiles ?? []) {
      if (p.telegram_user_id) profileTgMap[p.id as string] = p.telegram_user_id as number;
      if (p.email && !String(p.email).endsWith("@temp.sokratai.ru")) {
        emailMap[p.id as string] = p.email as string;
      }
    }

    const { data: sessions } = await db
      .from("telegram_sessions")
      .select("user_id, telegram_user_id")
      .in("user_id", toNotifyIds);

    const sessionTgMap: Record<string, number> = {};
    for (const s of sessions ?? []) {
      if (s.telegram_user_id) sessionTgMap[s.user_id as string] = s.telegram_user_id as number;
    }

    const { data: pushSubs, error: pushSubsError } = await db
      .from("push_subscriptions")
      .select("user_id, endpoint, p256dh, auth")
      .in("user_id", toNotifyIds);

    if (pushSubsError) {
      console.error("homework_reminder_push_subs_query_error", {
        assignment_id: assignment.id,
        error: pushSubsError.message,
      });
      // Continue without push — cascade to telegram/email
    }

    const pushSubsMap: Record<string, PushSubscriptionData[]> = {};
    for (const sub of pushSubs ?? []) {
      const uid = sub.user_id as string;
      if (!pushSubsMap[uid]) pushSubsMap[uid] = [];
      pushSubsMap[uid].push({
        endpoint: sub.endpoint as string,
        p256dh: sub.p256dh as string,
        auth: sub.auth as string,
      });
    }

    const hoursLabel = reminderType === "24h" ? "24 часа" : "1 час";
    const emoji = reminderType === "24h" ? "⏰" : "🔔";
    const homeworkUrl = `${appUrl}/homework/${assignment.id}`;

    const sentStudents: { id: string; channel: string }[] = [];

    // ─── Cascade per student ──────────────────────────────────────────────────

    for (const studentId of toNotifyIds) {
      const hasPush = (pushSubsMap[studentId]?.length ?? 0) > 0;
      const chatId = profileTgMap[studentId] ?? sessionTgMap[studentId];
      const hasTelegram = Boolean(chatId);
      const hasEmail = Boolean(emailMap[studentId]);

      let delivered = false;
      let channel: string | null = null;

      // Step 1: Try Push
      if (hasPush && VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
        const pushPayload: PushPayload = {
          title: `${emoji} Напоминание: ${assignment.title as string}`,
          body: `Нужно сдать через ${hoursLabel}`,
          url: homeworkUrl,
        };
        const subs = pushSubsMap[studentId];
        for (const sub of subs) {
          let pushResult = await sendPushNotification(sub, pushPayload, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT);
          if (pushResult.success) {
            delivered = true;
            channel = "push";
            break;
          }
          if (pushResult.gone) {
            await db.from("push_subscriptions").delete().eq("endpoint", sub.endpoint).eq("user_id", studentId);
            continue;
          }
          if (pushResult.status >= 500) {
            pushResult = await sendPushNotification(sub, pushPayload, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT);
            if (pushResult.success) {
              delivered = true;
              channel = "push";
              break;
            }
            if (pushResult.gone) {
              await db.from("push_subscriptions").delete().eq("endpoint", sub.endpoint).eq("user_id", studentId);
            }
          }
        }
      }

      // Step 2: Try Telegram
      if (!delivered && hasTelegram) {
        const text = `${emoji} <b>Напоминание о домашке!</b>\n\n«${assignment.title}» нужно сдать через <b>${hoursLabel}</b>.\n\nЕсли ещё не сдал, нажми /homework и отправь ответы сейчас!`;
        const ok = await sendTelegramMessage(chatId!, text);
        if (ok) {
          delivered = true;
          channel = "telegram";
        }
      }

      // Step 3: Try Email
      if (!delivered && hasEmail) {
        try {
          const emailResult = await sendHomeworkReminderEmail(
            db,
            emailMap[studentId],
            {
              studentName: "Ученик",
              assignmentTitle: assignment.title as string,
              subject: assignment.subject as string,
              deadline: assignment.deadline as string,
              timeLeft: reminderType as "24h" | "1h",
              homeworkUrl,
            },
            assignment.id as string,
          );
          if (emailResult.success && !emailResult.skipped) {
            delivered = true;
            channel = "email";
          }
        } catch (err) {
          console.error("homework_reminder_email_error", { student_id: studentId, error: String(err) });
        }
      }

      // Record result
      if (delivered) {
        sentStudents.push({ id: studentId, channel: channel! });
        if (reminderType === "24h") result.sent_24h++;
        else result.sent_1h++;
        result.by_channel[channel as keyof typeof result.by_channel]++;
        console.log("homework_reminder_sent", { assignment_id: assignment.id, student_id: studentId, channel, type: reminderType });
      } else if (!hasPush && !hasTelegram && !hasEmail) {
        result.skipped++;
      } else {
        result.errors++;
        console.warn("homework_reminder_all_channels_failed", { assignment_id: assignment.id, student_id: studentId });
      }
    }

    // Log sent reminders (idempotent due to UNIQUE constraint)
    if (sentStudents.length > 0) {
      const logRows = sentStudents.map((s) => ({
        assignment_id: assignment.id,
        student_id: s.id,
        reminder_type: reminderType!,
        channel: s.channel,
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

  // Scheduler secret check
  const authHeader = req.headers.get("Authorization");
  const expectedSecret = Deno.env.get("SCHEDULER_SECRET");
  if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
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
