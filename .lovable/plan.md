

## Fix: Telegram bot silent failure for @dawsik11

### Diagnosis

The bot stopped responding to @dawsik11 since March 23 due to a **compounding failure loop**:

1. On March 23 at 09:59, the student sent a photo message. The AI call either timed out or failed silently
2. The user message was saved to DB **before** the AI call, but no assistant response was saved
3. The student retried 5 more times rapidly (4 photos + 2 text messages within 17 minutes)
4. Each retry added another user message to history — but still no assistant response
5. Now the last 8 messages (the bot's context window) are ALL user messages with zero assistant responses
6. The AI model (Gemini) receives a broken conversation with 8 consecutive user turns — no alternation — and fails or produces unusable output
7. Every subsequent attempt (March 26, March 30) hits the same broken history and fails again

This is a **user-specific** issue — no other users are affected (verified via query).

### Fix: Two parts

**Part 1: Immediate data repair** — Delete the orphaned consecutive user messages (keep only the latest) so the next bot interaction starts clean. Alternatively, insert a synthetic assistant message to restore turn-taking.

**Part 2: Code fix in `telegram-bot/index.ts`** — Prevent this from happening to any user in the future.

#### Code changes in `handleTextMessage` and `handlePhotoMessage`:

Before sending history to the AI, add a **consecutive user message merge** step after `compactHistoryForTelegram`:

```text
compactHistoryForTelegram(history)
  → mergeConsecutiveUserMessages(compacted)   ← NEW
  → refreshImageUrls(merged)
  → fetchChatWithTimeout(...)
```

`mergeConsecutiveUserMessages` logic:
- Walk through compacted messages
- If multiple consecutive `role: "user"` messages appear, merge their content into one (join with `\n\n`)
- Keep `image_url` from the last one (if any)
- This ensures the AI always sees proper turn-taking, even if previous calls failed

This is a 20-line helper function added once and called in both `handleTextMessage` (line ~6873) and `handlePhotoMessage` (line ~7360).

### Part 1 detail: Data repair migration

SQL to clean up this specific user's chat:

```sql
-- Delete orphaned user messages (keep latest 2, delete the 6 stale ones from March 23)
DELETE FROM chat_messages 
WHERE chat_id = '824206d7-5cfc-4919-8645-b68260f9b34f'
  AND role = 'user'
  AND created_at >= '2026-03-23'
  AND id NOT IN (
    SELECT id FROM chat_messages
    WHERE chat_id = '824206d7-5cfc-4919-8645-b68260f9b34f'
      AND role = 'user'
      AND created_at >= '2026-03-23'
    ORDER BY created_at DESC
    LIMIT 1
  );
```

### Files modified

- `supabase/functions/telegram-bot/index.ts` — add `mergeConsecutiveUserMessages()` helper, call it in `handleTextMessage` and `handlePhotoMessage`
- Database: one-time cleanup query for this user's orphaned messages
- Deploy `telegram-bot` edge function after code change

### Not changing

- `chat/index.ts` — no changes needed
- `homework-api/` — unrelated
- Frontend — unrelated

