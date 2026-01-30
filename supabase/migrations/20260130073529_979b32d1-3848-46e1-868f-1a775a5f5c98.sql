-- Add RLS policy for admins to view all payments
CREATE POLICY "Admins can view all payments"
  ON public.payments FOR SELECT
  USING (has_role(auth.uid(), 'admin') OR is_admin_email(auth.uid()));