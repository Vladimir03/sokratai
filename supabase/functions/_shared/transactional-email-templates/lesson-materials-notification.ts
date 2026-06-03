/**
 * Email template: lesson materials notification (schedule-materials TASK-7).
 * Pure function — no side effects, no DB calls.
 * Returns pre-rendered { subject, html, text } ready for enqueue.
 * Mirrors homework-notification.ts (inline styles, zero deps).
 */

// ─── Types ───────────────────────────────────────────────────

export interface LessonMaterialsNotificationData {
  tutorName: string;
  /** Deep-link to the student lesson detail (/student/schedule/:lessonId). */
  lessonUrl: string;
  /** Optional human label of the lesson (предмет · дата) for the body line. */
  lessonLabel?: string | null;
  unsubscribeUrl: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

// ─── Private helpers (mirror homework-notification.ts) ───────

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function wrapEmail(previewText: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<title>${esc(previewText)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;">
<div style="display:none;max-height:0;overflow:hidden;">${esc(previewText)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background-color:#f4f4f5;">
<tr><td align="center" style="padding:24px 16px;">
<table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:8px;overflow:hidden;">
${bodyHtml}
</table>
</td></tr>
</table>
</body>
</html>`;
}

function ctaButton(label: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
<tr><td style="background-color:#1B6B4A;border-radius:6px;text-align:center;">
<a href="${esc(url)}" target="_blank" style="display:inline-block;padding:12px 32px;color:#ffffff;font-size:16px;font-weight:600;text-decoration:none;border-radius:6px;">${esc(label)}</a>
</td></tr>
</table>`;
}

function footer(unsubscribeUrl: string): string {
  return `<tr><td style="padding:0 32px;">
<hr style="border:none;border-top:1px solid #e4e4e7;margin:0;">
</td></tr>
<tr><td style="padding:20px 32px 24px;color:#71717a;font-size:13px;line-height:1.5;">
Сократ — AI-помощник для подготовки к ЕГЭ и ОГЭ<br>
<a href="${esc(unsubscribeUrl)}" style="color:#71717a;text-decoration:underline;">Отписаться от уведомлений</a>
</td></tr>`;
}

// ─── Public API ──────────────────────────────────────────────

export function renderLessonMaterialsNotification(
  data: LessonMaterialsNotificationData,
): RenderedEmail {
  const { tutorName, lessonUrl, lessonLabel, unsubscribeUrl } = data;

  const subjectLine = 'Новые материалы к занятию';

  const lessonRow = lessonLabel
    ? `<tr><td style="padding:0 32px 12px;font-size:17px;font-weight:600;line-height:1.4;color:#18181b;">${esc(lessonLabel)}</td></tr>`
    : '';

  const html = wrapEmail(subjectLine, `
<tr><td style="padding:32px 32px 16px;">
<h1 style="margin:0;font-size:22px;font-weight:700;color:#1B6B4A;line-height:1.3;">Новые материалы к занятию</h1>
</td></tr>
<tr><td style="padding:0 32px 8px;font-size:15px;line-height:1.5;color:#27272a;">
${esc(tutorName)} добавил материалы к занятию — запись, конспект или домашнее задание.
</td></tr>
${lessonRow}
<tr><td style="padding:0 32px;">
${ctaButton('Открыть занятие', lessonUrl)}
</td></tr>
${footer(unsubscribeUrl)}
`);

  const text = [
    'Новые материалы к занятию',
    '',
    `${tutorName} добавил материалы к занятию — запись, конспект или домашнее задание.`,
    lessonLabel ?? '',
    '',
    `Открыть занятие: ${lessonUrl}`,
    '',
    '---',
    'Сократ — AI-помощник для подготовки к ЕГЭ и ОГЭ',
    `Отписаться: ${unsubscribeUrl}`,
  ].filter(Boolean).join('\n');

  return { subject: subjectLine, html, text };
}
