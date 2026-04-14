

## Plan: Add Telegram username change in student profile

### Problem
Students cannot change their Telegram username from the profile page. If a tutor entered a Telegram username for the student, the student should be able to update it themselves.

### Changes

#### 1. Add `update-telegram` action to `supabase/functions/student-account/index.ts`

New action that updates `profiles.telegram_username` for the authenticated user:
- Accepts `{ action: "update-telegram", telegram_username: string }`
- Normalizes the username (strips `@`, trims whitespace)
- Validates format (alphanumeric + underscores, 5-32 chars per Telegram rules)
- Updates `profiles.telegram_username` via service_role client
- Returns the updated username

#### 2. Update `src/pages/Profile.tsx` — add Telegram username edit UI

In the Telegram card (lines 680-768), add an editable field for `telegram_username`:
- When Telegram is connected (has `telegram_user_id`): show current username with an edit option below it
- When Telegram is NOT connected: show an input to set/change the telegram username, plus the existing "Связать Telegram" button

The UI will mirror the email change pattern:
- Input field for new Telegram username (with `@` prefix hint)
- "Сохранить" button that calls `student-account` with `action: "update-telegram"`
- Success updates the local profile state

#### 3. Redeploy `student-account` edge function

### Technical details
- The `telegram_username` lives in `profiles` table (public schema), not in `auth.users`
- The edge function uses `service_role` to bypass RLS on profiles
- No migration needed — `profiles.telegram_username` column already exists

