# Safe Change Policy

- Keep edits minimal and task-focused.
- Do not change business logic, auth flows, or public APIs unless explicitly requested.
- Do not update dependencies unless explicitly requested.
- Avoid broad refactors in unrelated files.

High-risk files (edit only when task requires):

- `src/components/AuthGuard.tsx`
- `src/components/TutorGuard.tsx`
- `src/pages/Chat.tsx`
- `src/pages/tutor/TutorSchedule.tsx`
- `supabase/functions/telegram-bot/index.ts`

Architecture boundaries:

- Keep Student and Tutor modules isolated.
- Keep `src/components/ui/*` lightweight.
