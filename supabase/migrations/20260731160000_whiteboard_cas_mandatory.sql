-- Доска: сансет NULL base_rev (запланирован при фикс-пассе ревью этапов 3–4,
-- закрывается 31.07 — сутки после deploy-sokratai, старых вкладок Фазы 2а
-- не осталось). Прежде p_base_rev NULL означал «сохранить без CAS-проверки»
-- (переходный режим для прод-клиента, не славшего base_rev) — устаревшая
-- вкладка репетитора могла молча затереть свежие штрихи ученика.
-- Теперь NULL = конфликт (fail-closed): клиент получает серверные elements,
-- делает reconcile и повторяет с настоящим rev. Все три писателя (tutor/
-- student/guest edge) шлют base_rev всегда. Сигнатура и гранты не меняются
-- (CREATE OR REPLACE сохраняет привилегии). Идемпотентна.

CREATE OR REPLACE FUNCTION public.wb_save_page_elements(
  p_page_id uuid,
  p_elements jsonb,
  p_base_rev bigint,
  p_updated_by text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_board_id uuid;
  v_rev bigint;
  v_srv jsonb;
BEGIN
  SELECT board_id INTO v_board_id FROM board_pages WHERE id = p_page_id;
  IF v_board_id IS NULL THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  -- Строка сигнала могла не создаться (fault-tolerant бамп) — бутстрапим с 0,
  -- чтобы FOR UPDATE было что блокировать. Не 1: rev=1 ставит только создание.
  INSERT INTO board_page_revs (page_id, board_id, rev, updated_by)
  VALUES (p_page_id, v_board_id, 0, p_updated_by)
  ON CONFLICT (page_id) DO NOTHING;

  SELECT rev INTO v_rev FROM board_page_revs WHERE page_id = p_page_id FOR UPDATE;

  -- CAS обязателен: NULL больше НЕ обходит проверку (сансет 31.07).
  IF p_base_rev IS NULL OR p_base_rev <> v_rev THEN
    SELECT elements INTO v_srv FROM board_pages WHERE id = p_page_id;
    RETURN jsonb_build_object(
      'status', 'conflict',
      'rev', v_rev,
      'elements', COALESCE(v_srv, '[]'::jsonb)
    );
  END IF;

  UPDATE board_pages SET elements = p_elements, updated_at = now() WHERE id = p_page_id;
  UPDATE board_page_revs
    SET rev = v_rev + 1, updated_by = p_updated_by, updated_at = now()
    WHERE page_id = p_page_id;

  RETURN jsonb_build_object('status', 'ok', 'rev', v_rev + 1);
END;
$$;
