-- Manual CRM tags for pilot tracking (CEO-managed, separate from system fields)
CREATE TABLE public.tutor_pilot_crm (
  tutor_user_id UUID PRIMARY KEY,
  is_pilot BOOLEAN NOT NULL DEFAULT false,
  willing_to_pay TEXT NOT NULL DEFAULT 'unknown' CHECK (willing_to_pay IN ('yes','maybe','no','unknown')),
  risk_status TEXT NOT NULL DEFAULT 'healthy' CHECK (risk_status IN ('healthy','watch','at_risk')),
  key_pain TEXT,
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID
);

CREATE INDEX idx_tutor_pilot_crm_is_pilot ON public.tutor_pilot_crm(is_pilot) WHERE is_pilot = true;
CREATE INDEX idx_tutor_pilot_crm_risk ON public.tutor_pilot_crm(risk_status);

ALTER TABLE public.tutor_pilot_crm ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view pilot CRM"
ON public.tutor_pilot_crm FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR is_admin_email(auth.uid()));

CREATE POLICY "Admins can insert pilot CRM"
ON public.tutor_pilot_crm FOR INSERT
TO authenticated
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR is_admin_email(auth.uid()));

CREATE POLICY "Admins can update pilot CRM"
ON public.tutor_pilot_crm FOR UPDATE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR is_admin_email(auth.uid()))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR is_admin_email(auth.uid()));

CREATE POLICY "Admins can delete pilot CRM"
ON public.tutor_pilot_crm FOR DELETE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR is_admin_email(auth.uid()));

-- Inline trigger function for updated_at
CREATE OR REPLACE FUNCTION public.tutor_pilot_crm_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_tutor_pilot_crm_updated_at
BEFORE UPDATE ON public.tutor_pilot_crm
FOR EACH ROW
EXECUTE FUNCTION public.tutor_pilot_crm_set_updated_at();