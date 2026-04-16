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
  _item JSONB;
  _task_id UUID;
  _new_order INT;
  _seen_orders INT[] := '{}';
BEGIN
  IF p_task_order IS NULL OR jsonb_array_length(p_task_order) = 0 THEN
    RETURN;
  END IF;

  FOR _item IN SELECT value FROM jsonb_array_elements(p_task_order)
  LOOP
    _new_order := (_item ->> 'order_num')::INT;
    IF _new_order = ANY(_seen_orders) THEN
      RAISE EXCEPTION 'Duplicate order_num % in reorder payload', _new_order;
    END IF;
    _seen_orders := _seen_orders || _new_order;
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
    (elem.value ->> 'order_num')::INT
  FROM jsonb_array_elements(p_task_order) AS elem
  JOIN public.homework_tutor_tasks t
    ON t.id = (elem.value ->> 'id')::UUID
   AND t.assignment_id = p_assignment_id;

  FOR _item IN SELECT value FROM jsonb_array_elements(p_task_order)
  LOOP
    _task_id := (_item ->> 'id')::UUID;
    _new_order := (_item ->> 'order_num')::INT;

    UPDATE public.homework_tutor_tasks
    SET order_num = -_new_order
    WHERE id = _task_id
      AND assignment_id = p_assignment_id;
  END LOOP;

  FOR _item IN SELECT value FROM jsonb_array_elements(p_task_order)
  LOOP
    _task_id := (_item ->> 'id')::UUID;
    _new_order := (_item ->> 'order_num')::INT;

    UPDATE public.homework_tutor_tasks
    SET order_num = _new_order
    WHERE id = _task_id
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