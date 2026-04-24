/**
 * Email sender utility for homework notifications and reminders.
 * Renders templates, checks suppression, manages unsubscribe tokens,
 * and enqueues via the existing pgmq email queue infrastructure.
 *
 * Follows the same zero-npm-dependency pattern as push-sender.ts.
 * Callers pass their existing service_role SupabaseClient.
 */

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import {
  renderHomeworkNotification,
  type HomeworkNotificationData,
} from './transactional-email-templates/homework-notification.ts';
import {
  renderHomeworkReminder,
  type HomeworkReminderData,
} from './transactional-email-templates/homework-reminder.ts';
import {
  renderHomeworkTutorMessage,
  type HomeworkTutorMessageData,
} from './transactional-email-templates/homework-tutor-message.ts';

// ─── Types ───────────────────────────────────────────────────

export interface EmailResult {
  success: boolean;
  error?: string;
  skipped?: 'temp_email' | 'suppressed';
}

/** Data for homework notification email (unsubscribeUrl added internally). */
export type HomeworkNotificationInput = Omit<HomeworkNotificationData, 'unsubscribeUrl'>;

/** Data for homework reminder email (unsubscribeUrl added internally). */
export type HomeworkReminderInput = Omit<HomeworkReminderData, 'unsubscribeUrl'>;

/** Data for tutor-authored homework reminder message (unsubscribeUrl added internally). */
export type HomeworkTutorMessageInput = Omit<HomeworkTutorMessageData, 'unsubscribeUrl'>;

// ─── Constants ───────────────────────────────────────────────

const SENDER_FROM = 'Сократ <noreply@sokratai.ru>';
const SENDER_DOMAIN = 'sokratai.ru';
const QUEUE_NAME = 'transactional_emails';
const TEMP_EMAIL_SUFFIX = '@temp.sokratai.ru';

// ─── Private helpers ─────────────────────────────────────────

function getAppUrl(): string {
  return (
    Deno.env.get('PUBLIC_APP_URL')?.trim().replace(/\/$/, '') ??
    'https://sokratai.ru'
  );
}

function isTempEmail(email: string): boolean {
  return email.toLowerCase().endsWith(TEMP_EMAIL_SUFFIX);
}

/**
 * Check if email is in the suppression list (bounce, complaint, unsubscribe).
 * Throws on DB error to prevent sending to suppressed addresses.
 */
async function isSuppressed(db: SupabaseClient, email: string): Promise<boolean> {
  const { data, error } = await db
    .from('suppressed_emails')
    .select('id')
    .eq('email', email.toLowerCase())
    .maybeSingle();
  if (error) {
    throw new Error(`suppression_check_failed: ${error.message}`);
  }
  return data !== null;
}

/**
 * Get or create an unsubscribe token for the given email.
 * Uses INSERT ... ON CONFLICT DO NOTHING + SELECT for idempotency.
 * Throws on DB error to prevent sending without a valid unsubscribe link.
 */
async function getOrCreateUnsubscribeToken(
  db: SupabaseClient,
  email: string,
): Promise<string> {
  const normalizedEmail = email.toLowerCase();
  const token = crypto.randomUUID();

  // Try insert (ignored on conflict with existing email)
  const { error: insertError } = await db
    .from('email_unsubscribe_tokens')
    .insert({ token, email: normalizedEmail })
    .select()
    .maybeSingle();

  // 23505 = unique_violation (expected on conflict) — safe to ignore
  if (insertError && insertError.code !== '23505') {
    throw new Error(`unsubscribe_token_insert_failed: ${insertError.message}`);
  }

  // Always select the canonical token for this email
  const { data, error: selectError } = await db
    .from('email_unsubscribe_tokens')
    .select('token')
    .eq('email', normalizedEmail)
    .single();

  if (selectError || !data?.token) {
    throw new Error(`unsubscribe_token_select_failed: ${selectError?.message ?? 'no token returned'}`);
  }

  return data.token;
}

function buildUnsubscribeUrl(token: string): string {
  return `${getAppUrl()}/unsubscribe?token=${token}`;
}

interface EnqueuePayload {
  message_id: string;
  run_id: string;
  to: string;
  from: string;
  sender_domain: string;
  subject: string;
  html: string;
  text: string;
  purpose: string;
  label: string;
  idempotency_key: string;
  unsubscribe_token: string;
  queued_at: string;
}

async function enqueue(
  db: SupabaseClient,
  payload: EnqueuePayload,
): Promise<{ success: boolean; error?: string }> {
  const { error } = await db.rpc('enqueue_email', {
    queue_name: QUEUE_NAME,
    payload,
  });
  if (error) {
    console.error('email_enqueue_failed', {
      label: payload.label,
      to: payload.to,
      error: error.message,
    });
    return { success: false, error: error.message };
  }
  return { success: true };
}

