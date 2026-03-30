-- ════════════════════════════════════════════
-- fetch_catalog_tasks_all: same as v2 but includes hidden_duplicate/unpublished
-- for moderators. Regular users still see only active tasks.
-- ════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fetch_catalog_tasks_all(p_topic_id UUID)
RETURNS SETOF public.kb_tasks
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.*
  FROM kb_tasks t
  WHERE t.topic_id = p_topic_id
    AND t.owner_id IS NULL
    AND (
      t.moderation_status = 'active'
      OR has_role(auth.uid(), 'moderator')
    )
  ORDER BY t.moderation_status, t.created_at;
$$;

COMMENT ON FUNCTION public.fetch_catalog_tasks_all IS
  'Returns catalog tasks for a topic. Moderators see all statuses; others see only active.';
