-- Atomic task reorder for homework assignments.
-- Uses two-phase approach inside a single transaction to avoid
-- UNIQUE(assignment_id, order_num) constraint violations.

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
END;
$$;

-- Only service_role should call this (via edge function)
REVOKE ALL ON FUNCTION public.hw_reorder_tasks(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hw_reorder_tasks(UUID, JSONB) TO service_role;