/**
 * Shared pre-send checks: temp email guard + suppression check.
 * Returns an EmailResult if the email should be skipped, or null to proceed.
 */
async function preSendChecks(
  db: SupabaseClient,
  to: string,
): Promise<EmailResult | null> {
  if (isTempEmail(to)) {
    return { success: true, skipped: 'temp_email' };
  }
  if (await isSuppressed(db, to)) {
    return { success: true, skipped: 'suppressed' };
  }
  return null;
}

// ─── Public API ──────────────────────────────────────────────

/**
 * Render and enqueue a homework notification email.
 * Skips temp emails (@temp.sokratai.ru) and suppressed addresses.
 */
export async function sendHomeworkNotificationEmail(
  db: SupabaseClient,
  to: string,
  data: HomeworkNotificationInput,
  assignmentId: string,
): Promise<EmailResult> {
  try {
    const skip = await preSendChecks(db, to);
    if (skip) return skip;

    const unsubToken = await getOrCreateUnsubscribeToken(db, to);
    const unsubscribeUrl = buildUnsubscribeUrl(unsubToken);

    const rendered = renderHomeworkNotification({ ...data, unsubscribeUrl });

    const payload: EnqueuePayload = {
      message_id: crypto.randomUUID(),
      run_id: crypto.randomUUID(),
      to,
      from: SENDER_FROM,
      sender_domain: SENDER_DOMAIN,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      purpose: 'transactional',
      label: 'homework-notification',
      idempotency_key: `hw-notif-${assignmentId}-${to}`,
      unsubscribe_token: unsubToken,
      queued_at: new Date().toISOString(),
    };

    return await enqueue(db, payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('sendHomeworkNotificationEmail_error', { to, assignmentId, error: msg });
    return { success: false, error: msg };
  }
}

/**
 * Render and enqueue a tutor-authored homework reminder message email.
 * Used by Homework Results v2 RemindStudentDialog email-fallback path
 * (student has no Telegram link). Skips temp emails (@temp.sokratai.ru)
 * and suppressed addresses.
 *
 * Idempotency key includes a timestamp because a tutor may legitimately
 * send multiple reminder emails for the same assignment+student.
 */
export async function sendHomeworkTutorMessageEmail(
  db: SupabaseClient,
  to: string,
  data: HomeworkTutorMessageInput,
  assignmentId: string,
): Promise<EmailResult> {
  try {
    const skip = await preSendChecks(db, to);
    if (skip) return skip;

    const unsubToken = await getOrCreateUnsubscribeToken(db, to);
    const unsubscribeUrl = buildUnsubscribeUrl(unsubToken);

    const rendered = renderHomeworkTutorMessage({ ...data, unsubscribeUrl });

    const payload: EnqueuePayload = {
      message_id: crypto.randomUUID(),
      run_id: crypto.randomUUID(),
      to,
      from: SENDER_FROM,
      sender_domain: SENDER_DOMAIN,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      purpose: 'transactional',
      label: 'homework-tutor-message',
      idempotency_key: `hw-tutor-msg-${assignmentId}-${to}-${Date.now()}`,
      unsubscribe_token: unsubToken,
      queued_at: new Date().toISOString(),
    };

    return await enqueue(db, payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('sendHomeworkTutorMessageEmail_error', { to, assignmentId, error: msg });
    return { success: false, error: msg };
  }
}

/**
 * Render and enqueue a homework reminder email.
 * Skips temp emails (@temp.sokratai.ru) and suppressed addresses.
 */
export async function sendHomeworkReminderEmail(
  db: SupabaseClient,
  to: string,
  data: HomeworkReminderInput,
  assignmentId: string,
): Promise<EmailResult> {
  try {
    const skip = await preSendChecks(db, to);
    if (skip) return skip;

    const unsubToken = await getOrCreateUnsubscribeToken(db, to);
    const unsubscribeUrl = buildUnsubscribeUrl(unsubToken);

    const rendered = renderHomeworkReminder({ ...data, unsubscribeUrl });

    const payload: EnqueuePayload = {
      message_id: crypto.randomUUID(),
      run_id: crypto.randomUUID(),
      to,
      from: SENDER_FROM,
      sender_domain: SENDER_DOMAIN,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      purpose: 'transactional',
      label: 'homework-reminder',
      idempotency_key: `hw-remind-${assignmentId}-${to}-${data.timeLeft}`,
      unsubscribe_token: unsubToken,
      queued_at: new Date().toISOString(),
    };

    return await enqueue(db, payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('sendHomeworkReminderEmail_error', { to, assignmentId, error: msg });
    return { success: false, error: msg };
  }
}
