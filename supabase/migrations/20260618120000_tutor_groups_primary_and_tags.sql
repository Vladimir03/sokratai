-- =============================================================================
-- Организация учеников v1: основная группа + метки (запрос Елены/Егора, 2026-06-18)
--
-- Расширяем СУЩЕСТВУЮЩУЮ tutor_groups флагом is_primary (просьба Елены — не плодить
-- новые сущности; модель Егора main/additional):
--   • is_primary=true  — учебная (основная) группа: ≤1 активная на ученика, хостит
--                        групповые занятия (group_source_tutor_group_id) + дефолтная
--                        группировка списка учеников. = сегодняшнее поведение.
--   • is_primary=false — метка (#интенсив/#прогульщик/#11класс): ∞ на ученика, для
--                        фильтра и массовой выдачи ДЗ.
--
-- Аддитивно: новая колонка + замена ограничения «одна группа» на guard-триггер
-- «≤1 активная ОСНОВНАЯ группа». Дроп индекса (НЕ колонки) разрешён DB-правилами.
-- Plan: ~/.claude/plans/crispy-soaring-lobster.md
-- =============================================================================

-- 1) Флаг «основная группа / метка». Новые группы по умолчанию = метки.
ALTER TABLE public.tutor_groups
  ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.tutor_groups.is_primary IS
  'true = учебная (основная) группа: ≤1 активная на ученика, хостит групповые занятия + дефолтная группировка. false = метка (тег): ∞ на ученика, для фильтра/массовой выдачи.';

-- Backfill: все существующие группы — учебные (их использует групповое расписание
-- через group_source_tutor_group_id). One-shot: код создания меток (is_primary=false)
-- деплоится ВМЕСТЕ с этой миграцией, поэтому на момент первого применения строк
-- is_primary=false ещё нет → флипаем именно прежние учебные группы, не метки.
UPDATE public.tutor_groups SET is_primary = true WHERE is_primary = false;

-- 2) Снимаем «одна активная группа на ученика» — теперь несколько меток + ≤1 основная.
-- Дубль-гард idx_tutor_group_memberships_student_group_unique (student, group) остаётся.
DROP INDEX IF EXISTS public.idx_tutor_group_memberships_active_student_unique;

-- 3) Guard: ≤1 активная ОСНОВНАЯ группа на ученика (заменяет снятый индекс).
-- При активации membership в основной группе — деактивируем прочие активные основные
-- membership этого ученика (auto-replace, mirror прежнего JS «deactivate others» из
-- upsertTutorGroupMembership). Метки (is_primary=false) НЕ ограничены. Защищает и
-- прямой PostgREST-write (RLS пускает authenticated INSERT/UPDATE напрямую).
-- Без рекурсии: деактивируемые строки получают is_active=false → условие IF ложно.
CREATE OR REPLACE FUNCTION public.tutor_group_memberships_single_primary_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Ownership (defense-in-depth поверх RLS, review P1): student И группа должны
  -- принадлежать тому же репетитору, что и membership. RLS WITH CHECK проверяет
  -- только membership.tutor_id → без этого прямой PostgREST-write мог бы привязать
  -- чужой tutor_student_id/tutor_group_id (если знать UUID). Тег-UI расширил write-surface.
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

DROP TRIGGER IF EXISTS trg_tutor_group_memberships_single_primary ON public.tutor_group_memberships;
CREATE TRIGGER trg_tutor_group_memberships_single_primary
  BEFORE INSERT OR UPDATE ON public.tutor_group_memberships
  FOR EACH ROW EXECUTE FUNCTION public.tutor_group_memberships_single_primary_guard();
