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