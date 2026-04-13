

## Plan: Fix password reset — 6-digit password

### Problem
Edge function `tutor-manual-add-student` generates 4-digit passwords, but Supabase Auth requires minimum 6 characters. Logs confirm: `AuthWeakPasswordError: Password should be at least 6 characters`.

### Changes

#### 1. `supabase/functions/tutor-manual-add-student/index.ts`
- Rename `generateFourDigitPassword` to `generatePassword`
- Change from 4-digit to 6-digit generation: `Math.floor(100000 + Math.random() * 900000).toString()`
- Update both call sites (reset flow ~line 125, create user flow ~line 218)

#### 2. Redeploy edge function
Deploy `tutor-manual-add-student` after the fix.

#### 3. Frontend: update Login.tsx validation back to 6
The last diff changed password min from 6 to 4 — revert to `min(6)` since passwords are now 6 digits.

