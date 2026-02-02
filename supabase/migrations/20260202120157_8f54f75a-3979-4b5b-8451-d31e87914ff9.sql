-- Add RLS policy for public access to tutors by invite_code
-- This allows unauthenticated users to view tutor info when they have the invite code

CREATE POLICY "Anyone can view tutor by invite_code"
  ON public.tutors FOR SELECT
  USING (invite_code IS NOT NULL);