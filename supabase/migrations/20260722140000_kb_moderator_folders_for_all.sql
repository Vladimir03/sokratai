-- Папки модератора («сократ» + «Черновики для сократа») — ВСЕМ модераторам.
--
-- Проблема (обнаружена 2026-07-22, репорт владельца «папка сократ только у Егора»):
-- онбординг-миграции (20260706140000 Милада, 20260712120000 Эмилия+Светлана)
-- идемпотентны, но при отсутствии аккаунта делают `CONTINUE` с NOTICE. Милада и
-- Светлана зарегистрировались ПОСЛЕ прогона своих миграций → ветка была no-op,
-- роли им выдали позже вручную, а папки так и не появились. Третий случай подряд
-- → лечим не разовым бэкфиллом по списку email'ов, а системно.
--
-- Что делает миграция:
--   1) хелпер `kb_ensure_moderator_folders(uid)` — идемпотентное создание обеих папок;
--   2) бэкфилл по ВСЕМ текущим модераторам (без хардкода email'ов);
--   3) триггер на `user_roles`: будущий модератор получает папки автоматически.
--
-- КРИТИЧНО про имя «сократ»: `kb_is_in_socrat_tree` сравнивает `_name = 'сократ'`
-- — точное совпадение, РЕГИСТРОЗАВИСИМО и без trim (+ требует роль moderator у
-- владельца корня). Любой другой регистр/пробел = авто-публикация не сработает.
-- Поэтому existence-check для «сократ» — строго по `name = 'сократ'`, чтобы
-- вариант «Сократ» не заблокировал создание рабочей папки.
-- «Черновики для сократа» магии не несёт (чистая конвенция) → проверяем
-- регистронезависимо, чтобы не плодить дубль у Егора («Черновики для Сократа»).

-- ── 1. Переиспользуемый хелпер ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.kb_ensure_moderator_folders(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF p_user_id IS NULL THEN RETURN; END IF;

  -- «сократ» — якорь авто-публикации в каталог. Имя строго 'сократ'.
  IF NOT EXISTS (
    SELECT 1 FROM public.kb_folders
     WHERE owner_id = p_user_id AND parent_id IS NULL AND name = 'сократ'
  ) THEN
    INSERT INTO public.kb_folders (owner_id, parent_id, name, sort_order)
    VALUES (p_user_id, NULL, 'сократ', 1);
  END IF;

  -- «Черновики для сократа» — скрытая папка ревью до публикации (конвенция).
  IF NOT EXISTS (
    SELECT 1 FROM public.kb_folders
     WHERE owner_id = p_user_id AND parent_id IS NULL
       AND lower(name) = lower('Черновики для сократа')
  ) THEN
    INSERT INTO public.kb_folders (owner_id, parent_id, name, sort_order)
    VALUES (p_user_id, NULL, 'Черновики для сократа', 0);
  END IF;
END;
$$;

-- Служебный хелпер: клиенту не нужен (папки создаются миграцией/триггером).
REVOKE EXECUTE ON FUNCTION public.kb_ensure_moderator_folders(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.kb_ensure_moderator_folders(UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kb_ensure_moderator_folders(UUID) TO service_role;

-- ── 2. Бэкфилл всем текущим модераторам ───────────────────────────────────────
DO $backfill$
DECLARE _uid UUID; _n INT := 0;
BEGIN
  FOR _uid IN
    SELECT DISTINCT user_id FROM public.user_roles WHERE role = 'moderator'::public.app_role
  LOOP
    PERFORM public.kb_ensure_moderator_folders(_uid);
    _n := _n + 1;
  END LOOP;
  RAISE NOTICE 'kb_ensure_moderator_folders applied to % moderator(s)', _n;
END $backfill$;

-- ── 3. Будущие модераторы — автоматически ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_fn_kb_moderator_folders()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.role = 'moderator'::public.app_role THEN
    BEGIN
      PERFORM public.kb_ensure_moderator_folders(NEW.user_id);
    EXCEPTION WHEN OTHERS THEN
      -- Выдача роли НИКОГДА не должна падать из-за создания папок.
      RAISE WARNING 'kb_ensure_moderator_folders failed for %: %', NEW.user_id, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_kb_moderator_folders ON public.user_roles;
CREATE TRIGGER trg_kb_moderator_folders
AFTER INSERT ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.trg_fn_kb_moderator_folders();
