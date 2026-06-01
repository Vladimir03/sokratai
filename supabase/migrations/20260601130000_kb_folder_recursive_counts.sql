-- Recursive task counts for personal KB folders ("Моя база").
--
-- The folder card shows "N задач". Previously the client counted only DIRECT
-- tasks of a folder, so a folder whose tasks live in nested subfolders showed 0.
-- A pure client-side recursive count would have to read every folder + every
-- personal task row and could be silently truncated by the PostgREST max-rows
-- cap (default 1000) once a tutor's KB grows large (e.g. a catalog moderator).
--
-- This RPC computes, per folder owned by the caller:
--   * recursive_task_count — tasks in the folder AND all nested subfolders (any depth)
--   * direct_child_count    — number of immediate subfolders
-- entirely server-side, so it never hits the row cap and never over-fetches.

CREATE OR REPLACE FUNCTION public.kb_folder_recursive_counts()
RETURNS TABLE (
  folder_id uuid,
  recursive_task_count integer,
  direct_child_count integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH RECURSIVE owned AS (
    SELECT f.id, f.parent_id
    FROM public.kb_folders f
    WHERE f.owner_id = auth.uid()
  ),
  -- (root_id, node_id) for every folder and each of its descendants (incl. itself)
  subtree AS (
    SELECT o.id AS root_id, o.id AS node_id
    FROM owned o
    UNION ALL
    SELECT s.root_id, c.id
    FROM subtree s
    JOIN owned c ON c.parent_id = s.node_id
  ),
  task_counts AS (
    SELECT t.folder_id, COUNT(*)::int AS cnt
    FROM public.kb_tasks t
    WHERE t.owner_id = auth.uid() AND t.folder_id IS NOT NULL
    GROUP BY t.folder_id
  ),
  recursive_counts AS (
    SELECT st.root_id AS folder_id,
           COALESCE(SUM(tc.cnt), 0)::int AS recursive_task_count
    FROM subtree st
    LEFT JOIN task_counts tc ON tc.folder_id = st.node_id
    GROUP BY st.root_id
  ),
  child_counts AS (
    SELECT o.parent_id AS folder_id, COUNT(*)::int AS direct_child_count
    FROM owned o
    WHERE o.parent_id IS NOT NULL
    GROUP BY o.parent_id
  )
  SELECT rc.folder_id,
         rc.recursive_task_count,
         COALESCE(cc.direct_child_count, 0)::int AS direct_child_count
  FROM recursive_counts rc
  LEFT JOIN child_counts cc ON cc.folder_id = rc.folder_id;
$$;

COMMENT ON FUNCTION public.kb_folder_recursive_counts() IS
  'Per-folder counts for the caller''s personal KB: recursive_task_count = tasks in the folder + all nested subfolders (any depth); direct_child_count = immediate subfolders. Scoped to auth.uid(); server-side aggregation avoids the PostgREST max-rows truncation a client-side count would suffer.';

REVOKE ALL ON FUNCTION public.kb_folder_recursive_counts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kb_folder_recursive_counts() TO authenticated;
