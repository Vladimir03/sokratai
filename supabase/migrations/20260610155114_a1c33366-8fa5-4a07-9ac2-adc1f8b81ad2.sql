REVOKE SELECT ON public.tutor_ledger_seed_runs FROM authenticated;
ALTER TABLE public.tutor_ledger_seed_runs ENABLE ROW LEVEL SECURITY;
-- No policies → only service_role (bypasses RLS) can access. Marker table is internal.