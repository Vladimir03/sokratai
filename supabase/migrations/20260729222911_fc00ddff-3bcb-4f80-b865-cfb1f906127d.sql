-- Доска, фаза P0: атомарное сохранение листа (внешнее ревью этапов 1–3, P0 №1).
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

  INSERT INTO board_page_revs (page_id, board_id, rev, updated_by)
  VALUES (p_page_id, v_board_id, 0, p_updated_by)
  ON CONFLICT (page_id) DO NOTHING;

  SELECT rev INTO v_rev FROM board_page_revs WHERE page_id = p_page_id FOR UPDATE;

  IF p_base_rev IS NOT NULL AND p_base_rev <> v_rev THEN
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

CREATE OR REPLACE FUNCTION public.wb_bump_page_rev(
  p_page_id uuid,
  p_board_id uuid,
  p_updated_by text
) RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO board_page_revs (page_id, board_id, rev, updated_by)
  VALUES (p_page_id, p_board_id, 1, p_updated_by)
  ON CONFLICT (page_id) DO UPDATE
    SET rev = board_page_revs.rev + 1,
        updated_by = EXCLUDED.updated_by,
        updated_at = now()
  RETURNING rev;
$$;

GRANT EXECUTE ON FUNCTION public.wb_save_page_elements(uuid, jsonb, bigint, text) TO service_role;
REVOKE ALL ON FUNCTION public.wb_save_page_elements(uuid, jsonb, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wb_save_page_elements(uuid, jsonb, bigint, text) FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.wb_bump_page_rev(uuid, uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.wb_bump_page_rev(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.wb_bump_page_rev(uuid, uuid, text) FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';