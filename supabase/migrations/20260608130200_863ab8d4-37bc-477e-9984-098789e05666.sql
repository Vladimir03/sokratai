
DROP POLICY IF EXISTS "Service role full access" ON public.daily_message_limits;
DROP POLICY IF EXISTS "Service role can manage all payments" ON public.payments;
DROP POLICY IF EXISTS "Service role can insert solutions" ON public.solutions;
DROP POLICY IF EXISTS "Service role can manage telegram sessions" ON public.telegram_sessions;
