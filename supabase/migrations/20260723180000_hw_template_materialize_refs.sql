-- ══════════════════════════════════════════════════════════════════════════
-- Атомарный промоушен шаблона в ССЫЛОЧНЫЙ режим — ревью 5.6 р.2, P2.
--
-- Было ТРИ отдельных запроса из edge: INSERT junction → UPDATE
-- `tasks_migrated_at` → (при сбое UPDATE) DELETE junction. Если падал и UPDATE,
-- и компенсирующий DELETE, legacy-шаблон оставался с orphan junction-строками:
-- счётчик задач благодаря взаимоисключающему CASE (20260723160000) уже не врал,
-- но ссылки на `kb_tasks` через `homework_template_tasks.kb_task_id`
-- (ON DELETE RESTRICT) продолжали БЛОКИРОВАТЬ удаление задачи из Базы —
-- репетитор видел бы «задача используется в шаблоне» без единого шаблона,
-- который её показывает. Плюс мусор влиял бы на будущую материализацию.
--
-- Теперь оба действия — одна транзакция функции: либо шаблон стал ссылочным,
-- либо не изменилось НИЧЕГО. Компенсирующий DELETE в edge больше не нужен.
--
-- Конвенция rule 40: «новый transactional action → новая SECURITY DEFINER RPC,
-- multi-query flow не воспроизводить» (зеркало hw_tutor_force_complete_task).
-- ══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.hw_template_materialize_refs(
  _template_id UUID,
  _tutor_id UUID,
  _kb_task_ids UUID[]
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _inserted INTEGER;
BEGIN
  IF _kb_task_ids IS NULL OR array_length(_kb_task_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'EMPTY_REFS' USING ERRCODE = '22023';
  END IF;

  -- Ownership — defense-in-depth: edge уже проверил, но RPC не должна зависеть
  -- от аккуратности вызывающего. FOR UPDATE сериализует конкурентные попытки.
  PERFORM 1 FROM homework_tutor_templates
   WHERE id = _template_id AND tutor_id = _tutor_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEMPLATE_NOT_OWNED' USING ERRCODE = '42501';
  END IF;

  -- Порядок задач = порядок массива (WITH ORDINALITY), sort_order с нуля —
  -- как писал edge. Повторы kb_task_id сюда не доходят (гейт промоушена их
  -- отсекает), а если дойдут — UNIQUE в junction честно уронит транзакцию.
  INSERT INTO homework_template_tasks (template_id, kb_task_id, sort_order)
  SELECT _template_id, t.kb_task_id, (t.ord - 1)::INTEGER
  FROM unnest(_kb_task_ids) WITH ORDINALITY AS t(kb_task_id, ord);
  GET DIAGNOSTICS _inserted = ROW_COUNT;

  UPDATE homework_tutor_templates
     SET tasks_migrated_at = now()
   WHERE id = _template_id;

  RETURN _inserted;
END;
$$;

-- Тройной REVOKE (rule 99): дефолтные привилегии схемы public грантят EXECUTE
-- ролям anon/authenticated НАПРЯМУЮ — одного REVOKE FROM PUBLIC мало.
REVOKE ALL ON FUNCTION public.hw_template_materialize_refs(UUID, UUID, UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hw_template_materialize_refs(UUID, UUID, UUID[]) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hw_template_materialize_refs(UUID, UUID, UUID[]) TO service_role;

COMMENT ON FUNCTION public.hw_template_materialize_refs(UUID, UUID, UUID[]) IS
  'Атомарно: junction-строки шаблона + tasks_migrated_at. Либо шаблон ссылочный, либо ничего не изменилось — orphan junction-строк (блокирующих удаление kb_task через RESTRICT) больше не остаётся.';
