

## Fix: Homework not visible in Telegram bot + Notification delivery failures

### Root Cause Analysis

**Issue 1: Homework not appearing in Telegram bot for students**

The `handleHomeworkCommand` function resolves the canonical user ID from `profiles.telegram_user_id` but then **ignores it**, using only `userId` from `telegram_sessions` for all queries:

```text
Line 2454: canonicalUserId = resolveCanonicalUserIdByTelegram(telegramUserId)  // correct ID
Line 2459: setHomeworkState(userId, ...)                                        // session ID
Line 2461: getActiveHomeworkAssignmentsForStudent(userId)                       // session ID (!)
```

Database evidence: Analyst_Vladimir (telegram_user_id=385567670) has:
- `profiles.id` = `3c9e408c-...` (homework is assigned to THIS id)
- `telegram_sessions.user_id` = `420b1476-...` (this is the tutor Vladmir's account)

The `getOrRepairOnboardingSession` should auto-repair this, but `handleHomeworkCommand` should also defensively use the canonical ID.

**Issue 2: Notifications not delivered**

All 9 student assignments from tutor Milada have `notified=false`. The notify endpoint sends Telegram messages using `parse_mode: "Markdown"` (v1) but uses `escapeMarkdown` designed for MarkdownV2, which can cause rendering issues. More critically, the notify function doesn't retry on transient failures or distinguish between "user blocked bot" vs "temporary error".

### Changes

**1. `supabase/functions/telegram-bot/index.ts` -- Use canonical user ID in homework handlers**

In `handleHomeworkCommand` (line 2452), change the effective user ID used for queries to prefer canonical:

```typescript
const effectiveUserId = canonicalUserId ?? userId;
await setHomeworkState(effectiveUserId, "HW_SELECTING", {});
const assignments = await getActiveHomeworkAssignmentsForStudent(effectiveUserId);
const visibilityStats = await getHomeworkAssignmentVisibilityStatsForStudent(effectiveUserId);
```

Apply the same pattern in all downstream homework handlers that receive `userId` from session:
- `handleHomeworkStartCallback` -- resolve canonical before querying assignments/submissions
- `handleHomeworkNextCallback`, `handleHomeworkSubmitCallback` -- use canonical for state reads
- `handleHomeworkTextInput`, `handleHomeworkPhotoInput` -- use canonical for state and DB updates

Add a helper function at the top of the homework section:
```typescript
async function resolveHomeworkUserId(telegramUserId: number, sessionUserId: string): Promise<string> {
  const canonical = await resolveCanonicalUserIdByTelegram(telegramUserId);
  return canonical?.id ?? sessionUserId;
}
```

**2. `supabase/functions/homework-api/index.ts` -- Fix notification reliability**

In `handleNotifyStudents` (line 897):
- Switch from `parse_mode: "Markdown"` to `parse_mode: "HTML"` for the default message template (more reliable, consistent with the rest of the bot)
- Format message as HTML: `<b>title</b>` instead of `*title*`
- Remove `escapeMarkdown` usage (use HTML escaping instead)
- Add a simple retry (1 retry after 500ms) for transient Telegram API failures (status 429 or 5xx)
- Log the actual Telegram response body on failure for debugging

**3. Data fix for Analyst_Vladimir**

The `telegram_sessions` record for telegram_user_id=385567670 currently points to user_id=`420b1476-...` (tutor). The auto-repair in `getOrRepairOnboardingSession` will fix this when the student next types any command. Change #1 ensures homework works even before the repair happens.

### What is NOT changed

- No database migrations
- No changes to AuthGuard, TutorGuard, or student UI components
- No changes to the homework state machine or AI check flow
- No changes to `src/components/ui/`
- Existing homework flow (create, assign, submit, review) remains intact

### Deploy steps

1. Apply changes to `telegram-bot/index.ts` and `homework-api/index.ts`
2. Deploy both edge functions: `telegram-bot` and `homework-api`
3. Ask tutor Milada to re-send notifications (click "Уведомить" on existing assignments, or create a new test assignment)
4. Ask students to try `/homework` in the bot

