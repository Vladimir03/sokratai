-- Fix: Enable SECURITY INVOKER on problems_public view to respect RLS policies
-- This prevents the view from bypassing RLS by using the creator's privileges
ALTER VIEW public.problems_public SET (security_invoker = on);