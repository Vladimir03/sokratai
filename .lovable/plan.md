

## Problem

When someone mentions `@sokratai_ru_bot` in a group chat, the bot responds in the user's **private DM** instead of the group. The logs prove this:

- The update arrives with `"type": "group"` and `chat.id: -5215652476`
- But the log shows `Handling text message: { telegramUserId: 385567670 }` — this is the **private chat handler**, not the group handler (which would log `📢 Handling group text message`)

This means the **deployed version** of `telegram-bot` does not contain the group chat handling code (lines 7858-7923 in the source). The private chat handler at line 8138 catches the message and sends the response to `telegramUserId` (user's DM) instead of the group chat.

## Root Cause

The `telegram-bot` edge function source code already has correct group chat handling — it replies to the group chat with `reply_to_message_id`. But the **currently deployed version is stale** and lacks this code.

## Fix

1. **Redeploy `telegram-bot`** — no code changes needed, the source is already correct
2. **Verify `TELEGRAM_BOT_USERNAME` secret** equals `sokratai_ru_bot` (the env var default is `SokratAIBot` which won't match the actual bot username in mention entities)

The existing group handler (line 6941 `handleGroupTextMessage`) already:
- Sends responses to `groupChatId` (not `telegramUserId`)
- Uses `reply_to_message_id` to reply to the original message
- Properly extracts mentions and reply-to-bot context

