-- Fix 1: broadcast_logs — drop overly permissive policy, add admin-only
DROP POLICY IF EXISTS "Service role full access" ON broadcast_logs;

CREATE POLICY "Admins can view broadcast logs"
  ON broadcast_logs FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can manage broadcast logs"
  ON broadcast_logs FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Fix 2: telegram_login_tokens — drop overly permissive policy
DROP POLICY IF EXISTS "Service role full access" ON telegram_login_tokens;

-- No explicit policy needed — service_role bypasses RLS automatically.
-- The telegram-login-token edge function uses service_role key to read/write tokens.