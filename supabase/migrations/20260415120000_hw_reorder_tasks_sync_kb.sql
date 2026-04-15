-- Fix: hw_reorder_tasks now also re-maps homework_kb_tasks.sort_order.
--
-- Background: homework_api handleGetAssignment joins KB provenance
-- (source_label, kb_snapshot_solution, kb_snapshot_solution_image_refs) via
-- homework_kb_tasks.sort_order ↔ homework_tutor_tasks.order_num - 1. Before
-- this migration, reordering tasks updated order_num only, so after any tutor
-- reorder the KB source/solution landed on the wrong task on tutor surfaces.
-- This is a tutor-side data-correctness bug — not a student-isolation leak —
-- but it misattributes source labels and solution snapshots once the order
-- drifts from insert time.
--
-- Fix shape: snapshot the (task_id, old_order, new_order) mapping *before*
-- mutating homework_tutor_tasks, then apply the same shift to the KB link
-- table in a single atomic statement after the two-phase reorder completes.
-- homework_kb_tasks.sort_order has no UNIQUE constraint, so no phasing is
-- needed there — the temp snapshot acts as a consistent source that survives
-- the order_num rewrite above.

CREATE OR REPLACE FUNCTION public.hw_reorder_tasks(
  p_assignment_id UUID,
  p_task_order JSONB  -- array of { "id": uuid, "order_num": int }
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  item JSONB;
  task_id UUID;
  new_order INT;
  seen_orders INT[] := '{}';
BEGIN
  -- Validate input
  IF p_task_order IS NULL OR jsonb_array_length(p_task_order) = 0 THEN
    RETURN;
  END IF;

  -- Validate no duplicate order_num values
  FOR item IN SELECT * FROM jsonb_array_elements(p_task_order)
  LOOP
    new_order := (item ->> 'order_num')::INT;
    IF new_order = ANY(seen_orders) THEN
      RAISE EXCEPTION 'Duplicate order_num % in reorder payload', new_order;
    END IF;
    seen_orders := seen_orders || new_order;
  END LOOP;

  -- Snapshot old → new order_num mapping *before* mutating the tutor task
  -- table, so Phase 3 can reliably locate KB link rows by their current
  -- sort_order (= old_order - 1).
  CREATE TEMP TABLE IF NOT EXISTS _hw_reorder_snapshot (
    task_id   UUID PRIMARY KEY,
    old_order INT NOT NULL,
    new_order INT NOT NULL
  ) ON COMMIT DROP;
  TRUNCATE _hw_reorder_snapshot;

  INSERT INTO _hw_reorder_snapshot (task_id, old_order, new_order)
  SELECT
    t.id,
    t.order_num,
    (item ->> 'order_num')::INT
  FROM jsonb_array_elements(p_task_order) AS item
  JOIN public.homework_tutor_tasks t
    ON t.id = (item ->> 'id')::UUID
   AND t.assignment_id = p_assignment_id;

  -- Phase 1: Set all order_num to negative temporaries (avoids UNIQUE conflicts)
  FOR item IN SELECT * FROM jsonb_array_elements(p_task_order)
  LOOP
    task_id := (item ->> 'id')::UUID;
    new_order := (item ->> 'order_num')::INT;

    UPDATE public.homework_tutor_tasks
    SET order_num = -new_order
    WHERE id = task_id
      AND assignment_id = p_assignment_id;
  END LOOP;

  -- Phase 2: Set final positive order_num values
  FOR item IN SELECT * FROM jsonb_array_elements(p_task_order)
  LOOP
    task_id := (item ->> 'id')::UUID;
    new_order := (item ->> 'order_num')::INT;

    UPDATE public.homework_tutor_tasks
    SET order_num = new_order
    WHERE id = task_id
      AND assignment_id = p_assignment_id;
  END LOOP;

  -- Phase 3: Re-map homework_kb_tasks.sort_order to follow the new order.
  -- Join on pre-mutation old_order - 1 via the snapshot, assign new_order - 1.
  -- Rows that don't match the snapshot (orphaned KB links from previously
  -- deleted tutor tasks, or legacy imports with drifted sort_order) are left
  -- untouched — not strictly correct, but not worse than today and outside
  -- the scope of this fix.
  UPDATE public.homework_kb_tasks kb
  SET sort_order = s.new_order - 1
  FROM _hw_reorder_snapshot s
  WHERE kb.homework_id = p_assignment_id
    AND kb.sort_order = s.old_order - 1;
END;
$$;

-- Preserve original grants (idempotent re-assertion after CREATE OR REPLACE).
REVOKE ALL ON FUNCTION public.hw_reorder_tasks(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hw_reorder_tasks(UUID, JSONB) TO service_role;
