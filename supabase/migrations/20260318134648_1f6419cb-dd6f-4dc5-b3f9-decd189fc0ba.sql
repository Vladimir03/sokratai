-- Fix security_definer_view warning on kb_topics_with_counts
ALTER VIEW public.kb_topics_with_counts SET (security_invoker = on);