

## Plan: Activate auth-email-hook for password reset emails

### Problem
The `auth-email-hook` edge function exists and is deployed, the email domain is verified, and the queue infrastructure is working — but the hook is **not activated** as Supabase Auth's send-email hook. Evidence:
- No recovery events appear in `auth-email-hook` logs (only boot/shutdown)
- No `recovery` entries in `email_send_log`
- The signup confirmation email arrived with `[Test]` prefix — this is the default Supabase template, not our custom one

The hook was deployed but the activation step (which connects it to Supabase Auth's email pipeline) was never completed.

### Fix

1. **Re-scaffold auth email templates** — this triggers the activation workflow that registers `auth-email-hook` as Supabase Auth's send-email hook
2. **Redeploy `auth-email-hook`** — ensures the latest code is live and completes the activation
3. **Verify** — request a password reset and check that the recovery event appears in logs and `email_send_log`

No code changes needed — just re-running the scaffold + deploy to trigger the activation pipeline.

### Expected result
After activation, both signup confirmation AND password reset emails will be sent through our custom branded templates via the email queue, arriving from `noreply@sokratai.ru`.

