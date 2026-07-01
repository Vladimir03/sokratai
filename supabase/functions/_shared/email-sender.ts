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
import {
  renderLessonMaterialsNotification,
  type LessonMaterialsNotificationData,
} from './transactional-email-templates/lesson-materials-notification.ts';

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

/** Data for lesson-materials notification email (unsubscribeUrl added internally). */
export type LessonMaterialsNotificationInput = Omit<LessonMaterialsNotificationData, 'unsubscribeUrl'>;

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
      to: redactEmail(payload.to),
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

// ─── Онбординг v2 — простые брендовые письма (login-link + invite) ──────────

function escapeHtmlEmail(s: string): string {
  return s.replace(/[<>"'&]/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : c === "'" ? '&#39;' : '&amp;',
  );
}

// Онбординг v2 (review P2 #8) — PII-редакция email для логов auth/invite писем
// (`a***@domain.com`). Полный адрес в логах не пишем.
function redactEmail(to: string): string {
  const at = to.indexOf('@');
  if (at <= 0) return '***';
  return `${to[0]}***${to.slice(at)}`;
}

/** Минимальный брендовый шаблон (inline styles, RU-safe, Golos-fallback). */
function buildSimpleEmail(params: {
  heading: string;
  intro: string;
  ctaText: string;
  ctaUrl: string;
  footerNote?: string;
  unsubscribeUrl: string;
}): { html: string; text: string } {
  const { heading, intro, ctaText, ctaUrl, footerNote, unsubscribeUrl } = params;
  const h = escapeHtmlEmail(heading);
  const i = escapeHtmlEmail(intro);
  const c = escapeHtmlEmail(ctaText);
  const fn = footerNote ? escapeHtmlEmail(footerNote) : '';
  const html = `<!doctype html><html lang="ru"><body style="margin:0;background:#F8FAFC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0F172A">
<div style="max-width:480px;margin:0 auto;padding:32px 20px">
  <div style="background:#fff;border:1px solid #E2E8F0;border-radius:12px;padding:28px 24px">
    <div style="font-size:18px;font-weight:600;margin-bottom:10px">${h}</div>
    <p style="font-size:15px;line-height:1.6;color:#334155;margin:0 0 20px">${i}</p>
    <a href="${ctaUrl}" style="display:inline-block;background:#1B6B4A;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:8px">${c}</a>
    ${fn ? `<p style="font-size:13px;line-height:1.5;color:#64748B;margin:20px 0 0">${fn}</p>` : ''}
  </div>
  <p style="font-size:12px;color:#94A3B8;text-align:center;margin:16px 0 0">
    Сократ AI · <a href="${unsubscribeUrl}" style="color:#94A3B8">отписаться</a>
  </p>
</div></body></html>`;
  const text = `${heading}\n\n${intro}\n\n${ctaText}: ${ctaUrl}\n${footerNote ? `\n${footerNote}\n` : ''}\nСократ AI`;
  return { html, text };
}

/**
 * Онбординг v2 (T7) — письмо «войти по коду» (RU-safe magic-link).
 * `loginUrl` ведёт на api.sokratai.ru/functions/v1/email-verify?type=magiclink
 * (НЕ *.supabase.co). Suppression-проверку НЕ применяем — это auth-письмо,
 * блокировать вход нельзя (только temp-email guard).
 */
export async function sendStudentLoginLinkEmail(
  db: SupabaseClient,
  to: string,
  loginUrl: string,
): Promise<EmailResult> {
  try {
    if (isTempEmail(to)) return { success: true, skipped: 'temp_email' };
    const unsubToken = await getOrCreateUnsubscribeToken(db, to);
    const rendered = buildSimpleEmail({
      heading: 'Вход в Сократ AI',
      intro: 'Нажми кнопку, чтобы войти без пароля. Ссылка действует ограниченное время и работает один раз.',
      ctaText: 'Войти в Сократ',
      ctaUrl: loginUrl,
      footerNote: 'Если ты не запрашивал вход — просто проигнорируй это письмо.',
      unsubscribeUrl: buildUnsubscribeUrl(unsubToken),
    });
    const payload: EnqueuePayload = {
      message_id: crypto.randomUUID(),
      run_id: crypto.randomUUID(),
      to,
      from: SENDER_FROM,
      sender_domain: SENDER_DOMAIN,
      subject: 'Вход в Сократ AI',
      html: rendered.html,
      text: rendered.text,
      purpose: 'transactional',
      label: 'student-login-link',
      idempotency_key: `student-login-${to}-${Date.now()}`,
      unsubscribe_token: unsubToken,
      queued_at: new Date().toISOString(),
    };
    return await enqueue(db, payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('sendStudentLoginLinkEmail_error', { to: redactEmail(to), error: msg });
    return { success: false, error: msg };
  }
}

/**
 * Онбординг v2 (T3) — письмо-приглашение ученику с claim-ссылкой (+ опц. ДЗ).
 * `claimUrl` = api.sokratai.ru/functions/v1/student-claim?t={token} (OG + redirect).
 */
export async function sendStudentInviteEmail(
  db: SupabaseClient,
  to: string,
  data: { tutorName: string | null; claimUrl: string; homeworkTitle?: string | null },
): Promise<EmailResult> {
  try {
    const skip = await preSendChecks(db, to);
    if (skip) return skip;
    const unsubToken = await getOrCreateUnsubscribeToken(db, to);
    const who = data.tutorName && data.tutorName.trim() ? data.tutorName.trim() : 'Твой репетитор';
    const intro = data.homeworkTitle && data.homeworkTitle.trim()
      ? `${who} подключил тебя к Сократ AI и прислал задание «${data.homeworkTitle.trim()}». Открой, чтобы начать.`
      : `${who} подключил тебя к Сократ AI — помощнику для домашки. Открой, чтобы начать.`;
    const rendered = buildSimpleEmail({
      heading: 'Тебя пригласили в Сократ AI',
      intro,
      ctaText: 'Открыть задание',
      ctaUrl: data.claimUrl,
      footerNote: 'Ссылка персональная — не пересылай её другим.',
      unsubscribeUrl: buildUnsubscribeUrl(unsubToken),
    });
    const payload: EnqueuePayload = {
      message_id: crypto.randomUUID(),
      run_id: crypto.randomUUID(),
      to,
      from: SENDER_FROM,
      sender_domain: SENDER_DOMAIN,
      subject: 'Тебя пригласили в Сократ AI',
      html: rendered.html,
      text: rendered.text,
      purpose: 'transactional',
      label: 'student-invite',
      idempotency_key: `student-invite-${to}-${Date.now()}`,
      unsubscribe_token: unsubToken,
      queued_at: new Date().toISOString(),
    };
    return await enqueue(db, payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('sendStudentInviteEmail_error', { to: redactEmail(to), error: msg });
    return { success: false, error: msg };
  }
}

/**
 * Render and enqueue a lesson-materials notification email (schedule-materials
 * TASK-7, email fallback in the push→telegram→email cascade). Skips temp emails
 * (@temp.sokratai.ru) and suppressed addresses.
 *
 * Idempotency key includes a timestamp because a tutor may legitimately notify
 * again after a later editing session (mirror sendHomeworkTutorMessageEmail).
 */
export async function sendLessonMaterialsNotificationEmail(
  db: SupabaseClient,
  to: string,
  data: LessonMaterialsNotificationInput,
  lessonId: string,
): Promise<EmailResult> {
  try {
    const skip = await preSendChecks(db, to);
    if (skip) return skip;

    const unsubToken = await getOrCreateUnsubscribeToken(db, to);
    const unsubscribeUrl = buildUnsubscribeUrl(unsubToken);

    const rendered = renderLessonMaterialsNotification({ ...data, unsubscribeUrl });

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
      label: 'lesson-materials-notification',
      idempotency_key: `lesson-materials-${lessonId}-${to}-${Date.now()}`,
      unsubscribe_token: unsubToken,
      queued_at: new Date().toISOString(),
    };

    return await enqueue(db, payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('sendLessonMaterialsNotificationEmail_error', { to, lessonId, error: msg });
    return { success: false, error: msg };
  }
}
