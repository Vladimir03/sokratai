

## Problem

When the tutor sends a reminder via the "Напомнить" button, the Telegram message arrives as plain text without a link to the homework. The initial homework notification includes an "Открыть ДЗ" link — the reminder should too.

## Solution

Modify `handleRemindStudent` in `supabase/functions/homework-api/index.ts` to append a homework link to the Telegram message and send it with HTML parse mode.

## Changes

### File: `supabase/functions/homework-api/index.ts` (edge function)

In the Telegram sending block (~lines 1833–1836), change from:

```ts
const payload: Record<string, unknown> = {
  chat_id: chatId,
  text: message,
};
```

To:

```ts
const appUrl =
  Deno.env.get("PUBLIC_APP_URL")?.trim().replace(/\/$/, "") ??
  "https://sokratai.lovable.app";
const homeworkUrl = `${appUrl}/homework/${assignmentId}`;
const textWithLink =
  `${escapeHtmlEntities(message)}\n\n<a href="${escapeHtmlEntities(homeworkUrl)}">Открыть ДЗ</a>`;

const payload: Record<string, unknown> = {
  chat_id: chatId,
  text: textWithLink,
  parse_mode: "HTML",
};
```

This reuses the same `PUBLIC_APP_URL` + `/homework/{id}` pattern already used in the initial notification (line 1413–1415) and the email fallback (line 1929–1932). The `escapeHtmlEntities` function is already available in this file.

### Deployment

Redeploy edge function `homework-api` — no frontend or migration changes needed.

