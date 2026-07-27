-- =============================================================================
-- Восстановление auto-replace семантики single-primary триггера.
--
-- Найдено на QA 2026-07-27 (редактор состава групп): перевод ученика в другую
-- ОСНОВНУЮ группу падал «student already has an active primary group».
-- Корень: 20260618120000 задал auto-replace (+ ownership-гарды), но Lovable-
-- сгенерированная 20260619065643 (днём позже) МОЛЧА перезаписала функцию
-- RAISE-версией. Латентный прод-баг с 19.06: смена группы через профиль
-- ученика, AddStudentDialog (existing) и редактор состава — все падали.
-- Клиентский код везде написан против auto-replace (комментарии в tutors.ts,
-- rule 100 «DB-триггер сам заменит прежнюю основную группу»).
--
-- Эта миграция = тело из 20260618120000 (auto-replace + ownership defense-in-
-- depth) + hardening из 20260619065643 (SECURITY DEFINER, search_path).
-- Без рекурсии: деактивируемые строки получают is_active=false → IF ложно.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.tutor_group_memberships_single_primary_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Ownership (defense-in-depth поверх RLS): student И группа должны
  -- принадлежать тому же репетитору, что и membership.
  IF NOT EXISTS (
    SELECT 1 FROM public.tutor_students s
    WHERE s.id = NEW.tutor_student_id AND s.tutor_id = NEW.tutor_id
  ) THEN
    RAISE EXCEPTION 'tutor_student % does not belong to tutor %', NEW.tutor_student_id, NEW.tutor_id
      USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.tutor_groups g
    WHERE g.id = NEW.tutor_group_id AND g.tutor_id = NEW.tutor_id
  ) THEN
    RAISE EXCEPTION 'tutor_group % does not belong to tutor %', NEW.tutor_group_id, NEW.tutor_id
      USING ERRCODE = '42501';
  END IF;

  -- Активация membership в ОСНОВНОЙ группе → деактивировать прочие активные
  -- основные membership этого ученика (auto-replace). Метки не ограничены.
  IF NEW.is_active AND EXISTS (
    SELECT 1 FROM public.tutor_groups g
    WHERE g.id = NEW.tutor_group_id AND g.is_primary = true
  ) THEN
    UPDATE public.tutor_group_memberships m
      SET is_active = false
      WHERE m.tutor_student_id = NEW.tutor_student_id
        AND m.id <> NEW.id
        AND m.is_active = true
        AND m.tutor_group_id <> NEW.tutor_group_id
        AND EXISTS (
          SELECT 1 FROM public.tutor_groups g2
          WHERE g2.id = m.tutor_group_id AND g2.is_primary = true
        );
  END IF;

  RETURN NEW;
END;
$$;

-- Один канонический триггер (в проде жил под именем без trg_-префикса из 0619,
-- в репо 0618 — с префиксом; дропаем оба, создаём один).
DROP TRIGGER IF EXISTS tutor_group_memberships_single_primary_guard
  ON public.tutor_group_memberships;
DROP TRIGGER IF EXISTS trg_tutor_group_memberships_single_primary
  ON public.tutor_group_memberships;

CREATE TRIGGER trg_tutor_group_memberships_single_primary
  BEFORE INSERT OR UPDATE ON public.tutor_group_memberships
  FOR EACH ROW EXECUTE FUNCTION public.tutor_group_memberships_single_primary_guard();

NOTIFY pgrst, 'reload schema';
