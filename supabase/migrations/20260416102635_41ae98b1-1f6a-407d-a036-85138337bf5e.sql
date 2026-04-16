CREATE OR REPLACE FUNCTION public.hw_reorder_tasks(
  p_assignment_id UUID,
  p_task_order JSONB
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
  IF p_task_order IS NULL OR jsonb_array_length(p_task_order) = 0 THEN
    RETURN;
  END IF;

  FOR item IN SELECT * FROM jsonb_array_elements(p_task_order)
  LOOP
    new_order := (item ->> 'order_num')::INT;
    IF new_order = ANY(seen_orders) THEN
      RAISE EXCEPTION 'Duplicate order_num % in reorder payload', new_order;
    END IF;
    seen_orders := seen_orders || new_order;
  END LOOP;

  CREATE TEMP TABLE IF NOT EXISTS _hw_reorder_snapshot (
    task_id UUID PRIMARY KEY,
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

  FOR item IN SELECT * FROM jsonb_array_elements(p_task_order)
  LOOP
    task_id := (item ->> 'id')::UUID;
    new_order := (item ->> 'order_num')::INT;

    UPDATE public.homework_tutor_tasks
    SET order_num = -new_order
    WHERE id = task_id
      AND assignment_id = p_assignment_id;
  END LOOP;

  FOR item IN SELECT * FROM jsonb_array_elements(p_task_order)
  LOOP
    task_id := (item ->> 'id')::UUID;
    new_order := (item ->> 'order_num')::INT;

    UPDATE public.homework_tutor_tasks
    SET order_num = new_order
    WHERE id = task_id
      AND assignment_id = p_assignment_id;
  END LOOP;

  UPDATE public.homework_kb_tasks kb
  SET sort_order = s.new_order - 1
  FROM _hw_reorder_snapshot s
  WHERE kb.homework_id = p_assignment_id
    AND kb.sort_order = s.old_order - 1;
END;
$$;

REVOKE ALL ON FUNCTION public.hw_reorder_tasks(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hw_reorder_tasks(UUID, JSONB) TO service_role;