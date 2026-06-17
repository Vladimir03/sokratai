-- =============================================================================
-- Defense-in-depth: folder_id у ДЗ обязан принадлежать тому же владельцу (tutor_id).
-- Code review P1 (ChatGPT-5.5): edge `validateOwnedFolderId` валидирует только
-- путь homework-api; прямой PostgREST UPDATE своего ДЗ (RLS разрешает по tutor_id)
-- мог выставить folder_id ЧУЖОЙ папки → ДЗ «пропадает» из folder-first UI.
-- Не cross-tenant leak (чужой тутор папку/ДЗ не видит), но tenant-integrity gap.
--
-- Триггер покрывает ВСЕ write-path (client direct / edge service_role / будущие
-- import-скрипты) — надёжнее, чем RLS WITH CHECK (RLS не действует на service_role).
-- Реюз SECURITY DEFINER хелпера homework_folder_owned_by (миграция 20260617120000).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.hw_assignment_folder_owner_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.folder_id IS NOT NULL
     AND NOT public.homework_folder_owned_by(NEW.folder_id, NEW.tutor_id) THEN
    RAISE EXCEPTION 'folder_id % does not belong to assignment owner', NEW.folder_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- BEFORE INSERT (всегда) + UPDATE OF folder_id (только когда folder_id в SET).
DROP TRIGGER IF EXISTS trg_hw_assignment_folder_owner_guard ON public.homework_tutor_assignments;
CREATE TRIGGER trg_hw_assignment_folder_owner_guard
  BEFORE INSERT OR UPDATE OF folder_id ON public.homework_tutor_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.hw_assignment_folder_owner_guard();
