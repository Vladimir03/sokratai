REVOKE ALL ON FUNCTION public.yookassa_record_refund(TEXT, TEXT, NUMERIC, TEXT, JSONB)
  FROM anon, authenticated;

-- service_role retains EXECUTE (grant from 20260715130000 remains untouched).