## Plan: Remove /homework from Telegram bot + update notification messages

### What's changing

The `/homework` command in the Telegram bot is being removed because students now do homework through the web app, not the bot. The bot should direct students to the web link instead.

### Changes

**1. `supabase/functions/telegram-bot/index.ts**`

- Remove `{ command: "homework", description: "Режим домашки" }` from `setMyCommands()` (line 705)
- Remove the `/homework` command handler block (~line 8201-8210) — respond with a message redirecting to web app instead, or just ignore
- Keep the homework state machine imports and handlers for now (they handle callback flows from old messages) — but the `/homework` entry point is removed
- Remove `{ command: "cancel", description: "Отмена текущего режима" }` from menu (it was only relevant for homework mode)

**2. `supabase/functions/homework-api/index.ts**` (line 1357)

- Update `defaultMessage` — remove any reference to `/homework`. Current message already uses a web link (`<a href="...">Открыть ДЗ</a>`), which is correct. No change needed here.

**3. `supabase/functions/homework-reminder/index.ts**` (line 272)

- Change Telegram reminder text: replace `нажми /homework и отправь ответы сейчас!` with a web link to the homework

**4. `src/components/tutor/homework-create/HWAssignSection.tsx**` (line 339)

- Update placeholder from `"Новая домашка! Используй /homework чтобы начать."` to something like `"Новая домашка! Открой ссылку выше, чтобы начать."`

**5. Deploy**

- Deploy `telegram-bot` and `homework-reminder` edge functions
- Trigger `?action=set_commands` on the bot to refresh the Telegram menu

### Not changing

- Homework handler code (`homework/state_machine.ts`, `homework/homework_handler.ts`) — kept for backward compatibility with any in-progress sessions
- `homework-api/index.ts` default message — already uses web link, no `/homework` reference
- Push/email notification templates — no `/homework` references