-- Вложенные папки ДЗ (запрос Елены, 2026-07-20): включаем использование
-- homework_folders.parent_id (заложен в 20260617120000, v1 был плоским).
--
-- Guard-триггер закрывает дыры при появлении вложенности + переноса папок:
--   1) RLS INSERT/UPDATE политики проверяют только tutor_id = auth.uid(), но НЕ
--      ownership parent_id — без гейта можно прицепить свою папку к чужой.
--   2) Перенос папки (UPDATE parent_id, прямой PostgREST под RLS «HW folders
--      update own») может создать цикл — клиентский гард (collectDescendantIds)
--      исключает это в UI, триггер = backstop от прямых запросов/гонок.
--
-- Ревью ChatGPT-5.6 (2026-07-20), учтено:
--   * advisory xact-lock по tutor_id ДО walk-up — иначе два конкурентных
--     reparent (A→B и B→A) под READ COMMITTED оба видят старые parent_id=NULL
--     и создают цикл;
--   * функция SECURITY DEFINER + фикс search_path — walk-up обязан читать
--     таблицу в обход RLS (под RLS цепочка с чужим предком «обрывалась» бы
--     невидимой строкой и пропускала нарушение);
--   * preflight-чистка данных, записанных ДО гарда (parent_id был доступен под
--     RLS с 20260617120000): чужой родитель / циклы → отцепить в корень.
--
-- Семантика удаления НЕ меняется (rule 40): подпапки каскадятся
-- (parent_id ON DELETE CASCADE), задания всего поддерева -> SET NULL «Без папки».

-- ── Preflight: санация связей, созданных до гарда (UI их не создавал — v1
--    плоский; возможны только ручные PostgREST-записи). Идёт ДО создания
--    триггера, порядок безопасен в обе стороны (parent_id=NULL проходит гард).

-- (а) Родитель другого владельца → отцепить (иначе удаление чужой папки
--     каскадно снесло бы папку этого репетитора + walk-up упирался бы в чужую строку).
UPDATE public.homework_folders f
SET parent_id = NULL
FROM public.homework_folders p
WHERE f.parent_id = p.id
  AND f.tutor_id <> p.tutor_id;

-- (б) Циклы: узлы с parent_id, недостижимые от корней (parent_id IS NULL),
--     образуют циклические компоненты → отцепить в корень. CTE обходит только
--     ациклическую часть (циклы от корней недостижимы) → терминируется.
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

-- ── Guard-триггер ─────────────────────────────────────────────────────────────

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

  -- Нельзя быть родителем самому себе (короткий путь до walk-up).
  IF NEW.parent_id = NEW.id THEN
    RAISE EXCEPTION 'homework folder cycle detected for folder %', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;

  -- Сериализация reparent'ов одного владельца (ревью P1): без лока два
  -- конкурентных UPDATE (A→B, B→A) под READ COMMITTED видят старое состояние
  -- друг друга и создают цикл. Второй входящий ждёт лок и после commit первого
  -- его walk-up видит свежие parent_id → цикл ловится.
  PERFORM pg_advisory_xact_lock(hashtext('hw_folder_tree'), hashtext(NEW.tutor_id::text));

  -- 1) Родитель обязан принадлежать тому же владельцу (реюз SECURITY DEFINER
  --    хелпера из 20260618082506 — RLS parent_id не проверяет).
  IF NOT public.homework_folder_owned_by(NEW.parent_id, NEW.tutor_id) THEN
    RAISE EXCEPTION 'homework folder parent % does not belong to folder owner', NEW.parent_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- 2) Anti-cycle: подъём по цепочке предков от NEW.parent_id (SECURITY DEFINER
  --    → читаем в обход RLS); встретили NEW.id — цикл. Depth cap 50 шагов —
  --    belt на случай порчи цепочки.
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

-- SECURITY DEFINER: исполняется только триггером — прямой вызов не нужен никому.
REVOKE ALL ON FUNCTION public.hw_folder_parent_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hw_folder_parent_guard() FROM anon, authenticated;

DROP TRIGGER IF EXISTS trg_hw_folder_parent_guard ON public.homework_folders;
CREATE TRIGGER trg_hw_folder_parent_guard
  BEFORE INSERT OR UPDATE OF parent_id ON public.homework_folders
  FOR EACH ROW
  EXECUTE FUNCTION public.hw_folder_parent_guard();
