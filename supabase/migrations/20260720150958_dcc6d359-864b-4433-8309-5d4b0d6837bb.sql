-- (а) Родитель другого владельца → отцепить
UPDATE public.homework_folders f
SET parent_id = NULL
FROM public.homework_folders p
WHERE f.parent_id = p.id
  AND f.tutor_id <> p.tutor_id;

-- (б) Циклические компоненты (недостижимые от корней) → отцепить в корень
WITH RECURSIVE reachable AS (
  SELECT id FROM public.homework_folders WHERE parent_id IS NULL
  UNION ALL
  SELECT c.id
  FROM public.homework_folders c
  JOIN reachable r ON c.parent_id = r.id
)
UPDATE public.homework_folders f
SET parent_id = NULL
WHERE f.parent_id IS NOT NULL
  AND f.id NOT IN (SELECT id FROM reachable);

CREATE OR REPLACE FUNCTION public.hw_folder_parent_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  cur UUID;
  steps INT := 0;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.parent_id = NEW.id THEN
    RAISE EXCEPTION 'homework folder cycle detected for folder %', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('hw_folder_tree'), hashtext(NEW.tutor_id::text));

  IF NOT public.homework_folder_owned_by(NEW.parent_id, NEW.tutor_id) THEN
    RAISE EXCEPTION 'homework folder parent % does not belong to folder owner', NEW.parent_id
      USING ERRCODE = 'check_violation';
  END IF;

  cur := NEW.parent_id;
  WHILE cur IS NOT NULL LOOP
    IF cur = NEW.id THEN
      RAISE EXCEPTION 'homework folder cycle detected for folder %', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
    steps := steps + 1;
    IF steps > 50 THEN
      RAISE EXCEPTION 'homework folder tree too deep (max 50)'
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT parent_id INTO cur FROM public.homework_folders WHERE id = cur;
  END LOOP;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.hw_folder_parent_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hw_folder_parent_guard() FROM anon, authenticated;

DROP TRIGGER IF EXISTS trg_hw_folder_parent_guard ON public.homework_folders;
CREATE TRIGGER trg_hw_folder_parent_guard
  BEFORE INSERT OR UPDATE OF parent_id ON public.homework_folders
  FOR EACH ROW
  EXECUTE FUNCTION public.hw_folder_parent_guard();